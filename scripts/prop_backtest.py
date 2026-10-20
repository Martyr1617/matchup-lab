#!/usr/bin/env python3
"""Score prop-blend weights against frozen pre-kickoff lines.

Reads snapshots/<season>/wkNN/prekickoff/props/<game_id>.json. Each file is the
last prop board stored strictly before kickoff, plus the walk-forward component
from project() when that archive stored one (`model`: passing yards, attempts,
and the other counted stats, before the prop blend).

Weights are 0, 10, 20, 30, 40, 50, and 60 percent. A yardage prop's market mean
matches site/model.js: line × 1.05, shifted by the no-vig over probability when
a price was stored. The live app keeps blending posted components at 50 percent.
This script does not change that.

    python scripts/prop_backtest.py --week 7
    python scripts/prop_backtest.py --week 7 --season 2026
    python scripts/prop_backtest.py --week 7 --root /path/to/snapshots

About 6 to 8 frozen weeks is enough to see whether a weight beats the
week-to-week swing. A full regular season, about 18 weeks, is the point at
which a small gap is worth changing the live 50 percent blend.
"""
from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

from score_week import discover_season, extract_from_git, load_actuals, played, spearman, week_directory

WEIGHTS = (0.0, 0.10, 0.20, 0.30, 0.40, 0.50, 0.60)
STATS = (
    ("pass_yds", "py", "pass_yd", True, "Pass yards"),
    ("pass_att", "pa", "pass_att", False, "Pass attempts"),
    ("pass_cmp", "cmp", "pass_cmp", False, "Completions"),
    ("pass_td", "ptd", "pass_td", False, "Pass TDs"),
    ("int", "int", "ints", False, "Interceptions"),
    ("rush_att", "ca", "rush_att", False, "Carries"),
    ("rush_yds", "ry", "rush_yd", True, "Rush yards"),
    ("rec", "rc", "rec", False, "Receptions"),
    ("rec_yds", "rcy", "rec_yd", True, "Receiving yards"),
)
POSITIONS = ("QB", "RB", "WR", "TE")
THIN_N = 8


def prop_mean(cell, yards):
    if not cell or cell.get("line") is None:
        return None
    line = float(cell["line"])
    p_over = cell.get("p_over")
    shift = 1 + 0.8 * (float(p_over) - 0.5) if p_over is not None else 1.0
    return line * (1.05 if yards else 1.0) * shift


def load_frozen_props(directory: Path):
    pre = Path(directory) / "prekickoff" / "props"
    if not pre.is_dir():
        return []
    docs = []
    for path in sorted(pre.glob("*.json")):
        with open(path) as handle:
            docs.append(json.load(handle))
    docs.sort(key=lambda doc: doc.get("kickoff") or "")
    return docs


def _match(player, actuals):
    by_id, by_espn, by_name = {}, {}, {}
    for actual in actuals or []:
        if actual.get("id"):
            by_id[str(actual["id"])] = actual
        if actual.get("espn"):
            by_espn[str(actual["espn"])] = actual
        by_name[(str(actual.get("name") or "").lower(), actual.get("team"))] = actual
    if player.get("id") and str(player["id"]) in by_id:
        return by_id[str(player["id"])]
    if player.get("espn") and str(player["espn"]) in by_espn:
        return by_espn[str(player["espn"])]
    return by_name.get((str(player.get("name") or "").lower(), player.get("team")))


def collect_rows(docs, by_game):
    rows, pending = [], []
    for doc in docs:
        entry = by_game.get(doc.get("game_id")) or {}
        game = doc.get("game") or {}
        label = f"{game.get('away')} at {game.get('home')}"
        if not entry.get("final"):
            pending.append(label)
            continue
        for player in doc.get("players") or []:
            actual = _match(player, entry.get("players") or [])
            if not actual or not played(actual.get("stats") or {}):
                continue
            stats = actual.get("stats") or {}
            model = player.get("model") or {}
            pos = player.get("pos") or actual.get("pos")
            atd = player.get("atd")
            if isinstance(atd, dict) and atd.get("p") is not None and "rush_td" in stats and "rec_td" in stats:
                lam = float(model.get("rtd") or 0) + (0 if pos == "QB" else float(model.get("rctd") or 0))
                has_model = model.get("rtd") is not None or (pos != "QB" and model.get("rctd") is not None)
                rows.append({
                    "stat": "atd", "label": "Anytime TD", "yards": False, "pos": pos,
                    "line": float(atd["p"]), "mean": float(atd["p"]),
                    "model": (1 - math.exp(-lam)) if has_model else None,
                    "actual": 1.0 if (stats.get("rush_td", 0) + stats.get("rec_td", 0)) > 0 else 0.0,
                    "p_over": None, "src": atd.get("src"),
                })
            for key, model_key, actual_key, yards, stat_label in STATS:
                cell = player.get(key)
                if not isinstance(cell, dict) or cell.get("line") is None or actual_key not in stats:
                    continue
                rows.append({
                    "stat": key, "label": stat_label, "yards": yards, "pos": pos,
                    "line": float(cell["line"]), "mean": prop_mean(cell, yards),
                    "model": None if model.get(model_key) is None else float(model[model_key]),
                    "actual": float(stats[actual_key]),
                    "p_over": cell.get("p_over"), "src": cell.get("src"),
                })
    return rows, pending


