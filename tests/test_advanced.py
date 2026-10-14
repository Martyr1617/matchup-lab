"""Correctness of opportunity shares, pressure rates, NGS, and expected points."""
import pandas as pd
import pytest

from build_advanced import (
    aggregate_ngs, build, estimate_dropbacks, ngs_season_to_date, opportunity_rows,
)


def test_zero_pressure_game_is_not_dropped():
    df = pd.DataFrame([
        {'times_pressured': 10, 'times_pressured_pct': 0.25, 'passing_bad_throws': 0,
         'passing_bad_throw_pct': 0, 'passing_drops': 0, 'passing_drop_pct': 0, 'times_sacked': 0},
        {'times_pressured': 0, 'times_pressured_pct': 0.0, 'passing_bad_throws': 2,
         'passing_bad_throw_pct': 0.1, 'passing_drops': 0, 'passing_drop_pct': 0, 'times_sacked': 1},
    ])
    est = estimate_dropbacks(df)
    assert est.iloc[0] == pytest.approx(40)   # 10 / 0.25
    assert est.iloc[1] == pytest.approx(21)   # 2 / 0.1 + 1 sack, not dropped
    rate = df.times_pressured.sum() / est.sum()
    assert rate == pytest.approx(10 / 61)
    assert rate < 10 / 40  # the old mask biased the rate upward


def test_missing_ngs_week_zero_is_aggregated_and_announced(capsys):
    weekly = pd.DataFrame([
        {'season': 2026, 'season_type': 'REG', 'week': 1, 'player_gsis_id': 'P', 'attempts': 10,
         'avg_time_to_throw': 2.0, 'completion_percentage_above_expectation': 1.0, 'aggressiveness': 10},
        {'season': 2026, 'season_type': 'REG', 'week': 2, 'player_gsis_id': 'P', 'attempts': 30,
         'avg_time_to_throw': 3.0, 'completion_percentage_above_expectation': 5.0, 'aggressiveness': 20},
        {'season': 2025, 'season_type': 'REG', 'week': 0, 'player_gsis_id': 'P', 'attempts': 99,
         'avg_time_to_throw': 9.0, 'completion_percentage_above_expectation': 9.0, 'aggressiveness': 9},
    ])
    out = ngs_season_to_date(weekly, 'passing', 2026, 5)
    assert 'no week==0' in capsys.readouterr().out
    assert out.iloc[0].avg_time_to_throw == pytest.approx((10 * 2 + 30 * 3) / 40)

    present = pd.concat([weekly, pd.DataFrame([{
        'season': 2026, 'season_type': 'REG', 'week': 0, 'player_gsis_id': 'P', 'attempts': 40,
        'avg_time_to_throw': 2.2, 'completion_percentage_above_expectation': 3.0, 'aggressiveness': 12,
    }])], ignore_index=True)
    kept = ngs_season_to_date(present, 'passing', 2026, 5)
    assert list(kept.week) == [0]
    assert kept.iloc[0].avg_time_to_throw == pytest.approx(2.2)


def test_opportunity_rows_keep_this_regular_season():
    ep = pd.DataFrame([
        {'season': 2026, 'week': 1, 'player_id': 'A', 'total_fantasy_points_exp': 10},
        {'season': 2026, 'week': 19, 'player_id': 'A', 'total_fantasy_points_exp': 99},
        {'season': 2025, 'week': 1, 'player_id': 'A', 'total_fantasy_points_exp': 99},
    ])
    out = opportunity_rows(ep, 2026, 18)
    assert list(out.week) == [1]
    typed = ep.assign(season_type=['REG', 'POST', 'REG'])
    assert list(opportunity_rows(typed, 2026, 18).week) == [1]


def _play(**kw):
    row = dict(season_type='REG', week=1, play_type='run', two_point_attempt=0, aborted_play=0,
               qb_dropback=0, qb_kneel=0, qb_scramble=0, posteam='BUF', game_id='G1', yardline_100=50,
               receiver_player_id=pd.NA, rusher_player_id=pd.NA, passer_player_id=pd.NA,
               air_yards=0, epa=1.0, qb_epa=0.2, cpoe=1.0, sack=0, qb_hit=0, pass_attempt=0,
               wp=0.5, down=1, half_seconds_remaining=800, play_id=1, drive=1,
               game_seconds_remaining=1800, pass_oe=0)
    row.update(kw)
    return row


