"""Snap share becomes implied volume, and a missing snap file changes nothing."""
import pandas as pd

from build_data import attach_snap_share


def _players():
    return [
        {'id': 'qb', 'pos': 'QB', 'log': [
            {'wk': 1, 'pa': 30, 'ca': 2, 'tg': 0},
            {'wk': 2, 'pa': 10, 'ca': 1, 'tg': 0},
        ]},
        {'id': 'qb2', 'pos': 'QB', 'log': [{'wk': 1, 'pa': 20, 'ca': 1, 'tg': 0}]},
        {'id': 'wr', 'pos': 'WR', 'log': [{'wk': 2, 'pa': 0, 'ca': 0, 'tg': 4}]},
        {'id': 'miss', 'pos': 'RB', 'log': [{'wk': 1, 'pa': 0, 'ca': 8, 'tg': 2}]},
    ]


def _snaps():
    return pd.DataFrame([
        {'game_type': 'REG', 'week': 1, 'pfr_player_id': 'A', 'offense_pct': 1.0},
        {'game_type': 'REG', 'week': 2, 'pfr_player_id': 'A', 'offense_pct': 0.2},
        {'game_type': 'REG', 'week': 1, 'pfr_player_id': 'B', 'offense_pct': 0.8},
        {'game_type': 'REG', 'week': 2, 'pfr_player_id': 'C', 'offense_pct': 0.5},
        {'game_type': 'POST', 'week': 19, 'pfr_player_id': 'A', 'offense_pct': 1.0},
    ])


def test_weighted_snap_share_implies_volume():
    players = _players()
    n = attach_snap_share(players, _snaps(), {'A': 'qb', 'B': 'qb2', 'C': 'wr'}, cur_week=2, decay=0.7)
    assert n == 3
    # Week 2 weighs 1, week 1 weighs 0.7. Snap = (0.2 + 0.7) / 1.7.
    # QB volume per snap = (30 + 10 + 20) / (1 + 0.2 + 0.8) = 30.
    snap = (0.2 + 0.7) / 1.7
    assert players[0]['log'][0]['sp'] == 1.0
    assert players[0]['log'][1]['sp'] == 0.2
    assert abs(players[0]['snapImplied']['pa'] - round(snap * 30, 2)) < 1e-9
    assert players[2]['snapImplied']['tg'] == 4.0
    assert 'snapImplied' not in players[3]
    assert 'sp' not in players[3]['log'][0]


def test_missing_snaps_leave_players_unchanged():
    players = _players()
    before = [dict(p) for p in players]
    assert attach_snap_share(players, None, {'A': 'qb'}, 2) == 0
    assert attach_snap_share(players, _snaps().iloc[0:0], {'A': 'qb'}, 2) == 0
    assert attach_snap_share(players, _snaps(), {}, 2) == 0
    assert players[0]['log'] == before[0]['log']
    assert 'snapImplied' not in players[0]
