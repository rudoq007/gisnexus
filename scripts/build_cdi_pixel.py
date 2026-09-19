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
script's own 22-province polygons via build_forecast_flag_image() -- see
province_collection() below, which uses PNG's real 22-province boundary
(with Hela and Jiwaka as their own polygons) rather than
FAO/GAUL/2015/level1. This is what actually made the pixel-level map
disagree with the "About ADAPt" example map's per-province colors -- see
that function's docstring for --forecast-flag's new, narrower meaning (a
fallback, not the value used everywhere).

Meant to run as an extra step in .github/workflows/update-integrated-composite.yml,
immediately after build_integrated_composite.py and before that workflow's
commit step -- it PATCHES the JSON that script just wrote (adding
layers.cdi_tile_url) rather than duplicating the whole file, so the field
survives that workflow's nightly full rewrite instead of being wiped by it.

Usage:
    python scripts/build_cdi_pixel.py \
        --json-output data/integrated_priority_latest.json \
        --tif-output data/cdi_pixel_latest.tif

Requires: earthengine-api, plus the same GOOGLE_APPLICATION_CREDENTIALS /
EARTHENGINE_PROJECT environment used by the other pipeline scripts.
"""
import argparse
import calendar
import json
import os
import re
import time
import urllib.request
from pathlib import Path

import ee

DEFAULT_PROJECT = "trekky675"
ASIS_COLLECTION = "projects/UNFAO/ASIS/VHI-D"
CHIRPS_COLLECTION = "UCSB-CHG/CHIRPS/DAILY"
ERA5_LAND_COLLECTION = "ECMWF/ERA5_LAND/MONTHLY_AGGR"
SOIL_MOISTURE_BAND = "volumetric_soil_water_layer_1"

# Long climatology baseline for the SPI-1 / soil-moisture anomaly history.
CLIM_START_YEAR = 1991

CDI_PALETTE = ["313695", "74add1", "abd9e9", "e0f3f8", "fdae61", "f46d43", "a50026"]

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_JSON_OUTPUT = REPO_ROOT / "data" / "integrated_priority_latest.json"
DEFAULT_EXAMPLE_PATH = REPO_ROOT / "data" / "cdi_example_latest.json"
PROVINCE_BOUNDARY_GEOJSON = REPO_ROOT / "pipeline" / "png_adm1_22province.geojson"

MONTH_NAME_TO_NUM = {name: num for num, name in enumerate(calendar.month_name) if name}


def initialise_earth_engine() -> str:
    creds_path = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")
    if not creds_path or not Path(creds_path).exists():
        raise RuntimeError(
            "GOOGLE_APPLICATION_CREDENTIALS is not set or the credential file does not exist."
        )
    with open(creds_path, "r", encoding="utf-8") as f:
        info = json.load(f)
    project_id = os.environ.get("EARTHENGINE_PROJECT") or info.get("project_id") or DEFAULT_PROJECT
    credentials = ee.ServiceAccountCredentials(info["client_email"], creds_path)
    ee.Initialize(credentials, project=project_id)
    return project_id


def png_geometry():
    return (
        ee.FeatureCollection("USDOS/LSIB_SIMPLE/2017")
        .filter(ee.Filter.eq("country_na", "Papua New Guinea"))
        .geometry()
    )


_province_fc_cache = None


def province_collection():
    """PNG's real 22 provinces (PNG NSO boundary, including Hela and Jiwaka
    as their own polygons), not FAO/GAUL/2015/level1 -- GAUL 2015 predates
    PNG's 2012 Hela/Jiwaka split and only has 20. Loaded from a local
    GeoJSON (pipeline/png_adm1_22province.geojson -- the same boundary the
    front-end map renders, simplified to ~1km vertex tolerance here since
    this script's raster is exported at 5km anyway) and built as a
    client-side ee.FeatureCollection, so no persistent EE asset upload is
    needed. Every feature's ADM1_NAME is already the SAME canonical name
    cdi_example_latest.json/cdi_archive.json use, so no alias table is
    needed to match them (see build_forecast_flag_image() below)."""
    global _province_fc_cache
    if _province_fc_cache is not None:
        return _province_fc_cache
    with open(PROVINCE_BOUNDARY_GEOJSON, encoding="utf-8") as f:
        geojson = json.load(f)
    features = [
        ee.Feature(ee.Geometry(feat["geometry"]), {"ADM1_NAME": feat["properties"]["ADM1_NAME"]})
        for feat in geojson["features"]
    ]
    _province_fc_cache = ee.FeatureCollection(features)
    return _province_fc_cache


def latest_asis_image():
    collection = ee.ImageCollection(ASIS_COLLECTION)
    if collection.size().getInfo() == 0:
        raise RuntimeError(f"No images found in {ASIS_COLLECTION}")
    return ee.Image(collection.sort("system:time_start", False).first())


def build_asis_vhi(latest_img: ee.Image, boundary) -> ee.Image:
    raw = latest_img.select([0]).rename("asis_raw")
    scaled = raw.where(raw.gt(1), raw.divide(100))
    return scaled.updateMask(scaled.gte(0).And(scaled.lte(1))).rename("VHI").clip(boundary)


def read_enso_iod_and_month(example_path: Path):
    """Returns (enso, iod, obs_year, obs_month, provinces) read from
    cdi_example_latest.json. `provinces` is the raw per-province dict (each
    record has cdi/enso/iod/rain/sm/vi/fcast3) -- returned here too, rather
    than re-parsed elsewhere, so build_forecast_flag_image() reads the exact
    same fcast3 values as the ENSO/IOD flags above, from one file read."""
    if not example_path.exists():
        raise RuntimeError(
            f"{example_path} not found -- run scripts/update_cdi_data.py first. This "
            "script reads this month's ENSO/IOD flags and observation month from that "
            "file rather than re-deriving them."
        )
    data = json.loads(example_path.read_text(encoding="utf-8"))
    provinces = data.get("provinces", {})
    if not provinces:
        raise RuntimeError(f"{example_path} has no province data.")

    enso_vals = {round(p["enso"], 3) for p in provinces.values()}
    iod_vals = {round(p["iod"], 3) for p in provinces.values()}
    if len(enso_vals) > 1 or len(iod_vals) > 1:
        print(
            f"  ! Warning: ENSO/IOD are not uniform across provinces in {example_path.name} "
            f"(enso={enso_vals}, iod={iod_vals}) -- expected one national scalar each. "
            "Using the first province's values."
        )
    first = next(iter(provinces.values()))
    enso, iod = float(first["enso"]), float(first["iod"])

    label = data.get("observation_month_label", "")
    match = re.match(r"([A-Za-z]+)\s+(\d{4})", label)
    if not match or match.group(1) not in MONTH_NAME_TO_NUM:
        raise RuntimeError(
            f"Could not parse observation_month_label={label!r} from {example_path}. "
            "Pass --obs-year/--obs-month explicitly to override."
        )
    obs_month = MONTH_NAME_TO_NUM[match.group(1)]
    obs_year = int(match.group(2))
    return enso, iod, obs_year, obs_month, provinces


def fcast3_to_flag(value: float) -> float:
    """Mirrors index.html's cdiExampleFlag(value, 0, -1, 'below') exactly --
    the same thresholds do_CDI.R and the front-end's Forecast (SPI-3) row
    both use -- so the flag baked into this pixel raster always matches what
    a user sees for that province in the "About ADAPt" example map's popup."""
    if value < -1:
        return 1.0
    if value < 0:
        return 0.5
    return 0.0


def build_forecast_flag_image(example_provinces: dict, boundary, fallback_flag: float):
    """Per-province forecast-SPI3 flag, rasterized onto this script's own
    22-province polygons (see province_collection()) -- replaces the old
    single ee.Image.constant(placeholder) with each province's own flag,
    since (unlike ENSO/IOD) do_CDI.R computes a distinct SPI-3 forecast per
    province rather than one national scalar. This was the actual source of
    the pixel-vs-province-map disagreement: the placeholder always
    contributed 0 of this term's 20% weight, while the official per-province
    CDI used each province's real (often strongly negative, "Declared")
    forecast flag.

    Now that province_collection() has real Hela and Jiwaka polygons (not
    FAO/GAUL/2015/level1, which predates their 2012 split), every province
    name here matches a cdi_example_latest.json key directly -- Hela and
    Jiwaka get their own real fcast3-derived flag instead of inheriting
    Southern Highlands' / Western Highlands' the way they used to.

    fallback_flag (the old --forecast-flag CLI default, still 0/neutral) is
    now used only for a province name that fails to resolve to a
    cdi_example_latest.json entry at all -- should not happen since both
    files share the same canonical 22 names, but a fallback keeps this
    non-blocking layer from hard-failing the whole workflow step over one
    bad match.
    """
    province_names = province_collection().aggregate_array("ADM1_NAME").getInfo()
    flag_by_province = {}
    unmatched = []
    for name in province_names:
        record = example_provinces.get(name)
        if record is None or "fcast3" not in record:
            unmatched.append(name)
            flag_by_province[name] = fallback_flag
        else:
            flag_by_province[name] = fcast3_to_flag(float(record["fcast3"]))
    if unmatched:
        print(
            f"  ! Warning: no fcast3 value for province(s) {unmatched} in "
            f"cdi_example_latest.json -- using fallback flag {fallback_flag} there. "
            "An unexpected name here means pipeline/png_adm1_22province.geojson's "
            "ADM1_NAME values no longer match cdi_example_latest.json's province keys."
        )

    flag_dict = ee.Dictionary(flag_by_province)
    painted = province_collection().map(
        lambda f: f.set("forecast_flag", flag_dict.get(f.get("ADM1_NAME"), fallback_flag))
    )
    return (
        painted.reduceToImage(properties=["forecast_flag"], reducer=ee.Reducer.first())
        .unmask(fallback_flag)
        .clip(boundary)
        .rename("forecast_flag")
    )


def month_bounds(year: int, month: int):
    start = ee.Date.fromYMD(year, month, 1)
    end = start.advance(1, "month")
    return start, end


def flag_below(image: ee.Image, alert_threshold: float, declared_threshold: float) -> ee.Image:
    """Mirrors do_CDI.R: ifelse(x >= alert, 0, ifelse(x >= declared, 0.5, 1))"""
    return image.expression(
        "x >= alert ? 0 : (x >= declared ? 0.5 : 1)",
        {"x": image, "alert": alert_threshold, "declared": declared_threshold},
    )


def build_rainfall_flag(obs_year: int, obs_month: int, boundary) -> ee.Image:
    """SPI-1 approximation: empirical z-score of the observation month's CHIRPS
    total against the same calendar month's history back to CLIM_START_YEAR.
    A true Gamma-fitted SPI needs a per-pixel distribution fit Earth Engine has
    no built-in reducer for -- this is the same documented operational
    shortcut as pipeline/gee_cdi_pixel.js, now just running under this repo's
    authenticated service account instead of an interactive Code Editor
    session. Validate at the 0 / -0.5 flag boundaries against
    PNG_rain_CHIRPS.rds for a few provinces before treating as exact."""
    chirps = ee.ImageCollection(CHIRPS_COLLECTION).select("precipitation")
    start, end = month_bounds(obs_year, obs_month)
    current = chirps.filterDate(start, end).sum()

    hist_years = ee.List.sequence(CLIM_START_YEAR, obs_year - 1)
    hist_totals = ee.ImageCollection.fromImages(
        hist_years.map(
            lambda y: chirps.filterDate(
                ee.Date.fromYMD(y, obs_month, 1),
                ee.Date.fromYMD(y, obs_month, 1).advance(1, "month"),
            ).sum().set("year", y)
        )
    )
    hist_mean = hist_totals.mean()
    hist_std = hist_totals.reduce(ee.Reducer.stdDev())
    spi1 = current.subtract(hist_mean).divide(hist_std).rename("SPI1").clip(boundary)
    return flag_below(spi1, 0, -0.5)


def build_soil_moisture_flag(obs_year: int, obs_month: int, boundary) -> ee.Image:
    """Percent-departure anomaly, matching do_CDI.R's own raw-percent SM
    thresholds (-5 / -15) directly -- no z-score conversion needed since
    those thresholds are already framed in percent-departure terms.
    Validate against PNG_SM_ERA5.rds before treating as exact -- the R
    pipeline's own SM anomaly formula wasn't included in the source seen."""
    era5 = ee.ImageCollection(ERA5_LAND_COLLECTION).select(SOIL_MOISTURE_BAND)
    start, end = month_bounds(obs_year, obs_month)
    current = ee.Image(era5.filterDate(start, end).first())

    hist_years = ee.List.sequence(CLIM_START_YEAR, obs_year - 1)
    hist_imgs = ee.ImageCollection.fromImages(
        hist_years.map(
            lambda y: ee.Image(
                era5.filterDate(
                    ee.Date.fromYMD(y, obs_month, 1),
                    ee.Date.fromYMD(y, obs_month, 1).advance(1, "month"),
                ).first()
            ).set("year", y)
        )
    )
    clim_mean = hist_imgs.mean()
    sm_pct = current.subtract(clim_mean).divide(clim_mean).multiply(100).rename("SM_pct").clip(boundary)
    return flag_below(sm_pct, -5, -15)


def get_tile_url(image: ee.Image, min_val: float, max_val: float, palette: list) -> str:
    return image.getMapId({"min": min_val, "max": max_val, "palette": palette})["tile_fetcher"].url_format


def export_geotiff(image: ee.Image, boundary, output_path: Path, scale: int = 5000) -> None:
    """Same synchronous getDownloadURL() approach -- and the same hard-won
    scale lesson -- as build_integrated_composite.py's
    export_composite_geotiff(): scale=1000 times out server-side after
    ~4.5 min regardless of client timeout; scale=5000 (5km) completes
    synchronously. See that function's docstring for the full explanation."""
    last_exc = None
    for attempt in range(1, 4):
        try:
            url = image.getDownloadURL(
                {"region": boundary, "scale": scale, "format": "GEO_TIFF", "crs": "EPSG:4326"}
            )
            req = urllib.request.Request(url, headers={"User-Agent": "gisnexus-cdi-pixel-builder"})
            with urllib.request.urlopen(req, timeout=300) as resp:
                data = resp.read()
            output_path.parent.mkdir(parents=True, exist_ok=True)
            output_path.write_bytes(data)
            return
        except Exception as exc:  # noqa: BLE001 - deliberately broad: retry any transient network/EE error
            last_exc = exc
            print(f"  ! GeoTIFF export attempt {attempt}/3 failed: {exc}")
            if attempt < 3:
                time.sleep(15)
    raise RuntimeError("CDI raster GeoTIFF export failed after 3 attempts") from last_exc


def build_cdi_image(obs_year: int, obs_month: int, enso: float, iod: float, forecast_flag_image, boundary):
    vhi = build_asis_vhi(latest_asis_image(), boundary)
    vi_flag = flag_below(vhi, 0.4, 0.3)
    rain_flag = build_rainfall_flag(obs_year, obs_month, boundary)
    sm_flag = build_soil_moisture_flag(obs_year, obs_month, boundary)
    enso_img = ee.Image.constant(enso).clip(boundary)
    iod_img = ee.Image.constant(iod).clip(boundary)

    return (
        enso_img.multiply(0.20)
        .add(iod_img.multiply(0.10))
        .add(rain_flag.multiply(0.20))
        .add(sm_flag.multiply(0.20))
        .add(vi_flag.multiply(0.10))
        .add(forecast_flag_image.multiply(0.20))
        .rename("CDI")
        .clip(boundary)
    )


def patch_json_output(json_path: Path, tile_url: str, obs_year: int, obs_month: int):
    if not json_path.exists():
        raise RuntimeError(
            f"{json_path} not found -- run build_integrated_composite.py first. "
            "This script patches its output rather than duplicating it, so it must "
            "run after that script in the same workflow."
        )
    data = json.loads(json_path.read_text(encoding="utf-8"))
    layers = data.setdefault("layers", {})
    layers["cdi_tile_url"] = tile_url
    data["cdi_pixel_observation_month"] = f"{obs_year:04d}-{obs_month:02d}"
    json_path.write_text(json.dumps(data, indent=2), encoding="utf-8")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument(
        "--json-output", default=str(DEFAULT_JSON_OUTPUT),
        help="JSON file to patch with layers.cdi_tile_url (default: data/integrated_priority_latest.json, "
        "the same file build_integrated_composite.py just wrote)",
    )
    parser.add_argument(
        "--tif-output", default=None,
        help="Optional path to also export the CDI raster as a GeoTIFF, e.g. data/cdi_pixel_latest.tif",
    )
    parser.add_argument(
        "--example-json", default=str(DEFAULT_EXAMPLE_PATH),
        help="Path to cdi_example_latest.json to read this month's ENSO/IOD flags and observation "
        "month from (default: data/cdi_example_latest.json)",
    )
    parser.add_argument("--obs-year", type=int, default=None, help="Override the observation year (normally auto-read)")
    parser.add_argument("--obs-month", type=int, default=None, help="Override the observation month 1-12 (normally auto-read)")
    parser.add_argument(
        "--forecast-flag", type=float, default=0.0,
        help="Fallback forecast SPI-3 flag (0/0.5/1) used only for a province name that "
        "fails to match cdi_example_latest.json's per-province fcast3 values (see "
        "build_forecast_flag_image) -- NOT the value used everywhere, as it was before. "
        "Default 0 (neutral).",
    )
    args = parser.parse_args()

    enso, iod, auto_year, auto_month, example_provinces = read_enso_iod_and_month(Path(args.example_json))
    obs_year = args.obs_year if args.obs_year is not None else auto_year
    obs_month = args.obs_month if args.obs_month is not None else auto_month

    print(
        f"Observation month: {obs_year}-{obs_month:02d} | ENSO flag={enso} | IOD flag={iod} | "
        f"forecast flag=per-province from cdi_example_latest.json (fallback={args.forecast_flag})"
    )

    initialise_earth_engine()
    boundary = png_geometry()

    forecast_flag_image = build_forecast_flag_image(example_provinces, boundary, args.forecast_flag)
    cdi = build_cdi_image(obs_year, obs_month, enso, iod, forecast_flag_image, boundary)

    print("Validating against province means (compare with PNG_CDI_summary CSV)...")
    province_means = cdi.reduceRegions(collection=province_collection(), reducer=ee.Reducer.mean(), scale=5000)
    for feature in province_means.getInfo().get("features", []):
        props = feature["properties"]
        mean_val = props.get("mean")
        print(f"  {props.get('ADM1_NAME')}: {round(mean_val, 3) if mean_val is not None else 'no data'}")

    tile_url = get_tile_url(cdi, 0, 1, CDI_PALETTE)
    patch_json_output(Path(args.json_output), tile_url, obs_year, obs_month)
    print(f"Patched {args.json_output} with layers.cdi_tile_url")

    if args.tif_output:
        tif_path = Path(args.tif_output)
        export_geotiff(cdi, boundary, tif_path)
        print(f"Wrote {tif_path}")


if __name__ == "__main__":
    main()
