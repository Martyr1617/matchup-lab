#!/usr/bin/env python3
"""Score a week's pre-kickoff projections against actual PPR.

Reads the snapshots branch (or a local archive) and prints one report per
finished game, in the same shape as the Week 6 Thursday night writeup:
projected vs actual for everyone who played, mean absolute error, bias
(projection minus actual), floor-ceiling coverage, Spearman rank correlation,
and the biggest hits and misses with a one-line reason.

Actuals come from nflverse fantasy_points_ppr when that week is in the file,
otherwise from ESPN box scores scored with the app's PPR rules.

    python scripts/score_week.py --week 6
    python scripts/score_week.py --week 6 --season 2026
    python scripts/score_week.py --week 6 --root /path/to/snapshots
"""
from __future__ import annotations

import argparse
import csv
import io
import json
import math
import re
import subprocess
import sys
import urllib.request
from pathlib import Path

SKILL = {"QB", "RB", "WR", "TE", "FB"}
ABBR = {"WSH": "WAS", "LAR": "LA", "JAC": "JAX"}
NFLVERSE = "https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_{season}.csv"
DNP_PROJ = 4.0


def norm_name(text):
    name = str(text).lower()
    name = re.sub(r"\b(jr|sr|ii|iii|iv|v)\b\.?", "", name)
    return re.sub(r"[^a-z]", "", name)


def ppr_from_line(stats):
    """App PPR: 0.04/yd and 4 per pass TD, -2 INT, 0.1/6 rush, 1+0.1/6 rec, -2 fumble lost, 2 per 2-point conversion (passer and scorer)."""
    two = stats.get("two_pass", 0) + stats.get("two_rec", 0) + stats.get("two_rush", 0)
    return (
        0.04 * stats.get("pass_yd", 0) + 4 * stats.get("pass_td", 0) - 2 * stats.get("ints", 0)
        + 0.1 * stats.get("rush_yd", 0) + 6 * stats.get("rush_td", 0)
        + stats.get("rec", 0) + 0.1 * stats.get("rec_yd", 0) + 6 * stats.get("rec_td", 0)
        - 2 * stats.get("fum_lost", 0) + 2 * two
    )


def played(stats):
    return (
        stats.get("pass_att", 0) > 0 or stats.get("rush_att", 0) > 0
        or stats.get("targets", 0) > 0 or stats.get("rec", 0) > 0
        or stats.get("st_td", 0) > 0
    )


def reason(row):
    """One line from the stat line: injury, game script, or touchdown luck."""
    stats = row["stats"]
    delta = row["actual"] - row["proj"]
    pos = row["pos"]
    td = stats.get("pass_td", 0) + stats.get("rush_td", 0) + stats.get("rec_td", 0)
    two = stats.get("two_pass", 0) + stats.get("two_rec", 0) + stats.get("two_rush", 0)
    if stats.get("st_td"):
        return "A special-teams touchdown the projection does not model."
    if abs(delta) < 1.5:
        if pos == "QB" and stats.get("ints", 0) >= 2 and stats.get("pass_yd", 0) >= 250:
            return "Interceptions and volume cancelled, so the points landed near the number."
        return "Landed next to the projection."
    if stats.get("fum_lost", 0) and two and delta > 2:
        return "A two-point conversion, with a lost fumble giving two points back."
    if stats.get("rush_td", 0) and delta >= 3.5 and stats.get("rush_yd", 0) <= 50:
        return "A rushing touchdown accounts for most of the miss; the yardage was light."
    if stats.get("rec_td", 0) and delta >= 3.5 and stats.get("rec_yd", 0) <= 40:
        return "A short receiving touchdown accounts for most of the miss."
    if td >= 1 and delta >= 3:
        return "Touchdown luck on top of the yardage."
    if pos == "QB" and delta <= -4 and stats.get("pass_td", 0) == 0 and stats.get("pass_yd", 0) < 180:
        return "The passing game stalled: low yards and no touchdown."
    if delta >= 4 and td == 0 and (stats.get("targets", 0) >= 8 or stats.get("pass_att", 0) >= 35 or stats.get("rec", 0) >= 8):
        return "Volume without a touchdown."
    if pos == "RB" and delta <= -4 and stats.get("rush_td", 0) == 0 and stats.get("rec", 0) <= 1:
        return "The carries didn't score and the catches weren't there."
    if pos in ("WR", "TE") and delta <= -3 and stats.get("rec_td", 0) == 0 and stats.get("rec_yd", 0) < 30:
        return "The passing game never got him the ball."
    if two and delta > 1:
        return "A two-point conversion the weekly mean does not expect."
    if td and abs(delta) < 3:
        return "A touchdown on a small workload, and the points stayed close."
    if stats.get("ints", 0) >= 2 and delta < -1:
        return "Interceptions, not the yardage, pulled the total down."
    if stats.get("fum_lost", 0) and delta < -1:
        return "A lost fumble took two points off the line."
    if row.get("inj") and delta < -3:
        return f"Injury ({row['inj']}) cut the week short."
    if delta > 0:
        return "The week ran hotter than the mean."
    return "The week ran colder than the mean."


