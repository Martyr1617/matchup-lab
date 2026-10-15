#!/usr/bin/env python3
"""Pregame missing-defender shares.

Importance uses snaps and defensive production from earlier weeks only, plus a
faded prior season when that file is already on disk. An Out or Doubtful tag
carries forward until the player plays again. The projection multiplier that
would apply this table is left off: it did not beat the current opponent factor.
"""
import os
from collections import defaultdict

import pandas as pd

COV = {'CB', 'DB', 'FS', 'SS', 'S', 'SAF', 'NB'}
EDGE = {'DE', 'OLB', 'EDGE', 'LB', 'DL'}
INTERIOR = {'DT', 'NT', 'ILB', 'MLB'}
DEF = COV | EDGE | INTERIOR
PRIOR_W = 0.30  # each prior-season game, versus 1.0 for a current-season game
KEY = 0.07

def num(v):
    try:
        x = float(v)
    except (TypeError, ValueError):
        return 0.0
    if x != x:
        return 0.0
    return x


def status_of(raw):
    if not isinstance(raw, str):
        return None
    s = raw.strip().lower()
    if not s or s == 'nan':
        return None
    if 'questionable' in s:
        return 'q'
    if 'doubt' in s:
        return 'doubt'
    if s in ('out', 'ir') or 'reserve' in s or 'pup' in s or 'suspend' in s:
        return 'out'
    return None


def availability_status(reports, played, season, week, pid):
    """'out', 'doubt', 'q', or None. Out and Doubtful carry forward until he plays."""
    st = reports.get((season, week, pid))
    if st:
        return st
    last = None
    for w in range(week - 1, 0, -1):
        prev = reports.get((season, w, pid))
        if prev:
            last = (w, prev)
            break
    if not last or last[1] not in ('out', 'doubt'):
        return None
    for w in range(last[0] + 1, week):
        if (season, w, pid) in played:
            return None
    return 'out' if last[1] == 'out' else 'doubt'


def load_ids(path):
    ids = pd.read_csv(path, dtype=str, usecols=['pfr_id', 'gsis_id'])
    return {r.pfr_id: r.gsis_id for r in ids.itertuples(index=False) if isinstance(r.pfr_id, str) and isinstance(r.gsis_id, str)}


def load_players(path):
    cols = pd.read_csv(path, nrows=0).columns
    want = [c for c in (
        'player_id', 'player_display_name', 'position', 'week', 'season', 'team', 'season_type',
        'def_tackles_solo', 'def_tackle_assists', 'def_tackles_with_assist', 'def_tackles_for_loss',
        'def_sacks', 'def_qb_hits', 'def_interceptions', 'def_pass_defended') if c in cols]
    df = pd.read_csv(path, usecols=want)
    if 'season_type' in df.columns:
        df = df[df.season_type == 'REG']
    df = df[df.position.isin(DEF)]
    rows = []
    for r in df.itertuples(index=False):
        solo = num(getattr(r, 'def_tackles_solo', 0))
        ast = num(getattr(r, 'def_tackle_assists', 0)) or num(getattr(r, 'def_tackles_with_assist', 0))
        tfl = num(getattr(r, 'def_tackles_for_loss', 0))
        sacks = num(getattr(r, 'def_sacks', 0))
        hits = num(getattr(r, 'def_qb_hits', 0))
        ints = num(getattr(r, 'def_interceptions', 0))
        pbu = num(getattr(r, 'def_pass_defended', 0))
        rows.append({
            'id': str(r.player_id), 'name': r.player_display_name if isinstance(r.player_display_name, str) else '',
            'pos': r.position, 'season': int(r.season), 'week': int(r.week), 'team': r.team,
            'pass': 4 * sacks + hits + 5 * ints + 2.5 * pbu,
            'run': solo + 0.5 * ast + 3 * tfl + 1.5 * sacks,
            'played': (solo + ast + tfl + sacks + hits + ints + pbu) > 0,
        })
    return rows


