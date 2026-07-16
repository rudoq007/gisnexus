import argparse
import csv
import json
import os
import urllib.error
import urllib.request
from datetime import datetime, timedelta
from pathlib import Path

import ee

DEFAULT_PROJECT = "trekky675"
ASIS_COLLECTION = "projects/UNFAO/ASIS/VHI-D"
CHIRPS_COLLECTION = "UCSB-CHG/CHIRPS/DAILY"
MODIS_COLLECTION = "MODIS/061/MOD11A1"
WORLDCOVER_COLLECTION = "ESA/WorldCover/v200"
WORLDPOP_COLLECTION = "WorldPop/GP/100m/pop"

# ERA5-Land reanalysis is used for soil moisture. It is a raster (gridded) product,
# so — unlike ENSO/IOD below — it can legitimately be reduced per-province.
ERA5_LAND_COLLECTION = "ECMWF/ERA5_LAND/DAILY_AGGR"
SOIL_MOISTURE_BAND = "volumetric_soil_water_layer_1"  # 0-7 cm depth

# ENSO (Nino 3.4 / ONI) and the IOD (DMI) are single national/global scalar values,
# not spatial layers, so they are NOT blended pixel-by-pixel into the composite.
# They are fetched as plain-text indices and reported as national context alongside
# the composite score. Both sources are public NOAA products; if either URL format
# changes, fetch_enso_iod_state() below degrades gracefully rather than failing the job.
ONI_URL = "https://www.cpc.ncep.noaa.gov/data/indices/oni.ascii.txt"
DMI_URL = "https://psl.noaa.gov/gcos_wgsp/Timeseries/Data/dmi.had.long.data"

COMPOSITE_HIGH_THRESHOLD = 40
COMPOSITE_EXPOSED_THRESHOLD = 25
COMPOSITE_WATCH_THRESHOLD = 15

# Composite weights. ASIS (vegetation) still carries the most weight, but soil
# moisture now takes a real share since it captures root-zone/cumulative drought
# stress that 90-day rainfall alone can miss (a province can look fine on recent
# rainfall while still running a soil-moisture deficit from a longer dry spell).
WEIGHT_ASIS = 0.35
WEIGHT_RAINFALL = 0.25
WEIGHT_SOIL_MOISTURE = 0.20
WEIGHT_FROST = 0.20


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


def province_collection():
    return (
        ee.FeatureCollection("FAO/GAUL/2015/level1")
        .filter(ee.Filter.eq("ADM0_NAME", "Papua New Guinea"))
    )


def latest_asis_image():
    collection = ee.ImageCollection(ASIS_COLLECTION)
    if collection.size().getInfo() == 0:
        raise RuntimeError(f"No images found in {ASIS_COLLECTION}")
    return ee.Image(collection.sort("system:time_start", False).first()).clip(png_geometry())


def latest_worldpop_image():
    collection = (
        ee.ImageCollection(WORLDPOP_COLLECTION)
        .filter(ee.Filter.eq("country", "PNG"))
        .sort("year", False)
    )

    if collection.size().getInfo() == 0:
        collection = ee.ImageCollection(WORLDPOP_COLLECTION).filterBounds(png_geometry()).sort("year", False)

    if collection.size().getInfo() == 0:
        raise RuntimeError(f"No images found in {WORLDPOP_COLLECTION}")

    return ee.Image(collection.first()).clip(png_geometry())


def build_asis_vhi(latest_img: ee.Image) -> ee.Image:
    raw = latest_img.select([0]).rename("asis_raw")
    scaled = raw.where(raw.gt(1), raw.divide(100))
    return scaled.updateMask(scaled.gte(0).And(scaled.lte(1))).rename("asis_vhi")


def build_asis_score(vhi: ee.Image) -> ee.Image:
    score = ee.Image.constant(0.65).subtract(vhi).divide(0.45).multiply(100)
    return score.max(0).min(100).rename("asis_score")