def _ranks(values):
    order = sorted(range(len(values)), key=lambda i: values[i])
    ranks = [0.0] * len(values)
    i = 0
    while i < len(values):
        j = i
        while j + 1 < len(values) and values[order[j + 1]] == values[order[i]]:
            j += 1
        avg = (i + j) / 2 + 1
        for k in range(i, j + 1):
            ranks[order[k]] = avg
        i = j + 1
    return ranks


def spearman(pairs):
    if len(pairs) < 2:
        return None
    xs = _ranks([p[0] for p in pairs])
    ys = _ranks([p[1] for p in pairs])
    mx, my = sum(xs) / len(xs), sum(ys) / len(ys)
    num = sum((a - mx) * (b - my) for a, b in zip(xs, ys))
    dx = math.sqrt(sum((a - mx) ** 2 for a in xs))
    dy = math.sqrt(sum((b - my) ** 2 for b in ys))
    if dx == 0 or dy == 0:
        return None
    return num / (dx * dy)


def summarize(rows):
    """rows need proj, actual, floor, ceil."""
    n = len(rows)
    if not n:
        return {"n": 0, "mae": None, "bias": None, "inside": 0, "spearman": None}
    errs = [r["proj"] - r["actual"] for r in rows]
    inside = sum(1 for r in rows if r["floor"] <= r["actual"] <= r["ceil"])
    return {
        "n": n,
        "mae": sum(abs(e) for e in errs) / n,
        "bias": sum(errs) / n,
        "inside": inside,
        "spearman": spearman([(r["proj"], r["actual"]) for r in rows]),
    }


def _fmt(n):
    return f"{n:.1f}"


def _bias_phrase(bias):
    if bias > 0.05:
        return "the model was high"
    if bias < -0.05:
        return "the model was low"
    return "the model was even"


