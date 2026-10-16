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

module.exports = { buildSnapshot, kickoffUTC, generatedIso, stampOf };

if (require.main === module) {
  try { main(process.argv.slice(2)); }
  catch (e) {
    process.stderr.write(String(e && e.message || e) + '\n');
    process.exit(1);
  }
}
