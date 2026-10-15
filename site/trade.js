/* Trade values for Matchup Lab.
   The weekly projection model is not modified. This file only sums it.

   Formula
   -------
   Rest of season, for each scoring format (PPR, half-PPR, standard):
     Sum the existing weekly projection over every remaining regular-season
     game (bye weeks add nothing). One projection per week is scored three
     ways from the same counting stats.

   Games missed:
     IR, PUP, or suspended: the rest of this season.
     Out: 1 game. Doubtful: 0.75. Questionable: 0.25.
     Limited or DNP practice, with no worse report: 0.25.
     A news headline raises the discount only when it states one of those
     statuses. A vague injury blurb does not.
     Adjusted points = raw points × max(0, games − missed) / games.

   Scarcity is the replacement line for a 12-team league:
     1QB:     QB12, RB30, WR36, TE12
     Superflex: QB24, RB30, WR36, TE12
     (RB30 and WR36 stand in for two starters plus the flex.)
     Points above replacement = player − the last starter at that position.
     The 0–100 scale divides by the largest positive surplus in that
     scoring / quarterback / horizon setting. A player at or below
     replacement keeps a fallback of at most 8, proportional to how close
     their points are to the replacement line.

   Dynasty is 60% rest-of-season (after the injury discount) and 40% a
   next-season outlook: current points per game × 17 × age curve × role
   (volume versus the positional median, 0.75–1.15) × team offense
   (points per game versus the league, clamped 0.90–1.10). An IR tag
   zeroes this season and leaves the next-season piece.

   Consolidation: each extra player on the deeper side discounts that
   side by 4% of its total, capped at 12%. A 2-for-1 is a 4% depth
   discount. The same player on both sides is dropped from both totals.
   A duplicate on one side is kept once.

   Grades use the gap as a share of the larger side:
     ≤4% A+ fair, ≤8% A fair, ≤12% B slight edge,
     ≤18% C clear winner, ≤26% D lopsided, else F lopsided.
*/
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MLTrade = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const SCORINGS = ['ppr', 'half', 'std'];
  const QB_MODES = ['qb1', 'sflex'];
  const SLOTS = {
    qb1: { QB: 12, RB: 30, WR: 36, TE: 12 },
    sflex: { QB: 24, RB: 30, WR: 36, TE: 12 },
  };
  const DYNASTY_ROS = 0.6;
  const DYNASTY_NEXT = 0.4;
  const CONSOLIDATION = 0.04;
  const CONSOLIDATION_CAP = 0.12;
  const TOP_N = 150;
  const FALLBACK_CAP = 8;
  const SEASON_WEEKS = 17;

  const AGE_CURVE = {
    QB: { start: 24, peak0: 28, peak1: 33, cliff: 38 },
    RB: { start: 21, peak0: 23, peak1: 26, cliff: 30 },
    WR: { start: 22, peak0: 25, peak1: 29, cliff: 33 },
    TE: { start: 22, peak0: 26, peak1: 29, cliff: 33 },
  };

  function round1(n) { return Math.round(n * 10) / 10; }
  function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }
  function num(v) { return Number(v) || 0; }

  function missFromText(text) {
    const s = String(text || '').toLowerCase();
    if (!s) return 0;
    if (/\bir\b|injured reserve|\bpup\b|suspend/.test(s)) return Infinity;
    if (/ruled out|\bout\b/.test(s)) return 1;
    if (/doubtful/.test(s)) return 0.75;
    if (/questionable|limited|did not practice|\bdnp\b/.test(s)) return 0.25;
    return 0;
  }

  function statusMiss(player) {
    const sl = player && player.sl_inj && player.sl_inj.status;
    if (sl) return missFromText(sl);
    const inj = player && player.inj;
    if (!inj) return 0;
    if (inj.status) return missFromText(inj.status);
    return missFromText(inj.practice);
  }

  function newsMiss(items) {
    let miss = 0;
    for (const it of items || []) {
      if (!it || !it.injury) continue;
      const m = missFromText(it.headline);
      if (m === Infinity) return Infinity;
      if (m > miss) miss = m;
    }
    return miss;
  }

  function combineMiss(status, news) {
    if (status === Infinity || news === Infinity) return Infinity;
    return Math.max(status || 0, news || 0);
  }

  function availability(games, miss) {
    if (!games) return miss === Infinity ? 0 : 1;
    if (miss === Infinity) return 0;
    return Math.max(0, (games - (miss || 0)) / games);
  }

  function ageFactor(pos, age) {
    const c = AGE_CURVE[pos];
    if (!c || age == null || !Number.isFinite(age)) return 1;
    if (age < c.start) return 0.9;
    if (age < c.peak0) return 0.9 + 0.18 * ((age - c.start) / (c.peak0 - c.start));
    if (age <= c.peak1) return 1.08;
    if (age >= c.cliff) return 0.4;
    const t = (age - c.peak1) / (c.cliff - c.peak1);
    return 1.08 - t * 0.68;
  }

  function volumeOf(pl) {
    const w = pl.w || {};
    if (pl.pos === 'QB') return num(w.pa);
    if (pl.pos === 'RB') return num(w.ca) + num(w.tg);
    return num(w.tg);
  }

  function median(nums) {
    if (!nums.length) return 0;
    const s = nums.slice().sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  function roleFactor(pl, medians) {
    const med = medians[pl.pos];
    if (!med) return 1;
    const ratio = volumeOf(pl) / med;
    return clamp(0.85 + 0.15 * Math.min(ratio, 2), 0.75, 1.15);
  }

  function teamFactor(pl, leaguePts, teamOff) {
    const off = teamOff && teamOff[pl.team];
    if (!off || !leaguePts) return 1;
    return clamp(num(off.pts_pg) / leaguePts, 0.9, 1.1);
  }

  function pointsOf(comps, S) {
    if (!comps || !S) return 0;
    return num(comps.py) * S.py + num(comps.ptd) * S.ptd + num(comps.int) * S.int
      + num(comps.ry) * S.ry + num(comps.rtd) * S.rtd
      + num(comps.rc) * S.rec + num(comps.rcy) * S.rcy + num(comps.rctd) * S.rctd
      + num(comps.fl) * S.fl + num(comps.two) * S.two;
  }

  function remainingWeeks(data) {
    const start = (data.meta && data.meta.next_week) || 1;
    const weeks = [];
    for (let w = start; w <= 18; w++) weeks.push(w);
    return weeks;
  }

  function sumOutlook(pl, data, project, scoringTable) {
    const weeks = remainingWeeks(data);
    const raw = { ppr: 0, half: 0, std: 0 };
    let games = 0;
    const env = { data };
    for (const week of weeks) {
      let pr;
      try { pr = project(pl, week, 'ppr', env); } catch (e) { continue; }
      if (!pr || pr.bye || !pr.comps) continue;
      games += 1;
      for (const key of SCORINGS) raw[key] += pointsOf(pr.comps, scoringTable[key]);
    }
    return { raw, games };
  }

  function replacementPoints(rows, slot) {
    if (!rows.length) return 0;
    const sorted = rows.slice().sort((a, b) => b.pts - a.pts);
    const idx = Math.min(slot, sorted.length) - 1;
    return sorted[Math.max(0, idx)].pts;
  }

  function scaled(par, points, replacement, maxPar) {
    if (par > 0 && maxPar > 0) return round1(100 * par / maxPar);
    if (points > 0 && replacement > 0) return round1(Math.min(FALLBACK_CAP, FALLBACK_CAP * points / replacement));
    return 0;
  }

  function spearman(xs, ys) {
    const n = xs.length;
    if (n < 3 || n !== ys.length) return null;
    const rank = arr => {
      const order = arr.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
      const out = new Array(n);
      let i = 0;
      while (i < n) {
        let j = i;
        while (j + 1 < n && order[j + 1][0] === order[i][0]) j++;
        const avg = (i + j) / 2 + 1;
        for (let k = i; k <= j; k++) out[order[k][1]] = avg;
        i = j + 1;
      }
      return out;
    };
    const rx = rank(xs), ry = rank(ys);
    const mx = rx.reduce((s, v) => s + v, 0) / n;
    const my = ry.reduce((s, v) => s + v, 0) / n;
    let nume = 0, dx = 0, dy = 0;
    for (let i = 0; i < n; i++) {
      const a = rx[i] - mx, b = ry[i] - my;
      nume += a * b; dx += a * a; dy += b * b;
    }
    if (dx === 0 || dy === 0) return null;
    return nume / Math.sqrt(dx * dy);
  }

  function attachTrade(data, opts) {
    opts = opts || {};
    const project = opts.project;
    if (!project) throw new Error('attachTrade needs the projection function');
    const scoringTable = opts.scoring || {
      ppr: { rec: 1, py: 0.04, ptd: 4, int: -2, ry: 0.1, rtd: 6, rcy: 0.1, rctd: 6, fl: -2, two: 2 },
      half: { rec: 0.5, py: 0.04, ptd: 4, int: -2, ry: 0.1, rtd: 6, rcy: 0.1, rctd: 6, fl: -2, two: 2 },
      std: { rec: 0, py: 0.04, ptd: 4, int: -2, ry: 0.1, rtd: 6, rcy: 0.1, rctd: 6, fl: -2, two: 2 },
    };
    const ages = opts.ages || {};
    const players = (data.players || []).filter(p => p && /^(QB|RB|WR|TE)$/.test(p.pos));
    const offs = Object.values(data.team_off || {});
    const leaguePts = offs.length ? offs.reduce((s, t) => s + num(t.pts_pg), 0) / offs.length : 0;
    const medians = {};
    for (const pos of ['QB', 'RB', 'WR', 'TE']) {
      medians[pos] = median(players.filter(p => p.pos === pos && p.g >= 3).map(volumeOf).filter(v => v > 0));
    }

    const rows = players.map(pl => {
      const outlook = sumOutlook(pl, data, project, scoringTable);
      const miss = statusMiss(pl);
      const avail = availability(outlook.games, miss);
      const ros = {};
      const nxt = {};
      const age = ages[pl.id] != null ? ages[pl.id] : (pl.ids && ages[pl.ids.sl] != null ? ages[pl.ids.sl] : null);
      const role = roleFactor(pl, medians);
      const team = teamFactor(pl, leaguePts, data.team_off);
      const ageF = ageFactor(pl.pos, age);
      for (const key of SCORINGS) {
        ros[key] = outlook.raw[key] * avail;
        const per = outlook.games ? outlook.raw[key] / outlook.games : num(key === 'std' ? pl.std_pg : pl.ppr_pg);
        nxt[key] = per * SEASON_WEEKS * role * team * ageF;
      }
      return { pl, miss, games: outlook.games, age, ros, nxt };
    });

    const blank = () => ({ qb1: [0, 0], sflex: [0, 0] });
    const maxPar = { ppr: blank(), half: blank(), std: blank() };
    const repl = { ppr: { qb1: {}, sflex: {} }, half: { qb1: {}, sflex: {} }, std: { qb1: {}, sflex: {} } };

    function measure(row, key, mode, horizon) {
      if (horizon === 'redraft') return row.ros[key];
      return DYNASTY_ROS * row.ros[key] + DYNASTY_NEXT * row.nxt[key];
    }

    for (const key of SCORINGS) {
      for (const mode of QB_MODES) {
        for (const horizon of ['redraft', 'dynasty']) {
          const byPos = {};
          for (const row of rows) (byPos[row.pl.pos] = byPos[row.pl.pos] || []).push({ pts: measure(row, key, mode, horizon), row });
          const hi = horizon === 'redraft' ? 0 : 1;
          for (const pos of Object.keys(SLOTS[mode])) {
            repl[key][mode][pos] = repl[key][mode][pos] || [0, 0];
            repl[key][mode][pos][hi] = round1(replacementPoints(byPos[pos] || [], SLOTS[mode][pos]));
          }
          let max = 0;
          for (const row of rows) {
            const pts = measure(row, key, mode, horizon);
            const line = (repl[key][mode][row.pl.pos] || [0, 0])[hi];
            max = Math.max(max, pts - line);
          }
          maxPar[key][mode][hi] = round1(max);
        }
      }
    }

    for (const row of rows) {
      const v = {};
      const par = {};
      for (const key of SCORINGS) {
        v[key] = {};
        par[key] = {};
        for (const mode of QB_MODES) {
          const packV = [];
          const packP = [];
          for (const horizon of ['redraft', 'dynasty']) {
            const hi = horizon === 'redraft' ? 0 : 1;
            const pts = measure(row, key, mode, horizon);
            const line = (repl[key][mode][row.pl.pos] || [0, 0])[hi];
            const surplus = pts - line;
            packP.push(round1(surplus));
            packV.push(scaled(surplus, pts, line, maxPar[key][mode][hi]));
          }
          v[key][mode] = packV;
          par[key][mode] = packP;
        }
      }
      row.pl.tv = {
        age: row.age,
        g: row.games,
        miss: row.miss === Infinity ? row.games : row.miss,
        season: row.miss === Infinity,
        ros: SCORINGS.map(k => round1(row.ros[k])),
        nxt: SCORINGS.map(k => round1(row.nxt[k])),
        v, par,
      };
    }

    const ranked = players.slice().sort((a, b) => (b.tv.v.ppr.qb1[0] - a.tv.v.ppr.qb1[0]) || (b.tv.ros[0] - a.tv.ros[0]));
    ranked.forEach((pl, i) => { pl.tv.top = i < TOP_N; });

    data.meta = data.meta || {};
    data.meta.trade = {
      v: 1,
      top: TOP_N,
      slots: SLOTS,
      dynasty: [DYNASTY_ROS, DYNASTY_NEXT],
      consolidation: CONSOLIDATION,
      cap: CONSOLIDATION_CAP,
      max: maxPar,
      repl,
    };
    return data;
  }

  function valueOf(player, opts) {
    const tv = player && player.tv;
    if (!tv || !tv.v) return 0;
    const scoring = SCORINGS.includes(opts && opts.scoring) ? opts.scoring : 'ppr';
    const mode = opts && opts.qb === 'sflex' ? 'sflex' : 'qb1';
    const hi = opts && opts.horizon === 'dynasty' ? 1 : 0;
    const base = tv.v[scoring][mode][hi];
    const extra = opts && opts.newsMiss ? opts.newsMiss : 0;
    const status = tv.season ? Infinity : (tv.miss || 0);
    const miss = combineMiss(status, extra);
    if (miss === status || !tv.g) return base;
    const built = availability(tv.g, status);
    const now = availability(tv.g, miss);
    const factor = built > 0 ? now / built : 0;
    if (hi === 1) return round1(base * (DYNASTY_ROS * factor + DYNASTY_NEXT));
    const surplus = (tv.par[scoring][mode][0] || 0) * factor;
    const max = opts && opts.max != null ? opts.max : surplus;
    if (surplus <= 0) return round1(Math.min(base, FALLBACK_CAP) * factor);
    return round1(max > 0 ? Math.min(100, 100 * surplus / max) : 0);
  }

  function adjustSide(raw, count, otherCount) {
    const extra = Math.max(0, count - otherCount);
    const cut = Math.min(CONSOLIDATION_CAP, CONSOLIDATION * extra);
    return { total: round1(raw * (1 - cut)), cut };
  }

  function gradeGap(pct) {
    if (pct <= 0.04) return ['A+', 'fair'];
    if (pct <= 0.08) return ['A', 'fair'];
    if (pct <= 0.12) return ['B', 'edge'];
    if (pct <= 0.18) return ['C', 'clear'];
    if (pct <= 0.26) return ['D', 'lopsided'];
    return ['F', 'lopsided'];
  }

  function analyze(sideA, sideB) {
    const clean = list => {
      const seen = new Set();
      const players = [];
      const dupes = [];
      for (const p of list || []) {
        if (!p || p.id == null) continue;
        if (seen.has(p.id)) { dupes.push(p); continue; }
        seen.add(p.id);
        players.push(p);
      }
      return { players, dupes };
    };
    const A0 = clean(sideA), B0 = clean(sideB);
    const both = new Set(A0.players.map(p => p.id).filter(id => B0.players.some(p => p.id === id)));
    const A = A0.players.filter(p => !both.has(p.id));
    const B = B0.players.filter(p => !both.has(p.id));
    const shared = A0.players.filter(p => both.has(p.id));
    const sum = list => list.reduce((s, p) => s + num(p.value), 0);
    const adjA = adjustSide(sum(A), A.length, B.length);
    const adjB = adjustSide(sum(B), B.length, A.length);
    const notes = [];
    if (shared.length) notes.push(shared.map(p => p.name).join(', ') + (shared.length > 1 ? ' are' : ' is') + ' on both sides, so ' + (shared.length > 1 ? 'they are' : 'that player is') + ' left out of both totals.');
    if (A0.dupes.length || B0.dupes.length) notes.push('A duplicate on one side is counted once.');
    if (adjA.cut > 0) notes.push('Side A gives up ' + Math.round(adjA.cut * 100) + '% for sending more players than it receives.');
    if (adjB.cut > 0) notes.push('Side B gives up ' + Math.round(adjB.cut * 100) + '% for sending more players than it receives.');
    if (!A.length || !B.length) {
      return {
        empty: true, grade: null, tone: null, winner: null, gap: 0, pct: 0,
        a: { total: adjA.total, cut: adjA.cut, players: A },
        b: { total: adjB.total, cut: adjB.cut, players: B },
        shared, notes, verdict: 'Add at least one player to each side.',
      };
    }
    const hi = Math.max(adjA.total, adjB.total);
    const gap = round1(Math.abs(adjA.total - adjB.total));
    const pct = hi > 0 ? gap / hi : 0;
    const [grade, tone] = gradeGap(pct);
    const winner = pct <= 0.04 ? 'even' : (adjA.total > adjB.total ? 'a' : 'b');
    const pool = A.concat(B).slice().sort((a, b) => num(b.value) - num(a.value));
    if (pool[0]) notes.unshift(pool[0].name + ' is the largest piece (' + round1(pool[0].value) + ').');
    const hurt = A.concat(B).filter(p => p.miss);
    if (hurt.length) notes.push(hurt.map(p => p.name).join(', ') + (hurt.length > 1 ? ' are' : ' is') + ' discounted for games expected to be missed.');
    let verdict;
    if (winner === 'even') verdict = 'Fair. The sides are within ' + gap.toFixed(1) + '.';
    else {
      const who = winner === 'a' ? 'Side A' : 'Side B';
      const how = tone === 'lopsided' ? 'lopsided' : tone === 'clear' ? 'a clear winner' : tone === 'edge' ? 'a slight edge' : 'fair';
      verdict = who + ' wins by ' + gap.toFixed(1) + ' · ' + how + '.';
    }
    return {
      empty: false, grade, tone, winner, gap, pct, verdict, notes, shared,
      a: { total: adjA.total, cut: adjA.cut, players: A },
      b: { total: adjB.total, cut: adjB.cut, players: B },
    };
  }

  function snapshotPlayer(pl, week) {
    const prior = (pl.log || []).filter(g => g.wk < week);
    if (prior.length < 2) return null;
    const decay = 0.7;
    const wts = prior.map(g => decay ** (week - 1 - g.wk));
    const wsum = wts.reduce((s, w) => s + w, 0);
    const wm = key => wts.reduce((s, w, i) => s + w * num(prior[i][key]), 0) / wsum;
    const tot = key => prior.reduce((s, g) => s + num(g[key]), 0);
    return {
      ...pl,
      g: prior.length,
      adv: null,
      snapImplied: null,
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

  function backtest(data, project, scoringTable) {
    const last = data.meta.last_completed_week || 0;
    const S = (scoringTable || {}).ppr || { rec: 1, py: 0.04, ptd: 4, int: -2, ry: 0.1, rtd: 6, rcy: 0.1, rctd: 6, fl: -2, two: 2 };
    const xs = [], ys = [];
    for (let origin = 2; origin <= last - 1; origin++) {
      for (const pl of data.players || []) {
        if (!/^(QB|RB|WR|TE)$/.test(pl.pos)) continue;
        const snap = snapshotPlayer(pl, origin);
        if (!snap) continue;
        let pred = 0, games = 0;
        for (let w = origin; w <= last; w++) {
          let pr;
          try { pr = project(snap, w, 'ppr', { data }); } catch (e) { continue; }
          if (!pr || pr.bye || !pr.comps) continue;
          pred += pointsOf(pr.comps, S);
          games += 1;
        }
        const actual = (pl.log || []).filter(g => g.wk >= origin && g.wk <= last).reduce((s, g) => s + num(g.ppr), 0);
        const played = (pl.log || []).filter(g => g.wk >= origin && g.wk <= last).length;
        if (!games || !played) continue;
        xs.push(pred);
        ys.push(actual);
      }
    }
    return { spearman: spearman(xs, ys), n: xs.length };
  }

  function ageFromBirth(birth, season) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(birth || ''));
    if (!m) return null;
    let age = season - Number(m[1]);
    if (Number(m[2]) > 9) age -= 1;
    return age > 15 && age < 50 ? age : null;
  }

  const PREF = { scoring: 'ml-trade-scoring', qb: 'ml-trade-qb', horizon: 'ml-trade-horizon', all: 'ml-trade-all' };
  const tradeState = { scoring: 'ppr', qb: 'qb1', horizon: 'redraft', all: false, a: [], b: [], note: '' };

  function $(s, r) { return (r || document).querySelector(s); }
  function $all(s, r) { return Array.from((r || document).querySelectorAll(s)); }
  function ml() { return typeof window !== 'undefined' ? window.ML : null; }

  function readPrefs() {
    try {
      const s = localStorage.getItem(PREF.scoring);
      const q = localStorage.getItem(PREF.qb);
      const h = localStorage.getItem(PREF.horizon);
      if (s === 'ppr' || s === 'half' || s === 'std') tradeState.scoring = s;
      if (q === 'qb1' || q === 'sflex') tradeState.qb = q;
      if (h === 'redraft' || h === 'dynasty') tradeState.horizon = h;
      tradeState.all = localStorage.getItem(PREF.all) === '1';
    } catch (e) { /* private mode */ }
  }
  function savePrefs() {
    try {
      localStorage.setItem(PREF.scoring, tradeState.scoring);
      localStorage.setItem(PREF.qb, tradeState.qb);
      localStorage.setItem(PREF.horizon, tradeState.horizon);
      localStorage.setItem(PREF.all, tradeState.all ? '1' : '0');
    } catch (e) { /* private mode */ }
  }
  function syncToggles() {
    const mark = (id, val) => $all(id + ' button').forEach(b => b.setAttribute('aria-checked', String(b.dataset.val === val)));
    mark('#tradeScore', tradeState.scoring);
    mark('#tradeQb', tradeState.qb);
    mark('#tradeHorizon', tradeState.horizon);
    const all = $('#tradeAll');
    if (all) all.checked = tradeState.all;
  }
  function playerById(id) {
    const data = ml() && ml().state.data;
    return data && data.players.find(p => p.id === id);
  }
  function liveValue(pl) {
    const data = ml().state.data;
    const pack = data.meta && data.meta.trade && data.meta.trade.max;
    const hi = tradeState.horizon === 'dynasty' ? 1 : 0;
    const max = pack && pack[tradeState.scoring] && pack[tradeState.scoring][tradeState.qb] ? pack[tradeState.scoring][tradeState.qb][hi] : 0;
    const items = (ml().state.newsByPlayer && ml().state.newsByPlayer[pl.id]) || [];
    return valueOf(pl, { scoring: tradeState.scoring, qb: tradeState.qb, horizon: tradeState.horizon, newsMiss: newsMiss(items), max });
  }
  function cardRow(id) {
    const pl = playerById(id);
    if (!pl || !pl.tv) return null;
    const items = (ml().state.newsByPlayer && ml().state.newsByPlayer[pl.id]) || [];
    const extra = newsMiss(items);
    const status = pl.tv.season ? Infinity : (pl.tv.miss || 0);
    const miss = combineMiss(status, extra);
    return { id: pl.id, name: pl.name, pos: pl.pos, team: pl.team, value: liveValue(pl), miss: miss === Infinity ? 'season' : miss, pl };
  }
  function renderTrade() {
    const app = ml();
    if (!app || !$('#tradeBoard')) return;
    const esc = app.esc, f1 = app.f1;
    const rows = { a: tradeState.a.map(cardRow).filter(Boolean), b: tradeState.b.map(cardRow).filter(Boolean) };
    for (const side of ['a', 'b']) {
      const host = $('#tradeCards' + side.toUpperCase());
      const full = tradeState[side].length >= 5;
      const input = $('#tradeSearch' + side.toUpperCase());
      if (input) { input.disabled = full; input.placeholder = full ? '5 player limit' : 'Add a player'; }
      if (!host) continue;
      host.innerHTML = rows[side].map(row => {
        const pr = app.project(row.pl, app.state.week, tradeState.scoring);
        const range = pr.bye ? 'Bye' : `Proj ${f1(pr.pts)} · Floor ${f1(pr.floor)} · Ceiling ${f1(pr.ceil)}`;
        const disc = row.miss === 'season' ? 'Out for the season' : row.miss >= 1 ? 'Discounted about 1 game' : row.miss >= 0.75 ? 'Discounted as doubtful' : row.miss > 0 ? 'Small injury discount' : '';
        return `<li class="trade-card"><div><div class="trade-name">${esc(row.name)} <span class="pos ${esc(row.pos)}">${esc(row.pos)}</span> <span class="meta">${esc(row.team)}</span></div><div class="trade-meta"><b class="trade-val">${row.value.toFixed(1)}</b> value · ${range}</div>${disc ? `<div class="trade-disc">${disc}</div>` : ''}</div><button type="button" class="trade-x" data-side="${side}" data-id="${esc(row.id)}" aria-label="Remove ${esc(row.name)} from side ${side.toUpperCase()}">×</button></li>`;
      }).join('') || '<li class="trade-empty">No players yet.</li>';
      host.querySelectorAll('.trade-x').forEach(btn => btn.addEventListener('click', () => {
        tradeState[btn.dataset.side] = tradeState[btn.dataset.side].filter(id => id !== btn.dataset.id);
        renderTrade();
      }));
    }
    const result = analyze(rows.a, rows.b);
    const box = $('#tradeResult');
    if (!box) return;
    if (tradeState.note) result.notes.push(tradeState.note);
    const bar = result.empty ? 50 : (result.a.total + result.b.total <= 0 ? 50 : 100 * result.a.total / (result.a.total + result.b.total));
    const grade = result.grade ? `<span class="trade-letter tone-${result.tone}">${result.grade}</span>` : '';
    box.innerHTML = `<div class="trade-totals"><span>Side A <b>${result.a.total.toFixed(1)}</b></span><span>Side B <b>${result.b.total.toFixed(1)}</b></span></div><div class="trade-bar" role="img" aria-label="Side A ${bar.toFixed(0)} percent, side B ${(100 - bar).toFixed(0)} percent"><span class="ta" style="width:${bar}%"></span><span class="tb" style="width:${100 - bar}%"></span></div><div class="trade-verdict">${grade}<p>${esc(result.verdict)}</p></div>${result.notes.length ? `<ul class="trade-notes">${result.notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}`;
  }
  function addPlayer(side, id) {
    tradeState.note = '';
    const list = tradeState[side];
    if (list.includes(id)) { tradeState.note = 'That player is already on this side.'; renderTrade(); return; }
    if (list.length >= 5) return;
    list.push(id);
    renderTrade();
  }
  function bindSearch(side) {
    const input = $('#tradeSearch' + side.toUpperCase());
    const list = $('#tradeList' + side.toUpperCase());
    if (!input || !list) return;
    let items = [], active = -1;
    const norm = s => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9 ]/g, '');
    const close = () => { list.hidden = true; input.setAttribute('aria-expanded', 'false'); active = -1; };
    const paint = () => {
      const esc = ml().esc;
      list.innerHTML = items.length ? items.map((p, i) => `<li role="option" data-id="${esc(p.id)}" aria-selected="${i === active}"><span class="pos ${esc(p.pos)}">${esc(p.pos)}</span> ${esc(p.name)} <span class="meta">${esc(p.team)} · ${liveValue(p).toFixed(1)}</span></li>`).join('') : `<li class="empty">${tradeState.all ? 'No players match.' : 'No top-150 match. Search all players for a lower fallback value.'}</li>`;
      list.hidden = false;
      input.setAttribute('aria-expanded', 'true');
      list.querySelectorAll('li[data-id]').forEach(li => li.addEventListener('mousedown', e => { e.preventDefault(); addPlayer(side, li.dataset.id); input.value = ''; close(); }));
    };
    input.addEventListener('input', () => {
      const q = norm(input.value.trim());
      if (q.length < 2) { close(); return; }
      const toks = q.split(/\s+/);
      const pool = ml().state.data.players.filter(p => p.tv && (tradeState.all || p.tv.top));
      items = pool.filter(p => toks.every(t => norm(p.name).includes(t))).sort((a, b) => liveValue(b) - liveValue(a)).slice(0, 8);
      active = items.length ? 0 : -1;
      paint();
    });
    input.addEventListener('keydown', e => {
      if (list.hidden) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(active + 1, items.length - 1); paint(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(active - 1, 0); paint(); }
      else if (e.key === 'Enter') { e.preventDefault(); if (items[active]) { addPlayer(side, items[active].id); input.value = ''; close(); } }
      else if (e.key === 'Escape') close();
    });
    input.addEventListener('blur', () => setTimeout(close, 150));
  }
  function bindSeg(id, key) {
    const root = $(id);
    if (!root) return;
    root.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
      tradeState[key] = b.dataset.val;
      savePrefs();
      syncToggles();
      renderTrade();
    }));
  }
  function ensure(data) {
    if (!data || (data.meta && data.meta.trade && (data.players || []).some(p => p.tv))) return data;
    const project = (typeof window !== 'undefined' && window.MLModel && window.MLModel.project) || null;
    if (!project) return data;
    attachTrade(data, { project, scoring: window.MLModel.SCORING, ages: {} });
    return data;
  }
  function init() {
    if (!$('#view-trade')) return;
    readPrefs();
    syncToggles();
    bindSeg('#tradeScore', 'scoring');
    bindSeg('#tradeQb', 'qb');
    bindSeg('#tradeHorizon', 'horizon');
    const all = $('#tradeAll');
    if (all) all.addEventListener('change', () => { tradeState.all = all.checked; savePrefs(); });
    bindSearch('a');
    bindSearch('b');
    renderTrade();
  }

  return {
    SCORINGS, QB_MODES, SLOTS, DYNASTY_ROS, DYNASTY_NEXT, CONSOLIDATION, CONSOLIDATION_CAP, TOP_N, FALLBACK_CAP, AGE_CURVE, PREF,
    missFromText, statusMiss, newsMiss, combineMiss, availability, ageFactor, roleFactor, teamFactor, pointsOf,
    ageFromBirth, spearman, adjustSide, gradeGap, analyze, valueOf, attachTrade, backtest, round1,
    ensure, init, render: renderTrade,
  };
});