def build_drought_layer(start_date: str, end_date: str) -> ee.Image:
    boundary = png_geometry()
    start = datetime.strptime(start_date, "%Y-%m-%d").date()
    end = datetime.strptime(end_date, "%Y-%m-%d").date()
    days = max((end - start).days, 1)

    current_rain = (
        ee.ImageCollection(CHIRPS_COLLECTION)
        .filterDate(start_date, end_date)
        .sum()
        .clip(boundary)
    )

    baseline_rain = (
        ee.ImageCollection(CHIRPS_COLLECTION)
        .filter(ee.Filter.calendarRange(start.month, end.month, "month"))
        .filterDate("2000-01-01", "2022-12-31")
        .mean()
        .multiply(days)
        .clip(boundary)
    )

    return current_rain.divide(baseline_rain).multiply(100).rename("rainfall_pct_normal")


def build_rainfall_score(rainfall_pct: ee.Image) -> ee.Image:
    score = ee.Image.constant(100).subtract(rainfall_pct).divide(50).multiply(100)
    return score.max(0).min(100).rename("rainfall_score")


def build_soil_moisture_layer(start_date: str, end_date: str) -> ee.Image:
    """Root-zone (0-7cm) soil moisture as a percentage of its own 2000-2022
    climatological normal for the same calendar months, using ERA5-Land — the
    same 'current vs. own historical baseline' pattern used for rainfall."""
    boundary = png_geometry()
    start = datetime.strptime(start_date, "%Y-%m-%d").date()
    end = datetime.strptime(end_date, "%Y-%m-%d").date()

    era5_land = ee.ImageCollection(ERA5_LAND_COLLECTION).select(SOIL_MOISTURE_BAND)

    current_soil = era5_land.filterDate(start_date, end_date).mean().clip(boundary)

    baseline_soil = (
        era5_land
        .filter(ee.Filter.calendarRange(start.month, end.month, "month"))
        .filterDate("2000-01-01", "2022-12-31")
        .mean()
        .clip(boundary)
    )

    return current_soil.divide(baseline_soil).multiply(100).rename("soil_moisture_pct_normal")


def build_soil_moisture_score(soil_pct: ee.Image) -> ee.Image:
    # 100% of normal -> 0 (no stress); 60% of normal or lower -> 100 (max stress).
    score = ee.Image.constant(100).subtract(soil_pct).divide(40).multiply(100)
    return score.max(0).min(100).rename("soil_moisture_score")


def build_frost_layer(start_date: str, end_date: str) -> ee.Image:
    boundary = png_geometry()
    elevation = ee.Image("USGS/SRTMGL1_003").select("elevation").clip(boundary)
    highland_mask = elevation.gt(2200)

    night_lst = (
        ee.ImageCollection(MODIS_COLLECTION)
        .filterDate(start_date, end_date)
        .select("LST_Night_1km")
        .min()
        .clip(boundary)
    )

    lst_c = night_lst.multiply(0.02).subtract(273.15).rename("night_lst_celsius")
    return lst_c.updateMask(highland_mask)


def build_frost_score(lst_c: ee.Image) -> ee.Image:
    score = ee.Image.constant(5).subtract(lst_c).divide(7).multiply(100)
    return score.max(0).min(100).rename("frost_score")


def build_cropland_mask() -> ee.Image:
    worldcover = ee.ImageCollection(WORLDCOVER_COLLECTION).first()
    return ee.Image(worldcover).select("Map").eq(40).rename("cropland_mask")


def _fetch_text(url: str, timeout: int = 20) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": "gisnexus-composite-builder"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read().decode("utf-8", errors="replace")


def _classify_enso_phase(oni_value):
    if oni_value is None:
        return "Unknown"
    if oni_value >= 1.5:
        return "Strong El Nino"
    if oni_value >= 1.0:
        return "Moderate El Nino"
    if oni_value >= 0.5:
        return "Weak El Nino"
    if oni_value <= -1.5:
        return "Strong La Nina"
    if oni_value <= -1.0:
        return "Moderate La Nina"
    if oni_value <= -0.5:
        return "Weak La Nina"
    return "Neutral (ENSO-neutral)"


def _classify_iod_phase(dmi_value):
    if dmi_value is None:
        return "Unknown"
    if dmi_value >= 0.4:
        return "Positive IOD"
    if dmi_value <= -0.4:
        return "Negative IOD"
    return "Neutral IOD"


