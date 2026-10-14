#!/usr/bin/env node
/* Score past weeks' projections against what those players actually scored.
   Usage does not look ahead: each week is projected from that player's earlier
   games only. Opponent factors are the published season-to-date table, which
   does include later weeks. Not run in CI. */
'use strict';
const fs = require('fs');
const path = require('path');
const { project } = require('./site/model');

const file = process.argv[2] || path.join(__dirname, 'site/data.json');
const data = JSON.parse(fs.readFileSync(file, 'utf8'));
const DECAY = 0.7;
const PRIOR_CV = { QB: 0.38, RB: 0.50, WR: 0.58, TE: 0.65 };
const PRIOR_N = 4;
const last = data.meta.last_completed_week;
const num = x => Number(x) || 0;

function snapshot(pl, week) {
  const prior = (pl.log || []).filter(g => g.wk < week);
  if (!prior.length) return null;
  const cur = week - 1;
  const wts = prior.map(g => DECAY ** (cur - g.wk));
  const wsum = wts.reduce((a, b) => a + b, 0);
  const wm = key => wts.reduce((s, w, i) => s + w * num(prior[i][key]), 0) / wsum;
  const tot = key => prior.reduce((s, g) => s + num(g[key]), 0);
  const fp = prior.map(g => num(g.ppr));
  const mean = fp.reduce((a, b) => a + b, 0) / fp.length;
  let cvPrior = PRIOR_CV[pl.pos] || 0.5;
  if (fp.length > 1 && mean > 0) {
    const sd = Math.sqrt(fp.reduce((s, x) => s + (x - mean) ** 2, 0) / (fp.length - 1));
    cvPrior = Math.min(Math.max(sd / mean, 0.15), 1.5);
  }
  const cv = Math.sqrt((fp.length * cvPrior ** 2 + PRIOR_N * (PRIOR_CV[pl.pos] || 0.5) ** 2) / (fp.length + PRIOR_N));
  return {
    ...pl,
    g: prior.length,
    cv,
    adv: null,
    w: {
      pa: wm('pa'), py: wm('py'), ptd: wm('ptd'), int: wm('int'),
      ca: wm('ca'), ry: wm('ry'), rtd: wm('rtd'),
      tg: wm('tg'), rc: wm('rc'), rcy: wm('rcy'), rctd: wm('rctd'),
    },
    t: {
      pa: tot('pa'), py: tot('py'), ptd: tot('ptd'), int: tot('int'),
      ca: tot('ca'), ry: tot('ry'), rtd: tot('rtd'),
      tg: tot('tg'), rc: tot('rc'), rcy: tot('rcy'), rctd: tot('rctd'),
      fl: tot('fl'), two: 0,
    },
  };
}

const rows = [];
for (const pl of data.players) {
  for (const g of pl.log || []) {
    if (g.wk < 2 || g.wk > last || g.ppr == null) continue;
    const snap = snapshot(pl, g.wk);
    if (!snap) continue;
    const pr = project(snap, g.wk, 'ppr', { data, market: null, wx: {} });
    if (!pr || pr.bye) continue;
    const actual = num(g.ppr);
    rows.push({
      pred: pr.pts,
      actual,
      inRange: actual >= pr.floor && actual <= pr.ceil,
      boom: pr.bb.boom,
      bust: pr.bb.bust,
      boomHit: actual >= pr.bb.boomAt,
      bustHit: actual <= pr.bb.bustAt,
    });
  }
}

if (!rows.length) {
  console.error('No completed player-weeks to score in ' + file);
  process.exit(1);
}

const n = rows.length;
const bias = rows.reduce((s, r) => s + (r.pred - r.actual), 0) / n;
const mae = rows.reduce((s, r) => s + Math.abs(r.pred - r.actual), 0) / n;
const rmse = Math.sqrt(rows.reduce((s, r) => s + (r.pred - r.actual) ** 2, 0) / n);
const cover = rows.filter(r => r.inRange).length / n;
const boomPred = rows.reduce((s, r) => s + r.boom, 0) / n;
const boomObs = rows.filter(r => r.boomHit).length / n;
const bustPred = rows.reduce((s, r) => s + r.bust, 0) / n;
const bustObs = rows.filter(r => r.bustHit).length / n;
const pct = x => (100 * x).toFixed(1) + '%';
const f = x => x.toFixed(2);

console.log(`Backtest  ${data.meta.season} weeks 2–${last}  ${n} player-weeks  (PPR)`);
console.log(`Error     MAE ${f(mae)}   RMSE ${f(rmse)}   bias (pred−actual) ${f(bias)}`);
console.log(`Coverage  P10–P90 ${pct(cover)}  (the calibrated normal is about 80% on a full season)`);
console.log(`Boom      predicted ${pct(boomPred)}   happened ${pct(boomObs)}`);
console.log(`Bust      predicted ${pct(bustPred)}   happened ${pct(bustObs)}`);
