#!/usr/bin/env node
/* Write the compact projection snapshot the hourly refresh archives.
   The numbers are the same project() the site runs for PPR, without the
   live weather overlay (that is fetched in the browser, not published).
   Usage: node scripts/snapshot_projections.js --data site/data.json --out snap.json [--market site/market.json]
*/
'use strict';

const fs = require('fs');
const { project } = require('../site/model');

const POS = ['QB', 'RB', 'WR', 'TE'];
const LINE_KEYS = ['pass_yds', 'pass_att', 'pass_cmp', 'pass_td', 'int', 'rush_yds', 'rush_att', 'rec_yds', 'rec'];
const MODEL_KEYS = ['pa', 'py', 'ptd', 'int', 'ca', 'ry', 'rtd', 'rc', 'rcy', 'rctd'];

function nthSunday(year, monthIndex, n) {
  const first = new Date(Date.UTC(year, monthIndex, 1)).getUTCDay();
  return 1 + ((7 - first) % 7) + 7 * (n - 1);
}

// nflverse kickoff times are US Eastern. Same rule as kickoffUTC in site/app.js:
// EDT (UTC-4) from the 2nd Sunday of March through the day before the 1st Sunday of November.
function kickoffUTC(game) {
  const [y, mo, d] = String(game.date).split('-').map(Number);
  const [h, mi] = String(game.time || '13:00').split(':').map(Number);
  const dstStart = Date.UTC(y, 2, nthSunday(y, 2, 2));
  const dstEnd = Date.UTC(y, 10, nthSunday(y, 10, 1));
  const local = Date.UTC(y, mo - 1, d);
  const off = local >= dstStart && local < dstEnd ? 4 : 5;
  return new Date(Date.UTC(y, mo - 1, d, h + off, mi)).toISOString().replace('.000Z', 'Z');
}

function generatedIso(text) {
  const raw = String(text || '').trim();
  const m = raw.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) throw new Error('generated is not a timestamp: ' + raw);
  return `${m[1]}T${m[2]}:${m[3]}:${m[4] || '00'}Z`;
}

function stampOf(iso) {
  const m = String(iso).match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/);
  if (!m) throw new Error('cannot stamp ' + iso);
  return `${m[1]}T${m[2]}-${m[3]}Z`;
}

function round(n, places) {
  const x = Number(n);
  if (!Number.isFinite(x)) return null;
  const p = 10 ** places;
  return Math.round(x * p) / p;
}

function modelOf(comps) {
  if (!comps) return null;
  const out = {};
  for (const key of MODEL_KEYS) {
    const n = round(comps[key], 2);
    if (n != null) out[key] = n;
  }
  return Object.keys(out).length ? out : null;
}

function propCell(raw) {
  if (!raw || raw.line == null) return null;
  const line = round(raw.line, 2);
  if (line == null) return null;
  const cell = { line };
  if (raw.over != null && Number.isFinite(Number(raw.over))) cell.over = Math.round(Number(raw.over));
  if (raw.under != null && Number.isFinite(Number(raw.under))) cell.under = Math.round(Number(raw.under));
  if (raw.p_over != null && Number.isFinite(Number(raw.p_over))) cell.p_over = round(raw.p_over, 4);
  if (raw.src) cell.src = String(raw.src);
  return cell;
}

function oddsPair(a, b) {
  if (a == null && b == null) return null;
  const num = (v) => (v == null || !Number.isFinite(Number(v)) ? null : Math.round(Number(v)));
  return [num(a), num(b)];
}

function buildProps(market, games, modeled, meta) {
  const byKey = {};
  for (const g of games) byKey[`${g.away}@${g.home}`] = g;
  const byEspn = {};
  for (const row of modeled) if (row.espn) byEspn[String(row.espn)] = row;
  const gameRows = games.map((g) => {
    const mk = (market.games || {})[`${g.away}@${g.home}`] || {};
    const row = {
      id: g.id, away: g.away, home: g.home, kickoff: g.kickoff,
      spread_home: g.spread_home, total: g.total,
    };
    const spreadOdds = oddsPair(mk.spread_odds_home, mk.spread_odds_away);
    const totalOdds = oddsPair(mk.total_over_odds, mk.total_under_odds);
    const ml = oddsPair(mk.ml_home, mk.ml_away);
    if (spreadOdds) row.spread_odds = spreadOdds;
    if (totalOdds) row.total_odds = totalOdds;
    if (ml) row.ml = ml;
    return row;
  });
  const players = [];
  for (const [espn, rec] of Object.entries(market.props || {})) {
    if (!rec || typeof rec !== 'object') continue;
    const game = byKey[rec.game];
    if (!game) continue;
    const known = byEspn[String(rec.espn || espn)];
    const player = {
      espn: String(rec.espn || espn),
      name: (known && known.name) || rec.name || null,
      game: game.id,
    };
    if (known) {
      player.id = known.id;
      player.pos = known.pos;
      player.team = known.team;
      if (known.model) player.model = known.model;
    }
    let any = false;
    for (const key of LINE_KEYS) {
      const cell = propCell(rec[key]);
      if (!cell) continue;
      player[key] = cell;
      any = true;
    }
    if (rec.atd && rec.atd.p != null && Number.isFinite(Number(rec.atd.p))) {
      const atd = { p: round(rec.atd.p, 4) };
      if (rec.atd.odds != null && Number.isFinite(Number(rec.atd.odds))) atd.odds = Math.round(Number(rec.atd.odds));
      if (rec.atd.src) atd.src = String(rec.atd.src);
      player.atd = atd;
      any = true;
    }
    if (!any) continue;
    players.push(player);
  }
  players.sort((a, b) => String(a.game).localeCompare(String(b.game)) || String(a.name || '').localeCompare(String(b.name || '')) || String(a.espn).localeCompare(String(b.espn)));
  const doc = {
    v: 1,
    kind: 'props',
    season: meta.season,
    week: meta.week,
    generated: meta.generated,
    stamp: meta.stamp,
    as_of: market.as_of || null,
    source: market.source || 'ESPN (DraftKings)',
    games: gameRows,
    players,
  };
  if (market.stale) doc.stale = true;
  if (modeled.some((row) => row.model)) doc.model_generated = meta.generated;
  return doc;
}