def load_snaps(path, pfr_to_gsis):
    df = pd.read_csv(path, usecols=['season', 'game_type', 'week', 'player', 'pfr_player_id', 'position', 'team', 'defense_snaps'])
    df = df[(df.game_type == 'REG') & (df.defense_snaps > 0)]
    mapped = 0
    rows = []
    for r in df.itertuples(index=False):
        gid = pfr_to_gsis.get(r.pfr_player_id)
        if not gid:
            continue
        mapped += 1
        rows.append({
            'id': gid, 'name': r.player if isinstance(r.player, str) else '',
            'pos': r.position if isinstance(r.position, str) else '',
            'season': int(r.season), 'week': int(r.week), 'team': r.team,
            'snaps': num(r.defense_snaps),
        })
    print(f'  snaps {os.path.basename(path)} mapped {mapped}/{len(df)}')
    return rows


def load_injuries(path):
    cols = pd.read_csv(path, nrows=0).columns
    want = [c for c in ('season', 'game_type', 'team', 'week', 'gsis_id', 'full_name', 'report_status', 'date_modified') if c in cols]
    df = pd.read_csv(path, usecols=want)
    df = df[df.game_type == 'REG']
    if 'date_modified' in df.columns:
        df = df.sort_values('date_modified')
    out = {}
    by_team = defaultdict(set)
    for r in df.itertuples(index=False):
        if not isinstance(r.gsis_id, str):
            continue
        st = status_of(r.report_status if isinstance(r.report_status, str) else None)
        key = (int(r.season), int(r.week), r.gsis_id)
        out[key] = st  # last report of the week wins; a cleared status is available
        if st:
            by_team[(int(r.season), int(r.week), r.team)].add(r.gsis_id)
    return out, by_team


def load_depth_weekly(path):
    df = pd.read_csv(path, usecols=['season', 'club_code', 'week', 'game_type', 'depth_team', 'formation', 'gsis_id', 'position', 'full_name'])
    df = df[(df.game_type == 'REG') & (df.gsis_id.notna())]
    df = df[(df.formation == 'Defense') | (df.position.isin(DEF))]
    roster = defaultdict(dict)
    for r in df.itertuples(index=False):
        roster[(int(r.season), int(r.week), r.club_code)][str(r.gsis_id)] = (
            r.position if isinstance(r.position, str) else '',
            r.full_name if isinstance(r.full_name, str) else '',
        )
    return roster


def load_depth_daily(path, games):
    df = pd.read_csv(path, usecols=['dt', 'team', 'player_name', 'gsis_id', 'pos_abb', 'pos_rank'])
    df = df[df.gsis_id.notna() & df.pos_abb.isin(DEF)]
    df['day'] = df.dt.astype(str).str.slice(0, 10)
    by_team = defaultdict(list)
    for (team, day), d in df.groupby(['team', 'day']):
        players = {}
        for r in d.itertuples(index=False):
            players[str(r.gsis_id)] = (r.pos_abb, r.player_name if isinstance(r.player_name, str) else '')
        by_team[team].append((day, players))
    for team in by_team:
        by_team[team].sort()
    roster = {}
    g = games[(games.game_type == 'REG') & (games.gameday.notna())]
    for r in g.itertuples(index=False):
        day = r.gameday if isinstance(r.gameday, str) else None
        if not day:
            continue
        for team in (r.home_team, r.away_team):
            days = by_team.get(team)
            if not days:
                continue
            chosen = None
            for d, players in days:
                if d < day:
                    chosen = players
                else:
                    break
            if chosen:
                roster[(int(r.season), int(r.week), team)] = chosen
    return roster


def blend(pos, snap_share, pass_share, run_share, have_snap):
    sp = snap_share if have_snap else 0.0
    if pos in COV:
        p = 0.70 * sp + 0.30 * pass_share if have_snap else pass_share
        r = 0.15 * sp if have_snap else 0.0
    elif pos in EDGE:
        p = 0.35 * sp + 0.65 * pass_share if have_snap else pass_share
        r = 0.45 * sp + 0.55 * run_share if have_snap else run_share
    else:
        p = 0.25 * sp + 0.75 * pass_share if have_snap else pass_share
        r = 0.40 * sp + 0.60 * run_share if have_snap else run_share
    return p, r


