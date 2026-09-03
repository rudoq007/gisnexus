[README.md](https://github.com/user-attachments/files/31776529/README.md)
# ADAPt — Agricultural Draught Action Platform

_(formerly referred to internally as the "PNG El Niño ASIS/GIEWS Live Drought Dashboard")_

A public-facing Papua New Guinea drought monitoring dashboard built around the **Combined Drought Index (CDI)** -- NWS/FAO's primary, government-endorsed anticipatory-action trigger -- with **FAO ASIS/GIEWS vegetation-health screening**, a **composite biophysical stress layer**, and a linked **live drought and frost processing workspace** as complementary, higher-frequency screening layers underneath it.

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

ADAPt is organised into five tabs, consolidated from an earlier nine-tab layout so the navigation leads with what ADAPt is before showing its live outputs.

### 1. About ADAPt
The front door to the dashboard. Explains what ADAPt is and presents the **Combined Drought Index (CDI)** methodology jointly developed by PNG's National Weather Service (NWS) and FAO: the indicator table and weights, an interactive example map, per-province CDI component charts, and the historical CDI time series (1996-present). This is the default tab shown on load.

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

The About ADAPt example map, its province popups, and the methodology note now label each province's CDI with the same operational-phase decision framework the Food Security Cluster itself uses, per Table 1 of the FAO PNG Food Security & Agriculture Sectoral Plan (August 2026 draft): **0.40-0.59 Readiness, 0.60-0.79 Anticipatory Action, 0.80-1.00 Response threshold** (below 0.40 shown as "Monitoring", since the sectoral plan's table doesn't define a band there). This replaced an ad-hoc "Drought / Elevated risk / Some indicators active" severity scale in `cdiExamplePopup` that used different, undocumented thresholds (0.6/0.4/0.2) and didn't match any actual decision framework. The new logic lives in one function, `cdiOperationalPhase(cdi)`, so the map, popups and methodology text can never drift out of sync with each other again. Verified against the sectoral plan's own Table 1: with the August 2026 data, all provinces classify as Anticipatory Action except Madang at Response threshold -- an exact match.

**Not implemented (deliberately, for now):** the sectoral plan also gives national people-in-need / people-targeted figures (1,166,630 / 933,304, 186,661 HH) and a phased response-activity plan. These were not added to the dashboard in this pass. If they are added later, they must **not** be merged or averaged with `data/integrated_priority_latest.json`'s own population exposure figures (`population_exposed_total`, `population_high_priority`, etc.) -- those come from a different methodology (WorldPop intersected with the composite biophysical stress layer, not the CDI) and are a genuinely separate estimate. Some correlation between the two is expected and fine; presenting one as if it were a subtotal or recalculation of the other is not, and would misrepresent both source documents.

### Seasonal context and province livelihood profiles (2026-09-01)

Source material: the FAO PNG El Nino Plan of Action (5 July 2026) and a revised draft of the Food Security & Agriculture Sectoral Plan (1 September 2026, confirmed identical to the 20 August draft on Table 1's CDI thresholds -- no change needed to the phase bands above). Three additions, all in the About ADAPt tab:

- **Seasonal phase timeline** (`renderSeasonalPhaseTimeline()`, new `#seasonalContextCard`): a static four-phase calendar (Preparedness Jun-Sep 2026, Anticipatory Action Sep-Dec 2026, Response Jan-Apr 2027, Recovery Apr 2027 onward) from the national plan's Table 8/Section H, with today's phase highlighted client-side by calendar month. This is deliberately kept separate from `cdiOperationalPhase()`: the timeline shows *where the season is*, the CDI phase bands show *how severe conditions currently are*. Don't merge the two into one indicator -- a province can be in the calendar's "Preparedness" window while its own CDI has already crossed into Response, and the dashboard should be able to show that contradiction rather than hide it.
- **Historical severity callout**: cites the plan's own 1997/98 (~1.2M needing food assistance, ~40 drought/famine deaths) and 2015/16 (~2.7M affected, ~495,000 severe food insecurity) figures, for stakes/context only -- not used in any calculation.
- **Province livelihood/impact profiles** (`PROVINCE_LIVELIHOOD_PROFILES`, wired into `cdiExamplePopup()`): each CDI map popup now also shows the province's dominant livelihood system and likely drought impact, from the national plan's Table 1. That table is itself a draft and only 15 of 22 provinces were filled in as of 5 July 2026 (missing: Gulf, Milne Bay, Oro, East Sepik, Sandaun, Madang, National Capital District) -- the popup simply omits this section for provinces without an entry, the same graceful-degradation pattern used elsewhere for missing data. Re-run `scripts/update_cdi_data.py`'s output is unaffected; this table is hand-maintained from the source document, not pipeline-generated, so if FAO fills in the remaining provinces in a future draft, `PROVINCE_LIVELIHOOD_PROFILES` in `index.html` needs updating by hand.

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

### CDI-linked population exposure (NSO 2024 census units) -- 2026-09-01

A second, separate population-exposure figure is now generated nightly by `scripts/build_cdi_population_exposure.py`, written to `data/cdi_population_exposure.json`. It samples the pixel-level CDI raster (`data/cdi_pixel_latest.tif`) at every PNG NSO 2024 census-unit point in `pipeline/CU_reference_imputed.gpkg` (~30,700 points; imputed coordinates used where the original point coordinates were missing), classifies each by the same CDI operational phase bands used elsewhere on the dashboard, and aggregates population and household counts by province and by phase.

**This is deliberately a different data source and methodology from the population-exposure numbers described just above** (which come from WorldPop intersected with the composite biophysical stress layer, not the CDI). The two figures will not match and should never be merged, summed, or presented as a refinement of one another -- see the `methodology_note` field embedded in `cdi_population_exposure.json` itself, which repeats this caveat so it survives even if this README doesn't travel with the data. Some correlation between the two is expected and fine.

Province name matching: the census-unit file uses PNG NSO's own `Adm 1 Name` spelling (e.g. `SIMBU`, `NORTHERN (ORO)`, `WEST SEPIK`, `AUTONOMOUS REGION OF BOUGAINVILLE`), mapped to this dashboard's canonical province names via `ADM1_NAME_ALIAS` in the script (e.g. `SIMBU` &rarr; `Chimbu`, `NORTHERN (ORO)` &rarr; `Oro`, `WEST SEPIK` &rarr; `Sandaun`). All 22 provinces map cleanly as of the current file; the script prints a warning and skips any Adm 1 Name it doesn't recognise, so a future renaming upstream would surface as a warning in the workflow log rather than silently mis-attributing population.

This step runs nightly in `update-integrated-composite.yml`, right after `build_cdi_pixel.py` (it depends on that step's GeoTIFF output) and is non-blocking (`continue-on-error: true`), same as that step.

**Front-end display:** a new card, `#cdiPopulationExposureCard`, at the end of the About ADAPt tab's CDI section (after the historical time series chart), rendered by `loadCdiPopulationExposure()`. It fetches `data/cdi_population_exposure.json` at runtime and stays hidden (`style="display:none"` in the markup) until that fetch succeeds -- same graceful-degradation pattern as the other optional live layers, so the card simply won't appear until the workflow has produced the file at least once. Shows national totals by phase as stat cards, then a per-province table sorted by Response-threshold population, with its own explicit callout that these numbers are a different source/methodology from the Provincial Data tab's population exposure and must not be combined with it.

## Site-wide cohesion pass (2026-09-01)

A full read-through of all five tabs found that the dashboard had accumulated **three parallel severity/response frameworks that never referenced each other**: the CDI operational phase (Readiness/Anticipatory Action/Response threshold -- the newest, government-endorsed trigger), the composite biophysical stress priority class (Severe/High/Moderate/Watch/Low, 0-100 scale, different weights, no ENSO/IOD), and the ASIS vegetation stress class (High/Moderate/Watch/Lower). A user could pull the same province from three different tabs and get three differently-labelled verdicts with no indication of how they relate. Fixed:

- **Provincial Data tab**: both the "Composite stress, priority & exposure" and "Live ASIS/GIEWS drought and vegetation stress" cards now state explicitly that the CDI phase (About ADAPt tab) is the primary trigger, and frame their own metrics as complementary, higher-frequency screening layers (ASIS updates roughly every 10 days vs. CDI's monthly cycle) rather than competing verdicts.
- **Response & Tools tab**: added a new lead card, `#cdiResponseGuidance`, at the top of the tab with the CDI phase &rarr; recommended action table (the same text as `cdiOperationalPhase()` in the About tab, kept in sync by hand). The pre-existing ASIS-based "Operational response framework" table is retitled "ASIS vegetation-stress framework (secondary layer)" and now sits underneath it as a faster-cadence complement, not the tab's only framework.
- **Overview tab**: the "Executive interpretation" note was leftover pre-rebrand copy that described ADAPt purely as "ASIS/GIEWS screening and the PNG live processing workspace" with no mention of the CDI at all -- directly at odds with the About ADAPt tab's own framing. Rewritten to lead with the CDI as the primary trigger, with ASIS and the live processing workspace as supporting layers.
- **Population exposure cross-reference**: About ADAPt's CDI-linked population card already noted it differs from Provincial Data's WorldPop-based figures; Provincial Data's own population section didn't point back. Added the reverse note so the relationship reads the same from either direction.
- **This README's own opening line** had the same stale framing as the Overview tab and was updated to match (CDI as the primary trigger; ASIS/composite/live-processing as complementary layers).

Not changed: the Overview vs. Provincial Data overlap in ASIS vegetation-ranking content (a chart on Overview, a full table on Provincial Data) was reviewed and left as-is -- summary-then-detail is a normal dashboard pattern, not a redundancy.

## Stakeholder review feedback (2026-09-03)

Kachen Wongsathapornchai (FAOPG) reviewed the live site and sent feedback by email. Actioned:

- **Renamed ADAPT &rarr; ADAPt** (lowercase "t") throughout the site (title, header, tab label, all body-copy mentions) and this README, and expanded the tagline everywhere it appeared to **"Agricultural Draught Action Platform"** (title, header sub-line, footer), replacing the old "PNG El Nino Early Warning Dashboard" tagline. Spelled exactly as instructed in the email -- flagged to the dashboard owner as an unusual spelling of "drought" before applying, confirmed intentional.
- **Removed the "Where this event stands" card** (the seasonal Preparedness/Anticipatory Action/Response/Recovery calendar timeline, plus the 1997/98 and 2015/16 historical-stakes paragraph bundled into the same card) from the About ADAPt tab, per explicit request -- it read as a second, coarser phase indicator sitting right next to the CDI's own more granular phase bands, which is exactly the kind of confusion the site-wide cohesion pass above was trying to eliminate. `renderSeasonalPhaseTimeline()` and its `DOMContentLoaded` listener were removed as dead code along with the markup. If the historical-stakes content (1997/98 and 2015/16 figures) is wanted back in a form that doesn't imply a second phase indicator, it would need a different framing/location.
- **Clarified the July/August offset** on "Recent CDI components": renamed the card to "...(interactive, by observation month)" and the caption now states in plain language, using the live `CDI_EXAMPLE_LABELS` data, that the chart runs through the observation month (e.g. July) while the map above reports that same data as the following month's CDI (e.g. August), with a pointer to the Data timing convention section above. No underlying data changed -- this was a labelling problem, not a data problem (the archive intentionally stays on raw observation months; see "Data timing convention" above for the full history of that decision).
- **Table heading clarity pass**: added hover tooltips (`title` attributes, no layout change) to abbreviated or jargon column headers across the Provincial Data table (Ag./Exposure priority, ASIS veg. index, Rainfall/Soil moisture % normal, Frost mean), the Live ASIS provincial table (Vegetation index, Stress class), the CDI methodology table (Flag rule, Weight), and the CDI population-exposure table (each phase column now states its exact CDI range).
- **Not yet actioned**: Kachen also reported "one function under Response & Tools" not working on his Mac, without specifying which. Likely candidates are the Live Processing Workspace or EarthMap iframe embeds (Safari's cross-site cookie/tracking-prevention policies are a known cause of embedded third-party apps failing silently). Needs a follow-up reply asking which specific control or embed failed before attempting a fix.

## Repository structure

Key files currently used by the dashboard include:

- `index.html` — main GitHub Pages dashboard front end (ADAPt)
- `README.md` — project documentation
- `adm1_nso_province.geojson` — PNG provincial boundaries
- `data/asis_vhi_latest.json` — latest ASIS/GIEWS update for dashboard use
- `data/integrated_priority_latest.json` — latest integrated composite stress output
- `data/integrated_priority_latest.csv` — tabular export of integrated priority results
- `data/live_processing_status.json` — linked live workspace status summary
- `data/cdi_example_latest.json` — current month's per-province CDI + indicators for the About ADAPt example map/table (see "Monthly update" above)
- `data/cdi_archive.json` — full 1996-present CDI history for the "Recent CDI components" and "Historical CDI time series" charts
- `pipeline/PNG_CDI.rds` — the CDI pipeline's latest monthly export; committing a new one here triggers `update-cdi-data.yml`
- `scripts/update_cdi_data.py` — regenerates the two `cdi_*.json` files above from `pipeline/PNG_CDI.rds`
- `scripts/build_cdi_pixel.py` — generates the pixel-level CDI raster and patches `layers.cdi_tile_url` into `data/integrated_priority_latest.json`; runs nightly as part of `update-integrated-composite.yml`
- `data/cdi_pixel_latest.tif` — GeoTIFF export of the pixel-level CDI raster, written by `scripts/build_cdi_pixel.py`
- `pipeline/CU_reference_imputed.gpkg` — PNG NSO 2024 census-unit population estimates (static reference data, not regenerated monthly)
- `scripts/build_cdi_population_exposure.py` — samples the CDI raster at each census-unit point and aggregates population/households by province and CDI phase into `data/cdi_population_exposure.json`; runs nightly as part of `update-integrated-composite.yml`, after `build_cdi_pixel.py`
- `data/cdi_population_exposure.json` — output of the above; see "CDI-linked population exposure" note above before using or displaying these figures
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
