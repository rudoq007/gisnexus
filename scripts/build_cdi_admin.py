#!/usr/bin/env python3
"""
District- and LLG-level summaries of the pixel-level CDI.

For each PNG NSO 2011-census district (87) and LLG (326) this computes the
area-weighted mean of data/cdi_pixel_latest.tif, its min/max, and the share of
the unit's area in Response (>=0.80) and Anticipatory Action (0.60-0.79).
The raster (~5 km) is supersampled 10x before rasterizing the polygons so
small LLGs get fractional coverage instead of all-or-nothing pixels.

Population, households, multidimensional poverty and disability come from
pipeline/llg_population_2024.csv: NSO's 2024 census-unit figures placed in
2011 LLGs. Each 2024 census LLG was split across the 2011 LLGs in proportion
to where its GPS-located census units fall. This table is static (it changes
only if NSO issues new census figures), so it is not rebuilt here.

Phase is assigned from the mean CDI with the same bands as
cdiOperationalPhase() in index.html.

Caveat (also shown on the dashboard): ENSO, IOD and the rainfall forecast flag
(50% of the weight) do not vary within a province, so differences between
districts/LLGs come from rainfall, soil moisture and vegetation only. A mean
of pixel scores is not the same as the official province CDI, which is
computed from province-average inputs.

Usage:
    python scripts/build_cdi_admin.py \
        --cdi-raster data/cdi_pixel_latest.tif \
        --json-output data/cdi_admin_latest.json \
        --district-csv data/cdi_district_latest.csv \
        --llg-csv data/cdi_llg_latest.csv

Requires: rasterio, numpy (both already installed by the workflow).
"""
import argparse
import csv
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import rasterio
from affine import Affine
from rasterio import features

REPO_ROOT = Path(__file__).resolve().parent.parent
SUPERSAMPLE = 10


def phase(cdi):
    if cdi is None:
        return "No data"
    if cdi >= 0.8:
        return "Response"
    if cdi >= 0.6:
        return "Anticipatory Action"
    if cdi >= 0.4:
        return "Readiness"
    return "Monitoring"


