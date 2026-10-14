"""Publish checks beyond the old player-count assert."""
from datetime import datetime, timezone

from validate_publish import EXPECTED_AVAIL, TEAMS, mark_market_stale, validate


def _ok():
    return {
        'players': [{'id': i} for i in range(201)],
        'meta': {'next_week': 6, 'generated': '2026-10-14 11:00 UTC'},
        'defense': {tm: {} for tm in TEAMS},
        'avail': {key: True for key in EXPECTED_AVAIL},
    }


NOW = datetime(2026, 10, 14, 12, 0, tzinfo=timezone.utc)


def test_current_shape_passes():
    assert validate(_ok(), now=NOW) == []


def test_next_week_generated_defense_and_avail():
    late = _ok()
    late['meta'] = {'next_week': 19, 'generated': '2026-10-14 11:00 UTC'}
    assert any('next_week' in err for err in validate(late, now=NOW))

    stale = _ok()
    stale['meta'] = {'next_week': 6, 'generated': '2026-10-13 00:00 UTC'}
    assert any('not recent' in err for err in validate(stale, now=NOW))

    short = _ok()
    short['defense'] = {'BUF': {}}
    assert any('missing teams' in err for err in validate(short, now=NOW))

    blind = _ok()
    blind['avail'] = {'pbp': True}
    assert any('avail flags' in err for err in validate(blind, now=NOW))


def test_stale_market_keeps_the_lines():
    kept = mark_market_stale({'week': 6, 'games': {'a': 1}, 'props': {'x': {}}}, 'fetch failed')
    assert kept['stale'] is True
    assert kept['week'] == 6
    assert kept['games']['a'] == 1
    assert 'fetch failed' in kept['stale_reason']
