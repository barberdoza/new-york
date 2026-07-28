# State of the Shop

A small static web app that lets you look up any U.S. state and see U.S. Census
Bureau data on **barbershops** (NAICS 812111), **beauty salons** (812112), and
**nail salons** (812113): number of establishments, employees, and annual
payroll — for both:

- **Employer shops** (have paid staff) — from **County Business Patterns (CBP)**
- **Solo/self-employed shops** (no paid staff — booth renters, mobile stylists,
  sole proprietors) — from **Nonemployer Statistics (NES)**

Both are official annual Census Bureau data products, pulled via their public
APIs.

The repo ships with **sample placeholder data** (`data/cbp_data.json`,
randomly generated, clearly labeled) so the site works the moment you deploy
it. Follow the steps below to replace it with the real Census figures.

## 1. Get a free Census API key

Sign up here (takes a minute, no cost): https://api.census.gov/data/key_signup.html

## 2. Add it to your GitHub repo as a secret

In your repo: **Settings → Secrets and variables → Actions → New repository
secret**

- Name: `CENSUS_API_KEY`
- Value: the key you just got

## 3. Run the data fetch

Go to the **Actions** tab → **Update Census data** workflow → **Run
workflow**. This runs `scripts/fetch_data.py`, which calls the Census API and
overwrites `data/cbp_data.json` with real figures, then commits it.

It's also scheduled to re-run automatically on the 1st of every month (CBP is
only released annually, so this mostly just catches revisions — adjust the
`cron` line in `.github/workflows/update-data.yml` if you want it less/more
often, or delete the `schedule:` block to only run on demand).

You can also run it locally:

```bash
export CENSUS_API_KEY=your_key_here
python3 scripts/fetch_data.py        # defaults to CBP year 2023
python3 scripts/fetch_data.py 2022   # or pick a specific year
```

## 4. Turn on GitHub Pages

**Settings → Pages → Build and deployment → Source: Deploy from a branch →
Branch: `main`, folder: `/ (root)`**

Your site will be live at `https://<your-username>.github.io/<repo-name>/`
within a minute or two.

## How it's put together

```
index.html          the page
css/style.css        styling
js/app.js             search, filtering, ranking chart, table — all client-side
data/cbp_data.json    the dataset the page reads (static JSON, no server needed)
scripts/fetch_data.py pulls fresh data from the Census API
.github/workflows/    scheduled + on-demand data refresh
```

There's no build step and no backend — `js/app.js` just fetches
`data/cbp_data.json` over HTTP, which is why GitHub Pages (plain static
hosting) is enough. The Census API key never touches the browser; it's only
used inside the GitHub Action, as a repo secret.

### Data notes

- CBP only counts **employer establishments** — shops with at least one paid
  employee. Solo/self-employed operators aren't included.
- Some state/industry combinations are withheld ("—" in the app) when the
  Census Bureau judges that publishing them could reveal a specific
  business's data.
- CBP is released roughly 18 months after the reference year, so "latest
  year" moves slowly. Check
  https://www.census.gov/programs-surveys/cbp/data.html for the newest
  available year and update `CBP_YEAR` in the workflow / script if needed.
- Nonemployer Statistics (NES) is a separate release and is sometimes a year
  behind CBP for the same reference year. If NES isn't available yet for the
  year you're fetching, `fetch_data.py` logs a warning and leaves those cells
  blank rather than failing the whole run — check `nonemployer_note` in the
  output JSON.
- NES switched its NAICS variable from `NAICS2017` to `NAICS2022` starting
  with reference year 2022 (the script handles this automatically). The
  812111/812112/812113 codes themselves didn't change between the two NAICS
  revisions.

## Customizing

- **Add/remove industries:** edit `NAICS_CATEGORIES` in
  `scripts/fetch_data.py` (any NAICS 2017 code CBP publishes will work), and
  update the table headers in `index.html` to match.
- **Change the ranking list length:** `showCount` in `js/app.js`.
- **Colors/fonts:** all in the `:root` block at the top of `css/style.css`.
  Currently set to Boulevard's brand system: Onyx `#000000`, White `#FFFFFF`,
  Ochre `#C8AB7C`, Spruce `#183E43`, and the Fog/Silt/Stone/Iron neutrals,
  paired with Wix Madefor Display (headings) and DM Sans (body), both loaded
  from Google Fonts in `index.html`.
