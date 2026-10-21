#!/usr/bin/env python3
"""Waiver-hit study on nflverse weeks, 2022-2025, with 2026 loaded but not labeled.

A player-week is on the wire when his season-to-date PPR rank is outside
QB12 / RB24 / WR36 / TE12 and he had a touch or 15% of snaps in the last
three weeks. A hit ranks inside that cut on PPR from the next week through
week 17. Roster percentage is not in these files, so the rank cut stands in
for it. 2026 is only through week 6, so it has no rest-of-season label.

The SHIPPED WEIGHTS block is what site/waiver.js uses. The earlier
leave-one-season fit that stacks every positive gap (including snap share
on top of volume) lost 2022 to recent points and is not the app score.

    python scripts/waiver_study.py --root /path/to/csvs
"""
from __future__ import annotations

import math
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path("/tmp/waiver-data")
SKILL = ("QB", "RB", "WR", "TE")
CUT = {"QB": 12, "RB": 24, "WR": 36, "TE": 12}
OUT = {"out", "ir", "injured reserve", "doubtful", "pup", "suspended", "sus"}
DECAY = 0.7
POS_FEATS = {
    # feature used as the volume share for that position
    "QB": "snap_last",
    "RB": "carry_share",
    "WR": "tgt_share",
    "TE": "tgt_share",
}


def _num(s):
    return pd.to_numeric(s, errors="coerce")


def load_stats():
    frames = []
    for season in (2022, 2023, 2024, 2025, 2026):
        df = pd.read_csv(ROOT / f"stats_{season}.csv", low_memory=False)
        df = df[(df.season_type == "REG") & df.position.isin(SKILL) & df.week.between(1, 18)]
        keep = ["player_id", "player_display_name", "position", "season", "week", "team",
                "opponent_team", "fantasy_points_ppr", "attempts", "passing_yards", "passing_tds",
                "carries", "rushing_yards", "rushing_tds", "targets", "receptions",
                "receiving_yards", "receiving_tds", "target_share", "air_yards_share", "wopr"]
        df = df[keep].copy()
        frames.append(df)
    df = pd.concat(frames, ignore_index=True)
    for c in ["fantasy_points_ppr", "attempts", "passing_yards", "passing_tds", "carries",
              "rushing_yards", "rushing_tds", "targets", "receptions", "receiving_yards",
              "receiving_tds", "target_share", "air_yards_share", "wopr"]:
        df[c] = _num(df[c]).fillna(0) if c not in ("target_share", "air_yards_share", "wopr") else _num(df[c])
    df["ppr"] = df["fantasy_points_ppr"]
    df["td"] = df["rushing_tds"] + df["receiving_tds"] + df["passing_tds"]
    df["td_pts"] = 6 * (df["rushing_tds"] + df["receiving_tds"]) + 4 * df["passing_tds"]
    df["vol"] = df["targets"] + df["carries"] + df["attempts"]
    return df


def load_snaps():
    """Map PFR snap ids through the season roster. players.csv repeats pfr ids."""
    pfr = {}
    for season in (2022, 2023, 2024, 2025, 2026):
        roster = pd.read_csv(ROOT / f"roster_{season}.csv", usecols=["gsis_id", "pfr_id"], dtype=str)
        for row in roster.dropna(subset=["pfr_id", "gsis_id"]).itertuples(index=False):
            pfr.setdefault(row.pfr_id, row.gsis_id)
    frames = []
    mapped = 0
    total = 0
    for season in (2022, 2023, 2024, 2025, 2026):
        s = pd.read_csv(ROOT / f"snaps_{season}.csv", low_memory=False)
        s = s[(s.game_type == "REG") & s.week.between(1, 18)]
        total += len(s)
        s["gsis"] = s.pfr_player_id.map(pfr)
        mapped += int(s.gsis.notna().sum())
        s = s[s.gsis.notna()][["season", "week", "gsis", "offense_pct"]]
        s["offense_pct"] = _num(s["offense_pct"])
        frames.append(s)
    print(f"snap rows mapped {mapped}/{total}")
    snaps = pd.concat(frames, ignore_index=True)
    snaps = snaps.groupby(["season", "week", "gsis"], as_index=False).offense_pct.mean()
    return snaps


