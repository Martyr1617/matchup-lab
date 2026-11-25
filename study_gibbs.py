"""Walk-forward cases for Gibbs-style usage features.

Prior games only. Routes are WR/TE on the field for a dropback, because
public participation records the targeted player's route only. 2026 has no
participation file; those features stay null and the scorer leaves the
current projection unchanged.

Did not beat the current model on 2024, 2025, and 2026 weeks played
(10,968 player-weeks). Not wired into refresh.sh. Not part of CI.

Download nflverse parquets into one directory (names the script expects):
  player_YYYY.parquet   stats_player_week
  team_YYYY.parquet     stats_team_week
  snap_YYYY.parquet     snap_counts
  rush_YYYY.parquet     pfr advstats_week_rush
  pbp_YYYY.parquet      play_by_play
  part_YYYY.parquet     pbp_participation (2023-2025; 2026 is absent on purpose)
  games.csv             nfldata games.csv
  ids.csv               dynastyprocess db_playerids.csv
Then: python3 study_gibbs.py /path/to/dir
      node study_gibbs.js /path/to/dir/cases.json
"""
import json
import math
import os
import sys
from collections import Counter, defaultdict

import pandas as pd

DIR = sys.argv[1] if len(sys.argv) > 1 else "/tmp/gibbs"
SEASONS = (2024, 2025, 2026)
PRIOR_SEASON_FOR_ROUTES = (2024, 2025)  # participation is postseason-only; 2026 is absent
SKILL = ("QB", "RB", "WR", "TE")
DECAY = 0.7
PRIOR_CV = {"QB": 0.38, "RB": 0.50, "WR": 0.58, "TE": 0.65}
PRIOR_N = 4
TPRR_K = 30.0
SHARE_K = 4.0
ADOT_K = 20.0
YBC_K = 30.0
YAC_K = 80.0
MAN_K = 25.0
SHRINK_G = 4.0


def num(x):
    try:
        v = float(x)
    except (TypeError, ValueError):
        return 0.0
    if math.isnan(v) or math.isinf(v):
        return 0.0
    return v


def r4(x):
    if x is None:
        return None
    try:
        v = float(x)
    except (TypeError, ValueError):
        return None
    if math.isnan(v) or math.isinf(v):
        return None
    return round(v, 4)


def shrink(nume, den, prior, k):
    if den is None or not math.isfinite(den):
        return None
    if prior is None or not math.isfinite(prior):
        if den <= 0:
            return None
        return nume / den
    return (nume + prior * k) / (den + k)


def read_players(season):
    cols = [
        "player_id", "position", "season", "week", "season_type", "team", "opponent_team",
        "attempts", "completions", "passing_yards", "passing_tds", "passing_interceptions",
        "sacks_suffered", "carries", "rushing_yards", "rushing_tds",
        "receptions", "targets", "receiving_yards", "receiving_tds",
        "receiving_air_yards", "receiving_yards_after_catch",
        "target_share", "air_yards_share",
        "rushing_fumbles_lost", "receiving_fumbles_lost", "sack_fumbles_lost",
        "passing_2pt_conversions", "rushing_2pt_conversions", "receiving_2pt_conversions",
        "fantasy_points_ppr",
    ]
    df = pd.read_parquet(os.path.join(DIR, f"player_{season}.parquet"), columns=cols)
    df = df[(df.season_type == "REG") & (df.position.isin(SKILL))].copy()
    df["player_id"] = df.player_id.astype(str)
    df["week"] = df.week.astype(int)
    for c in cols:
        if c in ("player_id", "position", "season_type", "team", "opponent_team"):
            continue
        if c in df.columns:
            df[c] = pd.to_numeric(df[c], errors="coerce")
    keys = [c for c in cols if c not in ("player_id", "position", "season", "week", "season_type", "team", "opponent_team")]
    agg = {c: "sum" for c in keys}
    # shares are rates; recompute from counts later. Keep a target-weighted copy via sum of share * attempts handled below.
    df["_ts_num"] = df.target_share.fillna(0) * df.targets.fillna(0)
    df["_ays_num"] = df.air_yards_share.fillna(0) * df.targets.fillna(0)
    agg["_ts_num"] = "sum"
    agg["_ays_num"] = "sum"
    # position / team of the week: last row after sort
    df = df.sort_values(["player_id", "week"])
    meta = df.groupby(["player_id", "week"], as_index=False).agg(
        position=("position", "last"),
        team=("team", "last"),
        opponent_team=("opponent_team", "last"),
    )
    summed = df.groupby(["player_id", "week"], as_index=False)[list(agg)].sum()
    out = meta.merge(summed, on=["player_id", "week"])
    out["season"] = season
    return out


