#!/usr/bin/env python3
"""
Pixel-level Combined Drought Index (CDI) for Papua New Guinea.

Reuses this repo's proven, already-authenticated Earth Engine pipeline --
the same service-account auth, PNG boundary, and GeoTIFF export pattern as
build_integrated_composite.py / build_asis_live.py -- instead of a
standalone Code Editor script. That is what actually fixes the
"ImageCollection asset 'projects/UNFAO/ASIS/VHI-D' not found (does not
have access)" error hit when running pipeline/gee_cdi_pixel.js by hand:
that error was an AUTH-CONTEXT problem (an interactive Code Editor session
has no access to this project's assets), not a wrong collection ID -- the
ID is confirmed correct and working in build_asis_live.py under this
repo's service account / Cloud Project trekky675.

Implements the EXACT formula and thresholds from the CDI pipeline's
do_CDI.R (Josh Hooker / FAORAP), applied per-pixel instead of per-province
mean:

    CDI = 0.20*ENSO + 0.10*IOD + 0.20*rain_flag
        + 0.20*SM_flag + 0.10*VI_flag + 0.20*forecast_flag

ENSO and IOD are national scalars, not spatial layers (do_CDI.R applies
the same NOAA-derived flag to every province) -- this script reads them
automatically from data/cdi_example_latest.json, which
scripts/update_cdi_data.py already writes each month from PNG_CDI.rds.
Nothing about ENSO/IOD needs to be hand-edited here.

Rainfall (SPI-1) and soil moisture use CALENDAR-MONTH windows keyed to the
CDI pipeline's own observation month -- this is deliberately different
from build_integrated_composite.py's rolling 90-day/30-day windows, which
measure a related but distinct "composite biophysical stress", not CDI.
See README's "Data timing convention". The observation month is read
automatically from cdi_example_latest.json's observation_month_label
(e.g. "July 2026") unless overridden with --obs-year/--obs-month.

Forecast SPI-3 (ECMWF SEAS5 seasonal rainfall) is NOT in Earth Engine's
public data catalog, so it can't be computed per-pixel the way rain/SM/VI
are. Unlike ENSO/IOD it is NOT a national scalar -- do_CDI.R computes a
distinct SPI-3 forecast per province -- so instead of one placeholder
constant for the whole country, this script rasterizes each province's own
forecast flag (already sitting in cdi_example_latest.json's per-province
"fcast3" field, computed the same way as ENSO/IOD/rain/SM/VI) onto this
