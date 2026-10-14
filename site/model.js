/* Projection math for Matchup Lab.
   Loaded with a script tag in the browser (window.MLModel) and via require() in Node.
   No build step. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MLModel = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const SCORING = {
    ppr:  { name: 'PPR',      rec: 1,   py: 0.04, ptd: 4, int: -2, ry: 0.1, rtd: 6, rcy: 0.1, rctd: 6, fl: -2, two: 2 },
    half: { name: 'Half-PPR', rec: 0.5, py: 0.04, ptd: 4, int: -2, ry: 0.1, rtd: 6, rcy: 0.1, rctd: 6, fl: -2, two: 2 },
    std:  { name: 'Standard', rec: 0,   py: 0.04, ptd: 4, int: -2, ry: 0.1, rtd: 6, rcy: 0.1, rctd: 6, fl: -2, two: 2 },
  };

  function lgamma(x) { // Lanczos
    const g = 7, c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
    if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lgamma(1 - x);
    x -= 1; let a = c[0]; const t = x + g + 0.5;
    for (let i = 1; i < g + 2; i++) a += c[i] / (x + i);
    return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
  }
  function gammaP(a, x) { // regularized lower incomplete gamma
    if (x <= 0) return 0;
    if (x < a + 1) { let sum = 1 / a, del = sum, ap = a; for (let n = 0; n < 500; n++) { ap += 1; del *= x / ap; sum += del; if (Math.abs(del) < Math.abs(sum) * 1e-12) break; } return sum * Math.exp(-x + a * Math.log(x) - lgamma(a)); }
    let b = x + 1 - a, c = 1e300, d = 1 / b, h = d;
    for (let i = 1; i < 500; i++) { const an = -i * (i - a); b += 2; d = an * d + b; if (Math.abs(d) < 1e-300) d = 1e-300; c = b + an / c; if (Math.abs(c) < 1e-300) c = 1e-300; d = 1 / d; const del = d * c; h *= del; if (Math.abs(del - 1) < 1e-12) break; }
    return 1 - Math.exp(-x + a * Math.log(x) - lgamma(a)) * h;
  }
  function makeDist(mean, cv) {
    const m = Math.max(mean, 0.5), sd = Math.max(m * cv, 0.5);
    const k = (m / sd) ** 2, theta = sd * sd / m;
    const cdf = x => gammaP(k, Math.max(x, 0) / theta);
    const quantile = p => { let lo = 0, hi = m + 8 * sd; for (let i = 0; i < 60; i++) { const mid = (lo + hi) / 2; if (cdf(mid) < p) lo = mid; else hi = mid; } return (lo + hi) / 2; };
    const pdf = x => x <= 0 ? 0 : Math.exp((k - 1) * Math.log(x) - x / theta - lgamma(k) - k * Math.log(theta));
    return { mean: m, sd, k, theta, cdf, quantile, pdf, pOver: x => 1 - cdf(x) };
  }

  const blend = (num, den, prior, k) => (num + prior * k) / (den + k);
  const pw = (f, e) => Math.pow(f ?? 1, e);
  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
  const f1 = n => (Math.round(n * 10) / 10).toFixed(1);
  const normName = s => String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/g, '').replace(/[^a-z]/g, '');

  function gameFor(team, week, data) {
    const games = (data.schedule && data.schedule[week]) || [];
    return games.find(g => g.home === team || g.away === team) || null;
  }

  function leaguePts(env) {
    if (env._lgPts) return env._lgPts;
    const v = Object.values(env.data.defense).map(d => d.allowed.pts_pg).filter(Number.isFinite);
    return (env._lgPts = v.length ? v.reduce((a, b) => a + b, 0) / v.length : 22);
  }

  function weatherAdj(g, wx) {
    const w = g && wx && wx[g.id];
    const out = { pass: 1, rushAtt: 1, fl: 1, tags: [], bad: false };
    if (!w || w.status !== 'ok') return out;
    const ws = w.wind;
    let windCut = 0.006 * Math.max(0, Math.min(ws, 15) - 10) + 0.016 * Math.max(0, Math.min(ws, 20) - 15) + 0.012 * Math.max(0, ws - 20);
    if (w.gust >= 35 && ws < 20) windCut += 0.02;
    let wetCut = 0, rushUp = 0.004 * Math.max(0, Math.min(ws, 27) - 12);
    const rainy = w.precip >= 0.04 && w.pop >= 40;
    if (w.snow >= 0.8) { wetCut = 0.15; rushUp += 0.04; out.tags.push('Heavy snow'); }
    else if (w.snow >= 0.2) { wetCut = 0.03; out.tags.push('Snow'); }
    else if (rainy && w.precip >= 0.25) { wetCut = 0.09; rushUp += 0.05; out.tags.push('Heavy rain'); }
    else if (rainy) { wetCut = 0.04; rushUp += 0.02; out.tags.push('Rain'); }
    const coldCut = w.temp <= 20 ? 0.03 : 0;
    if (ws >= 15) out.tags.unshift(`Wind ${Math.round(ws)} mph`);
    if (coldCut) out.tags.push(`Cold ${Math.round(w.temp)}°F`);
    out.pass = Math.max(0.65, (1 - Math.min(0.3, windCut)) * (1 - wetCut) * (1 - coldCut));
    out.rushAtt = 1 + Math.min(0.08, rushUp);
    out.fl = wetCut > 0 ? 1.15 : 1;
    out.bad = out.pass < 0.985;
    return out;
  }

  function vegasFor(game, team, week, env) {
    const market = env.market;
    const mk = market && market.week === week ? (market.games || {})[`${game.away}@${game.home}`] : null;
    let spreadHome = mk && mk.spread_home != null ? mk.spread_home : (game.spread_line != null ? -game.spread_line : null);
    const total = mk && mk.total != null ? mk.total : game.total_line;
    if (spreadHome == null || total == null) return null;
    const home = game.home === team;
    const teamSpread = home ? spreadHome : -spreadHome; // negative = favored
    const itt = total / 2 - teamSpread / 2, oppItt = total / 2 + teamSpread / 2;
    return { total, teamSpread, itt, oppItt, margin: -teamSpread, paceF: Math.pow(total / (2 * leaguePts(env)), 0.3), src: mk ? 'book' : 'schedule' };
  }

  function propsFor(pl, game, week, market) {
    if (!market || market.week !== week || !market.props) return null;
    const p = market.props[normName(pl.name)];
    if (!p || p.game !== `${game.away}@${game.home}`) return null;
    return p;
  }

  // Market mean from a consensus line: yardage props are right-skewed (mean ~5% above the median line); shift by the no-vig over probability.
  function propMean(o, yards) {
    const shift = o.p_over != null ? 1 + 0.8 * (o.p_over - 0.5) : 1;
    return o.line * (yards ? 1.05 : 1) * shift;
  }

  const BOOM = { QB: [25, 12], RB: [20, 8], WR: [20, 8], TE: [15, 5] };
  function boomBust(pos, S, dist) {
    const sc = S.rec >= 1 ? 1 : S.rec >= 0.5 ? 0.9 : 0.8;
    const [bt, bu] = BOOM[pos] || [20, 8];
    const boomAt = pos === 'QB' ? bt : Math.round(bt * sc * 2) / 2, bustAt = pos === 'QB' ? bu : Math.round(bu * sc * 2) / 2;
    return { boomAt, bustAt, boom: dist.pOver(boomAt), bust: dist.cdf(bustAt) };
  }

  function regFlag(pl) {
    const A = pl.adv; if (!A || A.xfp_pg == null || A.fpoe_pg == null || pl.g < 2) return null;
    if (A.xfp_pg >= 9 && A.fpoe_pg <= -2.5) return { type: 'buy', label: 'Positive regression', why: `${f1(A.xfp_pg)} expected PPR pts/g from his usage vs ${f1(A.fp_pg_ep)} actual (${f1(A.fpoe_pg)}/g under expected)` };
    if (A.fpoe_pg >= 3 && A.fpoe_pg / Math.max(A.xfp_pg, 1) >= 0.25) return { type: 'fade', label: 'Fade risk', why: `${f1(A.fp_pg_ep)} actual PPR pts/g on usage worth ${f1(A.xfp_pg)} (+${f1(A.fpoe_pg)}/g over expected, likely to cool)` };
    return null;
  }

  function matchupGrade(def, pos) {
    const rk = def.ranks['fp_' + pos]; // 1 = toughest
    if (rk >= 25) return { cls: 'good', label: 'Great', rk };
    if (rk >= 18) return { cls: 'good', label: 'Good', rk };
    if (rk >= 9) return { cls: 'neutral', label: 'Neutral', rk };
    return { cls: 'bad', label: 'Tough', rk };
  }

  function project(pl, week, scoringKey, env) {
    const D = env.data, L = D.league, S = typeof scoringKey === 'object' ? scoringKey : SCORING[scoringKey];
    const game = gameFor(pl.team, week, D);
    if (!game) return { bye: true, pts: 0 };
    const home = game.home === pl.team, opp = home ? game.away : game.home;
    const def = D.defense[opp]; const F = def.factors;
    const homeAdj = home ? 1.02 : 0.98;
    const w = pl.w, t = pl.t;
    const wx = weatherAdj(game, env.wx || {}), wp = wx.pass, wpHalf = Math.sqrt(wx.pass);
    const posF = pw(def.pos_factors[pl.pos], 0.35);
    const posYF = pw((def.pos_yds_factors || {})[pl.pos], 0.3);

    // Rushing
    const ca = w.ca * pw(F.rush_att, 0.4) * homeAdj * wx.rushAtt;
    const ypc = blend(t.ry, t.ca, L.ypc, 60) * pw(F.ypc, 0.7) * (pl.pos === 'RB' ? posF : 1);
    const ry = ca * ypc;
    const rtd = ca * blend(t.rtd, t.ca, L.rush_td_rate, 60) * pw(F.rush_td, 0.5) * (pl.pos === 'RB' ? posF : 1);
    // Receiving
    const tg = w.tg * pw(F.pass_att, 0.4) * homeAdj * wpHalf;
    const catchRate = Math.min(0.95, blend(t.rc, t.tg, L.comp_pct, 15) * pw(F.comp_pct, 0.5));
    const rc = tg * catchRate;
    const ypt = blend(t.rcy, t.tg, L.ypt, 25) * pw(F.ypa, 0.5) * posYF * (pl.pos !== 'RB' ? posF : 1) * wpHalf;
    const rcy = tg * ypt;
    const rctd = tg * blend(t.rctd, t.tg, L.rec_td_rate, 50) * pw(F.pass_td, 0.5) * (pl.pos !== 'RB' ? posF : 1) * wpHalf;
    // Passing
    const pa = w.pa * pw(F.pass_att, 0.3) * homeAdj * wpHalf;
    const ypa = blend(t.py, t.pa, L.ypa, 80) * pw(F.ypa, 0.6) * (pl.pos === 'QB' ? posF : 1) * wpHalf;
    const py = pa * ypa;
    const ptd = pa * blend(t.ptd, t.pa, L.pass_td_rate, 80) * pw(F.pass_td, 0.5) * (pl.pos === 'QB' ? posF : 1) * wpHalf;
    const intc = pa * blend(t.int, t.pa, L.int_rate, 100) * pw(F.int, 0.5) / wpHalf;
    const fl = (t.fl + 0.06 * 4) / (pl.g + 4) * wx.fl;
    const two = t.two / pl.g * 0.5;

    const posBonus = S['bonus_' + pl.pos] || 0;
    const ptsOf = (k) => k.rc * posBonus + k.py * S.py + k.ptd * S.ptd + k.int * S.int + k.ry * S.ry + k.rtd * S.rtd + k.rc * S.rec + k.rcy * S.rcy + k.rctd * S.rctd + k.fl * S.fl + k.two * S.two;
    let wxDelta = 0;
    if (wx.pass !== 1 || wx.rushAtt !== 1) {
      const c0 = { pa: pa / wpHalf, py: py / wp, ptd: ptd / wp, int: intc * wpHalf, ry: ry / wx.rushAtt, rtd: rtd / wx.rushAtt, rc: rc / wpHalf, rcy: rcy / wp, rctd: rctd / wp, fl: fl / wx.fl, two };
      const cNow = { pa, py, ptd, int: intc, ry, rtd, rc, rcy, rctd, fl, two };
      wxDelta = ptsOf(cNow) - ptsOf(c0);
    }
    // baseline (no opponent adjustment) for comparison
    const b = {
      ca: w.ca, ry: w.ca * blend(t.ry, t.ca, L.ypc, 60), rtd: w.ca * blend(t.rtd, t.ca, L.rush_td_rate, 60),
      tg: w.tg, rc: w.tg * Math.min(0.95, blend(t.rc, t.tg, L.comp_pct, 15)), rcy: w.tg * blend(t.rcy, t.tg, L.ypt, 25), rctd: w.tg * blend(t.rctd, t.tg, L.rec_td_rate, 50),
      pa: w.pa, py: w.pa * blend(t.py, t.pa, L.ypa, 80), ptd: w.pa * blend(t.ptd, t.pa, L.pass_td_rate, 80), int: w.pa * blend(t.int, t.pa, L.int_rate, 100), fl, two,
    };
    const basePts = ptsOf(b);

    const C = { pa, py, ptd, int: intc, ca, ry, rtd, tg, rc, rcy, rctd, fl, two };
    const A = pl.adv || {};
    // Layer: expected-TD regression. Blend TD rates 50/50 toward expected TDs (ffopportunity xTD), keeping the opponent multiplier.
    const bTD = b.rtd + b.rctd, cTD = C.rtd + C.rctd;
    if (A.xtd_pg != null && cTD > 0 && bTD > 0) {
      const tgt = 0.5 * cTD + 0.5 * A.xtd_pg * (cTD / bTD), sc = tgt / cTD;
      C.rtd *= sc; C.rctd *= sc;
    }
    if (pl.pos === 'QB' && A.xptd_pg > 0 && C.ptd > 0 && b.ptd > 0) C.ptd = 0.5 * C.ptd + 0.5 * A.xptd_pg * (C.ptd / b.ptd);
    // Layer: Vegas environment (implied team total, spread game script, total-driven pace)
    const vg = vegasFor(game, pl.team, week, env);
    let itt = null;
    if (vg) {
      const passS = clamp(1 - 0.008 * vg.margin, 0.92, 1.08) * vg.paceF, rushS = clamp(1 + 0.008 * vg.margin, 0.92, 1.08) * vg.paceF;
      for (const k of ['pa', 'py', 'ptd', 'int', 'tg', 'rc', 'rcy', 'rctd']) C[k] *= passS;
      for (const k of ['ca', 'ry', 'rtd']) C[k] *= rushS;
      const off = D.team_off[pl.team] || {}, lgP = leaguePts(env);
      const raw = (off.pts_pg || lgP) * ((def.allowed && def.allowed.pts_pg) || lgP) / lgP;
      const modelTP = 0.7 * raw + 0.3 * lgP;
      itt = { modelTP, f: clamp(vg.itt / modelTP, 0.7, 1.4) };
      const tdF = Math.pow(itt.f, 0.5), ydF = Math.pow(itt.f, 0.2);
      C.ptd *= tdF; C.rtd *= tdF; C.rctd *= tdF; C.py *= ydF; C.ry *= ydF; C.rcy *= ydF;
    }
    const modelPts = ptsOf(C);
    const modelC = { ...C };
    // Layer: player props as market-implied expectation (50/50 blend per component with a posted line)
    const pm = propsFor(pl, game, week, env.market);
    let mktPts = null, diverge = null; const propUsed = [];
    if (pm) {
      const M = { ...C };
      const put = (key, comp, yards) => { const o = pm[key]; if (!o || o.line == null) return; M[comp] = propMean(o, yards); propUsed.push(comp); };
      put('rec_yds', 'rcy', true); put('rush_yds', 'ry', true); put('rec', 'rc', false); put('pass_yds', 'py', true);
      if (pm.pass_att && pm.pass_att.line != null) {
        const r0 = propMean(pm.pass_att, false) / Math.max(C.pa, 1); M.pa = C.pa * r0; propUsed.push('pa');
        if (!pm.pass_yds) { M.py = C.py * r0; } M.ptd = C.ptd * r0; M.int = C.int * r0;
      }
      if (pm.atd && pm.atd.p > 0 && pm.atd.p < 0.95) {
        const lam = -Math.log(1 - pm.atd.p);
        const td = C.rtd + (pl.pos === 'QB' ? 0 : C.rctd);
        if (td > 0) { const sc = lam / td; M.rtd = C.rtd * sc; if (pl.pos !== 'QB') M.rctd = C.rctd * sc; propUsed.push('rtd'); if (pl.pos !== 'QB') propUsed.push('rctd'); }
      }
      if (propUsed.length) {
        mktPts = ptsOf(M);
        for (const k of new Set(propUsed.concat(propUsed.includes('pa') ? ['ptd', 'int'] : []))) C[k] = 0.5 * C[k] + 0.5 * M[k];
        const dlt = mktPts - modelPts;
        if (Math.abs(dlt) >= 2 && Math.abs(dlt) / Math.max(modelPts, 1) >= 0.15) diverge = dlt > 0 ? 'higher' : 'lower';
      }
    }
    const comps = C;
    const pts = ptsOf(C);
    const dist = makeDist(pts, pl.cv);
    const grade = matchupGrade(def, pl.pos);
    const bb = boomBust(pl.pos, S, dist);
    return { bye: false, wx, wxDelta, game, home, opp, def, comps, base: b, pts, basePts, modelPts, modelC, mktPts, diverge, pm, propUsed, vg, itt, bb,
      dist, grade, floor: dist.quantile(0.1), ceil: dist.quantile(0.9), p15: dist.pOver(15), p20: dist.pOver(20), reg: regFlag(pl) };
  }

  return { SCORING, lgamma, gammaP, makeDist, project, gameFor, weatherAdj, vegasFor, propsFor, boomBust, matchupGrade, normName, blend };
});
