"""Build data.json for the fantasy projection app from nflverse 2026 data."""
import json, math, os
import pandas as pd
import numpy as np

import build_advanced

SEASON = 2026
D = 'data/'
SKILL_POS = ['QB', 'RB', 'WR', 'TE']
# Questionable is not unavailable. Doubtful is, matching the lineup page.
OUT_REPORT = {'out', 'ir', 'injured reserve', 'doubtful', 'pup', 'suspended', 'sus'}


def attach_snap_share(players, snaps, pfr_to_gsis, cur_week, decay=0.7):
    """Record offensive snap share and the volume that share implies.

    The rate is this season's position volume per snap share on games already
    played. A missing file, a failed read, or an unmapped player leaves that
    player's usage line unchanged.
    """
    if snaps is None or not len(snaps) or not pfr_to_gsis:
        return 0
    s = snaps
    if 'game_type' in s.columns:
        s = s[s.game_type == 'REG']
    if 'week' in s.columns:
        s = s[(s.week >= 1) & (s.week <= cur_week)]
    if not len(s) or 'pfr_player_id' not in s.columns or 'offense_pct' not in s.columns:
        return 0
    share = {}
    for row in s.itertuples(index=False):
        gid = pfr_to_gsis.get(row.pfr_player_id)
        if not gid:
            continue
        try:
            pct = float(row.offense_pct)
        except (TypeError, ValueError):
            continue
        if pct != pct:
            continue
        share[(str(gid), int(row.week))] = pct
    if not share:
        return 0
    acc = {}
    for pl in players:
        bucket = acc.setdefault(pl['pos'], {'pa': 0.0, 'ca': 0.0, 'tg': 0.0, 'sp': 0.0})
        for g in pl.get('log') or []:
            sp = share.get((str(pl['id']), int(g['wk'])))
            if sp is None or sp <= 0:
                continue
            bucket['pa'] += g.get('pa') or 0
            bucket['ca'] += g.get('ca') or 0
            bucket['tg'] += g.get('tg') or 0
            bucket['sp'] += sp
    rate = {}
    for pos, a in acc.items():
        if a['sp'] > 0:
            rate[pos] = {k: a[k] / a['sp'] for k in ('pa', 'ca', 'tg')}
    n = 0
    for pl in players:
        wsum = 0.0
        acc_sp = 0.0
        seen = False
        for g in pl.get('log') or []:
            sp = share.get((str(pl['id']), int(g['wk'])))
            if sp is None:
                continue
            g['sp'] = round(sp, 3)
            seen = True
            wt = decay ** (cur_week - int(g['wk']))
            wsum += wt
            acc_sp += wt * sp
        rt = rate.get(pl['pos'])
        if seen and wsum and rt:
            snap = acc_sp / wsum
            pl['snapImplied'] = {
                'pa': round(snap * rt['pa'], 2),
                'ca': round(snap * rt['ca'], 2),
                'tg': round(snap * rt['tg'], 2),
            }
            n += 1
    return n


COLLAPSE_W = 0.2


def _collapse_flags(snaps):
    """True on games whose snap share collapsed, unless every game did."""
    known = [s for s in snaps if s is not None]
    has_starter = any(s >= 0.50 for s in known)
    max_sp = max(known) if known else None
    flags = []
    for sp in snaps:
        bad = False
        if sp is not None and has_starter and sp < 0.25:
            bad = True
        elif sp is not None and max_sp is not None and max_sp >= 0.55 and sp < 0.40 and sp < 0.40 * max_sp:
            bad = True
        flags.append(bad)
    if flags and all(flags):
        return [False] * len(flags)
    return flags


def _prior_mean(values, flags):
    nume = den = 0.0
    seen = False
    for val, bad in zip(values, flags):
        if val is None:
            continue
        w = COLLAPSE_W if bad else 1.0
        nume += w * val
        den += w
        seen = True
    if not seen or den <= 0:
        return None
    return nume / den


