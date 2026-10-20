"""Prop weight grid and the recovery rule for a line that moved after kickoff."""
import json
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

import backfill_props as backfill  # noqa: E402
from prop_backtest import prop_mean, render_report  # noqa: E402


def test_prop_mean_matches_the_model():
    raw = subprocess.check_output(
        ["node", "-e", (
            "const { propMean } = require('./site/model');"
            "process.stdout.write(JSON.stringify(["
            "propMean({line:100, p_over:0.5}, true),"
            "propMean({line:20}, false)"
            "]));"
        )],
        cwd=Path(__file__).resolve().parents[1],
    )
    assert json.loads(raw) == [105, 20]
    assert prop_mean({"line": 100, "p_over": 0.5}, True) == 105
    assert prop_mean({"line": 20}, False) == 20
    assert prop_mean({"line": 40}, True) == 42


def test_weight_grid_and_line_calibration(tmp_path):
    game = "2026_07_A_B"
    week = tmp_path / "2026" / "wk07"
    pre = week / "prekickoff" / "props"
    pre.mkdir(parents=True)
    rows = [(50, 40, 60, "A"), (70, 80, 90, "B"), (30, 20, 10, "C")]
    players = []
    actuals = []
    for model, line, actual, name in rows:
        players.append({
            "id": name, "espn": name, "name": name, "pos": "WR", "team": "A", "game": game,
            "model": {"rcy": model},
            "rec_yds": {"line": line, "src": "market.json 2026-10-14T12:44:10Z"},
        })
        actuals.append({
            "id": name, "espn": name, "name": name, "team": "A", "pos": "WR",
            "stats": {"rec_yd": actual, "rec": 4, "targets": 6},
        })
    (pre / f"{game}.json").write_text(json.dumps({
        "v": 1, "kind": "prekickoff-props", "season": 2026, "week": 7, "game_id": game,
        "recovered": True,
        "game": {"id": game, "away": "A", "home": "B", "kickoff": "2026-10-23T00:15:00Z"},
        "players": players,
    }))
    text = render_report(week, 2026, 7, fixture={"games": {game: {"final": True, "players": actuals}}})
    assert "16.67" in text
    assert "0%" in text and "50%" in text and "60%" in text
    assert "Spearman" in text
    assert "src" in text
    assert "6 to 8 frozen weeks" in text
    assert "Over 2, under 1, push 0" in text


def _item(espn_id, type_name, value, updated):
    return {
        "athlete": {"$ref": f"https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/athletes/{espn_id}?lang=en"},
        "type": {"name": type_name},
        "lastUpdated": updated,
        "current": {"target": {"value": value}},
    }


def test_recover_uses_the_prekickoff_quote_and_falls_back_after_the_game():
    kick = "2026-10-16T00:15:00Z"
    fallback = {
        "4430878": {
            "name": "Jaxon Smith-Njigba", "espn": "4430878", "game": "SEA@DEN",
            "rec_yds": {"line": 93.5}, "rec": {"line": 4.5},
        }
    }
    names = {"4430878": "Jaxon Smith-Njigba"}
    items = [
        _item("4430878", "Total Receiving Yards (incl. overtime)", 110.5, "2026-10-16T01:05:00Z"),
        _item("4430878", "Total Receptions (incl. overtime)", 6.5, "2026-10-15T22:00:00Z"),
    ]
    src = "market.json 2026-10-14T12:44:10Z"
    started = backfill.recover_game(items, fallback, "SEA@DEN", kick, True, names, src)
    jsn = started["4430878"]
    assert jsn["rec_yds"]["line"] == 93.5
    assert jsn["rec_yds"]["src"] == src
    assert jsn["rec"]["line"] == 6.5
    assert "src" not in jsn["rec"]

    live = backfill.recover_game(items, fallback, "SEA@DEN", kick, False, names, src)
    assert live["4430878"]["rec_yds"]["line"] == 110.5
    assert "src" not in live["4430878"]["rec_yds"]


def test_lines_only_freeze_keeps_the_projection_total_and_skips_the_model(tmp_path):
    root = tmp_path / "snapshots"
    pre = root / "2026" / "wk06" / "prekickoff"
    pre.mkdir(parents=True)
    (pre / "2026_06_SEA_DEN.json").write_text(json.dumps({
        "game_id": "2026_06_SEA_DEN",
        "source_snapshot": "2026-10-15T16-35Z",
        "kickoff": "2026-10-16T00:15:00Z",
        "game": {
            "id": "2026_06_SEA_DEN", "away": "SEA", "home": "DEN",
            "kickoff": "2026-10-16T00:15:00Z", "spread_home": 2.5, "total": 40.5,
        },
        "players": [{
            "id": "jsn", "espn": "4430878", "name": "Jaxon Smith-Njigba",
            "pos": "WR", "team": "SEA", "game": "2026_06_SEA_DEN",
        }],
    }))
    fallback_path = tmp_path / "market.json"
    fallback_path.write_text(json.dumps({
        "week": 6, "as_of": "2026-10-14T12:44:10Z",
        "props": {"4430878": {
            "name": "Jaxon Smith-Njigba", "espn": "4430878", "game": "SEA@DEN",
            "rec_yds": {"line": 93.5},
        }},
    }))
    summary = backfill.install(
        root, 6, season=2026, fallback_path=fallback_path, now="2026-10-20T16:00:00Z",
        events=[{"key": "SEA@DEN", "away": "SEA", "home": "DEN", "spread_home": 9, "total": 55, "odds": {}}],
        items_by_key={"SEA@DEN": [
            _item("4430878", "Total Receiving Yards (incl. overtime)", 110.5, "2026-10-16T01:05:00Z"),
        ]},
    )
    assert summary["mode"] == "lines-only"
    assert "2026_06_SEA_DEN" in summary["wrote"]
    frozen = json.loads((pre / "props" / "2026_06_SEA_DEN.json").read_text())
    assert frozen["recovered"] is True
    assert frozen["game"]["total"] == 40.5
    assert frozen["game"]["spread_home"] == 2.5
    assert frozen["players"][0]["rec_yds"]["line"] == 93.5
    assert frozen["players"][0]["rec_yds"]["src"].startswith("market.json")
    assert "model" not in frozen["players"][0]
    assert "walk-forward" in frozen["note"]
    data = {"meta": {"season": 2026, "next_week": 7, "generated": "2026-10-20 16:34 UTC"}}
    assert backfill.model_allowed(data, 2026, 7)
    assert not backfill.model_allowed(data, 2026, 6)
