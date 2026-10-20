"""Health check rules: freshness, the board, workflow gaps, and one issue."""
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))

import health_check as health  # noqa: E402
from validate_publish import TEAMS  # noqa: E402

NOW = datetime(2026, 10, 20, 18, 0, tzinfo=timezone.utc)


def _game(date, time, away, home):
    return {'date': date, 'time': time, 'away': away, 'home': home}


def _data():
    schedule = {
        '1': [_game('2026-09-10', '20:15', 'DAL', 'PHI')],
        '6': [_game('2026-10-15', '20:15', 'SEA', 'DEN'), _game('2026-10-19', '20:15', 'WAS', 'SF')],
        '7': [_game('2026-10-22', '20:15', 'NE', 'CHI'), _game('2026-10-26', '20:15', 'DAL', 'PHI')],
    }
    return {
        'players': [{'id': i} for i in range(320)],
        'defense': {team: {} for team in TEAMS},
        'meta': {'season': 2026, 'next_week': 7, 'generated': '2026-10-20 16:30 UTC'},
        'schedule': schedule,
    }


def _market():
    return {
        'week': 7,
        'as_of': '2026-10-20T17:30:00Z',
        'games': {f'G{i}': {} for i in range(14)},
    }


def _row(name, pos, pts, played=True):
    return {'name': name, 'pos': pos, 'pts': pts, 'played': played, 'bye': False}


def _board():
    rows = []
    for i in range(12):
        rows.append(_row(f'QB{i}', 'QB', 18 - i * 0.4))
    for i in range(16):
        rows.append(_row(f'RB{i}', 'RB', 22 - i * 0.5))
    for i in range(20):
        rows.append(_row(f'WR{i}', 'WR', 20 - i * 0.4))
    for i in range(8):
        rows.append(_row(f'TE{i}', 'TE', 14 - i * 0.5))
    for i in range(80):
        rows.append(_row(f'Depth{i}', 'WR', 4))
    rows.append(_row('Backup', 'QB', None, played=False))
    return rows


def _run(created, conclusion='success', status='completed', sha='abc', updated=None):
    return {
        'status': status,
        'conclusion': conclusion,
        'createdAt': created,
        'updatedAt': updated or created,
        'headSha': sha,
        'url': 'https://example.test/run',
    }


def test_thursday_night_kickoff_is_eight_fifteen_eastern():
    assert health.kickoff_utc(_game('2026-10-22', '20:15', 'NE', 'CHI')) == datetime(2026, 10, 23, 0, 15, tzinfo=timezone.utc)


def test_current_week_on_a_tuesday_is_the_upcoming_slate():
    assert health.expected_week(_data(), NOW) == 7
    ok, _expected = health.week_matches(_data(), NOW)
    assert ok


def test_monday_night_still_counts_as_the_current_week():
    during = datetime(2026, 10, 20, 1, 0, tzinfo=timezone.utc)
    assert health.expected_week(_data(), during) == 6
    rolled = _data()
    rolled['meta']['next_week'] = 7
    # A few hours after kickoff the refresh may already have moved on.
    ok, _expected = health.week_matches(rolled, during + timedelta(hours=3))
    assert ok


def test_fresh_files_pass():
    assert health.check_data(_data(), NOW) == []
    assert health.check_market(_market(), _data(), NOW) == []
    assert health.check_projections(_board()) == []


def test_stale_data_short_roster_and_a_missing_defense_fail():
    data = _data()
    data['meta']['generated'] = '2026-10-20 10:00 UTC'
    data['players'] = data['players'][:300]
    data['defense'].pop('NYJ')
    data['meta']['next_week'] = 6
    text = ' '.join(health.check_data(data, NOW))
    assert 'more than 300' in text
    assert 'NYJ' in text
    assert 'week 6' in text and 'week 7' in text
    assert '3 hours' in text


