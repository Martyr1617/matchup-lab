#!/usr/bin/env python3
"""Daily health check for Matchup Lab.

Looks at the hourly refresh, the Pages deploy, the files the app actually
loads, the projection board, and the live site. Prints a short line when
everything is fine. When something is wrong, opens or updates one GitHub
issue labeled health-check and assigned to Martyr1617. The next clean run
closes that issue. A clean run with no open issue stays quiet.

    python scripts/health_check.py --dry-run
    HEALTH_SIMULATE=failure python scripts/health_check.py
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from validate_publish import TEAMS, parse_generated  # noqa: E402

LIVE_SITE = 'https://martyr1617.github.io/matchup-lab/'
ASSIGNEE = 'Martyr1617'
LABEL = 'health-check'
TITLE = 'Matchup Lab health check failed'
GAP = timedelta(hours=3)
FRESH = timedelta(hours=3)
# A Monday night game can still be the current week until it ends and the
# next refresh sees the final score. Eight hours covers that, and the
# morning check is later than that.
LIVE_WINDOW = timedelta(hours=8)
ABSURD_POINTS = 45
LEADER_MIN = 14
LEADER_MAX = 40
USER_AGENT = 'MatchupLabHealth/1.0'


def parse_time(text):
    raw = str(text).strip().replace(' UTC', 'Z').replace(' ', 'T')
    if raw.endswith('Z'):
        raw = raw[:-1] + '+00:00'
    dt = datetime.fromisoformat(raw)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _hours(delta):
    return delta.total_seconds() / 3600


def nth_sunday(year, month, n):
    """Day-of-month of the nth Sunday. month is 1-12. Same rule as site/model.js."""
    first = datetime(year, month, 1, tzinfo=timezone.utc)
    js_dow = (first.weekday() + 1) % 7  # Sunday = 0, matching Date.getUTCDay
    return 1 + ((7 - js_dow) % 7) + 7 * (n - 1)


def kickoff_utc(game):
    """nflverse date/time are US Eastern. EDT from the second Sunday in March
    until the first Sunday in November."""
    year, month, day = (int(part) for part in str(game['date']).split('-'))
    hour, minute = (int(part) for part in str(game.get('time') or '13:00').split(':')[:2])
    start = datetime(year, 3, nth_sunday(year, 3, 2), tzinfo=timezone.utc)
    end = datetime(year, 11, nth_sunday(year, 11, 1), tzinfo=timezone.utc)
    local = datetime(year, month, day, tzinfo=timezone.utc)
    offset = 4 if start <= local < end else 5
    return datetime(year, month, day, hour, minute, tzinfo=timezone.utc) + timedelta(hours=offset)


def _schedule(data):
    raw = (data or {}).get('schedule') or {}
    out = {}
    for key, games in raw.items():
        try:
            week = int(key)
        except (TypeError, ValueError):
            continue
        out[week] = games or []
    return out


def expected_week(data, now):
    """Week the app should be projecting, from the schedule and the clock.

    Returns None when the regular season has no game inside the live window
    and none still ahead. The caller treats that as the offseason.
    """
    upcoming = []
    for week, games in _schedule(data).items():
        kicks = []
        for game in games:
            if not game.get('date'):
                continue
            try:
                kicks.append(kickoff_utc(game))
            except (TypeError, ValueError):
                continue
        if kicks and any(kick >= now - LIVE_WINDOW for kick in kicks):
            upcoming.append(week)
    return min(upcoming) if upcoming else None


def week_matches(data, now):
    """True when meta.next_week is the week the schedule says to project.

    The refresh rolls forward as soon as the previous week is final, which
    can be a few hours before this clock's 8-hour window lets go of Monday
    night. Both numbers are accepted in that stretch.
    """
    expected = expected_week(data, now)
    try:
        actual = int((data.get('meta') or {}).get('next_week'))
    except (TypeError, ValueError):
        return False, expected
    if expected is None:
        return True, expected
    if actual == expected:
        return True, expected
    if actual == expected + 1:
        games = _schedule(data).get(expected) or []
        kicks = []
        for game in games:
            if game.get('date'):
                try:
                    kicks.append(kickoff_utc(game))
                except (TypeError, ValueError):
                    continue
        if kicks and now - max(kicks) <= LIVE_WINDOW:
            return True, expected
    return False, expected


def season_of(data):
    games = _schedule(data).get(1) or []
    years = []
    for game in games:
        if game.get('date'):
            try:
                years.append(int(str(game['date'])[:4]))
            except ValueError:
                continue
    return min(years) if years else None


def _next_game(data, week):
    games = _schedule(data).get(week) or []
    dated = [game for game in games if game.get('date')]
    if not dated:
        return None
    dated.sort(key=lambda game: (game.get('date'), game.get('time') or ''))
    game = dated[0]
    return f"{game.get('away')} at {game.get('home')} on {game.get('date')}"


def check_data(data, now):
    problems = []
    meta = (data or {}).get('meta') or {}
    players = (data or {}).get('players') or []
    if len(players) <= 300:
        problems.append(
            f"data.json lists {len(players)} players. A full season file has more than 300."
        )
    missing = sorted(TEAMS - set((data or {}).get('defense') or {}))
    if missing:
        shown = ', '.join(missing[:8])
        extra = f" and {len(missing) - 8} more" if len(missing) > 8 else ''
        problems.append(f"The defense table is missing {len(missing)} of the 32 teams ({shown}{extra}).")
    generated = meta.get('generated')
    try:
        stamp = parse_generated(generated or '')
    except (TypeError, ValueError):
        problems.append(f"data.json has no usable generated time ({generated!r}).")
        stamp = None
    if stamp is not None:
        age = now - stamp
        if age > FRESH or age < timedelta(minutes=-15):
            problems.append(
                f"data.json was generated {generated}, {_hours(age):.1f} hours from now. "
                "The hourly refresh should keep that under about 3 hours."
            )
    try:
        season = int(meta.get('season'))
    except (TypeError, ValueError):
        season = None
        problems.append(f"data.json season {meta.get('season')!r} is not a year.")
    expected_season = season_of(data)
    if season is not None and expected_season is not None and season != expected_season:
        problems.append(
            f"data.json says the {season} season, but week 1 on its schedule is {expected_season}."
        )
    ok, expected = week_matches(data, now)
    if expected is None:
        latest = None
        for week, games in _schedule(data).items():
            for game in games:
                if not game.get('date'):
                    continue
                try:
                    kick = kickoff_utc(game)
                except (TypeError, ValueError):
                    continue
                if latest is None or kick > latest:
                    latest = kick
        if latest is not None and now - latest > timedelta(days=14):
            pass  # offseason: the week number is not a live-site failure
        elif latest is not None:
            problems.append(
                "The schedule has no upcoming game, so the current week could not be confirmed."
            )
    elif not ok:
        nxt = _next_game(data, expected)
        where = f" The next game on the schedule is {nxt}." if nxt else ''
        problems.append(
            f"data.json is projecting week {meta.get('next_week')} of {meta.get('season')}, "
            f"but the current NFL week is week {expected}.{where}"
        )
    return problems


def check_market(market, data, now):
    problems = []
    if not isinstance(market, dict) or not market:
        return ['market.json is missing, so the app has no spreads, totals, or prop lines.']
    try:
        week = int((data.get('meta') or {}).get('next_week'))
    except (TypeError, ValueError):
        week = None
    try:
        market_week = int(market.get('week'))
    except (TypeError, ValueError):
        market_week = None
        problems.append(f"market.json week {market.get('week')!r} is not a week number.")
    if week is not None and market_week is not None and market_week != week:
        problems.append(
            f"market.json is still week {market_week}, while data.json is projecting week {week}."
        )
    if market.get('stale'):
        reason = market.get('stale_reason') or 'the last odds fetch did not land'
        problems.append(f"market.json is marked stale ({reason}).")
    stamp_text = market.get('as_of') or market.get('updated')
    try:
        stamp = parse_time(stamp_text) if stamp_text else None
    except (TypeError, ValueError):
        stamp = None
    if stamp is None:
        problems.append('market.json has no as_of time, so its age cannot be checked.')
    else:
        age = now - stamp
        if age > FRESH or age < timedelta(minutes=-15):
            problems.append(
                f"market.json was fetched {stamp_text}, {_hours(age):.1f} hours from now. "
                "Odds should refresh with the hourly run, inside about 3 hours."
            )
    games = market.get('games') or {}
    scheduled = len(_schedule(data).get(week or -1) or []) if week else 0
    if not isinstance(games, dict) or len(games) < 8 or (scheduled and len(games) + 2 < scheduled):
        problems.append(
            f"market.json has {len(games) if isinstance(games, dict) else 0} games"
            + (f" and the schedule has {scheduled}." if scheduled else ".")
        )
    return problems


def check_projections(rows):
    """rows come from health_projections.js. Backups who never played are skipped."""
    problems = []
    finite = []
    bad = []
    for row in rows or []:
        if row.get('bye'):
            continue
        pts = row.get('pts')
        usable = isinstance(pts, (int, float)) and pts == pts
        if row.get('played') and (not usable or pts < 0 or pts > ABSURD_POINTS):
            bad.append(row)
        elif usable:
            finite.append(row)
    if bad:
        sample = ', '.join(f"{row.get('name')} ({row.get('pos')})" for row in bad[:5])
        more = f", plus {len(bad) - 5} more" if len(bad) > 5 else ''
        problems.append(
            f"{len(bad)} players who have actually played project as missing, not a number, "
            f"negative, or over {ABSURD_POINTS} points. For example: {sample}{more}."
        )
    if len(finite) < 120:
        problems.append(
            f"Only {len(finite)} players have a numeric projection. A normal week scores well over 120."
        )
    if not finite:
        return problems
    leader = max(finite, key=lambda row: row['pts'])
    if not LEADER_MIN <= leader['pts'] <= LEADER_MAX:
        problems.append(
            f"The top of the board is {leader.get('name')} at {leader['pts']:.1f} points. "
            f"A normal week has the leader between {LEADER_MIN} and {LEADER_MAX}."
        )
    counts = {
        'QB': (10, 8, 'quarterback'),
        'RB': (8, 10, 'running back'),
        'WR': (8, 15, 'wide receiver'),
        'TE': (6, 3, 'tight end'),
    }
    for pos, (floor, need, label) in counts.items():
        have = sum(1 for row in finite if row.get('pos') == pos and row['pts'] >= floor)
        if have < need:
            problems.append(
                f"Only {have} {label}s project at {floor} points or more. A normal board has at least {need}."
            )
    return problems


def _recent_successes(runs, now, status_key='status'):
    out = []
    for run in runs or []:
        if run.get(status_key) != 'completed' or run.get('conclusion') != 'success':
            continue
        try:
            started = parse_time(run.get('createdAt'))
        except (TypeError, ValueError):
            continue
        if now - started <= timedelta(hours=26):
            out.append(run)
    out.sort(key=lambda run: parse_time(run['createdAt']))
    return out


def check_refresh(runs, now):
    problems = []
    completed = []
    for run in runs or []:
        if run.get('status') != 'completed':
            continue
        try:
            parse_time(run.get('createdAt'))
        except (TypeError, ValueError):
            continue
        completed.append(run)
    successes = [run for run in completed if run.get('conclusion') == 'success']
    if not successes:
        return ['The hourly data refresh has no successful run to point at.']
    last = max(successes, key=lambda run: parse_time(run.get('updatedAt') or run['createdAt']))
    finished = parse_time(last.get('updatedAt') or last['createdAt'])
    age = now - finished
    if age > GAP:
        problems.append(
            f"The hourly data refresh last succeeded {_hours(age):.1f} hours ago. "
            f"It should finish at least every 3 hours. {last.get('url') or ''}".rstrip()
        )
    recent = _recent_successes(runs, now)
    for earlier, later in zip(recent, recent[1:]):
        gap = parse_time(later['createdAt']) - parse_time(earlier['createdAt'])
        if gap > GAP:
            problems.append(
                f"The hourly data refresh has a {_hours(gap):.1f} hour gap between successful runs "
                f"({earlier.get('createdAt')} to {later.get('createdAt')}). A gap over about 3 hours "
                f"means at least one hourly rebuild did not land. {later.get('url') or ''}".rstrip()
            )
    if completed:
        newest = max(completed, key=lambda run: parse_time(run['createdAt']))
        if newest.get('conclusion') != 'success':
            problems.append(
                f"The latest data refresh finished as {newest.get('conclusion')}, not success. "
                f"{newest.get('url') or ''}".rstrip()
            )
    return problems


def check_deploy(runs, main_sha, main_at, now):
    """Pages deploys on push, not every hour. Fail a failed deploy, or a commit
    that has been sitting unpublished for more than about 3 hours."""
    if not runs:
        return ['The Pages deploy has no runs, so the live site may never have been published.']
    completed = []
    for run in runs:
        if run.get('status') != 'completed':
            continue
        try:
            parse_time(run.get('createdAt'))
        except (TypeError, ValueError):
            continue
        completed.append(run)
    if not completed:
        return ['The Pages deploy has not finished a run yet.']
    latest = max(completed, key=lambda run: parse_time(run['createdAt']))
    if latest.get('conclusion') != 'success':
        return [
            f"The latest Pages deploy finished as {latest.get('conclusion')}, not success. "
            f"{latest.get('url') or ''}".rstrip()
        ]
    if not main_sha or latest.get('headSha') == main_sha:
        return []
    age = now - main_at if main_at is not None else GAP + timedelta(hours=1)
    publishing = any(
        run.get('headSha') == main_sha and run.get('status') in ('queued', 'in_progress', 'waiting', 'pending', 'requested')
        for run in runs
    )
    if age <= GAP or publishing:
        return []
    return [
        f"Main was updated {_hours(age):.1f} hours ago and the latest successful Pages deploy "
        f"is still an older commit. The live site is not serving the current build. "
        f"{latest.get('url') or ''}".rstrip()
    ]


def check_site(status, live_ver, repo_ver, error=None):
    if error:
        return [f"The live site {LIVE_SITE} could not be reached ({error})."]
    if status != 200:
        return [f"The live site {LIVE_SITE} returned {status}, not 200."]
    if not live_ver:
        return [f"The live site {LIVE_SITE} returned 200 but the page has no build id."]
    if repo_ver and live_ver != repo_ver:
        return [
            f"The live site is serving build {live_ver}, and main is build {repo_ver}. "
            "The page is up, but it is not the current build."
        ]
    return []


def build_version(html):
    import re
    match = re.search(r'window\.ML_VER="([0-9a-fA-F]+)"', html or '')
    return match.group(1) if match else None


def plan_issue(problems, open_issues):
    """What to do with the one health-check issue. Silent when healthy and none is open."""
    if problems:
        return 'comment' if open_issues else 'create'
    if open_issues:
        return 'close'
    return 'silent'


def issue_body(problems, now, run_url):
    simulated = any(str(item).startswith('Simulated failure') for item in problems)
    lines = []
    if simulated:
        lines.append('This message is a test of the health-check alert, not by itself a live outage.')
        lines.append('')
    lines.append('Matchup Lab failed its health check.')
    lines.append('')
    lines.append('What went wrong:')
    for item in problems:
        lines.append(f'- {item}')
    lines.append('')
    lines.append(f"Checked at {now.strftime('%Y-%m-%d %H:%M')} UTC.")
    if run_url:
        lines.append(f'Workflow run: {run_url}')
    lines.append('')
    lines.append('This issue stays open until a later check passes, then it closes itself. A later failure comments here instead of opening a second issue.')
    return '\n'.join(lines) + '\n'


def close_comment(now, run_url):
    lines = [
        f"Matchup Lab passed its health check at {now.strftime('%Y-%m-%d %H:%M')} UTC, so this issue is closed.",
    ]
    if run_url:
        lines.append(f'Workflow run: {run_url}')
    return '\n'.join(lines) + '\n'


def simulated_problem():
    return (
        'Simulated failure: this run was asked to fail so the alert path could be tested. '
        'If this is the only bullet, the app itself looked fine and the next check will close this issue.'
    )


def _gh(args, check=True):
    proc = subprocess.run(['gh', *args], text=True, capture_output=True)
    if check and proc.returncode != 0:
        sys.stderr.write(proc.stderr or proc.stdout or '')
        raise SystemExit(proc.returncode or 1)
    return proc


def _repo():
    slug = os.environ.get('GITHUB_REPOSITORY')
    if slug:
        return slug
    url = subprocess.check_output(['git', 'remote', 'get-url', 'origin'], text=True).strip()
    import re
    match = re.search(r'github\.com[:/](.+?)(?:\.git)?$', url)
    if not match:
        raise SystemExit(f'cannot parse origin remote: {url}')
    return match.group(1)


def _run_url():
    server = os.environ.get('GITHUB_SERVER_URL') or 'https://github.com'
    repo = os.environ.get('GITHUB_REPOSITORY')
    run_id = os.environ.get('GITHUB_RUN_ID')
    if repo and run_id:
        return f'{server}/{repo}/actions/runs/{run_id}'
    return ''


def ensure_label(repo):
    listed = _gh(['label', 'list', '--repo', repo, '--limit', '50', '--json', 'name'], check=False)
    names = []
    if listed.returncode == 0 and listed.stdout.strip():
        names = [row.get('name') for row in json.loads(listed.stdout)]
    if LABEL in names:
        return
    _gh(['label', 'create', LABEL, '--repo', repo, '--color', 'B60205', '--description', 'Daily Matchup Lab health check'])


def open_health_issues(repo):
    proc = _gh([
        'issue', 'list', '--repo', repo, '--state', 'open', '--label', LABEL,
        '--limit', '20', '--json', 'number,title',
    ])
    return json.loads(proc.stdout or '[]')


def sync_issue(problems, now, repo):
    """Create, comment, or close the single health-check issue. No-op when healthy and quiet."""
    ensure_label(repo)
    existing = open_health_issues(repo)
    action = plan_issue(problems, existing)
    if action == 'silent':
        return action
    run_url = _run_url()
    if action == 'create':
        _gh([
            'issue', 'create', '--repo', repo, '--title', TITLE,
            '--body', issue_body(problems, now, run_url),
            '--label', LABEL, '--assignee', ASSIGNEE,
        ])
        return action
    if action == 'comment':
        body = issue_body(problems, now, run_url)
        for issue in existing:
            _gh(['issue', 'comment', '--repo', repo, str(issue['number']), '--body', body])
            _gh(['issue', 'edit', '--repo', repo, str(issue['number']), '--add-assignee', ASSIGNEE], check=False)
        return action
    comment = close_comment(now, run_url)
    for issue in existing:
        _gh(['issue', 'comment', '--repo', repo, str(issue['number']), '--body', comment])
        _gh(['issue', 'close', '--repo', repo, str(issue['number']), '--reason', 'completed'])
    return action


def _fetch(url):
    req = urllib.request.Request(url, headers={'User-Agent': USER_AGENT, 'Cache-Control': 'no-cache'})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return resp.status, resp.read()


def _load_runs(workflow, repo):
    proc = _gh([
        'run', 'list', '--repo', repo, '--workflow', workflow, '--limit', '40',
        '--json', 'databaseId,conclusion,status,createdAt,updatedAt,headSha,event,url',
    ])
    return json.loads(proc.stdout or '[]')


def _main_commit(repo):
    proc = _gh(['api', f'repos/{repo}/commits/main', '--jq', '{sha:.sha,date:.commit.committer.date}'])
    return json.loads(proc.stdout)


def project_rows(data_path, market_path):
    proc = subprocess.run(
        ['node', 'scripts/health_projections.js', str(data_path), str(market_path or '')],
        cwd=ROOT, text=True, capture_output=True,
    )
    if proc.returncode != 0:
        raise SystemExit(proc.stderr or proc.stdout or 'projection check failed')
    return json.loads(proc.stdout).get('rows') or []


def evaluate(data, market, rows, refresh_runs, deploy_runs, main_sha, main_at, site_status, live_ver, repo_ver, now, site_error=None):
    problems = []
    if data is None:
        problems.append('data.json could not be downloaded from the data branch.')
    else:
        problems.extend(check_data(data, now))
    problems.extend(check_market(market, data or {}, now))
    if rows is None:
        problems.append('Projections could not be built from data.json.')
    else:
        problems.extend(check_projections(rows))
    problems.extend(check_refresh(refresh_runs, now))
    problems.extend(check_deploy(deploy_runs, main_sha, main_at, now))
    problems.extend(check_site(site_status, live_ver, repo_ver, error=site_error))
    return problems


def collect_live(repo, now):
    problems_fetch = []
    data = market = None
    data_path = market_path = None
    try:
        status, raw = _fetch(f'https://raw.githubusercontent.com/{repo}/data/data.json?t={int(now.timestamp())}')
        if status != 200:
            problems_fetch.append(f'data.json download returned {status}.')
        else:
            data = json.loads(raw.decode('utf-8'))
    except Exception as exc:  # noqa: BLE001
        problems_fetch.append(f'data.json could not be downloaded ({exc}).')
    try:
        status, raw = _fetch(f'https://raw.githubusercontent.com/{repo}/data/market.json?t={int(now.timestamp())}')
        if status != 200:
            problems_fetch.append(f'market.json download returned {status}.')
        else:
            market = json.loads(raw.decode('utf-8'))
    except Exception as exc:  # noqa: BLE001
        problems_fetch.append(f'market.json could not be downloaded ({exc}).')
    rows = None
    if data is not None:
        with tempfile.TemporaryDirectory() as tmp:
            data_path = Path(tmp) / 'data.json'
            data_path.write_text(json.dumps(data))
            market_path = None
            if market is not None:
                market_path = Path(tmp) / 'market.json'
                market_path.write_text(json.dumps(market))
            try:
                rows = project_rows(data_path, market_path)
            except SystemExit as exc:
                problems_fetch.append(f'Projections could not be built ({exc}).')
                rows = None
    try:
        site_status, site_raw = _fetch(LIVE_SITE + f'?t={int(now.timestamp())}')
        live_ver = build_version(site_raw.decode('utf-8', 'replace'))
        site_error = None
    except Exception as exc:  # noqa: BLE001
        site_status, live_ver, site_error = None, None, str(exc)
    try:
        _, html = _fetch(f'https://raw.githubusercontent.com/{repo}/main/site/index.html?t={int(now.timestamp())}')
        repo_ver = build_version(html.decode('utf-8', 'replace'))
    except Exception as exc:  # noqa: BLE001
        repo_ver = None
        problems_fetch.append(f"The build id on main could not be read ({exc}).")
    refresh_runs = _load_runs('refresh.yml', repo)
    deploy_runs = _load_runs('pages.yml', repo)
    commit = _main_commit(repo)
    main_at = parse_time(commit['date'])
    problems = problems_fetch + evaluate(
        data, market, rows, refresh_runs, deploy_runs,
        commit.get('sha'), main_at, site_status, live_ver, repo_ver, now, site_error=site_error,
    )
    return problems


def main(argv=None):
    parser = argparse.ArgumentParser(description='Check Matchup Lab and alert on failure.')
    parser.add_argument('--dry-run', action='store_true', help='Print the result and do not touch GitHub issues.')
    parser.add_argument('--simulate', default='', help='Pass "failure" to exercise the alert.')
    args = parser.parse_args(argv)
    simulate = args.simulate or os.environ.get('HEALTH_SIMULATE') or ''
    now = datetime.now(timezone.utc)
    repo = _repo()
    problems = collect_live(repo, now)
    if simulate.strip().lower() == 'failure':
        problems.insert(0, simulated_problem())
    if problems:
        sys.stdout.write(issue_body(problems, now, _run_url()))
    action = 'dry-run'
    if not args.dry_run:
        action = sync_issue(problems, now, repo)
    if problems:
        sys.stdout.write(f'issue action: {action}\n')
        return 1
    # One line in the Actions log. No issue, so Nathan is not emailed.
    sys.stdout.write('Matchup Lab health check passed.\n')
    if action == 'close':
        sys.stdout.write('Closed the open health-check issue.\n')
    return 0


if __name__ == '__main__':
    sys.exit(main())
