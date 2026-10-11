#!/usr/bin/env python3
"""Refresh public sector/country exposures; never read portfolio quantities."""
import argparse
import csv
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from html import unescape
import io
import json
from pathlib import Path
import re
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
SECTORS = {
    "Information Technology": "technology", "Financials": "financials", "Industrials": "industrials",
    "Materials": "materials", "Energy": "energy", "Consumer Discretionary": "consumer_discretionary",
    "Consumer Disc.": "consumer_discretionary", "Consumer Staples": "consumer_staples", "Real Estate": "real_estate",
    "Health Care": "health_care", "Utilities": "utilities", "Communication": "communication_services",
    "Communication Services": "communication_services", "Multi Sector": "multi_sector", "Other Assets": "other_assets",
}
ISO_COUNTRIES = {"US": "United States", "CA": "Canada", "JP": "Japan", "GB": "United Kingdom", "CH": "Switzerland",
    "FR": "France", "DE": "Germany", "ES": "Spain", "ZA": "South Africa", "TW": "Taiwan", "DK": "Denmark",
    "BR": "Brazil", "CN": "China", "KR": "Korea (South)", "AU": "Australia", "NL": "Netherlands", "IN": "India",
    "IE": "Ireland", "IT": "Italy", "SE": "Sweden", "FI": "Finland", "BE": "Belgium", "NO": "Norway",
    "HK": "Hong Kong", "SG": "Singapore", "AT": "Austria", "PT": "Portugal", "IL": "Israel", "MX": "Mexico",
    "ID": "Indonesia", "MY": "Malaysia", "TH": "Thailand", "PH": "Philippines", "PL": "Poland", "TR": "Turkey",
    "SA": "Saudi Arabia", "AE": "United Arab Emirates", "CL": "Chile", "NZ": "New Zealand", "CO": "Colombia",
    "PE": "Peru", "CZ": "Czech Republic", "HU": "Hungary", "GR": "Greece", "QA": "Qatar", "KW": "Kuwait",
    "EG": "Egypt", "RU": "Russia", "LU": "Luxembourg", "BM": "Bermuda", "KY": "Cayman Islands", "MC": "Monaco",
    "IS": "Iceland", "JE": "Jersey", "GG": "Guernsey", "MT": "Malta"}
FR_COUNTRIES = {"United States": "États-Unis", "Canada": "Canada", "Japan": "Japon", "United Kingdom": "Royaume-Uni",
    "Switzerland": "Suisse", "France": "France", "Germany": "Allemagne", "Spain": "Espagne", "South Africa": "Afrique du Sud",
    "Taiwan": "Taïwan", "Denmark": "Danemark", "Brazil": "Brésil", "China": "Chine", "Korea (South)": "Corée du Sud",
    "Australia": "Australie", "Netherlands": "Pays-Bas", "India": "Inde", "Ireland": "Irlande", "Italy": "Italie",
    "Sweden": "Suède", "Finland": "Finlande", "Belgium": "Belgique", "Norway": "Norvège", "Hong Kong": "Hong Kong",
    "Singapore": "Singapour", "Austria": "Autriche", "Portugal": "Portugal", "Israel": "Israël", "Mexico": "Mexique",
    "Indonesia": "Indonésie", "Malaysia": "Malaisie", "Thailand": "Thaïlande", "Philippines": "Philippines", "Poland": "Pologne",
    "Turkey": "Turquie", "Saudi Arabia": "Arabie saoudite", "United Arab Emirates": "Émirats arabes unis", "Chile": "Chili",
    "New Zealand": "Nouvelle-Zélande", "Colombia": "Colombie", "Peru": "Pérou", "Czech Republic": "Tchéquie",
    "Hungary": "Hongrie", "Greece": "Grèce", "Qatar": "Qatar", "Kuwait": "Koweït", "Egypt": "Égypte",
    "Multinational": "Multinational", "Russia": "Russie", "Luxembourg": "Luxembourg", "Bermuda": "Bermudes",
    "Cayman Islands": "Îles Caïmans", "Jersey": "Jersey", "Guernsey": "Guernesey", "Iceland": "Islande"}
QUERY = """query ExposureHoldings($portIds:[String!],$lastItemKey:String) {
 funds(portIds:$portIds) { profile { fundFullName } }
 borHoldings(portIds:$portIds) { MODE(limit:1500,lastItemKey:$lastItemKey) {
 items { gicsSectorDescription marketValuePercentage securityType effectiveDate bloombergIsoCountry }
 totalHoldings lastItemKey } } }"""


