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
  // Player CV is scatter around that player's own mean. On the full 2024 and
  // 2025 seasons, walk-forward forecast errors were about 1.16× wider than that
  // CV implies. A normal matched to the variance covers ~76% between P10 and
  // P90, because the residuals are a little heavier than gaussian, so the
  // interval uses 1.25× and lands near 80% on both seasons. One scale, not a
  // per-position fit: position gaps were small next to the four-week sample.
  const PREDICTIVE_SPREAD = 1.25;

  function erf(z) {
    const t = 1 / (1 + 0.3275911 * Math.abs(z));
    const poly = (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t;
    const e = 1 - poly * Math.exp(-z * z);
    return z < 0 ? -e : e;
  }
  // Acklam's inverse normal, accurate to about 1e-9.
  function invNorm(p) {
    const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
    const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01];
    const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
    const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];
    const plow = 0.02425;
    if (p < plow) {
      const q = Math.sqrt(-2 * Math.log(p));
      return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
    }
    if (p > 1 - plow) {
      const q = Math.sqrt(-2 * Math.log(1 - p));
      return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
    }
    const q = p - 0.5, r = q * q;
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }

  function makeDist(mean, cv) {
    const m = Number.isFinite(mean) ? mean : 0;
    const sd = Math.max(Math.abs(m) * (Number.isFinite(cv) ? cv : 0) * PREDICTIVE_SPREAD, 0.5);
    const cdf = x => 0.5 * (1 + erf(((x - m) / sd) / Math.SQRT2));
    const quantile = p => m + sd * invNorm(Math.min(Math.max(p, 1e-12), 1 - 1e-12));
    const pdf = x => Math.exp(-0.5 * ((x - m) / sd) ** 2) / (sd * Math.sqrt(2 * Math.PI));
    return { mean: m, sd, cdf, quantile, pdf, pOver: x => 1 - cdf(x) };
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
    const gameKey = `${game.away}@${game.home}`;
    const espn = pl.ids && pl.ids.espn ? String(pl.ids.espn) : null;
    // Props are keyed by ESPN id. A name key is only a fallback for an older
    // file, and only when that record is not tagged as a different player.
    const byId = espn ? market.props[espn] : null;
    const byName = market.props[normName(pl.name)];
    const p = byId || (!espn ? byName : (byName && !byName.espn ? byName : null));
    if (!p || p.game !== gameKey) return null;
    if (p.espn && espn && String(p.espn) !== espn) return null;
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

  // Attempts below this are a backup's recent usage, so a charted starter can
  // take the volume of the teammate who was actually playing the job. A QB
  // already throwing starter volume (about 12+ attempts) keeps his own line.
  const QB_INHERIT_PA = 12;
  const QB_CAP_PA = 8;
  const QB_BACKUP_PA = 2.5;
  const ROLE_DECAY = 0.7;
  // Share of the usage line taken from recent offensive snap share. 0.35 is the
  // only study change that lowered full-season error without leaving the
  // calibrated range. The other knobs below stay at the previous model.
  const SNAP_BLEND = 0.35;
  const THIN_VOLUME = { RB: ['ca', 6], WR: ['tg', 3.5], TE: ['tg', 3.5] };
  // Healthy-and-in-role floor. The 1.25 spread describes every week mixed
  // together, including sits and early exits, and that is what makes a
  // starter's bad week look negative. A starter who is actually expected to
  // play uses a tighter spread measured on healthy games: about 1.05 QB,
  // 1.00 RB, 0.95 WR, 0.85 TE. The number is that normal's 10th percentile,
  // bounded at 0. A lognormal with the same spread put about 16% of healthy
  // starter weeks under the floor, so the percentile stays on the normal.
  // Sitting out, leaving hurt, or losing the role stays outside this floor.
  const HEALTHY_SPREAD = { QB: 1.05, RB: 1.00, WR: 0.95, TE: 0.85 };
  const ROLE_FLOOR_N = 12;
  const HURT_STATUS = /^(q|questionable|doubtful|out|ir|injured reserve|injury reserve|pup|sus|suspended|suspension|na|cov)$/i;
  // Volume and snap share below a starter's workload. These players keep the
  // wider floor. Snap is optional; a missing share does not by itself make a role thin.
  const ROLE_VOL = { QB: ['pa', 18], RB: ['ca', 8], WR: ['tg', 5.5], TE: ['tg', 4.5] };
  const ROLE_SNAP = { QB: 0.6, RB: 0.4, WR: 0.58, TE: 0.55 };
  const idIndex = new WeakMap();

  function playersById(data) {
    let map = idIndex.get(data);
    if (map) return map;
    map = new Map();
    for (const p of data.players || []) if (p && p.id != null) map.set(String(p.id), p);
    idIndex.set(data, map);
    return map;
  }

  function tuneOf(env) {
    const t = (env && env.tune) || {};
    const num = (v, d) => v == null || !Number.isFinite(Number(v)) ? d : Number(v);
    return {
      effK: num(t.effK, 1),
      posExp: num(t.posExp, 0.35),
      posYExp: num(t.posYExp, 0.3),
      vegasSkill: num(t.vegasSkill, 1),
      pprBlend: num(t.pprBlend, 0),
      backupPull: num(t.backupPull, 0),
      snapBlend: num(t.snapBlend, SNAP_BLEND),
      decay: num(t.decay, ROLE_DECAY),
      perGame: !!t.perGame,
      // Left at 0. A capped pregame bump for missing defenders did not beat
      // the opponent factor on the 2024, 2025, or 2026 walk-forward.
      defInj: num(t.defInj, 0),
      defInjCap: num(t.defInjCap, 0.05),
      defQ: num(t.defQ, 0.25),
      defLevel: !!t.defLevel,
    };
  }

  // Pregame shock: this week's missing share minus the share already missing
  // in earlier games. Pass defense moves QB/WR/TE; run defense moves RB.
  // The multiplier is capped so one cluster of injuries cannot rewrite the line.
  function defenseInjury(env, team, week, o) {
    const none = { pass: 1, run: 1, note: null };
    if (!o || !(o.defInj > 0) || !team) return none;
    const table = env && env.data && env.data.def_avail;
    const row = table && table[String(week)] && table[String(week)][team];
    if (!row) return none;
    const q = o.defQ;
    const miss = (unit) => (Number(row[unit + '_out']) || 0) + (Number(row[unit + '_doubt']) || 0) + q * (Number(row[unit + '_q']) || 0);
    const base = (unit) => o.defLevel ? 0 : ((Number(row[unit + '_out_base']) || 0) + (Number(row[unit + '_doubt_base']) || 0) + q * (Number(row[unit + '_q_base']) || 0));
    const mul = (unit) => clamp(1 + o.defInj * (miss(unit) - base(unit)), 1 - o.defInjCap, 1 + o.defInjCap);
    const pass = mul('pass'), run = mul('run');
    const note = (pass !== 1 || run !== 1) && row.names && row.names.length ? row.names.slice(0, 3).join(', ') : null;
    return { pass, run, note };
  }

  function priorGames(mate, week, perGame) {
    const rows = (mate.log || []).filter(g => (g.prior ? perGame : false) || (!g.prior && g.wk < week));
    rows.sort((a, b) => (a.ord || a.wk) - (b.ord || b.wk));
    return rows;
  }

  function priorWeighted(mate, week, key, tune) {
    const decay = tune && tune.decay != null ? tune.decay : ROLE_DECAY;
    const perGame = !!(tune && tune.perGame);
    const prior = priorGames(mate, week, perGame);
    if (!prior.length) return null;
    const cur = week - 1;
    let wsum = 0, acc = 0;
    for (let i = 0; i < prior.length; i++) {
      const g = prior[i];
      const wt = perGame ? decay ** (prior.length - 1 - i) : decay ** (cur - g.wk);
      wsum += wt;
      acc += wt * (Number(g[key]) || 0);
    }
    return wsum ? acc / wsum : null;
  }

  // League ypt and receiving-TD rate mix RB checkdowns with WR and TE routes.
  // Shrinking every position toward that mix under-projects WR yards and TE
  // touchdowns and over-projects RB receiving. Use the position rate when the
  // bundle has one.
  function posPrior(data, pos, numKey, denKey, fallback) {
    const lp = data.league_pos && data.league_pos[pos];
    const num = lp && Number(lp[numKey]);
    const den = lp && Number(lp[denKey]);
    if (den > 0 && Number.isFinite(num)) return num / den;
    return fallback;
  }

  // Depth chart + injury report for this week. No roles in the file means the
  // published volume is used as-is, so an older data bundle still projects.
  function roleVolume(pl, week, data, tune) {
    const w = { ...(pl.w || {}) };
    const roles = data.roles && data.roles[String(week)];
    if (!roles || !pl.team || pl.id == null) return w;
    const chart = (((roles.chart || {})[pl.team] || {})[pl.pos] || []).map(String);
    if (!chart.length) return w;
    const id = String(pl.id);
    if (!chart.includes(id)) return w;
    const ruledOut = new Set((roles.out || []).map(String));
    const active = chart.find(pid => !ruledOut.has(pid));
    if (!active) return w;
    const mates = playersById(data);
    if (pl.pos === 'QB') {
      const own = Number(w.pa) || 0;
      if (id === active && own < QB_INHERIT_PA) {
        let best = own;
        for (const pid of chart) {
          if (pid === id) continue;
          const mate = mates.get(pid);
          const pa = mate && priorWeighted(mate, week, 'pa', tune);
          if (pa != null && pa > best) best = pa;
        }
        w.pa = best;
      } else if (id !== chart[0] && !ruledOut.has(chart[0]) && own > QB_CAP_PA) {
        // Cap only when the charted starter's own line is still a backup's,
        // which is the same week he takes over that teammate's volume. A
        // chart that still lists a benched quarterback first must not wipe
        // out the player who has actually been throwing.
        const starter = mates.get(chart[0]);
        const starterPa = starter && priorWeighted(starter, week, 'pa', tune);
        if (starterPa != null && starterPa < QB_INHERIT_PA) w.pa = QB_BACKUP_PA;
      }
    } else {
      const thin = THIN_VOLUME[pl.pos];
      if (thin && id === active && (Number(w[thin[0]]) || 0) < thin[1]) {
        const key = thin[0];
        let best = Number(w[key]) || 0;
        for (const pid of chart) {
          if (pid === id || !ruledOut.has(pid)) continue;
          const mate = mates.get(pid);
          const v = mate && priorWeighted(mate, week, key, tune);
          if (v != null && v > best) best = v;
        }
        w[key] = best;
      }
    }
    // Optional extra pull for a charted non-starter behind a healthy starter.
    // The default is zero, which leaves published usage alone.
    const pull = tune && tune.backupPull || 0;
    if (pull > 0 && id !== active && !ruledOut.has(chart[0])) {
      if (pl.pos === 'QB') w.pa = (Number(w.pa) || 0) * (1 - pull) + QB_BACKUP_PA * pull;
      else {
        const thin = THIN_VOLUME[pl.pos];
        if (thin) w[thin[0]] = (Number(w[thin[0]]) || 0) * (1 - pull);
      }
    }
    return w;
  }

  function hurtStatus(pl) {
    const raw = (pl && pl.sl_inj && pl.sl_inj.status) || (pl && pl.inj && (pl.inj.status || pl.inj.st)) || '';
    return HURT_STATUS.test(String(raw).trim());
  }

  // Regression lists are buy and fade candidates, so they only include someone
  // who is actually in a role. The quarterback is the first healthy name on
  // the depth chart. A running back, receiver, or tight end needs a real snap
  // or touch share in the team's last two games. One garbage-time cameo, a
  // backup behind a healthy starter, and anyone ruled out do not qualify.
  const REG_OUT = /^(out|ir|injured reserve|injury reserve|pup|sus|suspended|suspension|doubtful|inactive|na|cov)$/i;
  const REG_RECENT = 2;

  function regStatus(pl) {
    return String((pl && pl.sl_inj && pl.sl_inj.status) || (pl && pl.inj && (pl.inj.status || pl.inj.st)) || '').trim();
  }

  function regUnavailable(pl) {
    return REG_OUT.test(regStatus(pl));
  }

  function snapShare(g) {
    if (!g || g.sp == null || g.sp === '') return null;
    const n = Number(g.sp);
    if (!Number.isFinite(n)) return null;
    return n > 1.5 ? n / 100 : n;
  }

  function regMeaningful(pl, g) {
    const sp = snapShare(g);
    const pa = Number(g.pa) || 0;
    const ca = Number(g.ca) || 0;
    const tg = Number(g.tg) || 0;
    if (pl.pos === 'QB') return pa >= 15 || (sp != null && sp >= 0.5 && pa >= 8);
    if (sp != null && sp >= 0.4) return true;
    if (pl.pos === 'RB') return ca >= 8 || ca + tg >= 10;
    return tg >= 5;
  }

  function teamGameWeeks(data, team, week) {
    const weeks = [];
    const sched = (data && data.schedule) || {};
    for (let w = 1; w < week; w++) {
      const games = sched[String(w)] || sched[w] || [];
      if (games.some(g => g && (g.home === team || g.away === team))) weeks.push(w);
    }
    return weeks;
  }

  function regRole(pl, week, data) {
    if (!pl || !data || !['QB', 'RB', 'WR', 'TE'].includes(pl.pos)) return false;
    if (regUnavailable(pl)) return false;
    const wk = Number(week);
    if (!Number.isFinite(wk)) return false;
    const roles = data.roles && (data.roles[String(wk)] || data.roles[wk]);
    const ruled = new Set(((roles && roles.out) || []).map(String));
    if (pl.id != null && ruled.has(String(pl.id))) return false;
    const byId = playersById(data);
    const rawChart = roles && roles.chart && pl.team && roles.chart[pl.team] && roles.chart[pl.team][pl.pos];
    const active = rawChart && rawChart.length
      ? rawChart.map(String).filter(id => {
        if (ruled.has(id)) return false;
        const mate = byId.get(id);
        return !(mate && regUnavailable(mate));
      })
      : null;
    const idx = active ? active.indexOf(String(pl.id)) : -1;
    if (pl.pos === 'QB' && active && active.length && idx !== 0) return false;
    const played = teamGameWeeks(data, pl.team, wk);
    const windowWeeks = played.slice(-REG_RECENT);
    const log = new Map((pl.log || []).filter(g => g && !g.prior).map(g => [Number(g.wk), g]));
    const real = windowWeeks.map(w => log.get(w)).filter(g => g && regMeaningful(pl, g));
    if (!real.length) return false;
    if (active && idx >= 0) {
      const deep = pl.pos === 'WR' ? idx >= 4 : (pl.pos === 'RB' || pl.pos === 'TE') && idx >= 2;
      if (deep && real.length < REG_RECENT) return false;
    }
    return true;
  }

  function thinRole(pl) {
    if (!pl || !ROLE_VOL[pl.pos]) return true;
    const spec = ROLE_VOL[pl.pos];
    const vol = Number(pl.w && pl.w[spec[0]]) || 0;
    if (vol < spec[1]) return true;
    const snap = pl.adv && Number(pl.adv.snap_pct);
    return Number.isFinite(snap) && snap < ROLE_SNAP[pl.pos];
  }

  // 10th percentile. Healthy starters use the tighter spread. Everyone else
  // keeps the 1.25 normal. Neither is shown below zero.
  function outcomeFloor(mean, cv, pos, role) {
    const m = Number.isFinite(mean) ? mean : 0;
    const c = Number.isFinite(cv) ? cv : 0;
    const spread = role ? (HEALTHY_SPREAD[pos] || PREDICTIVE_SPREAD) : PREDICTIVE_SPREAD;
    const s = Math.max(Math.abs(m) * c * spread, role ? 0 : 0.5);
    return Math.max(0, m + s * invNorm(0.1));
  }

  const roleRankCache = new WeakMap();

  // Rank healthy, starting-level players by this week's projection. The first
  // call projects the roster once; later calls reuse it. Ranking itself uses
  // the wide floor so it cannot recurse.
  function projectionRank(pl, week, scoringKey, env) {
    const data = env && env.data;
    if (!data || !data.players || pl.id == null) return null;
    const scoreKey = typeof scoringKey === 'string' ? scoringKey : 'custom';
    // Snap blend is part of the key so a full-workload pass cannot reuse the
    // official ranking, or leave its own ranking behind for the official one.
    const key = String(week) + '|' + scoreKey + '|s' + tuneOf(env).snapBlend;
    let bucket = roleRankCache.get(data);
    if (!bucket) { bucket = {}; roleRankCache.set(data, bucket); }
    if (!bucket[key]) {
      env._ranking = true;
      const groups = { QB: [], RB: [], WR: [], TE: [] };
      try {
        for (const p of data.players) {
          if (!groups[p.pos] || p.id == null) continue;
          if (hurtStatus(p) || thinRole(p)) continue;
          let pr;
          try { pr = project(p, week, scoringKey, env); } catch (e) { continue; }
          if (!pr || pr.bye || !(pr.pts > 0)) continue;
          groups[p.pos].push({ id: String(p.id), pts: pr.pts });
        }
      } finally {
        env._ranking = false;
      }
      const map = new Map();
      for (const pos of Object.keys(groups)) {
        groups[pos].sort((a, b) => (b.pts - a.pts) || (a.id < b.id ? -1 : 1));
        groups[pos].forEach((row, i) => map.set(pos + ':' + row.id, i + 1));
      }
      bucket[key] = map;
    }
    return bucket[key].get(pl.pos + ':' + String(pl.id)) || null;
  }

  function usesRoleFloor(pl, week, scoringKey, env) {
    if (!env || env._ranking || !env.data || !env.data.players) return false;
    if (!pl || !HEALTHY_SPREAD[pl.pos]) return false;
    if (hurtStatus(pl) || thinRole(pl)) return false;
    const rank = projectionRank(pl, week, scoringKey, env);
    return rank != null && rank <= ROLE_FLOOR_N;
  }

  function project(pl, week, scoringKey, env) {
    const D = env.data, L = D.league, S = typeof scoringKey === 'object' ? scoringKey : SCORING[scoringKey];
    const game = gameFor(pl.team, week, D);
    if (!game) return { bye: true, pts: 0 };
    const home = game.home === pl.team, opp = home ? game.away : game.home;
    const def = D.defense[opp]; const F = def.factors;
    const homeAdj = home ? 1.02 : 0.98;
    const o = tuneOf(env);
    const k = n => n * o.effK;
    const w = roleVolume(pl, week, D, o), t = pl.t;
    // Snap share is attempts or targets at this position's volume-per-snap
    // rate. No snap row means the published usage line is left alone.
    if (o.snapBlend > 0 && pl.snapImplied) {
      const b = o.snapBlend, s = pl.snapImplied;
      const mix = (cur, nxt) => nxt == null ? cur : (1 - b) * (Number(cur) || 0) + b * nxt;
      if (pl.pos === 'QB') w.pa = mix(w.pa, s.pa);
      if (pl.pos === 'RB') { w.ca = mix(w.ca, s.ca); w.tg = mix(w.tg, s.tg); }
      if (pl.pos === 'WR' || pl.pos === 'TE') w.tg = mix(w.tg, s.tg);
    }
    const yptPrior = posPrior(D, pl.pos, 'rec_yds_pg', 'tgt_pg', L.ypt);
    const rctdPrior = posPrior(D, pl.pos, 'rec_td_pg', 'tgt_pg', L.rec_td_rate);
    const wx = weatherAdj(game, env.wx || {}), wp = wx.pass, wpHalf = Math.sqrt(wx.pass);
    let posF = pw(def.pos_factors[pl.pos], o.posExp);
    let posYF = pw((def.pos_yds_factors || {})[pl.pos], o.posYExp);
    const inj = defenseInjury(env, opp, week, o);
    if (pl.pos === 'RB') posF *= inj.run;
    else {
      posF *= inj.pass;
      if (pl.pos === 'WR' || pl.pos === 'TE') posYF *= inj.pass;
    }

    // Rushing
    const ca = w.ca * pw(F.rush_att, 0.4) * homeAdj * wx.rushAtt;
    const ypc = blend(t.ry, t.ca, L.ypc, k(60)) * pw(F.ypc, 0.7) * (pl.pos === 'RB' ? posF : 1);
    const ry = ca * ypc;
    const rtd = ca * blend(t.rtd, t.ca, L.rush_td_rate, k(60)) * pw(F.rush_td, 0.5) * (pl.pos === 'RB' ? posF : 1);
    // Receiving
    const tg = w.tg * pw(F.pass_att, 0.4) * homeAdj * wpHalf;
    const catchRate = Math.min(0.95, blend(t.rc, t.tg, L.comp_pct, k(15)) * pw(F.comp_pct, 0.5));
    const rc = tg * catchRate;
    const ypt = blend(t.rcy, t.tg, yptPrior, k(25)) * pw(F.ypa, 0.5) * posYF * (pl.pos !== 'RB' ? posF : 1) * wpHalf;
    const rcy = tg * ypt;
    const rctd = tg * blend(t.rctd, t.tg, rctdPrior, k(50)) * pw(F.pass_td, 0.5) * (pl.pos !== 'RB' ? posF : 1) * wpHalf;
    // Passing
    const pa = w.pa * pw(F.pass_att, 0.3) * homeAdj * wpHalf;
    const ypa = blend(t.py, t.pa, L.ypa, k(80)) * pw(F.ypa, 0.6) * (pl.pos === 'QB' ? posF : 1) * wpHalf;
    const py = pa * ypa;
    const ptd = pa * blend(t.ptd, t.pa, L.pass_td_rate, k(80)) * pw(F.pass_td, 0.5) * (pl.pos === 'QB' ? posF : 1) * wpHalf;
    const intc = pa * blend(t.int, t.pa, L.int_rate, k(100)) * pw(F.int, 0.5) / wpHalf;
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
      ca: w.ca, ry: w.ca * blend(t.ry, t.ca, L.ypc, k(60)), rtd: w.ca * blend(t.rtd, t.ca, L.rush_td_rate, k(60)),
      tg: w.tg, rc: w.tg * Math.min(0.95, blend(t.rc, t.tg, L.comp_pct, k(15))), rcy: w.tg * blend(t.rcy, t.tg, yptPrior, k(25)), rctd: w.tg * blend(t.rctd, t.tg, rctdPrior, k(50)),
      pa: w.pa, py: w.pa * blend(t.py, t.pa, L.ypa, k(80)), ptd: w.pa * blend(t.ptd, t.pa, L.pass_td_rate, k(80)), int: w.pa * blend(t.int, t.pa, L.int_rate, k(100)), fl, two,
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
      const vw = pl.pos === 'QB' ? 1 : o.vegasSkill;
      const damp = m => 1 + (m - 1) * vw;
      const passS = damp(clamp(1 - 0.008 * vg.margin, 0.92, 1.08) * vg.paceF), rushS = damp(clamp(1 + 0.008 * vg.margin, 0.92, 1.08) * vg.paceF);
      for (const key of ['pa', 'py', 'ptd', 'int', 'tg', 'rc', 'rcy', 'rctd']) C[key] *= passS;
      for (const key of ['ca', 'ry', 'rtd']) C[key] *= rushS;
      const off = D.team_off[pl.team] || {}, lgP = leaguePts(env);
      const raw = (off.pts_pg || lgP) * ((def.allowed && def.allowed.pts_pg) || lgP) / lgP;
      const modelTP = 0.7 * raw + 0.3 * lgP;
      itt = { modelTP, f: clamp(vg.itt / modelTP, 0.7, 1.4) };
      const tdF = damp(Math.pow(itt.f, 0.5)), ydF = damp(Math.pow(itt.f, 0.2));
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
    let pts = ptsOf(C);
    // Equal-weight blend of the usage projection with trailing actual points.
    // Components scale with the blend so the player page still adds up.
    if (o.pprBlend > 0 && pl.trail != null && Number.isFinite(pl.trail) && pts > 0.5) {
      const blended = (1 - o.pprBlend) * pts + o.pprBlend * pl.trail;
      const sc = blended / pts;
      for (const key of Object.keys(C)) C[key] *= sc;
      pts = ptsOf(C);
    }
    const comps = C;
    const dist = makeDist(pts, pl.cv);
    const grade = matchupGrade(def, pl.pos);
    const bb = boomBust(pl.pos, S, dist);
    const role = usesRoleFloor(pl, week, scoringKey, env);
    return { bye: false, wx, wxDelta, game, home, opp, def, comps, base: b, pts, basePts, modelPts, modelC, mktPts, diverge, pm, propUsed, vg, itt, bb,
      dist, grade, floor: outcomeFloor(pts, pl.cv, pl.pos, role), ceil: dist.quantile(0.9), roleFloor: role,
      p15: dist.pOver(15), p20: dist.pOver(20), reg: regFlag(pl), defNote: inj.note };
  }

  // Display-only healthy-usage projection. The official project() result is
  // what rankings, start/sit, the optimal lineup, trades, and waivers use.
  const FULL_DECAY = 0.7;
  const FULL_K_SHARE = 4;
  const FULL_K_CA = 6;
  const FULL_K_PA = 6;
  const FULL_TREND = 0.25;
  const FULL_COLLAPSE = 0.2;
  const FULL_PRIOR_EFF = 0.5;
  const FULL_WORK_GAP = 1.5;
  const FULL_WORK_RATIO = 1.15;
  const fullCache = new WeakMap();

  function usageGames(pl, week) {
    return (pl.log || []).filter(g => g && !g.prior && Number(g.wk) < week);
  }

  function collapseFlags(games) {
    const snaps = [];
    for (const g of games) {
      const sp = g.sp == null ? null : Number(g.sp);
      snaps.push(sp != null && Number.isFinite(sp) ? sp : null);
    }
    const known = snaps.filter(sp => sp != null);
    const hasStarter = known.some(sp => sp >= 0.50);
    const maxSp = known.length ? Math.max.apply(null, known) : null;
    const flags = snaps.map(sp => {
      if (sp == null) return false;
      if (hasStarter && sp < 0.25) return true;
      if (maxSp != null && maxSp >= 0.55 && sp < 0.40 && sp < 0.40 * maxSp) return true;
      return false;
    });
    if (flags.length && flags.every(Boolean)) return flags.map(() => false);
    return flags;
  }

  function meanOf(games, flags, read) {
    let nume = 0, den = 0;
    for (let i = 0; i < games.length; i++) {
      const val = read(games[i]);
      if (val == null || !Number.isFinite(val)) continue;
      const w = flags[i] ? FULL_COLLAPSE : 1;
      nume += w * val;
      den += w;
    }
    return den > 0 ? [nume / den, den] : [null, 0];
  }

  function decayMean(games, week, key) {
    const cur = week - 1;
    let nume = 0, den = 0;
    for (const g of games) {
      const w = FULL_DECAY ** (cur - Number(g.wk));
      nume += w * (Number(g[key]) || 0);
      den += w;
    }
    return den ? nume / den : 0;
  }

  function bayesMean(mean, n, prior, k) {
    const hasPrior = prior != null && Number.isFinite(Number(prior));
    if (mean == null && !hasPrior) return null;
    if (!hasPrior) return mean;
    if (mean == null || !(n > 0)) return Number(prior);
    return (n * mean + k * Number(prior)) / (n + k);
  }

  function teamPlayedWeek(data, team, week) {
    const sched = data && data.schedule;
    const games = sched && (sched[String(week)] || sched[week]) || [];
    return games.some(g => g && (g.home === team || g.away === team));
  }

  function workloadPrior(pl, env) {
    const own = pl && pl.prior;
    if (own && (own.ca != null || own.ts != null || own.pa != null || (own.t && typeof own.t === 'object'))) return own;
    const bag = (env && env.priors) || (typeof globalThis !== 'undefined' ? globalThis.ML_PRIORS : null);
    if (!bag || !bag.byId) return null;
    const season = env && env.data && env.data.meta && env.data.meta.season;
    if (bag.season != null && season != null && Number(bag.season) !== Number(season)) return null;
    return bag.byId[String(pl.id)] || null;
  }

  function practiceText(pl) {
    const raw = pl && pl.inj && pl.inj.practice;
    if (raw == null) return null;
    const text = String(raw).trim();
    if (!text || /^null$/i.test(text)) return null;
    return text;
  }

  function healthyVolume(pl, week) {
    const games = usageGames(pl, week);
    if (!games.length) return null;
    const flags = collapseFlags(games);
    const share = meanOf(games, flags, g => (g.ts == null || !Number.isFinite(Number(g.ts)) ? null : Number(g.ts)));
    const carries = meanOf(games, flags, g => Number(g.ca) || 0);
    const passes = meanOf(games, flags, g => Number(g.pa) || 0);
    return { games, flags, ts: share[0], nTs: share[1], ca: carries[0], nCa: carries[1], pa: passes[0], nPa: passes[1] };
  }

  // Healthy-game usage, shrunk toward last season, plus a quarter of the
  // current recency average so a real role change still shows up. Matchup,
  // Vegas, expected TDs, and a posted prop blend stay on the normal stack.
  function fullWorkload(pl, week, scoringKey, env) {
    if (!pl || !pl.team || !env || !env.data) return null;
    const scoreKey = typeof scoringKey === 'string' ? scoringKey : 'custom';
    const cached = fullCache.get(pl);
    const cacheKey = String(week) + '|' + scoreKey;
    if (cached && cached.key === cacheKey && cached.env === env) return cached.val;
    const store = val => { fullCache.set(pl, { key: cacheKey, env, val }); return val; };
    try {
      const mine = healthyVolume(pl, week);
      if (!mine) return store(null);
      const last = mine.games.reduce((m, g) => Math.max(m, Number(g.wk) || 0), 0);
      let missed = false;
      for (let w = last + 1; w < week; w++) {
        if (teamPlayedWeek(env.data, pl.team, w)) { missed = true; break; }
      }
      const collapsed = mine.flags.some(Boolean);
      if (!missed && !collapsed) return store(null);
      const official = project(pl, week, scoringKey, env);
      if (!official || official.bye || !Number.isFinite(official.pts)) return store(null);
      const prior = workloadPrior(pl, env);
      const off = env.data.team_off && env.data.team_off[pl.team];
      const teamPa = off && Number(off.pass_att_pg) > 0 ? Number(off.pass_att_pg) : 32;
      let ts = bayesMean(mine.ts, mine.nTs, prior && prior.ts, FULL_K_SHARE);
      let ca = bayesMean(mine.ca, mine.nCa, prior && prior.ca, FULL_K_CA);
      let pa = bayesMean(mine.pa, mine.nPa, prior && prior.pa, FULL_K_PA);
      const roles = env.data.roles && (env.data.roles[String(week)] || env.data.roles[week]);
      const chart = roles && roles.chart && roles.chart[pl.team] && roles.chart[pl.team][pl.pos];
      const out = new Set(((roles && roles.out) || []).map(String));
      const id = String(pl.id);
      if (chart && chart.length && !out.has(id)) {
        const active = chart.map(String).filter(pid => !out.has(pid));
        if (active.length && active[0] === id) {
          const mates = chart.map(String).filter(pid => out.has(pid) && pid !== id);
          const byId = playersById(env.data);
          let bestCa = 0, bestTs = 0, bestPa = 0;
          for (const pid of mates) {
            const mate = byId.get(pid);
            if (!mate || mate.pos !== pl.pos) continue;
            const vol = healthyVolume(mate, week);
            if (!vol) continue;
            if ((vol.ca || 0) > bestCa) bestCa = vol.ca;
            if ((vol.ts || 0) > bestTs) bestTs = vol.ts;
            if ((vol.pa || 0) > bestPa) bestPa = vol.pa;
          }
          if (pl.pos === 'QB' && bestPa > (pa || 0)) pa = bestPa;
          if (pl.pos === 'RB' && bestCa > (ca || 0)) ca = bestCa;
          if ((pl.pos === 'WR' || pl.pos === 'TE' || pl.pos === 'RB') && ts != null && bestTs > ts) ts = bestTs;
        }
      }
      const recentTg = decayMean(mine.games, week, 'tg');
      const recentCa = decayMean(mine.games, week, 'ca');
      const recentPa = decayMean(mine.games, week, 'pa');
      let tg = ts == null ? null : ts * teamPa;
      tg = tg == null ? recentTg : (1 - FULL_TREND) * tg + FULL_TREND * recentTg;
      ca = ca == null ? recentCa : (1 - FULL_TREND) * ca + FULL_TREND * recentCa;
      pa = pa == null ? recentPa : (1 - FULL_TREND) * pa + FULL_TREND * recentPa;
      const totals = {};
      const countKeys = ['pa', 'py', 'ptd', 'int', 'ca', 'ry', 'rtd', 'tg', 'rc', 'rcy', 'rctd', 'fl'];
      for (const key of countKeys) {
        let sum = 0;
        for (const g of mine.games) sum += Number(g[key]) || 0;
        if (prior && prior.t && prior.t[key] != null) sum += FULL_PRIOR_EFF * Number(prior.t[key]);
        totals[key] = sum;
      }
      const clone = Object.assign({}, pl, {
        w: Object.assign({}, pl.w, { pa, ca, tg }),
        t: Object.assign({}, pl.t, totals),
        g: mine.games.length,
      });
      const fullEnv = Object.assign({}, env, { tune: Object.assign({}, env.tune, { snapBlend: 0 }) });
      const full = project(clone, week, scoringKey, fullEnv);
      if (!full || full.bye || !Number.isFinite(full.pts)) return store(null);
      const gateOff = scoreKey === 'ppr' ? official : project(pl, week, 'ppr', env);
      const gateFull = scoreKey === 'ppr' ? full : project(clone, week, 'ppr', fullEnv);
      if (!gateOff || !gateFull || !(gateFull.pts >= gateOff.pts + FULL_WORK_GAP) || !(gateFull.pts >= gateOff.pts * FULL_WORK_RATIO)) return store(null);
      return store({
        pts: full.pts,
        base: official.pts,
        practice: practiceText(pl),
        missed,
        collapsed,
      });
    } catch (e) {
      return store(null);
    }
  }

  return { SCORING, lgamma, gammaP, makeDist, PREDICTIVE_SPREAD, SNAP_BLEND, HEALTHY_SPREAD, ROLE_FLOOR_N, FULL_WORK_GAP, FULL_WORK_RATIO, project, fullWorkload, outcomeFloor, hurtStatus, thinRole, regRole, gameFor, weatherAdj, vegasFor, propsFor, propMean, boomBust, matchupGrade, normName, blend };
});