def _metric(pairs):
    n = len(pairs)
    if not n:
        return None
    err = [p - a for p, a in pairs]
    return {
        "n": n,
        "mae": sum(abs(e) for e in err) / n,
        "bias": sum(err) / n,
        "rho": spearman(pairs) if n >= 3 else None,
        "thin": n < THIN_N,
    }


def _fmt(n):
    return "  n/a" if n is None else f"{n:.2f}"


def _rho(stats):
    if not stats or stats["rho"] is None:
        return "  n/a"
    text = f"{stats['rho']:.3f}"
    return text + " thin" if stats["thin"] else text


def _lines_for(groups):
    out = ["group    weight    n      MAE     bias    Spearman"]
    for label, rows in groups:
        usable = [r for r in rows if r["model"] is not None and r["mean"] is not None]
        if not usable:
            out.append(f"{label:<8}  no walk-forward component stored for these lines")
            continue
        for weight in WEIGHTS:
            stats = _metric([((1 - weight) * r["model"] + weight * r["mean"], r["actual"]) for r in usable])
            out.append(
                f"{label:<8}  {round(weight * 100):>3}%   {stats['n']:>5}   {_fmt(stats['mae']):>7}  {_fmt(stats['bias']):>7}   {_rho(stats)}"
            )
    return out


def _calibration(rows):
    n = len(rows)
    if not n:
        return []
    if rows[0]["stat"] == "atd":
        mean_p = sum(r["line"] for r in rows) / n
        hits = sum(r["actual"] for r in rows) / n
        brier = sum((r["line"] - r["actual"]) ** 2 for r in rows) / n
        return [f"Anytime TD, n={n}: mean price {mean_p:.1%}, scored on {hits:.1%} of lines, Brier {brier:.3f}."]
    bias = sum(r["line"] - r["actual"] for r in rows) / n
    overs = sum(1 for r in rows if r["actual"] > r["line"])
    unders = sum(1 for r in rows if r["actual"] < r["line"])
    pushes = n - overs - unders
    decided = overs + unders
    rate = f", over rate {overs / decided:.1%} of decided lines." if decided else "."
    bits = [
        f"Line vs actual, n={n}: mean line {sum(r['line'] for r in rows) / n:.2f}, "
        f"mean actual {sum(r['actual'] for r in rows) / n:.2f}, bias (line − actual) {bias:+.2f}. "
        f"Over {overs}, under {unders}, push {pushes}{rate}"
    ]
    if rows[0]["yards"]:
        skewed = sum(r["line"] * 1.05 - r["actual"] for r in rows) / n
        bits.append(f"Yardage mean (line × 1.05) bias {skewed:+.2f}.")
    priced = [r for r in rows if r.get("p_over") is not None]
    priced_decided = [r for r in priced if r["actual"] != r["line"]]
    if priced_decided:
        mean_p = sum(float(r["p_over"]) for r in priced) / len(priced)
        hit = sum(1 for r in priced_decided if r["actual"] > r["line"]) / len(priced_decided)
        bits.append(f"Prices on {len(priced)} lines: mean no-vig over probability {mean_p:.1%}, actual over rate {hit:.1%}.")
    return bits


def _history(n_games):
    return (
        "How much history this needs: one week is a single slate. Quarterback and tight-end "
        "cells are only a few dozen lines. A blend that is better by a few percent of MAE does "
        "not clear the week-to-week swing until about 6 to 8 frozen weeks are in, and a full "
        f"regular season (about 18 weeks) is the point at which a small gap is worth changing the "
        f"live 50% component blend. This report has {n_games} frozen game{'s' if n_games != 1 else ''}. "
        f"Rank correlations on fewer than {THIN_N} players are marked thin."
    )