def format_game(game, scored, notes, actual_source):
    """Markdown report for one game. `scored` rows include name, team, pos, proj, actual, floor, ceil, reason."""
    home, away = game["home"], game["away"]
    title = f"{away} at {home}"
    lines = []
    status = game.get("status") or "unknown"
    if status != "final":
        detail = game.get("detail") or status
        lines.append(f"{title} is not final ({detail}). No projected-vs-actual scoring until the game is over.")
        if game.get("snapshot"):
            lines.append(f"Pre-kickoff snapshot: {game['snapshot']} ({game.get('generated')}).")
        return "\n".join(lines)
    ot = " in overtime" if game.get("ot") else ""
    lines.append(f"{title} is final: {away} {game.get('away_score')}, {home} {game.get('home_score')}{ot}.")
    stats = summarize(scored)
    if not stats["n"]:
        lines.append("No skill players both played and had a projection.")
        lines.extend(notes)
        return "\n".join(lines)
    rho = "n/a" if stats["spearman"] is None else f"{stats['spearman']:.2f}"
    lines.append(
        f"On the {stats['n']} skill players who both played and had a line: "
        f"mean absolute error {_fmt(stats['mae'])} PPR points. "
        f"Bias {_fmt(stats['bias']) if stats['bias'] < 0 else '+' + _fmt(stats['bias'])} "
        f"(projection minus actual, so {_bias_phrase(stats['bias'])}). "
        f"{stats['inside']} of {stats['n']} landed inside the floor-ceiling band. "
        f"Spearman rank correlation {rho}."
    )
    spread = game.get("spread_home")
    total = game.get("total")
    if spread is not None and total is not None:
        sign = "+" if spread > 0 else ""
        lines.append(f"Pre-kickoff line on the snapshot: {home} {sign}{spread:g}, total {total:g}.")
    by_team = {}
    for row in scored:
        slot = by_team.setdefault(row["team"], [0.0, 0.0])
        slot[0] += row["proj"]
        slot[1] += row["actual"]
    bits = [f"{tm} {by_team[tm][1]:.0f} actual vs {by_team[tm][0]:.0f} projected" for tm in (away, home) if tm in by_team]
    if bits:
        lines.append("Skill-player pool: " + "; ".join(bits) + ".")
    lines.append("")
    lines.append("| Player | Proj | Actual | Proj − actual | Floor–ceiling |")
    lines.append("|---|---:|---:|---:|---|")
    ordered = sorted(scored, key=lambda r: (-abs(r["proj"] - r["actual"]), r["name"]))
    for row in ordered:
        gap = row["proj"] - row["actual"]
        gap_s = f"{gap:+.1f}"
        band = f"{_fmt(row['floor'])}–{_fmt(row['ceil'])}"
        if not (row["floor"] <= row["actual"] <= row["ceil"]):
            band += ", outside"
        lines.append(f"| {row['name']}, {row['team']} {row['pos']} | {_fmt(row['proj'])} | {_fmt(row['actual'])} | {gap_s} | {band} |")
    lines.append("")
    lines.append("Floors are the app's P10 (tighter for a healthy top-12 starter, wide otherwise, and not shown below zero). Ceilings are the wide P90. Many floors sit at 0, so landing inside the band is a soft test.")
    misses = ordered[:5]
    hits = sorted(scored, key=lambda r: (abs(r["proj"] - r["actual"]), -r["proj"]))[:3]
    lines.append("")
    lines.append("**Misses**")
    for row in misses:
        lines.append(f"- **{row['name']}, {_fmt(row['proj'])} vs {_fmt(row['actual'])}.** {row['reason']}")
    lines.append("")
    lines.append("**Hits**")
    for row in hits:
        lines.append(f"- **{row['name']}, {_fmt(row['proj'])} vs {_fmt(row['actual'])}.** {row['reason']}")
    if notes:
        lines.append("")
        lines.extend(notes)
    lines.append("")
    lines.append(f"Projections: pre-kickoff snapshot {game.get('snapshot')} (generated {game.get('generated')}).")
    lines.append(f"Actuals: {actual_source}.")
    return "\n".join(lines)


def _num(value):
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def actuals_from_nflverse_rows(rows, week):
    """Turn stats_player_week rows into actuals keyed by gsis id. Empty if this week is absent."""
    week = str(week)
    matched = [r for r in rows if str(r.get("week")) == week and (r.get("season_type") in (None, "", "REG"))]
    if not matched:
        return {}
    out = {}
    for row in matched:
        stats = {
            "pass_att": _num(row.get("attempts")),
            "pass_yd": _num(row.get("passing_yards")),
            "pass_td": _num(row.get("passing_tds")),
            "ints": _num(row.get("passing_interceptions")),
            "rush_att": _num(row.get("carries")),
            "rush_yd": _num(row.get("rushing_yards")),
            "rush_td": _num(row.get("rushing_tds")),
            "rec": _num(row.get("receptions")),
            "rec_yd": _num(row.get("receiving_yards")),
            "rec_td": _num(row.get("receiving_tds")),
            "targets": _num(row.get("targets")),
            "fum_lost": _num(row.get("fumbles_lost_total")),
            "two_pass": _num(row.get("passing_2pt_conversions")),
            "two_rush": _num(row.get("rushing_2pt_conversions")),
            "two_rec": _num(row.get("receiving_2pt_conversions")),
            "st_td": _num(row.get("special_teams_tds")),
        }
        points = row.get("fantasy_points_ppr")
        actual = _num(points) if points not in (None, "") else ppr_from_line(stats)
        if stats["st_td"] and points in (None, ""):
            actual += 6 * stats["st_td"]
        if not played(stats) and actual == 0:
            continue
        pos = (row.get("position") or "").upper()
        if pos not in SKILL and not played(stats):
            continue
        out[row.get("player_id")] = {
            "id": row.get("player_id"),
            "name": row.get("player_display_name") or row.get("player_name"),
            "team": ABBR.get(row.get("team"), row.get("team")),
            "pos": pos,
            "actual": actual,
            "stats": stats,
        }
    return out


