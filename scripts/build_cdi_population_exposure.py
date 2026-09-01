#!/usr/bin/env python3
"""
Link PNG NSO 2024 Census Unit population estimates to the pixel-level CDI
raster, aggregated by province and CDI operational phase.

This produces a population-exposure figure with a genuinely different (and
more precise) source than data/integrated_priority_latest.json's own
population exposure numbers: this one samples the CDI raster directly at
~30,000 real census-unit locations (PNG NSO 2024 population estimates,
with imputed coordinates where original ones were missing), rather than
intersecting WorldPop's gridded population surface with the composite
biophysical stress layer.

IMPORTANT: these two population figures come from different data sources
and different methodologies and must never be merged, summed, or presented
as if they were the same number or a refinement of each other. Some
correlation between them is expected and fine; treating one as a subtotal
of the other is not, and misrepresents both.

Pipeline:
  1. Read every census-unit point from the CU geopackage (Adm 1 Name,
     imputed longitude/latitude, 2024 population and household estimates).
  2. Map each Adm 1 Name (PNG NSO's own spelling/casing) to this dashboard's
     canonical province names (the same ones used throughout index.html).
  3. Sample the CDI raster (nearest-neighbour) at each point's location.
     Points that fall outside the raster's coverage (nodata -- e.g. small
     offshore islands not captured by the clipped PNG boundary used when
     the raster was exported) are counted separately, not silently dropped.
  4. Classify each sampled CDI value into the same operational phase bands
     used on the dashboard (Readiness/Anticipatory Action/Response
     threshold/Monitoring) -- see cdiOperationalPhase() in index.html. Keep
     these thresholds in sync by hand; there is no shared source of truth
     between this Python copy and the JS one.
  5. Aggregate population and household counts by province, and by
     province x phase, plus national totals.

Usage:
    python scripts/build_cdi_population_exposure.py \
        --cu-gpkg pipeline/CU_reference_imputed.gpkg \
        --cdi-raster data/cdi_pixel_latest.tif \
        --json-output data/cdi_population_exposure.json

Requires: rasterio, fiona (both pulled in by geopandas, but this script
only needs the two directly).
"""
import argparse
import json
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

import fiona
import rasterio

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_CU_GPKG = REPO_ROOT / "pipeline" / "CU_reference_imputed.gpkg"
DEFAULT_RASTER = REPO_ROOT / "data" / "cdi_pixel_latest.tif"
DEFAULT_JSON_OUTPUT = REPO_ROOT / "data" / "cdi_population_exposure.json"
DEFAULT_INTEGRATED_JSON = REPO_ROOT / "data" / "integrated_priority_latest.json"

# PNG NSO's own Adm 1 Name spelling/casing -> this dashboard's canonical
# province names (the same 22 keys used in data/cdi_example_latest.json
# and throughout index.html). Every value on the right must exactly match
# a key already used elsewhere on the dashboard.
ADM1_NAME_ALIAS = {
    "AUTONOMOUS REGION OF BOUGAINVILLE": "Bougainville",
    "CENTRAL": "Central",
    "EAST NEW BRITAIN": "East New Britain",
    "EAST SEPIK": "East Sepik",
    "EASTERN HIGHLANDS": "Eastern Highlands",
    "ENGA": "Enga",
    "GULF": "Gulf",
    "HELA": "Hela",
    "JIWAKA": "Jiwaka",
    "MADANG": "Madang",
    "MANUS": "Manus",
    "MILNE BAY": "Milne Bay",
    "MOROBE": "Morobe",
    "NATIONAL CAPITAL DISTRICT": "National Capital District",
    "NEW IRELAND": "New Ireland",
    "NORTHERN (ORO)": "Oro",
    "SIMBU": "Chimbu",
    "SOUTHERN HIGHLANDS": "Southern Highlands",
    "WEST NEW BRITAIN": "West New Britain",
    "WEST SEPIK": "Sandaun",
    "WESTERN": "Western",
    "WESTERN HIGHLANDS": "Western Highlands",
}

