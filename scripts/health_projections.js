#!/usr/bin/env node
/* Project every skill player once, the same project() the site uses.
   Prints JSON. A backup with an empty stat line can come back as NaN;
   that row is marked played:false so the health check can ignore it.
   Usage: node scripts/health_projections.js data.json [market.json]
*/
'use strict';

const fs = require('fs');
const { project } = require('../site/model');

const POS = ['QB', 'RB', 'WR', 'TE'];

function load(path) {
  if (!path) return null;
  return JSON.parse(fs.readFileSync(path, 'utf8'));
}

function main() {
  const data = load(process.argv[2]);
  const market = load(process.argv[3]);
  if (!data || !data.meta) throw new Error('data.json has no meta');
  const week = data.meta.next_week;
  const env = { data, market: market && Number(market.week) === Number(week) ? market : null, wx: {} };
  const rows = [];
  for (const pl of data.players || []) {
    if (!POS.includes(pl.pos)) continue;
    const w = pl.w || {};
    const usage = Number(w.pa || 0) + Number(w.ca || 0) + Number(w.tg || 0);
    const played = Number(pl.g || 0) > 0 || usage > 0;
    let pr;
    try {
      pr = project(pl, week, 'ppr', env);
    } catch (err) {
      rows.push({ name: pl.name, pos: pl.pos, team: pl.team, bye: false, pts: null, played, error: String(err && err.message || err) });
      continue;
    }
    const pts = pr && Number.isFinite(pr.pts) ? pr.pts : null;
    rows.push({ name: pl.name, pos: pl.pos, team: pl.team, bye: !!(pr && pr.bye), pts, played });
  }
  process.stdout.write(JSON.stringify({ week, rows }));
}

try {
  main();
} catch (err) {
  process.stderr.write(String(err && err.message || err) + '\n');
  process.exit(1);
}
