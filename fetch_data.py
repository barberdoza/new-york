#!/usr/bin/env python3
"""
Pulls state-level County Business Patterns (CBP) data for barbershops and
salons from the Census Bureau API and writes it to data/cbp_data.json.

Requires a free Census API key: https://api.census.gov/data/key_signup.html
Pass it via the CENSUS_API_KEY environment variable.

Usage:
    CENSUS_API_KEY=xxxx python scripts/fetch_data.py [year]

If no year is given, it defaults to CBP_YEAR below. CBP data is released
roughly a year and a half after the reference year, so the most recent
year is not always available yet.
"""
import json
import os
import sys
import urllib.request
import urllib.error
from datetime import datetime, timezone

CBP_YEAR = os.environ.get("CBP_YEAR", "2023")

# NAICS 2017 codes covering the shop-based personal grooming industry.
NAICS_CATEGORIES = {
    "812111": "Barber Shops",
    "812112": "Beauty Salons",
    "812113": "Nail Salons",
}

# State FIPS -> (name, USPS abbreviation). The 50 states + DC.
STATES = {
    "01": ("Alabama", "AL"), "02": ("Alaska", "AK"), "04": ("Arizona", "AZ"),
    "05": ("Arkansas", "AR"), "06": ("California", "CA"), "08": ("Colorado", "CO"),
    "09": ("Connecticut", "CT"), "10": ("Delaware", "DE"), "11": ("District of Columbia", "DC"),
    "12": ("Florida", "FL"), "13": ("Georgia", "GA"), "15": ("Hawaii", "HI"),
    "16": ("Idaho", "ID"), "17": ("Illinois", "IL"), "18": ("Indiana", "IN"),
    "19": ("Iowa", "IA"), "20": ("Kansas", "KS"), "21": ("Kentucky", "KY"),
    "22": ("Louisiana", "LA"), "23": ("Maine", "ME"), "24": ("Maryland", "MD"),
    "25": ("Massachusetts", "MA"), "26": ("Michigan", "MI"), "27": ("Minnesota", "MN"),
    "28": ("Mississippi", "MS"), "29": ("Missouri", "MO"), "30": ("Montana", "MT"),
    "31": ("Nebraska", "NE"), "32": ("Nevada", "NV"), "33": ("New Hampshire", "NH"),
    "34": ("New Jersey", "NJ"), "35": ("New Mexico", "NM"), "36": ("New York", "NY"),
    "37": ("North Carolina", "NC"), "38": ("North Dakota", "ND"), "39": ("Ohio", "OH"),
    "40": ("Oklahoma", "OK"), "41": ("Oregon", "OR"), "42": ("Pennsylvania", "PA"),
    "44": ("Rhode Island", "RI"), "45": ("South Carolina", "SC"), "46": ("South Dakota", "SD"),
    "47": ("Tennessee", "TN"), "48": ("Texas", "TX"), "49": ("Utah", "UT"),
    "50": ("Vermont", "VT"), "51": ("Virginia", "VA"), "53": ("Washington", "WA"),
    "54": ("West Virginia", "WV"), "55": ("Wisconsin", "WI"), "56": ("Wyoming", "WY"),
}