def build_availability(files_by_season, games_path, ids_path, seasons):
    """Missing-defender shares for each requested season.

    files_by_season maps a season to paths (players, and optional snaps, inj, depth).
    Only weeks before the game are used. A missing file is skipped. Returns
    {season: {week: {team: row}}}.
    """
    pfr = load_ids(ids_path) if ids_path and os.path.exists(ids_path) else {}
    games = pd.read_csv(games_path, usecols=['season', 'game_type', 'week', 'gameday', 'home_team', 'away_team'])
    games = games[games.game_type == 'REG']
    played_teams = defaultdict(set)  # (season, week) -> teams
    for r in games.itertuples(index=False):
        if 1 <= int(r.week) <= 18:
            played_teams[(int(r.season), int(r.week))].update((r.home_team, r.away_team))

    stats = []
    snaps = []
    reports = {}
    report_teams = defaultdict(set)
    depth = {}
    for season, paths in files_by_season.items():
        if paths.get('players') and os.path.exists(paths['players']):
            stats.extend(load_players(paths['players']))
        if paths.get('snaps') and os.path.exists(paths['snaps']) and pfr:
            snaps.extend(load_snaps(paths['snaps'], pfr))
        if paths.get('inj') and os.path.exists(paths['inj']):
            inj, by_team = load_injuries(paths['inj'])
            reports.update(inj)
            for k, v in by_team.items():
                report_teams[k] |= v
        if paths.get('depth') and os.path.exists(paths['depth']):
            sample = pd.read_csv(paths['depth'], nrows=0)
            if 'dt' in sample.columns:
                depth.update(load_depth_daily(paths['depth'], games[games.season == season]))
            else:
                depth.update(load_depth_weekly(paths['depth']))

    # Per player, per season, games strictly usable as history.
    hist = defaultdict(list)  # id -> list of (season, week, snaps, pass, run, pos, name)
    names = {}
    played = set()  # (season, week, id)
    recent_team = defaultdict(list)  # (season, team) -> list of (week, id, pos, name)
    for row in stats:
        names[row['id']] = row['name']
        hist[row['id']].append((row['season'], row['week'], 0.0, row['pass'], row['run'], row['pos'], row['name']))
        if row['played']:
            played.add((row['season'], row['week'], row['id']))
        recent_team[(row['season'], row['team'])].append((row['week'], row['id'], row['pos'], row['name']))
    for row in snaps:
        names.setdefault(row['id'], row['name'])
        hist[row['id']].append((row['season'], row['week'], row['snaps'], 0.0, 0.0, row['pos'], row['name']))
        played.add((row['season'], row['week'], row['id']))
        recent_team[(row['season'], row['team'])].append((row['week'], row['id'], row['pos'], row['name']))
    for pid in hist:
        hist[pid].sort()

    def roster_for(season, week, team):
        found = {}
        chart = depth.get((season, week, team)) or {}
        for pid, (pos, name) in chart.items():
            found[pid] = (pos, name or names.get(pid, ''))
        for w, pid, pos, name in recent_team.get((season, team), ()):
            if week - 4 <= w < week:
                found.setdefault(pid, (pos, name or names.get(pid, '')))
        for pid in report_teams.get((season, week, team), ()):
            found.setdefault(pid, ('', names.get(pid, '')))
        return found

    def importance(season, week, team):
        roster = roster_for(season, week, team)
        acc = {}
        for pid, (pos, name) in roster.items():
            snaps_w = pass_w = run_w = 0.0
            best_pos = pos
            for s, w, sn, p, r, ppos, _nm in hist.get(pid, ()):
                if s == season and w < week:
                    wt = 1.0
                elif s == season - 1 and 1 <= w <= 18:
                    wt = PRIOR_W
                else:
                    continue
                snaps_w += wt * sn
                pass_w += wt * p
                run_w += wt * r
                if ppos:
                    best_pos = ppos
            if snaps_w or pass_w or run_w:
                acc[pid] = [best_pos or pos, name, snaps_w, pass_w, run_w]
        if not acc:
            return {}
        team_sn = sum(v[2] for v in acc.values())
        team_p = sum(v[3] for v in acc.values())
        team_r = sum(v[4] for v in acc.values())
        out = {}
        for pid, (pos, name, sn, p, r) in acc.items():
            have = team_sn > 0 and sn > 0
            ps, rs = blend(pos, sn / team_sn if team_sn else 0, p / team_p if team_p else 0, r / team_r if team_r else 0, have or team_sn > 0)
            if ps >= KEY or rs >= KEY:
                out[pid] = (pos, name or names.get(pid, ''), ps, rs)
        return out

    seasons_out = {}
    for season in seasons:
        raw = {}
        weeks = sorted({w for (s, w) in played_teams if s == season})
        for week in weeks:
            raw[week] = {}
            for team in sorted(played_teams[(season, week)]):
                imp = importance(season, week, team)
                bucket = {k: 0.0 for k in ('pass_out', 'pass_doubt', 'pass_q', 'run_out', 'run_doubt', 'run_q')}
                named = []
                for pid, (_pos, name, ps, rs) in imp.items():
                    st = availability_status(reports, played, season, week, pid)
                    if not st:
                        continue
                    if st == 'out':
                        bucket['pass_out'] += ps
                        bucket['run_out'] += rs
                        named.append((max(ps, rs), name))
                    elif st == 'doubt':
                        bucket['pass_doubt'] += ps
                        bucket['run_doubt'] += rs
                        named.append((max(ps, rs), name))
                    else:
                        bucket['pass_q'] += ps
                        bucket['run_q'] += rs
                named.sort(reverse=True)
                raw[week][team] = (bucket, [n for _s, n in named if n][:3])
        # Baseline is the mean of earlier weeks this team played.
        out = {}
        history = defaultdict(list)
        for week in weeks:
            out[str(week)] = {}
            for team, (bucket, names_) in raw[week].items():
                hist_rows = history[team]
                base = {k: 0.0 for k in bucket}
                if hist_rows:
                    for prev in hist_rows:
                        for k in base:
                            base[k] += prev[k]
                    for k in base:
                        base[k] /= len(hist_rows)
                row = {k: round(v, 4) for k, v in bucket.items()}
                for k, v in base.items():
                    row[k + '_base'] = round(v, 4)
                if names_:
                    row['names'] = names_
                shock = (bucket['pass_out'] + bucket['pass_doubt']) - (base['pass_out'] + base['pass_doubt'])
                if abs(shock) >= 0.02 or names_:
                    out[str(week)][team] = row
                history[team].append(bucket)
        seasons_out[str(season)] = out
    return seasons_out


def _season_files(data_dir, season):
    def pick(*names):
        for name in names:
            path = os.path.join(data_dir, name)
            if os.path.exists(path) and os.path.getsize(path) > 0:
                return path
        return None
    return {
        'players': pick(f'players_{season}.csv'),
        'snaps': pick(f'snaps_{season}.csv'),
        'inj': pick(f'injuries_{season}.csv'),
        'depth': pick(f'depth_{season}.csv'),
    }


def build_week_availability(data_dir, season, next_week):
    """Availability through next_week from the files the refresh already downloaded.

    A prior-season file is used when it is already on disk. Missing inputs
    return {} so the projection build still publishes.
    """
    current = _season_files(data_dir, season)
    if not current['players'] or not current['inj']:
        return {}
    games_path = os.path.join(data_dir, 'games.csv')
    if not os.path.exists(games_path):
        return {}
    files = {season: current}
    prior = _season_files(data_dir, season - 1)
    if prior['players']:
        files[season - 1] = prior
    built = build_availability(files, games_path, os.path.join(data_dir, 'db_playerids.csv'), [season])
    table = built.get(str(season), {})
    return {wk: teams for wk, teams in table.items() if int(wk) <= int(next_week)}
