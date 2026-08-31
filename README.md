[README.md](https://github.com/user-attachments/files/31666237/README.md)
# ADAPT — PNG El Niño Early Warning Dashboard

_(formerly referred to internally as the "PNG El Niño ASIS/GIEWS Live Drought Dashboard")_

A public-facing Papua New Guinea drought monitoring dashboard built around **FAO ASIS/GIEWS vegetation-health screening**, a **composite biophysical stress layer**, and a linked **live drought and frost processing workspace**.

The dashboard is designed to support:
- early warning and screening
- province-level prioritisation
- population exposure review
- operational interpretation and field verification planning
- quick access to linked EarthMap and Streamlit tools

## Dashboard purpose

This dashboard is intended to provide a **screening and prioritisation view**, not a final impact declaration. It brings together multiple live and semi-live data products so users can quickly identify which provinces may require closer review, field verification, or escalation.

The system currently combines:
- **Live ASIS/GIEWS vegetation condition screening**
- **Integrated composite biophysical stress outputs**
- **Population exposure summaries derived from stressed zones**
- **PNG live drought and frost processing status**
- **Linked external tools** for detailed technical review

## Main dashboard tabs

ADAPT is organised into five tabs, consolidated from an earlier nine-tab layout so the navigation leads with what ADAPT is before showing its live outputs.

### 1. About ADAPT
The front door to the dashboard. Explains what ADAPT is and presents the **Combined Drought Index (CDI)** methodology jointly developed by PNG's National Weather Service (NWS) and FAO: the indicator table and weights, an interactive example map, per-province CDI component charts, and the historical CDI time series (1996-present). This is the default tab shown on load.

**Monthly update -- now automated:** the methodology table's "Latest data used" column, the "Example: PNG, `<month>`" heading/caption, and the CDI example map/charts are no longer hand-edited into this file. They are fetched at runtime from `data/cdi_example_latest.json` and `data/cdi_archive.json`, which are generated from the CDI pipeline's monthly `PNG_CDI.rds` export by `scripts/update_cdi_data.py`.

Two ways to run the monthly update:

1. **Automatic (recommended):** commit the month's `PNG_CDI.rds` (as emailed by the CDI pipeline owner) to `pipeline/PNG_CDI.rds` in this repo -- via `git push` or by dragging the file into that folder through the GitHub web UI -- and push to `main`. The `.github/workflows/update-cdi-data.yml` workflow runs automatically, regenerates the two JSON files, and commits them. No local setup needed.
2. **Manual:** run `pip install rdata && python scripts/update_cdi_data.py path/to/PNG_CDI.rds` locally, then commit the two changed files in `data/`.

Either way, the script derives the correct calendar-month labels itself (see "Data timing convention" below) instead of anyone guessing at date arithmetic by hand -- this is what several rounds of mislabeled "Jul 2026" vs "Aug 2026" bugs earlier in this dashboard's development were caused by.

### Data timing convention

Confirmed directly from the CDI pipeline's own `do_CDI.R` source (2026-07-29, Josh Hooker/FAORAP): each row in `PNG_CDI.rds` is keyed by `YEAR`/`MONTH`, the **observation month** for ENSO, IOD, rainfall, soil moisture and vegetation. The row's `fcYEAR`/`fcMONTH` is one month ahead and marks the start of the 3-month rainfall forecast window. Per the script's own comment:

> `# CDI estimate made in month m uses observations from month m-1`
> `# and seasonal forecast for month m through to month m+2`

So the row with `MONTH=7` (July observations) is published as **"August's CDI"** -- matching the pipeline's own `PNG_CDI_summary_2026_8.csv` naming. `scripts/update_cdi_data.py` uses `fcYEAR`/`fcMONTH` for the "Example: PNG, `<month>`" reporting label and `YEAR`/`MONTH` for the archive's own month-by-month labelling (kept unshifted, consistent with the other 366 months already in `cdi_history`/`recent_indicators` -- see git history for the back-and-forth that settled on this split).

### CDI formula verification (2026-08-31)

Cross-checking `do_CDI.R` against this dashboard's client-side flag thresholds (`cdiComponentFlagValue`, `cdiExampleFlag`, and the methodology table) found one mismatch, since fixed: the soil-moisture alert threshold is **-5%**, not -10% (`ifelse(SM >= -5, 0, ifelse(SM >= -15, 0.5, 1))` in the R source). ENSO, IOD, rainfall (SPI-1), vegetation (VHI) and forecast rainfall (SPI-3) thresholds all matched exactly.

### CDI operational phase bands (2026-08-31)

The About ADAPT example map, its province popups, and the methodology note now label each province's CDI with the same operational-phase decision framework the Food Security Cluster itself uses, per Table 1 of the FAO PNG Food Security & Agriculture Sectoral Plan (August 2026 draft): **0.40-0.59 Readiness, 0.60-0.79 Anticipatory Action, 0.80-1.00 Response threshold** (below 0.40 shown as "Monitoring", since the sectoral plan's table doesn't define a band there). This replaced an ad-hoc "Drought / Elevated risk / Some indicators active" severity scale in `cdiExamplePopup` that used different, undocumented thresholds (0.6/0.4/0.2) and didn't match any actual decision framework. The new logic lives in one function, `cdiOperationalPhase(cdi)`, so the map, popups and methodology text can never drift out of sync with each other again. Verified against the sectoral plan's own Table 1: with the August 2026 data, all provinces classify as Anticipatory Action except Madang at Response threshold -- an exact match.

**Not implemented (deliberately, for now):** the sectoral plan also gives national people-in-need / people-targeted figures (1,166,630 / 933,304, 186,661 HH) and a phased response-activity plan. These were not added to the dashboard in this pass. If they are added later, they must **not** be merged or averaged with `data/integrated_priority_latest.json`'s own population exposure figures (`population_exposed_total`, `population_high_priority`, etc.) -- those come from a different methodology (WorldPop intersected with the composite biophysical stress layer, not the CDI) and are a genuinely separate estimate. Some correlation between the two is expected and fine; presenting one as if it were a subtotal or recalculation of the other is not, and would misrepresent both source documents.

### 2. Overview
The national operational snapshot:
- latest ASIS screening period and national vegetation summary
- number of provinces in higher concern classes
- selected province briefing (with print/CSV export)
- live drought and frost processing status
- ENSO/IOD climate driver context
- charts for the highest-stress provinces and stress-class distribution

### 3. Interactive Map
Interactive map for visual review of current conditions.

Current map behaviour:
- **Pixel-level Combined Drought Index (CDI)** is the main operational raster when the pipeline publishes `layers.cdi_tile_url` (see `data/integrated_priority_latest.json` below); otherwise the map falls back to composite stress
- **Composite biophysical stress** and **live ASIS vegetation screening** remain available as reference layers
- provincial polygons are symbolised by current integrated stress where available
- province point summaries are displayed on top for quick inspection
- popups summarise stress and exposure conditions by province

### 4. Provincial Data
Merges what were previously three separate tabs (Live ASIS Drought Stress, Integrated Priority, Population & Exposure) into one:
- vegetation-index ranking chart and searchable/sortable ASIS provincial table, with plain-language screening meaning and verification priority
- population exposure KPIs (exposed, high-exposure, affected provinces, watch-level population)
- one combined, searchable/sortable provincial table covering composite stress, priority class, agricultural priority, exposure priority, population exposed, high-exposure population, ASIS vegetation index, rainfall % normal, soil moisture % normal, and frost mean

### 5. Response & Tools
Merges the former Operational Response, Live Processing Workspace, PNGNWS Outlook, and EarthMap tabs into one:
- response framing by stress class and a field verification checklist (what district, provincial, DAL, NARI, NDC, and partner teams should collect on the ground)
- embedded/linked **Live Processing Workspace** (Streamlit) for live technical review and processing of drought and frost layers
- **PNGNWS Outlook**: official national forecast links and auto-synced preview imagery
- embedded/linked **EarthMap** for contextual geospatial review

## Background processing concept

The dashboard depends on a few key data products stored in the repository and refreshed through scripts and workflows.

### Core live inputs

#### `data/asis_vhi_latest.json`
Primary ASIS/GIEWS update used by the dashboard front end.

This file feeds:
- overview cards
- ASIS charts
- ASIS provincial table
- province briefing content
- live ASIS map layer when available

#### `data/integrated_priority_latest.json`
Integrated composite stress and exposure output.

This file feeds:
- Provincial Data tab
- composite map layer
- province popup content on the interactive map

**Pixel-level CDI layer (automated):** `layers.cdi_tile_url` is generated
and patched into this file every night by `scripts/build_cdi_pixel.py`,
which runs as an extra step in `.github/workflows/update-integrated-composite.yml`
right after `build_integrated_composite.py` (patching, not overwriting, so
it survives that workflow's nightly full rewrite). It is an Earth-Engine
XYZ tile URL for a single-band raster where every pixel is the same
weighted CDI score used for the province-level CDI in `do_CDI.R`: ENSO and
IOD applied as flat national flags read automatically from
`data/cdi_example_latest.json`, combined per-pixel with a CHIRPS-based
SPI-1 rainfall approximation, an ERA5-Land soil-moisture anomaly, and ASIS
vegetation (VHI) -- all using calendar-month windows keyed to the same
observation month `do_CDI.R` uses, not the composite score's own rolling
90-day/30-day windows. The forecast SPI-3 term is a documented placeholder
(no SEAS5 source in Earth Engine's public catalog yet -- see the script's
docstring) until a seasonal forecast asset is wired in.

When `cdi_tile_url` is present, the Interactive Map tab shows it as the
default raster layer (ahead of composite stress), with its own legend and
a "CDI raster (GeoTIFF)" download at `data/cdi_pixel_latest.tif`, also
written by the same step (same convention as the existing
`composite_biophysical_stress.tif` export). The CDI-pixel step is
non-blocking (`continue-on-error: true`) so a failure there never breaks
the already-working nightly composite commit -- if it fails (e.g. before
the first `PNG_CDI.rds` has ever been committed, since it depends on
`cdi_example_latest.json`), the map simply falls back to composite stress
/ ASIS as before, same as if the field were absent.

**Rainfall/soil-moisture approximation caveat:** SPI-1 and the soil-moisture
anomaly here are empirical proxies (z-score / percent-departure), not a
true Gamma-fitted SPI or whatever exact SMAPI formula `PNG_rain_CHIRPS.rds`
/ `PNG_SM_ERA5.rds` use internally (their generation source wasn't in the
material available when this was built). `build_cdi_pixel.py` prints
per-province CDI means on every run specifically so they can be spot-checked
against the corresponding `PNG_CDI_summary_*.csv` -- do that before treating
this raster as authoritative at the 0 / 0.5 / 1 flag boundaries.

#### `data/live_processing_status.json`
Summary status file for the separate PNG live processing workspace.

This file feeds:
- analysis date
- drought window
- frost window
- notes shown on the overview page
- optional province-level drought and frost summary if included

### Boundary layer

#### `adm1_nso_province.geojson`
Provincial boundary layer used for:
- polygon display on the interactive map
- province click popups
- provincial styling against live or integrated summaries

## Composite stress concept

The dashboard is no longer relying on ASIS alone for the operational view.

The current logic uses a **composite biophysical stress approach**, which is intended to combine several signals such as:
- vegetation stress from ASIS/GIEWS
- rainfall deficit
- frost screening
- other integrated weighting used by the backend script

This produces a composite stress score used to:
- rank provinces
- style the integrated map
- estimate exposed population within stressed zones
- support the integrated priority and exposure tabs

## Population exposure concept

Population exposure is derived by intersecting or summarising gridded population against stressed areas or stress-weighted outputs.

The dashboard currently focuses on public-facing exposure indicators such as:
- total population exposed
- high exposure population
- watch-level population
- province-level exposed population summaries

This should still be treated as a **screening estimate**, not a final official affected-population count.

## Repository structure

Key files currently used by the dashboard include:

- `index.html` — main GitHub Pages dashboard front end (ADAPT)
- `README.md` — project documentation
- `adm1_nso_province.geojson` — PNG provincial boundaries
- `data/asis_vhi_latest.json` — latest ASIS/GIEWS update for dashboard use
- `data/integrated_priority_latest.json` — latest integrated composite stress output
- `data/integrated_priority_latest.csv` — tabular export of integrated priority results
- `data/live_processing_status.json` — linked live workspace status summary
- `data/cdi_example_latest.json` — current month's per-province CDI + indicators for the About ADAPT example map/table (see "Monthly update" above)
- `data/cdi_archive.json` — full 1996-present CDI history for the "Recent CDI components" and "Historical CDI time series" charts
- `pipeline/PNG_CDI.rds` — the CDI pipeline's latest monthly export; committing a new one here triggers `update-cdi-data.yml`
- `scripts/update_cdi_data.py` — regenerates the two `cdi_*.json` files above from `pipeline/PNG_CDI.rds`
- `scripts/build_cdi_pixel.py` — generates the pixel-level CDI raster and patches `layers.cdi_tile_url` into `data/integrated_priority_latest.json`; runs nightly as part of `update-integrated-composite.yml`
- `data/cdi_pixel_latest.tif` — GeoTIFF export of the pixel-level CDI raster, written by `scripts/build_cdi_pixel.py`
- `.github/workflows/` — GitHub Actions workflows for automated updates and patching (including `update-cdi-data.yml` and `update-integrated-composite.yml`)
- `scripts/` — backend processing scripts used to build outputs

## Front-end stack

The dashboard is a lightweight static site built with:
- **HTML**
- **CSS**
- **vanilla JavaScript**
- **Leaflet** for interactive mapping
- **Chart.js** for charts
- **GitHub Pages** for hosting

This keeps deployment simple while allowing live JSON-driven updates.

## Hosting and deployment

The dashboard is hosted through **GitHub Pages**.

Typical deployment flow:
1. source JSON or HTML changes are committed to the repository
2. GitHub Actions / Pages build runs
3. the public site is updated at the Pages URL

Because browser caching can delay visual updates, users may need to do a hard refresh after deployment.

## Data refresh approach

The dashboard can be updated in two main ways:

### 1. Front-end updates
Changes to:
- layout
- tab content
- table columns
- popup logic
- map layer ordering
- labels and explanatory text

These are usually made in `index.html`.

### 2. Data updates
Changes to:
- latest ASIS screening values
- composite priority outputs
- population exposure summaries
- live processing status

These are usually made by updating the JSON/CSV files in `data/` directly or through backend scripts and GitHub workflows.

## Recommended operational interpretation

This dashboard should be used to:
- identify provinces needing verification
- compare live vegetation and composite stress signals
- review population exposure screening results
- communicate a concise national and provincial briefing
- support planning for follow-up field checks

It should not be used on its own to:
- declare official disaster status
- assign final affected-population counts
- replace ground validation or sector-specific assessment

## Suggested future improvements

Potential next enhancements include:
- cleaner technical documentation for each workflow and script
- better distinction between screening outputs and confirmed impacts
- area-based stress metrics alongside population exposure
- percent-of-population exposed by province
- stronger audit trail for each automated data refresh
- automated metadata display for all live layers
- downloadable technical notes and methodology annexes

## Maintainer notes

When making updates, check both:
- **front-end presentation logic** in `index.html`
- **backend data products** in `data/`

If a value looks wrong on the public page, the cause is usually one of these:
1. stale browser cache
2. JSON output not refreshed
3. front-end renderer still using an old field structure
4. GitHub Pages deployment not yet completed

## Disclaimer

This dashboard is a **screening and decision-support tool**. Results are intended for early warning, planning, and prioritisation. Final interpretation should always be supported by field evidence, technical review, and decisions by the appropriate PNG government authorities and partner institutions.
