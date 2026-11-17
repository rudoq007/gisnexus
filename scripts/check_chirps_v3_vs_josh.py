#!/usr/bin/env python3
"""One-off check: do the Earth Engine CHIRPS v3 daily collections reproduce the
province rainfall totals Josh Hooker computes from the CHIRPS v3 monthly tifs?

Josh's file (summed_adm1_chirps3.csv) holds, per province and month, the SUM of
the CHIRPS v3 monthly rainfall (mm) over every pixel in the province. Pixel sums
depend on how border pixels are counted, so the absolute numbers will not match
exactly. What matters is whether the Earth Engine / Josh RATIO is steady across
months for each province. A steady ratio means the same rainfall data; a ratio
that moves from month to month means the two sources differ.

Writes a CSV and prints a readable summary. Does not touch any repo data.
Usage:
  python scripts/check_chirps_v3_vs_josh.py --josh-csv pipeline/summed_adm1_chirps3.csv \
      --output chirps_v3_check.csv
"""
import argparse
import csv
import re
import statistics
from pathlib import Path

import ee

import build_cdi_pixel as b  # reuses initialise_earth_engine / province_collection

COLLECTIONS = {
    "V3_DAILY_SAT": "UCSB-CHC/CHIRPS/V3/DAILY_SAT",
    "V3_DAILY_RNL": "UCSB-CHC/CHIRPS/V3/DAILY_RNL",
    "V2_DAILY": "UCSB-CHG/CHIRPS/DAILY",
}


def read_josh(path):
    """-> {(year, month): {province: total_mm_sum}}"""
    out = {}
    with open(path, newline="", encoding="utf-8") as f:
        rows = list(csv.reader(f))
    names = rows[0][1:]
    for row in rows[1:]:
        if not row or not row[0]:
            continue
        m = re.search(r"(\d{4})\.(\d{2})", row[0])
        if not m:
            continue
        out[(int(m.group(1)), int(m.group(2)))] = {
            n: float(v) for n, v in zip(names, row[1:]) if v not in ("", "NA")
        }
    return out


def ee_province_sums(coll_id, year, month):
    """-> {province: (sum_mm, pixel_count, n_images)} for one month of daily CHIRPS."""
    start, end = b.month_bounds(year, month)
    coll = ee.ImageCollection(coll_id).filterDate(start, end).select("precipitation")
    n_images = coll.size().getInfo()
    if n_images == 0:
        return {}, 0
    proj = coll.first().projection()
    img = coll.sum()
    red = ee.Reducer.sum().combine(ee.Reducer.count(), sharedInputs=True)
    fc = img.reduceRegions(collection=b.province_collection(), reducer=red, crs=proj)
    res = {}
    for feat in fc.getInfo()["features"]:
        p = feat["properties"]
        res[p["ADM1_NAME"]] = (p.get("sum"), p.get("count"))
    return res, n_images


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--josh-csv", required=True)
    ap.add_argument("--output", default="chirps_v3_check.csv")
    args = ap.parse_args()

    b.initialise_earth_engine()
    josh = read_josh(args.josh_csv)
    months = sorted(josh)
    print("Josh months:", ", ".join(f"{y}-{m:02d}" for y, m in months))

    rows = []
    for key, coll_id in COLLECTIONS.items():
        per_prov = {}
        for (y, m) in months:
            sums, n_img = ee_province_sums(coll_id, y, m)
            print(f"{key} {y}-{m:02d}: {n_img} daily images, {len(sums)} provinces")
            for prov, jv in josh[(y, m)].items():
                if prov in sums and sums[prov][0] is not None and jv:
                    ee_sum, cnt = sums[prov]
                    ratio = ee_sum / jv
                    rows.append([key, f"{y}-{m:02d}", prov, round(jv, 1), round(ee_sum, 1), cnt, round(ratio, 4)])
                    per_prov.setdefault(prov, []).append(ratio)
        # summary per collection
        spreads, medians = [], []
        print(f"\n== {key}: EE sum / Josh sum, per province across {len(months)} months ==")
        print(f"{'province':<28}{'median':>8}{'min':>8}{'max':>8}{'spread%':>9}")
        for prov in sorted(per_prov):
            r = per_prov[prov]
            if len(r) < 2:
                continue
            med = statistics.median(r)
            spread = (max(r) - min(r)) / med * 100
            spreads.append(spread)
            medians.append(med)
            print(f"{prov:<28}{med:8.3f}{min(r):8.3f}{max(r):8.3f}{spread:9.1f}")
        if spreads:
            print(
                f"-> overall: median ratio {statistics.median(medians):.3f}; "
                f"median month-to-month spread {statistics.median(spreads):.1f}%; "
                f"worst {max(spreads):.1f}%\n"
            )

    with open(args.output, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["collection", "month", "province", "josh_sum_mm", "ee_sum_mm", "ee_pixel_count", "ee_over_josh"])
        w.writerows(rows)
    print("Wrote", args.output)


if __name__ == "__main__":
    main()
