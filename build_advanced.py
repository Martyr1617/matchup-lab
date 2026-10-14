"""Advanced opportunity / efficiency / context layers for Matchup Lab.

Sources (all nflverse/ffverse public releases):
  play_by_play_2026   -> red-zone shares, opportunity share, designed QB runs vs scrambles, EPA, CPOE, neutral pass rate, PROE, pace
  snap_counts_2026    -> offensive snap share (route-participation proxy; true routes are not public)
  ngs_*               -> time to throw, CPOE (NGS), rush yards over expected
  pfr_advstats_*      -> pressure rate allowed / generated, broken tackles (missed-tackles-forced proxy)
  ffopportunity ep    -> expected fantasy points (xFP) and fantasy points over expected (FPOE)
Every metric that can't be computed is returned as None and the UI labels it "Unavailable".
"""
import math, os
import numpy as np
import pandas as pd

D = 'data/'


def _r(x, n=3):
    try:
        if x is None: return None
        x = float(x)
        if math.isnan(x) or math.isinf(x): return None
        return round(x, n)
    except Exception:
        return None


def _read(path, data_dir=D, **kw):
    try:
        full = os.path.join(data_dir, path)
        if os.path.exists(full): return pd.read_csv(full, low_memory=False, **kw)
    except Exception as e:
        print('could not read', path, e)
    return None


def estimate_dropbacks(df):
    """Dropbacks implied by times pressured divided by the pressure rate.

    A zero pressure rate is a real game with zero pressures, not a missing
    game. Dropping those rows (the old `pct > 0` mask) made the rate too high.
    When the pressure rate is zero, recover that game's dropbacks from the
    bad-throw rate or the drop rate, plus sacks. A row with no recoverable
    count stays out: inventing another game's volume would bias the rate down.
    """
    tp = pd.to_numeric(df['times_pressured'], errors='coerce')
    pct = pd.to_numeric(df['times_pressured_pct'], errors='coerce')
    est = pd.Series(np.where(pct > 0, tp / pct, np.nan), index=df.index)
    sacks = pd.to_numeric(df['times_sacked'], errors='coerce').fillna(0) if 'times_sacked' in df.columns else 0
    for count_col, rate_col in (('passing_bad_throws', 'passing_bad_throw_pct'),
                                ('passing_drops', 'passing_drop_pct')):
        if count_col not in df.columns or rate_col not in df.columns:
            continue
        count = pd.to_numeric(df[count_col], errors='coerce')
        rate = pd.to_numeric(df[rate_col], errors='coerce')
        alt = count / rate + sacks
        zero = pct.eq(0) & est.isna() & rate.gt(0)
        est = est.mask(zero, alt)
    return est


def _wavg(frame, col, weight):
    if col not in frame.columns or weight not in frame.columns:
        return None
    w = pd.to_numeric(frame[weight], errors='coerce').fillna(0)
    x = pd.to_numeric(frame[col], errors='coerce')
    ok = x.notna() & (w > 0)
    if not ok.any():
        return None
    return float((x[ok] * w[ok]).sum() / w[ok].sum())


def aggregate_ngs(weekly, kind):
    """Season-to-date stand-in when the week==0 row is absent. Rates are attempt-weighted."""
    rows = []
    for pid, g in weekly.groupby('player_gsis_id'):
        row = {'player_gsis_id': pid, 'week': 0}
        if kind == 'passing':
            row['avg_time_to_throw'] = _wavg(g, 'avg_time_to_throw', 'attempts')
            row['completion_percentage_above_expectation'] = _wavg(g, 'completion_percentage_above_expectation', 'attempts')
            row['aggressiveness'] = _wavg(g, 'aggressiveness', 'attempts')
        elif kind == 'rushing':
            if 'rush_yards_over_expected' in g.columns:
                row['rush_yards_over_expected'] = float(pd.to_numeric(g['rush_yards_over_expected'], errors='coerce').fillna(0).sum())
            row['rush_yards_over_expected_per_att'] = _wavg(g, 'rush_yards_over_expected_per_att', 'rush_attempts')
            row['percent_attempts_gte_eight_defenders'] = _wavg(g, 'percent_attempts_gte_eight_defenders', 'rush_attempts')
        else:
            weight = 'targets' if 'targets' in g.columns else 'receptions'
            row['avg_separation'] = _wavg(g, 'avg_separation', weight)
            row['avg_yac_above_expectation'] = _wavg(g, 'avg_yac_above_expectation', weight)
        rows.append(row)
    return pd.DataFrame(rows)


