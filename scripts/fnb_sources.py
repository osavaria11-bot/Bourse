#!/usr/bin/env python3
"""Dated, public issuer data for the monthly SAVY ETF research pipeline.

No stale-source fallback is allowed when publishing a new recommendation.
The caller stages all outputs and publishes only a complete monthly observation.
"""
import calendar
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
import csv
from datetime import date, datetime, timedelta, timezone
import hashlib
from html import unescape
import io
import json
import math
from pathlib import Path
import re
import time
from urllib.parse import urlencode
from urllib.request import Request, urlopen

VG = "https://www.vanguard.ca/gpx/graphql"
BMO = "https://df.bmogam.com/api/graphql/etf-funds-production"
FID = "https://fidcaproductsapi.fidelity.ca/FidcaProductsAPI/api/fundPage/"
SECTORS = ["technology", "financials", "industrials", "energy", "consumer_discretionary",
           "materials", "health_care", "communication", "consumer_staples", "utilities", "real_estate", "other"]
SECTOR_NAMES = {
    "Information Technology": "technology", "Technology": "technology", "Financials": "financials",
    "Industrials": "industrials", "Energy": "energy", "Consumer Discretionary": "consumer_discretionary",
    "Consumer Disc.": "consumer_discretionary", "Materials": "materials", "Basic Materials": "materials",
    "Health Care": "health_care", "Communication Services": "communication", "Communication": "communication",
    "Telecommunications": "communication", "Consumer Staples": "consumer_staples", "Utilities": "utilities",
    "Real Estate": "real_estate", "Multi Sector": "other", "Other": "other", "Unclassified": "other",
}
# FTSE country membership for the regional comparison with Vanguard (incl. South Korea).
EMERGING = set("CN TW IN BR ZA MX ID MY TH PH PL TR SA AE CL CO PE CZ HU GR QA KW EG PK RO".split())
EMERGING_NAMES = {"China", "Taiwan", "India", "Brazil", "South Africa", "Mexico", "Indonesia", "Malaysia",
    "Thailand", "Philippines", "Poland", "Turkey", "Saudi Arabia", "United Arab Emirates", "Chile", "Colombia",
    "Peru", "Czech Republic", "Hungary", "Greece", "Qatar", "Kuwait", "Egypt", "Pakistan", "Romania"}
DEVELOPED = set("JP GB CH FR DE ES DK AU NL IE IT SE FI BE NO HK SG AT PT IL NZ KR LU BM KY JE GG IS".split())
DEVELOPED_NAMES = {"Japan", "United Kingdom", "Switzerland", "France", "Germany", "Spain", "Denmark", "Australia",
    "Netherlands", "Ireland", "Italy", "Sweden", "Finland", "Belgium", "Norway", "Hong Kong", "Singapore", "Austria",
    "Portugal", "Israel", "New Zealand", "Korea (South)", "South Korea", "Luxembourg", "Bermuda", "Cayman Islands",
    "Jersey", "Guernsey", "Iceland"}
CASH = re.compile(r"MONEY MARKET|NET OTHER ASSETS|SPOT CC|FORWARD CC|FUTURES CASH|\bFUT(?:\s|DEC)|FUTDEC|MIC EMIN|"
    r"^(?:US|U\.S\.|CANADIAN|HONG KONG|AUSTRALIAN|SINGAPORE|NEW ZEALAND) DOLLAR$|\bYEN\b|\bPOUND\b|\bFRANC\b|"
    r"\bKRONA\b|\bKRONE\b|\bSHEKEL\b|MONETARY UNIT|\bCURRENCY\b|\bCASH\b|DRIP RT|\bRIGHTS?\b", re.I)


def number(value):
    return float(re.sub(r"[^\d.eE+\-]", "", str(value).replace(",", "")) or 0)


def month_end(month):
    year, mon = map(int, month.split("-"))
    return date(year, mon, calendar.monthrange(year, mon)[1])


def previous_month(day):
    return (day.replace(day=1) - timedelta(days=1)).strftime("%Y-%m")


def last_trading_day(month):
    return previous_trading_day(month_end(month))


