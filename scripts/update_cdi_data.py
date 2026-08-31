#!/usr/bin/env python3
"""
Regenerate ADAPT's CDI data files from the NWS/FAO CDI pipeline's monthly
PNG_CDI.rds export.

This replaces the old manual process (hand-editing CDI_EXAMPLE_DATA /
CDI_FULL_DATA inside index.html every month) with one command:

    python scripts/update_cdi_data.py path/to/PNG_CDI.rds

It writes/updates two files that index.html fetches at runtime:
    data/cdi_example_latest.json   -- current month's per-province CDI + indicators
    data/cdi_archive.json          -- full historical archive (1996-present) used
                                       by the "Recent CDI components" and
                                       "Historical CDI time series" charts

WHAT "LATEST" MEANS HERE (see README.md for the full explanation):
Each row in PNG_CDI.rds is keyed by its OBSERVATION month (YEAR/MONTH) and also
carries a forecast reference (fcYEAR/fcMONTH, one month ahead). The dashboard's
"Example: PNG, <month>" card reports the row using the REPORTING convention
(fcMONTH), matching how the CDI pipeline's own summary CSV is named (e.g.
PNG_CDI_summary_2026_8.csv = the row with fcMONTH=8). The historical archive
charts, however, keep every point labelled by its own raw observation month
(no shift), consistent with all prior history -- this script preserves that
same split so the two views don't drift out of sync again.

Requires: pip install rdata --break-system-packages   (pure-Python .rds reader,
no R installation needed)
"""
import argparse
import calendar
import json
import sys
from pathlib import Path

try:
    import rdata
except ImportError:
    sys.exit(
        "Missing dependency 'rdata'. Install it with:\n"
        "    pip install rdata --break-system-packages\n"
        "(or: pip install rdata)"
    )

# Rolling window length for the "Recent CDI components" chart.
RECENT_WINDOW_MONTHS = 14

REPO_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = REPO_ROOT / "data"
EXAMPLE_PATH = DATA_DIR / "cdi_example_latest.json"
ARCHIVE_PATH = DATA_DIR / "cdi_archive.json"


def month_label(year: int, month: int) -> str:
    return f"{calendar.month_name[month]} {year}"


def month_range_label(start_year: int, start_month: int, n_months: int) -> str:
    """e.g. month_range_label(2026, 8, 3) -> 'August-October 2026'"""
    end_month = start_month + n_months - 1
    end_year = start_year + (end_month - 1) // 12
    end_month = ((end_month - 1) % 12) + 1
    start_abbr = calendar.month_name[start_month]
    end_abbr = calendar.month_name[end_month]
    if start_year == end_year:
        return f"{start_abbr}-{end_abbr} {start_year}"
    return f"{start_abbr} {start_year}-{end_abbr} {end_year}"


def load_rds_last_rows(rds_path: Path):
    """Returns {province: last_row_dict} for every province in the .rds."""
    parsed = rdata.parser.parse_file(str(rds_path))
    obj = rdata.conversion.convert(parsed)
    result = {}
    for entry in obj:
        name = str(entry["name"][0])
        df = entry["data"]
        result[name] = df
    return result


def build_example_data(province_dfs: dict):
    """Per-province current-month indicator snapshot for the example map/table."""
    provinces_out = {}
    obs_year = obs_month = fc_year = fc_month = None
    for name, df in province_dfs.items():
        last = df.iloc[-1]
        if obs_year is None:
            obs_year, obs_month = int(last["YEAR"]), int(last["MONTH"])
            fc_year, fc_month = int(last["fcYEAR"]), int(last["fcMONTH"])
        provinces_out[name] = {
            "cdi": round(float(last["CDI"]), 3),
            "enso": round(float(last["ENSO"]), 3),
            "iod": round(float(last["IOD"]), 3),
            "rain": round(float(last["rain"]), 3),
            "sm": round(float(last["SM"]), 2),
            "vi": round(float(last["VI"]), 3),
            "fcast3": round(float(last["fcast3"]), 3),
        }
    return {
        "reporting_month_label": month_label(fc_year, fc_month),
        "observation_month_label": month_label(obs_year, obs_month),
        "forecast_window_label": month_range_label(fc_year, fc_month, 3),
        "provinces": provinces_out,
    }, (obs_year, obs_month)