def fetch(url, body=None, headers=None):
    request = Request(url, data=body, headers={"User-Agent": "Mozilla/5.0 SAVY/3.0", **(headers or {})})
    with urlopen(request, timeout=25) as response:
        return response.read().decode("utf-8-sig")


def country_id(name):
    return re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")


def distribution(weights, residual="other_assets", tolerance=.5):
    """Preserve the whole-fund denominator, retaining undisclosed assets explicitly."""
    weights = {key: float(value) for key, value in weights.items() if abs(value) > .0000001}
    # Small signed cash/hedge balances are aggregated by asset group before this check.
    if any(value < -.05 or value > 100.5 for value in weights.values()):
        raise ValueError("Invalid exposure weight")
    weights = {key: max(0, value) for key, value in weights.items()}
    total = sum(weights.values())
    if total <= 0 or total > 100 + tolerance:
        raise ValueError(f"Invalid exposure total: {total}")
    if total < 100 - tolerance:
        weights[residual] = weights.get(residual, 0) + 100 - total
    else:
        weights = {key: value * 100 / total for key, value in weights.items()}
    rows = [{"id": key, "weight": round(value, 8)} for key, value in sorted(weights.items())]
    rows[-1]["weight"] += 100 - sum(row["weight"] for row in rows)
    return rows


def fidelity_exposure(body):
    geo = re.search(r'id="country-allocation-data-cm".*?data-chart-pie="([^"]+)"', body, re.S)
    sector = re.search(r'id="pdf-sector-allocation"(.*?)</table>', body, re.S)
    if not geo or not sector:
        raise ValueError("Fidelity allocation tables missing")
    countries = json.loads(unescape(geo[1]))["data"]
    weights = {country_id(re.sub(r"^[\d.]+\s+", "", name)): float(value) for name, value in countries}
    geo_date = re.search(r'id="pdf-country-allocation".*?fd-grey-text">([^<]+)', body, re.S)
    sector_date = re.search(r'fd-grey-text">([^<]+)', sector[1])
    if not geo_date or not sector_date or geo_date[1] != sector_date[1]:
        raise ValueError("Fidelity allocation dates differ")
    sectors = {}
    for row in re.findall(r'<tr[^>]*>(.*?)</tr>', sector[1], re.S):
        heading = re.search(r'<th[^>]*>([^<]+)', row)
        values = re.findall(r'<td[^>]*>\s*([\d.]+)\s*</td>', row)
        if heading and values:
            name = unescape(heading[1]).strip()
            if name not in SECTORS:
                raise ValueError("Unknown Fidelity sector: " + name)
            sectors[SECTORS[name]] = float(values[-1])
    if len(sectors) < 5 or len(weights) < 1:
        raise ValueError("Incomplete Fidelity allocation")
    return {"as_of": datetime.strptime(geo_date[1].strip(), "%d-%b-%Y").date().isoformat(),
        "sectors": distribution(sectors), "geography": distribution(weights, "other_countries")}


def ishares_rows(body):
    lines = body.splitlines()
    headers = [index for index, line in enumerate(lines) if line.startswith("Ticker,")]
    dates = [line for line in lines if line.startswith("Fund Holdings as of,")]
    if not headers or not dates:
        raise ValueError("iShares holdings missing")
    # The final CSV section is the look-through portfolio, where available.
    date = next(csv.reader([dates[-1]]))[1]
    as_of = datetime.strptime(date, "%b %d, %Y").date().isoformat()
    rows = [row for row in csv.DictReader(lines[headers[-1]:]) if row.get("Asset Class")]
    return as_of, rows


def aggregate_ishares(body):
    as_of, rows = ishares_rows(body)
    sectors, geography = defaultdict(float), defaultdict(float)
    total = sum(float(row["Market Value"].replace(",", "")) for row in rows)
    if total <= 0:
        raise ValueError("Invalid iShares market value")
    for row in rows:
        weight = float(row["Market Value"].replace(",", "")) / total * 100
        asset = row["Asset Class"]
        sector = SECTORS.get(row["Sector"], "unclassified") if asset == "Equity" else "bonds" if asset == "Fixed Income" else "other_assets"
        country = country_id(row["Location"]) if row["Location"] not in ["", "-"] else "other_assets"
        sectors[sector] += weight; geography[country] += weight
    return {"as_of": as_of, "sectors": distribution(sectors), "geography": distribution(geography, "other_assets")}