def prior_profiles(year, data_dir, pfr_to_gsis=None):
    """Previous-season usage means and counting totals, keyed by gsis id.

    A missing file returns {}. Snap share discounts a collapsed game the same
    way the full-workload display does. Counting totals stay unweighted.
    """
    path = os.path.join(data_dir, f'players_{year}.csv')
    if not os.path.exists(path) or os.path.getsize(path) < 100:
        return {}
    try:
        df = pd.read_csv(path, low_memory=False)
    except Exception as ex:
        print('prior season unavailable', ex)
        return {}
    if 'season_type' in df.columns:
        df = df[df.season_type == 'REG']
    need = {'player_id', 'position', 'week'}
    if not need.issubset(df.columns):
        return {}
    df = df[df.position.isin(SKILL_POS) & df.week.between(1, 18)].copy()
    if not len(df):
        return {}
    snaps = {}
    snap_path = os.path.join(data_dir, f'snaps_{year}.csv')
    if pfr_to_gsis and os.path.exists(snap_path) and os.path.getsize(snap_path) > 0:
        try:
            s = pd.read_csv(snap_path, low_memory=False)
            if 'game_type' in s.columns:
                s = s[s.game_type == 'REG']
            if 'week' in s.columns and 'pfr_player_id' in s.columns and 'offense_pct' in s.columns:
                s = s[s.week.between(1, 18) & s.pfr_player_id.notna()]
                for row in s.itertuples(index=False):
                    gid = pfr_to_gsis.get(row.pfr_player_id)
                    if not gid:
                        continue
                    try:
                        pct = float(row.offense_pct)
                    except (TypeError, ValueError):
                        continue
                    if pct != pct:
                        continue
                    snaps[(str(gid), int(row.week))] = pct
        except Exception as ex:
            print('prior snaps unavailable', ex)
    count_cols = (
        'attempts', 'passing_yards', 'passing_tds', 'passing_interceptions',
        'carries', 'rushing_yards', 'rushing_tds', 'targets', 'receptions',
        'receiving_yards', 'receiving_tds', 'rushing_fumbles_lost',
        'receiving_fumbles_lost', 'sack_fumbles_lost',
    )
    for col in count_cols:
        if col not in df.columns:
            df[col] = 0.0
        df[col] = pd.to_numeric(df[col], errors='coerce').fillna(0.0)
    if 'target_share' in df.columns:
        df['target_share'] = pd.to_numeric(df['target_share'], errors='coerce')
    else:
        df['target_share'] = float('nan')
    df['week'] = df['week'].astype(int)
    out = {}
    keys = ('pa', 'py', 'ptd', 'int', 'ca', 'ry', 'rtd', 'tg', 'rc', 'rcy', 'rctd', 'fl')
    for pid, rows in df.groupby('player_id'):
        rows = rows.sort_values('week').groupby('week', as_index=False).tail(1)
        games = []
        for row in rows.itertuples(index=False):
            fl = float(row.rushing_fumbles_lost + row.receiving_fumbles_lost + row.sack_fumbles_lost)
            ts = row.target_share
            games.append({
                'wk': int(row.week),
                'pa': float(row.attempts), 'py': float(row.passing_yards),
                'ptd': float(row.passing_tds), 'int': float(row.passing_interceptions),
                'ca': float(row.carries), 'ry': float(row.rushing_yards), 'rtd': float(row.rushing_tds),
                'tg': float(row.targets), 'rc': float(row.receptions),
                'rcy': float(row.receiving_yards), 'rctd': float(row.receiving_tds),
                'fl': fl,
                'ts': None if ts != ts else float(ts),
                'sp': snaps.get((str(pid), int(row.week))),
            })
        if not games:
            continue
        flags = _collapse_flags([g['sp'] for g in games])
        totals = {k: sum(g[k] for g in games) for k in keys}
        touches = totals['tg'] + totals['ca']
        if rows.iloc[0].position == 'QB':
            if totals['pa'] < 20 and touches < 10:
                continue
        elif touches < 6:
            continue
        def rnd(v, n):
            return None if v is None else round(float(v), n)
        profile = {
            'ts': rnd(_prior_mean([g['ts'] for g in games], flags), 4),
            'ca': rnd(_prior_mean([g['ca'] for g in games], flags), 3),
            'pa': rnd(_prior_mean([g['pa'] for g in games], flags), 3),
            't': {k: round(float(totals[k]), 1) for k in keys},
        }
        out[str(pid)] = profile
    return out


def write_priors_js(profiles, season, prior_year, path='site/priors.js'):
    """Browser fallback used until data.json carries each player's prior."""
    payload = {'season': int(season), 'priorSeason': int(prior_year), 'byId': profiles}
    text = 'globalThis.ML_PRIORS=' + json.dumps(payload, separators=(',', ':')) + ';\n'
    with open(path, 'w') as f:
        f.write(text)
    return len(profiles)


