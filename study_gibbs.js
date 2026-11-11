#!/usr/bin/env node
/* Score walk-forward variants with the production projection function.
   A variant is kept only when the paired absolute-error drop is at least
   two standard errors and 0.005 points, and no season gets worse. */
'use strict';
const fs = require('fs');
const { project } = require('./site/model');

const data = JSON.parse(fs.readFileSync(process.argv[2] || '/tmp/gibbs/cases.json', 'utf8'));
const bundles = data.bundles;

function mix(cur, nxt, b) {
  if (nxt == null || !Number.isFinite(Number(nxt))) return Number(cur) || 0;
  return (1 - b) * (Number(cur) || 0) + b * Number(nxt);
}

const VARIANTS = [
  { name: 'baseline' },
  { name: 'route 0.20', route: 0.20, routeKey: 'routeTg' },
  { name: 'route 0.35', route: 0.35, routeKey: 'routeTg' },
  { name: 'route 0.50', route: 0.50, routeKey: 'routeTg' },
  { name: 'route trail 0.35', route: 0.35, routeKey: 'routeTrail' },
  { name: 'route replaces snap', route: 0.35, routeKey: 'routeTg', snapBlend: 0 },
  { name: 'snap-route 0.20', route: 0.20, routeKey: 'snapRouteTg' },
  { name: 'snap-route 0.35', route: 0.35, routeKey: 'snapRouteTg' },
  { name: 'snap-route trail 0.35', route: 0.35, routeKey: 'snapRouteTrail' },
  { name: 'target share 0.20', share: 0.20, shareKey: 'shareTg' },
  { name: 'target share 0.35', share: 0.35, shareKey: 'shareTg' },
  { name: 'target share trail 0.35', share: 0.35, shareKey: 'shareTrail' },
  { name: 'air-yards share 0.25', share: 0.25, shareKey: 'airTg' },
  { name: 'aDOT yards 0.25', adot: 0.25 },
  { name: 'aDOT yards 0.50', adot: 0.50 },
  { name: 'YBC/YAC split', ybc: 1 },
  { name: 'pace 0.25', pace: 0.25 },
  { name: 'pace 0.50', pace: 0.50 },
  { name: 'man/zone 0.25', man: 0.25 },
  { name: 'man/zone 0.50', man: 0.50 },
];

function playerOf(row, v, league) {
  const w = { ...row.w };
  const t = { ...row.t };
  if (v.route) w.tg = mix(w.tg, row[v.routeKey], v.route);
  if (v.share) w.tg = mix(w.tg, row[v.shareKey], v.share);
  if (v.adot && row.adotYpt != null && Number(t.tg) > 0) {
    const natural = Number(t.rcy) / Number(t.tg);
    const ypt = (1 - v.adot) * natural + v.adot * row.adotYpt;
    t.rcy = ypt * Number(t.tg);
  }
  if (v.ybc && row.ybcYpc != null && Number(t.ca) > 0 && league && league.ypc != null) {
    t.ry = row.ybcYpc * (Number(t.ca) + 60) - league.ypc * 60;
  }
  if (v.pace && row.pace != null) {
    const m = Math.max(0.92, Math.min(1.08, 1 + v.pace * (row.pace - 1)));
    w.tg *= m; w.ca *= m; w.pa *= m;
  }
  if (v.man && row.manRatio != null && Number(t.tg) > 0) {
    const m = Math.max(0.95, Math.min(1.05, 1 + v.man * (row.manRatio - 1)));
    t.rcy *= m;
  }
  return {
    pos: row.pos,
    team: row.team,
    g: row.g,
    cv: row.cv,
    w, t,
    snapImplied: row.snap,
    id: row.pos + ':' + row.k + ':' + row.team,
  };
}

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

