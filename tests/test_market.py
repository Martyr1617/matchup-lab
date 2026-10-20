"""ESPN spread sign and the regular-season guard."""
from fetch_market_espn import (
    atd_quote,
    attach_game_prices,
    cell_from_quotes,
    favorites_agree,
    quote_prices,
    regular_season_week,
    schedule_spreads,
)


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


def test_game_prices_come_from_the_close():
    game = {}
    attach_game_prices(game, {
        'moneyline': {'home': {'close': {'odds': '-130'}}, 'away': {'close': {'odds': '+110'}}},
        'pointSpread': {'home': {'close': {'odds': '-110'}}, 'away': {'close': {'odds': '-110'}}},
        'total': {'over': {'close': {'odds': '-105'}}, 'under': {'close': {'odds': '-115'}}},
    })
    assert game['ml_home'] == -130 and game['ml_away'] == 110
    assert game['spread_odds_home'] == -110 and game['spread_odds_away'] == -110
    assert game['total_over_odds'] == -105 and game['total_under_odds'] == -115


def test_prop_prices_are_kept_when_the_feed_sends_them():
    over, under, p_over = quote_prices({'over': {'odds': '-110'}, 'under': {'odds': '-110'}})
    assert (over, under, p_over) == (-110, -110, 0.5)
    assert quote_prices({'target': {'value': 93.5}}) == (None, None, None)
    cell = cell_from_quotes([(221.5, -115, -105, 0.5238)])
    assert cell['line'] == 221.5 and cell['over'] == -115 and cell['p_over'] == 0.5238
    assert atd_quote({}) is None
    quote = atd_quote({'odds': '-150'})
    assert quote['odds'] == -150 and quote['p'] == 0.6