def read_teams(season):
    cols = [
        "season", "week", "team", "season_type", "opponent_team",
        "attempts", "completions", "passing_yards", "passing_tds", "passing_interceptions",
        "sacks_suffered", "carries", "rushing_yards", "rushing_tds",
        "receptions", "targets", "receiving_yards", "receiving_tds", "passing_air_yards",
    ]
    df = pd.read_parquet(os.path.join(DIR, f"team_{season}.parquet"), columns=cols)
    df = df[df.season_type == "REG"].copy()
    df["week"] = df.week.astype(int)
    for c in cols:
        if c in ("season", "week", "team", "season_type", "opponent_team"):
            continue
        df[c] = pd.to_numeric(df[c], errors="coerce").fillna(0)
    df["dropbacks"] = df.attempts + df.sacks_suffered
    df["plays"] = df.attempts + df.carries + df.sacks_suffered
    return df


def pfr_map():
    ids = pd.read_csv(os.path.join(DIR, "ids.csv"), dtype=str, usecols=["gsis_id", "pfr_id"])
    ids = ids.dropna()
    return dict(zip(ids.pfr_id, ids.gsis_id))


def read_snaps(season, cross):
    df = pd.read_parquet(os.path.join(DIR, f"snap_{season}.parquet"))
    if "game_type" in df.columns:
        df = df[df.game_type == "REG"]
    df["week"] = df.week.astype(int)
    df["gsis"] = df.pfr_player_id.map(cross)
    df = df[df.gsis.notna()]
    df["offense_pct"] = pd.to_numeric(df.offense_pct, errors="coerce")
    df = df[df.offense_pct.notna()]
    return df.groupby(["gsis", "week"]).offense_pct.mean().to_dict()


def read_rush(season, cross):
    path = os.path.join(DIR, f"rush_{season}.parquet")
    if not os.path.exists(path):
        return {}
    df = pd.read_parquet(path)
    if "game_type" in df.columns:
        df = df[df.game_type == "REG"]
    df["week"] = df.week.astype(int)
    df["gsis"] = df.pfr_player_id.map(cross)
    df = df[df.gsis.notna()]
    for c in ("carries", "rushing_yards_before_contact", "rushing_yards_after_contact"):
        df[c] = pd.to_numeric(df[c], errors="coerce").fillna(0)
    g = df.groupby(["gsis", "week"])[["carries", "rushing_yards_before_contact", "rushing_yards_after_contact"]].sum()
    return {(i, w): (num(r.carries), num(r.rushing_yards_before_contact), num(r.rushing_yards_after_contact))
            for (i, w), r in g.iterrows()}


def load_participation(season, diag):
    """WR/TE routes and man/zone target results. None when the file is absent."""
    part_path = os.path.join(DIR, f"part_{season}.parquet")
    pbp_path = os.path.join(DIR, f"pbp_{season}.parquet")
    routes = {}
    man = {}
    rz = Counter()
    ez = Counter()
    tgt_n = Counter()
    pos_tokens = Counter()
    if not os.path.exists(pbp_path):
        diag[f"pbp_{season}"] = "missing"
        return routes, man, rz, ez, tgt_n
    pbp_cols = [
        "game_id", "play_id", "week", "season_type", "posteam", "defteam", "qb_dropback",
        "receiver_player_id", "air_yards", "yardline_100", "receiving_yards", "yards_gained", "pass_attempt",
    ]
    pbp = pd.read_parquet(pbp_path, columns=pbp_cols)
    pbp = pbp[(pbp.season_type == "REG")].copy()
    pbp["week"] = pbp.week.astype(int)
    pbp["is_drop"] = pd.to_numeric(pbp.qb_dropback, errors="coerce").fillna(0).eq(1)
    # Red zone is descriptive and does not need participation.
    rec = pbp[pbp.receiver_player_id.notna() & pbp.pass_attempt.fillna(0).eq(1)]
    for row in rec.itertuples(index=False):
        pid = str(row.receiver_player_id)
        tgt_n[(pid, int(row.week))] += 1
        yl = row.yardline_100
        if yl == yl and yl <= 20:
            rz[(pid, int(row.week))] += 1
        if yl == yl and yl <= 10:
            ez[(pid, int(row.week))] += 1
    if not os.path.exists(part_path):
        diag[f"participation_{season}"] = "missing"
        return routes, man, rz, ez, tgt_n
    part = pd.read_parquet(part_path, columns=[
        "nflverse_game_id", "play_id", "offense_players", "offense_positions", "defense_man_zone_type",
    ])
    drops = pbp[pbp.is_drop & pbp.posteam.notna()]
    merged = drops.merge(part, left_on=["game_id", "play_id"], right_on=["nflverse_game_id", "play_id"], how="left")
    matched = merged.offense_players.notna().mean() if len(merged) else 0
    diag[f"participation_{season}"] = f"dropbacks {len(merged)} matched {matched:.3f}"
    sub = merged[merged.offense_players.notna() & merged.offense_positions.notna()].copy()
    sub["pid"] = sub.offense_players.str.split(";")
    sub["pos"] = sub.offense_positions.str.split(";")
    same = sub.pid.str.len() == sub.pos.str.len()
    sub = sub.loc[same]
    exp = sub.explode(["pid", "pos"])
    exp["pos"] = exp.pos.astype(str)
    exp["pid"] = exp.pid.astype(str)
    pos_tokens.update(exp.pos.value_counts().to_dict())
    wrte = exp[exp.pos.isin(["WR", "TE"])]
    counts = wrte.groupby(["pid", "week"]).size()
    for (pid, week), n in counts.items():
        routes[(str(pid), int(week))] = int(n)
    cov = merged[merged.defense_man_zone_type.isin(["MAN_COVERAGE", "ZONE_COVERAGE"]) & merged.receiver_player_id.notna()]
    if len(cov):
        yds = pd.to_numeric(cov.receiving_yards, errors="coerce")
        fallback = pd.to_numeric(cov.yards_gained, errors="coerce")
        cov = cov.copy()
        cov["yds"] = yds.where(yds.notna(), fallback).fillna(0)
        cov["is_man"] = cov.defense_man_zone_type.eq("MAN_COVERAGE")
        for row in cov.itertuples(index=False):
            key = (str(row.receiver_player_id), int(row.week))
            slot = man.setdefault(key, [0, 0.0, 0, 0.0])  # man_n, man_yds, zone_n, zone_yds
            if row.is_man:
                slot[0] += 1
                slot[1] += num(row.yds)
            else:
                slot[2] += 1
                slot[3] += num(row.yds)
    diag[f"route_players_{season}"] = len({k[0] for k in routes})
    diag[f"pos_tokens_{season}"] = dict(pos_tokens.most_common(12))
    return routes, man, rz, ez, tgt_n