def test_market_must_be_this_week_and_recent():
    old = _market()
    old['week'] = 6
    old['as_of'] = '2026-10-20T08:00:00Z'
    old['stale'] = True
    old['stale_reason'] = 'ESPN fetch failed'
    old['games'] = {}
    text = ' '.join(health.check_market(old, _data(), NOW))
    assert 'week 6' in text and 'week 7' in text
    assert 'stale' in text
    assert '3 hours' in text
    assert '0 games' in text


def test_played_nan_negative_and_absurd_fail_and_a_backup_nan_does_not():
    rows = _board()
    rows.append(_row('Joe Flacco', 'QB', None, played=False))
    assert health.check_projections(rows) == []
    rows.append(_row('Real Starter', 'WR', None, played=True))
    rows.append(_row('Minus', 'RB', -2, played=True))
    rows.append(_row('Giant', 'QB', 80, played=True))
    text = ' '.join(health.check_projections(rows))
    assert 'Real Starter' in text and 'Minus' in text and 'Giant' in text
    assert 'Joe Flacco' not in text


def test_a_flat_board_does_not_look_reasonable():
    rows = [_row(f'P{i}', 'WR', 3) for i in range(130)]
    text = ' '.join(health.check_projections(rows))
    assert 'top of the board' in text
    assert 'quarterback' in text


def test_refresh_gap_and_a_failed_run():
    fine = [
        _run('2026-10-20T15:30:00Z', updated='2026-10-20T15:35:00Z'),
        _run('2026-10-20T16:30:00Z', updated='2026-10-20T16:35:00Z'),
        _run('2026-10-20T17:30:00Z', updated='2026-10-20T17:35:00Z'),
    ]
    assert health.check_refresh(fine, NOW) == []
    gapped = [
        _run('2026-10-20T12:00:00Z', updated='2026-10-20T12:05:00Z'),
        _run('2026-10-20T17:00:00Z', updated='2026-10-20T17:05:00Z'),
    ]
    assert 'gap' in ' '.join(health.check_refresh(gapped, NOW))
    failed = fine + [_run('2026-10-20T17:40:00Z', conclusion='failure', updated='2026-10-20T17:50:00Z')]
    assert 'not success' in ' '.join(health.check_refresh(failed, NOW))


def test_deploy_allows_a_push_that_is_still_publishing():
    runs = [_run('2026-10-18T01:29:00Z', sha='old', updated='2026-10-18T01:30:00Z')]
    recent_main = NOW - timedelta(minutes=20)
    assert health.check_deploy(runs, 'new', recent_main, NOW) == []
    stale_main = NOW - timedelta(hours=5)
    text = ' '.join(health.check_deploy(runs, 'new', stale_main, NOW))
    assert 'older commit' in text
    runs.append(_run('2026-10-20T17:00:00Z', conclusion='failure', sha='new'))
    assert 'not success' in ' '.join(health.check_deploy(runs, 'new', NOW, NOW))
    assert health.check_deploy([_run('2026-10-20T17:10:00Z', sha='new')], 'new', NOW, NOW) == []


def test_live_site_must_be_200_and_the_current_build():
    assert health.check_site(200, 'abc', 'abc') == []
    assert '404' in ' '.join(health.check_site(404, None, 'abc'))
    assert 'not the current build' in ' '.join(health.check_site(200, 'old', 'abc'))
    assert health.build_version('<script>window.ML_VER="4a93e5c8f4";</script>') == '4a93e5c8f4'


def test_one_issue_is_updated_and_a_clean_run_is_silent():
    assert health.plan_issue(['broken'], []) == 'create'
    assert health.plan_issue(['broken'], [{'number': 7}]) == 'comment'
    assert health.plan_issue([], [{'number': 7}]) == 'close'
    assert health.plan_issue([], []) == 'silent'
    body = health.issue_body([health.simulated_problem()], NOW, 'https://example.test/run')
    assert 'test of the health-check alert' in body
    assert 'Simulated failure' in body
    assert 'second issue' in body
    assert 'closed' in health.close_comment(NOW, 'https://example.test/run')