def render_report(directory, season, week, fixture=None):
    docs = load_frozen_props(directory)
    lines = [f"Prop blend backtest, week {week}, {season}"]
    if not docs:
        hourly = list((Path(directory) / "props").glob("*.json")) if (Path(directory) / "props").is_dir() else []
        lines.append(
            "No frozen pre-kickoff props yet. The hourly refresh writes "
            f"snapshots/{season}/wk{int(week):02d}/props/<stamp>.json and, on the first run at or after "
            f"kickoff, copies the last pre-kickoff board to snapshots/{season}/wk{int(week):02d}/prekickoff/props/<game_id>.json."
        )
        if hourly:
            lines.append(f"{len(hourly)} hourly prop file{'s' if len(hourly) != 1 else ''} on disk. Kickoff has not frozen them.")
        lines.append("")
        lines.append(_history(0))
        return "\n".join(lines).rstrip() + "\n"
    games = []
    for doc in docs:
        game = dict(doc.get("game") or {})
        game.setdefault("id", doc.get("game_id"))
        games.append(game)
    payload = fixture if fixture is not None else load_actuals(season, week, games)[0]
    rows, pending = collect_rows(docs, (payload or {}).get("games") or {})
    n_players = sum(len(doc.get("players") or []) for doc in docs)
    lines.append(f"Frozen props: {len(docs)} game{'s' if len(docs) != 1 else ''}, {n_players} players with a line.")
    recovered = sum(1 for doc in docs if doc.get("recovered"))
    if recovered:
        lines.append(
            f"{recovered} of those games were recovered after the fact. A line with `src` set is an earlier "
            "board, not the number on the screen at kickoff. Weeks recovered this way have no stored "
            "walk-forward component, so the weight grid waits for a week that froze one."
        )
    if pending:
        lines.append("Not final, so not scored: " + "; ".join(pending) + ".")
    if not rows:
        lines.append("No stat has both a frozen line and a final actual yet.")
        lines.append("")
        lines.append(_history(len(docs)))
        return "\n".join(lines).rstrip() + "\n"
    tagged = sum(1 for r in rows if r.get("src"))
    if tagged:
        lines.append(f"{tagged} scored lines are tagged with `src` because they were recovered from an earlier board.")
    lines.append(
        "Weight 0% is the walk-forward component stored with the props. Weight 50% is the live app's mix "
        "on a posted component. Bias is prediction minus actual."
    )
    order = (("atd", "Anytime TD"),) + tuple((key, label) for key, _m, _a, _y, label in STATS)
    for key, label in order:
        stat_rows = [r for r in rows if r["stat"] == key]
        if not stat_rows:
            continue
        groups = [("ALL", stat_rows)]
        for pos in POSITIONS:
            pos_rows = [r for r in stat_rows if r["pos"] == pos]
            if pos_rows:
                groups.append((pos, pos_rows))
        lines.append("")
        lines.append(label)
        lines.extend(_lines_for(groups))
        lines.extend(_calibration(stat_rows))
    lines.append("")
    lines.append(_history(len(docs)))
    return "\n".join(lines).rstrip() + "\n"


def main(argv=None):
    parser = argparse.ArgumentParser(description="Score frozen prop lines at several blend weights.")
    parser.add_argument("--week", type=int, required=True)
    parser.add_argument("--season", type=int, default=None)
    parser.add_argument("--root", help="Local archive root (the directory that contains 2026/wk06).")
    parser.add_argument("--actuals", help="JSON fixture instead of nflverse/ESPN.")
    args = parser.parse_args(argv)
    fixture = json.loads(Path(args.actuals).read_text()) if args.actuals else None
    if args.root:
        root = Path(args.root)
        season = discover_season(root, args.week, args.season)
    else:
        import tempfile
        tmp = tempfile.TemporaryDirectory()
        root = Path(tmp.name)
        season = extract_from_git(root, args.season, args.week)
        main._tmp = tmp  # noqa: SLF001
    directory = week_directory(root, season, args.week)
    if not directory.is_dir():
        raise SystemExit(f"Missing {directory}")
    sys.stdout.write(render_report(directory, season, args.week, fixture=fixture))
    return 0


if __name__ == "__main__":
    sys.exit(main())
