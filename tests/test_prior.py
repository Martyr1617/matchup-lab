"""Previous-season usage keeps counting totals and discounts a snap collapse."""
import pandas as pd

from build_data import prior_profiles


def test_prior_profile_discounts_a_collapsed_snap(tmp_path):
    pd.DataFrame([
        {'player_id': 'rb', 'position': 'RB', 'season_type': 'REG', 'week': 1,
         'carries': 20, 'targets': 4, 'target_share': 0.2, 'receptions': 3,
         'receiving_yards': 20, 'receiving_tds': 0, 'rushing_yards': 80, 'rushing_tds': 1,
         'attempts': 0, 'passing_yards': 0, 'passing_tds': 0, 'passing_interceptions': 0,
         'rushing_fumbles_lost': 0, 'receiving_fumbles_lost': 0, 'sack_fumbles_lost': 0},
        {'player_id': 'rb', 'position': 'RB', 'season_type': 'REG', 'week': 2,
         'carries': 2, 'targets': 0, 'target_share': 0.0, 'receptions': 0,
         'receiving_yards': 0, 'receiving_tds': 0, 'rushing_yards': 4, 'rushing_tds': 0,
         'attempts': 0, 'passing_yards': 0, 'passing_tds': 0, 'passing_interceptions': 0,
         'rushing_fumbles_lost': 0, 'receiving_fumbles_lost': 0, 'sack_fumbles_lost': 0},
    ]).to_csv(tmp_path / 'players_2025.csv', index=False)
    pd.DataFrame([
        {'game_type': 'REG', 'week': 1, 'pfr_player_id': 'P', 'offense_pct': 0.8},
        {'game_type': 'REG', 'week': 2, 'pfr_player_id': 'P', 'offense_pct': 0.1},
    ]).to_csv(tmp_path / 'snaps_2025.csv', index=False)
    prof = prior_profiles(2025, str(tmp_path), {'P': 'rb'})
    # Healthy game weighs 1, the collapsed snap weighs 0.2: (20 + 0.4) / 1.2.
    assert prof['rb']['ca'] == 17
    assert prof['rb']['t']['ca'] == 22
    assert prof['rb']['ts'] == round(0.2 / 1.2, 4)
    assert prior_profiles(2025, str(tmp_path / 'missing')) == {}
