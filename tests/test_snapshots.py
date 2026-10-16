"""Pre-kickoff archive: prune hourly files, freeze one record per game."""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

import archive_snapshot as arch  # noqa: E402
from score_week import (  # noqa: E402
    actuals_from_nflverse_rows,
    parse_espn_summary,
    ppr_from_line,
    reason,
    render_week,
    spearman,
    summarize,
)


def _snap(stamp, generated, players, games):
    return {
        "v": 1,
        "season": 2026,
        "week": 6,
        "generated": generated,
        "stamp": stamp,
        "scoring": "ppr",
        "games": games,
        "players": players,
    }


TNF = {
    "id": "2026_06_SEA_DEN", "away": "SEA", "home": "DEN",
    "kickoff": "2026-10-16T00:15:00Z", "spread_home": 2.5, "total": 40.5,
}
EARLY = {
    "id": "2026_06_HOU_JAX", "away": "HOU", "home": "JAX",
    "kickoff": "2026-10-18T13:30:00Z", "spread_home": -3, "total": 42.5,
}
LATE = {
    "id": "2026_06_DAL_GB", "away": "DAL", "home": "GB",
    "kickoff": "2026-10-19T00:20:00Z", "spread_home": -1.5, "total": 52.5,
}


def _player(name, team, game, proj, floor=0, ceil=20):
    return {
        "id": name, "name": name, "pos": "WR", "team": team, "game": game,
        "proj": proj, "floor": floor, "ceil": ceil,
    }


def test_freeze_uses_the_last_snapshot_before_each_kickoff(tmp_path):
    root = tmp_path / "snapshots"
    early = _snap(
        "2026-10-15T16-35Z", "2026-10-15T16:35:00Z",
        [_player("Jaxon Smith-Njigba", "SEA", TNF["id"], 17.9, 7.1, 32.1),
         _player("Nico", "HOU", EARLY["id"], 14)],
        [TNF, EARLY, LATE],
    )
    first = arch.archive(root, early, keep=6)
    assert first["frozen"] == []
    assert not (root / "2026" / "wk06" / "prekickoff").exists()

    # Friday, after Thursday kickoff and before Sunday.
    second = _snap(
        "2026-10-16T12-00Z", "2026-10-16T12:00:00Z",
        [_player("Jaxon Smith-Njigba", "SEA", TNF["id"], 18.4, 7.2, 33),
         _player("Nico", "HOU", EARLY["id"], 14.2)],
        [TNF, EARLY, LATE],
    )
    summary = arch.archive(root, second, keep=6)
    assert summary["frozen"] == ["2026_06_SEA_DEN"]
    pre = json.loads((root / "2026" / "wk06" / "prekickoff" / "2026_06_SEA_DEN.json").read_text())
    assert pre["source_snapshot"] == "2026-10-15T16-35Z"
    assert pre["kind"] == "prekickoff"
    assert [p["name"] for p in pre["players"]] == ["Jaxon Smith-Njigba"]
    assert pre["players"][0]["proj"] == 17.9
    assert pre["game"]["total"] == 40.5
    assert "2026_06_HOU_JAX.json" not in [p.name for p in (root / "2026" / "wk06" / "prekickoff").iterdir()]

    # A later run must not replace the Thursday record, and Sunday early freezes on its own clock.
    third = _snap(
        "2026-10-18T14-00Z", "2026-10-18T14:00:00Z",
        [_player("Jaxon Smith-Njigba", "SEA", TNF["id"], 19),
         _player("Nico", "HOU", EARLY["id"], 15),
         _player("CeeDee", "DAL", LATE["id"], 16)],
        [TNF, EARLY, LATE],
    )
    again = arch.archive(root, third, keep=6)
    assert "2026_06_SEA_DEN" not in again["frozen"]
    assert "2026_06_HOU_JAX" in again["frozen"]
    assert "2026_06_DAL_GB" not in again["frozen"]
    still = json.loads((root / "2026" / "wk06" / "prekickoff" / "2026_06_SEA_DEN.json").read_text())
    assert still["source_snapshot"] == "2026-10-15T16-35Z"
    hou = json.loads((root / "2026" / "wk06" / "prekickoff" / "2026_06_HOU_JAX.json").read_text())
    # 14:00Z is after the 13:30Z kickoff, so the freeze source is the noon Friday file, the last one before kickoff.
    assert hou["source_snapshot"] == "2026-10-16T12-00Z"


