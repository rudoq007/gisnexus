import argparse
import csv
import json
import os
from datetime import datetime, timedelta
from pathlib import Path

import ee

DEFAULT_PROJECT = "trekky675"
ASIS_COLLECTION = "projects/UNFAO/ASIS/VHI-D"
CHIRPS_COLLECTION = "UCSB-CHG/CHIRPS/DAILY"
MODIS_COLLECTION = "MODIS/061/MOD11A1"
WORLDCOVER_COLLECTION = "ESA/WorldCover/v200"
WORLDPOP_COLLECTION = "WorldPop/GP/100m/pop"
CROPLAND_WEIGHT_OUTSIDE = 0.80
CROPLAND_WEIGHT_INSIDE = 1.00
HIGH_PRIORITY_THRESHOLD = 50
EXPOSED_PRIORITY_THRESHOLD = 35
CROPLAND_STRESSED_THRESHOLD = 35
WATCH_PRIORITY_THRESHOLD = 20
COUNT_HIGH_THRESHOLD = 40
COUNT_EXPOSED_THRESHOLD = 25
COUNT_WATCH_THRESHOLD = 15


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


def build_cropland_factor(cropland_mask: ee.Image) -> ee.Image:
    return (
        cropland_mask.multiply(CROPLAND_WEIGHT_INSIDE - CROPLAND_WEIGHT_OUTSIDE)
        .add(CROPLAND_WEIGHT_OUTSIDE)
        .rename("cropland_factor")
    )


def build_population_weight(population: ee.Image) -> ee.Image:
    p95 = ee.Number(
        population.reduceRegion(
            reducer=ee.Reducer.percentile([95]),
            geometry=png_geometry(),
            scale=1000,
            maxPixels=1e13,
            tileScale=4,
        ).get("population")
    )

    p95_safe = ee.Number(ee.Algorithms.If(p95, p95, 1))
    return population.divide(p95_safe).min(1).rename("population_weight")


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
    start_7 = anchor_date - timedelta(days=7)

    vhi = build_asis_vhi(asis_img)
    asis_score = build_asis_score(vhi)

    rainfall_pct = build_drought_layer(str(start_90), str(safe_end))
    rainfall_score = build_rainfall_score(rainfall_pct)

    frost_lst = build_frost_layer(str(start_7), str(anchor_date))
    frost_score = build_frost_score(frost_lst).unmask(0)

    composite_biophysical = (
        asis_score.multiply(0.45)
        .add(rainfall_score.multiply(0.35))
        .add(frost_score.multiply(0.20))
        .rename("composite_biophysical_stress")
        .clip(boundary)
    )

    cropland_mask = build_cropland_mask().clip(boundary)
    cropland_factor = build_cropland_factor(cropland_mask).clip(boundary)
    agricultural_priority = (
        composite_biophysical.multiply(cropland_factor)
        .rename("agricultural_priority")
        .clip(boundary)
    )

    worldpop = latest_worldpop_image()
    population = worldpop.select([0]).rename("population")
    population_year = worldpop.get("year").getInfo()

    population_weight = build_population_weight(population)
    exposure_priority = (
        agricultural_priority.unmask(0)
        .multiply(ee.Image.constant(0.5).add(population_weight.multiply(0.5)))
        .rename("exposure_priority")
        .clip(boundary)
    )

    # Counts are based on agricultural_priority, not exposure_priority.
    population_high_priority = population.updateMask(agricultural_priority.gte(COUNT_HIGH_THRESHOLD)).rename(
        "population_high_priority"
    )
    population_moderate_priority = population.updateMask(
        agricultural_priority.gte(COUNT_EXPOSED_THRESHOLD).And(agricultural_priority.lt(COUNT_HIGH_THRESHOLD))
    ).rename("population_moderate_priority")
    population_watch_priority = population.updateMask(
        agricultural_priority.gte(COUNT_WATCH_THRESHOLD).And(agricultural_priority.lt(COUNT_EXPOSED_THRESHOLD))
    ).rename("population_watch_priority")
    population_exposed_total = population.updateMask(agricultural_priority.gte(COUNT_EXPOSED_THRESHOLD)).rename(
        "population_exposed_total"
    )

    cropland_high_ha = ee.Image.pixelArea().divide(10000).updateMask(
        cropland_mask.eq(1).And(agricultural_priority.gte(COUNT_HIGH_THRESHOLD))
    ).rename("cropland_high_ha")
    cropland_stressed_ha = ee.Image.pixelArea().divide(10000).updateMask(
        cropland_mask.eq(1).And(agricultural_priority.gte(COUNT_EXPOSED_THRESHOLD))
    ).rename("cropland_stressed_ha")

    summary_image = ee.Image.cat(
        [
            vhi.rename("asis_vhi"),
            rainfall_pct.rename("rainfall_pct_normal"),
            frost_lst.unmask().rename("night_lst_celsius"),
            composite_biophysical.rename("composite_biophysical_stress"),
            agricultural_priority.unmask(0).rename("agricultural_priority"),
            exposure_priority.rename("exposure_priority"),
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
            "night_lst_celsius_mean": safe_round(props.get("night_lst_celsius_mean"), 1),
            "composite_biophysical_stress_mean": safe_round(props.get("composite_biophysical_stress_mean"), 1),
            "agricultural_priority_mean": safe_round(props.get("agricultural_priority_mean"), 1),
            "exposure_priority_mean": safe_round(props.get("exposure_priority_mean"), 1),
            "priority_class": classify_priority(props.get("exposure_priority_mean")),
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
        key=lambda x: (x["exposure_priority_mean"] is None, -(x["exposure_priority_mean"] or -999)),
    )

    palette = ["#1a9850", "#91cf60", "#fee08b", "#fc8d59", "#d73027", "#7f0000"]

    output = {
        "generated_utc": datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC"),
        "asis_date": asis_date,
        "drought_window": f"{start_90} to {safe_end}",
        "frost_window": f"{start_7} to {anchor_date}",
        "population_year": population_year,
        "thresholds": {
            "ranking_high_priority_threshold": HIGH_PRIORITY_THRESHOLD,
            "ranking_exposed_priority_threshold": EXPOSED_PRIORITY_THRESHOLD,
            "ranking_cropland_stressed_threshold": CROPLAND_STRESSED_THRESHOLD,
            "ranking_watch_priority_threshold": WATCH_PRIORITY_THRESHOLD,
            "count_high_threshold": COUNT_HIGH_THRESHOLD,
            "count_exposed_threshold": COUNT_EXPOSED_THRESHOLD,
            "count_watch_threshold": COUNT_WATCH_THRESHOLD,
        },
        "layers": {
            "composite_biophysical_stress_tile_url": get_tile_url(composite_biophysical, 0, 100, palette),
            "agricultural_priority_tile_url": get_tile_url(agricultural_priority.unmask(0), 0, 100, palette),
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