def _fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": "MatchupLab/1.0"})
    with urllib.request.urlopen(req, timeout=40) as resp:
        return resp.read()


def fetch_nflverse(season, week):
    try:
        raw = _fetch(NFLVERSE.format(season=season))
    except Exception as exc:
        return {}, f"nflverse unavailable ({exc})"
    rows = list(csv.DictReader(io.StringIO(raw.decode("utf-8", "replace"))))
    actuals = actuals_from_nflverse_rows(rows, week)
    if not actuals:
        return {}, f"nflverse has no week {week} rows yet"
    return actuals, "nflverse fantasy_points_ppr"


def _team_abbr(competitor):
    abbr = (competitor.get("team") or {}).get("abbreviation") or ""
    return ABBR.get(abbr, abbr)


TWO_PASS = re.compile(r"\((.+?) Pass to (.+?) for Two-Point Conversion\)", re.I)
TWO_RUSH = re.compile(r"\((.+?) (?:run|rush) for Two-Point Conversion\)", re.I)


def parse_espn_summary(summary, home, away):
    """Box score -> list of skill-player actuals, plus a status dict."""
    players = {}

    def slot(team, athlete):
        eid = str(athlete.get("id"))
        return players.setdefault(eid, {
            "espn": eid,
            "name": athlete.get("displayName"),
            "team": team,
            "pos": None,
            "stats": {
                "pass_att": 0, "pass_yd": 0, "pass_td": 0, "ints": 0,
                "rush_att": 0, "rush_yd": 0, "rush_td": 0,
                "rec": 0, "rec_yd": 0, "rec_td": 0, "targets": 0,
                "fum_lost": 0, "two_pass": 0, "two_rush": 0, "two_rec": 0, "st_td": 0,
            },
        })

    for side in (summary.get("boxscore") or {}).get("players") or []:
        team = _team_abbr({"team": side.get("team") or {}})
        if team not in (home, away):
            team = (side.get("team") or {}).get("abbreviation")
        for group in side.get("statistics") or []:
            keys = group.get("keys") or []
            name = group.get("name")
            for athlete in group.get("athletes") or []:
                rec = slot(team, athlete.get("athlete") or {})
                sm = dict(zip(keys, athlete.get("stats") or []))
                if name == "passing":
                    att = str(sm.get("completions/passingAttempts") or "0/0").split("/")
                    rec["stats"]["pass_att"] = _num(att[1] if len(att) > 1 else 0)
                    rec["stats"]["pass_yd"] = _num(sm.get("passingYards"))
                    rec["stats"]["pass_td"] = _num(sm.get("passingTouchdowns"))
                    rec["stats"]["ints"] = _num(sm.get("interceptions"))
                elif name == "rushing":
                    rec["stats"]["rush_att"] = _num(sm.get("rushingAttempts"))
                    rec["stats"]["rush_yd"] = _num(sm.get("rushingYards"))
                    rec["stats"]["rush_td"] = _num(sm.get("rushingTouchdowns"))
                elif name == "receiving":
                    rec["stats"]["rec"] = _num(sm.get("receptions"))
                    rec["stats"]["rec_yd"] = _num(sm.get("receivingYards"))
                    rec["stats"]["rec_td"] = _num(sm.get("receivingTouchdowns"))
                    rec["stats"]["targets"] = _num(sm.get("receivingTargets"))
                elif name == "fumbles":
                    rec["stats"]["fum_lost"] = _num(sm.get("fumblesLost"))
    by_norm = {}
    for rec in players.values():
        by_norm.setdefault(norm_name(rec["name"]), rec)
    for play in summary.get("scoringPlays") or []:
        text = play.get("text") or ""
        passed = TWO_PASS.search(text)
        rushed = TWO_RUSH.search(text)
        if passed:
            qb, catcher = by_norm.get(norm_name(passed.group(1))), by_norm.get(norm_name(passed.group(2)))
            if qb:
                qb["stats"]["two_pass"] += 1
            if catcher:
                catcher["stats"]["two_rec"] += 1
        elif rushed:
            runner = by_norm.get(norm_name(rushed.group(1)))
            if runner:
                runner["stats"]["two_rush"] += 1
    actuals = []
    for rec in players.values():
        if not played(rec["stats"]):
            continue
        rec["actual"] = ppr_from_line(rec["stats"])
        actuals.append(rec)
    header = ((summary.get("header") or {}).get("competitions") or [{}])[0]
    status = (header.get("status") or {}).get("type") or {}
    scores = {}
    for comp in header.get("competitors") or []:
        scores[_team_abbr(comp)] = comp.get("score")
    detail = status.get("shortDetail") or status.get("detail") or ""
    return {
        "actuals": actuals,
        "final": bool(status.get("completed")) or status.get("name") == "STATUS_FINAL",
        "ot": "OT" in detail.upper() or "OVERTIME" in (status.get("detail") or "").upper(),
        "detail": detail,
        "scores": scores,
    }