def test_prune_keeps_latest_hourly_and_the_prekickoff_copy(tmp_path):
    root = tmp_path / "snapshots"
    for hour in range(1, 9):
        stamp = f"2026-10-15T{hour:02d}-00Z"
        arch.archive(root, _snap(stamp, f"2026-10-15T{hour:02d}:00:00Z", [], [dict(TNF, kickoff="2026-10-16T00:15:00Z")]), keep=3)
    hourly = sorted(p.name for p in (root / "2026" / "wk06").glob("*.json") if p.name != "manifest.json")
    assert hourly == ["2026-10-15T06-00Z.json", "2026-10-15T07-00Z.json", "2026-10-15T08-00Z.json"]
    # Kickoff is still ahead of 08:00Z, so nothing is frozen and nothing extra is retained.
    assert not (root / "2026" / "wk06" / "prekickoff").exists()


def test_no_prekickoff_when_every_snapshot_is_after_the_game(tmp_path):
    root = tmp_path / "snapshots"
    late = _snap(
        "2026-10-16T03-32Z", "2026-10-16T03:32:00Z",
        [_player("Bo Nix", "DEN", TNF["id"], 13)],
        [TNF],
    )
    summary = arch.archive(root, late, keep=6)
    assert summary["frozen"] == []
    assert not (root / "2026" / "wk06" / "prekickoff").exists()


def test_workflow_fast_forwards_snapshots_and_still_force_pushes_only_data():
    text = Path(".github/workflows/refresh.yml").read_text()
    assert "archive_snapshot.py" in text
    assert "snapshot_projections.js" in text
    assert 'git push -qf' in text
    # The force push is the data branch publish, not the snapshot archive.
    data_push = text.split("Publish to the data branch")[1].split("Archive pre-kickoff")[0]
    snap_push = text.split("Archive pre-kickoff")[1].split("Report a stale")[0]
    assert "git push -qf" in data_push and " data" in data_push
    assert "git push" not in snap_push
    assert "--push" in snap_push


def test_ppr_matches_the_thursday_box_score():
    # Darnold: 278 yards, 0 TD, 2 INT, 19 rush yards, one passing 2-point conversion.
    darnold = ppr_from_line({
        "pass_yd": 278, "pass_td": 0, "ints": 2, "rush_yd": 19, "rush_td": 0,
        "rec": 0, "rec_yd": 0, "rec_td": 0, "fum_lost": 0, "two_pass": 1,
    })
    assert round(darnold, 2) == 11.02
    shaheed = ppr_from_line({
        "pass_yd": 0, "rush_yd": 2, "rush_td": 0, "rec": 5, "rec_yd": 66, "rec_td": 0,
        "fum_lost": 1, "two_rec": 1,
    })
    assert round(shaheed, 2) == 11.8
    assert "two-point" in reason({
        "pos": "WR", "proj": 4.9, "actual": 11.8, "inj": None,
        "stats": {"fum_lost": 1, "two_rec": 1, "rec": 5, "rec_yd": 66, "rec_td": 0, "targets": 8},
    }).lower()
    assert "stalled" in reason({
        "pos": "QB", "proj": 13.6, "actual": 4.5, "inj": None,
        "stats": {"pass_yd": 107, "pass_td": 0, "pass_att": 27, "ints": 0, "rush_yd": 2},
    }).lower()


def test_spearman_and_summary():
    rows = [
        {"proj": 10, "actual": 8, "floor": 0, "ceil": 20},
        {"proj": 5, "actual": 6, "floor": 0, "ceil": 12},
        {"proj": 1, "actual": 9, "floor": 0, "ceil": 4},
    ]
    assert spearman([(10, 8), (5, 6), (1, 9)]) < 0
    stats = summarize(rows)
    assert stats["n"] == 3
    assert stats["inside"] == 2
    assert stats["bias"] == (2 + -1 + -8) / 3


