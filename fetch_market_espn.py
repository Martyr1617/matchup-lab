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


def regular_season_week(week):
    """ESPN seasontype=2 is the regular season and only lines up with weeks 1-18."""
    try:
        week = int(week)
    except (TypeError, ValueError):
        return False
    return 1 <= week <= 18


def favorites_agree(espn_spread_home, nfl_spread_line, pickem=0.5):
    """True when ESPN and nflverse name the same favorite.

    ESPN's scoreboard `spread` is from the home team's perspective (negative
    means the home team is favored). nflverse `spread_line` is positive when
    the home team is favored, and the app turns that into a home perspective
    with a minus sign. A sign mismatch would silently invert the Vegas adjustment.
    Pick'ems (either side inside `pickem`) are not treated as a disagreement.
    """
    if espn_spread_home is None or nfl_spread_line is None:
        return True
    espn = float(espn_spread_home)
    home_from_nfl = -float(nfl_spread_line)
    if abs(espn) < pickem or abs(home_from_nfl) < pickem:
        return True
    return (espn < 0) == (home_from_nfl < 0)


def schedule_spreads(data, week):
    games = (data.get('schedule') or {}).get(str(week))
    if games is None:
        games = (data.get('schedule') or {}).get(week) or []
    return {(g.get('away'), g.get('home')): g.get('spread_line') for g in games}


def main(data_path='site/data.json', out_path='site/market.json'):
    data = json.load(open(data_path))
    season, week = data['meta']['season'], data['meta']['next_week']
    if not regular_season_week(week):
        out = {'week': week, 'updated': datetime.now(timezone.utc).isoformat(), 'books': ['DraftKings'],
               'source': 'ESPN (DraftKings)', 'games': {}, 'props': {}, 'as_of': datetime.now(timezone.utc).isoformat(),
               'unavailable': [f'Week {week} is outside the regular season. seasontype=2 was not queried, because that feed is the regular-season slate.']}
        json.dump(out, open(out_path, 'w'), separators=(',', ':'))
        print(f'SKIP market: week {week} is not a regular-season week; did not call ESPN seasontype=2')
        return
    espn2name = {str(p['ids']['espn']): p['name'] for p in data['players'] if p.get('ids', {}).get('espn')}
    spreads = schedule_spreads(data, week)
    sb = get(f'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?week={week}&seasontype=2&dates={season}')
    out = {'week': week, 'updated': datetime.now(timezone.utc).isoformat(), 'books': ['DraftKings'], 'source': 'ESPN (DraftKings)',
           'games': {}, 'props': {}, 'unavailable': []}
    compared = mismatches = 0
    latest = ''
    for ev in sb.get('events', []):
        comp = ev['competitions'][0]
        teams = {c['homeAway']: ABBR.get(c['team']['abbreviation'], c['team']['abbreviation']) for c in comp['competitors']}
        home, away = teams.get('home'), teams.get('away')
        key = f'{away}@{home}'
        odds = (comp.get('odds') or [{}])[0]
        g = {'home': home, 'away': away, 'spread_home': None, 'total': odds.get('overUnder')}
        if odds.get('spread') is not None:
            # ESPN 'spread' is from the home team's perspective (negative = home favored).
            # Checked below against nflverse spread_line, which is positive when home is favored.
            espn_spread = float(odds['spread'])
            nfl_line = spreads.get((away, home))
            if nfl_line is not None and abs(float(espn_spread)) >= 0.5 and abs(float(nfl_line)) >= 0.5:
                compared += 1
                if not favorites_agree(espn_spread, nfl_line):
                    mismatches += 1
                    msg = (f'{key}: ESPN spread {espn_spread} and nflverse spread_line {nfl_line} disagree on the favorite; '
                           'skipped so the Vegas adjustment cannot flip')
                    print('SPREAD MISMATCH', msg)
                    out['unavailable'].append(msg)
                    espn_spread = None
            g['spread_home'] = espn_spread
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
    if compared >= 4 and mismatches / compared > 0.5:
        raise SystemExit(
            f'ESPN spread sign disagrees with nflverse on {mismatches} of {compared} games. '
            'Refusing to write market.json so a flipped favorite cannot reach the app.')
    if mismatches:
        print(f'SPREAD: skipped {mismatches} of {compared} games whose favorite did not match nflverse')
    json.dump(out, open(out_path, 'w'), separators=(',', ':'))
    print(f"market: week {week}, {len(out['games'])} games, {len(out['props'])} players with props, as of {out['as_of']}", out['unavailable'] or '')


if __name__ == '__main__':
    main(*sys.argv[1:])