def load_rookies():
    frames = []
    for season in (2022, 2023, 2024, 2025, 2026):
        r = pd.read_csv(ROOT / f"roster_{season}.csv", usecols=["gsis_id", "rookie_year", "season"])
        r["rookie_year"] = _num(r["rookie_year"])
        r = r.dropna(subset=["gsis_id"]).drop_duplicates("gsis_id")
        r["rookie"] = (r.rookie_year == season).astype(int)
        frames.append(r[["gsis_id", "season", "rookie"]])
    return pd.concat(frames, ignore_index=True)


def load_out():
    frames = []
    for season in (2022, 2023, 2024, 2025, 2026):
        inj = pd.read_csv(ROOT / f"injuries_{season}.csv", low_memory=False)
        if "game_type" in inj.columns:
            inj = inj[inj.game_type == "REG"]
        inj = inj[inj.week.between(1, 18) & inj.gsis_id.notna()]
        if "date_modified" in inj.columns:
            inj = inj.sort_values("date_modified")
        last = inj.groupby(["season", "week", "gsis_id"], as_index=False).tail(1)
        last["out"] = last.report_status.fillna("").str.strip().str.lower().isin(OUT).astype(int)
        frames.append(last[["season", "week", "gsis_id", "out"]])
    return pd.concat(frames, ignore_index=True)


def load_games():
    g = pd.read_csv(ROOT / "games.csv", low_memory=False)
    g = g[(g.game_type == "REG") & g.season.between(2022, 2026) & g.week.between(1, 18)]
    g["played"] = g.home_score.notna()
    return g


def load_charts(games):
    """(season, week, team, pos) -> [gsis best to worst]."""
    charts = {}
    for season in (2022, 2023, 2024):
        d = pd.read_csv(
            ROOT / f"depth_{season}.csv",
            usecols=["season", "club_code", "week", "game_type", "depth_team", "gsis_id", "position"],
        )
        d = d[(d.game_type == "REG") & d.position.isin(SKILL) & d.gsis_id.notna() & d.week.between(1, 18)]
        d["depth_team"] = _num(d["depth_team"])
        d = d.sort_values("depth_team")
        for (wk, team, pos), grp in d.groupby(["week", "club_code", "position"]):
            ids = []
            for pid in grp.gsis_id.astype(str):
                if pid not in ids:
                    ids.append(pid)
            charts[(int(season), int(wk), str(team), str(pos))] = ids
    # 2025-2026 daily charts: last chart strictly before that week's gameday.
    for season in (2025, 2026):
        path = ROOT / f"depth_{season}.csv"
        d = pd.read_csv(path, usecols=["dt", "team", "gsis_id", "pos_abb", "pos_rank"])
        d = d[d.pos_abb.isin(SKILL) & d.gsis_id.notna() & d.team.notna()]
        d["day"] = d.dt.astype(str).str.slice(0, 10)
        d["pos_rank"] = _num(d["pos_rank"])
        d = d.sort_values("dt").groupby(["day", "team", "pos_abb", "gsis_id"], as_index=False).tail(1)
        by_key = {}
        days_by_team = {}
        for row in d.itertuples(index=False):
            by_key.setdefault((row.team, row.pos_abb, row.day), []).append((row.pos_rank if row.pos_rank == row.pos_rank else 99, str(row.gsis_id)))
            days_by_team.setdefault(row.team, set()).add(row.day)
        sub = games[(games.season == season)]
        for row in sub.itertuples(index=False):
            day = row.gameday if isinstance(row.gameday, str) else None
            if not day:
                continue
            for team in (row.home_team, row.away_team):
                days = [x for x in days_by_team.get(team, ()) if x < day]
                if not days:
                    continue
                last = max(days)
                for pos in SKILL:
                    ranked = by_key.get((team, pos, last))
                    if not ranked:
                        continue
                    ids = []
                    for _, pid in sorted(ranked, key=lambda x: (x[0], x[1])):
                        if pid not in ids:
                            ids.append(pid)
                    charts[(int(season), int(row.week), str(team), pos)] = ids
    return charts


