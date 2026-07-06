# PNG El Niño ASIS/GIEWS Live Drought Dashboard

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

### 1. Overview
Provides the high-level briefing view:
- latest ASIS screening period
- national vegetation summary
- number of provinces in higher concern classes
- selected province briefing
- live drought and frost processing status
- charts for the highest-stress provinces and stress-class distribution

### 2. Interactive Map
Interactive map for visual review of current conditions.

Current map behaviour:
- **Composite biophysical stress** is the main operational raster
- **Live ASIS vegetation screening** is available as a secondary reference layer
- provincial polygons are symbolised by current integrated stress where available
- province point summaries are displayed on top for quick inspection
- popups summarise stress and exposure conditions by province

### 3. Live ASIS Drought Stress
Dedicated view for the latest FAO ASIS/GIEWS provincial screening summary.

This tab shows:
- provincial vegetation index ranking
- stress-class interpretation
- province table for ASIS screening results
- plain-language screening meaning and verification priority

### 4. Integrated Priority
This tab combines multiple indicators into a single provincial prioritisation view.

The current integrated table focuses on:
- province
- composite stress
- agricultural priority
- exposure priority
- priority class
- population exposed

### 5. Population & Exposure
Public-facing exposure tab focused on people located inside stressed zones.

This tab summarises:
- exposed population
- higher-exposure population
- number of affected provinces
- watch-level population
- province-level table linking exposure with stress and supporting indicators

### 6. Operational Response
Guidance section for how results should be interpreted and followed up.

This includes:
- response framing by stress class
- field verification checklist
- examples of what district, provincial, DAL, NARI, NDC, and partner teams may need to collect on the ground

### 7. Live Processing Workspace
Embedded and linked **Streamlit** workspace used for live technical review and processing of drought and frost layers.

### 8. EarthMap
Embedded and linked **EarthMap** environment for contextual geospatial review.

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
- integrated priority tab
- population and exposure tab
- composite map layer
- province popup content on the interactive map

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

- `index.html` — main GitHub Pages dashboard front end
- `README.md` — project documentation
- `adm1_nso_province.geojson` — PNG provincial boundaries
- `data/asis_vhi_latest.json` — latest ASIS/GIEWS update for dashboard use
- `data/integrated_priority_latest.json` — latest integrated composite stress output
- `data/integrated_priority_latest.csv` — tabular export of integrated priority results
- `data/live_processing_status.json` — linked live workspace status summary
- `.github/workflows/` — GitHub Actions workflows for automated updates and patching
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
