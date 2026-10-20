#!/usr/bin/env python3
"""Recover prop boards the hourly archive did not store.

Week that is still the open week in data.json (meta.next_week) gets the current
ESPN board plus the walk-forward component from project(). Games already kicked
off are frozen; the rest land in one hourly props file.

An older week is lines only. The spread and total come from the frozen
projection file. A prop ESPN updated after kickoff is replaced by site/market.json
when that file is the same week, and the cell is tagged src. Those files do not
carry a model component, so scripts/prop_backtest.py can calibrate the line and
cannot score the weight grid.

    python scripts/backfill_props.py --week 6 --root /path/to/snapshots --fallback site/market.json
    python scripts/backfill_props.py --week 7 --root /path/to/snapshots --data /path/to/data.json
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from fetch_market_espn import (  # noqa: E402
    ABBR,
    ATD_TYPE,
    TYPES,
    atd_quote,
    attach_game_prices,
    cell_from_quotes,
    get,
    quote_prices,
)
from archive_snapshot import parse_time, refresh_manifest, week_dir, write_frozen_props, write_hourly_props  # noqa: E402

NOTE = (
    "Recovered after the games were played. This is not the closing prop board. "
    "A cell with src is the last board saved in site/market.json before that week's Thursday night, "
    "not the number on the screen at kickoff. Lines ESPN moved during the game "
    "(especially passing yards and most receiving yards) were not kept. "
    "The spread and total are the line frozen with the projection, not a later number. "
    "No walk-forward component is stored, so the prop weight grid cannot score this week."
)
LINE_KEYS = ("pass_yds", "pass_att", "pass_cmp", "pass_td", "int", "rush_yds", "rush_att", "rec_yds", "rec")


def model_allowed(data, season, week):
    meta = (data or {}).get("meta") or {}
    try:
        return int(meta.get("season")) == int(season) and int(meta.get("next_week")) == int(week)
    except (TypeError, ValueError):
        return False


def _athlete_id(item):
    ref = ((item.get("athlete") or {}).get("$ref") or "").split("?", 1)[0]
    match = re.search(r"/athletes/(\d+)", ref)
    return match.group(1) if match else None


def _fresh(item, kickoff, started):
    if not started:
        return True
    updated = item.get("lastUpdated")
    if not updated or not kickoff:
        return False
    try:
        return parse_time(updated) < parse_time(kickoff)
    except (TypeError, ValueError):
        return False


def _priced_cell(quotes):
    cell = cell_from_quotes(quotes)
    if not cell or cell.get("line") is None:
        return None
    return {key: cell[key] for key in ("line", "over", "under", "p_over") if key in cell and cell[key] is not None}


def _fallback_cell(raw, src):
    if not isinstance(raw, dict) or raw.get("line") is None or not src:
        return None
    cell = {"line": raw["line"], "src": src}
    for key in ("over", "under", "p_over"):
        if raw.get(key) is not None:
            cell[key] = raw[key]
    return cell


def recover_game(items, fallback_props, game_key, kickoff, started, espn2name, fallback_src):
    """One game's prop board.

    A started game keeps an ESPN quote only when lastUpdated is strictly before
    kickoff. Anything else falls back to fallback_props and is tagged src.
    A game that has not kicked off uses the current ESPN line and is not tagged.
    """
    kept = {}
    rejected = set()
    atd_live = {}
    for item in items or []:
        espn_id = _athlete_id(item)
        if not espn_id:
            continue
        if espn2name is not None and str(espn_id) not in espn2name:
            continue
        fresh = _fresh(item, kickoff, started)
        current = item.get("current") or {}
        tname = (item.get("type") or {}).get("name")
        if tname == ATD_TYPE:
            if fresh:
                quote = atd_quote(current)
                if quote:
                    atd_live[espn_id] = quote
            continue
        mk = TYPES.get(tname)
        if not mk:
            continue
        value = (current.get("target") or {}).get("value") if isinstance(current, dict) else None
        if not fresh or value is None:
            if started and not fresh:
                rejected.add((espn_id, mk))
            continue
        over, under, p_over = quote_prices(current)
        kept.setdefault((espn_id, mk), []).append((float(value), over, under, p_over))

    fallback = {
        str(eid): rec for eid, rec in (fallback_props or {}).items()
        if isinstance(rec, dict) and rec.get("game") == game_key
    }
    props = {}

    def ensure(espn_id):
        rec = props.get(espn_id)
        if rec is None:
            known = (espn2name or {}).get(str(espn_id))
            fb = fallback.get(str(espn_id)) or {}
            name = known if isinstance(known, str) else (fb.get("name") or known)
            rec = {"name": name, "espn": str(espn_id), "game": game_key}
            props[espn_id] = rec
        return rec

    for (espn_id, mk), quotes in kept.items():
        cell = _priced_cell(quotes)
        if cell:
            ensure(espn_id)[mk] = cell
    for espn_id, quote in atd_live.items():
        ensure(espn_id)["atd"] = dict(quote)

    if started and fallback_src:
        for espn_id, rec in fallback.items():
            for mk in TYPES.values():
                if (espn_id, mk) in kept or not isinstance(rec.get(mk), dict):
                    continue
                if (espn_id, mk) not in rejected and any(eid == espn_id and key == mk for eid, key in kept):
                    continue
                cell = _fallback_cell(rec.get(mk), fallback_src)
                if cell:
                    ensure(espn_id)[mk] = cell
            if espn_id in atd_live:
                continue
            atd = rec.get("atd")
            if isinstance(atd, dict) and atd.get("p") is not None:
                copied = {"p": atd["p"], "src": fallback_src}
                if atd.get("odds") is not None:
                    copied["odds"] = atd["odds"]
                ensure(espn_id)["atd"] = copied
    elif not started and fallback_src:
        for espn_id, rec in fallback.items():
            atd = rec.get("atd")
            if espn_id in atd_live or not isinstance(atd, dict) or atd.get("p") is None:
                continue
            copied = {"p": atd["p"], "src": fallback_src}
            if atd.get("odds") is not None:
                copied["odds"] = atd["odds"]
            ensure(espn_id)["atd"] = copied
    return props


def _stamp(dt):
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H-%MZ")


def _iso(dt):
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _names_for(game_key, roster, fallback_props):
    names = {}
    for espn_id, player in (roster or {}).items():
        names[str(espn_id)] = player.get("name") or str(espn_id)
    for espn_id, rec in (fallback_props or {}).items():
        if isinstance(rec, dict) and rec.get("game") == game_key:
            names.setdefault(str(espn_id), rec.get("name"))
    return names


def _compact_player(espn_id, rec, roster, game_id):
    known = (roster or {}).get(str(espn_id)) or {}
    player = {
        "espn": str(espn_id),
        "name": known.get("name") or rec.get("name"),
        "game": game_id,
    }
    if known.get("id"):
        player["id"] = known["id"]
    if known.get("pos"):
        player["pos"] = known["pos"]
    if known.get("team"):
        player["team"] = known["team"]
    any_line = False
    for key in LINE_KEYS:
        cell = rec.get(key)
        if isinstance(cell, dict) and cell.get("line") is not None:
            player[key] = cell
            any_line = True
    atd = rec.get("atd")
    if isinstance(atd, dict) and atd.get("p") is not None:
        player["atd"] = atd
        any_line = True
    return player if any_line else None


def _before_kick(kickoff, fallback_as_of, tagged):
    kick = parse_time(kickoff)
    if tagged and fallback_as_of:
        try:
            generated = parse_time(fallback_as_of)
        except (TypeError, ValueError):
            generated = kick - timedelta(minutes=1)
    else:
        generated = kick - timedelta(minutes=1)
    if generated >= kick:
        generated = kick - timedelta(minutes=1)
    return generated


def _fetch_items(event_id, comp_id):
    items, page = [], 1
    while True:
        url = (
            "https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/events/"
            f"{event_id}/competitions/{comp_id}/odds/100/propBets?limit=1000&page={page}"
        )
        payload = get(url)
        items.extend(payload.get("items") or [])
        if page >= (payload.get("pageCount") or 1):
            break
        page += 1
    return items


def fetch_slate(season, week):
    url = (
        "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard"
        f"?week={week}&seasontype=2&dates={season}"
    )
    board = get(url)
    events = []
    items_by_key = {}
    for event in board.get("events") or []:
        comp = (event.get("competitions") or [{}])[0]
        teams = {}
        for side in comp.get("competitors") or []:
            abbr = ((side.get("team") or {}).get("abbreviation")) or ""
            teams[side.get("homeAway")] = ABBR.get(abbr, abbr)
        away, home = teams.get("away"), teams.get("home")
        if not away or not home:
            continue
        key = f"{away}@{home}"
        odds = (comp.get("odds") or [{}])[0]
        events.append({
            "key": key,
            "away": away,
            "home": home,
            "event_id": event.get("id"),
            "comp_id": comp.get("id"),
            "spread_home": odds.get("spread"),
            "total": odds.get("overUnder"),
            "odds": odds,
            "status": ((comp.get("status") or {}).get("type") or {}),
        })
        try:
            items_by_key[key] = _fetch_items(event.get("id"), comp.get("id"))
        except Exception as exc:  # noqa: BLE001
            items_by_key[key] = []
            events[-1]["props_error"] = str(exc)
    return events, items_by_key


def _load_json(path):
    if not path:
        return None
    with open(path) as handle:
        return json.load(handle)


def _matching_fallback(doc, week):
    if not isinstance(doc, dict) or int(doc.get("week") or -1) != int(week):
        return {}, None
    src = f"market.json {doc.get('as_of')}" if doc.get("as_of") else "market.json"
    return doc, src


def props_from_model(data_path, market):
    """buildSnapshot().props, including the pre-prop component on each player."""
    script = r"""