function tradeValue(pl) {
  const v = pl.tv && pl.tv.v && pl.tv.v.ppr;
  if (!v) return null;
  const pack = (pair) => (pair && pair.length >= 2 && pair[0] != null && pair[1] != null)
    ? [round(pair[0], 4), round(pair[1], 4)] : null;
  const out = {};
  const qb1 = pack(v.qb1);
  const sflex = pack(v.sflex);
  if (qb1) out.qb1 = qb1;
  if (sflex) out.sflex = sflex;
  return Object.keys(out).length ? out : null;
}

function buildSnapshot(data, market) {
  if (!data || !data.meta) throw new Error('data.json has no meta');
  const week = data.meta.next_week;
  const season = data.meta.season;
  const schedule = (data.schedule && (data.schedule[String(week)] || data.schedule[week])) || [];
  const marketWeek = market && Number(market.week) === Number(week) ? market : null;
  const games = schedule.map((g) => {
    const key = `${g.away}@${g.home}`;
    const mk = marketWeek && marketWeek.games ? marketWeek.games[key] : null;
    const spreadHome = mk && mk.spread_home != null ? mk.spread_home
      : (g.spread_line != null ? -Number(g.spread_line) : null);
    const total = mk && mk.total != null ? mk.total : (g.total_line != null ? Number(g.total_line) : null);
    return {
      id: g.id,
      away: g.away,
      home: g.home,
      kickoff: kickoffUTC(g),
      spread_line: g.spread_line == null ? null : Number(g.spread_line),
      total_line: g.total_line == null ? null : Number(g.total_line),
      spread_home: spreadHome == null ? null : round(spreadHome, 2),
      total: total == null ? null : round(total, 2),
    };
  });
  const byTeam = {};
  games.forEach((g) => { byTeam[g.home] = g; byTeam[g.away] = g; });
  const env = { data, market: marketWeek, wx: {} };
  const players = [];
  const modeled = [];
  for (const pl of data.players || []) {
    if (!POS.includes(pl.pos)) continue;
    const g = byTeam[pl.team];
    if (!g) continue;
    let pr;
    try { pr = project(pl, week, 'ppr', env); } catch (e) { continue; }
    if (!pr || pr.bye || !Number.isFinite(pr.pts)) continue;
    const row = {
      id: pl.id,
      name: pl.name,
      pos: pl.pos,
      team: pl.team,
      opp: g.home === pl.team ? g.away : g.home,
      game: g.id,
      proj: round(pr.pts, 2),
      floor: round(pr.floor, 2),
      ceil: round(pr.ceil, 2),
    };
    if (pl.ids && pl.ids.espn) row.espn = String(pl.ids.espn);
    if (row.espn) modeled.push({ espn: row.espn, id: row.id, name: row.name, pos: row.pos, team: row.team, game: row.game, model: modelOf(pr.modelC) });
    if (pr.roleFloor) row.role = true;
    const tv = tradeValue(pl);
    if (tv) row.tv = tv;
    const inj = (pl.sl_inj && pl.sl_inj.status) || (pl.inj && (pl.inj.status || pl.inj.st)) || '';
    if (inj) row.inj = String(inj);
    players.push(row);
  }
  players.sort((a, b) => a.team.localeCompare(b.team) || a.pos.localeCompare(b.pos) || a.name.localeCompare(b.name) || String(a.id).localeCompare(String(b.id)));
  const snap = {
    v: 1,
    season,
    week,
    generated: generatedIso(data.meta.generated),
    scoring: 'ppr',
    tv_note: 'PPR [redraft, dynasty]. qb1 is 1QB, sflex is superflex.',
    games,
    players,
  };
  if (marketWeek && marketWeek.as_of) snap.market_as_of = marketWeek.as_of;
  if (marketWeek && marketWeek.stale) snap.market_stale = true;
  snap.stamp = stampOf(snap.generated);
  if (marketWeek) snap.props = buildProps(marketWeek, games, modeled, snap);
  return snap;
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--data' || a === '--market' || a === '--out') {
      out[a.slice(2)] = argv[++i];
    } else {
      throw new Error('unknown argument ' + a);
    }
  }
  if (!out.data || !out.out) throw new Error('usage: snapshot_projections.js --data site/data.json --out snap.json [--market site/market.json]');
  return out;
}

function main(argv) {
  const args = parseArgs(argv);
  const data = JSON.parse(fs.readFileSync(args.data, 'utf8'));
  const market = args.market && fs.existsSync(args.market) ? JSON.parse(fs.readFileSync(args.market, 'utf8')) : null;
  const snap = buildSnapshot(data, market);
  fs.writeFileSync(args.out, JSON.stringify(snap));
  process.stdout.write(`snapshot ${snap.stamp} week ${snap.week} players ${snap.players.length} games ${snap.games.length}\n`);
}

module.exports = { buildSnapshot, buildProps, kickoffUTC, generatedIso, stampOf };

if (require.main === module) {
  try { main(process.argv.slice(2)); }
  catch (e) {
    process.stderr.write(String(e && e.message || e) + '\n');
    process.exit(1);
  }
}
