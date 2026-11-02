"""Source-backed fiscal calendars for the five names checked on 2026-11-02.

Only dates/horizon labels are normalized. No forecast or multiple is invented.
The original source dates and values are retained, including at rollovers.
"""
from calendar import monthrange
from copy import deepcopy
from datetime import date, timedelta

CALENDARS = {
    'NVDA': {'rule': 'last_sunday_january', 'label': 'Dernier dimanche de janvier',
             'source_url': 'https://d18rn0p25nwr6d.cloudfront.net/CIK-0001045810/1ec0832c-5ef8-451d-91f6-267559b1e528.html'},
    'AAPL': {'rule': 'last_saturday_september', 'label': 'Dernier samedi de septembre',
             'source_url': 'https://www.sec.gov/Archives/edgar/data/320193/000032019325000079/aapl-20250927.htm'},
    'MU': {'rule': 'thursday_nearest_august_31', 'label': 'Jeudi le plus proche du 31 août',
           'source_url': 'https://www.sec.gov/Archives/edgar/data/723125/000072312526000023/mu-20260903.htm'},
    'MDA': {'rule': 'december_31', 'label': '31 décembre',
            'source_url': 'https://mda-en.investorroom.com/2026-03-04-MDA-SPACE-REPORTS-FOURTH-QUARTER-AND-FISCAL-2025-RESULTS'},
    'RY': {'rule': 'october_31', 'label': '31 octobre',
           'source_url': 'https://www.rbc.com/investor-relations/_assets-custom/pdf/ar_2025_e.pdf'},
}


def fiscal_end(identity, year):
    rule = CALENDARS[identity]['rule']
    if rule == 'last_sunday_january':
        end, weekday = date(year, 1, 31), 6
    elif rule == 'last_saturday_september':
        end, weekday = date(year, 9, 30), 5
    elif rule == 'thursday_nearest_august_31':
        anchor = date(year, 8, 31)
        return anchor + timedelta(days=((3 - anchor.weekday() + 3) % 7) - 3)
    else:
        month = 12 if rule == 'december_31' else 10
        return date(year, month, monthrange(year, month)[1])
    return end - timedelta(days=(end.weekday() - weekday) % 7)


def first_fiscal_year(identity, observation):
    current = date.fromisoformat(observation)
    year = current.year
    return year + (fiscal_end(identity, year) < current)


def normalize_snapshot(identity, snapshot):
    output = deepcopy(snapshot)
    if identity not in CALENDARS:
        return output
    for forecast in output['forecasts']:
        original = forecast.setdefault('source_period_end', forecast['period_end'])
        forecast['period_end'] = fiscal_end(identity, int(original[:4])).isoformat()
    if output.get('ev_bridge_date'):
        original = output.setdefault('source_ev_bridge_date', output['ev_bridge_date'])
        output['ev_bridge_date'] = fiscal_end(identity, int(original[:4])).isoformat()
    output['fiscal_calendar_verified'] = True
    return output


def normalize_monthly(identity, point):
    output = deepcopy(point)
    if identity not in CALENDARS:
        return output
    original = output.setdefault('source_fiscal_values', {
        key: point.get(key) for key in ['fy1', 'fy2', 'period_fy1', 'period_fy2']})
    by_year = {int(original['period_fy' + str(h)][:4]): original.get('fy' + str(h))
               for h in [1, 2] if original.get('period_fy' + str(h))}
    first = first_fiscal_year(identity, point['date'])
    for horizon in [1, 2]:
        year = first + horizon - 1
        output['fy' + str(horizon)] = by_year.get(year)
        output['period_fy' + str(horizon)] = fiscal_end(identity, year).isoformat()
    return output


def normalize_instrument(instrument):
    output = deepcopy(instrument)
    identity = output['id']
    if identity not in CALENDARS:
        return output
    output['fiscal_calendar'] = {**CALENDARS[identity], 'checked_at': '2026-11-02'}
    if output.get('latest'):
        output['latest'] = normalize_snapshot(identity, output['latest'])
    output['observations'] = [normalize_snapshot(identity, s) for s in output.get('observations', [])]
    if output.get('pe_history'):
        output['pe_history']['rows'] = [normalize_monthly(identity, p) for p in output['pe_history']['rows']]
    return output