def build_roles(games, injuries, depth_path, season):
    """Pregame depth-chart order and players ruled out, keyed by week.

    The chart is the last daily depth chart strictly before that week's game.
    A missing or unreadable depth file returns {} so projections stay unchanged.
    """
    if not depth_path or not os.path.exists(depth_path) or os.path.getsize(depth_path) == 0:
        return {}
    try:
        dc = pd.read_csv(depth_path, low_memory=False)
    except Exception as ex:
        print('depth chart unavailable', ex)
        return {}
    if 'gsis_id' not in dc.columns or 'pos_abb' not in dc.columns or 'dt' not in dc.columns:
        print('depth chart missing columns')
        return {}

    roles = {}
    inj = injuries
    if inj is not None and len(inj):
        if 'season' in inj.columns:
            inj = inj[inj.season == season]
        if 'game_type' in inj.columns:
            inj = inj[inj.game_type == 'REG']
        elif 'season_type' in inj.columns:
            inj = inj[inj.season_type == 'REG']
        for wk, d in inj.groupby('week'):
            try:
                wk = int(wk)
            except (TypeError, ValueError):
                continue
            if wk < 1 or wk > 18:
                continue
            ruled = []
            for pid, rows in d.groupby('gsis_id'):
                status = rows.iloc[-1].report_status
                if isinstance(status, str) and status.strip().lower() in OUT_REPORT:
                    ruled.append(str(pid))
            roles[str(wk)] = {'out': ruled, 'chart': {}}

    dc = dc[dc.pos_abb.isin(SKILL_POS) & dc.gsis_id.notna()].copy()
    if not len(dc):
        return roles
    dc['day'] = dc.dt.astype(str).str.slice(0, 10)
    dc = dc.sort_values('dt').groupby(['day', 'team', 'pos_abb', 'gsis_id'], as_index=False).tail(1)
    by_key = {}
    days_by_team = {}
    for row in dc.itertuples(index=False):
        by_key.setdefault((row.team, row.pos_abb, row.day), []).append((row.pos_rank, str(row.gsis_id)))
        days_by_team.setdefault(row.team, set()).add(row.day)
    if games is None:
        return roles
    for row in games.itertuples(index=False):
        try:
            wk = int(row.week)
        except (TypeError, ValueError):
            continue
        if wk < 1 or wk > 18:
            continue
        day = row.gameday if isinstance(row.gameday, str) else None
        if not day:
            continue
        for team in (row.home_team, row.away_team):
            days = sorted(d for d in days_by_team.get(team, ()) if d < day)
            if not days:
                continue
            last = days[-1]
            bucket = roles.setdefault(str(wk), {'out': [], 'chart': {}})
            for pos in SKILL_POS:
                ranked = by_key.get((team, pos, last))
                if not ranked:
                    continue
                order = []
                for _, pid in sorted(ranked, key=lambda x: (x[0] if x[0] == x[0] else 99, x[1])):
                    if pid not in order:
                        order.append(pid)
                bucket['chart'].setdefault(team, {})[pos] = order
    return roles


def regular_season_games(games, season):
    """Regular-season games for one season. Preseason and postseason do not count."""
    g = games.loc[games['season'] == season].copy()
    if 'game_type' in g.columns:
        g = g.loc[g['game_type'] == 'REG']
    elif 'season_type' in g.columns:
        g = g.loc[g['season_type'] == 'REG']
    return g


def last_completed_week(games):
    """Last week whose regular-season games are all final.

    One final (Thursday night) does not complete the week, and a later week
    cannot complete while an earlier week still has an unplayed game.
    `games` is a single season of regular-season games, including unplayed ones.
    """
    if games is None or len(games) == 0 or 'week' not in getattr(games, 'columns', []):
        return 0
    done = []
    for wk, d in games.groupby('week'):
        if len(d) > 0 and bool(d['home_score'].notna().all()):
            done.append(int(wk))
    last = 0
    for wk in sorted(done):
        if wk == last + 1:
            last = wk
        else:
            break
    return last