def fetch_espn_game(event_id):
    raw = _fetch(f"https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event={event_id}")
    return json.loads(raw)


def fetch_espn_scoreboard(season, week):
    raw = _fetch(
        f"https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?week={week}&seasontype=2&dates={season}"
    )
    return json.loads(raw)


def _match_event(events, game):
    for event in events:
        comp = (event.get("competitions") or [{}])[0]
        teams = {_team_abbr(c): c for c in comp.get("competitors") or []}
        if game["home"] in teams and game["away"] in teams:
            return event, comp, teams
    return None, None, None


def load_actuals(season, week, games, fixture=None):
    """Return (by_game_id dict, source label). Fixture short-circuits the network."""
    if fixture is not None:
        return fixture, fixture.get("source") or "fixture"
    by_game = {}
    nfl, nfl_note = fetch_nflverse(season, week)
    use_nfl = bool(nfl)
    events = []
    espn_note = None
    try:
        board = fetch_espn_scoreboard(season, week)
        events = board.get("events") or []
    except Exception as exc:
        espn_note = f"ESPN scoreboard unavailable ({exc})"
    for game in games:
        event, comp, teams = _match_event(events, game)
        status = ((comp or {}).get("status") or {}).get("type") or {}
        final = bool(status.get("completed")) or status.get("name") == "STATUS_FINAL"
        detail = status.get("shortDetail") or status.get("detail") or ""
        entry = {
            "final": final,
            "ot": "OT" in detail.upper(),
            "detail": detail,
            "away_score": (teams or {}).get(game["away"], {}).get("score") if teams else None,
            "home_score": (teams or {}).get(game["home"], {}).get("score") if teams else None,
            "players": [],
        }
        if use_nfl and final:
            wanted = {game["home"], game["away"]}
            entry["players"] = [row for row in nfl.values() if row.get("team") in wanted]
            entry["source"] = "nflverse fantasy_points_ppr"
        elif final and event:
            try:
                parsed = parse_espn_summary(fetch_espn_game(event["id"]), game["home"], game["away"])
            except Exception as exc:
                entry["final"] = False
                entry["detail"] = f"box score unavailable ({exc})"
            else:
                entry["players"] = parsed["actuals"]
                entry["ot"] = parsed["ot"]
                entry["final"] = parsed["final"]
                entry["away_score"] = parsed["scores"].get(game["away"], entry["away_score"])
                entry["home_score"] = parsed["scores"].get(game["home"], entry["home_score"])
                entry["source"] = "ESPN box score, app PPR (nflverse has no rows for this week yet)" if "no week" in (nfl_note or "") else "ESPN box score, app PPR"
        elif not final:
            entry["source"] = espn_note or nfl_note or "game not final"
        else:
            entry["final"] = False
            entry["detail"] = nfl_note or espn_note or "no actuals"
            entry["source"] = entry["detail"]
        by_game[game["id"]] = entry
    return {"games": by_game}, None


def _index_projections(players):
    by_id, by_espn, by_name = {}, {}, {}
    for pl in players:
        if pl.get("id") is not None:
            by_id[str(pl["id"])] = pl
        if pl.get("espn"):
            by_espn[str(pl["espn"])] = pl
        by_name[(norm_name(pl.get("name")), pl.get("team"))] = pl
    return by_id, by_espn, by_name


