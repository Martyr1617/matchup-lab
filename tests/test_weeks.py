"""Week completion: a week counts only when every regular-season game is final."""
import pandas as pd

from build_data import last_completed_week, regular_season_games


def _games(rows):
    return pd.DataFrame(rows)


def test_thursday_final_does_not_complete_the_week():
    rows = []
    for i in range(3):
        rows.append({'season': 2026, 'game_type': 'REG', 'week': 1,
                     'home_score': 21 if i < 3 else None, 'away_score': 17 if i < 3 else None})
    for i in range(3):
        # Only the first game of week 2 is final.
        rows.append({'season': 2026, 'game_type': 'REG', 'week': 2,
                     'home_score': 24 if i == 0 else None, 'away_score': 10 if i == 0 else None})
    g = regular_season_games(_games(rows), 2026)
    assert last_completed_week(g) == 1


def test_postseason_and_other_seasons_do_not_count():
    rows = [
        {'season': 2026, 'game_type': 'REG', 'week': 1, 'home_score': 20, 'away_score': 10},
        {'season': 2026, 'game_type': 'WC', 'week': 2, 'home_score': 30, 'away_score': 27},
        {'season': 2026, 'game_type': 'PRE', 'week': 1, 'home_score': None, 'away_score': None},
        {'season': 2025, 'game_type': 'REG', 'week': 18, 'home_score': 14, 'away_score': 7},
    ]
    g = regular_season_games(_games(rows), 2026)
    assert set(g['game_type']) == {'REG'}
    assert last_completed_week(g) == 1


def test_a_hole_stops_the_count():
    rows = [
        {'season': 2026, 'game_type': 'REG', 'week': 1, 'home_score': 10, 'away_score': 7},
        {'season': 2026, 'game_type': 'REG', 'week': 2, 'home_score': None, 'away_score': None},
        {'season': 2026, 'game_type': 'REG', 'week': 3, 'home_score': 10, 'away_score': 7},
    ]
    assert last_completed_week(regular_season_games(_games(rows), 2026)) == 1


def test_empty_schedule():
    assert last_completed_week(regular_season_games(_games(
        [{'season': 2024, 'game_type': 'REG', 'week': 1, 'home_score': 1, 'away_score': 0}]), 2026)) == 0