PHASES = ["Response threshold", "Anticipatory Action", "Readiness", "Monitoring", "No data"]


def cdi_operational_phase(cdi):
    """Mirrors cdiOperationalPhase() in index.html -- see that function's
    comment for the source (Table 1, FAO PNG Food Security & Agriculture
    Sectoral Plan, Aug 2026). Keep the two in sync by hand."""
    if cdi is None:
        return "No data"
    if cdi >= 0.8:
        return "Response threshold"
    if cdi >= 0.6:
        return "Anticipatory Action"
    if cdi >= 0.4:
        return "Readiness"
    return "Monitoring"


def read_census_units(gpkg_path: Path):
    """Yields (adm1_canonical, lon, lat, pop, hh) for every census unit,
    skipping rows whose Adm 1 Name doesn't map to a known province (prints
    a warning once per unknown name so a typo/renaming upstream is caught)."""
    unknown_names = set()
    with fiona.open(str(gpkg_path), layer="census_units") as src:
        for feat in src:
            props = feat["properties"]
            adm1_raw = (props.get("Adm 1 Name") or "").strip()
            adm1 = ADM1_NAME_ALIAS.get(adm1_raw)
            if adm1 is None:
                unknown_names.add(adm1_raw)
                continue
            lon = props.get("Longitude_Imputed")
            lat = props.get("Latitude_Imputed")
            if lon is None or lat is None:
                continue
            pop = props.get("2024 Pop Est") or 0.0
            hh = props.get("2024 HH Est") or 0.0
            yield adm1, float(lon), float(lat), float(pop), float(hh)
    if unknown_names:
        print(f"  ! Warning: {len(unknown_names)} unmapped Adm 1 Name value(s), "
              f"census units skipped: {sorted(unknown_names)}")


def sample_cdi_at_points(raster_path: Path, points):
    """points: list of (lon, lat). Returns a list of CDI values (float or
    None for nodata/out-of-coverage), same order as input."""
    results = []
    with rasterio.open(str(raster_path)) as src:
        band1 = src.read(1, masked=True)
        nodata = src.nodata
        for lon, lat in points:
            try:
                row, col = src.index(lon, lat)
            except Exception:
                results.append(None)
                continue
            if row < 0 or col < 0 or row >= band1.shape[0] or col >= band1.shape[1]:
                results.append(None)
                continue
            val = band1[row, col]
            if hasattr(val, "mask") and val.mask:
                results.append(None)
            elif nodata is not None and float(val) == float(nodata):
                results.append(None)
            else:
                results.append(float(val))
    return results