def _match_projection(actual, indexes):
    by_id, by_espn, by_name = indexes
    if actual.get("id") and str(actual["id"]) in by_id:
        return by_id[str(actual["id"])]
    if actual.get("espn") and str(actual["espn"]) in by_espn:
        return by_espn[str(actual["espn"])]
    return by_name.get((norm_name(actual.get("name")), actual.get("team")))


def score_game(pre, actual_entry):
    indexes = _index_projections(pre.get("players") or [])
    game = dict(pre.get("game") or {})
    game.update({
        "snapshot": pre.get("source_snapshot"),
        "generated": pre.get("generated"),
        "status": "final" if actual_entry.get("final") else "pending",
        "ot": actual_entry.get("ot"),
        "detail": actual_entry.get("detail"),
        "away_score": actual_entry.get("away_score"),
        "home_score": actual_entry.get("home_score"),
    })
    if not actual_entry.get("final"):
        return format_game(game, [], [], actual_entry.get("source") or "")
    scored = []
    matched_ids = set()
    unmatched = []
    for actual in actual_entry.get("players") or []:
        proj = _match_projection(actual, indexes)
        if not proj:
            if (actual.get("pos") or "QB") in SKILL or played(actual.get("stats") or {}):
                unmatched.append(actual)
            continue
        matched_ids.add(id(proj))
        row = {
            "name": proj["name"],
            "team": proj["team"],
            "pos": proj["pos"],
            "proj": proj["proj"],
            "actual": actual["actual"],
            "floor": proj["floor"],
            "ceil": proj["ceil"],
            "inj": proj.get("inj"),
            "stats": actual.get("stats") or {},
        }
        row["reason"] = reason(row)
        scored.append(row)
    notes = []
    dnp = []
    for proj in pre.get("players") or []:
        if id(proj) in matched_ids:
            continue
        if proj.get("proj", 0) >= DNP_PROJ:
            dnp.append(f"{proj['name']} {proj['team']} {proj['pos']} {proj['proj']:.1f}")
    if dnp:
        notes.append("Projected at least 4 points and did not appear in the box score: " + "; ".join(sorted(dnp)) + ". They are not in the error stats.")
    if unmatched:
        bits = []
        for actual in unmatched:
            bits.append(f"{actual.get('name')} {actual.get('team') or ''} {actual.get('actual'):.1f}".strip())
        notes.append("Played and were not in the projection pool: " + "; ".join(sorted(bits)) + ". They are not in the error stats.")
    return format_game(game, scored, notes, actual_entry.get("source") or "actuals")


def week_directory(root, season, week):
    return Path(root) / str(season) / f"wk{int(week):02d}"


def load_prekickoff(directory: Path):
    pre = directory / "prekickoff"
    if not pre.is_dir():
        return []
    docs = []
    for path in sorted(pre.glob("*.json")):
        with open(path) as f:
            docs.append(json.load(f))
    docs.sort(key=lambda doc: doc.get("kickoff") or "")
    return docs


def load_hourly(directory: Path):
    docs = []
    if not directory.is_dir():
        return docs
    for path in sorted(directory.glob("*.json")):
        if path.name == "manifest.json":
            continue
        with open(path) as f:
            docs.append(json.load(f))
    docs.sort(key=lambda doc: doc.get("generated") or "")
    return docs


def pending_lines(directory, frozen_ids):
    hourly = load_hourly(directory)
    if not hourly:
        return ["No hourly snapshot is stored for this week yet."]
    latest = hourly[-1]
    lines = []
    for game in latest.get("games") or []:
        if game.get("id") in frozen_ids:
            continue
        kick = game.get("kickoff")
        if kick and kick > latest.get("generated", ""):
            lines.append(f"{game['away']} at {game['home']} has not reached kickoff ({kick}). No pre-kickoff file yet.")
        else:
            lines.append(f"{game['away']} at {game['home']} has no frozen pre-kickoff snapshot.")
    return lines