def update_archive(province_dfs: dict, existing_archive: dict, new_month: tuple):
    """Append the new observation month to the archive if not already present."""
    year, month = new_month
    timeline = existing_archive.setdefault("timeline", [])
    cdi_history = existing_archive.setdefault("cdi_history", {})
    recent = existing_archive.setdefault("recent_indicators", {})

    already_present = timeline and timeline[-1] == [year, month]
    if already_present:
        print(f"Archive already has {month_label(year, month)} as its latest "
              f"point -- no changes made to data/cdi_archive.json.")
        return existing_archive, False

    timeline.append([year, month])

    for name, df in province_dfs.items():
        last = df.iloc[-1]
        cdi_val = round(float(last["CDI"]), 3)
        cdi_history.setdefault(name, []).append(cdi_val)

        ri = recent.setdefault(name, {
            "months": [], "enso": [], "iod": [], "rain": [], "sm": [], "vi": [], "fcast3": []
        })
        ri["months"].append([year, month])
        ri["enso"].append(round(float(last["ENSO"]), 3))
        ri["iod"].append(round(float(last["IOD"]), 3))
        ri["rain"].append(round(float(last["rain"]), 3))
        ri["sm"].append(round(float(last["SM"]), 2))
        ri["vi"].append(round(float(last["VI"]), 3))
        ri["fcast3"].append(round(float(last["fcast3"]), 3))
        for key in ("months", "enso", "iod", "rain", "sm", "vi", "fcast3"):
            if len(ri[key]) > RECENT_WINDOW_MONTHS:
                ri[key] = ri[key][-RECENT_WINDOW_MONTHS:]

    return existing_archive, True


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("rds_path", type=Path, help="Path to the monthly PNG_CDI.rds file")
    parser.add_argument("--dry-run", action="store_true", help="Print what would change without writing files")
    args = parser.parse_args()

    if not args.rds_path.exists():
        sys.exit(f"File not found: {args.rds_path}")

    province_dfs = load_rds_last_rows(args.rds_path)
    print(f"Loaded {len(province_dfs)} provinces from {args.rds_path.name}")

    example_data, new_month = build_example_data(province_dfs)
    print(f"Reporting month: {example_data['reporting_month_label']} "
          f"(observations: {example_data['observation_month_label']}, "
          f"forecast: {example_data['forecast_window_label']})")

    if ARCHIVE_PATH.exists():
        existing_archive = json.loads(ARCHIVE_PATH.read_text(encoding="utf-8"))
    else:
        existing_archive = {"timeline": [], "cdi_history": {}, "recent_indicators": {}}

    updated_archive, archive_changed = update_archive(province_dfs, existing_archive, new_month)

    if args.dry_run:
        print("\n--dry-run: no files written.")
        print("cdi_example_latest.json would be:")
        print(json.dumps(example_data, indent=2)[:600], "...")
        return

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    EXAMPLE_PATH.write_text(json.dumps(example_data, indent=2), encoding="utf-8")
    print(f"Wrote {EXAMPLE_PATH}")

    if archive_changed:
        ARCHIVE_PATH.write_text(json.dumps(updated_archive, separators=(",", ":")), encoding="utf-8")
        print(f"Wrote {ARCHIVE_PATH}")

    print("\nDone. Commit and push data/cdi_example_latest.json"
          + (" and data/cdi_archive.json" if archive_changed else "")
          + " -- the dashboard reads them at runtime, no other changes needed.")


if __name__ == "__main__":
    main()