def test_shares_exclude_scrambles_and_aborted_snaps(tmp_path):
    plays = pd.DataFrame([
        _play(play_id=1, rusher_player_id='RB1', yardline_100=15),
        _play(play_id=2, rusher_player_id='RB1', yardline_100=40),
        _play(play_id=3, rusher_player_id='QB1', qb_scramble=1, qb_dropback=1, yardline_100=15),
        _play(play_id=4, rusher_player_id='QB1', yardline_100=40),
        _play(play_id=5, play_type='pass', pass_attempt=1, qb_dropback=1, passer_player_id='QB1',
              receiver_player_id='WR1', yardline_100=15, air_yards=8),
        _play(play_id=6, play_type='pass', pass_attempt=1, qb_dropback=1, passer_player_id='QB1',
              receiver_player_id='WR1', yardline_100=40, air_yards=4),
        _play(play_id=7, rusher_player_id='QB1', aborted_play=1),
        _play(play_id=8, play_type='pass', qb_dropback=1),  # no passer and not a scramble
    ])
    plays.to_csv(tmp_path / 'pbp_2026.csv.gz', index=False, compression='gzip')
    players = [
        {'id': 'RB1', 'team': 'BUF', 't': {'rcy': 0, 'ca': 2, 'rc': 0}},
        {'id': 'QB1', 'team': 'BUF', 't': {'rcy': 0, 'ca': 1, 'rc': 0}},
        {'id': 'WR1', 'team': 'BUF', 't': {'rcy': 20, 'ca': 0, 'rc': 2}},
    ]
    adv, _, avail = build(1, players, data_dir=str(tmp_path), season=2026)
    assert avail['pbp'] is True
    # Designed carries are the two RB runs plus the one designed QB run. The scramble
    # and the aborted snap are not in the denominator, so 2 / (2 targets + 3 carries).
    assert adv['RB1']['opp_share'] == pytest.approx(2 / 5)
    # Red-zone denominator is one designed carry plus one target, not the scramble.
    assert adv['RB1']['rz20_share'] == pytest.approx(0.5)
    assert adv['QB1']['n_db'] == 3
    assert adv['QB1']['scrambles_pg'] == pytest.approx(1)
    assert adv['QB1']['designed_runs_pg'] == pytest.approx(1)
    assert adv['QB1']['designed_run_rate'] == pytest.approx(1 / 4)


def test_pressure_rate_uses_recovered_dropbacks(tmp_path):
    pd.DataFrame([
        {'pfr_player_id': 'Q1', 'team': 'BUF', 'opponent': 'NYJ', 'week': 1, 'game_type': 'REG',
         'times_pressured': 10, 'times_pressured_pct': 0.25, 'passing_bad_throws': 0,
         'passing_bad_throw_pct': 0, 'passing_drops': 0, 'passing_drop_pct': 0, 'times_sacked': 0},
        {'pfr_player_id': 'Q1', 'team': 'BUF', 'opponent': 'MIA', 'week': 2, 'game_type': 'REG',
         'times_pressured': 0, 'times_pressured_pct': 0.0, 'passing_bad_throws': 2,
         'passing_bad_throw_pct': 0.1, 'passing_drops': 0, 'passing_drop_pct': 0, 'times_sacked': 0},
    ]).to_csv(tmp_path / 'pfr_pass_2026.csv', index=False)
    pd.DataFrame([{'pfr_id': 'Q1', 'gsis_id': 'QB1'}]).to_csv(tmp_path / 'db_playerids.csv', index=False)
    adv, ctx, _ = build(5, [{'id': 'QB1', 'team': 'BUF'}], data_dir=str(tmp_path))
    assert ctx['BUF']['pressure_allowed'] == pytest.approx(round(10 / 60, 3))
    assert adv['QB1']['pressured_rate'] == pytest.approx(round(10 / 60, 3))
