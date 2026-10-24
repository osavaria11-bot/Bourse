#!/usr/bin/env python3
"""Daily, equal-count breadth of disclosed ETF equity universes.

Backfill uses the current disclosed membership, not historical index membership.
Accepted dated aggregates are append-only. Missing quotes never become prices.
"""
import argparse
from collections import deque
from concurrent.futures import ThreadPoolExecutor, as_completed
import csv
from datetime import date, datetime, timedelta, timezone
import hashlib
import io
import json
import math
from pathlib import Path
import re
import threading
from urllib.error import HTTPError
from urllib.parse import quote, urlencode, urlparse
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
WINDOWS = [20, 50, 100, 200]
MIN_COVERAGE = .90
MAX_LOCAL_LAG_DAYS = 3
MARKETS = [
    {"id":"sp500", "name":"S&P 500", "index":"S&P 500", "proxy":"IVV", "product":"https://www.ishares.com/us/products/239726/ishares-core-sp-500-etf", "minimum":450},
    {"id":"tsx", "name":"TSX Composite", "index":"S&P/TSX Capped Composite", "proxy":"XIC", "product":"https://www.blackrock.com/ca/investors/en/products/239837/ishares-sptsx-capped-composite-index-etf", "minimum":180},
    {"id":"europe", "name":"Europe", "index":"MSCI Europe IMI", "proxy":"IEUR", "product":"https://www.ishares.com/us/products/264617/ishares-core-msci-europe-etf", "minimum":700},
    {"id":"emerging", "name":"Marchés émergents", "index":"MSCI Emerging Markets", "proxy":"EEM", "product":"https://www.ishares.com/us/products/239637/ishares-msci-emerging-markets-etf", "minimum":700},
]

def atomic_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + '.tmp')
    temp.write_text(json.dumps(value, ensure_ascii=False, separators=(',', ':'), allow_nan=False))
    temp.replace(path)

def fetch(url, timeout=16):
    with urlopen(Request(url, headers={"User-Agent":"Mozilla/5.0 SAVY market research", "Accept":"application/json,text/csv,text/html"}), timeout=timeout) as response:
        return response.read().decode('utf-8-sig')

def number(value):
    try: return float(str(value).replace(',', '').replace('\u00a0', '').strip())
    except (ValueError, TypeError): return 0.

def yahoo_symbol(row):
    ticker = row.get('Ticker', '').strip().upper()
    country, exchange = row.get('Location', '').strip(), row.get('Exchange', '').strip()
    if not ticker or ticker in {'-', 'NULL'}: return None
    ticker = ticker.replace(' ', '-')
    if country == 'United States' or exchange in {'NASDAQ','NYSE','New York Stock Exchange Inc.','Nyse Mkt Llc','NYSE Arca'}: return ticker.replace('.', '-')
    if country == 'Canada': return ticker.replace('.', '-') + '.TO'
    if country == 'China':
        if 'Hong Kong' in exchange: return ticker.zfill(4) + '.HK' if ticker.isdigit() else None
        if ticker.isdigit(): return ticker.zfill(6) + ('.SS' if 'Shanghai' in exchange else '.SZ' if 'Shenzhen' in exchange else '') or None
        return None
    if country == 'Hong Kong': return ticker.zfill(4) + '.HK' if ticker.isdigit() else ticker + '.HK'
    if country == 'Taiwan': return ticker + ('.TWO' if 'Gretai' in exchange or 'Taipei' in exchange else '.TW')
    if country in {'Korea (South)', 'South Korea'}: return ticker.zfill(6) + ('.KQ' if 'Kosdaq' in exchange else '.KS')
    suffixes = {'United Kingdom':'.L','Switzerland':'.SW','France':'.PA','Germany':'.DE','Netherlands':'.AS',
        'Italy':'.MI','Sweden':'.ST','Denmark':'.CO','Finland':'.HE','Norway':'.OL','Spain':'.MC',
        'Belgium':'.BR','Portugal':'.LS','Ireland':'.IR','Austria':'.VI','Greece':'.AT','Poland':'.WA',
        'India':'.NS','Brazil':'.SA','Mexico':'.MX','South Africa':'.JO','Indonesia':'.JK',
        'Malaysia':'.KL','Thailand':'.BK','Philippines':'.PS','Turkey':'.IS','Saudi Arabia':'.SR',
        'Qatar':'.QA','Hungary':'.BD','Czech Republic':'.PR','Chile':'.SN','Peru':'.LM','Kuwait':'.KW',
        'Egypt':'.CA','Pakistan':'.KA','Colombia':'.CL'}
    if country == 'United Arab Emirates': return ticker + '.AE' if 'Dubai' in exchange else None
    if country not in suffixes: return None
    if country == 'United Kingdom': ticker = ticker.rstrip('.').replace('.', '-')
    if country in {'Sweden','Denmark'}: ticker = ticker.replace('.', '-').replace('/', '-')
    if country == 'Thailand': ticker = ticker.replace('.R','-R')
    if country == 'Turkey': ticker = re.sub(r'\.E$', '', ticker)
    if country == 'Mexico': ticker = ticker.rstrip('*')
    if country == 'India' and ticker == 'BAJAJ.AUTO': ticker = 'BAJAJ-AUTO'
    if country == 'Malaysia' and not ticker.isdigit(): return None
    return ticker + suffixes[country]