def zonal(geojson, raster_path):
    with rasterio.open(raster_path) as src:
        arr = src.read(1).astype("float64")
        if src.nodata is not None:
            arr[arr == src.nodata] = np.nan
        transform = src.transform
    h, w = arr.shape
    fine_t = transform * Affine.scale(1 / SUPERSAMPLE)
    fine = np.repeat(np.repeat(arr, SUPERSAMPLE, 0), SUPERSAMPLE, 1)
    feats = geojson["features"]
    ids = features.rasterize(
        ((f["geometry"], i + 1) for i, f in enumerate(feats)),
        out_shape=(h * SUPERSAMPLE, w * SUPERSAMPLE), transform=fine_t, fill=0, dtype="int32",
    )
    flat_ids = ids.ravel()
    flat_vals = fine.ravel()
    order = np.argsort(flat_ids, kind="stable")
    sorted_ids = flat_ids[order]
    bounds = np.searchsorted(sorted_ids, np.arange(1, len(feats) + 2))
    results = []
    for i in range(len(feats)):
        vals = flat_vals[order[bounds[i]:bounds[i + 1]]]
        if vals.size == 0:
            results.append({"pixel_coverage": 0.0})
            continue
        ok = ~np.isnan(vals)
        v = vals[ok]
        rec = {"pixel_coverage": round(float(ok.mean()), 3)}
        if v.size:
            rec.update(
                cdi_mean=round(float(v.mean()), 3),
                cdi_min=round(float(v.min()), 2),
                cdi_max=round(float(v.max()), 2),
                pct_area_response=round(float((v >= 0.8).mean()), 3),
                pct_area_aa=round(float(((v >= 0.6) & (v < 0.8)).mean()), 3),
            )
        results.append(rec)
    return results


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cdi-raster", default=str(REPO_ROOT / "data/cdi_pixel_latest.tif"))
    ap.add_argument("--district-geojson", default=str(REPO_ROOT / "adm2_nso_district.geojson"))
    ap.add_argument("--llg-geojson", default=str(REPO_ROOT / "adm3_nso_llg.geojson"))
    ap.add_argument("--population-csv", default=str(REPO_ROOT / "pipeline/llg_population_2024.csv"))
    ap.add_argument("--cdi-example", default=str(REPO_ROOT / "data/cdi_example_latest.json"))
    ap.add_argument("--integrated-json", default=str(REPO_ROOT / "data/integrated_priority_latest.json"))
    ap.add_argument("--json-output", default=str(REPO_ROOT / "data/cdi_admin_latest.json"))
    ap.add_argument("--district-csv", default=str(REPO_ROOT / "data/cdi_district_latest.csv"))
    ap.add_argument("--llg-csv", default=str(REPO_ROOT / "data/cdi_llg_latest.csv"))
    args = ap.parse_args()

    if not Path(args.cdi_raster).exists():
        print(f"No CDI raster at {args.cdi_raster}; skipping district/LLG build.")
        return 0

    example = json.loads(Path(args.cdi_example).read_text(encoding="utf-8"))
    prov_cdi = {k: v.get("cdi") for k, v in example.get("provinces", {}).items()}

    obs_month = None
    try:
        integ = json.loads(Path(args.integrated_json).read_text(encoding="utf-8"))
        obs_month = integ.get("cdi_pixel_observation_month") or (integ.get("layers") or {}).get("cdi_pixel_observation_month")
    except Exception:
        pass

    pop = {}
    with open(args.population_csv, encoding="utf-8") as f:
        for row in csv.DictReader(f):
            pop[row["geocode"]] = row

    pop_fields = ["population_2024", "households_2024", "pop_multidim_poverty", "pop_disability"]

    llg_gj = json.loads(Path(args.llg_geojson).read_text(encoding="utf-8"))
    dist_gj = json.loads(Path(args.district_geojson).read_text(encoding="utf-8"))

    llgs = []
    for f, z in zip(llg_gj["features"], zonal(llg_gj, args.cdi_raster)):
        p = f["properties"]
        pr = pop.get(p["geocode"], {})
        rec = {"geocode": p["geocode"], "name": p["name"], "district": p["district"],
               "district_geocode": p["district_geocode"], "province": p["province"], **z}
        rec["phase"] = phase(rec.get("cdi_mean"))
        rec["province_cdi"] = prov_cdi.get(p["province"])
        for k in pop_fields:
            rec[k] = int(float(pr.get(k) or 0))
        rec["census_2024_llgs"] = pr.get("census_2024_llgs", "")
        llgs.append(rec)

    districts = []
    for f, z in zip(dist_gj["features"], zonal(dist_gj, args.cdi_raster)):
        p = f["properties"]
        rec = {"geocode": p["geocode"], "name": p["name"], "province": p["province"], **z}
        rec["phase"] = phase(rec.get("cdi_mean"))
        rec["province_cdi"] = prov_cdi.get(p["province"])
        kids = [l for l in llgs if l["district_geocode"] == p["geocode"]]
        for k in pop_fields:
            rec[k] = sum(l[k] for l in kids)
        rec["llg_count"] = len(kids)
        rec["llgs_in_response"] = sum(l["phase"] == "Response" for l in kids)
        districts.append(rec)

    def summary(rows):
        out = {}
        for ph in ["Response", "Anticipatory Action", "Readiness", "Monitoring", "No data"]:
            sel = [r for r in rows if r["phase"] == ph]
            out[ph] = {"units": len(sel), "population_2024": sum(r["population_2024"] for r in sel)}
        return out

    payload = {
        "generated_utc": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
        "reporting_month_label": example.get("reporting_month_label"),
        "observation_month_label": example.get("observation_month_label"),
        "cdi_pixel_observation_month": obs_month,
        "source": {
            "cdi_raster": "data/cdi_pixel_latest.tif",
            "boundaries": "PNG NSO 2011 census districts (87) and LLGs (326)",
            "population": "PNG NSO 2024 census-unit population reference (file dated 2026-11-05), placed in 2011 LLGs by located census units",
        },
        "methodology_note": (
            "Area-weighted mean of the pixel-level CDI within each district/LLG. Phase from the mean CDI "
            "(Response >=0.80, Anticipatory Action 0.60-0.79). ENSO, IOD and the rainfall forecast flag "
            "(50% of the weight) do not vary within a province, so differences between districts/LLGs come "
            "from rainfall, soil moisture and vegetation. A district/LLG mean is not the official province "
            "CDI, which is computed from province-average inputs. Population is the total living in the unit."
        ),
        "summary": {"districts": summary(districts), "llgs": summary(llgs)},
        "districts": districts,
        "llgs": llgs,
    }
    Path(args.json_output).write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    def write_csv(path, rows, cols):
        with open(path, "w", newline="", encoding="utf-8") as f:
            wr = csv.DictWriter(f, fieldnames=cols, extrasaction="ignore")
            wr.writeheader()
            for r in rows:
                wr.writerow(r)

    base = ["cdi_mean", "cdi_min", "cdi_max", "phase", "pct_area_response", "pct_area_aa",
            "pixel_coverage", "province_cdi"] + pop_fields
    write_csv(args.district_csv, districts, ["province", "name", "geocode"] + base + ["llg_count", "llgs_in_response"])
    write_csv(args.llg_csv, llgs, ["province", "district", "name", "geocode"] + base + ["census_2024_llgs"])

    s = payload["summary"]
    print(f"Districts in Response: {s['districts']['Response']['units']} of {len(districts)}; "
          f"LLGs in Response: {s['llgs']['Response']['units']} of {len(llgs)} "
          f"({s['llgs']['Response']['population_2024']:,} people)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
