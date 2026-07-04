import json
import os
from datetime import datetime, timezone
from pathlib import Path

import ee

ASIS_COLLECTION_ID = "projects/UNFAO/ASIS/VHI-D"
PROJECT_ID = os.getenv("EARTHENGINE_PROJECT", "trekky675")
OUT = Path("data/asis_vhi_latest.json")


def initialise_ee():
    service_account = os.getenv("EE_SERVICE_ACCOUNT_EMAIL")
    key_file = os.getenv("GOOGLE_APPLICATION_CREDENTIALS")
    if service_account and key_file:
        credentials = ee.ServiceAccountCredentials(service_account, key_file=key_file)
        ee.Initialize(credentials, project=PROJECT_ID)
    else:
        ee.Initialize(project=PROJECT_ID)


def png_provinces():
    return ee.FeatureCollection("FAO/GAUL/2015/level1").filter(
        ee.Filter.eq("ADM0_NAME", "Papua New Guinea")
    )


def mask_asis_flags(image):
    mask = image.neq(251).And(image.neq(252)).And(image.neq(253)).And(image.neq(254))
    return image.updateMask(mask)


def classify(value):
    if value is None:
        return "No ASIS VHI-D data"
    if value < 0.35:
        return "High vegetation stress"
    if value < 0.50:
        return "Moderate vegetation stress"
    if value < 0.65:
        return "Watch / below-normal vegetation condition"
    return "Lower current vegetation stress"


def main():
    initialise_ee()
    provinces = png_provinces()
    image = ee.Image(ee.ImageCollection(ASIS_COLLECTION_ID).sort("system:time_start", False).first())
    clean = mask_asis_flags(image).rename("asis_vhi_d")
    metadata = image.toDictionary([
        "DEKAD_year",
        "DEKAD_month",
        "DEKAD_dekadAlt",
        "system:time_start",
        "system:time_end",
    ]).getInfo()

    dekad_label = f"{metadata.get('DEKAD_year')}-{metadata.get('DEKAD_month')}-D{metadata.get('DEKAD_dekadAlt')}"
    tile_url = clean.getMapId({"min": 0, "max": 1, "palette": ["662A00", "D8D8D8", "E5FFCC", "006633"]})["tile_fetcher"].url_format

    stats = clean.reduceRegions(
        collection=provinces,
        reducer=ee.Reducer.mean(),
        scale=clean.projection().nominalScale(),
        tileScale=4,
    ).getInfo()

    rows = []
    for feature in stats.get("features", []):
        props = feature.get("properties", {})
        mean = props.get("mean")
        rows.append({
            "province": props.get("ADM1_NAME", "Unknown"),
            "mean": round(mean, 4) if mean is not None else None,
            "interpretation": classify(mean),
        })
    rows.sort(key=lambda r: 999 if r["mean"] is None else r["mean"])

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({
        "source": ASIS_COLLECTION_ID,
        "generated_utc": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
        "dekad_label": dekad_label,
        "metadata": metadata,
        "tile_url": tile_url,
        "provinces": rows,
        "flag_values_masked": [251, 252, 253, 254],
    }, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