def _get_json(url):
    req = urllib.request.Request(url, headers={"User-Agent": "barber-salon-census/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        body = e.read().decode(errors="ignore")
        raise RuntimeError(f"Census API request failed: {e.code} {body[:300]} ({url})")


def _to_int(v):
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


def fetch_naics(year, naics_code, api_key):
    """County Business Patterns: employer establishments, employees, payroll."""
    url = (
        f"https://api.census.gov/data/{year}/cbp"
        f"?get=ESTAB,EMP,PAYANN,NAME&for=state:*&NAICS2017={naics_code}&key={api_key}"
    )
    raw = _get_json(url)
    header, *rows = raw
    idx = {col: i for i, col in enumerate(header)}
    out = {}
    for row in rows:
        fips = row[idx["state"]]
        if fips not in STATES:
            continue
        out[fips] = {
            "establishments": _to_int(row[idx["ESTAB"]]),
            "employees": _to_int(row[idx["EMP"]]),
            "payroll_annual_thousands": _to_int(row[idx["PAYANN"]]),
        }
    return out


def fetch_nonemployer(year, naics_code, api_key):
    """Nonemployer Statistics: self-employed / no-paid-employee establishments & receipts.

    NES switched its NAICS variable name to NAICS2022 starting with the 2022
    reference year; earlier years use NAICS2017. The 812111/812112/812113
    codes themselves are unchanged between the two revisions.
    """
    naics_var = "NAICS2017" if int(year) < 2022 else "NAICS2022"
    url = (
        f"https://api.census.gov/data/{year}/nonemp"
        f"?get=NESTAB,NRCPTOT,NAME&for=state:*&{naics_var}={naics_code}&key={api_key}"
    )
    raw = _get_json(url)
    header, *rows = raw
    idx = {col: i for i, col in enumerate(header)}
    out = {}
    for row in rows:
        fips = row[idx["state"]]
        if fips not in STATES:
            continue
        out[fips] = {
            "establishments": _to_int(row[idx["NESTAB"]]),
            "receipts_thousands": _to_int(row[idx["NRCPTOT"]]),
        }
    return out


def main():
    api_key = os.environ.get("CENSUS_API_KEY")
    if not api_key:
        print("ERROR: set the CENSUS_API_KEY environment variable.", file=sys.stderr)
        print("Get a free key at https://api.census.gov/data/key_signup.html", file=sys.stderr)
        sys.exit(1)

    year = sys.argv[1] if len(sys.argv) > 1 else CBP_YEAR

    print(f"Fetching CBP {year} data (employer establishments) for {len(NAICS_CATEGORIES)} NAICS categories...")
    by_naics = {}
    for code, label in NAICS_CATEGORIES.items():
        print(f"  - {code} {label}")
        by_naics[code] = fetch_naics(year, code, api_key)

    print(f"Fetching Nonemployer Statistics {year} (no-paid-employee businesses)...")
    nonemp_by_naics = {}
    nonemp_ok = True
    for code, label in NAICS_CATEGORIES.items():
        try:
            print(f"  - {code} {label}")
            nonemp_by_naics[code] = fetch_nonemployer(year, code, api_key)
        except RuntimeError as e:
            # NES is sometimes a year behind CBP -- don't fail the whole run for it.
            print(f"    WARNING: nonemployer fetch failed for {code}: {e}", file=sys.stderr)
            nonemp_ok = False
            nonemp_by_naics[code] = {}

    states_out = []
    for fips, (name, abbr) in sorted(STATES.items(), key=lambda kv: kv[1][0]):
        categories = {}
        for code, label in NAICS_CATEGORIES.items():
            stats = by_naics[code].get(fips, {})
            nonemp_stats = nonemp_by_naics[code].get(fips, {})
            categories[code] = {
                "label": label,
                "establishments": stats.get("establishments"),
                "employees": stats.get("employees"),
                "payroll_annual_thousands": stats.get("payroll_annual_thousands"),
                "nonemployer": {
                    "establishments": nonemp_stats.get("establishments"),
                    "receipts_thousands": nonemp_stats.get("receipts_thousands"),
                },
            }
        states_out.append({
            "state_fips": fips,
            "state": name,
            "abbr": abbr,
            "categories": categories,
        })

    output = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "year": year,
        "source": "U.S. Census Bureau, County Business Patterns (employer) & Nonemployer Statistics (self-employed)",
        "source_url": f"https://api.census.gov/data/{year}/cbp",
        "nonemployer_source_url": f"https://api.census.gov/data/{year}/nonemp",
        "nonemployer_note": None if nonemp_ok else (
            f"Nonemployer Statistics for {year} was unavailable at fetch time for one or more "
            "categories (NES is sometimes released later than CBP) -- those cells are blank."
        ),
        "is_sample": False,
        "categories": NAICS_CATEGORIES,
        "states": states_out,
    }

    out_path = os.path.join(os.path.dirname(__file__), "..", "data", "cbp_data.json")
    with open(out_path, "w") as f:
        json.dump(output, f, indent=2)

    print(f"Wrote {out_path}")


if __name__ == "__main__":
    main()