def parse_holdings(body, minimum):
    if body.lstrip().startswith('<'): raise ValueError('Issuer returned HTML instead of holdings CSV')
    lines = body.splitlines()
    header = next((i for i, line in enumerate(lines) if line.startswith('Ticker,')), None)
    if header is None: raise ValueError('Holdings header missing')
    dated = None
    for line in lines[:header]:
        cols = next(csv.reader([line]))
        if cols and 'holdings as of' in cols[0].lower() and len(cols)>1:
            for pattern in ['%b %d, %Y','%d %b %Y','%Y-%m-%d']:
                try: dated = datetime.strptime(cols[1].strip(), pattern).date().isoformat(); break
                except ValueError: pass
    if not dated: raise ValueError('Holdings date missing')
    holdings = {}
    for row in csv.DictReader(lines[header:]):
        if row.get('Asset Class') != 'Equity' or number(row.get('Market Value')) <= 0: continue
        key = (row.get('ISIN') or '|'.join(row.get(k,'') for k in ['Ticker','Name','Location','Exchange'])).strip()
        if not key: continue
        holdings[key] = {"ticker":row['Ticker'], "name":row.get('Name',''), "country":row.get('Location',''),
            "symbol":yahoo_symbol(row), "currency":row.get('Market Currency') or row.get('Currency') or ''}
    if len(holdings) < minimum: raise ValueError(f'Incomplete holdings: {len(holdings)} equities, minimum {minimum}')
    return dated, list(holdings.values())

def collect_holdings(definition, cutoff):
    product = definition['product']
    if definition['proxy'] == 'XIC':
        url = product + '/1464253357814.ajax?' + urlencode({'fileType':'csv','fileName':'XIC_holdings','dataType':'fund'})
    else:
        page = fetch(product)
        urls = re.findall(r'"contentUrl"\s*:\s*"([^"<>]+latest-holdings\.csv)"', page)
        if not urls: raise ValueError('Official latest-holdings.csv link missing')
        url = urls[0]
        if urlparse(url).hostname not in {'www.ishares.com','www.blackrock.com'}: raise ValueError('Unexpected holdings destination')
    dated, holdings = parse_holdings(fetch(url), definition['minimum'])
    age = (date.fromisoformat(cutoff)-date.fromisoformat(dated)).days
    if age < 0 or age > 10: raise ValueError('Holdings publication is future-dated or more than 10 days old')
    # Bursa issuer tickers are alphabetic, while this quote feed uses numerical
    # codes. Require an exact ticker match on the local equity exchange.
    missing=[h for h in holdings if not h['symbol'] and h['country']=='Malaysia']
    with ThreadPoolExecutor(max_workers=4) as executor:
        for holding,symbol in zip(missing,executor.map(resolve_malaysia_symbol,missing)):
            holding['symbol']=symbol
    return dated, holdings, url