const scored = [];
let skipped = 0;
for (const row of data.rows) {
  const bundle = bundles[row.k];
  if (!bundle) { skipped++; continue; }
  const env = { data: bundle, market: null, wx: {}, tune: {} };
  const pl = playerOf(row, {}, bundle.league);
  let pr;
  try { pr = project(pl, row.week, 'ppr', env); } catch (e) { skipped++; continue; }
  if (!pr || pr.bye || !Number.isFinite(pr.pts)) { skipped++; continue; }
  scored.push({ row, pred0: pr.pts, floor: pr.floor, ceil: pr.ceil });
}
console.log(`scored baseline ${scored.length} skipped ${skipped}`);

function emptyAcc() {
  return { n: 0, ae: 0, se: 0, bias: 0, cover: 0, sx: [], sy: [], weeks: new Map() };
}
function add(acc, pred, actual, pos, week, season, inRange) {
  acc.n++;
  acc.ae += Math.abs(pred - actual);
  acc.se += (pred - actual) ** 2;
  acc.bias += pred - actual;
  if (inRange) acc.cover++;
  const key = season + ':' + week + ':' + pos;
  let bucket = acc.weeks.get(key);
  if (!bucket) { bucket = { xs: [], ys: [] }; acc.weeks.set(key, bucket); }
  bucket.xs.push(pred); bucket.ys.push(actual);
}
function finish(acc) {
  const n = acc.n || 1;
  let rhoSum = 0, rhoN = 0;
  for (const bucket of acc.weeks.values()) {
    if (bucket.xs.length < 8) continue;
    const rho = spearman(bucket.xs, bucket.ys);
    if (rho != null) { rhoSum += rho; rhoN++; }
  }
  return {
    n: acc.n,
    mae: acc.ae / n,
    rmse: Math.sqrt(acc.se / n),
    bias: acc.bias / n,
    cover: acc.cover / n,
    rho: rhoN ? rhoSum / rhoN : null,
  };
}

function scoreVariant(v) {
  const all = emptyAcc();
  const byPos = { QB: emptyAcc(), RB: emptyAcc(), WR: emptyAcc(), TE: emptyAcc() };
  const bySeason = {};
  const diffs = [];
  const diffBySeason = {};
  let used = 0;
  for (const s of scored) {
    const row = s.row;
    const bundle = bundles[row.k];
    const env = { data: bundle, market: null, wx: {}, tune: {} };
    if (v.snapBlend != null) env.tune.snapBlend = v.snapBlend;
    const pl = playerOf(row, v, bundle.league);
    const featureOn = (v.route && row[v.routeKey] != null) || (v.share && row[v.shareKey] != null)
      || (v.adot && row.adotYpt != null) || (v.ybc && row.ybcYpc != null && row.pos === 'RB')
      || (v.pace && row.pace != null) || (v.man && row.manRatio != null);
    if ((v.route || v.share || v.adot || v.ybc || v.pace || v.man) && v.name !== 'baseline') {
      // still score everyone; a null feature leaves the line unchanged (fail-open)
    }
    let pr;
    try { pr = project(pl, row.week, 'ppr', env); } catch (e) { continue; }
    if (!pr || pr.bye || !Number.isFinite(pr.pts)) continue;
    const actual = row.actual;
    const inRange = actual >= pr.floor && actual <= pr.ceil;
    add(all, pr.pts, actual, row.pos, row.week, row.season, inRange);
    add(byPos[row.pos], pr.pts, actual, row.pos, row.week, row.season, inRange);
    if (!bySeason[row.season]) bySeason[row.season] = emptyAcc();
    add(bySeason[row.season], pr.pts, actual, row.pos, row.week, row.season, inRange);
    const d = Math.abs(pr.pts - actual) - Math.abs(s.pred0 - actual);
    diffs.push(d);
    (diffBySeason[row.season] || (diffBySeason[row.season] = [])).push(d);
    if (featureOn) used++;
  }
  const mean = diffs.reduce((a, b) => a + b, 0) / (diffs.length || 1);
  const sd = Math.sqrt(diffs.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(diffs.length - 1, 1));
  const se = sd / Math.sqrt(diffs.length || 1);
  const seasons = {};
  for (const [season, arr] of Object.entries(diffBySeason)) {
    const m = arr.reduce((a, b) => a + b, 0) / arr.length;
    seasons[season] = m;
  }
  return {
    name: v.name,
    used,
    all: finish(all),
    pos: Object.fromEntries(Object.entries(byPos).map(([k, a]) => [k, finish(a)])),
    season: Object.fromEntries(Object.entries(bySeason).map(([k, a]) => [k, finish(a)])),
    paired: mean,
    se,
    seasonDelta: seasons,
  };
}