def ngs_season_to_date(df, kind, season, cur_week):
    """Use the week==0 season-to-date row. If it is missing, say so and aggregate weeks 1..cur_week."""
    scoped = df[(df.season == season) & (df.season_type == 'REG')]
    std = scoped[scoped.week == 0]
    if len(std):
        return std
    weekly = scoped[(scoped.week >= 1) & (scoped.week <= cur_week)]
    print(f'WARNING: NGS {kind} has no week==0 season-to-date rows for {season} REG; '
          f'aggregating {len(weekly)} weekly rows through week {cur_week}')
    if not len(weekly):
        return weekly
    return aggregate_ngs(weekly, kind)


def opportunity_rows(ep, season, cur_week):
    """ffopportunity rows for this regular season only."""
    e = ep
    if 'season' in e.columns:
        e = e[e.season == season]
    if 'season_type' in e.columns:
        e = e[e.season_type == 'REG']
    elif 'game_type' in e.columns:
        e = e[e.game_type == 'REG']
    else:
        # This release has no season-type column. Regular season is weeks 1-18.
        e = e[e.week.between(1, 18)]
    return e[e.week <= cur_week]


def build(cur_week, players, db_ids_path=None, data_dir=D, season=2026):
    if db_ids_path is None:
        db_ids_path = os.path.join(data_dir, 'db_playerids.csv')
    read = lambda name, **kw: _read(name, data_dir, **kw)
    adv, team_ctx, avail = {}, {}, {}
    pbp = read('pbp_2026.csv.gz')
    snaps = read('snaps_2026.csv')
    ep = read('ep_2026.csv')
    pfr_pass = read('pfr_pass_2026.csv'); pfr_rush = read('pfr_rush_2026.csv'); pfr_rec = read('pfr_rec_2026.csv')
    ngs = {k: read(f'ngs_{k}.csv.gz') for k in ('passing', 'rushing', 'receiving')}
    try:
        ids = pd.read_csv(db_ids_path, dtype=str)
        pfr2gsis = dict(zip(ids.pfr_id, ids.gsis_id))
    except Exception:
        pfr2gsis = {}
    pid_set = {p['id'] for p in players}
    team_of = {p['id']: p['team'] for p in players}
    A = lambda pid: adv.setdefault(pid, {})

    # ---------------- Play-by-play ----------------
    if pbp is not None:
        avail['pbp'] = True
        pbp = pbp[(pbp.season_type == 'REG') & (pbp.week <= cur_week)]
        plays = pbp[pbp.play_type.isin(['pass', 'run']) & (pbp.two_point_attempt.fillna(0) != 1)].copy()
        if 'aborted_play' in plays.columns:
            # Aborted snaps are coded as runs. They are not designed carries.
            plays = plays[plays.aborted_play.fillna(0) != 1]
        plays['is_db'] = plays.qb_dropback.fillna(0) == 1
        plays['is_rush'] = plays.play_type == 'run'
        plays['kneel'] = plays.qb_kneel.fillna(0) == 1
        plays['is_scramble'] = plays.qb_scramble.fillna(0) == 1
        # team totals. Targets are thrown passes with an intended receiver.
        # Carry denominators are designed rushes: kneels and scrambles are separate.
        tm_g = plays.groupby('posteam').game_id.nunique()
        thrown = plays.pass_attempt.fillna(0).eq(1) if 'pass_attempt' in plays.columns else plays.play_type.eq('pass')
        tgt_plays = plays[thrown & plays.receiver_player_id.notna()]
        rush_plays = plays[plays.is_rush & plays.rusher_player_id.notna() & ~plays.kneel]
        car_plays = rush_plays[~rush_plays.is_scramble]
        team_tgt = tgt_plays.groupby('posteam').size(); team_car = car_plays.groupby('posteam').size()
        team_rz20 = tgt_plays[tgt_plays.yardline_100 <= 20].groupby('posteam').size().add(car_plays[car_plays.yardline_100 <= 20].groupby('posteam').size(), fill_value=0)
        team_rz10 = tgt_plays[tgt_plays.yardline_100 <= 10].groupby('posteam').size().add(car_plays[car_plays.yardline_100 <= 10].groupby('posteam').size(), fill_value=0)
        team_db = plays[plays.is_db].groupby('posteam').size()
        team_ay = tgt_plays.groupby('posteam').air_yards.sum()

        # player opportunity in team context (player's team = posteam on those plays)
        def by_player(df, col):
            return df.groupby([col, 'posteam'])
        for (pid, tm), d in by_player(tgt_plays, 'receiver_player_id'):
            if pid not in pid_set: continue
            a = A(pid); a.setdefault('_t', {}).setdefault(tm, {})
            a['_t'][tm].update({'tgt': len(d), 'ay': float(d.air_yards.fillna(0).sum()), 'rz20_t': int((d.yardline_100 <= 20).sum()),
                                'rz10_t': int((d.yardline_100 <= 10).sum()), 'epa_t': float(d.epa.sum()), 'n_t': len(d)})
        for (pid, tm), d in by_player(rush_plays, 'rusher_player_id'):
            if pid not in pid_set: continue
            a = A(pid); a.setdefault('_t', {}).setdefault(tm, {})
            sc = d.is_scramble
            a['_t'][tm].update({'car': int((~sc).sum()), 'scr': int(sc.sum()), 'rz20_c': int(((d.yardline_100 <= 20) & ~sc).sum()),
                                'rz10_c': int(((d.yardline_100 <= 10) & ~sc).sum()), 'epa_r': float(d[~sc].epa.sum()), 'n_r': int((~sc).sum())})
        # QB dropback EPA + CPOE.
        # A scramble is a dropback. nflverse often leaves passer_player_id empty on
        # those rows and records the quarterback only as the rusher, so the scramble
        # still counts. `&` binds tighter than `|`; the parentheses keep a scramble
        # from also having to carry a passer id.
        dbp = plays.loc[plays.is_db & (plays.passer_player_id.notna() | plays.is_scramble)].copy()
        dbp['qb'] = dbp.passer_player_id.fillna(dbp.rusher_player_id)
        for pid, d in dbp.groupby('qb'):
            if pid not in pid_set: continue
            a = A(pid)
            a['epa_db'] = _r(d.qb_epa.mean(), 3); a['n_db'] = len(d)
            a['cpoe'] = _r(d.cpoe.mean(), 1)
            tm = team_of.get(pid)
            a['sack_hit_rate'] = _r(((d.sack == 1) | (d.qb_hit == 1)).mean(), 3)
        for pid, a in adv.items():
            tms = a.pop('_t', {})
            tm = team_of.get(pid)
            agg = {}
            for tmk, v in tms.items():
                for k, x in v.items(): agg[k] = agg.get(k, 0) + x
            tteams = list(tms.keys())
            T_tgt = sum(team_tgt.get(x, 0) for x in tteams); T_car = sum(team_car.get(x, 0) for x in tteams)
            T_rz20 = sum(team_rz20.get(x, 0) for x in tteams); T_rz10 = sum(team_rz10.get(x, 0) for x in tteams)
            T_ay = sum(team_ay.get(x, 0) for x in tteams)
            tg, car = agg.get('tgt', 0), agg.get('car', 0)
            if T_tgt: a['tgt_share'] = _r(tg / T_tgt)
            if T_ay and tg: a['ay_share'] = _r(agg.get('ay', 0) / T_ay)
            if a.get('tgt_share') is not None and a.get('ay_share') is not None: a['wopr'] = _r(1.5 * a['tgt_share'] + 0.7 * a['ay_share'])
            if T_tgt + T_car: a['opp_share'] = _r((tg + car) / (T_tgt + T_car))
            if T_rz20: a['rz20_share'] = _r((agg.get('rz20_t', 0) + agg.get('rz20_c', 0)) / T_rz20)
            if T_rz10: a['rz10_share'] = _r((agg.get('rz10_t', 0) + agg.get('rz10_c', 0)) / T_rz10)
            a['rz20_opps'] = int(agg.get('rz20_t', 0) + agg.get('rz20_c', 0)); a['rz10_opps'] = int(agg.get('rz10_t', 0) + agg.get('rz10_c', 0))
            if agg.get('n_t'): a['epa_tgt'] = _r(agg['epa_t'] / agg['n_t'])
            if agg.get('n_r'): a['epa_rush'] = _r(agg['epa_r'] / agg['n_r'])
            a['_team_db'] = int(sum(team_db.get(x, 0) for x in tteams))
            a['_tg'] = tg
            # QB designed run rate (designed runs / (dropbacks + designed runs)), scrambles separate
            if agg.get('car', 0) + agg.get('scr', 0) and a.get('n_db'):
                g = max(1, sum(tm_g.get(x, 0) for x in tteams))
                a['designed_runs_pg'] = _r(agg.get('car', 0) / g, 2)
                a['scrambles_pg'] = _r(agg.get('scr', 0) / g, 2)
                a['designed_run_rate'] = _r(agg.get('car', 0) / (a['n_db'] + agg.get('car', 0)))

        # Team context: neutral pass rate, PROE, pace, plays/game
        neutral = plays[(plays.wp.between(0.2, 0.8)) & (plays.down <= 3) & (plays.half_seconds_remaining > 120) & ~plays.kneel]
        for tm, d in plays.groupby('posteam'):
            n = neutral[neutral.posteam == tm]
            g = tm_g.get(tm, 1)
            ctx = {'plays_pg': _r(len(d) / g, 1), 'neutral_pass_rate': _r(n.is_db.mean(), 3) if len(n) else None,
                   'proe': _r(n.pass_oe.mean(), 1) if len(n) else None, 'db_pg': _r(d.is_db.sum() / g, 1)}
            # neutral pace: seconds between consecutive offensive snaps within a drive
            dd = n.sort_values(['game_id', 'play_id'])
            gaps = -dd.groupby(['game_id', 'drive']).game_seconds_remaining.diff()
            gaps = gaps[(gaps > 0) & (gaps < 60)]
            ctx['sec_per_play'] = _r(gaps.mean(), 1) if len(gaps) else None
            team_ctx[tm] = ctx
        # rank pace (1 = fastest) and neutral pass rate (1 = most pass-heavy)
        def rank(key, reverse):
            vals = [(tm, c[key]) for tm, c in team_ctx.items() if c.get(key) is not None]
            for i, (tm, _) in enumerate(sorted(vals, key=lambda x: x[1], reverse=reverse)): team_ctx[tm][key + '_rk'] = i + 1
        rank('sec_per_play', False); rank('neutral_pass_rate', True); rank('plays_pg', True)
    else:
        avail['pbp'] = False

    # ---------------- Snap share (route-participation proxy) + estimated TPRR / YPRR ----------------
    if snaps is not None:
        avail['snaps'] = True
        s = snaps[(snaps.game_type == 'REG') & (snaps.week <= cur_week)].copy()
        s['gsis'] = s.pfr_player_id.map(pfr2gsis)
        s = s[s.gsis.isin(pid_set)]
        for gs, d in s.groupby('gsis'):
            d = d.sort_values('week')
            a = A(gs)
            a['snap_pct'] = _r(d.offense_pct.mean(), 3)
            a['snap_pct_l2'] = _r(d.offense_pct.tail(2).mean(), 3)
            a['snaps'] = int(d.offense_snaps.sum())
            # Estimated routes = team dropbacks x snap share (no public route data)
            if a.get('_team_db'):
                routes = a['_team_db'] * float(d.offense_pct.mean())
                a['routes_est'] = _r(routes, 0)
        # yards for YPRR from players list
        rec_yds = {p['id']: p['t']['rcy'] for p in players}
        for pid, a in adv.items():
            if a.get('routes_est'):
                if a.get('_tg') is not None: a['tprr'] = _r(a['_tg'] / a['routes_est'])
                a['yprr'] = _r(rec_yds.get(pid, 0) / a['routes_est'], 2)
    else:
        avail['snaps'] = False

    # ---------------- Next Gen Stats ----------------
    for k, df in ngs.items():
        if df is None: avail['ngs_' + k] = False; continue
        df = ngs_season_to_date(df, k, season, cur_week)  # week 0 = season-to-date; weeks are aggregated only if it is missing
        avail['ngs_' + k] = len(df) > 0
        if not len(df):
            continue
        for _, row in df.iterrows():
            pid = row.player_gsis_id
            if pid not in pid_set: continue
            a = A(pid)
            if k == 'passing':
                a['ttt'] = _r(row.avg_time_to_throw, 2); a['ngs_cpoe'] = _r(row.completion_percentage_above_expectation, 1)
                a['aggr'] = _r(row.aggressiveness, 1)
            elif k == 'rushing':
                a['ryoe_att'] = _r(row.rush_yards_over_expected_per_att, 2); a['ryoe'] = _r(row.rush_yards_over_expected, 0)
                a['box8'] = _r(row.percent_attempts_gte_eight_defenders, 1)
            else:
                a['sep'] = _r(row.avg_separation, 2); a['yac_oe'] = _r(row.avg_yac_above_expectation, 2)

    # ---------------- PFR: pressure, broken tackles ----------------
    if pfr_pass is not None:
        avail['pressure'] = True
        pp = pfr_pass[(pfr_pass.game_type == 'REG') & (pfr_pass.week <= cur_week)].copy()
        pp['_db'] = estimate_dropbacks(pp)
        def _prate(d):
            tot_db = d['_db'].sum(min_count=1)
            if tot_db is None or not np.isfinite(tot_db) or tot_db <= 0:
                return None
            return _r(pd.to_numeric(d.times_pressured, errors='coerce').sum() / tot_db, 3)
        for tm, d in pp.groupby('team'):
            team_ctx.setdefault(tm, {})['pressure_allowed'] = _prate(d)
        for tm, d in pp.groupby('opponent'):
            team_ctx.setdefault(tm, {})['pressure_generated'] = _prate(d)
        for key, rev in (('pressure_allowed', False), ('pressure_generated', True)):
            vals = [(tm, c[key]) for tm, c in team_ctx.items() if c.get(key) is not None]
            for i, (tm, _) in enumerate(sorted(vals, key=lambda x: x[1], reverse=rev)): team_ctx[tm][key + '_rk'] = i + 1
        for pfr, d in pp.groupby('pfr_player_id'):
            gs = pfr2gsis.get(pfr)
            if gs in pid_set:
                rate = _prate(d)
                if rate is not None:
                    A(gs)['pressured_rate'] = rate
    else:
        avail['pressure'] = False
    if pfr_rush is not None or pfr_rec is not None:
        avail['broken_tackles'] = True
        bt = {}
        for df, col in ((pfr_rush, 'rushing_broken_tackles'), (pfr_rec, 'receiving_broken_tackles')):
            if df is None: continue
            df = df[(df.game_type == 'REG') & (df.week <= cur_week)]
            for pfr, v in df.groupby('pfr_player_id')[col].sum().items():
                gs = pfr2gsis.get(pfr)
                if gs in pid_set and not (isinstance(v, float) and math.isnan(v)): bt[gs] = bt.get(gs, 0) + float(v)
        touches = {p['id']: p['t']['ca'] + p['t']['rc'] for p in players}
        for gs, v in bt.items():
            if touches.get(gs): A(gs)['bt_per_touch'] = _r(v / touches[gs])
    else:
        avail['broken_tackles'] = False

    # ---------------- Expected fantasy points (ffopportunity) ----------------
    if ep is not None:
        avail['xfp'] = True
        e = opportunity_rows(ep, season, cur_week)
        for pid, d in e.groupby('player_id'):
            if pid not in pid_set: continue
            g = d.game_id.nunique()
            a = A(pid)
            a['xfp_pg'] = _r(d.total_fantasy_points_exp.sum() / g, 2)       # PPR expected
            a['fp_pg_ep'] = _r(d.total_fantasy_points.sum() / g, 2)
            a['fpoe_pg'] = _r((d.total_fantasy_points.sum() - d.total_fantasy_points_exp.sum()) / g, 2)
            a['xtd_pg'] = _r((d.rush_touchdown_exp.sum() + d.rec_touchdown_exp.sum()) / g, 3)
            a['xptd_pg'] = _r(d.pass_touchdown_exp.sum() / g, 3)
            l3 = d.sort_values('week').tail(3)
            a['xfp_l3'] = _r(l3.total_fantasy_points_exp.mean(), 2)
            a['fpoe_l3'] = _r((l3.total_fantasy_points - l3.total_fantasy_points_exp).mean(), 2)
    else:
        avail['xfp'] = False

    for a in adv.values():
        for k in [k for k in a if k.startswith('_')]: a.pop(k)
    return adv, team_ctx, avail