def resolve_malaysia_symbol(holding):
    try:
        url='https://query1.finance.yahoo.com/v1/finance/search?'+urlencode({'q':holding['ticker'],'quotesCount':6,'newsCount':0})
        matches=[q['symbol'] for q in json.loads(fetch(url,10)).get('quotes',[])
                 if q.get('exchange')=='KLS' and q.get('quoteType')=='EQUITY'
                 and q.get('shortname','').upper()==holding['ticker'].upper()
                 and re.fullmatch(r'\d+\.KL',q.get('symbol',''))]
        return matches[0] if len(set(matches))==1 else None
    except (HTTPError,ValueError,OSError):return None

def parse_prices(payload, symbol, cutoff, minimum=20):
    rows = payload.get('chart', {}).get('result') or []
    if len(rows) != 1: raise ValueError('Quote series missing')
    row = rows[0]
    if row.get('meta',{}).get('symbol','').upper() != symbol.upper(): raise ValueError('Quote symbol mismatch')
    series = row.get('indicators',{}).get('adjclose') or []
    prices = series[0].get('adjclose',[]) if series else []
    times = row.get('timestamp',[])
    if len(times) != len(prices): raise ValueError('Adjusted close length mismatch')
    zone = ZoneInfo(row['meta'].get('exchangeTimezoneName','UTC'))
    points = {}
    for stamp, value in zip(times, prices):
        day = datetime.fromtimestamp(stamp, zone).date().isoformat()
        if day > cutoff: continue
        if value is not None and (isinstance(value,bool) or not isinstance(value,(int,float)) or not math.isfinite(value) or value<=0): value=None
        points[day] = value
    if sum(v is not None for v in points.values()) < minimum: raise ValueError('Insufficient adjusted closes')
    return sorted(points.items())

def merge_adjusted(old, recent):
    before=dict(old); after=dict(recent)
    common=sorted(d for d in before.keys() & after.keys() if before[d] is not None and after[d] is not None)
    if len(common)<5: raise ValueError('Insufficient overlap to align adjusted prices')
    first=common[0];scale=after[first]/before[first]
    if not math.isfinite(scale) or not .001<scale<1000: raise ValueError('Invalid adjustment bridge')
    merged={d:(v*scale if v is not None else None) for d,v in before.items() if d<min(after)}
    merged.update(after)
    return sorted(merged.items())[-900:]


def stock_prices(symbol, cutoff, cache, stop):
    if stop.is_set(): return None
    path = cache / (hashlib.sha256(symbol.encode()).hexdigest()+'.json')
    old = json.loads(path.read_text()) if path.exists() else None
    if old and old.get('symbol') == symbol and old.get('cutoff') == cutoff: return old['history']
    recent=bool(old and old.get('symbol')==symbol and (date.fromisoformat(cutoff)-date.fromisoformat(old['cutoff'])).days<=20)
    url='https://query1.finance.yahoo.com/v8/finance/chart/'+quote(symbol,safe='')+'?'+urlencode({'range':'1mo' if recent else '2y','interval':'1d','events':'div,splits','includeAdjustedClose':'true'})
    try:
        history=parse_prices(json.loads(fetch(url,12)),symbol,cutoff,5 if recent else 20)
        if recent: history=merge_adjusted(old['history'],history)
    except HTTPError as error:
        if error.code == 429: stop.set()
        raise
    atomic_json(path,{'symbol':symbol,'cutoff':cutoff,'history':history})
    return history

