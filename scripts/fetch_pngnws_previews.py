from __future__ import annotations

import json
import re
from pathlib import Path
from urllib.parse import urljoin
from urllib.request import Request, urlopen

BASE_URL = "https://www.pngmet.gov.pg"
THREE_MONTH_URL = f"{BASE_URL}/nwp/three-months-forecasts/"
THIRTY_ONE_DAY_URL = f"{BASE_URL}/nwp/thirty-one-days-forecasts/"
SATELLITE_URL = f"{BASE_URL}/satellite/himawari/"
USER_AGENT = "Mozilla/5.0 (compatible; PNGNWSPreviewSync/1.0; +https://github.com/rudoq007/gisnexus)"

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "assets" / "pngnws"
STATUS_PATH = ROOT / "data" / "pngnws_preview_status.json"

PRODUCTS = {
    "three_month_rain_pngdomain.png": {
        "page": THREE_MONTH_URL,
        "pattern": r"/media/tcc_fc_images/monthly/threeMonths/rain/pngdomain/\d+_rain\.png",
        "fallback": f"{BASE_URL}/media/tcc_fc_images/monthly/threeMonths/rain/pngdomain/1_rain.png",
    },
    "three_month_rain_global.png": {
        "page": THREE_MONTH_URL,
        "pattern": r"/media/tcc_fc_images/monthly/threeMonths/rain/globaldomain/\d+_rain\.png",
        "fallback": f"{BASE_URL}/media/tcc_fc_images/monthly/threeMonths/rain/globaldomain/1_rain.png",
    },
    "thirtyone_day_rain_pngdomain.png": {
        "page": THIRTY_ONE_DAY_URL,
        "pattern": r"/media/tcc_fc_images/daily/rain/png_domain/\d+_rain\.png",
        "fallback": f"{BASE_URL}/media/tcc_fc_images/daily/rain/png_domain/1_rain.png",
    },
    "thirtyone_day_temperature_pngdomain.png": {
        "page": THIRTY_ONE_DAY_URL,
        "pattern": r"/media/tcc_fc_images/daily/tsurf/png_domain/\d+_tsurf\.png",
        "fallback": f"{BASE_URL}/media/tcc_fc_images/daily/tsurf/png_domain/1_tsurf.png",
    },
    "gsmap_daily_latest.png": {
        "page": THIRTY_ONE_DAY_URL,
        "pattern": r"/media/gsmap/daily_00z-23z/\d+\.png",
        "fallback": f"{BASE_URL}/media/gsmap/daily_00z-23z/1.png",
    },
    "himawari_ir1s_latest.jpg": {
        "page": SATELLITE_URL,
        "pattern": r"/media/satellite/himawari_pngnws/3hrs_animation_ir1s/\d+\.jpg",
        "fallback": f"{BASE_URL}/media/satellite/himawari_pngnws/3hrs_animation_ir1s/17.jpg",
    },
}


def fetch_bytes(url: str) -> bytes:
    request = Request(url, headers={"User-Agent": USER_AGENT})
    with urlopen(request, timeout=60) as response:
        return response.read()


def fetch_text(url: str) -> str:
    return fetch_bytes(url).decode("utf-8", errors="ignore")


def first_match(html: str, pattern: str) -> str | None:
    match = re.search(pattern, html, flags=re.I)
    if not match:
        return None
    return urljoin(BASE_URL, match.group(0))


def ensure_dirs() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    STATUS_PATH.parent.mkdir(parents=True, exist_ok=True)


def main() -> None:
    ensure_dirs()
    html_cache: dict[str, str] = {}
    status: dict[str, object] = {
        "source": "PNG National Weather Service public product pages",
        "products": {},
    }

    success_count = 0

    for filename, cfg in PRODUCTS.items():
        page_url = cfg["page"]
        if page_url not in html_cache:
            html_cache[page_url] = fetch_text(page_url)

        asset_url = first_match(html_cache[page_url], cfg["pattern"]) or cfg["fallback"]
        data = fetch_bytes(asset_url)
        out_path = OUT_DIR / filename
        out_path.write_bytes(data)
        success_count += 1

        status["products"][filename] = {
            "page_url": page_url,
            "asset_url": asset_url,
            "bytes": len(data),
        }
        print(f"Saved {filename} from {asset_url}")

    if success_count == 0:
        raise SystemExit("No PNGNWS preview files were downloaded")

    STATUS_PATH.write_text(json.dumps(status, indent=2), encoding="utf-8")
    print(f"Wrote status file to {STATUS_PATH}")


if __name__ == "__main__":
    main()
