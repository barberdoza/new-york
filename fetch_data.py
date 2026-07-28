#!/usr/bin/env python3
"""
Pulls active Appearance Enhancement Business & Barber Shop license records
from New York State's open data portal (data.ny.gov, Socrata) and writes a
compact JSON file with:
  - a city-level rollup (shop counts by category)
  - individual shop records with lat/lon, for the map

No API key is required for this volume of traffic. If you hit rate limits,
get a free Socrata "app token" at https://data.ny.gov/profile/edit/developer_settings
and set it via the NY_APP_TOKEN environment variable -- the script will pick
it up automatically.

Usage:
    python scripts/fetch_data.py
"""
import json
import os
import re
import sys
import urllib.request
import urllib.parse
import urllib.error
from datetime import datetime, timezone

# "Active Appearance Enhancement and Barber Business and Area Renter Licensees"
# https://data.ny.gov/Economic-Development/Active-Appearance-Enhancement-and-Barber-Business-/y3u4-jbgh
RESOURCE_ID = "y3u4-jbgh"
BASE_URL = f"https://data.ny.gov/resource/{RESOURCE_ID}.json"

# Only these license types represent an actual shop location. Area Renters
# (independent contractors who rent a chair/space inside someone else's
# shop) share their address with the shop they rent from, so counting them
# as separate "shops" would double-count locations -- they're tallied
# separately instead, in case you want to know renter density per shop.
SHOP_CATEGORIES = {
    "DOSAEBUSINESS": "Appearance Enhancement Business",
    "DOSBARSHOPOWNER": "Barber Shop",
}

PAGE_SIZE = 5000


def _get_json(url):
    req = urllib.request.Request(url, headers={"User-Agent": "ny-shop-directory/1.0"})
    app_token = os.environ.get("NY_APP_TOKEN")
    if app_token:
        req.add_header("X-App-Token", app_token)
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        body = e.read().decode(errors="ignore")
        raise RuntimeError(f"NY open data request failed: {e.code} {body[:300]} ({url})")


def parse_point(georeference):
    """Socrata Point columns usually arrive as GeoJSON: {"type":"Point","coordinates":[lon,lat]}.
    Fall back to parsing WKT-style "POINT (lon lat)" strings just in case."""
    if not georeference:
        return None
    if isinstance(georeference, dict):
        coords = georeference.get("coordinates")
        if coords and len(coords) == 2:
            lon, lat = coords
            return (lat, lon)
        return None
    if isinstance(georeference, str):
        m = re.match(r"POINT\s*\(\s*(-?\d+\.?\d*)\s+(-?\d+\.?\d*)\s*\)", georeference)
        if m:
            lon, lat = float(m.group(1)), float(m.group(2))
            return (lat, lon)
    return None


def fetch_all_records():
    fields = "license_type,business_name,business_address_1,business_address_2,business_city,business_zip,georeference"
    records = []
    offset = 0
    while True:
        url = BASE_URL + "?" + urllib.parse.urlencode({
            "$select": fields,
            "$limit": PAGE_SIZE,
            "$offset": offset,
            "$order": ":id",
        })
        batch = _get_json(url)
        if not batch:
            break
        records.extend(batch)
        print(f"  fetched {len(records)} records so far...")
        if len(batch) < PAGE_SIZE:
            break
        offset += PAGE_SIZE
    return records


def main():
    print("Fetching active NY appearance enhancement & barber licenses...")
    raw = fetch_all_records()
    print(f"Total records pulled: {len(raw)}")

    shops = []
    rollup = {}  # city -> {category_code: count, "total": n}
    other_type_count = 0

    for row in raw:
        license_type = row.get("license_type")
        if license_type not in SHOP_CATEGORIES:
            other_type_count += 1
            continue

        city = (row.get("business_city") or "UNKNOWN").strip().upper()
        point = parse_point(row.get("georeference"))
        lat, lon = point if point else (None, None)

        addr = " ".join(filter(None, [row.get("business_address_1"), row.get("business_address_2")]))

        shops.append([
            row.get("business_name") or "",
            license_type,
            addr,
            city.title(),
            row.get("business_zip") or "",
            lat,
            lon,
        ])

        bucket = rollup.setdefault(city.title(), {code: 0 for code in SHOP_CATEGORIES})
        bucket[license_type] += 1

    rollup_out = []
    for city, counts in sorted(rollup.items()):
        total = sum(counts.values())
        entry = {"city": city, "total": total}
        entry.update(counts)
        rollup_out.append(entry)
    rollup_out.sort(key=lambda r: -r["total"])

    output = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source": "New York State Department of State via data.ny.gov (Socrata Open Data)",
        "source_url": f"https://data.ny.gov/Economic-Development/Active-Appearance-Enhancement-and-Barber-Business-/{RESOURCE_ID}",
        "is_sample": False,
        "categories": SHOP_CATEGORIES,
        "excluded_area_renter_records": other_type_count,
        "shop_fields": ["name", "category", "address", "city", "zip", "lat", "lon"],
        "rollup": rollup_out,
        "shops": shops,
    }

    out_path = os.path.join(os.path.dirname(__file__), "..", "data", "ny_shops.json")
    with open(out_path, "w") as f:
        json.dump(output, f, separators=(",", ":"))  # compact -- this dataset is large

    print(f"Wrote {out_path}: {len(shops)} shops across {len(rollup_out)} cities "
          f"({other_type_count} area-renter records excluded from shop counts).")


if __name__ == "__main__":
    main()