def aggregate_vanguard(rows):
    sectors, geography = defaultdict(float), defaultdict(float)
    dates = set()
    for row in rows:
        weight = row.get("marketValuePercentage") or 0
        dates.add(row.get("effectiveDate"))
        asset = row.get("securityType") or ""
        sector = SECTORS.get(row.get("gicsSectorDescription"), "unclassified") if asset.startswith("EQ.") else "bonds" if asset.startswith("FI.") else "other_assets"
        if asset == "EQ.ETF": sector = "unclassified"
        code = row.get("bloombergIsoCountry")
        country = country_id(ISO_COUNTRIES.get(code, code or "other_assets"))
        sectors[sector] += weight; geography[country] += weight
    dates.discard(None)
    if len(dates) != 1:
        raise ValueError("Vanguard allocation dates inconsistent")
    return {"as_of": next(iter(dates)), "sectors": distribution(sectors), "geography": distribution(geography, "other_assets")}


def vanguard_exposure(port_id, mode):
    cursor, items, seen = None, [], set()
    for _ in range(40):
        body = json.dumps({"query": QUERY.replace("MODE", mode), "variables": {"portIds": [port_id], "lastItemKey": cursor}}).encode()
        response = json.loads(fetch("https://www.vanguard.ca/gpx/graphql", body,
            {"Content-Type": "application/json", "X-Consumer-ID": "ca0"}))
        if response.get("errors"): raise ValueError("Vanguard query failed")
        holdings = response["data"]["borHoldings"][0][mode]
        items.extend(holdings["items"])
        cursor = holdings["lastItemKey"]
        if not cursor:
            if len(items) != holdings["totalHoldings"] or not items: raise ValueError("Vanguard holdings incomplete")
            return aggregate_vanguard(items)
        if cursor in seen: raise ValueError("Vanguard pagination repeated")
        seen.add(cursor)
    raise ValueError("Vanguard pagination exceeded limit")


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, default=ROOT / "data")
    parser.add_argument("--force", action="store_true", help="Refresh monthly holdings even if recently collected")
    args = parser.parse_args(argv)
    output = args.output_dir / "portfolio-exposures.json"
    dataset = json.loads(output.read_text())
    now = datetime.now(timezone.utc)
    def refresh(item):
        provider = item.get("refresh", {})
        # End-of-month allocations are published with a lag; check every seven days.
        last = item.get("checked_at")
        if not args.force and last and (now - datetime.fromisoformat(last.replace("Z", "+00:00"))).total_seconds() < 7 * 86400:
            return item
        try:
            if provider.get("kind") == "fidelity": values = fidelity_exposure(fetch(item["source_url"]))
            elif provider.get("kind") == "ishares": values = aggregate_ishares(fetch(provider["download_url"]))
            elif provider.get("kind") == "vanguard": values = vanguard_exposure(provider["port_id"], provider["mode"])
            elif provider.get("kind") == "qqqm":
                source = json.loads(fetch(provider["download_url"]))
                if source.get("cusip") != "46138G649" or len(source.get("holdings", [])) != source.get("totalNumberOfHoldings"):
                    raise ValueError("QQQM identity or holdings incomplete")
                weights = defaultdict(float)
                for holding in source["holdings"]:
                    sector = provider["gics_by_ticker"].get(holding["ticker"])
                    if not sector: sector = "other_assets" if holding["securityTypeCode"] not in ["COM", "PRF", "ADR"] else "unclassified"
                    weights[sector] += (holding["percentageOfTotalNetAssets"] or 0) * provider["wrapper_weight"] / 100
                weights["other_assets"] += 100 - provider["wrapper_weight"]
                values = {"as_of": item["as_of"], "sector_as_of": source["effectiveBusinessDate"], "sectors": distribution(weights)}
            else: return item
            if values["as_of"] < item["as_of"]: raise ValueError("Older allocation returned")
            return {**item, **values, "checked_at": now.isoformat(), "fetch_status": "fresh"}
        except Exception as error:
            print(item["id"], "keeping dated allocation:", str(error))
            return {**item, "fetch_status": "cached"}
    with ThreadPoolExecutor(max_workers=5) as pool:
        dataset["instruments"] = list(pool.map(refresh, dataset["instruments"]))
    for item in dataset["instruments"]:
        for row in item["geography"]:
            key = row["id"]
            if key not in dataset["labels"]["geography"]:
                dataset["labels"]["geography"][key] = key.replace("_", " ").title()
    dataset["generated_at"] = now.isoformat()
    temp = output.with_suffix(".tmp")
    temp.write_text(json.dumps(dataset, ensure_ascii=False, indent=2) + "\n")
    temp.replace(output)
    print("Published public exposures:", len(dataset["instruments"]), "instruments")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