def recency(weeks, pprs, now):
    s = w = 0.0
    for wk, ppr in zip(weeks, pprs):
        wt = DECAY ** (now - wk)
        s += wt * float(ppr)
        w += wt
    return s / w if w else None


def quartile_lift(df, col, hit="hit"):
    sub = df[df[col].notna()]
    if len(sub) < 80:
        return None
    if sub[col].nunique() <= 2:
        hi = sub[sub[col] > 0]
        lo = sub[sub[col] <= 0]
    else:
        q75 = sub[col].quantile(0.75)
        q25 = sub[col].quantile(0.25)
        hi = sub[sub[col] >= q75]
        lo = sub[sub[col] <= q25]
    if len(hi) < 40 or len(lo) < 40:
        return None
    return {
        "n": int(len(sub)),
        "n_hi": int(len(hi)),
        "n_lo": int(len(lo)),
        "hit_hi": float(hi[hit].mean()),
        "hit_lo": float(lo[hit].mean()),
        "mean_hi": float(hi[col].mean()),
        "mean_lo": float(lo[col].mean()),
    }


def fit_weights(train):
    weights = {}
    for col in ["recency", "snap_last", "snap_delta", "volume_share", "ay_share",
                "inherits", "rookie_up", "team_pts", "opp_soft", "sched4"]:
        lift = quartile_lift(train, col)
        weights[col] = max(0.0, lift["hit_hi"] - lift["hit_lo"]) if lift else 0.0
    # A touchdown on low volume beats a zero-point scrub, so the all-pool gap is
    # positive and useless. Compare flukes only with other big weeks.
    big = train[((train.pos == "QB") & (train.last_ppr >= 18)) | ((train.pos != "QB") & (train.last_ppr >= 12))]
    if len(big) >= 80 and big.fluke.sum() >= 25 and (big.fluke == 0).sum() >= 40:
        gap = float(big.loc[big.fluke == 1, "hit"].mean() - big.loc[big.fluke == 0, "hit"].mean())
        weights["fluke"] = min(0.0, gap)
    else:
        weights["fluke"] = 0.0
    return weights


def add_percentiles_shipped(df, weights):
    out = df.copy()
    for col in weights:
        out[col + "_pct"] = out.groupby(["season", "week", "pos"])[col].rank(pct=True, method="average")
        out[col + "_pct"] = out[col + "_pct"].fillna(0.5)
    return out


def add_percentiles(df):
    out = df.copy()
    for col in ["recency", "snap_last", "snap_delta", "volume_share", "ay_share",
                "inherits", "rookie_up", "team_pts", "opp_soft", "sched4", "fluke"]:
        out[col + "_pct"] = out.groupby(["season", "week", "pos"])[col].rank(pct=True, method="average")
        out[col + "_pct"] = out[col + "_pct"].fillna(0.5)
    return out


def score_frame(df, weights):
    total = np.zeros(len(df))
    for col, w in weights.items():
        total = total + w * df[col + "_pct"].to_numpy()
    return total


def topk_hit(df, score_col, k=5):
    hits = n = 0
    weeks = 0
    for (_, _), grp in df.groupby(["season", "week"]):
        grp = grp.sort_values([score_col, "recency"], ascending=False)
        take = grp.head(k)
        hits += int(take["hit"].sum())
        n += len(take)
        weeks += 1
    return {"hits": hits, "n": n, "rate": hits / n if n else None, "weeks": weeks}