const results = VARIANTS.map(scoreVariant);
const base = results[0];
function keep(r) {
  if (r.name === 'baseline') return false;
  const practical = r.paired < -0.005;
  const signal = r.paired < -2 * r.se;
  const seasonsOk = Object.values(r.seasonDelta).every(d => d <= 0.005);
  const coverOk = r.all.cover >= base.all.cover - 0.005;
  const rhoOk = r.all.rho == null || base.all.rho == null || r.all.rho >= base.all.rho - 0.005;
  const posOk = ['QB', 'RB', 'WR', 'TE'].every(pos => r.pos[pos].n < 500 || r.pos[pos].mae <= base.pos[pos].mae + 0.02);
  const biasOk = Math.abs(r.all.bias) <= Math.abs(base.all.bias) + 0.05;
  return practical && signal && seasonsOk && coverOk && rhoOk && posOk && biasOk;
}

const f = x => (x == null || !Number.isFinite(x)) ? 'n/a' : x.toFixed(3);
const pct = x => (100 * x).toFixed(1) + '%';
console.log('\nPooled (negative paired MAE is an improvement)');
console.log('variant'.padEnd(24), 'n'.padStart(6), 'MAE'.padStart(7), 'RMSE'.padStart(7), 'bias'.padStart(7), 'cover'.padStart(7), 'rho'.padStart(6), 'dMAE'.padStart(8), 'SE'.padStart(7), 'keep');
for (const r of results) {
  console.log(
    r.name.padEnd(24),
    String(r.all.n).padStart(6),
    f(r.all.mae).padStart(7),
    f(r.all.rmse).padStart(7),
    f(r.all.bias).padStart(7),
    pct(r.all.cover).padStart(7),
    f(r.all.rho).padStart(6),
    f(r.paired).padStart(8),
    f(r.se).padStart(7),
    keep(r) ? 'YES' : '',
  );
}
console.log('\nBy season MAE');
const seasons = Object.keys(base.season).sort();
console.log('variant'.padEnd(24), seasons.map(s => s.padStart(8)).join(' '), '  deltas');
for (const r of results) {
  console.log(
    r.name.padEnd(24),
    seasons.map(s => f(r.season[s] && r.season[s].mae)).join(' ').padStart(8 * seasons.length),
    seasons.map(s => f(r.seasonDelta[s])).join(' '),
  );
}
console.log('\nBy position MAE (baseline then each variant delta)');
console.log('variant'.padEnd(24), ['QB', 'RB', 'WR', 'TE'].map(p => p.padStart(8)).join(''));
for (const r of results) {
  console.log(r.name.padEnd(24), ['QB', 'RB', 'WR', 'TE'].map(p => f(r.pos[p].mae).padStart(8)).join(''));
}
const avail = data.avail || {};
console.log('\nFeature coverage (player-weeks where the input existed)', JSON.stringify(avail));
console.log('diag', JSON.stringify(data.diag));
const winners = results.filter(keep);
const outPath = process.argv[3] || '/tmp/gibbs/results.json';
fs.writeFileSync(outPath, JSON.stringify({ avail, diag: data.diag, winners: winners.map(r => r.name), results }, null, 2));
console.log('\nWINNERS', winners.map(r => r.name).join(', ') || 'none');
