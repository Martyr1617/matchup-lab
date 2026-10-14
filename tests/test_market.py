"""ESPN spread sign and the regular-season guard."""
from fetch_market_espn import favorites_agree, regular_season_week, schedule_spreads


def test_regular_season_weeks_only():
    assert regular_season_week(1) and regular_season_week(18)
    assert not regular_season_week(0)
    assert not regular_season_week(19)
    assert not regular_season_week('WC')


def test_favorites_agree_when_signs_are_opposite():
    # nflverse +3 means home favored by 3. ESPN home-perspective is -3.
    assert favorites_agree(-3.0, 3.0)
    assert favorites_agree(2.5, -2.5)
    # Same sign means the two feeds name opposite favorites.
    assert not favorites_agree(-3.0, -3.0)
    assert not favorites_agree(6.5, 6.5)
    # A pick'em on either side is not a hard disagreement.
    assert favorites_agree(-0.2, 3.0)
    assert favorites_agree(None, 3.0)


def test_schedule_lookup_accepts_string_week_keys():
    data = {'schedule': {'6': [{'away': 'SEA', 'home': 'DEN', 'spread_line': -2.5}]}}
    assert schedule_spreads(data, 6)[('SEA', 'DEN')] == -2.5