def main():
    print("loading", flush=True)
    stats = load_stats()
    snaps = load_snaps()
    rookies = load_rookies()
    outs = load_out()
    games = load_games()
    print("charts", flush=True)
    charts = load_charts(games)
    print("chart keys", len(charts), "stat rows", len(stats), flush=True)

    stats = stats.merge(snaps, left_on=["season", "week", "player_id"], right_on=["season", "week", "gsis"], how="left")
    stats = stats.drop(columns=["gsis"], errors="ignore")

    # Team weekly carries / targets / attempts / points.
    team_week = stats.groupby(["season", "week", "team"], as_index=False)[["carries", "targets", "attempts"]].sum()
    team_week = team_week.rename(columns={"carries": "tm_car", "targets": "tm_tgt", "attempts": "tm_att"})

    # Points scored and allowed.
    rows = []
    for row in games.itertuples(index=False):
        if not row.played:
            continue
        rows.append((row.season, row.week, row.home_team, row.home_score, row.away_score))
        rows.append((row.season, row.week, row.away_team, row.away_score, row.home_score))
    pts = pd.DataFrame(rows, columns=["season", "week", "team", "scored", "allowed"])

    # Next opponent and the following four.
    sched = []
    for row in games.itertuples(index=False):
        sched.append((row.season, row.week, row.home_team, row.away_team))
        sched.append((row.season, row.week, row.away_team, row.home_team))
    sched = pd.DataFrame(sched, columns=["season", "week", "team", "opp"])

    name_of = stats.groupby(["season", "player_id"]).player_display_name.agg(lambda s: s.iloc[-1])
    pos_of = stats.groupby(["season", "player_id"]).position.agg(lambda s: s.iloc[-1])

    # Index player weeks
    by_player = {}
    for (season, pid), grp in stats.groupby(["season", "player_id"]):
        grp = grp.sort_values("week")
        by_player[(int(season), pid)] = grp

    out_lookup = {(int(r.season), int(r.week), r.gsis_id): int(r.out) for r in outs.itertuples(index=False)}
    rookie_lookup = {(int(r.season), r.gsis_id): int(r.rookie) for r in rookies.itertuples(index=False)}

    # Precompute team STD points and allowed through each week.
    pts_idx = {}
    for (season, team), grp in pts.groupby(["season", "team"]):
        grp = grp.sort_values("week")
        pts_idx[(int(season), team)] = grp

    records = []
    seasons = [2022, 2023, 2024, 2025]
    for season in seasons:
        print("season", season, flush=True)
        sstats = stats[stats.season == season]
        players = sstats.player_id.unique()
        for W in range(4, 13):
            past = sstats[sstats.week <= W]
            if past.empty:
                continue
            totals = past.groupby("player_id").agg(
                std=("ppr", "sum"),
                games=("ppr", "size"),
                team=("team", "last"),
                pos=("position", "last"),
                name=("player_display_name", "last"),
            )
            totals["rank"] = totals.groupby("pos")["std"].rank(ascending=False, method="min")
            future = sstats[(sstats.week > W) & (sstats.week <= 17)]
            ros = future.groupby("player_id").ppr.sum()
            # Everyone who has a season row is ranked; missing ROS is 0.
            ros_all = totals[["pos"]].copy()
            ros_all["ros"] = ros.reindex(ros_all.index).fillna(0)
            ros_all["ros_rank"] = ros_all.groupby("pos")["ros"].rank(ascending=False, method="min")

            # Team STD carries/targets through W
            tw = team_week[(team_week.season == season) & (team_week.week <= W)]
            tm_std = tw.groupby("team")[["tm_car", "tm_tgt", "tm_att"]].sum()

            # Recent activity window
            recent = sstats[sstats.week.between(W - 2, W)]
            recent_vol = recent.groupby("player_id").vol.sum()
            recent_snap = recent.groupby("player_id").offense_pct.max()

            # Team points through W
            team_pts = {}
            team_allowed = {}
            for team in totals.team.dropna().unique():
                grp = pts_idx.get((season, team))
                if grp is None:
                    continue
                g = grp[grp.week <= W]
                if len(g):
                    team_pts[team] = float(g.scored.mean())
                    team_allowed[team] = float(g.allowed.mean())

            # Schedule from W+1
            future_sched = sched[(sched.season == season) & (sched.week > W) & (sched.week <= 17)]

            for pid, row in totals.iterrows():
                pos = row.pos
                if pos not in CUT:
                    continue
                if row["rank"] <= CUT[pos]:
                    continue
                vol = float(recent_vol.get(pid, 0) or 0)
                sn = recent_snap.get(pid, np.nan)
                sn = float(sn) if sn == sn else 0
                if vol < 1 and sn < 0.15:
                    continue
                grp = by_player.get((season, pid))
                if grp is None:
                    continue
                g = grp[grp.week <= W]
                if g.empty:
                    continue
                last = g.iloc[-1]
                snaps_hist = g["offense_pct"].dropna()
                snap_last = float(snaps_hist.iloc[-1]) if len(snaps_hist) else np.nan
                if len(snaps_hist) >= 2:
                    snap_delta = float(snaps_hist.iloc[-1] - snaps_hist.iloc[:-1].mean())
                else:
                    snap_delta = np.nan
                rising3 = False
                if len(snaps_hist) >= 3:
                    a, b, c = snaps_hist.iloc[-3:].tolist()
                    rising3 = c > b > a and c >= 0.40
                weeks = g.week.tolist()
                pprs = g.ppr.tolist()
                rec = recency(weeks, pprs, W)
                team = row.team
                tm = tm_std.loc[team] if team in tm_std.index else None
                carry_share = (g.carries.sum() / tm.tm_car) if tm is not None and tm.tm_car else np.nan
                tgt_share = g.target_share.replace(0, np.nan).mean()
                if tgt_share != tgt_share:
                    tgt_share = (g.targets.sum() / tm.tm_tgt) if tm is not None and tm.tm_tgt else np.nan
                ay = g.air_yards_share.replace(0, np.nan).mean()
                if pos == "RB":
                    volume_share = carry_share
                elif pos in ("WR", "TE"):
                    volume_share = tgt_share
                else:
                    volume_share = snap_last
                # inherits: depth 2 or 3, starter played under 25% or was out, candidate played
                chart = charts.get((season, W, team, pos)) or []
                inherits = 0
                if len(chart) >= 2 and pid in chart:
                    slot = chart.index(pid)
                    starter = chart[0]
                    if slot in (1, 2) and starter != pid:
                        st_grp = by_player.get((season, starter))
                        st_snap = np.nan
                        if st_grp is not None:
                            st_w = st_grp[st_grp.week == W]
                            if len(st_w) and st_w.offense_pct.notna().any():
                                st_snap = float(st_w.offense_pct.iloc[-1])
                        st_out = out_lookup.get((season, W, starter), 0)
                        played = (snap_last == snap_last and snap_last >= 0.35) or float(last.vol) >= 8
                        # Backup quarterbacks who spot-start do not become the rest-of-season QB1.
                        if pos != "QB" and played and (st_out == 1 or (st_snap == st_snap and st_snap < 0.25)):
                            inherits = 1
                rookie = rookie_lookup.get((season, pid), 0)
                rookie_up = 1 if rookie and (rising3 or (snap_delta == snap_delta and snap_delta >= 0.10 and snap_last == snap_last and snap_last >= 0.45)) else 0
                # fluke on the last game
                ppr = float(last.ppr)
                td_pts = float(last.td_pts)
                volume = float(last.targets + last.carries) if pos != "QB" else float(last.attempts)
                fluke = 0
                if pos == "QB":
                    if ppr >= 18 and td_pts >= 0.45 * ppr and float(last.passing_yards) < 220:
                        fluke = 1
                else:
                    if ppr >= 12 and td_pts >= 0.50 * max(ppr, 0.1) and volume <= 6:
                        fluke = 1
                # next opponents
                fut = future_sched[future_sched.team == team].sort_values("week")
                next_opps = fut.head(4)
                soft = []
                for opp in next_opps.opp.tolist():
                    if opp in team_allowed:
                        # points the opponent has allowed
                        # team_allowed is keyed by the offense. Opponent's points allowed is team_allowed of the opponent? 
                        # team_allowed[X] = points X's defense allowed = points scored against X.
                        soft.append(team_allowed.get(opp, np.nan))
                soft = [x for x in soft if x == x]
                opp_soft = soft[0] if soft else np.nan
                sched4 = float(np.mean(soft)) if soft else np.nan
                hit = int(ros_all.loc[pid, "ros_rank"] <= CUT[pos]) if pid in ros_all.index else 0
                records.append({
                    "season": season, "week": W, "id": pid, "name": row["name"], "pos": pos, "team": team,
                    "std": float(row["std"]), "std_rank": float(row["rank"]),
                    "ros": float(ros_all.loc[pid, "ros"]) if pid in ros_all.index else 0,
                    "ros_rank": float(ros_all.loc[pid, "ros_rank"]) if pid in ros_all.index else 999,
                    "hit": hit,
                    "recency": rec,
                    "snap_last": snap_last,
                    "snap_delta": snap_delta,
                    "volume_share": volume_share,
                    "tgt_share": tgt_share,
                    "ay_share": ay if ay == ay else np.nan,
                    "carry_share": carry_share,
                    "inherits": inherits,
                    "rookie_up": rookie_up,
                    "rookie": rookie,
                    "team_pts": team_pts.get(team, np.nan),
                    "opp_soft": opp_soft,
                    "sched4": sched4,
                    "fluke": fluke,
                    "last_ppr": ppr,
                })
    df = pd.DataFrame.from_records(records)
    print("eligible rows", len(df), "seasons", sorted(df.season.unique()), flush=True)
    print("base hit rate", round(df.hit.mean(), 4), "hits", int(df.hit.sum()))
    print("snap_last coverage", float(df.snap_last.notna().mean()))
    rook = df[df.rookie == 1]
    print(f"rookies n={len(rook)} hit={rook.hit.mean() if len(rook) else float('nan'):.3%} vs vets {df[df.rookie==0].hit.mean():.3%}")
    print("by pos")
    for pos, grp in df.groupby("pos"):
        print(f"  {pos} n={len(grp)} hit={grp.hit.mean():.3%} inherits={grp.inherits.sum()} rookie_up={grp.rookie_up.sum()} fluke={grp.fluke.sum()}")

    print("\nUNIVARIATE top vs bottom quartile (hit rate)")
    for col in ["recency", "last_ppr", "snap_last", "snap_delta", "volume_share", "tgt_share", "ay_share",
                "carry_share", "inherits", "rookie_up", "team_pts", "opp_soft", "sched4", "fluke"]:
        for pos in [None, "QB", "RB", "WR", "TE"]:
            sub = df if pos is None else df[df.pos == pos]
            lift = quartile_lift(sub, col)
            if not lift:
                continue
            label = pos or "ALL"
            gap = lift["hit_hi"] - lift["hit_lo"]
            print(f"  {label:3} {col:14} n={lift['n']:5} hi {lift['hit_hi']:.1%} (x̄ {lift['mean_hi']:.2f}, n={lift['n_hi']}) "
                  f"lo {lift['hit_lo']:.1%} (x̄ {lift['mean_lo']:.2f}, n={lift['n_lo']}) gap {gap:+.1%}")

    # Big-week fluke vs not, among last_ppr high
    print("\nFLUKES among big last games")
    for pos in SKILL:
        if pos == "QB":
            big = df[(df.pos == pos) & (df.last_ppr >= 18)]
        else:
            big = df[(df.pos == pos) & (df.last_ppr >= 12)]
        if big.empty:
            continue
        f = big[big.fluke == 1]
        n = big[big.fluke == 0]
        print(f"  {pos} big n={len(big)} fluke n={len(f)} hit {f.hit.mean() if len(f) else float('nan'):.1%} "
              f"vs other big {n.hit.mean() if len(n) else float('nan'):.1%}")

    print("\nLEAVE-ONE-SEASON-OUT top 5")
    loso_rows = []
    for hold in seasons:
        train = df[df.season != hold]
        test = df[df.season == hold].copy()
        weights = fit_weights(train)
        test = add_percentiles(test)
        # percentiles must be within the test week; add_percentiles does that
        test["score"] = score_frame(test, weights)
        test["base"] = test["recency"]
        test["last"] = test["last_ppr"]
        a = topk_hit(test, "score")
        b = topk_hit(test, "base")
        c = topk_hit(test, "last")
        print(f"  hold {hold} weights { {k: round(v, 3) for k, v in weights.items() if v} }")
        print(f"    score {a['hits']}/{a['n']} = {a['rate']:.1%}   recency {b['hits']}/{b['n']} = {b['rate']:.1%}   last game {c['hits']}/{c['n']} = {c['rate']:.1%}")
        loso_rows.append(test)
    all_test = pd.concat(loso_rows, ignore_index=True)
    print("POOLED")
    for col, label in (("score", "score"), ("base", "recency"), ("last", "last game")):
        r = topk_hit(all_test, col)
        print(f"  {label:10} {r['hits']}/{r['n']} = {r['rate']:.1%} over {r['weeks']} weeks")
    # per position top 3
    print("POOLED top 3 by position")
    for pos in SKILL:
        sub = all_test[all_test.pos == pos]
        for col, label in (("score", "score"), ("base", "recency")):
            r = topk_hit(sub, col, k=3)
            print(f"  {pos} {label:8} {r['hits']}/{r['n']} = {r['rate']:.1%}")

    full_w = fit_weights(df)
    print("\nFULL-SAMPLE WEIGHTS (hit-rate gap, top quartile minus bottom)")
    for k, v in full_w.items():
        print(f"  {k:14} {v:+.4f}")

    # 2026 descriptive: eligible after week 6, no ROS label
    print("\n2026 note: ROS labels need the rest of the season. Not included in the rates above.")
    s2026 = stats[stats.season == 2026]
    if len(s2026):
        last_w = int(s2026.week.max())
        print("  2026 max completed week in file", last_w, "player-weeks", len(s2026))

    # Shipped weights. Recent points and volume share are the full gaps.
    # Air yards (WR/TE only), RB/WR inheritance, and a rising rookie are a
    # fraction of their gaps. The fluke term is negative. Snap share, team
    # points, and schedule softness are measured above and not weighted:
    # snap share duplicated volume, and the context gaps were about zero.
    shipped = {"recency": 0.26, "volume_share": 0.25, "ay_use": 0.03, "inh_use": 0.03, "rook_use": 0.03, "fluke": -0.02}
    scored = df.copy()
    scored["ay_use"] = scored["ay_share"].where(scored.pos.isin(["WR", "TE"]))
    scored["inh_use"] = scored["inherits"].where(scored.pos.isin(["RB", "WR"]), 0)
    scored["rook_use"] = scored["rookie_up"].where(scored.pos.isin(["RB", "WR"]), 0)
    print("\nSHIPPED WEIGHTS, fixed, percentile within position-week")
    for hold in list(seasons) + [None]:
        part = scored if hold is None else scored[scored.season == hold]
        part = add_percentiles_shipped(part, shipped)
        part["score"] = 0.0
        for col, w in shipped.items():
            part["score"] = part["score"] + w * part[col + "_pct"]
        label = "ALL" if hold is None else str(hold)
        a = topk_hit(part, "score")
        b = topk_hit(part, "recency")
        print(f"  {label:4} score {a['hits']}/{a['n']} = {a['rate']:.1%}   recency {b['hits']}/{b['n']} = {b['rate']:.1%}")

    df.to_pickle("/tmp/waiver-eligible.pkl")
    print("wrote /tmp/waiver-eligible.pkl")


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Waiver-hit study on nflverse weekly files.")
    parser.add_argument("--root", default="/tmp/waiver-data", help="Directory of stats_YYYY.csv, snaps, injuries, depth, rosters, players.csv, games.csv")
    args = parser.parse_args()
    ROOT = Path(args.root)
    main()
