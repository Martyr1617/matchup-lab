"""Free Vegas lines + player prop lines from ESPN's public odds feeds (DraftKings).
Writes site/market.json in the same shape the app expects. No API key needed.
Spreads/totals: site.api.espn.com scoreboard. Props: sports.core.api.espn.com propBets (lines only, no prices).
"""
import json, re, sys, time, unicodedata, urllib.request
from datetime import datetime, timezone

ABBR = {'WSH': 'WAS', 'LAR': 'LA', 'JAC': 'JAX'}
TYPES = {
    'Total Receiving Yards (incl. overtime)': 'rec_yds',
    'Total Receptions (incl. overtime)': 'rec',
    'Total Rushing Yards (incl. overtime)': 'rush_yds',
    'Total Passing Yards (incl. overtime)': 'pass_yds',
    'Total Passing Attempts (incl. overtime)': 'pass_att',
}


def get(url, tries=3):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'MatchupLab/1.0'})
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.load(r)
        except Exception as e:
            if i == tries - 1: raise
            time.sleep(2 + i * 3)


def norm(s):
    s = unicodedata.normalize('NFD', str(s).lower())
    s = ''.join(c for c in s if unicodedata.category(c) != 'Mn')
    s = re.sub(r'\b(jr|sr|ii|iii|iv|v)\b\.?', '', s)
    return re.sub(r'[^a-z]', '', s)


def median(a):
    a = sorted(a); n = len(a)
    return None if not n else (a[n // 2] if n % 2 else (a[n // 2 - 1] + a[n // 2]) / 2)


def main(data_path='site/data.json', out_path='site/market.json'):
    data = json.load(open(data_path))
    season, week = data['meta']['season'], data['meta']['next_week']
    espn2name = {str(p['ids']['espn']): p['name'] for p in data['players'] if p.get('ids', {}).get('espn')}
    sb = get(f'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?week={week}&seasontype=2&dates={season}')
    out = {'week': week, 'updated': datetime.now(timezone.utc).isoformat(), 'books': ['DraftKings'], 'source': 'ESPN (DraftKings)',
           'games': {}, 'props': {}, 'unavailable': []}
    latest = ''
    for ev in sb.get('events', []):
        comp = ev['competitions'][0]
        teams = {c['homeAway']: ABBR.get(c['team']['abbreviation'], c['team']['abbreviation']) for c in comp['competitors']}
        home, away = teams.get('home'), teams.get('away')
        key = f'{away}@{home}'
        odds = (comp.get('odds') or [{}])[0]
        g = {'home': home, 'away': away, 'spread_home': None, 'total': odds.get('overUnder')}
        if odds.get('spread') is not None:
            # ESPN 'spread' is from the home team's perspective (negative = home favored)
            g['spread_home'] = float(odds['spread'])
        if g['spread_home'] is not None and g['total'] is not None:
            g['itt_home'] = g['total'] / 2 - g['spread_home'] / 2
            g['itt_away'] = g['total'] / 2 + g['spread_home'] / 2
        out['games'][key] = g
        # player props (DraftKings = provider 100)
        try:
            items, page = [], 1
            while True:
                pb = get(f'https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/events/{ev["id"]}/competitions/{comp["id"]}/odds/100/propBets?limit=1000&page={page}')
                items += pb.get('items', [])
                if page >= pb.get('pageCount', 1): break
                page += 1
        except Exception as e:
            out['unavailable'].append(f'{key}: props {e}')
            continue
        lines = {}
        for it in items:
            mk = TYPES.get((it.get('type') or {}).get('name'))
            if not mk: continue
            m = re.search(r'/athletes/(\d+)', (it.get('athlete') or {}).get('$ref', ''))
            v = ((it.get('current') or {}).get('target') or {}).get('value')
            if not m or v is None: continue
            name = espn2name.get(m.group(1))
            if not name: continue
            lines.setdefault((name, mk), []).append(float(v))
            latest = max(latest, it.get('lastUpdated') or '')
        for (name, mk), vals in lines.items():
            rec = out['props'].setdefault(norm(name), {'name': name, 'game': key})
            rec[mk] = {'line': median(vals), 'books': 1, 'lines': sorted(set(vals))}
    out['as_of'] = out['updated']  # ESPN's lastUpdated stamps are not reliable; use fetch time
    json.dump(out, open(out_path, 'w'), separators=(',', ':'))
    print(f"market: week {week}, {len(out['games'])} games, {len(out['props'])} players with props, as of {out['as_of']}", out['unavailable'] or '')


if __name__ == '__main__':
    main(*sys.argv[1:])