def opp_man_rates(season):
    """Defense's man share of charted dropbacks, by week. Empty when participation is absent."""
    part_path = os.path.join(DIR, f"part_{season}.parquet")
    pbp_path = os.path.join(DIR, f"pbp_{season}.parquet")
    if not os.path.exists(part_path) or not os.path.exists(pbp_path):
        return {}
    pbp = pd.read_parquet(pbp_path, columns=["game_id", "play_id", "week", "season_type", "defteam", "qb_dropback"])
    pbp = pbp[(pbp.season_type == "REG")].copy()
    pbp["is_drop"] = pd.to_numeric(pbp.qb_dropback, errors="coerce").fillna(0).eq(1)
    pbp = pbp[pbp.is_drop & pbp.defteam.notna()]
    part = pd.read_parquet(part_path, columns=["nflverse_game_id", "play_id", "defense_man_zone_type"])
    m = pbp.merge(part, left_on=["game_id", "play_id"], right_on=["nflverse_game_id", "play_id"], how="inner")
    m = m[m.defense_man_zone_type.isin(["MAN_COVERAGE", "ZONE_COVERAGE"])]
    m["week"] = m.week.astype(int)
    m["man"] = m.defense_man_zone_type.eq("MAN_COVERAGE").astype(int)
    g = m.groupby(["defteam", "week"]).agg(n=("man", "size"), man=("man", "sum"))
    return {(tm, int(w)): (int(r.man), int(r.n)) for (tm, w), r in g.iterrows()}


def completed_weeks(season):
    g = pd.read_csv(os.path.join(DIR, "games.csv"))
    g = g[(g.season == season) & (g.game_type == "REG")]
    done = g[g.home_score.notna() & g.away_score.notna()]
    last = int(done.week.max()) if len(done) else 0
    return g, last


def decayed(rows, week, key):
    if not rows:
        return None
    acc = 0.0
    wsum = 0.0
    for row in rows:
        wt = DECAY ** (week - 1 - row["week"])
        acc += wt * num(row[key])
        wsum += wt
    return acc / wsum if wsum else None


def decayed_pair(rows, week, num_key, den_key):
    acc_n = acc_d = wsum = 0.0
    for row in rows:
        den = num(row.get(den_key))
        if den <= 0:
            continue
        wt = DECAY ** (week - 1 - row["week"])
        acc_n += wt * num(row.get(num_key))
        acc_d += wt * den
        wsum += wt
    if acc_d <= 0:
        return None
    return acc_n / acc_d


def trail(rows, key, n=4):
    use = rows[-n:]
    if not use:
        return None
    return sum(num(r[key]) for r in use) / len(use)


