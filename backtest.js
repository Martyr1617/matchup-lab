#!/usr/bin/env node
/* Score past weeks' projections against what those players actually scored.
   Usage does not look ahead: each week is projected from that player's earlier
   games only. Opponent factors are the published season-to-date table, which
   does include later weeks. An optional second file is a snap context
   ({snap:{id:{week:offense_pct}}}) joined onto logs before scoring. A
   precomputed snapImplied on the player is ignored so a next-week value
   cannot leak into earlier weeks. Not run in CI. */
'use strict';
const fs = require('fs');
const path = require('path');
const { project } = require('./site/model');

const file = process.argv[2] || path.join(__dirname, 'site/data.json');
const data = JSON.parse(fs.readFileSync(file, 'utf8'));
const DECAY = 0.7;
const PRIOR_CV = { QB: 0.38, RB: 0.50, WR: 0.58, TE: 0.65 };
const PRIOR_N = 4;
const last = data.meta.last_completed_week || 18;
const num = x => Number(x) || 0;

const ctxFile = process.argv[3];
if (ctxFile) {
  const ctx = JSON.parse(fs.readFileSync(ctxFile, 'utf8'));
  const snapMap = ctx.snap || {};
  let hit = 0;
  for (const pl of data.players) {
    const byWeek = snapMap[String(pl.id)];
    if (!byWeek) continue;
    for (const g of pl.log || []) {
      const sp = byWeek[String(g.wk)];
      if (sp == null || sp === '') continue;
      g.sp = Number(sp);
      hit++;
    }
  }
  console.log(`Snaps joined ${hit} player-weeks from ${path.basename(ctxFile)}`);
}

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
  let sw = 0, ss = 0, seen = false;
  for (let i = 0; i < prior.length; i++) {
    if (prior[i].sp == null || prior[i].sp === '') continue;
    sw += wts[i];
    ss += wts[i] * num(prior[i].sp);
    seen = true;
  }
  return {
    ...pl,
    g: prior.length,
    cv,
    adv: null,
    snapImplied: null,
    snap: seen && sw ? ss / sw : null,
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

function snapRate(week) {
  const acc = {};
  for (const pl of data.players) {
    const bucket = acc[pl.pos] || (acc[pl.pos] = { pa: 0, ca: 0, tg: 0, sp: 0 });
    for (const g of pl.log || []) {
      if (g.wk >= week || g.sp == null || !(Number(g.sp) > 0)) continue;
      bucket.pa += num(g.pa);
      bucket.ca += num(g.ca);
      bucket.tg += num(g.tg);
      bucket.sp += Number(g.sp);
    }
  }
  const out = {};
  for (const pos of Object.keys(acc)) {
    const a = acc[pos];
    out[pos] = a.sp > 0 ? { pa: a.pa / a.sp, ca: a.ca / a.sp, tg: a.tg / a.sp } : null;
  }
  return out;
}

const rates = {};
for (let week = 2; week <= last; week++) rates[week] = snapRate(week);

function rank(arr) {
  const idx = arr.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
  const r = new Array(arr.length);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) r[idx[k][1]] = avg;
    i = j + 1;
  }
  return r;
}
function pearson(xs, ys) {
  const n = xs.length;
  if (n < 3) return null;
  let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
  for (let i = 0; i < n; i++) {
    sx += xs[i]; sy += ys[i]; sxx += xs[i] * xs[i]; syy += ys[i] * ys[i]; sxy += xs[i] * ys[i];
  }
  const den = Math.sqrt((n * sxx - sx * sx) * (n * syy - sy * sy));
  return den ? (n * sxy - sx * sy) / den : null;
}
function spearman(xs, ys) { return pearson(rank(xs), rank(ys)); }

const rows = [];
for (const pl of data.players) {
  for (const g of pl.log || []) {
    if (g.wk < 2 || g.wk > last || g.ppr == null) continue;
    const snap = snapshot(pl, g.wk);
    if (!snap) continue;
    const rt = rates[g.wk] && rates[g.wk][pl.pos];
    if (snap.snap != null && rt) {
      snap.snapImplied = { pa: snap.snap * rt.pa, ca: snap.snap * rt.ca, tg: snap.snap * rt.tg };
    }
    const pr = project(snap, g.wk, 'ppr', { data, market: null, wx: {} });
    if (!pr || pr.bye) continue;
    const actual = num(g.ppr);
    rows.push({
      pos: pl.pos,
      week: g.wk,
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

function summarize(list, name) {
  const n = list.length;
  const bias = list.reduce((s, r) => s + (r.pred - r.actual), 0) / n;
  const mae = list.reduce((s, r) => s + Math.abs(r.pred - r.actual), 0) / n;
  const rmse = Math.sqrt(list.reduce((s, r) => s + (r.pred - r.actual) ** 2, 0) / n);
  const cover = list.filter(r => r.inRange).length / n;
  const boomPred = list.reduce((s, r) => s + r.boom, 0) / n;
  const boomObs = list.filter(r => r.boomHit).length / n;
  const bustPred = list.reduce((s, r) => s + r.bust, 0) / n;
  const bustObs = list.filter(r => r.bustHit).length / n;
  let rhoSum = 0, rhoN = 0;
  const weeks = [...new Set(list.map(r => r.week))];
  const poss = name === 'ALL' ? ['QB', 'RB', 'WR', 'TE'] : [name];
  for (const week of weeks) for (const pos of poss) {
    const slice = name === 'ALL' ? list.filter(r => r.week === week && r.pos === pos) : list.filter(r => r.week === week);
    if (slice.length < 8) continue;
    const rho = spearman(slice.map(r => r.pred), slice.map(r => r.actual));
    if (rho != null) { rhoSum += rho; rhoN++; }
  }
  return { n, mae, rmse, bias, cover, boomPred, boomObs, bustPred, bustObs, rho: rhoN ? rhoSum / rhoN : null };
}

const pct = x => (100 * x).toFixed(1) + '%';
const f = x => x.toFixed(2);
console.log(`Backtest  ${data.meta.season} weeks 2–${last}  ${rows.length} player-weeks  (PPR)`);
for (const name of ['ALL', 'QB', 'RB', 'WR', 'TE']) {
  const list = name === 'ALL' ? rows : rows.filter(r => r.pos === name);
  if (!list.length) continue;
  const s = summarize(list, name);
  console.log(`${name.padEnd(4)} n=${String(s.n).padStart(5)}  MAE ${f(s.mae)}  RMSE ${f(s.rmse)}  bias ${f(s.bias)}  cover ${pct(s.cover)}  rho ${s.rho == null ? 'n/a' : f(s.rho)}`);
}
const all = summarize(rows, 'ALL');
console.log(`Boom      predicted ${pct(all.boomPred)}   happened ${pct(all.boomObs)}`);
console.log(`Bust      predicted ${pct(all.bustPred)}   happened ${pct(all.bustObs)}`);