def previous_trading_day(day):
    """TSX/Cboe Canada equity calendar, including observed Christmas/Boxing Day."""
    y = day.year
    def nth_monday(m, n):
        first = date(y, m, 1)
        return first + timedelta(days=(7 - first.weekday()) % 7 + 7 * (n - 1))
    # Gregorian Easter (Meeus/Jones/Butcher), to identify Good Friday.
    a, b, c = y % 19, y // 100, y % 100
    dd, e, f = b // 4, b % 4, (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - dd - g + 15) % 30
    i, k = c // 4, c % 4
    ell = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * ell) // 451
    easter = date(y, (h + ell - 7 * m + 114) // 31, (h + ell - 7 * m + 114) % 31 + 1)
    holidays = {nth_monday(2, 3), easter - timedelta(days=2), nth_monday(8, 1), nth_monday(9, 1), nth_monday(10, 2)}
    victoria = date(y, 5, 24)
    holidays.add(victoria - timedelta(days=victoria.weekday()))
    for actual in [date(y, 1, 1), date(y, 7, 1), date(y, 12, 25), date(y, 12, 26)]:
        observed = actual
        while observed.weekday() >= 5 or observed in holidays: observed += timedelta(days=1)
        holidays.add(observed)
    while day.weekday() >= 5 or day in holidays: day -= timedelta(days=1)
    return day


def geo_group(country):
    if country in ["CA", "Canada"]: return 1
    if country in ["US", "United States", "United States of America"]: return 0
    if country in EMERGING or country in EMERGING_NAMES: return 3
    if country in DEVELOPED or country in DEVELOPED_NAMES: return 2
    return 4


def normalized(values):
    values = [max(0., float(v)) for v in values]
    total = sum(values)
    if total <= 0: return [0.] * len(values)
    return [v / total for v in values]


def monthly_from_levels(points, cutoff):
    """Use dated month-end total-return levels; never a partial or missing month."""
    levels, last_days = {}, {}
    for day, value in sorted(points):
        if not math.isfinite(value) or value <= 0: raise ValueError("Invalid total-return level")
        month = day[:7]
        if month <= cutoff:
            levels[month] = value
            last_days[month] = date.fromisoformat(day[:10])
    result = {}
    for month in sorted(levels):
        prev = previous_month(month_end(month))
        if prev not in levels or last_days[month] < last_trading_day(month): continue
        if last_days[prev] < last_trading_day(prev): continue
        result[month] = levels[month] / levels[prev] - 1
    return result


class Client:
    def __init__(self, cache=None):
        self.cache = Path(cache) if cache else None
        if self.cache: self.cache.mkdir(parents=True, exist_ok=True)

    def get(self, url, payload=None):
        encoded = json.dumps(payload, sort_keys=True).encode() if payload is not None else None
        key = hashlib.sha256(url.encode() + (encoded or b"")).hexdigest()
        file = self.cache / (key + ".txt") if self.cache else None
        # Optional cache is a development aid. Production jobs use a fresh temporary directory.
        if file and file.exists(): return file.read_text()
        error = None
        for attempt in range(3):
            try:
                req = Request(url, data=encoded, headers={"User-Agent": "Mozilla/5.0 SAVY/4.0 public ETF research",
                    "Content-Type": "application/json", "X-Consumer-ID": "ca0"})
                with urlopen(req, timeout=45) as response:
                    body = response.read().decode("utf-8-sig")
                if file: file.write_text(body)
                return body
            except Exception as exc:
                error = exc
                if attempt < 2: time.sleep(1 + attempt)
        raise ValueError(f"Public source unavailable: {url}: {error}")

    def json(self, url, payload=None):
        data = json.loads(self.get(url, payload))
        if isinstance(data, dict) and data.get("errors"): raise ValueError(str(data["errors"])[:400])
        return data


def result(fund, returns, geo, sectors, assets, positions, dates, **extra):
    if not returns or not all(math.isfinite(x) and -.95 < x < 1 for x in returns.values()):
        raise ValueError("Missing or implausible total returns")
    if any(w < 0 for _, w in positions) or sum(w for _, w in positions) > 1.025:
        raise ValueError("Invalid underlying equity weights")
    if abs(sum(assets.values()) - 1) > .000001: raise ValueError("Asset classes do not sum to one")
    if assets["equity"] > .05 and (sum(geo) <= 0 or sum(sectors) <= 0 or not positions):
        raise ValueError("Incomplete equity look-through")
    if positions and assets["equity"] <= .05: raise ValueError("Equity positions disagree with asset classification")
    return {"returns": returns, "geo": normalized(geo), "sector": normalized(sectors), "assets": assets,
        "mer": fund["mer"], "source_url": fund["source_url"], "dates": dates,
        "holdings": {"issuer": fund["provider"], "date": dates["holdings"], "source_url": fund["source_url"],
            "complete": True, "positions": positions}, **extra}


def fidelity(client, ticker, fund, cutoff):
    url = FID + "fund/EN/" + ticker
    d = client.json(url)
    if d.get("axisCode") != ticker or d["series"]["L"]["currency"] != "CAD": raise ValueError("Fidelity fund identity")
    daily = client.json(FID + "dailyPerformance/en/" + ticker.lower() + "?series=L")
    end = date.fromisoformat(daily["asOfDate"]); values = daily["dailyPerformanceBySeries"]["L"]
    first = end - timedelta(days=len(values) - 1)
    products = defaultdict(lambda: 1.)
    for i, value in enumerate(values):
        day = first + timedelta(days=i)
        if value is not None:
            if not .5 < value < 1.5: raise ValueError("Fidelity invalid daily return factor")
            products[day.strftime("%Y-%m")] *= value
    returns = {m: v - 1 for m, v in products.items() if m <= cutoff and last_trading_day(m) <= end and m > first.strftime("%Y-%m")}
    alloc = d["allocations"]
    sector = alloc["sectorAllocations"]["CM"]
    sec = [0.] * len(SECTORS)
    for name, value in sector["allocations"].items():
        if name not in SECTOR_NAMES: raise ValueError("Unknown Fidelity sector " + name)
        sec[SECTORS.index(SECTOR_NAMES[name])] += number(value["value"])
    countries = alloc["countryAllocations"]["CM"]
    geo = [0.] * 5
    for name, value in countries["allocations"].items():
        if name != "Multinational": geo[geo_group(name)] += number(value["value"])
    asset = alloc["assetAllocations"]["CM"]
    a = asset["allocations"]
    equity = sum(number(v["value"]) for k, v in a.items() if "Equit" in k) / 100
    bond = number(a.get("Bonds", {}).get("value", "0")) / 100
    crypto = 0.
    target = alloc.get("targetAllocations") or {}
    if ticker in ["FEQT", "FBAL", "FGRO"]:
        categories = target.get("categories") or []
        crypto = sum(number(c["pct"]) for c in categories if c["name"] == "Cryptocurrencies") / 100
        if not categories or not crypto: raise ValueError("Fidelity wrapper cryptocurrency disclosure missing")
        # Latest wrapper allocations separate bonds, crypto and the four equity regions.
        groups = {c["name"]: number(c["pct"]) for c in categories}
        global_equity = groups.get("Global Equities", 0)
        world = client.json(FID + "fund/EN/FCGS")["allocations"]["countryAllocations"]["CM"]["allocations"]
        global_geo = [0.] * 5
        for name, val in world.items(): global_geo[geo_group(name)] += number(val["value"])
        global_geo[4] += max(0, 100 - sum(global_geo))
        geo = [groups.get("U.S. Equities", 0), groups.get("Canadian Equities", 0), groups.get("International Equities", 0), 0., 0.]
        geo = [v + global_equity * g / 100 for v, g in zip(geo, global_geo)]
        equity = sum(geo) / 100
        bond = sum(v for k, v in groups.items() if "Debt" in k or "Fixed Income" in k) / 100
    else:
        # The unlisted country residual stays explicit, rather than guessing a country.
        geo[4] += max(0., equity * 100 - sum(geo))
    total = equity + bond + crypto
    if total > 1.005: raise ValueError("Fidelity excessive asset allocation")
    if total > 1: equity, bond, crypto = (v / total for v in [equity, bond, crypto])
    assets = {"equity": equity, "bond": bond, "crypto": crypto, "gold": 0., "cash": max(0., 1 - equity - bond - crypto)}
    selected = [c for key, c in d["holdings"]["holdingsByCategory"].items() if "Equit" in key or key == ""]
    if len({c["asOfDate"] for c in selected}) != 1: raise ValueError("Fidelity holdings dates inconsistent")
    positions = [[r["name"], number(r["netPercent"]) / 100] for c in selected for r in c["holdings"]
                 if number(r["marketValue"]) > 0 and not CASH.search(r["name"])]
    out = result(fund, returns, geo, sec, assets, positions, {"prices": daily["asOfDate"], "holdings": selected[0]["asOfDate"],
        "geography": target.get("asOfDt") if ticker in ["FEQT", "FBAL", "FGRO"] else countries["asOfDate"],
        "sectors": sector["asOfDate"], "assets": target.get("asOfDt") or asset["asOfDate"]},
        return_method="Fidelity : facteurs quotidiens de rendement total composés, arrondis par l’émetteur.")
    out["mer"] = number(d["series"]["L"]["merPct"]) / 100
    out["holdings"]["data_url"] = url
    return out


def vanguard(client, ticker, fund, cutoff):
    port = fund["port_id"]
    query = "query($portIds:[String!]!){funds(portIds:$portIds){profile{portId fundCurrency} performanceDetails{items{monthlyReturns{totalReturns(limit:-1){items{percent effectiveDate}}}}} sectorDiversification{sectorName fundPercent date}}}"
    d = client.json(VG, {"query": query, "variables": {"portIds": [port]}})["data"]["funds"][0]
    if d["profile"]["portId"] != port or d["profile"]["fundCurrency"] != "CAD": raise ValueError("Vanguard identity")
    rr = d["performanceDetails"]["items"]["monthlyReturns"]["totalReturns"]["items"]
    returns = {r["effectiveDate"][:7]: r["percent"] / 100 for r in rr if r["effectiveDate"][:7] <= cutoff}
    mode = fund["holdings_mode"]
    query = "query($portIds:[String!],$lastItemKey:String){borHoldings(portIds:$portIds){MODE(limit:1500,lastItemKey:$lastItemKey){items{issuerName securityType gicsSectorDescription bloombergIsoCountry marketValuePercentage marketValueBaseCurrency effectiveDate} totalHoldings lastItemKey}}}".replace("MODE", mode)
    items, cursor, seen = [], None, set()
    for _ in range(45):
        page = client.json(VG, {"query": query, "variables": {"portIds": [port], "lastItemKey": cursor}})["data"]["borHoldings"][0][mode]
        items.extend(page["items"])
        cursor = page["lastItemKey"]
        if not cursor:
            # Issuer totals can include a handful of null/zero rows omitted by pagination.
            # Still require every cursor and at least 99.99% of reported rows.
            if abs(len(items) - page["totalHoldings"]) > max(3, page["totalHoldings"] * .0001):
                raise ValueError("Incomplete Vanguard pagination")
            break
        if cursor in seen: raise ValueError("Repeated Vanguard pagination")
        seen.add(cursor)
    else: raise ValueError("Vanguard pagination limit exceeded")
    dates = {r["effectiveDate"] for r in items}
    if len(dates) != 1: raise ValueError("Vanguard mixed holdings dates")
    geo, sec, positions = [0.] * 5, [0.] * len(SECTORS), []
    equity, bond = 0., 0.
    for r in items:
        value = (r.get("marketValuePercentage") or 0) / 100
        kind = r.get("securityType") or ""
        if kind == "EQ.ETF": raise ValueError("Unexpanded Vanguard ETF")
        if kind.startswith("EQ.") and (r.get("marketValueBaseCurrency") or 0) > 0:
            equity += value
            positions.append([r["issuerName"], value])
            geo[geo_group(r.get("bloombergIsoCountry"))] += value
            sec[SECTORS.index(SECTOR_NAMES.get(r.get("gicsSectorDescription"), "other"))] += value
        elif kind.startswith("FI."): bond += value
    total = equity + bond
    if total > 1.01: raise ValueError("Vanguard invalid assets")
    if total > 1: equity, bond = equity / total, bond / total
    assets = {"equity": equity, "bond": bond, "cash": max(0., 1 - equity - bond), "gold": 0., "crypto": 0.}
    return result(fund, returns, geo, sec, assets, positions, {"prices": max(r["effectiveDate"] for r in rr),
        "holdings": next(iter(dates)), "geography": next(iter(dates)), "sectors": next(iter(dates)), "assets": next(iter(dates))},
        return_method="Vanguard : rendements totaux mensuels officiels en CAD; positions entièrement décomposées, secteurs GICS.")


def ishares(client, ticker, fund, cutoff):
    url = "https://www.blackrock.com/ca/investors/en/products/" + fund["product"]
    body = client.get(url)
    series = re.search(r"var performanceData\s*=\s*(.*?);", body)
    if not series: raise ValueError("iShares total-return series missing")
    points = [(date(int(y), int(m) + 1, int(d)).isoformat(), float(v))
              for y, m, d, v in re.findall(r"x:Date.UTC\((\d+),(\d+),(\d+)\),y:Number\(\(([\d.eE+\-]+)\)", series[1])]
    returns = monthly_from_levels(points, cutoff)
    if ticker == "CGL.C":
        if "CGL.C" not in body: raise ValueError("Wrong iShares gold unit class")
        dated = max(p[0] for p in points)
        return result(fund, returns, [0.] * 5, [0.] * len(SECTORS),
            {"equity": 0., "bond": 0., "cash": 0., "crypto": 0., "gold": 1.}, [],
            {k: dated for k in ["prices", "holdings", "geography", "sectors", "assets"]},
            return_method="iShares CGL.C : croissance officielle des parts non couvertes en CAD; or physique.")
    csv_url = url + "/1464253357814.ajax?" + urlencode({"dataType": "fund", "fileName": ticker + "_holdings", "fileType": "csv"})
    lines = client.get(csv_url).splitlines()
    headers = [i for i, line in enumerate(lines) if line.startswith("Ticker,")]
    dates = [next(csv.reader([line]))[1] for line in lines if line.startswith("Fund Holdings as of,")]
    if not headers or not dates: raise ValueError("iShares holdings CSV missing")
    dated = datetime.strptime(dates[-1], "%b %d, %Y").date().isoformat()
    rows = [r for r in csv.DictReader(lines[headers[-1]:]) if r.get("Asset Class")]
    geo, sec, positions = [0.] * 5, [0.] * len(SECTORS), []
    equity = bond = 0.
    for r in rows:
        w = number(r.get("Weight (%)", 0)) / 100
        if r["Asset Class"] == "Equity" and number(r["Market Value"]) > 0:
            positions.append([r["Name"], w]); equity += w
            geo[geo_group(r["Location"])] += w
            sec[SECTORS.index(SECTOR_NAMES.get(r["Sector"], "other"))] += w
        elif r["Asset Class"] == "Fixed Income": bond += w
    gold = 1. if ticker == "CGL.C" else 0.
    assets = {"equity": min(1, equity), "bond": bond, "gold": gold, "crypto": 0., "cash": max(0., 1 - equity - bond - gold)}
    return result(fund, returns, geo, sec, assets, positions, {"prices": max(p[0] for p in points),
        "holdings": dated, "geography": dated, "sectors": dated, "assets": dated},
        return_method="iShares : indice officiel de croissance avec distributions réinvesties, clôtures mensuelles.")


def bmo(client, ticker, fund, cutoff):
    # Official full-history growth chart, including distributions (not raw market prices).
    url = "https://1a48a761-fbab-4d1f-8302-ed4f7cabbcee-funds-sites.livedoc.transmissionmedia.ca/etf-pdf?__accept=text/html&documentType=pdf&exportType=&locale=en-US&profileId=" + ticker + "-a"
    body = client.get(url)
    candidates = []
    for attrs, raw in re.findall(r"<script\b([^>]*)>([\s\S]*?)</script>", body):
        if "text/json" not in attrs: continue
        try: obj = json.loads(raw)
        except json.JSONDecodeError: continue
        if isinstance(obj, list): candidates.extend(s for s in obj if isinstance(s, dict) and s.get("isCurrent") and s.get("data") and s.get("name", "").startswith("BMO "))
    if len(candidates) != 1: raise ValueError("BMO current growth chart missing or ambiguous")
    points = [(datetime.fromtimestamp(ms / 1000, timezone.utc).date().isoformat(), float(v)) for ms, v in candidates[0]["data"]]
    query = 'query { portfolios(entityId:"TICKER",sortDirection:"d",take:1){entityId effectiveDate numberOfEquityPositions kb2Holdings(take:5000){holding allocation assetClass country sector baseMarketValue}}}'.replace("TICKER", ticker)
    d = client.json(BMO, {"query": query})["data"]
    p = d["portfolios"][0]
    if p["entityId"] != ticker: raise ValueError("BMO identity")
    rows = [r for r in p["kb2Holdings"] if r["assetClass"] == "Equity" and (r.get("baseMarketValue") or 0) > 0]
    if len(rows) != p["numberOfEquityPositions"]: raise ValueError("BMO incomplete holdings")
    geo, sec, positions = [0.] * 5, [0.] * len(SECTORS), []
    for r in rows:
        positions.append([r["holding"], r["allocation"]])
        geo[geo_group(r["country"])] += r["allocation"]
        sec[SECTORS.index(SECTOR_NAMES.get((r["sector"] or "Other").title(), "other"))] += r["allocation"]
    equity = sum(w for _, w in positions)
    bond = sum(r["allocation"] for r in p["kb2Holdings"] if r["assetClass"] == "Fixed Income")
    if ticker == "ZAG" and not bond: bond = sum(r["allocation"] for r in p["kb2Holdings"] if r["assetClass"] in ["Bond", "Fixed Income"])
    total = equity + bond
    if total > 1.01: raise ValueError("BMO invalid assets")
    if total > 1: equity, bond = equity / total, bond / total
    return result(fund, monthly_from_levels(points, cutoff), geo, sec,
        {"equity": equity, "bond": bond, "cash": max(0., 1 - equity - bond), "gold": 0., "crypto": 0.}, positions,
        {"prices": max(p[0] for p in points), "holdings": p["effectiveDate"], "geography": p["effectiveDate"],
         "sectors": p["effectiveDate"], "assets": p["effectiveDate"]}, return_method="BMO : indice officiel de rendement total quotidien composé par mois; positions officielles.")


def rbc(client, ticker, fund, cutoff):
    body = client.get(fund["source_url"])
    match = re.search(r"const fundData\s*=\s*(.*?);\s*(?:\n|\r)", body)
    if not match: raise ValueError("RBC public data missing")
    d = json.loads(match[1])
    if d["currency"] != "CAD" or d["ticker"] != ticker or d["exchange"] != "TSX": raise ValueError("RBC identity")
    points = [(day[:10], row["val"]) for day, row in d["performance"]["growth10k"].items()]
    returns = monthly_from_levels(points, cutoff)
    equity, bond = d["equityRatio"] / 100, d["fixedIncomeRatio"] / 100
    geo, sec = [0.] * 5, [0.] * len(SECTORS)
    for row in d["portfolio"]["geographic"]: geo[geo_group(row["en"])] += row["val"]
    for name, value in d["portfolio"]["sector"].items(): sec[SECTORS.index(SECTOR_NAMES.get(name, "other"))] += value
    positions = [[name, w / 100 * equity] for name, w in d["portfolio"]["holdings"]["allHoldings"].items() if w > 0]
    dates = d["analysisDate"]
    out = result(fund, returns, geo, sec, {"equity": equity, "bond": bond, "cash": 1 - equity - bond, "crypto": 0., "gold": 0.},
        positions, {"prices": dates["performance"], "holdings": dates["holdings"], "geography": dates["geographic"],
            "sectors": dates["portfolio"], "assets": dates["assetMix"]},
        return_method="RBC : croissance officielle distributions réinvesties, ajustée des fractionnements.")
    # RBC publishes MER as a fraction, unlike Fidelity's percentage string.
    out["mer"] = number(d["mer"])
    return out


def yahoo_last_month(client, ticker, fund, cutoff):
    """Bridge a lagging issuer monthly release using adjusted CAD closes only."""
    url = "https://query1.finance.yahoo.com/v8/finance/chart/" + fund["quote_symbol"] + "?range=6mo&interval=1d&events=div%2Csplits"
    d = client.json(url)["chart"]["result"][0]
    meta = d["meta"]
    if meta.get("currency") != "CAD" or meta.get("symbol") != fund["quote_symbol"]:
        raise ValueError("Yahoo bridge fund/currency mismatch")
    prices = d["indicators"].get("adjclose", [{}])[0].get("adjclose")
    if not prices: raise ValueError("Adjusted closes missing; raw closes cannot be substituted")
    points = [(datetime.fromtimestamp(ts, timezone.utc).date().isoformat(), v)
        for ts, v in zip(d["timestamp"], prices) if v is not None]
    returns = monthly_from_levels(points, cutoff)
    if cutoff not in returns: raise ValueError("Incomplete closing month for " + ticker)
    return returns, url


def risk_free(client, cutoff):
    url = "https://www.bankofcanada.ca/valet/observations/TB.CDN.90D.MID/json?recent=10"
    d = client.json(url)
    rows = [r for r in d["observations"] if r.get("TB.CDN.90D.MID", {}).get("v")]
    if not rows: raise ValueError("Bank of Canada 3-month bill yield missing")
    row = max(rows, key=lambda r: r["d"])
    return {"rate": number(row["TB.CDN.90D.MID"]["v"]) / 100, "date": row["d"], "source_url": url,
        "method": "Dernier taux annuel des bons du Trésor canadien à 3 mois, constant pour comparer les historiques du présent instantané."}


def collect(config, cutoff, today, client):
    funds, errors = {}, []
    collectors = {"fidelity": fidelity, "vanguard": vanguard, "ishares": ishares, "bmo": bmo, "rbc": rbc}
    def one(ticker):
        fund = config["funds"][ticker]
        value = collectors[fund["provider"]](client, ticker, fund, cutoff)
        if cutoff not in value["returns"]:
            bridge, url = yahoo_last_month(client, ticker, fund, cutoff)
            for month, ret in bridge.items(): value["returns"].setdefault(month, ret)
            value["bridge_source"] = url
            value["return_method"] += " Dernier mois manquant : clôtures ajustées Yahoo Finance en CAD."
        for key in ["holdings", "geography", "sectors", "assets"]:
            age = (today - date.fromisoformat(value["dates"][key][:10])).days
            if age < 0 or age > 155: raise ValueError(key + " publication is future-dated or too old")
        return ticker, value
    with ThreadPoolExecutor(max_workers=5) as executor:
        futures = {executor.submit(one, t): t for t in config["funds"]}
        for future in as_completed(futures):
            ticker = futures[future]
            try:
                _, funds[ticker] = future.result()
                print(ticker, "OK", "returns", max(funds[ticker]["returns"]), "holdings", funds[ticker]["dates"]["holdings"], flush=True)
            except Exception as exc:
                errors.append(ticker + ": " + str(exc))
                print(ticker, "FAILED", str(exc)[:300], flush=True)
    if errors: raise ValueError("Incomplete ETF refresh: " + " | ".join(errors))
    rf = risk_free(client, cutoff)
    if not 0 <= (today - date.fromisoformat(rf["date"])).days <= 10: raise ValueError("Risk-free rate is stale or future-dated")
    return {"retrieved_at": today.isoformat(), "as_of": month_end(cutoff).isoformat(), "funds": dict(sorted(funds.items())), "risk_free": rf}
