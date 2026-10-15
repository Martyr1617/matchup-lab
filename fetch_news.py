"""Build a compact site/news.json from free public NFL feeds.

Each source is isolated. A timeout, HTTP error, or bad payload is recorded
and the rest of the build continues. The script still writes a file and
exits 0, so a broken feed cannot fail the hourly data build.

X is not fetched. There is no free, reliable, rate-limit-safe route: the
official API is paid, and unofficial scrapers are not stable enough to call
every hour.
"""
import csv
import hashlib
import html
import json
import re
import sys
import unicodedata
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path

UA = 'MatchupLab/1.0 (fantasy research)'
MAX_ITEMS = 80
HEADLINE_MAX = 180
INJURY_RE = re.compile(
    r'\b(questionable|doubtful|ruled out|injured|injury|injuries|concussion|'
    r'hamstring|ankle|knee|groin|calf|quad|shoulder|illness|surgery|'
    r'physically unable|injured reserve|pup)\b|\bIR\b',
    re.I)
REPORT_STATUS = {'questionable', 'doubtful', 'out', 'ir', 'injured reserve', 'pup'}
ESPN_INJURY_STATUS = {'out', 'doubtful', 'questionable'}
SOURCES = (
    ('espn', 'ESPN', 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/news?limit=40'),
    ('espn_rss', 'ESPN', 'https://www.espn.com/espn/rss/nfl/news'),
    ('cbs', 'CBS Sports', 'https://www.cbssports.com/rss/headlines/nfl/'),
    ('yahoo', 'Yahoo Sports', 'https://sports.yahoo.com/nfl/rss/'),
    # NFL.com's public RSS URLs currently return the website, not a feed.
    ('nfl', 'NFL.com', 'https://www.nfl.com/rss/rsslanding?searchString=home'),
    ('espn_injuries', 'ESPN injuries', 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/injuries'),
)


def fold(text):
    raw = unicodedata.normalize('NFKD', str(text or ''))
    raw = raw.encode('ascii', 'ignore').decode().lower()
    raw = raw.replace('.', ' ').replace('-', ' ').replace("'", '')
    raw = re.sub(r'\b(jr|sr|ii|iii|iv|v)\b', ' ', raw)
    raw = re.sub(r'[^a-z0-9 ]+', ' ', raw)
    raw = re.sub(r'\s+', ' ', raw).strip()
    # "A.J. Brown" and "AJ Brown" both become "aj brown".
    return re.sub(r'\b([a-z]) (?=[a-z]\b)', r'\1', raw)


def clip(text, limit=HEADLINE_MAX):
    text = html.unescape(str(text or ''))
    text = re.sub(r'<[^>]+>', ' ', text)
    text = re.sub(r'\s+', ' ', text).strip()
    if len(text) <= limit:
        return text
    return text[: limit - 1].rstrip() + '…'


def parse_time(value):
    if not value:
        return None
    text = str(value).strip()
    try:
        if text.endswith('Z'):
            text = text[:-1] + '+00:00'
        dt = datetime.fromisoformat(text)
    except ValueError:
        try:
            dt = parsedate_to_datetime(str(value))
        except (TypeError, ValueError, IndexError):
            return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def item_id(source, url, headline):
    raw = f'{source}|{url}|{fold(headline)}'.encode()
    return hashlib.sha1(raw).hexdigest()[:12]


def index_players(players):
    rows = []
    for p in players or []:
        name = p.get('name') or ''
        folded = fold(name)
        if len(folded) < 5 or ' ' not in folded:
            continue
        rows.append({'id': p.get('id'), 'name': name, 'team': p.get('team') or '', 'folded': folded})
    rows.sort(key=lambda r: len(r['folded']), reverse=True)
    return rows


def index_teams(team_names):
    rows = []
    for abbr, full in (team_names or {}).items():
        parts = str(full).split()
        nick = parts[-1] if parts else ''
        rows.append({'abbr': abbr, 'full': full, 'nick': nick, 'folded_full': fold(full), 'folded_nick': fold(nick)})
    return rows


def match_player(text, players, teams=None):
    folded = f' {fold(text)} '
    hits = [p for p in players if f' {p["folded"]} ' in folded]
    if not hits:
        return None
    if len(hits) == 1:
        return hits[0]
    nick = {t['abbr']: t['folded_nick'] for t in teams or []}
    full = {t['abbr']: t['folded_full'] for t in teams or []}

    def rank(p):
        team_hit = 0
        n, f = nick.get(p['team'], ''), full.get(p['team'], '')
        if n and f' {n} ' in folded:
            team_hit = 1
        if f and f' {f} ' in folded:
            team_hit = 1
        if p['team'] and f' {p["team"].lower()} ' in folded:
            team_hit = 1
        return (team_hit, len(p['folded']))

    return max(hits, key=rank)


def match_team(text, teams):
    folded = f' {fold(text)} '
    hits = []
    for t in teams:
        nick = t['folded_nick']
        if f' {t["folded_full"]} ' in folded or (len(nick) >= 4 and f' {nick} ' in folded):
            hits.append(t['abbr'])
    hits = list(dict.fromkeys(hits))
    return hits[0] if len(hits) == 1 else None


def is_injury(*parts):
    for part in parts:
        cleaned = re.sub(r'\binjury reports?\b', ' ', part or '', flags=re.I)
        if INJURY_RE.search(cleaned):
            return True
    return False


def _near_name(folded_text, name):
    words = folded_text.split()
    wanted = name.split()
    windows = []
    for i in range(len(words) - len(wanted) + 1):
        if words[i:i + len(wanted)] == wanted:
            windows.append(' '.join(words[max(0, i - 6): i + len(wanted) + 6]))
    return windows


def injury_about(player, headline, description=''):
    """True when this story is about that player's injury, not a roundup that merely names him."""
    if not player:
        return is_injury(headline)
    windows = _near_name(fold(headline), player['folded']) + _near_name(fold(description), player['folded'])
    for window in windows:
        if not is_injury(window):
            continue
        cleared = re.search(r'full participant', window, re.I) and not re.search(
            r'questionable|doubtful|ruled out|did not|limited', window, re.I)
        if cleared:
            continue
        return True
    return False


def make_item(source, headline, url, ts, team, player, injury):
    headline = clip(headline)
    url = clip(url, 400)
    if not headline or not url or not url.startswith('http'):
        return None
    return {
        'id': item_id(source, url, headline),
        'headline': headline,
        'source': source,
        'url': url,
        'ts': ts,
        'team': team or None,
        'player_id': player['id'] if player else None,
        'player': player['name'] if player else None,
        'injury': bool(injury),
    }


def local_tag(tag):
    return tag.rsplit('}', 1)[-1]


def parse_rss(payload):
    root = ET.fromstring(payload)
    found = []
    for el in root.iter():
        if local_tag(el.tag) != 'item':
            continue
        fields = {}
        for child in list(el):
            fields.setdefault(local_tag(child.tag), ''.join(child.itertext()).strip())
        found.append(fields)
    return found


def parse_espn_news(payload):
    data = json.loads(payload)
    rows = []
    for art in data.get('articles') or []:
        web = ((art.get('links') or {}).get('web') or {}).get('href')
        team = None
        for cat in art.get('categories') or []:
            if cat.get('type') == 'team':
                team = ((cat.get('team') or {}).get('abbreviation')) or team
        rows.append({
            'headline': art.get('headline'),
            'description': art.get('description') or '',
            'url': web,
            'ts': parse_time(art.get('published') or art.get('lastModified')),
            'team': team,
        })
    return rows


def parse_espn_injuries(payload, players, teams):
    data = json.loads(payload)
    by_full = {fold(t['full']): t['abbr'] for t in teams}
    by_name = {p['folded']: p for p in players}
    rows = []
    for club in data.get('injuries') or []:
        abbr = by_full.get(fold(club.get('displayName')))
        for inj in club.get('injuries') or []:
            status = str(inj.get('status') or '').strip().lower()
            if status not in ESPN_INJURY_STATUS:
                continue
            athlete = inj.get('athlete') or {}
            name = athlete.get('displayName') or ''
            player = by_name.get(fold(name))
            if not player:
                continue
            detail = ((inj.get('details') or {}).get('detail')) or ((inj.get('details') or {}).get('type')) or ''
            comment = inj.get('shortComment') or ''
            headline = comment or f"{player['name']} is {inj.get('status')}" + (f' ({detail})' if detail else '')
            link = ''
            for candidate in athlete.get('links') or []:
                if 'playercard' in (candidate.get('rel') or []) and candidate.get('href'):
                    link = candidate['href']
                    break
            rows.append(make_item(
                'ESPN injuries', headline, link or 'https://www.espn.com/nfl/injuries',
                parse_time(inj.get('date')), player['team'] or abbr, player, True,
            ))
    return [r for r in rows if r]


def parse_nflverse_injuries(path, players):
    by_id = {p['id']: p for p in players if p.get('id')}
    latest = {}
    with open(path, newline='') as handle:
        for row in csv.DictReader(handle):
            try:
                week = int(row.get('week') or 0)
            except ValueError:
                continue
            pid = (row.get('gsis_id') or '').strip()
            if pid:
                latest[pid] = max(latest.get(pid, 0), week)
    if not latest:
        return []
    week = max(latest.values())
    rows = []
    with open(path, newline='') as handle:
        for row in csv.DictReader(handle):
            try:
                row_week = int(row.get('week') or 0)
            except ValueError:
                continue
            if row_week != week:
                continue
            status = (row.get('report_status') or '').strip()
            practice = (row.get('practice_status') or '').strip()
            injury = (row.get('report_primary_injury') or row.get('practice_primary_injury') or '').strip()
            if injury.lower().startswith('not injury'):
                injury = (row.get('report_secondary_injury') or row.get('practice_secondary_injury') or '').strip()
            if status.lower() not in REPORT_STATUS:
                if injury and not injury.lower().startswith('not injury') and re.search(r'did not participate|limited participation', practice, re.I):
                    status = 'DNP' if re.search(r'did not participate', practice, re.I) else 'limited'
                else:
                    continue
            player = by_id.get((row.get('gsis_id') or '').strip())
            if not player:
                continue
            extra = f', {injury}' if injury else ''
            headline = f"{player['name']} is {status}{extra} on the Week {week} injury report"
            rows.append(make_item(
                'nflverse', headline, 'https://github.com/nflverse/nflverse-data/releases/tag/injuries',
                datetime.fromtimestamp(Path(path).stat().st_mtime, timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
                player['team'] or row.get('team'), player, True,
            ))
    return rows


def http_get(url, timeout=20, limit=2_000_000):
    req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept': 'application/json, application/rss+xml, application/xml, text/xml, */*'})
    with urllib.request.urlopen(req, timeout=timeout) as res:
        ctype = (res.headers.get('content-type') or '').lower()
        data = res.read(limit + 1)
    head = data.lstrip()[:32].lower()
    if 'html' in ctype or head.startswith(b'<!doctype html') or head.startswith(b'<html'):
        raise ValueError('response was HTML, not a news feed')
    if len(data) > limit:
        raise ValueError(f'response larger than {limit} bytes')
    return data


def empty_doc(error=None):
    sources = [{'id': 'x', 'label': 'X', 'ok': False, 'skipped': True,
                'error': 'No free, reliable, rate-limit-safe route. The official API is paid and unofficial scrapers are not stable enough for an hourly job.'}]
    if error:
        sources.insert(0, {'id': 'news', 'label': 'News', 'ok': False, 'error': clip(error, 200)})
    return {
        'generated': datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC'),
        'stale': False,
        'items': [],
        'sources': sources,
    }


def add_items(bucket, seen, rows):
    added = 0
    for row in rows:
        if not row:
            continue
        key = fold(row['headline'])[:120]
        if key in seen or row['url'] in seen:
            continue
        seen.add(key)
        seen.add(row['url'])
        bucket.append(row)
        added += 1
    return added


def collect(players, team_names, getter, injury_csv=None):
    """getter(url, limit=...) -> bytes. Raises on failure."""
    plist = index_players(players)
    tlist = index_teams(team_names)
    items = []
    seen = set()
    sources = []
    limits = {'espn_injuries': 12_000_000, 'nfl': 64_000}

    def take_news(label, rows, team_from_row=False):
        built = []
        for row in rows:
            text = f"{row.get('headline') or ''} {row.get('description') or ''}"
            player = match_player(text, plist, tlist)
            team = row.get('team') if team_from_row else None
            if player:
                team = player['team'] or team
            elif not team:
                team = match_team(text, tlist)
            built.append(make_item(label, row.get('headline'), row.get('url'), row.get('ts'), team, player, injury_about(player, row.get('headline'), row.get('description'))))
        return add_items(items, seen, built)

    for sid, label, url in SOURCES:
        try:
            payload = getter(url, limit=limits.get(sid, 2_000_000))
            if sid == 'espn':
                count = take_news(label, parse_espn_news(payload), team_from_row=True)
            elif sid == 'espn_injuries':
                count = add_items(items, seen, parse_espn_injuries(payload, plist, tlist))
            else:
                rss = []
                for entry in parse_rss(payload):
                    rss.append({
                        'headline': entry.get('title'),
                        'description': entry.get('description') or '',
                        'url': entry.get('link'),
                        'ts': parse_time(entry.get('pubDate') or entry.get('date') or entry.get('updated')),
                    })
                count = take_news(label, rss)
            sources.append({'id': sid, 'label': label, 'ok': True, 'items': count})
        except Exception as exc:  # noqa: BLE001 — one feed must not sink the build
            sources.append({'id': sid, 'label': label, 'ok': False, 'error': clip(f'{type(exc).__name__}: {exc}', 200)})

    if injury_csv and Path(injury_csv).is_file():
        try:
            already = {row['player_id'] for row in items if row.get('injury') and row.get('player_id')}
            fresh = [row for row in parse_nflverse_injuries(injury_csv, plist) if row['player_id'] not in already]
            count = add_items(items, seen, fresh)
            sources.append({'id': 'nflverse_injuries', 'label': 'nflverse', 'ok': True, 'items': count})
        except Exception as exc:  # noqa: BLE001
            sources.append({'id': 'nflverse_injuries', 'label': 'nflverse', 'ok': False, 'error': clip(f'{type(exc).__name__}: {exc}', 200)})
    else:
        sources.append({'id': 'nflverse_injuries', 'label': 'nflverse', 'ok': False, 'error': 'injury file not on disk'})

    sources.append({
        'id': 'x', 'label': 'X', 'ok': False, 'skipped': True,
        'error': 'No free, reliable, rate-limit-safe route. The official API is paid and unofficial scrapers are not stable enough for an hourly job.',
    })
    items.sort(key=lambda row: row.get('ts') or '', reverse=True)
    # Keep injury rows even when the headline feeds are busy, so a starter's
    # injury is still on the player after the cap.
    injuries = [row for row in items if row.get('injury')][:25]
    keep = {row['id'] for row in injuries}
    rest = [row for row in items if row['id'] not in keep]
    chosen = sorted(injuries + rest[: max(0, MAX_ITEMS - len(injuries))], key=lambda row: row.get('ts') or '', reverse=True)
    return {
        'generated': datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC'),
        'stale': False,
        'items': chosen[:MAX_ITEMS],
        'sources': sources,
    }


def sources_all_failed(doc):
    real = [s for s in (doc or {}).get('sources') or [] if not s.get('skipped')]
    return bool(real) and all(not s.get('ok') for s in real)


def keep_previous(current, previous_path):
    """If this run produced nothing because every feed failed, keep the last file."""
    path = Path(previous_path) if previous_path else None
    if not path or not path.is_file():
        return current
    if current.get('items') or not sources_all_failed(current):
        return current
    try:
        previous = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError):
        return current
    if not previous.get('items'):
        return current
    previous['stale'] = True
    previous['stale_reason'] = 'News feeds failed; showing the last good file.'
    return previous


def write_news(doc, path):
    Path(path).write_text(json.dumps(doc, separators=(',', ':')))


def restore_previous(current_path='site/news.json', previous_path='/tmp/prev_news.json'):
    """Keep the last good news file when this run's feeds all failed."""
    path = Path(current_path)
    try:
        current = json.loads(path.read_text()) if path.is_file() else {'items': [], 'sources': [{'id': 'news', 'ok': False}]}
    except json.JSONDecodeError:
        current = {'items': [], 'sources': [{'id': 'news', 'ok': False}]}
    doc = keep_previous(current, previous_path)
    write_news(doc, path)
    print('news restore', 'items', len(doc.get('items') or []), 'stale', bool(doc.get('stale')))
    return 0


def main(data_path='site/data.json', out_path='site/news.json', previous_path=None, injury_csv='data/injuries_2026.csv'):
    try:
        data = json.loads(Path(data_path).read_text())
        doc = collect(data.get('players') or [], data.get('team_names') or {}, http_get, injury_csv)
    except Exception as exc:  # noqa: BLE001
        doc = empty_doc(f'{type(exc).__name__}: {exc}')
    doc = keep_previous(doc, previous_path)
    write_news(doc, out_path)
    ok = [s['id'] for s in doc['sources'] if s.get('ok')]
    bad = [s['id'] for s in doc['sources'] if not s.get('ok')]
    print('news', 'items', len(doc.get('items') or []), 'ok', ','.join(ok) or '-', 'failed', ','.join(bad) or '-', 'stale', bool(doc.get('stale')))
    return 0


if __name__ == '__main__':
    sys.exit(main(*sys.argv[1:]))
