#!/usr/bin/env python3
"""Archive one projection snapshot onto the long-lived snapshots branch.

The data branch is force-pushed every hour, so this tree is a different
branch and is only ever fast-forwarded. Layout:

    snapshots/2026/wk06/2026-10-15T16-35Z.json
    snapshots/2026/wk06/props/2026-10-15T16-35Z.json
    snapshots/2026/wk06/prekickoff/2026_06_SEA_DEN.json
    snapshots/2026/wk06/prekickoff/props/2026_06_SEA_DEN.json
    snapshots/2026/wk06/manifest.json

Hourly projection files and hourly prop files are each pruned to the latest
KEEP_HOURLY. The pre-kickoff projection, and the prop file beside it, are the
last hourly record published strictly before that game's kickoff. They are
written on the first archive whose own timestamp is at or after kickoff.
Thursday, Sunday early, Sunday late, Sunday night, and Monday each freeze on
their own kickoff. A frozen prop file is never replaced.

    python scripts/archive_snapshot.py snap.json --root /tmp/archive
    python scripts/archive_snapshot.py snap.json --push
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

KEEP_HOURLY = 6


def parse_time(text):
    raw = str(text).strip().replace(" UTC", "Z").replace(" ", "T")
    if raw.endswith("Z"):
        raw = raw[:-1] + "+00:00"
    dt = datetime.fromisoformat(raw)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def week_dir(root: Path, season, week) -> Path:
    return Path(root) / str(season) / f"wk{int(week):02d}"


def _load(path: Path):
    with open(path) as f:
        return json.load(f)


def _dump(path: Path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w") as f:
        json.dump(obj, f, separators=(",", ":"))
        f.write("\n")


def hourly_paths(directory: Path):
    if not directory.is_dir():
        return []
    return sorted(p for p in directory.glob("*.json") if p.name != "manifest.json")


def _projection_body(snapshot):
    return {k: v for k, v in snapshot.items() if k != "props"}


def _load_hourly(directory: Path):
    docs = []
    for path in hourly_paths(directory):
        doc = _load(path)
        doc["_path"] = path
        docs.append(doc)
    docs.sort(key=lambda doc: parse_time(doc["generated"]))
    return docs


def _prune(docs, keep):
    if keep < 0:
        keep = 0
    keep_paths = {doc["_path"].resolve() for doc in docs[-keep:]} if keep else set()
    removed = []
    for doc in docs:
        if doc["_path"].resolve() in keep_paths:
            continue
        doc["_path"].unlink()
        removed.append(doc.get("stamp"))
    kept = [doc.get("stamp") for doc in docs if doc["_path"].resolve() in keep_paths]
    return kept, removed


def _props_slice(doc, gid, frozen_at):
    game = next(g for g in doc.get("games") or [] if g.get("id") == gid)
    players = [p for p in doc.get("players") or [] if p.get("game") == gid]
    body = {
        "v": 1,
        "kind": "prekickoff-props",
        "season": doc["season"],
        "week": doc["week"],
        "game_id": gid,
        "source_snapshot": doc.get("stamp"),
        "generated": doc.get("generated"),
        "as_of": doc.get("as_of"),
        "source": doc.get("source"),
        "kickoff": game.get("kickoff"),
        "game": game,
        "players": players,
    }
    if doc.get("model_generated"):
        body["model_generated"] = doc["model_generated"]
    if doc.get("stale"):
        body["stale"] = True
    if doc.get("note"):
        body["note"] = doc["note"]
    if doc.get("recovered"):
        body["recovered"] = True
    body["frozen_at"] = frozen_at
    return body


def _freeze_props(directory: Path, now, frozen_at):
    docs = _load_hourly(directory / "props")
    pre_dir = directory / "prekickoff" / "props"
    frozen = []
    seen = {}
    for doc in docs:
        for game in doc.get("games") or []:
            gid = game.get("id")
            if gid and gid not in seen:
                seen[gid] = game
    for gid, game in seen.items():
        pre_path = pre_dir / f"{gid}.json"
        if pre_path.exists():
            continue
        kick = game.get("kickoff")
        if not kick or parse_time(kick) > now:
            continue
        earlier = [
            doc for doc in docs
            if parse_time(doc["generated"]) < parse_time(kick)
            and any(g.get("id") == gid for g in doc.get("games") or [])
        ]
        if not earlier:
            continue
        _dump(pre_path, _props_slice(earlier[-1], gid, frozen_at))
        frozen.append(gid)
    return frozen


def refresh_manifest(directory: Path, season, week, keep=None):
    directory = Path(directory)
    man_path = directory / "manifest.json"
    existing = _load(man_path) if man_path.exists() else {}
    if keep is None:
        keep = existing.get("keep_hourly", KEEP_HOURLY)
    manifest = {
        "v": 1,
        "season": season,
        "week": week,
        "keep_hourly": keep,
        "hourly": [doc.get("stamp") for doc in _load_hourly(directory)],
        "props": [doc.get("stamp") for doc in _load_hourly(directory / "props")],
        "prekickoff": {},
        "prekickoff_props": {},
    }
    pre_dir = directory / "prekickoff"
    if pre_dir.is_dir():
        for path in sorted(pre_dir.glob("*.json")):
            doc = _load(path)
            gid = doc.get("game_id")
            if not gid:
                continue
            manifest["prekickoff"][gid] = {
                "snapshot": doc.get("source_snapshot"),
                "kickoff": doc.get("kickoff"),
                "generated": doc.get("generated"),
                "frozen_at": doc.get("frozen_at"),
            }
    props_pre = pre_dir / "props"
    if props_pre.is_dir():
        for path in sorted(props_pre.glob("*.json")):
            doc = _load(path)
            gid = doc.get("game_id")
            if not gid:
                continue
            manifest["prekickoff_props"][gid] = {
                "snapshot": doc.get("source_snapshot"),
                "kickoff": doc.get("kickoff"),
                "generated": doc.get("generated"),
                "frozen_at": doc.get("frozen_at"),
                "as_of": doc.get("as_of"),
                "players": len(doc.get("players") or []),
                "recovered": bool(doc.get("recovered")),
            }
    _dump(man_path, manifest)
    return manifest


def write_frozen_props(root, body):
    for key in ("season", "week", "game_id", "game", "players"):
        if key not in body:
            raise ValueError(f"frozen props missing {key}")
    directory = week_dir(root, body["season"], body["week"])
    path = directory / "prekickoff" / "props" / f"{body['game_id']}.json"
    if path.exists():
        return {"wrote": None, "path": str(path)}
    _dump(path, body)
    refresh_manifest(directory, body["season"], body["week"])
    return {"wrote": body["game_id"], "path": str(path)}


def write_hourly_props(root, doc, keep=KEEP_HOURLY):
    for key in ("season", "week", "generated", "stamp", "games", "players"):
        if key not in doc:
            raise ValueError(f"props snapshot missing {key}")
    directory = week_dir(root, doc["season"], doc["week"])
    directory.mkdir(parents=True, exist_ok=True)
    _dump(directory / "props" / f"{doc['stamp']}.json", doc)
    frozen = _freeze_props(directory, parse_time(doc["generated"]), doc["generated"])
    kept, removed = _prune(_load_hourly(directory / "props"), keep)
    refresh_manifest(directory, doc["season"], doc["week"], keep=keep)
    return {"wrote": doc["stamp"], "frozen": frozen, "removed": removed, "hourly": kept}


def _game_slice(snapshot, game):
    gid = game["id"]
    players = [p for p in snapshot.get("players") or [] if p.get("game") == gid]
    return {
        "v": 1,
        "kind": "prekickoff",
        "season": snapshot["season"],
        "week": snapshot["week"],
        "game_id": gid,
        "source_snapshot": snapshot["stamp"],
        "generated": snapshot["generated"],
        "kickoff": game["kickoff"],
        "scoring": snapshot.get("scoring") or "ppr",
        "tv_note": snapshot.get("tv_note"),
        "game": game,
        "players": players,
    }


def archive(root, snapshot, keep=KEEP_HOURLY):
    """Write snapshot under root, freeze any kickoffs it has passed, prune.

    `snapshot['generated']` is the clock. A game freezes only when this
    snapshot is at or after kickoff, and only to an older snapshot that was
    published strictly before kickoff. Returns a small summary.
    """
    for key in ("season", "week", "generated", "stamp", "games", "players"):
        if key not in snapshot:
            raise ValueError(f"snapshot missing {key}")
    root = Path(root)
    directory = week_dir(root, snapshot["season"], snapshot["week"])
    directory.mkdir(parents=True, exist_ok=True)
    dest = directory / f"{snapshot['stamp']}.json"
    _dump(dest, _projection_body(snapshot))
    if snapshot.get("props"):
        _dump(directory / "props" / f"{snapshot['stamp']}.json", snapshot["props"])
    now = parse_time(snapshot["generated"])

    snaps = _load_hourly(directory)
    frozen = []
    seen = {}
    for doc in snaps:
        for game in doc.get("games") or []:
            gid = game.get("id")
            if gid and gid not in seen:
                seen[gid] = game
    for gid, game in seen.items():
        pre_path = directory / "prekickoff" / f"{gid}.json"
        if pre_path.exists():
            continue
        kick = game.get("kickoff")
        if not kick or parse_time(kick) > now:
            continue
        earlier = [doc for doc in snaps if parse_time(doc["generated"]) < parse_time(kick)]
        if not earlier:
            continue
        source = earlier[-1]
        source_game = next((g for g in source.get("games") or [] if g.get("id") == gid), game)
        body = _game_slice(source, source_game)
        body["frozen_at"] = snapshot["generated"]
        _dump(pre_path, body)
        frozen.append(gid)

    kept, removed = _prune(snaps, keep)
    frozen_props = _freeze_props(directory, now, snapshot["generated"])
    _prop_kept, prop_removed = _prune(_load_hourly(directory / "props"), keep)
    refresh_manifest(directory, snapshot["season"], snapshot["week"], keep=keep)
    return {
        "wrote": snapshot["stamp"],
        "frozen": frozen,
        "frozen_props": frozen_props,
        "removed": removed,
        "removed_props": prop_removed,
        "hourly": kept,
        "props": _prop_kept,
    }


def _run(args, cwd, check=True):
    proc = subprocess.run(args, cwd=cwd, text=True, capture_output=True)
    if check and proc.returncode != 0:
        sys.stderr.write(proc.stderr or proc.stdout or "")
        raise SystemExit(proc.returncode or 1)
    return proc


def _repo_slug():
    slug = os.environ.get("GITHUB_REPOSITORY")
    if slug:
        return slug
    url = subprocess.check_output(["git", "remote", "get-url", "origin"], text=True).strip()
    match = re.search(r"github\.com[:/](.+?)(?:\.git)?$", url)
    if not match:
        raise SystemExit(f"cannot parse origin remote: {url}")
    return match.group(1)


def _push_url(slug):
    token = os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_TOKEN")
    if token:
        return f"https://x-access-token:{token}@github.com/{slug}.git"
    return subprocess.check_output(["git", "remote", "get-url", "origin"], text=True).strip()


def push_snapshot(snapshot_path: Path):
    """Fast-forward origin/snapshots with this file. Never force-pushes."""
    slug = _repo_slug()
    url = _push_url(slug)
    name = "github-actions[bot]" if os.environ.get("GITHUB_ACTIONS") else (
        subprocess.check_output(["git", "config", "user.name"], text=True).strip() or "Matchup Lab"
    )
    email = "41898432+github-actions[bot]@users.noreply.github.com" if os.environ.get("GITHUB_ACTIONS") else (
        subprocess.check_output(["git", "config", "user.email"], text=True).strip() or "matchup-lab@local"
    )
    with tempfile.TemporaryDirectory() as tmp:
        _run(["git", "init", "-q", "-b", "snapshots", tmp], cwd=tmp)
        fetched = _run(["git", "fetch", "--depth=1", url, "snapshots"], cwd=tmp, check=False)
        if fetched.returncode == 0:
            # Detached commit on top of the remote tip. Push is a fast-forward, never a force.
            _run(["git", "checkout", "-q", "--detach", "FETCH_HEAD"], cwd=tmp)
        with open(snapshot_path) as f:
            snapshot = json.load(f)
        summary = archive(Path(tmp) / "snapshots", snapshot)
        _run(["git", "add", "snapshots"], cwd=tmp)
        dirty = _run(["git", "status", "--porcelain"], cwd=tmp).stdout.strip()
        if not dirty:
            print(f"snapshot {summary['wrote']} already archived")
            return summary
        msg = f"Snapshot {snapshot['season']} wk{int(snapshot['week']):02d} {snapshot['stamp']}"
        _run(["git", "-c", f"user.name={name}", "-c", f"user.email={email}", "commit", "-qm", msg], cwd=tmp)
        # HEAD:snapshots fast-forwards. There is no --force.
        _run(["git", "push", url, "HEAD:snapshots"], cwd=tmp)
    frozen = ", ".join(summary["frozen"]) or "none"
    froze_props = ", ".join(summary.get("frozen_props") or []) or "none"
    print(
        f"archived {summary['wrote']} hourly={len(summary['hourly'])} "
        f"props={len(summary.get('props') or [])} froze={frozen} froze_props={froze_props}"
    )
    return summary


def main(argv=None):
    parser = argparse.ArgumentParser(description="Archive a projection snapshot.")
    parser.add_argument("snapshot")
    parser.add_argument("--root", help="Archive root to update in place (tests and local trees).")
    parser.add_argument("--push", action="store_true", help="Commit onto origin/snapshots without force.")
    parser.add_argument("--keep", type=int, default=KEEP_HOURLY)
    args = parser.parse_args(argv)
    if args.push == bool(args.root):
        raise SystemExit("pass exactly one of --root or --push")
    if args.push:
        push_snapshot(Path(args.snapshot))
        return 0
    with open(args.snapshot) as f:
        snapshot = json.load(f)
    summary = archive(args.root, snapshot, keep=args.keep)
    print(json.dumps(summary))
    return 0


if __name__ == "__main__":
    sys.exit(main())