def build_exposure(cu_gpkg: Path, raster_path: Path):
    records = list(read_census_units(cu_gpkg))
    print(f"Loaded {len(records)} census units with a mapped province and coordinates.")

    points = [(lon, lat) for _, lon, lat, _, _ in records]
    cdi_values = sample_cdi_at_points(raster_path, points)

    province_stats = defaultdict(lambda: {
        "total_population": 0.0,
        "total_households": 0.0,
        "census_units": 0,
        "census_units_no_coverage": 0,
        "population_by_phase": defaultdict(float),
        "households_by_phase": defaultdict(float),
    })
    national = {
        "total_population": 0.0,
        "total_households": 0.0,
        "census_units": 0,
        "census_units_no_coverage": 0,
        "population_by_phase": defaultdict(float),
    }

    for (adm1, lon, lat, pop, hh), cdi in zip(records, cdi_values):
        phase = cdi_operational_phase(cdi)
        ps = province_stats[adm1]
        ps["total_population"] += pop
        ps["total_households"] += hh
        ps["census_units"] += 1
        ps["population_by_phase"][phase] += pop
        ps["households_by_phase"][phase] += hh
        if phase == "No data":
            ps["census_units_no_coverage"] += 1
            national["census_units_no_coverage"] += 1

        national["total_population"] += pop
        national["total_households"] += hh
        national["census_units"] += 1
        national["population_by_phase"][phase] += pop

    provinces_out = {}
    for adm1, ps in sorted(province_stats.items()):
        provinces_out[adm1] = {
            "total_population": round(ps["total_population"]),
            "total_households": round(ps["total_households"]),
            "census_units": ps["census_units"],
            "census_units_no_coverage": ps["census_units_no_coverage"],
            "population_by_phase": {p: round(ps["population_by_phase"].get(p, 0.0)) for p in PHASES},
        }

    national_out = {
        "total_population": round(national["total_population"]),
        "total_households": round(national["total_households"]),
        "census_units": national["census_units"],
        "census_units_no_coverage": national["census_units_no_coverage"],
        "population_by_phase": {p: round(national["population_by_phase"].get(p, 0.0)) for p in PHASES},
    }

    return national_out, provinces_out


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--cu-gpkg", default=str(DEFAULT_CU_GPKG), help="Path to the census-unit GeoPackage")
    parser.add_argument("--cdi-raster", default=str(DEFAULT_RASTER), help="Path to the pixel-level CDI GeoTIFF")
    parser.add_argument("--json-output", default=str(DEFAULT_JSON_OUTPUT), help="Output JSON path")
    parser.add_argument("--integrated-json", default=str(DEFAULT_INTEGRATED_JSON),
                         help="integrated_priority_latest.json, read only for the "
                              "cdi_pixel_observation_month traceability field")
    args = parser.parse_args()

    cu_path = Path(args.cu_gpkg)
    raster_path = Path(args.cdi_raster)

    if not cu_path.exists():
        raise SystemExit(f"Census unit GeoPackage not found: {cu_path}")
    if not raster_path.exists():
        raise SystemExit(
            f"CDI raster not found: {raster_path}. Run scripts/build_cdi_pixel.py "
            "with --tif-output first (this script depends on its output)."
        )

    national, provinces = build_exposure(cu_path, raster_path)

    obs_month = None
    integrated_path = Path(args.integrated_json)
    if integrated_path.exists():
        try:
            obs_month = json.loads(integrated_path.read_text(encoding="utf-8")).get("cdi_pixel_observation_month")
        except Exception:
            pass

    output = {
        "generated_utc": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
        "cdi_pixel_observation_month": obs_month,
        "source": {
            "census_units": "PNG NSO 2024 Census Unit population estimates "
                             "(pipeline/CU_reference_imputed.gpkg; imputed coordinates "
                             "used where original point coordinates were missing)",
            "cdi_raster": str(raster_path.relative_to(REPO_ROOT)) if raster_path.is_relative_to(REPO_ROOT) else str(raster_path),
        },
        "methodology_note": (
            "Population figures here are PNG NSO 2024 census-unit population estimates "
            "sampled against the pixel-level CDI raster and classified by the same "
            "operational phase bands used elsewhere on the dashboard (Table 1, FAO PNG "
            "Food Security & Agriculture Sectoral Plan, Aug 2026). This is a DIFFERENT "
            "data source and methodology from data/integrated_priority_latest.json's own "
            "population exposure figures (WorldPop intersected with the composite "
            "biophysical stress layer) -- the two must not be merged, summed, or treated "
            "as a refinement of one another."
        ),
        "national": national,
        "provinces": provinces,
    }

    out_path = Path(args.json_output)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(output, indent=2), encoding="utf-8")
    print(f"Wrote {out_path}")
    print(f"National: {national['total_population']:,.0f} people across {national['census_units']} census units "
          f"({national['census_units_no_coverage']} outside CDI raster coverage)")
    for phase in PHASES:
        print(f"  {phase}: {national['population_by_phase'][phase]:,.0f}")


if __name__ == "__main__":
    main()