def extract_from_git(dest: Path, season, week):
    """Copy snapshots/{season}/wkNN out of origin/snapshots. Returns the season used."""
    subprocess.run(["git", "fetch", "--depth=1", "origin", "snapshots"], check=False, capture_output=True)
    if season is None:
        top = subprocess.run(
            ["git", "ls-tree", "--name-only", "origin/snapshots", "snapshots"],
            check=False, capture_output=True, text=True,
        )
        years = []
        for line in (top.stdout or "").splitlines():
            name = line.strip().rstrip("/").split("/")[-1]
            if not name.isdigit():
                continue
            probe = subprocess.run(
                ["git", "ls-tree", "--name-only", "origin/snapshots", f"snapshots/{name}/wk{int(week):02d}"],
                check=False, capture_output=True, text=True,
            )
            if probe.stdout.strip():
                years.append(int(name))
        if not years:
            raise SystemExit(
                f"No snapshots/*/wk{int(week):02d} on origin/snapshots. "
                "The hourly refresh writes that branch after this change is on main."
            )
        season = max(years)
    prefix = f"snapshots/{season}/wk{int(week):02d}"
    listed = subprocess.run(
        ["git", "ls-tree", "-r", "--name-only", "origin/snapshots", prefix],
        check=False, capture_output=True, text=True,
    )
    if listed.returncode != 0 or not listed.stdout.strip():
        raise SystemExit(
            f"No {prefix} on origin/snapshots. "
            "The hourly refresh writes that branch after this change is on main."
        )
    for rel in listed.stdout.splitlines():
        rel = rel.strip()
        if not rel:
            continue
        target = dest / rel.split("/", 1)[1]  # drop leading snapshots/
        target.parent.mkdir(parents=True, exist_ok=True)
        blob = subprocess.run(["git", "show", f"origin/snapshots:{rel}"], check=True, capture_output=True)
        target.write_bytes(blob.stdout)
    return season


def discover_season(root, week, season):
    if season:
        return season
    root = Path(root)
    found = []
    if root.is_dir():
        for child in root.iterdir():
            if child.is_dir() and child.name.isdigit() and (child / f"wk{int(week):02d}").is_dir():
                found.append(int(child.name))
    if not found:
        raise SystemExit(f"No wk{int(week):02d} directory under {root}. Pass --season.")
    return max(found)


def render_week(directory, season, week, fixture=None):
    pres = load_prekickoff(directory)
    frozen_ids = {doc.get("game_id") for doc in pres}
    parts = [f"Week {week}, {season}"]
    if not pres:
        parts.append("No game has a frozen pre-kickoff snapshot yet. The first refresh after a game's kickoff writes that file.")
        parts.extend(pending_lines(directory, frozen_ids))
        return "\n".join(parts)
    games = [doc["game"] for doc in pres]
    if fixture is None:
        payload, _ = load_actuals(season, week, games)
    else:
        payload = fixture
    by_game = payload.get("games") or {}
    for doc in pres:
        entry = by_game.get(doc["game_id"]) or {
            "final": False,
            "detail": "no actuals for this game",
            "source": "no actuals for this game",
        }
        parts.append("")
        parts.append(score_game(doc, entry))
    parts.extend([""] + pending_lines(directory, frozen_ids))
    return "\n".join(parts).rstrip() + "\n"


def main(argv=None):
    parser = argparse.ArgumentParser(description="Score pre-kickoff projections against actual PPR.")
    parser.add_argument("--week", type=int, required=True)
    parser.add_argument("--season", type=int, default=None)
    parser.add_argument("--root", help="Local archive root (the directory that contains 2026/wk06).")
    parser.add_argument("--actuals", help="JSON fixture instead of nflverse/ESPN. For tests and reruns.")
    args = parser.parse_args(argv)
    fixture = None
    if args.actuals:
        with open(args.actuals) as f:
            fixture = json.load(f)
    if args.root:
        root = Path(args.root)
        season = discover_season(root, args.week, args.season)
    else:
        import tempfile
        tmp = tempfile.TemporaryDirectory()
        root = Path(tmp.name)
        season = extract_from_git(root, args.season, args.week)
        main._tmp = tmp  # noqa: SLF001 keep the extract until the process exits
    directory = week_directory(root, season, args.week)
    if not directory.is_dir():
        raise SystemExit(f"Missing {directory}")
    sys.stdout.write(render_week(directory, season, args.week, fixture=fixture))
    return 0


if __name__ == "__main__":
    sys.exit(main())
