#!/usr/bin/env python3
"""Publish price histories and USD/CAD, without any personal holdings."""
import argparse
from datetime import datetime, timezone
from pathlib import Path
try:
    from scripts import collect_market_indices as markets
except ModuleNotFoundError:
    import collect_market_indices as markets

ROOT = Path(__file__).resolve().parents[1]

def definitions() -> list[dict]:
    config = markets.macro.read_json(ROOT / "data/securities.json")
    if not config or config.get("schema_version") != 1:
        raise markets.macro.SourceError("Catalogue de cotations invalide")
    return [*config["series"], {"id": "USDCAD", "title": "USD/CAD", "currency": "CAD",
        "quote_symbol": "CAD=X", "source_url": "https://finance.yahoo.com/quote/CAD%3DX/",
        "unit": "$ CA/$ US", "decimals": 6, "frequency": "daily", "transform": "none",
        "max_age_days": 7, "history_range": "2y"}]

def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, default=ROOT / "data")
    args = parser.parse_args(argv)
    output = args.output_dir / "security-prices.json"
    try:
        config = definitions()
        data = markets.macro.collect_sources(config, markets.macro.read_json(output),
                    datetime.now(timezone.utc), fetcher=markets.fetch_index)
        data.update(kind="security_prices", data_provider="Yahoo Finance — clôtures et USD/CAD")
        urls = {p["id"]: p["source_url"] for p in config}
        for point in data["series"]:
            point["source_url"] = urls[point["id"]]
        markets.macro.atomic_write_json(output, data, compact=True)
    except markets.macro.SourceError as error:
        print(str(error)); return 1
    print("Security price coverage:", data["coverage"])
    for point in data["series"]:
        print(point["id"], point["quote_symbol"], point["currency"], point["fetch_status"], point["date"], len(point["history"]))
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