def build_bundle(team, players, week, schedule_rows):
    t = team[team.week < week]
    if not len(t):
        return None
    lg = {
        "attempts": float(t.attempts.sum() / len(t)),
        "passing_yards": float(t.passing_yards.sum() / len(t)),
        "passing_tds": float(t.passing_tds.sum() / len(t)),
        "passing_interceptions": float(t.passing_interceptions.sum() / len(t)),
        "sacks_suffered": float(t.sacks_suffered.sum() / len(t)),
        "carries": float(t.carries.sum() / len(t)),
        "rushing_yards": float(t.rushing_yards.sum() / len(t)),
        "rushing_tds": float(t.rushing_tds.sum() / len(t)),
        "targets": float(t.targets.sum() / len(t)),
        "ypc": float(t.rushing_yards.sum() / max(t.carries.sum(), 1)),
        "ypa": float(t.passing_yards.sum() / max(t.attempts.sum(), 1)),
        "comp_pct": float(t.completions.sum() / max(t.attempts.sum(), 1)),
        "ypt": float(t.receiving_yards.sum() / max(t.targets.sum(), 1)),
        "rush_td_rate": float(t.rushing_tds.sum() / max(t.carries.sum(), 1)),
        "pass_td_rate": float(t.passing_tds.sum() / max(t.attempts.sum(), 1)),
        "int_rate": float(t.passing_interceptions.sum() / max(t.attempts.sum(), 1)),
        "rec_td_rate": float(t.receiving_tds.sum() / max(t.targets.sum(), 1)),
        "plays": float(t.plays.sum() / len(t)),
        "adot": float(t.passing_air_yards.sum() / max(t.attempts.sum(), 1)),
    }
    defense = {}
    teams = sorted(set(t.team) | set(t.opponent_team))
    p = players[players.week < week]
    for tm in teams:
        d = t[t.opponent_team == tm]
        n = len(d)
        if n == 0:
            continue
        allowed = {
            "g": int(n),
            "pass_att_pg": float(d.attempts.sum() / n),
            "pass_yds_pg": float(d.passing_yards.sum() / n),
            "pass_td_pg": float(d.passing_tds.sum() / n),
            "int_pg": float(d.passing_interceptions.sum() / n),
            "sacks_pg": float(d.sacks_suffered.sum() / n),
            "rush_att_pg": float(d.carries.sum() / n),
            "rush_yds_pg": float(d.rushing_yards.sum() / n),
            "rush_td_pg": float(d.rushing_tds.sum() / n),
            "ypc": float(d.rushing_yards.sum() / max(d.carries.sum(), 1)),
            "ypa": float(d.passing_yards.sum() / max(d.attempts.sum(), 1)),
            "comp_pct": float(d.completions.sum() / max(d.attempts.sum(), 1)),
            "plays_pg": float(d.plays.sum() / n),
            "pts_pg": None,
        }
        raw = {
            "pass_att": allowed["pass_att_pg"] / lg["attempts"],
            "pass_yds": allowed["pass_yds_pg"] / lg["passing_yards"],
            "ypa": allowed["ypa"] / lg["ypa"],
            "comp_pct": allowed["comp_pct"] / lg["comp_pct"],
            "pass_td": allowed["pass_td_pg"] / max(lg["passing_tds"], 1e-6),
            "int": allowed["int_pg"] / max(lg["passing_interceptions"], 1e-6),
            "sacks": allowed["sacks_pg"] / max(lg["sacks_suffered"], 1e-6),
            "rush_att": allowed["rush_att_pg"] / lg["carries"],
            "rush_yds": allowed["rush_yds_pg"] / lg["rushing_yards"],
            "ypc": allowed["ypc"] / lg["ypc"],
            "rush_td": allowed["rush_td_pg"] / max(lg["rushing_tds"], 1e-6),
        }
        factors = {k: 1 + (v - 1) * n / (n + SHRINK_G) for k, v in raw.items()}
        defense[tm] = {"allowed": allowed, "factors": factors}
    if not defense:
        return None
    for tm in list(defense):
        n = defense[tm]["allowed"]["g"]
        faced = p[p.opponent_team == tm]
        pos_allowed = {}
        for pos in SKILL:
            dp = faced[faced.position == pos]
            pos_allowed[pos] = {
                "ppr_pg": float(dp.fantasy_points_ppr.sum() / n) if n else 0.0,
                "rec_yds_pg": float(dp.receiving_yards.sum() / n) if n else 0.0,
                "tgt_pg": float(dp.targets.sum() / n) if n else 0.0,
            }
        defense[tm]["pos"] = pos_allowed
    lg_pos = {}
    for pos in SKILL:
        lg_pos[pos] = {
            "ppr_pg": float(sum(defense[tm]["pos"][pos]["ppr_pg"] for tm in defense) / len(defense)),
            "rec_yds_pg": float(sum(defense[tm]["pos"][pos]["rec_yds_pg"] for tm in defense) / len(defense)),
            "tgt_pg": float(sum(defense[tm]["pos"][pos]["tgt_pg"] for tm in defense) / len(defense)),
        }
    for tm in defense:
        n = defense[tm]["allowed"]["g"]
        defense[tm]["pos_factors"] = {}
        defense[tm]["pos_yds_factors"] = {}
        defense[tm]["ranks"] = {}
        for pos in SKILL:
            base = lg_pos[pos]["ppr_pg"] or 1e-6
            raw_f = defense[tm]["pos"][pos]["ppr_pg"] / base
            defense[tm]["pos_factors"][pos] = 1 + (raw_f - 1) * n / (n + SHRINK_G)
        for pos in ("RB", "WR", "TE"):
            base = lg_pos[pos]["rec_yds_pg"] or 1e-6
            raw_f = defense[tm]["pos"][pos]["rec_yds_pg"] / base
            defense[tm]["pos_yds_factors"][pos] = 1 + (raw_f - 1) * n / (n + SHRINK_G)
    # points from the schedule, prior weeks only
    pts = defaultdict(list)
    prior_games = schedule_rows[schedule_rows.week < week]
    for row in prior_games.itertuples(index=False):
        if row.home_score == row.home_score:
            pts[row.home_team].append(num(row.home_score))
            pts[row.away_team].append(num(row.away_score))
    team_off = {}
    for tm, d in t.groupby("team"):
        n = len(d)
        team_off[tm] = {
            "g": int(n),
            "plays_pg": float(d.plays.sum() / n),
            "pts_pg": (sum(pts[tm]) / len(pts[tm])) if pts[tm] else None,
        }
    for tm in defense:
        pa = []
        for row in prior_games.itertuples(index=False):
            if row.home_team == tm and row.away_score == row.away_score:
                pa.append(num(row.away_score))
            if row.away_team == tm and row.home_score == row.home_score:
                pa.append(num(row.home_score))
        defense[tm]["allowed"]["pts_pg"] = (sum(pa) / len(pa)) if pa else None
    week_games = schedule_rows[schedule_rows.week == week]
    games = []
    for row in week_games.itertuples(index=False):
        games.append({
            "home": row.home_team,
            "away": row.away_team,
            "id": str(row.game_id),
            "spread_line": r4(row.spread_line) if row.spread_line == row.spread_line else None,
            "total_line": r4(row.total_line) if row.total_line == row.total_line else None,
        })
    return {"league": {k: r4(v) for k, v in lg.items()}, "league_pos": lg_pos, "defense": defense, "team_off": team_off, "schedule": {str(week): games}}