def main():
    p = pd.read_csv(D + 'players_2026.csv')
    t = pd.read_csv(D + 'team_2026.csv')
    g = regular_season_games(pd.read_csv(D + 'games.csv'), SEASON)
    inj = pd.read_csv(D + 'injuries_2026.csv')

    CUR_WEEK = last_completed_week(g)
    NEXT_WEEK = CUR_WEEK + 1
    # Averages use only completed weeks, so a live week never mixes into the rates.
    g_done = g.loc[g['week'] <= CUR_WEEK].copy()
    p = p[(p.season_type == 'REG') & (p.week <= CUR_WEEK)]
    t = t[(t.season_type == 'REG') & (t.week <= CUR_WEEK)]

    TEAM_NAMES = {
     'ARI':'Arizona Cardinals','ATL':'Atlanta Falcons','BAL':'Baltimore Ravens','BUF':'Buffalo Bills','CAR':'Carolina Panthers',
     'CHI':'Chicago Bears','CIN':'Cincinnati Bengals','CLE':'Cleveland Browns','DAL':'Dallas Cowboys','DEN':'Denver Broncos',
     'DET':'Detroit Lions','GB':'Green Bay Packers','HOU':'Houston Texans','IND':'Indianapolis Colts','JAX':'Jacksonville Jaguars',
     'KC':'Kansas City Chiefs','LA':'Los Angeles Rams','LAC':'Los Angeles Chargers','LV':'Las Vegas Raiders','MIA':'Miami Dolphins',
     'MIN':'Minnesota Vikings','NE':'New England Patriots','NO':'New Orleans Saints','NYG':'New York Giants','NYJ':'New York Jets',
     'PHI':'Philadelphia Eagles','PIT':'Pittsburgh Steelers','SEA':'Seattle Seahawks','SF':'San Francisco 49ers','TB':'Tampa Bay Buccaneers',
     'TEN':'Tennessee Titans','WAS':'Washington Commanders'}
    TEAMS = list(TEAM_NAMES)

    def r(x, n=3):
        if x is None or (isinstance(x, float) and (math.isnan(x) or math.isinf(x))): return None
        return round(float(x), n)

    # ---------------- League-wide per-game offensive averages (what an avg defense allows) ----------------
    tg = t.groupby('team').size()
    lg = {}
    for col in ['attempts','completions','passing_yards','passing_tds','passing_interceptions','sacks_suffered',
                'carries','rushing_yards','rushing_tds','receptions','targets','receiving_yards','receiving_tds',
                'passing_air_yards']:
        lg[col] = t[col].sum() / len(t)
    lg['ypc'] = t.rushing_yards.sum() / t.carries.sum()
    lg['ypa'] = t.passing_yards.sum() / t.attempts.sum()
    lg['comp_pct'] = t.completions.sum() / t.attempts.sum()
    lg['ypt'] = t.receiving_yards.sum() / t.targets.sum()
    lg['rush_td_rate'] = t.rushing_tds.sum() / t.carries.sum()
    lg['pass_td_rate'] = t.passing_tds.sum() / t.attempts.sum()
    lg['int_rate'] = t.passing_interceptions.sum() / t.attempts.sum()
    lg['rec_td_rate'] = t.receiving_tds.sum() / t.targets.sum()
    lg['plays'] = (t.attempts.sum() + t.carries.sum() + t.sacks_suffered.sum()) / len(t)

    # ---------------- Team offense pace ----------------
    team_off = {}
    for tm, d in t.groupby('team'):
        n = len(d)
        team_off[tm] = {
            'g': int(n),
            'plays_pg': r((d.attempts.sum()+d.carries.sum()+d.sacks_suffered.sum())/n, 1),
            'pass_att_pg': r(d.attempts.sum()/n, 1),
            'rush_att_pg': r(d.carries.sum()/n, 1),
            'pass_rate': r(d.attempts.sum()/(d.attempts.sum()+d.carries.sum()), 3),
            'pts_pg': None,
        }
    # points per game from schedule
    pts = {}
    for _, row in g_done.iterrows():
        pts.setdefault(row.home_team, []).append(row.home_score)
        pts.setdefault(row.away_team, []).append(row.away_score)
    for tm in TEAMS:
        if tm in pts: team_off[tm]['pts_pg'] = r(np.mean(pts[tm]), 1)

    # ---------------- Defense "allowed" stats (from opponent offenses) ----------------
    SHRINK_K = 4.0   # games of regression toward league average
    def shrink(factor, n, k=SHRINK_K):
        return 1 + (factor - 1) * n / (n + k)

    defense = {}
    for tm in TEAMS:
        d = t[t.opponent_team == tm]
        n = len(d)
        if n == 0: continue
        allowed = {
            'g': int(n),
            'pass_att_pg': d.attempts.sum()/n, 'comp_pg': d.completions.sum()/n,
            'pass_yds_pg': d.passing_yards.sum()/n, 'pass_td_pg': d.passing_tds.sum()/n,
            'int_pg': d.passing_interceptions.sum()/n, 'sacks_pg': d.sacks_suffered.sum()/n,
            'rush_att_pg': d.carries.sum()/n, 'rush_yds_pg': d.rushing_yards.sum()/n, 'rush_td_pg': d.rushing_tds.sum()/n,
            'ypc': d.rushing_yards.sum()/max(d.carries.sum(),1), 'ypa': d.passing_yards.sum()/max(d.attempts.sum(),1),
            'comp_pct': d.completions.sum()/max(d.attempts.sum(),1),
            'pts_pg': None,
        }
        # points allowed
        pa = []
        for _, row in g_done.iterrows():
            if row.home_team == tm: pa.append(row.away_score)
            if row.away_team == tm: pa.append(row.home_score)
        allowed['pts_pg'] = float(np.mean(pa)) if pa else None
        # raw factors vs league
        raw = {
            'pass_att': allowed['pass_att_pg']/lg['attempts'],
            'pass_yds': allowed['pass_yds_pg']/lg['passing_yards'],
            'ypa': allowed['ypa']/lg['ypa'],
            'comp_pct': allowed['comp_pct']/lg['comp_pct'],
            'pass_td': (allowed['pass_td_pg']/lg['passing_tds']),
            'int': (allowed['int_pg']/lg['passing_interceptions']),
            'sacks': (allowed['sacks_pg']/lg['sacks_suffered']),
            'rush_att': allowed['rush_att_pg']/lg['carries'],
            'rush_yds': allowed['rush_yds_pg']/lg['rushing_yards'],
            'ypc': allowed['ypc']/lg['ypc'],
            'rush_td': (allowed['rush_td_pg']/lg['rushing_tds']),
        }
        factors = {k: shrink(v, n) for k, v in raw.items()}
        defense[tm] = {'allowed': allowed, 'factors': factors}

    # fantasy points allowed per position (PPR, half, std components) & position-specific allowed
    SKILL = ['QB','RB','WR','TE']
    for tm in TEAMS:
        if tm not in defense: continue
        d = p[(p.opponent_team == tm) & (p.position.isin(SKILL))]
        n = defense[tm]['allowed']['g']
        pos_allowed = {}
        for pos in SKILL:
            dp = d[d.position == pos]
            pos_allowed[pos] = {
                'ppr_pg': dp.fantasy_points_ppr.sum()/n,
                'std_pg': dp.fantasy_points.sum()/n,
                'rec_pg': dp.receptions.sum()/n,
                'rec_yds_pg': dp.receiving_yards.sum()/n,
                'rec_td_pg': dp.receiving_tds.sum()/n,
                'tgt_pg': dp.targets.sum()/n,
                'rush_yds_pg': dp.rushing_yards.sum()/n,
                'rush_td_pg': dp.rushing_tds.sum()/n,
                'carries_pg': dp.carries.sum()/n,
            }
        defense[tm]['pos'] = pos_allowed

    # league avg of pos allowed, pos factors and ranks
    lg_pos = {}
    for pos in SKILL:
        lg_pos[pos] = {k: float(np.mean([defense[tm]['pos'][pos][k] for tm in defense])) for k in defense['ARI']['pos'][pos]}
    for tm in defense:
        n = defense[tm]['allowed']['g']
        defense[tm]['pos_factors'] = {pos: shrink(defense[tm]['pos'][pos]['ppr_pg']/lg_pos[pos]['ppr_pg'], n) for pos in SKILL}
        # TE / WR specific receiving yardage factors (shrunk)
        defense[tm]['pos_yds_factors'] = {pos: shrink(defense[tm]['pos'][pos]['rec_yds_pg']/max(lg_pos[pos]['rec_yds_pg'],1e-6), n) for pos in ['RB','WR','TE']}

    # ranks: 1 = stingiest (fewest allowed) for "allowed" metrics; for sacks/int, 1 = most generated
    def rank_dict(getter, reverse=False):
        vals = {tm: getter(tm) for tm in defense}
        order = sorted(vals, key=lambda tm: vals[tm], reverse=reverse)
        return {tm: i+1 for i, tm in enumerate(order)}
    ranks = {
        'pts': rank_dict(lambda tm: defense[tm]['allowed']['pts_pg']),
        'pass_yds': rank_dict(lambda tm: defense[tm]['allowed']['pass_yds_pg']),
        'ypa': rank_dict(lambda tm: defense[tm]['allowed']['ypa']),
        'pass_td': rank_dict(lambda tm: defense[tm]['allowed']['pass_td_pg']),
        'rush_yds': rank_dict(lambda tm: defense[tm]['allowed']['rush_yds_pg']),
        'ypc': rank_dict(lambda tm: defense[tm]['allowed']['ypc']),
        'rush_td': rank_dict(lambda tm: defense[tm]['allowed']['rush_td_pg']),
        'sacks': rank_dict(lambda tm: defense[tm]['allowed']['sacks_pg'], reverse=True),
        'int': rank_dict(lambda tm: defense[tm]['allowed']['int_pg'], reverse=True),
    }
    for pos in SKILL:
        ranks['fp_'+pos] = rank_dict(lambda tm, pos=pos: defense[tm]['pos'][pos]['ppr_pg'])
    for pos in ['RB','WR','TE']:
        ranks['rec_yds_'+pos] = rank_dict(lambda tm, pos=pos: defense[tm]['pos'][pos]['rec_yds_pg'])
    for tm in defense:
        defense[tm]['ranks'] = {k: v[tm] for k, v in ranks.items()}

    # ---------------- Schedule ----------------
    schedule = {}
    for wk, d in g.groupby('week'):
        games = []
        for _, row in d.iterrows():
            games.append({'home': row.home_team, 'away': row.away_team, 'date': row.gameday, 'day': row.weekday,
                          'time': row.gametime, 'home_score': r(row.home_score, 0), 'away_score': r(row.away_score, 0),
                          'id': row.game_id, 'stadium_id': str(row.stadium_id) if isinstance(row.stadium_id, str) else None,
                          'stadium': str(row.stadium) if isinstance(row.stadium, str) else None,
                          'roof': str(row.roof) if isinstance(row.roof, str) else None,
                          'spread_line': r(row.spread_line, 1) if 'spread_line' in row and row.spread_line == row.spread_line else None,
                          'total_line': r(row.total_line, 1) if 'total_line' in row and row.total_line == row.total_line else None})
        schedule[int(wk)] = games

    # ---------------- Injuries (latest week reported) ----------------
    inj = inj[inj.season == SEASON]
    latest_inj_week = int(inj.week.max())
    inj_latest = inj[inj.week == latest_inj_week]
    inj_map = {}
    for _, row in inj_latest.iterrows():
        inj_map[row.gsis_id] = {'week': latest_inj_week, 'status': row.report_status if isinstance(row.report_status, str) else None,
                                'injury': row.report_primary_injury if isinstance(row.report_primary_injury, str) else None,
                                'practice': row.practice_status if isinstance(row.practice_status, str) else None}

    # ---------------- Players ----------------
    DECAY = 0.7   # recency weight per week back
    PRIOR_CV = {'QB': 0.38, 'RB': 0.50, 'WR': 0.58, 'TE': 0.65}
    PRIOR_N = 4

    sp = p[p.position.isin(SKILL)].copy()
    players = []
    for pid, d in sp.groupby('player_id'):
        d = d.sort_values('week')
        last = d.iloc[-1]
        pos = last.position
        G = len(d)
        w = np.array([DECAY ** (CUR_WEEK - wk) for wk in d.week])
        def wm(col):
            return float(np.sum(w * d[col].values) / np.sum(w))
        def tot(col): return float(d[col].sum())
        def pg(col): return float(d[col].sum() / G)
        # totals
        att, cmp_, pyd, ptd, pint = tot('attempts'), tot('completions'), tot('passing_yards'), tot('passing_tds'), tot('passing_interceptions')
        car, ryd, rtd = tot('carries'), tot('rushing_yards'), tot('rushing_tds')
        tgt, rec, recyd, rectd = tot('targets'), tot('receptions'), tot('receiving_yards'), tot('receiving_tds')
        airy = tot('receiving_air_yards')
        fum = tot('rushing_fumbles_lost') + tot('receiving_fumbles_lost') + tot('sack_fumbles_lost')
        two = tot('passing_2pt_conversions') + tot('rushing_2pt_conversions') + tot('receiving_2pt_conversions')
        # exclude players with trivial usage
        if pos == 'QB' and att < 20 and car < 10: continue
        if pos != 'QB' and (tgt + car) < 6: continue

        fp_ppr = d.fantasy_points_ppr.values.astype(float)
        cv_p = (np.std(fp_ppr, ddof=1) / np.mean(fp_ppr)) if (G > 1 and np.mean(fp_ppr) > 0) else PRIOR_CV[pos]
        cv_p = min(max(cv_p, 0.15), 1.5)
        cv = math.sqrt((G * cv_p**2 + PRIOR_N * PRIOR_CV[pos]**2) / (G + PRIOR_N))

        log = []
        for _, row in d.iterrows():
            log.append({'wk': int(row.week), 'opp': row.opponent_team,
                        'pa': int(row.attempts), 'pc': int(row.completions), 'py': int(row.passing_yards), 'ptd': int(row.passing_tds), 'int': int(row.passing_interceptions),
                        'ca': int(row.carries), 'ry': int(row.rushing_yards), 'rtd': int(row.rushing_tds),
                        'tg': int(row.targets), 'rc': int(row.receptions), 'rcy': int(row.receiving_yards), 'rctd': int(row.receiving_tds),
                        'ts': r(row.target_share, 3), 'fl': int(row.rushing_fumbles_lost + row.receiving_fumbles_lost + row.sack_fumbles_lost),
                        'ppr': r(row.fantasy_points_ppr, 1), 'std': r(row.fantasy_points, 1)})

        players.append({
            'id': pid, 'name': last.player_display_name, 'pos': pos, 'team': last.team,
            'headshot': last.headshot_url if isinstance(last.headshot_url, str) else None,
            'g': G, 'last_wk': int(last.week),
            'cv': r(cv, 3),
            'ppr_pg': r(pg('fantasy_points_ppr'), 2), 'std_pg': r(pg('fantasy_points'), 2),
            # recency-weighted volume per game
            'w': {
                'pa': r(wm('attempts'), 2), 'py': r(wm('passing_yards'), 1), 'ptd': r(wm('passing_tds'), 3), 'int': r(wm('passing_interceptions'), 3),
                'ca': r(wm('carries'), 2), 'ry': r(wm('rushing_yards'), 1), 'rtd': r(wm('rushing_tds'), 3),
                'tg': r(wm('targets'), 2), 'rc': r(wm('receptions'), 2), 'rcy': r(wm('receiving_yards'), 1), 'rctd': r(wm('receiving_tds'), 3),
                'ts': r(wm('target_share'), 3) if d.target_share.notna().any() else None,
            },
            # season totals for efficiency
            't': {'pa': att, 'pc': cmp_, 'py': pyd, 'ptd': ptd, 'int': pint, 'ca': car, 'ry': ryd, 'rtd': rtd,
                  'tg': tgt, 'rc': rec, 'rcy': recyd, 'rctd': rectd, 'airy': airy, 'fl': fum, 'two': two,
                  'yac': tot('receiving_yards_after_catch'), 'pay': tot('passing_air_yards'), 'sk': tot('sacks_suffered'),
                  'r10': tot('rushing_10'), 'rc20': tot('receiving_20'), 'ays': r(d.air_yards_share.mean(), 3) if d.air_yards_share.notna().any() else None,
                  'wopr': r(d.wopr.mean(), 3) if d.wopr.notna().any() else None, 'cpoe': r(d.passing_cpoe.mean(), 2) if d.passing_cpoe.notna().any() else None},
            'inj': inj_map.get(pid),
            'log': log,
        })


    # ---------------- Platform ID mapping (Sleeper / ESPN / Yahoo) ----------------
    sl = json.load(open(D + 'sleeper_players.json')) if os.path.exists(D + 'sleeper_players.json') else {}
    ids_by_gsis = {}
    for sid, sp_ in sl.items():
        gs = sp_.get('gsis_id')
        if gs and isinstance(gs, str) and gs.strip():
            ids_by_gsis[gs.strip()] = {'sl': sid, 'espn': sp_.get('espn_id'), 'yahoo': sp_.get('yahoo_id'),
                                        'inj': sp_.get('injury_status'), 'injb': sp_.get('injury_body_part'),
                                        'exp': sp_.get('years_exp')}
    pfr_to_gsis = {}
    try:
        dbi = pd.read_csv(D + 'db_playerids.csv', dtype=str)
        for _, row in dbi[dbi.gsis_id.notna()].iterrows():
            e = ids_by_gsis.setdefault(row.gsis_id, {})
            if not e.get('sl') and isinstance(row.sleeper_id, str): e['sl'] = row.sleeper_id
            if not e.get('espn') and isinstance(row.espn_id, str): e['espn'] = row.espn_id
            if not e.get('yahoo') and isinstance(row.yahoo_id, str): e['yahoo'] = row.yahoo_id
            if isinstance(row.pfr_id, str) and row.pfr_id:
                pfr_to_gsis[row.pfr_id] = row.gsis_id
    except Exception as ex:
        print('db_playerids unavailable', ex)
    def _s(v):
        if v is None: return None
        try:
            if isinstance(v, float) and math.isnan(v): return None
            return str(int(float(v)))
        except Exception: return str(v)
    for pl in players:
        e = ids_by_gsis.get(pl['id'], {})
        pl['ids'] = {'sl': _s(e.get('sl')), 'espn': _s(e.get('espn')), 'yahoo': _s(e.get('yahoo'))}
        if e.get('inj'): pl['sl_inj'] = {'status': e.get('inj'), 'body': e.get('injb')}
        # years_exp 0 is a rookie. Missing experience is left unset.
        if e.get('exp') == 0 or e.get('exp') == '0': pl['rookie'] = 1
    # Fill a missing Sleeper id from the ESPN id already on the crosswalk.
    # Matching on the display name collides when two players share it.
    by_espn = {}
    for pl in players:
        eid = pl['ids'].get('espn')
        if eid:
            by_espn.setdefault(eid, []).append(pl)
    for sid, sp_ in sl.items():
        eid = _s(sp_.get('espn_id'))
        cands = by_espn.get(eid) if eid else None
        if cands and len(cands) == 1 and not cands[0]['ids'].get('sl'):
            cands[0]['ids']['sl'] = _s(sid)
    # Sleeper players without stats in our data (K, DEF, rookies, injured) so rosters can still be displayed
    have = {pl['ids']['sl'] for pl in players if pl['ids']['sl']}
    sl_extra = {}
    for sid, sp_ in sl.items():
        fps = [x for x in (sp_.get('fantasy_positions') or []) if x in ('QB', 'RB', 'WR', 'TE', 'K', 'DEF')]
        pos = sp_.get('position') if sp_.get('position') in ('QB', 'RB', 'WR', 'TE', 'K', 'DEF') else (fps[0] if fps else None)
        if sid in have or not pos: continue
        if pos != 'DEF' and not sp_.get('team'): continue
        name = sp_.get('full_name') or (str(sp_.get('first_name', '')) + ' ' + str(sp_.get('last_name', ''))).strip()
        sl_extra[sid] = [name, pos, sp_.get('team')] + ([sp_.get('injury_status')] if sp_.get('injury_status') else [])

    # clean defense for JSON
    def clean(o):
        if isinstance(o, dict): return {k: clean(v) for k, v in o.items()}
        if isinstance(o, (list, tuple)): return [clean(v) for v in o]
        if isinstance(o, (np.floating, float)): return r(o, 4)
        if isinstance(o, (np.integer,)): return int(o)
        return o

    snaps = None
    snap_path = D + 'snaps_2026.csv'
    if os.path.exists(snap_path) and os.path.getsize(snap_path) > 0:
        try:
            snaps = pd.read_csv(snap_path, low_memory=False)
        except Exception as ex:
            print('snaps unavailable', ex)
    print('snap implied', attach_snap_share(players, snaps, pfr_to_gsis, CUR_WEEK, DECAY))
    priors = prior_profiles(SEASON - 1, D, pfr_to_gsis)
    n_prior = 0
    for pl in players:
        prof = priors.get(pl['id'])
        if prof:
            pl['prior'] = prof
            n_prior += 1
    if priors:
        print('prior profiles', n_prior, 'wrote', write_priors_js(priors, SEASON, SEASON - 1))
    else:
        print('prior profiles', 0)
    roles = build_roles(g, pd.read_csv(D + 'injuries_2026.csv'), D + 'depth_2026.csv', SEASON)
    print('role weeks', len(roles))
    adv, team_ctx, avail = build_advanced.build(CUR_WEEK, players, season=SEASON)
    for pl in players:
        pl['adv'] = adv.get(pl['id'])
    print('adv players', sum(1 for pl in players if pl.get('adv')), 'avail', avail)
    def_avail = {}
    try:
        import build_defense
        def_avail = build_defense.build_week_availability(D, SEASON, NEXT_WEEK)
        print('defense availability weeks', len(def_avail))
    except Exception as ex:
        print('defense availability unavailable', ex)
    out = {
        'meta': {'season': SEASON, 'last_completed_week': CUR_WEEK, 'next_week': NEXT_WEEK,
                 'generated': pd.Timestamp.now('UTC').strftime('%Y-%m-%d %H:%M UTC'), 'injury_week': latest_inj_week,
                 'source': 'nflverse (stats_player_week, stats_team_week, games, injuries, depth_charts)'},
        'league': clean(lg), 'league_pos': clean(lg_pos),
        'team_names': TEAM_NAMES, 'team_off': clean(team_off), 'defense': clean(defense),
        'schedule': schedule, 'players': clean(players), 'sl_extra': sl_extra, 'roles': roles,
        'team_ctx': clean(team_ctx), 'avail': avail, 'def_avail': def_avail,
    }
    with open('site/data.json', 'w') as f:
        json.dump(out, f, separators=(',', ':'))
    print('players', len(players), 'weeks', CUR_WEEK, 'next', NEXT_WEEK, 'size', round(len(json.dumps(out))/1e6, 2), 'MB')


if __name__ == '__main__':
    main()
