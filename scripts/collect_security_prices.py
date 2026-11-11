#!/usr/bin/env python3
"""Publish price histories and USD/CAD, without any personal holdings."""
import argparse
from datetime import date, datetime, timezone
from pathlib import Path
try:
    from scripts import collect_market_indices as markets
except ModuleNotFoundError:
    import collect_market_indices as markets

ROOT = Path(__file__).resolve().parents[1]
MAXQ_CBOE_LAST_SESSION = "2026-11-02"
MAXQ_TSX_FIRST_SESSION = "2026-11-03"

def definitions() -> list[dict]:
    config = markets.macro.read_json(ROOT / "data/securities.json")
    if not config or config.get("schema_version") != 1:
        raise markets.macro.SourceError("Catalogue de cotations invalide")
    return [*config["series"], {"id": "USDCAD", "title": "USD/CAD", "currency": "CAD",
        "quote_symbol": "CAD=X", "source_url": "https://finance.yahoo.com/quote/CAD%3DX/",
        "unit": "$ CA/$ US", "decimals": 6, "frequency": "daily", "transform": "none",
        "max_age_days": 7, "history_range": "2y"}]

def fetch_security(definition: dict, now: datetime) -> dict:
    point = markets.fetch_index(definition, now)
    if definition["id"] != "MAXQ":
        return point

    tsx = [row for row in point["history"] if row[0] >= MAXQ_TSX_FIRST_SESSION]
    first_close = next((day for day, close in tsx if close is not None), None)
    if first_close != MAXQ_TSX_FIRST_SESSION:
        # After the transfer falls outside the lookback, a complete two-year TSX history is sufficient.
        lookback = markets.macro.months_before(date.fromisoformat(point["date"]), 24).isoformat()
        if first_close and first_close <= lookback:
            return markets.macro.summarize(definition, tsx, now)
        raise markets.macro.SourceError("MAXQ : première clôture TSX du 3 novembre manquante")

    archive = markets.macro.read_json(ROOT / "data/maxq-cboe-closes.json") or {}
    cboe = archive.get("history", [])
    if ((archive.get("id"), archive.get("currency"), archive.get("exchange")) != ("MAXQ", "CAD", "Cboe Canada")
            or not cboe or cboe[-1][0] != MAXQ_CBOE_LAST_SESSION):
        raise markets.macro.SourceError("MAXQ : archive des clôtures Cboe invalide")

    # The same common shares moved from Cboe Canada to TSX after the November 2 close.
    point = markets.macro.summarize(definition, cboe + tsx, now)
    point["history_sources"] = [*archive["sources"], {
        "provider": "Yahoo Finance", "symbol": definition["quote_symbol"], "source_url": definition["source_url"],
        "first_session": MAXQ_TSX_FIRST_SESSION, "last_session": point["date"],
    }]
    return point

def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, default=ROOT / "data")
    args = parser.parse_args(argv)
    output = args.output_dir / "security-prices.json"
    try:
        config = definitions()
        data = markets.macro.collect_sources(config, markets.macro.read_json(output),
                    datetime.now(timezone.utc), fetcher=fetch_security)
        data.update(kind="security_prices", data_provider="Yahoo Finance — clôtures et USD/CAD")
        urls = {p["id"]: p["source_url"] for p in config}
        for point in data["series"]:
            point["source_url"] = point.get("observation_source", {}).get("source_url") or urls[point["id"]]
        if any(point.get("observation_source", {}).get("id") == "tmx_closing_history" for point in data["series"]):
            data["data_provider"] += "; TMX Money pour clôtures FNB manquantes, ancre vérifiée"
        if any(point.get("history_sources") for point in data["series"]):
            data["data_provider"] += " · TMX Money pour l’historique Cboe de MAXQ"
        markets.macro.atomic_write_json(output, data, compact=True)
    except markets.macro.SourceError as error:
        print(str(error)); return 1
    print("Security price coverage:", data["coverage"])
    for point in data["series"]:
        print(point["id"], point["quote_symbol"], point["currency"], point["fetch_status"], point["date"], len(point["history"]))
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