def eligible(players):
    """Same season-total filter the app uses to decide who is in the file."""
    keep = set()
    for pid, d in players.groupby("player_id"):
        pos = d.position.iloc[-1]
        att = d.attempts.sum()
        car = d.carries.sum()
        tgt = d.targets.sum()
        if pos == "QB" and att < 20 and car < 10:
            continue
        if pos != "QB" and (tgt + car) < 6:
            continue
        keep.add(pid)
    return keep


def main():
    cross = pfr_map()
    diag = {}
    bundles = {}
    rows = []
    avail = Counter()
    for season in SEASONS:
        print("season", season, flush=True)
        players = read_players(season)
        teams = read_teams(season)
        snaps = read_snaps(season, cross)
        rush = read_rush(season, cross)
        routes, man, rz, ez, tgt_n = load_participation(season, diag)
        oman = opp_man_rates(season)
        games, last = completed_weeks(season)
        games = games[games.game_type == "REG"]
        diag[f"last_week_{season}"] = last
        keep = eligible(players)
        by_player = {pid: d.sort_values("week").to_dict("records") for pid, d in players.groupby("player_id")}
        team_week = {(r.team, int(r.week)): r for r in teams.itertuples(index=False)}
        for week in range(2, last + 1):
            bundle = build_bundle(teams, players, week, games)
            if not bundle:
                continue
            key = f"{season}-{week}"
            bundles[key] = bundle
            # League priors from every kept player's prior weeks.
            lg_routes = defaultdict(lambda: [0.0, 0.0])  # targets, routes
            lg_snap_routes = defaultdict(lambda: [0.0, 0.0])
            lg_ybc = [0.0, 0.0]
            lg_yac = [0.0, 0.0]
            lg_adot = [0.0, 0.0]
            lg_share = defaultdict(lambda: [0.0, 0.0])  # target numer, team attempts while player had a target row
            for pid in keep:
                for rec in by_player.get(pid, []):
                    if rec["week"] >= week:
                        break
                    pos = rec["position"]
                    tw = team_week.get((rec["team"], rec["week"]))
                    db = num(tw.dropbacks) if tw is not None else 0.0
                    rt = routes.get((pid, rec["week"]), 0)
                    if rt > 0 and db > 0:
                        lg_routes[pos][0] += num(rec["targets"])
                        lg_routes[pos][1] += rt
                    sp = snaps.get((pid, rec["week"]))
                    if sp and sp > 0 and db > 0 and pos in ("WR", "TE"):
                        lg_snap_routes[pos][0] += num(rec["targets"])
                        lg_snap_routes[pos][1] += sp * db
                    if pos == "RB":
                        rush_row = rush.get((pid, rec["week"]))
                        if rush_row and rush_row[0] > 0:
                            lg_ybc[0] += rush_row[1]
                            lg_ybc[1] += rush_row[0]
                            lg_yac[0] += rush_row[2]
                            lg_yac[1] += rush_row[0]
                    tg = num(rec["targets"])
                    if tg > 0:
                        lg_adot[0] += num(rec["receiving_air_yards"])
                        lg_adot[1] += tg
                        if tw is not None and num(tw.attempts) > 0:
                            lg_share[pos][0] += tg
                            lg_share[pos][1] += num(tw.attempts)
            def rate(pair):
                return pair[0] / pair[1] if pair[1] > 0 else None
            priors = {
                "tprr": {pos: rate(lg_routes[pos]) for pos in SKILL},
                "snap_tprr": {pos: rate(lg_snap_routes[pos]) for pos in ("WR", "TE")},
                "ybc": rate(lg_ybc),
                "yac": rate(lg_yac),
                "adot": rate(lg_adot),
                "share": {pos: rate(lg_share[pos]) for pos in SKILL},
            }
            # Snap-implied volume rate, prior weeks only, matching backtest.js.
            snap_acc = {pos: {"pa": 0.0, "ca": 0.0, "tg": 0.0, "sp": 0.0} for pos in SKILL}
            for pid in keep:
                pos = None
                for rec in by_player.get(pid, []):
                    if rec["week"] >= week:
                        break
                    pos = rec["position"]
                    sp = snaps.get((pid, rec["week"]))
                    if not sp or sp <= 0:
                        continue
                    bucket = snap_acc[pos]
                    bucket["pa"] += num(rec["attempts"])
                    bucket["ca"] += num(rec["carries"])
                    bucket["tg"] += num(rec["targets"])
                    bucket["sp"] += sp
            snap_rate = {}
            for pos, a in snap_acc.items():
                if a["sp"] > 0:
                    snap_rate[pos] = {k: a[k] / a["sp"] for k in ("pa", "ca", "tg")}
            for pid in keep:
                hist = [rec for rec in by_player.get(pid, []) if rec["week"] < week]
                cur = next((rec for rec in by_player.get(pid, []) if rec["week"] == week), None)
                if not hist or cur is None or cur["fantasy_points_ppr"] != cur["fantasy_points_ppr"]:
                    continue
                pos = cur["position"]
                if pos not in SKILL:
                    continue
                opp = cur["opponent_team"]
                if opp not in bundle["defense"] or cur["team"] not in (bundle["team_off"] or {}):
                    # team_off is only teams that played prior weeks; a first-week team in week 2 should be there
                    if opp not in bundle["defense"]:
                        continue
                def pack(rec):
                    tw = team_week.get((rec["team"], rec["week"]))
                    db = num(tw.dropbacks) if tw is not None else 0.0
                    att = num(tw.attempts) if tw is not None else 0.0
                    air = num(tw.passing_air_yards) if tw is not None else 0.0
                    rt = routes.get((pid, rec["week"]), 0)
                    sp = snaps.get((pid, rec["week"]))
                    rush_row = rush.get((pid, rec["week"]))
                    played = {
                        "week": rec["week"],
                        "pa": num(rec["attempts"]), "py": num(rec["passing_yards"]),
                        "ptd": num(rec["passing_tds"]), "int": num(rec["passing_interceptions"]),
                        "ca": num(rec["carries"]), "ry": num(rec["rushing_yards"]), "rtd": num(rec["rushing_tds"]),
                        "tg": num(rec["targets"]), "rc": num(rec["receptions"]),
                        "rcy": num(rec["receiving_yards"]), "rctd": num(rec["receiving_tds"]),
                        "airy": num(rec["receiving_air_yards"]), "yac": num(rec["receiving_yards_after_catch"]),
                        "fl": num(rec["rushing_fumbles_lost"]) + num(rec["receiving_fumbles_lost"]) + num(rec["sack_fumbles_lost"]),
                        "two": num(rec["passing_2pt_conversions"]) + num(rec["rushing_2pt_conversions"]) + num(rec["receiving_2pt_conversions"]),
                        "ppr": num(rec["fantasy_points_ppr"]),
                        "db": db, "att": att, "tair": air,
                        "routes": rt,
                        "part": (rt / db) if db > 0 and rt > 0 else (0.0 if db > 0 and routes else None),
                        "snap": sp if sp is not None else None,
                        "snap_routes": (sp * db) if sp and db > 0 else None,
                        "ybc": rush_row[1] if rush_row else None,
                        "yacont": rush_row[2] if rush_row else None,
                        "rcar": rush_row[0] if rush_row else None,
                    }
                    mk = man.get((pid, rec["week"]))
                    if mk:
                        played["man_n"], played["man_yds"], played["zone_n"], played["zone_yds"] = mk
                    else:
                        played["man_n"] = played["man_yds"] = played["zone_n"] = played["zone_yds"] = 0
                    return played
                prior = [pack(rec) for rec in hist]
                # Participation part is None when that season has no route file.
                # A zero route week is a real week only when the file exists.
                has_routes = bool(routes)
                w = {}
                t = {}
                for key_name in ("pa", "py", "ptd", "int", "ca", "ry", "rtd", "tg", "rc", "rcy", "rctd"):
                    w[key_name] = r4(decayed(prior, week, key_name))
                    t[key_name] = r4(sum(num(r[key_name]) for r in prior))
                t["fl"] = r4(sum(r["fl"] for r in prior))
                t["two"] = r4(sum(r["two"] for r in prior))
                fp = [r["ppr"] for r in prior]
                mean = sum(fp) / len(fp)
                cv_p = PRIOR_CV[pos]
                if len(fp) > 1 and mean > 0:
                    sd = math.sqrt(sum((x - mean) ** 2 for x in fp) / (len(fp) - 1))
                    cv_p = min(max(sd / mean, 0.15), 1.5)
                cv = math.sqrt((len(fp) * cv_p ** 2 + PRIOR_N * PRIOR_CV[pos] ** 2) / (len(fp) + PRIOR_N))
                sw = ss = 0.0
                seen_snap = False
                for r in prior:
                    if r["snap"] is None:
                        continue
                    wt = DECAY ** (week - 1 - r["week"])
                    sw += wt
                    ss += wt * r["snap"]
                    seen_snap = True
                snap_implied = None
                if seen_snap and sw and pos in snap_rate:
                    snap = ss / sw
                    rt = snap_rate[pos]
                    snap_implied = {"pa": r4(snap * rt["pa"]), "ca": r4(snap * rt["ca"]), "tg": r4(snap * rt["tg"])}
                    avail["snap"] += 1
                def feat_route(part_key, routes_key, prior_rate):
                    if not has_routes and part_key == "part":
                        return None, None
                    parts = [r for r in prior if r.get(part_key) is not None and r["db"] > 0]
                    if part_key == "part":
                        parts = [r for r in prior if r["db"] > 0 and (r["routes"] > 0 or has_routes)]
                        # weeks with a team dropback count; routes may be zero if he was not charted on a pass snap
                        parts = [r for r in parts if r["routes"] > 0 or snaps.get((pid, r["week"])) is not None or r["tg"] > 0]
                    tot_tg = sum(r["tg"] for r in prior if (r["routes"] if part_key == "part" else (r["snap_routes"] or 0)) > 0)
                    tot_rt = sum((r["routes"] if part_key == "part" else (r["snap_routes"] or 0)) for r in prior)
                    if tot_rt <= 0 or prior_rate is None:
                        return None, None
                    tprr = shrink(tot_tg, tot_rt, prior_rate, TPRR_K)
                    # participation: share of team dropbacks
                    if part_key == "part":
                        dec_part = decayed_pair(
                            [{"week": r["week"], "n": r["routes"], "d": r["db"]} for r in prior if r["db"] > 0],
                            week, "n", "d")
                        dec_db = decayed([r for r in prior if r["db"] > 0], week, "db")
                        tr_rows = [r for r in prior if r["db"] > 0][-4:]
                        tr_part = (sum(r["routes"] for r in tr_rows) / sum(r["db"] for r in tr_rows)) if tr_rows and sum(r["db"] for r in tr_rows) else None
                        tr_db = (sum(r["db"] for r in tr_rows) / len(tr_rows)) if tr_rows else None
                    else:
                        dec_part = decayed_pair(
                            [{"week": r["week"], "n": r["snap_routes"], "d": r["db"]} for r in prior if r["snap"] and r["db"] > 0],
                            week, "n", "d")
                        dec_db = decayed([r for r in prior if r["snap"] and r["db"] > 0], week, "db")
                        tr_rows = [r for r in prior if r["snap"] and r["db"] > 0][-4:]
                        tr_part = (sum(r["snap_routes"] for r in tr_rows) / sum(r["db"] for r in tr_rows)) if tr_rows and sum(r["db"] for r in tr_rows) else None
                        tr_db = (sum(r["db"] for r in tr_rows) / len(tr_rows)) if tr_rows else None
                    if dec_part is None or dec_db is None or tprr is None:
                        decay_tg = None
                    else:
                        decay_tg = max(0.0, min(dec_part, 1.0) * dec_db * tprr)
                    trail_tg = None
                    if tr_part is not None and tr_db is not None and tprr is not None:
                        trail_tg = max(0.0, min(tr_part, 1.0) * tr_db * tprr)
                    return r4(decay_tg), r4(trail_tg)
                route_tg = route_trail = snap_route_tg = snap_route_trail = None
                if pos in ("WR", "TE"):
                    route_tg, route_trail = feat_route("part", "routes", priors["tprr"].get(pos))
                    snap_route_tg, snap_route_trail = feat_route("snap", "snap_routes", priors["snap_tprr"].get(pos))
                    if route_tg is not None:
                        avail["route"] += 1
                    if snap_route_tg is not None:
                        avail["snap_route"] += 1
                # Target share and air-yards share.
                share_rows = [r for r in prior if r["att"] > 0]
                tot_tg = sum(r["tg"] for r in share_rows)
                tot_att = sum(r["att"] for r in share_rows)
                share_prior = priors["share"].get(pos)
                share_tg = share_trail = air_tg = None
                if tot_att > 0 and share_prior:
                    # Player target share of team attempts, shrunk toward the position share.
                    ts = shrink(tot_tg, tot_att, share_prior, SHARE_K * (tot_att / max(len(share_rows), 1)))
                    dec_att = decayed(share_rows, week, "att")
                    if ts is not None and dec_att is not None:
                        share_tg = r4(max(0.0, ts * dec_att))
                        avail["share"] += 1
                    last4 = share_rows[-4:]
                    if ts is not None and last4:
                        share_trail = r4(max(0.0, ts * (sum(r["att"] for r in last4) / len(last4))))
                tot_air = sum(r["airy"] for r in prior)
                tot_tg_all = sum(r["tg"] for r in prior)
                adot = shrink(tot_air, tot_tg_all, priors["adot"], ADOT_K) if tot_tg_all > 0 else None
                dec_tair = decayed([r for r in prior if r["tair"] > 0], week, "tair") if any(r["tair"] > 0 for r in prior) else None
                if adot and adot > 1 and dec_tair:
                    # Air-yards share of team air yards, shrunk, divided by aDOT -> targets.
                    ays = shrink(tot_air, sum(r["tair"] for r in prior if r["tair"] > 0) or 0.0, priors["share"].get(pos) and priors["adot"] and (priors["share"][pos] * (priors["adot"] or 8) / max(priors["adot"], 1)) or None, ADOT_K)
                    # simpler share of team air yards
                    team_air = sum(r["tair"] for r in prior if r["tair"] > 0)
                    if team_air > 0 and priors["adot"]:
                        # position air-yards share is not separately published; shrink toward target share * (league adot / player adot) roughly
                        pos_ays = share_prior
                        ays = shrink(tot_air, team_air, pos_ays, ADOT_K) if pos_ays else (tot_air / team_air)
                        air_tg = r4(max(0.0, min(ays, 0.6) * dec_tair / adot))
                        if air_tg is not None:
                            avail["air"] += 1
                adot_ypt = None
                if adot and priors["adot"] and bundle["league"]["ypt"]:
                    ratio = min(1.25, max(0.75, adot / priors["adot"]))
                    adot_ypt = r4(bundle["league"]["ypt"] * ratio)
                    avail["adot"] += 1
                ybc_ypc = None
                if pos == "RB" and priors["ybc"] is not None and priors["yac"] is not None:
                    ybc = sum(r["ybc"] or 0 for r in prior)
                    yac = sum(r["yacont"] or 0 for r in prior)
                    car = sum(r["rcar"] or 0 for r in prior)
                    if car >= 5:
                        ybc_ypc = r4(shrink(ybc, car, priors["ybc"], YBC_K) + shrink(yac, car, priors["yac"], YAC_K))
                        avail["ybc"] += 1
                pace = None
                if opp in bundle["defense"] and bundle["league"]["plays"]:
                    pace = r4(bundle["defense"][opp]["allowed"]["plays_pg"] / bundle["league"]["plays"])
                    avail["pace"] += 1
                man_ratio = None
                if has_routes:
                    man_n = sum(r["man_n"] for r in prior)
                    zone_n = sum(r["zone_n"] for r in prior)
                    man_yds = sum(r["man_yds"] for r in prior)
                    zone_yds = sum(r["zone_yds"] for r in prior)
                    # Opponent man rate over prior weeks.
                    om_n = om_d = 0
                    for wk in range(1, week):
                        cell = oman.get((opp, wk))
                        if cell:
                            om_n += cell[0]
                            om_d += cell[1]
                    if man_n >= 12 and zone_n >= 12 and om_d >= 30 and (man_n + zone_n) > 0:
                        lg_ypt = bundle["league"]["ypt"] or 7
                        man_ypt = shrink(man_yds, man_n, lg_ypt, MAN_K)
                        zone_ypt = shrink(zone_yds, zone_n, lg_ypt, MAN_K)
                        overall = shrink(man_yds + zone_yds, man_n + zone_n, lg_ypt, MAN_K)
                        if overall and overall > 0.5:
                            mix = (om_n / om_d) * man_ypt + (1 - om_n / om_d) * zone_ypt
                            man_ratio = r4(min(1.08, max(0.92, mix / overall)))
                            avail["man"] += 1
                rz_n = sum(rz.get((pid, r["week"]), 0) for r in prior)
                ez_n = sum(ez.get((pid, r["week"]), 0) for r in prior)
                tg_n = sum(tgt_n.get((pid, r["week"]), 0) for r in prior)
                if tg_n > 0:
                    avail["rz_known"] += 1
                avail["rows"] += 1
                rows.append({
                    "k": key, "pos": pos, "team": cur["team"], "season": season, "week": week,
                    "actual": r4(cur["fantasy_points_ppr"]), "g": len(prior), "cv": r4(cv),
                    "w": w, "t": t, "snap": snap_implied,
                    "routeTg": route_tg, "routeTrail": route_trail,
                    "snapRouteTg": snap_route_tg, "snapRouteTrail": snap_route_trail,
                    "shareTg": share_tg, "shareTrail": share_trail, "airTg": air_tg,
                    "adotYpt": adot_ypt, "ybcYpc": ybc_ypc, "pace": pace, "manRatio": man_ratio,
                    "rzShare": r4(rz_n / tg_n) if tg_n else None,
                    "ezShare": r4(ez_n / tg_n) if tg_n else None,
                })
        print("  rows so far", len(rows), "avail", dict(avail), flush=True)
    # Round league_pos
    def clean(o):
        if isinstance(o, dict):
            return {k: clean(v) for k, v in o.items()}
        if isinstance(o, list):
            return [clean(v) for v in o]
        if isinstance(o, float):
            return r4(o)
        return o
    out = {"bundles": clean(bundles), "rows": rows, "diag": diag, "avail": dict(avail)}
    dest = os.path.join(DIR, "cases.json")
    with open(dest, "w") as f:
        json.dump(out, f, separators=(",", ":"))
    print("wrote", dest, "rows", len(rows), "bytes", os.path.getsize(dest))
    print("diag", json.dumps(diag)[:2000])


if __name__ == "__main__":
    main()