def breadth_history(holdings, histories, cutoff, composition_date, coverage=MIN_COVERAGE):
    # The global observation uses each market's latest actual local close.
    # Carry indicator states across short exchange holidays; never repeat a
    # price in a stock's SMA window. Explicit null quotes reset that window.
    days = sorted({day for h in holdings for day,_ in histories.get(h['symbol'],[])
                   if day<=cutoff and date.fromisoformat(day).weekday()<5})
    counts = {d:{str(w):[0,0,0] for w in WINDOWS} for d in days}
    for holding in holdings:
        points=histories.get(holding['symbol'])
        if not points: continue
        queues={w:deque() for w in WINDOWS}; totals={w:0. for w in WINDOWS}
        states=[]
        for day,value in points:
            if day>cutoff: continue
            state={str(w):None for w in WINDOWS}
            if value is None:
                queues={w:deque() for w in WINDOWS}; totals={w:0. for w in WINDOWS}
            else:
                for w in WINDOWS:
                    q=queues[w];q.append(value);totals[w]+=value
                    if len(q)>w:totals[w]-=q.popleft()
                    if len(q)==w:state[str(w)]=value-totals[w]/w>max(1e-12,abs(value)*1e-12)
            states.append((day,state))
        index=-1
        for day in days:
            while index+1<len(states) and states[index+1][0]<=day:index+=1
            if index<0:continue
            local_day,state=states[index];lag=(date.fromisoformat(day)-date.fromisoformat(local_day)).days
            if lag>MAX_LOCAL_LAG_DAYS:continue
            for w,value in state.items():
                if value is None:continue
                counts[day][w][0]+=int(value);counts[day][w][1]+=1;counts[day][w][2]+=int(lag>0)
    size=len(holdings);result=[]
    for day,groups in sorted(counts.items()):
        values={str(w):round(groups[str(w)][0]/groups[str(w)][1]*100,4) if groups[str(w)][1]>0 and groups[str(w)][1]>=size*coverage else None for w in WINDOWS}
        result.append({'date':day,'values':values,'above':{w:c[0] for w,c in groups.items()},'eligible':{w:c[1] for w,c in groups.items()},
            'lagged':{w:c[2] for w,c in groups.items()},'universe':size,'composition_date':composition_date,'kind':'reconstructed'})
    return result[-300:]

def validate(data):
    if data.get('schema_version')!=1 or data.get('windows')!=WINDOWS or [m['id'] for m in data.get('markets',[])]!=[m['id'] for m in MARKETS]:raise ValueError('Invalid breadth schema')
    for market in data['markets']:
        seen=set();previous_date=''
        if market.get('status') not in {'current','stale','unavailable'}:raise ValueError('Invalid source status')
        for point in market.get('history',[]):
            date.fromisoformat(point['date'])
            if point['date'] in seen or point['date']<=previous_date or point['date']>data['expected_cutoff']:raise ValueError('Duplicate, unordered or future breadth date')
            seen.add(point['date']);previous_date=point['date']
            for w in map(str,WINDOWS):
                value=point['values'][w];a=point['above'][w];n=point['eligible'][w]
                if not 0<=a<=n<=point['universe']:raise ValueError('Invalid breadth denominator')
                if not 0<=point.get('lagged',{}).get(w,0)<=n:raise ValueError('Invalid lagged-close count')
                if value is not None and (n<point['universe']*MIN_COVERAGE or abs(value-a/n*100)>.0001):raise ValueError('Invalid breadth percentage')
    return data