def test_nflverse_week_filter_and_espn_two_point():
    rows = [
        {"week": "5", "season_type": "REG", "player_id": "old", "player_display_name": "Old", "position": "WR",
         "team": "SEA", "fantasy_points_ppr": "99", "attempts": "0", "carries": "0", "targets": "1", "receptions": "1"},
        {"week": "6", "season_type": "REG", "player_id": "jsn", "player_display_name": "Jaxon Smith-Njigba",
         "position": "WR", "team": "SEA", "fantasy_points_ppr": "25.4", "attempts": "0", "carries": "0",
         "targets": "16", "receptions": "12", "receiving_yards": "134", "receiving_tds": "0"},
    ]
    got = actuals_from_nflverse_rows(rows, 6)
    assert list(got) == ["jsn"]
    assert got["jsn"]["actual"] == 25.4
    assert actuals_from_nflverse_rows(rows, 7) == {}

    summary = {
        "header": {"competitions": [{
            "status": {"type": {"completed": True, "name": "STATUS_FINAL", "shortDetail": "Final/OT", "detail": "Final/OT"}},
            "competitors": [
                {"homeAway": "away", "score": "14", "team": {"abbreviation": "SEA"}},
                {"homeAway": "home", "score": "17", "team": {"abbreviation": "DEN"}},
            ],
        }]},
        "scoringPlays": [{
            "text": "George Holani 1 Yd Rush (Sam Darnold Pass to Rashid Shaheed for Two-Point Conversion)",
        }],
        "boxscore": {"players": [{
            "team": {"abbreviation": "SEA"},
            "statistics": [
                {"name": "passing", "keys": ["completions/passingAttempts", "passingYards", "passingTouchdowns", "interceptions"],
                 "athletes": [{"athlete": {"id": "1", "displayName": "Sam Darnold"}, "stats": ["27/51", "278", "0", "2"]}]},
                {"name": "receiving", "keys": ["receptions", "receivingYards", "receivingTouchdowns", "receivingTargets"],
                 "athletes": [{"athlete": {"id": "2", "displayName": "Rashid Shaheed"}, "stats": ["5", "66", "0", "8"]}]},
            ],
        }]},
    }
    parsed = parse_espn_summary(summary, "DEN", "SEA")
    assert parsed["final"] and parsed["ot"]
    by_name = {row["name"]: row for row in parsed["actuals"]}
    assert by_name["Sam Darnold"]["stats"]["two_pass"] == 1
    assert by_name["Rashid Shaheed"]["stats"]["two_rec"] == 1
    assert round(by_name["Rashid Shaheed"]["actual"], 2) == 13.6


def test_score_report_shape(tmp_path):
    root = tmp_path / "snapshots"
    pre_game = _snap(
        "2026-10-15T16-35Z", "2026-10-15T16:35:00Z",
        [
            {"id": "nix", "espn": "1", "name": "Bo Nix", "pos": "QB", "team": "DEN", "game": TNF["id"],
             "proj": 13.6, "floor": 3.1, "ceil": 24.2},
            {"id": "jsn", "espn": "2", "name": "Jaxon Smith-Njigba", "pos": "WR", "team": "SEA", "game": TNF["id"],
             "proj": 17.9, "floor": 7.1, "ceil": 32.1, "role": True},
            {"id": "lock", "name": "Drew Lock", "pos": "QB", "team": "SEA", "game": TNF["id"],
             "proj": 11.4, "floor": 4.6, "ceil": 18.3},
        ],
        [TNF, EARLY],
    )
    arch.archive(root, pre_game, keep=6)
    arch.archive(root, _snap(
        "2026-10-16T12-00Z", "2026-10-16T12:00:00Z",
        pre_game["players"], [TNF, EARLY],
    ), keep=6)
    fixture = {"source": "fixture", "games": {"2026_06_SEA_DEN": {
        "final": True, "ot": True, "away_score": 14, "home_score": 17,
        "source": "fixture",
        "players": [
            {"id": "nix", "name": "Bo Nix", "team": "DEN", "pos": "QB", "actual": 4.5,
             "stats": {"pass_yd": 107, "pass_td": 0, "pass_att": 27, "ints": 0, "rush_yd": 2}},
            {"id": "jsn", "name": "Jaxon Smith-Njigba", "team": "SEA", "pos": "WR", "actual": 25.4,
             "stats": {"rec": 12, "rec_yd": 134, "rec_td": 0, "targets": 16}},
            {"name": "Tory Horton", "team": "SEA", "pos": "WR", "actual": 2.3,
             "stats": {"rec": 1, "rec_yd": 13, "targets": 5}},
        ],
    }}}
    text = render_week(root / "2026" / "wk06", 2026, 6, fixture=fixture)
    assert "SEA at DEN is final: SEA 14, DEN 17 in overtime." in text
    assert "mean absolute error" in text
    assert "Bias" in text
    assert "Spearman" in text
    assert "floor-ceiling" in text
    assert "Bo Nix" in text and "Jaxon Smith-Njigba" in text
    assert "Drew Lock" in text  # projected, did not play
    assert "Tory Horton" in text  # played, not in the pool
    assert "HOU at JAX has not reached kickoff" in text
    assert "outside" not in text.split("Misses")[0] or "3.1" in text
