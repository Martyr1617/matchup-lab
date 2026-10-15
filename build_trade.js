/* Sum the weekly model into trade values and write them onto site/data.json.
   Run from refresh.sh after the projection file exists. A failure must not
   be required for projections to publish: refresh.sh treats a non-zero exit
   as a warning. */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { project, SCORING } = require('./site/model');
const { attachTrade, backtest, ageFromBirth } = require('./site/trade');

const TEAM = { LAR: 'LA', OAK: 'LV', WSH: 'WAS', JAC: 'JAX' };
function normTeam(t) { return TEAM[t] || t || ''; }
function gsisOf(sp) { return String((sp && sp.gsis_id) || '').trim(); }

function loadAges(season) {
  const file = path.join(__dirname, 'data', 'sleeper_players.json');
  const ages = {};
  if (!fs.existsSync(file)) return ages;
  let sl;
  try { sl = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return ages; }
  for (const [sid, sp] of Object.entries(sl)) {
    if (!sp) continue;
    const age = ageFromBirth(sp.birth_date, season);
    if (!age) continue;
    ages[sid] = age;
    const gs = gsisOf(sp);
    if (gs) ages[gs] = age;
  }
  return ages;
}

function loadSleeper() {
  const file = path.join(__dirname, 'data', 'sleeper_players.json');
  if (!fs.existsSync(file)) return {};
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return {}; }
}

function loadBaselines(season) {
  const py = `
import json, os
try:
    import pandas as pd
except Exception:
    print('{}')
    raise SystemExit
root = ${JSON.stringify(path.join(__dirname, 'data'))}
season = ${Number(season) || 2026}
frames = []
for name in ('player_stats.csv', 'players_2025.csv'):
    path = os.path.join(root, name)
    if os.path.exists(path) and os.path.getsize(path) > 0:
        frames.append(pd.read_csv(path, usecols=lambda c: c in {
            'player_id','season','season_type','week','fantasy_points','fantasy_points_ppr','receptions'
        }))
if not frames:
    print('{}')
    raise SystemExit
df = pd.concat(frames, ignore_index=True)
df = df[df.season_type.fillna('REG').astype(str).str.upper().str.startswith('REG')]
df = df[df.season < season]
df = df[df.player_id.notna()]
out = {}
for pid, d in df.groupby('player_id'):
    seasons = []
    for yr, g in d.groupby('season'):
        n = int(g.week.nunique()) if 'week' in g else len(g)
        if n < 1: continue
        ppr = float(g.fantasy_points_ppr.sum())
        std = float(g.fantasy_points.sum())
        rc = float(g.receptions.sum()) if 'receptions' in g else 0
        seasons.append((int(yr), n, ppr, std, rc))
    if not seasons: continue
    seasons.sort()
    def wavg(pick):
        num = den = 0
        for yr, n, ppr, std, rc in seasons:
            w = n * (0.72 ** (season - 1 - yr))
            num += w * pick(n, ppr, std, rc)
            den += w
        return num / den if den else 0
    career = (wavg(lambda n,ppr,std,rc: ppr/n), wavg(lambda n,ppr,std,rc: std/n + 0.5*rc/n), wavg(lambda n,ppr,std,rc: std/n))
    prior = [s for s in seasons if s[1] >= 6]
    window = [s for s in seasons if s[0] >= season - 3 and s[1] >= 8]
    pick = max(window, key=lambda s: s[2] / s[1]) if window else (prior[-1] if prior else None)
    if pick:
        ppr = round(0.8 * (pick[2] / pick[1]) + 0.2 * career[0], 2)
        std = round(0.8 * (pick[3] / pick[1]) + 0.2 * career[2], 2)
        half = round(0.8 * (pick[3] / pick[1] + 0.5 * pick[4] / pick[1]) + 0.2 * career[1], 2)
        year = int(pick[0])
    else:
        ppr, half, std = round(career[0], 2), round(career[1], 2), round(career[2], 2)
        year = int(seasons[-1][0])
    if max(ppr, half, std) <= 0: continue
    out[str(pid).strip()] = {'ppr': ppr, 'half': half, 'std': std, 'year': year}
recent = {}
week_path = os.path.join(root, 'players_2026.csv')
if os.path.exists(week_path):
    wk = pd.read_csv(week_path, usecols=['player_id', 'week'])
    for pid, g in wk.groupby('player_id'):
        recent[str(pid).strip()] = {'last': int(g.week.max()), 'g': int(g.week.nunique())}
print(json.dumps({'rates': out, 'recent': recent}))
`;
  try {
    const raw = execFileSync('python3', ['-c', py], { maxBuffer: 64 * 1024 * 1024, encoding: 'utf8' });
    const parsed = JSON.parse(raw.slice(raw.indexOf('{')));
    const rates = parsed.rates || parsed;
    console.log('baselines', Object.keys(rates).length, 'recent', Object.keys(parsed.recent || {}).length);
    return { rates, recent: parsed.recent || {} };
  } catch (e) {
    console.log('WARN baselines unavailable', e.message.split('\n')[0]);
    return {};
  }
}