def main(argv=None):
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--output',type=Path,default=ROOT/'data/market-breadth.json');parser.add_argument('--cache',type=Path,default=ROOT/'.cache/market-breadth');parser.add_argument('--check',action='store_true');parser.add_argument('--workers',type=int,default=12);parser.add_argument('--due',action='store_true')
    args=parser.parse_args(argv)
    if args.check:validate(json.loads(args.output.read_text()));print('Validated four breadth universes and daily SMA counts');return 0
    now=datetime.now(ZoneInfo('America/Toronto'));cutoff=(now.date() if now.hour>=19 else now.date()-timedelta(days=1)).isoformat()
    while date.fromisoformat(cutoff).weekday()>=5:cutoff=(date.fromisoformat(cutoff)-timedelta(days=1)).isoformat()
    previous=json.loads(args.output.read_text()) if args.output.exists() else {};old={m['id']:m for m in previous.get('markets',[])}
    if args.due:
        print('false' if previous.get('expected_cutoff')==cutoff and all(old.get(m['id'],{}).get('status')=='current' for m in MARKETS) else 'true');return 0
    result={'schema_version':1,'generated_at':now.isoformat(timespec='seconds'),'expected_cutoff':cutoff,'windows':WINDOWS,'minimum_coverage':MIN_COVERAGE,
        'max_local_lag_days':MAX_LOCAL_LAG_DAYS,
        'method':'Nombre de titres au-dessus de leur propre SMA en séances locales, sans pondération. Dernière clôture locale disponible depuis 3 jours calendaires maximum; aucun prix répété dans les SMA. Cours ajustés Yahoo Finance. Univers des positions actions des FNB iShares publiées. Historique reconstitué sur les composantes courantes : biais de survivance; pas un historique officiel des membres des indices.', 'markets':[]}
    args.cache.mkdir(parents=True,exist_ok=True)
    universes={};all_symbols=set()
    for definition in MARKETS:
        try:
            dated,holdings,url=collect_holdings(definition,cutoff)
            prior_count=old.get(definition['id'],{}).get('universe_size')
            if prior_count and abs(len(holdings)/prior_count-1)>.15:raise ValueError('Unexpected change of more than 15% in disclosed equity count')
            universes[definition['id']]=(dated,holdings,url)
            all_symbols.update(h['symbol'] for h in holdings if h['symbol']);print(definition['id'],dated,len(holdings),'equities',flush=True)
        except Exception as error:universes[definition['id']]=str(error);print(definition['id'],'holdings unavailable:',str(error)[:180],flush=True)
    histories={};failures=[];stop=threading.Event()
    with ThreadPoolExecutor(max_workers=max(1,min(args.workers,16))) as executor:
        futures={executor.submit(stock_prices,symbol,cutoff,args.cache,stop):symbol for symbol in sorted(all_symbols)}
        for index,future in enumerate(as_completed(futures),1):
            symbol=futures[future]
            try:
                points=future.result()
                if points:histories[symbol]=points
            except Exception as error:failures.append([symbol,str(error)[:100]])
            if index%100==0:print(index,'/',len(futures),'quotes;',len(histories),'valid;',len(failures),'failed',flush=True)
    for definition in MARKETS:
        key=definition['id'];prior=old.get(key,{});item={**definition,'history':prior.get('history',[])};entry=universes[key]
        try:
            if isinstance(entry,str):raise ValueError(entry)
            dated,holdings,url=entry;history=breadth_history(holdings,histories,cutoff,dated)
            complete=[p for p in history if all(v is not None for v in p['values'].values())]
            if not complete:raise ValueError('Insufficient complete coverage across the four SMAs')
            latest=complete[-1]['date']
            if (date.fromisoformat(cutoff)-date.fromisoformat(latest)).days>5:raise ValueError('Latest complete observation is stale')
            frozen={p['date']:p for p in prior.get('history',[])};last=max(frozen,default='')
            for point in history:
                if point['date']>last:frozen[point['date']]=point
            item.update(history=[frozen[d] for d in sorted(frozen)],holdings_date=dated,holdings_url=url,universe_size=len(holdings),quote_series=len([h for h in holdings if h['symbol'] in histories]),latest_date=latest,status='current',error=None)
            # The latest point is a dated aggregate; earlier initial backfill
            # remains explicitly reconstructed and is never relabelled PIT.
            if item['history'] and item['history'][-1]['date']==latest:item['history'][-1]['kind']='dated_snapshot'
        except Exception as error:item.update(status='stale' if item['history'] else 'unavailable',error=str(error)[:220],latest_date=item['history'][-1]['date'] if item['history'] else None)
        result['markets'].append(item);print(key,item['status'],item['latest_date'],len(item['history']),'points',flush=True)
    result['quote_failures_count']=len(failures);result['rate_limited']=stop.is_set()
    validate(result);atomic_json(args.output,result)
    return 0 if all(m['status']=='current' for m in result['markets']) else 1

if __name__=='__main__':raise SystemExit(main())