def _parse_oni(raw_text: str):
    """NOAA CPC ONI table: header row, then 'SEAS YR TOTAL ANOM' rows, one per
    running 3-month season, in chronological order. We want the last row that
    actually has a numeric ANOM value."""
    lines = [ln.strip() for ln in raw_text.splitlines() if ln.strip()]
    for line in reversed(lines[1:]):  # skip header, scan from most recent
        parts = line.split()
        if len(parts) < 4:
            continue
        try:
            season, year, _total, anom = parts[0], parts[1], parts[2], parts[3]
            return {"season": season, "year": int(year), "value": float(anom)}
        except (ValueError, IndexError):
            continue
    return None


def _parse_dmi(raw_text: str):
    """NOAA PSL DMI table: first line is 'start_year end_year', then one row per
    year: 'YEAR jan feb mar ... dec', with a large negative sentinel (e.g. -9999)
    marking months not yet available. We want the most recent non-sentinel month."""
    lines = [ln.strip() for ln in raw_text.splitlines() if ln.strip()]
    if not lines:
        return None

    month_names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

    for line in reversed(lines[1:]):
        parts = line.split()
        if len(parts) < 13:
            continue
        try:
            year = int(float(parts[0]))
        except ValueError:
            continue
        values = []
        for p in parts[1:13]:
            try:
                values.append(float(p))
            except ValueError:
                values.append(None)
        for month_idx in range(11, -1, -1):
            val = values[month_idx]
            if val is not None and val > -900:  # sentinel values are large negatives
                return {"month": month_names[month_idx], "year": year, "value": val}
    return None


def fetch_enso_iod_state() -> dict:
    """Fetch the current ENSO (ONI) and IOD (DMI) state as national context for
    the dashboard. These are single scalar indices, not spatial layers, so they
    are reported alongside the composite score rather than blended into it.
    Network calls here are isolated with try/except so a fetch failure never
    blocks the biophysical composite (GEE-based) from being generated."""
    result = {
        "oni_value": None,
        "oni_period": None,
        "enso_phase": "Unknown",
        "dmi_value": None,
        "dmi_period": None,
        "iod_phase": "Unknown",
        "source_note": (
            "ONI: NOAA CPC (cpc.ncep.noaa.gov). DMI: NOAA PSL (psl.noaa.gov). "
            "Reported as national-scale context, not a per-province input."
        ),
        "fetch_error": None,
    }

    try:
        oni = _parse_oni(_fetch_text(ONI_URL))
        if oni:
            result["oni_value"] = round(oni["value"], 2)
            result["oni_period"] = f"{oni['season']} {oni['year']}"
            result["enso_phase"] = _classify_enso_phase(oni["value"])
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        result["fetch_error"] = f"ONI fetch failed: {exc}"

    try:
        dmi = _parse_dmi(_fetch_text(DMI_URL))
        if dmi:
            result["dmi_value"] = round(dmi["value"], 2)
            result["dmi_period"] = f"{dmi['month']} {dmi['year']}"
            result["iod_phase"] = _classify_iod_phase(dmi["value"])
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        prior = result["fetch_error"]
        dmi_error = f"DMI fetch failed: {exc}"
        result["fetch_error"] = f"{prior}; {dmi_error}" if prior else dmi_error

    return result


def classify_priority(value):
    if value is None:
        return "No data"
    if value >= 80:
        return "Severe"
    if value >= 60:
        return "High"
    if value >= 40:
        return "Moderate"
    if value >= 20:
        return "Watch"
    return "Low"


def safe_round(value, ndigits=1):
    if value is None:
        return None
    return round(float(value), ndigits)


def get_tile_url(image: ee.Image, min_val: float, max_val: float, palette: list[str]) -> str:
    return image.getMapId({"min": min_val, "max": max_val, "palette": palette})["tile_fetcher"].url_format