const fs = require('fs');
const { buildSnapshot } = require('./scripts/snapshot_projections');
const data = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
const market = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const snap = buildSnapshot(data, market);
if (!snap.props) process.exit(2);
process.stdout.write(JSON.stringify(snap.props));
"""
    handle = tempfile.NamedTemporaryFile("w", suffix=".json", delete=False)
    try:
        json.dump(market, handle)
        handle.close()
        proc = subprocess.run(
            ["node", "-e", script, str(data_path), handle.name],
            cwd=ROOT, text=True, capture_output=True,
        )
    finally:
        Path(handle.name).unlink(missing_ok=True)
    if proc.returncode != 0:
        raise SystemExit(proc.stderr or proc.stdout or "snapshot build failed")
    return json.loads(proc.stdout)


def _market_from_slate(week, events, items_by_key, names, as_of, started_keys):
    market = {
        "week": week,
        "as_of": as_of,
        "source": "ESPN (DraftKings)",
        "games": {},
        "props": {},
    }
    for event in events:
        key = event["key"]
        game = {"home": event["home"], "away": event["away"], "spread_home": event.get("spread_home"), "total": event.get("total")}
        if game["spread_home"] is not None and game["total"] is not None:
            game["spread_home"] = float(game["spread_home"])
            game["total"] = float(game["total"])
            game["itt_home"] = game["total"] / 2 - game["spread_home"] / 2
            game["itt_away"] = game["total"] / 2 + game["spread_home"] / 2
        attach_game_prices(game, event.get("odds") or {})
        market["games"][key] = game
        recovered = recover_game(
            items_by_key.get(key) or [], {}, key, None, key in started_keys, names, None,
        )
        for espn_id, rec in recovered.items():
            market["props"][str(espn_id)] = rec
    return market


def _freeze_one(root, season, week, game, players, generated, as_of, extra):
    body = {
        "v": 1,
        "kind": "prekickoff-props",
        "season": season,
        "week": week,
        "game_id": game["id"],
        "source_snapshot": extra.get("source_snapshot") or "recovered",
        "generated": _iso(generated),
        "as_of": as_of,
        "source": "ESPN (DraftKings)",
        "kickoff": game.get("kickoff"),
        "game": game,
        "players": players,
        "frozen_at": extra["frozen_at"],
    }
    for key in ("model_generated", "note", "recovered", "stale"):
        if extra.get(key):
            body[key] = extra[key]
    return write_frozen_props(root, body)


def install_lines_only(root, season, week, fallback, events, items_by_key, now):
    """Freeze recovered lines next to existing prekickoff projection files."""
    directory = week_dir(root, season, week)
    pre_dir = directory / "prekickoff"
    if not pre_dir.is_dir():
        return {"week": week, "wrote": [], "missing": "no prekickoff projection files on this archive"}
    fb_doc, fb_src = _matching_fallback(fallback, week)
    fb_props = fb_doc.get("props") or {}
    by_key = {event["key"]: event for event in events or []}
    wrote, empty = [], []
    for path in sorted(pre_dir.glob("*.json")):
        pre = json.loads(path.read_text())
        game = dict(pre.get("game") or {})
        gid = pre.get("game_id") or game.get("id")
        away, home = game.get("away"), game.get("home")
        kickoff = game.get("kickoff") or pre.get("kickoff")
        if not gid or not away or not home or not kickoff:
            continue
        game["id"] = gid
        game["kickoff"] = kickoff
        key = f"{away}@{home}"
        roster = {}
        for player in pre.get("players") or []:
            if player.get("espn"):
                roster[str(player["espn"])] = player
        names = _names_for(key, roster, fb_props)
        started = parse_time(kickoff) <= now
        recovered = recover_game(
            (items_by_key or {}).get(key) or [], fb_props, key, kickoff, started, names, fb_src,
        )
        players = []
        for espn_id, rec in sorted(recovered.items(), key=lambda pair: (str(pair[1].get("name") or ""), pair[0])):
            player = _compact_player(espn_id, rec, roster, gid)
            if player:
                players.append(player)
        if not players:
            empty.append(gid)
            continue
        tagged = any(
            (isinstance(player.get(stat), dict) and player[stat].get("src")) or (isinstance(player.get("atd"), dict) and player["atd"].get("src"))
            for player in players for stat in list(LINE_KEYS) + ["atd"]
        )
        generated = _before_kick(kickoff, fb_doc.get("as_of"), tagged)
        event = by_key.get(key) or {}
        # Started games keep the spread and total the projection froze. The final
        # scoreboard often has no close, and a later number is not the pre-kickoff line.
        if not started:
            if event.get("spread_home") is not None:
                game["spread_home"] = float(event["spread_home"])
            if event.get("total") is not None:
                game["total"] = float(event["total"])
            attach_game_prices(game, event.get("odds") or {})
        result = _freeze_one(root, season, week, game, players, generated, (fb_doc.get("as_of") if tagged else None) or _iso(generated), {
            "source_snapshot": "recovered",
            "frozen_at": _iso(now),
            "note": NOTE,
            "recovered": True,
        })
        wrote.append(result["wrote"] or gid)
    refresh_manifest(directory, season, week)
    return {"week": week, "mode": "lines-only", "wrote": wrote, "empty": empty, "games_seen": len(list(pre_dir.glob('*.json')))}


def install_modeled(root, season, week, props_doc, now, fallback_as_of=None):
    past, future_games, future_players = [], [], []
    for game in props_doc.get("games") or []:
        kickoff = game.get("kickoff")
        if not kickoff:
            continue
        players = [p for p in props_doc.get("players") or [] if p.get("game") == game.get("id")]
        if parse_time(kickoff) <= now:
            tagged = any(
                isinstance(p.get(stat), dict) and p[stat].get("src")
                for p in players for stat in LINE_KEYS
            )
            generated = _before_kick(kickoff, fallback_as_of, tagged)
            result = _freeze_one(root, season, week, game, players, generated, props_doc.get("as_of"), {
                "source_snapshot": props_doc.get("stamp") or "recovered",
                "frozen_at": _iso(now),
                "model_generated": props_doc.get("model_generated"),
            })
            if result.get("wrote"):
                past.append(result["wrote"])
        else:
            future_games.append(game)
            future_players.extend(players)
    hourly = None
    if future_games:
        doc = dict(props_doc)
        doc["generated"] = _iso(now)
        doc["stamp"] = _stamp(now)
        doc["games"] = future_games
        doc["players"] = future_players
        hourly = write_hourly_props(root, doc)
    return {"week": week, "mode": "modeled", "frozen": past, "hourly": (hourly or {}).get("wrote")}


def install(root, week, season=2026, data_path=None, fallback_path=None, now=None, events=None, items_by_key=None):
    now = now or datetime.now(timezone.utc)
    if isinstance(now, str):
        now = parse_time(now)
    fallback = _load_json(fallback_path) if fallback_path else None
    data = _load_json(data_path) if data_path else None
    allowed = bool(data_path) and model_allowed(data, season, week)
    if events is None:
        try:
            events, items_by_key = fetch_slate(season, week)
        except Exception as exc:  # noqa: BLE001
            events, items_by_key = [], {}
            fetch_error = str(exc)
        else:
            fetch_error = None
    else:
        fetch_error = None
        items_by_key = items_by_key or {}
    if allowed:
        names = {}
        for player in data.get("players") or []:
            espn_id = ((player.get("ids") or {}).get("espn"))
            if espn_id:
                names[str(espn_id)] = player.get("name")
        started = {
            event["key"] for event in events
            if (event.get("status") or {}).get("state") in ("in", "post")
        }
        market = _market_from_slate(week, events, items_by_key, names, _iso(now), started)
        if not market["props"] and not market["games"]:
            return {"week": week, "mode": "modeled", "wrote": [], "error": fetch_error or "ESPN returned no games"}
        props_doc = props_from_model(data_path, market)
        if data.get("meta", {}).get("generated"):
            props_doc["model_generated"] = props_doc.get("model_generated") or data["meta"]["generated"]
        summary = install_modeled(root, season, week, props_doc, now, (fallback or {}).get("as_of") if fallback and int((fallback or {}).get("week") or -1) == int(week) else None)
        if fetch_error:
            summary["fetch_error"] = fetch_error
        return summary
    summary = install_lines_only(root, season, week, fallback, events, items_by_key, now)
    if fetch_error:
        summary["fetch_error"] = fetch_error
    summary["model"] = "refused: data.json next_week does not match, so no walk-forward component was attached"
    return summary


def main(argv=None):
    parser = argparse.ArgumentParser(description="Backfill prop snapshots for one week.")
    parser.add_argument("--week", type=int, required=True)
    parser.add_argument("--season", type=int, default=2026)
    parser.add_argument("--root", required=True, help="Archive root that contains <season>/wkNN.")
    parser.add_argument("--data", help="data.json. Model components attach only when meta.next_week matches --week.")
    parser.add_argument("--fallback", help="market.json for lines ESPN no longer has from before kickoff. Ignored when its week differs.")
    parser.add_argument("--now", help="Override the clock (ISO).")
    args = parser.parse_args(argv)
    summary = install(
        args.root, args.week, season=args.season, data_path=args.data,
        fallback_path=args.fallback, now=args.now,
    )
    json.dump(summary, sys.stdout, indent=2)
    sys.stdout.write("\n")
    wrote = summary.get("wrote") or summary.get("frozen") or []
    if summary.get("hourly"):
        return 0
    if wrote:
        return 0
    return 2


if __name__ == "__main__":
    sys.exit(main())
