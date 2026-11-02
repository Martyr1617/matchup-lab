"""Player team tags follow the games they played, then Sleeper when they have not played."""
from build_data import reconcile_team


def sched():
    return {
        1: [{'home': 'KC', 'away': 'DEN'}, {'home': 'SEA', 'away': 'NE'}],
        2: [{'home': 'KC', 'away': 'IND'}, {'home': 'ARI', 'away': 'SEA'}],
        7: [{'home': 'SEA', 'away': 'KC'}],
    }


def log(opps):
    return [{'wk': wk, 'opp': opp} for wk, opp in opps]


def test_games_keep_walker_on_kansas_city_when_sleeper_agrees():
    played = log([(1, 'DEN'), (2, 'IND'), (7, 'SEA')])
    assert reconcile_team('KC', 'KC', played, sched()) == 'KC'


def test_games_beat_a_stale_sleeper_team():
    played = log([(1, 'DEN'), (2, 'IND'), (7, 'SEA')])
    assert reconcile_team('KC', 'SEA', played, sched()) == 'KC'
    slate = {1: [{'home': 'HOU', 'away': 'BUF'}], 2: [{'home': 'HOU', 'away': 'CIN'}]}
    assert reconcile_team('HOU', 'MIA', log([(1, 'BUF'), (2, 'CIN')]), slate) == 'HOU'


def test_a_wrong_tag_follows_the_games():
    played = log([(1, 'NE'), (2, 'ARI')])
    assert reconcile_team('KC', 'KC', played, sched()) == 'SEA'


def test_sleeper_fills_a_team_only_when_he_has_not_played():
    assert reconcile_team('FA', 'SEA', [], sched()) == 'SEA'
    assert reconcile_team('SEA', '', [], sched()) == 'SEA'
    # One week is not enough to prove a team, so Sleeper wins. LAR is the Rams' LA.
    assert reconcile_team('SEA', 'LAR', [{'wk': 1, 'opp': 'NE'}], sched()) == 'LA'