def build_outputs():
    boundary = png_geometry()

    asis_img = latest_asis_image()
    asis_date = ee.Date(asis_img.get("system:time_start")).format("YYYY-MM-dd").getInfo()
    anchor_date = datetime.strptime(asis_date, "%Y-%m-%d").date()

    safe_end = anchor_date - timedelta(days=15)
    start_90 = safe_end - timedelta(days=90)
    start_30 = safe_end - timedelta(days=30)
    start_7 = anchor_date - timedelta(days=7)

    vhi = build_asis_vhi(asis_img)
    asis_score = build_asis_score(vhi)

    rainfall_pct = build_drought_layer(str(start_90), str(safe_end))
    rainfall_score = build_rainfall_score(rainfall_pct)

    soil_moisture_pct = build_soil_moisture_layer(str(start_30), str(safe_end))
    soil_moisture_score = build_soil_moisture_score(soil_moisture_pct)

    frost_lst = build_frost_layer(str(start_7), str(anchor_date))
    frost_score = build_frost_score(frost_lst).unmask(0)

    composite_biophysical = (
        asis_score.multiply(WEIGHT_ASIS)
        .add(rainfall_score.multiply(WEIGHT_RAINFALL))
        .add(soil_moisture_score.multiply(WEIGHT_SOIL_MOISTURE))
        .add(frost_score.multiply(WEIGHT_FROST))
        .rename("composite_biophysical_stress")
        .clip(boundary)
    )

    # ENSO/IOD are national-scale scalars, not spatial layers - fetched separately
    # and reported as context (see fetch_enso_iod_state docstring for rationale).
    enso_iod_context = fetch_enso_iod_state()

    # Keep these bands for dashboard compatibility, but they now mirror the composite-focused approach.
    agricultural_priority = composite_biophysical.rename("agricultural_priority")
    exposure_priority = composite_biophysical.rename("exposure_priority")

    worldpop = latest_worldpop_image()
    population = worldpop.select([0]).rename("population")
    population_year = worldpop.get("year").getInfo()

    cropland_mask = build_cropland_mask().clip(boundary)

    population_high_priority = population.updateMask(composite_biophysical.gte(COMPOSITE_HIGH_THRESHOLD)).rename(
        "population_high_priority"
    )
    population_moderate_priority = population.updateMask(
        composite_biophysical.gte(COMPOSITE_EXPOSED_THRESHOLD).And(composite_biophysical.lt(COMPOSITE_HIGH_THRESHOLD))
    ).rename("population_moderate_priority")
    population_watch_priority = population.updateMask(
        composite_biophysical.gte(COMPOSITE_WATCH_THRESHOLD).And(composite_biophysical.lt(COMPOSITE_EXPOSED_THRESHOLD))
    ).rename("population_watch_priority")
    population_exposed_total = population.updateMask(composite_biophysical.gte(COMPOSITE_EXPOSED_THRESHOLD)).rename(
        "population_exposed_total"
    )

    cropland_high_ha = ee.Image.pixelArea().divide(10000).updateMask(
        cropland_mask.eq(1).And(composite_biophysical.gte(COMPOSITE_HIGH_THRESHOLD))
    ).rename("cropland_high_ha")
    cropland_stressed_ha = ee.Image.pixelArea().divide(10000).updateMask(
        cropland_mask.eq(1).And(composite_biophysical.gte(COMPOSITE_EXPOSED_THRESHOLD))
    ).rename("cropland_stressed_ha")

    summary_image = ee.Image.cat(
        [
            vhi.rename("asis_vhi"),
            rainfall_pct.rename("rainfall_pct_normal"),
            soil_moisture_pct.rename("soil_moisture_pct_normal"),
            frost_lst.unmask().rename("night_lst_celsius"),
            composite_biophysical.rename("composite_biophysical_stress"),
            agricultural_priority.unmask(0),
            exposure_priority.unmask(0),
            population_high_priority.unmask(0),
            population_moderate_priority.unmask(0),
            population_watch_priority.unmask(0),
            population_exposed_total.unmask(0),
            cropland_high_ha.unmask(0),
            cropland_stressed_ha.unmask(0),
        ]
    )

    reducer = ee.Reducer.mean().combine(reducer2=ee.Reducer.sum(), sharedInputs=True)

    fc = summary_image.reduceRegions(
        collection=province_collection(),
        reducer=reducer,
        scale=1000,
        tileScale=4,
    )

    features = fc.getInfo().get("features", [])

    provinces = []
    total_population_exposed = 0
    total_population_high = 0
    total_cropland_high = 0
    total_cropland_stressed = 0

    for feature in features:
        props = feature.get("properties", {})
        province_record = {
            "province": props.get("ADM1_NAME"),
            "asis_vhi_mean": safe_round(props.get("asis_vhi_mean"), 3),
            "rainfall_pct_normal_mean": safe_round(props.get("rainfall_pct_normal_mean"), 1),
            "soil_moisture_pct_normal_mean": safe_round(props.get("soil_moisture_pct_normal_mean"), 1),
            "night_lst_celsius_mean": safe_round(props.get("night_lst_celsius_mean"), 1),
            "composite_biophysical_stress_mean": safe_round(props.get("composite_biophysical_stress_mean"), 1),
            "agricultural_priority_mean": safe_round(props.get("agricultural_priority_mean"), 1),
            "exposure_priority_mean": safe_round(props.get("exposure_priority_mean"), 1),
            "priority_class": classify_priority(props.get("composite_biophysical_stress_mean")),
            "population_high_priority": safe_round(props.get("population_high_priority_sum"), 0),
            "population_moderate_priority": safe_round(props.get("population_moderate_priority_sum"), 0),
            "population_watch_priority": safe_round(props.get("population_watch_priority_sum"), 0),
            "population_exposed_total": safe_round(props.get("population_exposed_total_sum"), 0),
            "cropland_high_ha": safe_round(props.get("cropland_high_ha_sum"), 0),
            "cropland_stressed_ha": safe_round(props.get("cropland_stressed_ha_sum"), 0),
        }
        provinces.append(province_record)

        total_population_exposed += province_record["population_exposed_total"] or 0
        total_population_high += province_record["population_high_priority"] or 0
        total_cropland_high += province_record["cropland_high_ha"] or 0
        total_cropland_stressed += province_record["cropland_stressed_ha"] or 0

    provinces = sorted(
        provinces,
        key=lambda x: (x["composite_biophysical_stress_mean"] is None, -(x["composite_biophysical_stress_mean"] or -999)),
    )

    palette = ["#1a9850", "#91cf60", "#fee08b", "#fc8d59", "#d73027", "#7f0000"]

    output = {
        "generated_utc": datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC"),
        "asis_date": asis_date,
        "drought_window": f"{start_90} to {safe_end}",
        "frost_window": f"{start_7} to {anchor_date}",
        "population_year": population_year,
        "thresholds": {
            "composite_high_threshold": COMPOSITE_HIGH_THRESHOLD,
            "composite_exposed_threshold": COMPOSITE_EXPOSED_THRESHOLD,
            "composite_watch_threshold": COMPOSITE_WATCH_THRESHOLD,
        },
        "composite_weights": {
            "asis": WEIGHT_ASIS,
            "rainfall": WEIGHT_RAINFALL,
            "soil_moisture": WEIGHT_SOIL_MOISTURE,
            "frost": WEIGHT_FROST,
        },
        "enso_iod_context": enso_iod_context,
        "layers": {
            "composite_biophysical_stress_tile_url": get_tile_url(composite_biophysical, 0, 100, palette),
            "agricultural_priority_tile_url": get_tile_url(agricultural_priority, 0, 100, palette),
            "exposure_priority_tile_url": get_tile_url(exposure_priority, 0, 100, palette),
        },
        "national_summary": {
            "total_population_exposed": total_population_exposed,
            "total_population_high_priority": total_population_high,
            "total_cropland_high_ha": total_cropland_high,
            "total_cropland_stressed_ha": total_cropland_stressed,
            "top_5_provinces_by_exposure_priority": [p["province"] for p in provinces[:5]],
        },
        "provinces": provinces,
    }

    return output


def write_csv(rows, output_path: Path):
    output_path.parent.mkdir(parents=True, exist_ok=True)
    fieldnames = [
        "province",
        "asis_vhi_mean",
        "rainfall_pct_normal_mean",
        "soil_moisture_pct_normal_mean",
        "night_lst_celsius_mean",
        "composite_biophysical_stress_mean",
        "agricultural_priority_mean",
        "exposure_priority_mean",
        "priority_class",
        "population_high_priority",
        "population_moderate_priority",
        "population_watch_priority",
        "population_exposed_total",
        "cropland_high_ha",
        "cropland_stressed_ha",
    ]

    with open(output_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for row in rows:
            writer.writerow(row)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--json-output", required=True)
    parser.add_argument("--csv-output", required=True)
    args = parser.parse_args()

    initialise_earth_engine()
    output = build_outputs()

    json_path = Path(args.json_output)
    csv_path = Path(args.csv_output)

    json_path.parent.mkdir(parents=True, exist_ok=True)
    json_path.write_text(json.dumps(output, indent=2), encoding="utf-8")
    write_csv(output["provinces"], csv_path)

    print(f"Wrote {json_path}")
    print(f"Wrote {csv_path}")


if __name__ == "__main__":
    main()