function foldName(text) {
  return String(text || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[.'’`-]/g, ' ').replace(/\b(jr|sr|ii|iii|iv|v)\b/g, ' ')
    .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
    .replace(/\b([a-z]) (?=[a-z]\b)/g, '$1');
}

function loadNewsById(players) {
  const file = path.join(__dirname, 'site', 'news.json');
  const out = {};
  if (!fs.existsSync(file)) return out;
  let news;
  try { news = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return out; }
  const named = players.map(p => ({ id: p.id, fold: foldName(p.name) })).filter(p => p.fold.length > 5);
  named.sort((a, b) => b.fold.length - a.fold.length);
  for (const item of news.items || []) {
    const headline = item && item.headline;
    if (!headline) continue;
    if (item.player_id) (out[item.player_id] = out[item.player_id] || []).push(headline);
    const folded = foldName(headline);
    for (const p of named) {
      if (folded.includes(p.fold)) (out[p.id] = out[p.id] || []).push(headline);
    }
  }
  return out;
}

const SEVERITY = { questionable: 1, doubtful: 2, out: 3, ir: 4, pup: 4, suspended: 4 };
function severity(status) {
  const s = String(status || '').toLowerCase();
  if (/suspend/.test(s)) return 4;
  if (/\bir\b|injured reserve|\bpup\b/.test(s)) return 4;
  if (/\bout\b/.test(s)) return 3;
  if (/doubtful/.test(s)) return 2;
  if (/questionable|limited|\bdnp\b/.test(s)) return 1;
  return 0;
}

function overlayInjuries(data, sl) {
  const bySl = {};
  const byGsis = {};
  for (const [sid, sp] of Object.entries(sl)) {
    bySl[sid] = sp;
    const gs = gsisOf(sp);
    if (gs) byGsis[gs] = sp;
  }
  let n = 0;
  for (const pl of data.players) {
    const sp = (pl.ids && bySl[pl.ids.sl]) || byGsis[pl.id];
    if (!sp) continue;
    const status = sp.injury_status;
    const body = sp.injury_body_part;
    if (!status && !body) continue;
    const current = (pl.sl_inj && pl.sl_inj.status) || '';
    if (severity(status) > severity(current) || (body && /acl|achilles/i.test(body) && severity(current) < 4)) {
      pl.sl_inj = { status: status || (pl.sl_inj && pl.sl_inj.status) || 'IR', body: body || (pl.sl_inj && pl.sl_inj.body) || null };
      n += 1;
    }
  }
  console.log('injury overlay', n);
}

function findPlayer(players, sid, gsis, name) {
  return players.find(p => (p.ids && p.ids.sl === sid) || (gsis && p.id === gsis) || (name && p.name === name));
}

function addMissing(data, sl, baselines, recent) {
  const players = data.players;
  const haveSl = new Set(players.map(p => p.ids && p.ids.sl).filter(Boolean));
  const haveId = new Set(players.map(p => p.id));
  let added = 0;
  for (const [sid, sp] of Object.entries(sl)) {
    const pos = sp.position;
    if (!/^(QB|RB|WR|TE)$/.test(pos)) continue;
    const team = normTeam(sp.team);
    if (!/^[A-Z]{2,3}$/.test(team)) continue;
    const gs = gsisOf(sp);
    if (haveSl.has(sid) || (gs && haveId.has(gs))) continue;
    const rank = sp.search_rank == null ? 9999 : sp.search_rank;
    const base = (gs && baselines[gs]) || null;
    const fresh = !!(base && base.year >= ((data.meta && data.meta.season) || 2026) - 3);
    const inj = sp.injury_status || '';
    const body = sp.injury_body_part || '';
    const hurt = severity(inj) >= 2 || /acl|achilles/i.test(body);
    const notable = fresh && (rank <= 40 || (hurt && rank <= 160));
    const depthPos = sp.depth_chart_position;
    const depth = sp.depth_chart_order;
    const starterSlot = depth === 1 && (depthPos === 'QB' || depthPos === 'RB' || depthPos === 'TE' || depthPos === 'LWR' || depthPos === 'RWR' || depthPos === 'SWR');
    if (!notable && !(starterSlot && (fresh || rank <= 200))) continue;
    const name = sp.full_name || ((sp.first_name || '') + ' ' + (sp.last_name || '')).trim();
    if (!name) continue;
    const id = gs || ('sl-' + sid);
    players.push({
      id, name, pos, team,
      g: 0, last_wk: (recent[gs] && recent[gs].last) || 0,
      ppr_pg: base ? base.ppr : 0,
      std_pg: base ? base.std : 0,
      tradeOnly: true,
      ids: { sl: sid, espn: sp.espn_id != null ? String(sp.espn_id) : null, yahoo: sp.yahoo_id != null ? String(sp.yahoo_id) : null },
      sl_inj: inj ? { status: inj, body: body || null } : (body ? { status: /acl|achilles/i.test(body) ? 'IR' : '', body } : null),
      w: {}, t: {}, log: [],
    });
    haveSl.add(sid);
    haveId.add(id);
    added += 1;
  }
  console.log('added missing', added);
}

function markStarters(data, sl) {
  const players = data.players;
  const depth = {};
  for (const [sid, sp] of Object.entries(sl)) {
    const pos0 = sp.depth_chart_position;
    let pos = null;
    if (pos0 === 'QB' || pos0 === 'RB' || pos0 === 'TE') pos = pos0;
    else if (pos0 === 'LWR' || pos0 === 'RWR' || pos0 === 'SWR') pos = 'WR';
    if (!pos || !sp.team || !sp.depth_chart_order) continue;
    const team = normTeam(sp.team);
    (depth[team + '|' + pos] = depth[team + '|' + pos] || []).push({
      order: sp.depth_chart_order, sid, gsis: gsisOf(sp), name: sp.full_name, rank: sp.search_rank == null ? 9999 : sp.search_rank,
    });
  }
  const teams = Object.keys(data.team_names || {});
  for (const team of teams) {
    const qbs = players.filter(p => p.pos === 'QB' && p.team === team)
      .slice().sort((a, b) => ((b.t && b.t.pa) || 0) - ((a.t && a.t.pa) || 0));
    let qb = qbs.find(p => p.t && p.t.pa >= 80) || qbs[0];
    if (!qb) {
      const row = (depth[team + '|QB'] || []).find(r => r.order === 1);
      if (row) qb = findPlayer(players, row.sid, row.gsis, row.name);
    }
    if (qb) qb.starter = true;
    const depthQ = (depth[team + '|QB'] || []).find(r => r.order === 1);
    if (depthQ) {
      const chart = findPlayer(players, depthQ.sid, depthQ.gsis, depthQ.name);
      if (chart) chart.starter = true;
    }
    for (const pos of ['RB', 'TE', 'WR']) {
      const want = pos === 'WR' ? 3 : 1;
      const rows = (depth[team + '|' + pos] || []).slice().sort((a, b) => a.order - b.order || a.rank - b.rank);
      const seen = new Set();
      let n = 0;
      for (const row of rows) {
        if (row.order > 1) continue;
        const pl = findPlayer(players, row.sid, row.gsis, row.name);
        if (!pl || seen.has(pl.id)) continue;
        pl.starter = true;
        seen.add(pl.id);
        n += 1;
        if (n >= want) break;
      }
      if (!n) {
        const skill = players.filter(p => p.pos === pos && p.team === team).sort((a, b) => (b.ppr_pg || 0) - (a.ppr_pg || 0));
        for (const pl of skill.slice(0, pos === 'WR' ? 2 : 1)) { pl.starter = true; n += 1; }
      }
    }
  }
  console.log('starters', players.filter(p => p.starter).length);
}

function applyAdp(data) {
  const file = path.join(__dirname, 'data', 'adp.json');
  if (!fs.existsSync(file)) {
    console.log('WARN: no ADP file; trade values stay on the projection');
    return;
  }
  let doc;
  try { doc = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) {
    console.log('WARN: ADP file unreadable; trade values stay on the projection');
    return;
  }
  const byEspn = new Map();
  const byName = new Map();
  for (const row of doc.players || []) {
    if (!row || !(row.adp > 0)) continue;
    if (row.espn) byEspn.set(String(row.espn), row);
    const key = foldName(row.name) + '|' + row.pos;
    if (!byName.has(key)) byName.set(key, row);
    else byName.set(key, null);
  }
  let n = 0, nsf = 0;
  for (const pl of data.players || []) {
    const eid = pl.ids && pl.ids.espn != null ? String(pl.ids.espn) : '';
    let row = eid && byEspn.get(eid);
    if (!row) row = byName.get(foldName(pl.name) + '|' + pl.pos);
    if (!row || !(row.adp > 0)) continue;
    pl.adp = Math.round(row.adp * 10) / 10;
    if (row.sf > 0) { pl.adp_sf = Math.round(row.sf * 10) / 10; nsf += 1; }
    n += 1;
  }
  data.meta = data.meta || {};
  data.meta.adp_source = doc.source || 'ESPN';
  data.meta.adp_date = doc.date || '';
  data.meta.adp_sf_source = doc.sf_source || '';
  data.meta.adp_sf_date = doc.sf_date || '';
  data.meta.adp_note = doc.note || '';
  console.log('adp joined', n, 'sf', nsf, doc.date || '');
}

function main() {
  const arg = process.argv.find(a => a.endsWith('.json'));
  const file = arg || path.join(__dirname, 'site', 'data.json');
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const season = data.meta && data.meta.season;
  const ages = loadAges(season);
  const sl = loadSleeper();
  const loaded = loadBaselines(season);
  const baselines = loaded.rates || loaded;
  const recent = loaded.recent || {};
  for (const [sid, sp] of Object.entries(sl)) {
    const base = baselines[gsisOf(sp)];
    if (base) baselines[sid] = base;
  }
  overlayInjuries(data, sl);
  addMissing(data, sl, baselines, recent);
  applyAdp(data);
  markStarters(data, sl);
  const newsById = loadNewsById(data.players);
  const t0 = Date.now();
  attachTrade(data, { project, scoring: SCORING, ages, baselines, newsById });
  if (process.argv.includes('--backtest')) {
    const result = backtest(data, project, SCORING);
    data.meta.trade.backtest = { spearman: result.spearman == null ? null : Math.round(result.spearman * 1000) / 1000, n: result.n };
    console.log('backtest', JSON.stringify(data.meta.trade.backtest));
  }
  fs.writeFileSync(file, JSON.stringify(data));
  const ranked = data.players.filter(p => p.tv).sort((a, b) => b.tv.v.ppr.qb1[0] - a.tv.v.ppr.qb1[0]);
  console.log('trade', ranked.length, 'players', Date.now() - t0, 'ms', 'ages', Object.keys(ages).length);
  console.log(ranked.slice(0, 8).map(p => p.name + ' ' + p.tv.v.ppr.qb1[0] + '/' + p.tv.v.ppr.sflex[0] + ' dyn ' + p.tv.v.ppr.qb1[1]).join('\n'));
}

if (require.main === module) main();
