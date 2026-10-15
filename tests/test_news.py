"""News matching and fail-open behavior. No network."""
import json
from pathlib import Path

from fetch_news import (
    collect,
    fold,
    injury_about,
    is_injury,
    keep_previous,
    match_player,
    match_team,
    index_players,
    index_teams,
    sources_all_failed,
    write_news,
)

PLAYERS = [
    {'id': '00-1', 'name': 'Josh Allen', 'team': 'BUF'},
    {'id': '00-2', 'name': 'Keenan Allen', 'team': 'LAC'},
    {'id': '00-3', 'name': 'A.J. Brown', 'team': 'PHI'},
    {'id': '00-4', 'name': 'Breece Hall', 'team': 'NYJ'},
]
TEAMS = {'BUF': 'Buffalo Bills', 'LAC': 'Los Angeles Chargers', 'PHI': 'Philadelphia Eagles', 'NYJ': 'New York Jets', 'NYG': 'New York Giants'}


def test_fold_strips_suffixes_and_punctuation():
    assert fold('A.J. Brown') == 'aj brown'
    assert fold("Ja'Marr Chase Jr.") == 'jamarr chase'


def test_full_name_matches_and_a_bare_last_name_does_not():
    indexed = index_players(PLAYERS)
    assert match_player('Josh Allen is questionable with an ankle injury', indexed)['id'] == '00-1'
    assert match_player('AJ Brown practices in full', indexed)['id'] == '00-3'
    assert match_player('Allen throws four touchdowns', indexed) is None


def test_two_allens_prefer_the_club_named_in_the_headline():
    indexed = index_players(PLAYERS)
    hit = match_player('Keenan Allen and the Chargers host Josh Allen', indexed, index_teams(TEAMS))
    assert hit['id'] == '00-2'


def test_team_nickname_matches_and_a_shared_city_does_not():
    teams = index_teams(TEAMS)
    assert match_team('The Bills are leaning run-heavy', teams) == 'BUF'
    assert match_team('New York is cold this week', teams) is None
    assert match_team('The Jets activated a receiver', teams) == 'NYJ'


def test_injury_words_ignore_a_bare_out():
    assert is_injury('ruled out with a concussion')
    assert is_injury('listed questionable')
    assert not is_injury('breaks out of the backfield')
    josh = next(p for p in index_players(PLAYERS) if p['id'] == '00-1')
    assert injury_about(josh, 'Week 6 injury report', 'Josh Allen threw for 300 yards') is False
    assert injury_about(josh, 'Week 6 injury report', 'Josh Allen is a full participant') is False
    assert injury_about(josh, 'Josh Allen is questionable with an ankle', '') is True


def test_a_broken_feed_keeps_the_others():
    def getter(url, limit=0):
        if 'espn.com/apis' in url and url.endswith('limit=40'):
            return json.dumps({'articles': [{
                'headline': 'Josh Allen questionable with an ankle injury',
                'description': 'Bills quarterback',
                'published': '2026-10-15T01:00:00Z',
                'links': {'web': {'href': 'https://www.espn.com/nfl/story/allen'}},
                'categories': [{'type': 'team', 'team': {'abbreviation': 'BUF'}}],
            }]}).encode()
        if 'injuries' in url and 'nflverse' not in url:
            raise TimeoutError('timed out')
        if url.endswith('home'):
            raise ValueError('response was HTML, not a news feed')
        return b'<rss><channel></channel></rss>'

    doc = collect(PLAYERS, TEAMS, getter, injury_csv=None)
    assert any(item['player_id'] == '00-1' and item['injury'] and item['team'] == 'BUF' for item in doc['items'])
    by_id = {s['id']: s for s in doc['sources']}
    assert by_id['espn']['ok'] is True
    assert by_id['espn_injuries']['ok'] is False
    assert by_id['nfl']['ok'] is False
    assert by_id['x']['skipped'] is True
    assert by_id['x']['ok'] is False
    assert doc['items'][0]['headline']
    assert doc['items'][0]['url'].startswith('http')
    assert len(doc['items'][0]['id']) == 12


def test_previous_file_is_kept_only_when_every_live_feed_fails(tmp_path):
    previous = {'generated': '2026-10-14 12:00 UTC', 'stale': False, 'items': [{'id': 'abc', 'headline': 'Old'}], 'sources': []}
    prev = tmp_path / 'prev.json'
    prev.write_text(json.dumps(previous))
    failed = {'items': [], 'sources': [{'id': 'espn', 'ok': False}, {'id': 'x', 'ok': False, 'skipped': True}]}
    kept = keep_previous(failed, prev)
    assert kept['stale'] is True
    assert kept['items'][0]['id'] == 'abc'
    worked = {'items': [], 'sources': [{'id': 'espn', 'ok': True, 'items': 0}, {'id': 'x', 'ok': False, 'skipped': True}]}
    assert keep_previous(worked, prev) is worked
    assert sources_all_failed(failed)
    assert not sources_all_failed(worked)


def test_nflverse_injury_rows_match_players(tmp_path):
    path = tmp_path / 'injuries.csv'
    path.write_text(
        'season,week,gsis_id,full_name,report_status,report_primary_injury,team\n'
        '2026,5,00-1,Josh Allen,,,\n'
        '2026,6,00-1,Josh Allen,Questionable,Ankle,BUF\n'
        '2026,6,00-9,Nobody,Out,Knee,BUF\n'
    )
    doc = collect(PLAYERS, TEAMS, lambda url, limit=0: b'<rss></rss>', injury_csv=path)
    hit = next(item for item in doc['items'] if item['player_id'] == '00-1')
    assert hit['injury'] is True
    assert 'Questionable' in hit['headline']
    assert 'Ankle' in hit['headline']
    assert 'Week 6' in hit['headline']
    assert all(item['player_id'] != '00-9' for item in doc['items'])
    assert next(s for s in doc['sources'] if s['id'] == 'nflverse_injuries')['ok'] is True


def test_write_news_is_compact(tmp_path):
    doc = {'generated': '2026-10-15 00:00 UTC', 'stale': False, 'items': [], 'sources': []}
    dest = tmp_path / 'news.json'
    write_news(doc, dest)
    text = dest.read_text()
    assert '\n' not in text
    assert json.loads(text)['stale'] is False
