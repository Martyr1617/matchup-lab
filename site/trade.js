/* Trade values for Matchup Lab.
   The weekly projection model is not modified. This file only sums it.

   Formula
   -------
   Rest of season, for each scoring format (PPR, half-PPR, standard):
     The per-game rate is the average weekly projection on weeks that are
     not a bye. Every player is then credited the same number of games,
     from the upcoming week through week 18. A bye is not a missed game
     and does not shrink that total, so bye timing does not favor anyone.
     One projection per week is scored three ways from the same counting stats.

   Games missed come off that shared total:
     Questionable, or limited / DNP practice: 0.25 of a game.
     Doubtful: 0.75. Out: 1 game.
     IR or PUP: at least 4 games from the last game played. If that minimum
     is already served and the player is still on IR, count two more games
     unless a headline says he is practicing or designated to return
     (then one more game) or names a return week. Weeks 15–18 still count
     when he is back before the fantasy playoffs.
     A long-term injury (ACL, Achilles, season-ending) removes the rest of
     this season in redraft. Dynasty keeps a healthy outlook and discounts
     it by 7 percent.
     The first two games back from a multi-week layoff count at 0.80 and 0.90.
     A vague injury blurb does not change the timeline.

   Hurt players, and anyone with no current-week projection, use a healthy
   baseline instead of a depressed or missing 2026 sample: 65 percent of the
   last season with at least 6 games, 35 percent of a games-weighted career.
   Value = that per-game rate × expected games remaining. The card shows the
   value before and after the injury discount.

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
   next-season outlook: healthy points per game × 17 × age curve × role
   (volume versus the positional median, 0.75–1.15) × team offense
   (points per game versus the league, clamped 0.90–1.10). A short-term
   injury discounts only this season. A long-term injury discounts the
   whole dynasty figure by 7 percent.

   Every team's starting quarterback, top running back, top receivers, and
   starting tight end stay searchable even when they are outside the top 150.

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
    if (pl && pl.tradeOnly && !(volumeOf(pl) > 0)) return 1;
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

  const IR_MIN = 4;
  const LONG_RE = /\bacl\b|achilles|pectoral|season-?ending|torn |rupture/;
  const LONG_DYNASTY = 0.93;

  function gamesBasis(data) {
    const start = (data && data.meta && data.meta.next_week) || 1;
    return Math.max(1, 18 - start + 1);
  }

  function remainingWeeks(data) {
    const start = (data.meta && data.meta.next_week) || 1;
    const weeks = [];
    for (let w = start; w <= 18; w++) weeks.push(w);
    return weeks;
  }

  function gameEq(full, miss, ramp) {
    const play = Math.max(0, full - (miss || 0));
    if (!ramp) return play;
    let eq = 0;
    const whole = Math.floor(play + 1e-9);
    const frac = play - whole;
    const factor = i => (i === 1 ? 0.8 : i === 2 ? 0.9 : 1);
    for (let i = 1; i <= whole; i++) eq += factor(i);
    if (frac > 1e-9) eq += frac * factor(whole + 1);
    return eq;
  }

  function parseNews(text) {
    const s = String(text || '').toLowerCase();
    const out = {};
    if (!s) return out;
    if (/out for the (rest of the )?season|season-ending|season ending|torn acl|achilles/.test(s)) out.long = true;
    let m = s.match(/(?:return(?:s|ing)?|back|targeting|target(?:ing)?|debut)\D{0,30}week\s*(\d{1,2})/);
    if (!m) m = s.match(/week\s*(\d{1,2})\D{0,30}(?:return|back|debut)/);
    if (m) {
      const wk = Number(m[1]);
      if (wk >= 1 && wk <= 18) out.returnWeek = wk;
    }
    const span = s.match(/(\d{1,2})\s*(?:-|to|–)\s*(\d{1,2})\s*weeks?/);
    if (span) out.missWeeks = Number(span[2]);
    else {
      const one = s.match(/(\d{1,2})\s*weeks?/);
      if (one && /out|miss|sideline|return/.test(s)) out.missWeeks = Number(one[1]);
    }
    if (/returning to practice|returned to practice|return to practice|practicing again|full participant/.test(s)) out.practicing = true;
    if (/designated to return|designated for return/.test(s)) out.designated = true;
    return out;
  }

  function classifyStatus(status, body) {
    const s = String(status || '').toLowerCase();
    const b = String(body || '').toLowerCase();
    const long = LONG_RE.test(s + ' ' + b);
    let kind = 'ok';
    if (/suspend/.test(s)) kind = 'susp';
    else if (/\bir\b|injured reserve|\bpup\b/.test(s)) kind = 'ir';
    else if (/doubtful/.test(s)) kind = 'd';
    else if (/\bout\b/.test(s)) kind = 'out';
    else if (/questionable|limited|did not practice|\bdnp\b/.test(s)) kind = 'q';
    return { kind, long };
  }

  function injuryPlan(input) {
    input = input || {};
    const nextWeek = input.nextWeek || 1;
    const basis = input.basis || 1;
    const lastWeek = input.lastWeek || 0;
    const news = Object.assign({}, ...(input.news || []).map(parseNews));
    const cls = classifyStatus(input.status, input.body);
    const long = !!(news.long || cls.long);
    const label = input.status || (long ? 'IR' : '');
    const detail = input.body || '';
    if (long || (cls.kind === 'susp' && !news.missWeeks && !news.returnWeek)) {
      return {
        serious: true, long: true, miss: basis, eq: 0, full: basis, ramp: false,
        ret: null, label, detail, note: 'Out for the season', kind: cls.kind || 'ir',
      };
    }
    let ret = null;
    let miss = 0;
    if (news.returnWeek) ret = news.returnWeek;
    else if (news.missWeeks) miss = news.missWeeks;
    else if (cls.kind === 'ir') {
      const served = lastWeek ? Math.max(0, nextWeek - lastWeek - 1) : 0;
      const remainMin = Math.max(0, IR_MIN - served);
      if (news.practicing || news.designated) ret = nextWeek + Math.max(1, remainMin);
      else if (served >= IR_MIN) ret = nextWeek + 2;
      else ret = nextWeek + remainMin;
    } else if (cls.kind === 'out') miss = 1;
    else if (cls.kind === 'd') miss = 0.75;
    else if (cls.kind === 'q') miss = 0.25;
    if (ret != null) miss = Math.max(0, Math.min(basis, ret - nextWeek));
    miss = Math.max(0, Math.min(basis, miss));
    const served = lastWeek ? Math.max(0, nextWeek - lastWeek - 1) : 0;
    const ramp = cls.kind === 'ir' || served + miss >= 2;
    const serious = cls.kind === 'ir' || cls.kind === 'out' || cls.kind === 'd' || cls.kind === 'susp';
    let note = '';
    if (ret) note = 'Back week ' + ret;
    else if (miss >= 1) note = 'Misses about ' + (miss % 1 ? miss : miss) + (miss === 1 ? ' game' : ' games');
    else if (miss > 0) note = 'Small injury discount';
    return {
      serious, long: false, miss, eq: gameEq(basis, miss, ramp && serious), full: basis,
      ramp: ramp && serious, ret, label, detail, note, kind: cls.kind,
    };
  }

  function sumOutlook(pl, data, project, scoringTable) {
    const weeks = remainingWeeks(data);
    const basis = weeks.length;
    const sum = { ppr: 0, half: 0, std: 0 };
    let samples = 0;
    const env = { data };
    if (!pl || pl.tradeOnly) return { raw: { ppr: 0, half: 0, std: 0 }, games: basis, samples: 0 };
    for (const week of weeks) {
      let pr;
      try { pr = project(pl, week, 'ppr', env); } catch (e) { continue; }
      if (!pr || pr.bye || !pr.comps) continue;
      samples += 1;
      for (const key of SCORINGS) sum[key] += pointsOf(pr.comps, scoringTable[key]);
    }
    const raw = { ppr: 0, half: 0, std: 0 };
    if (samples > 0) {
      for (const key of SCORINGS) raw[key] = (sum[key] / samples) * basis;
    }
    return { raw, games: basis, samples };
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

    const newsById = opts.newsById || {};
    const baselines = opts.baselines || {};
    const nextWeek = (data.meta && data.meta.next_week) || 1;
    const rows = players.map(pl => {
      const outlook = sumOutlook(pl, data, project, scoringTable);
      const basis = outlook.games;
      const statusText = (pl.sl_inj && pl.sl_inj.status) || (pl.inj && pl.inj.status) || (pl.inj && pl.inj.practice) || '';
      const bodyText = (pl.sl_inj && pl.sl_inj.body) || (pl.inj && pl.inj.injury) || '';
      const timeline = injuryPlan({
        status: statusText, body: bodyText, lastWeek: pl.last_wk || 0, nextWeek, basis,
        news: newsById[pl.id] || [],
      });
      const modelPpg = {};
      for (const key of SCORINGS) {
        modelPpg[key] = outlook.samples ? outlook.raw[key] / basis : num(key === 'std' ? pl.std_pg : pl.ppr_pg);
      }
      const hist = baselines[pl.id] || (pl.ids && baselines[pl.ids.sl]) || null;
      let rate = modelPpg;
      let usedBase = false;
      if (hist && (pl.tradeOnly || (timeline.serious && ((pl.g || 0) < 4 || modelPpg.ppr < hist.ppr * 0.85)))) {
        rate = { ppr: hist.ppr, half: hist.half, std: hist.std };
        usedBase = true;
      }
      const age = ages[pl.id] != null ? ages[pl.id] : (pl.ids && ages[pl.ids.sl] != null ? ages[pl.ids.sl] : null);
      const role = roleFactor(pl, medians);
      const team = teamFactor(pl, leaguePts, data.team_off);
      const ageF = ageFactor(pl.pos, age);
      if (usedBase) {
        for (const key of SCORINGS) rate[key] *= team;
      }
      const playEq = timeline.long ? 0 : gameEq(basis, timeline.miss, timeline.ramp);
      const ros = {};
      const nxt = {};
      const healthy = {};
      const nxtFull = {};
      const dyn = timeline.long ? {} : null;
      for (const key of SCORINGS) {
        const per = rate[key];
        healthy[key] = per * basis;
        ros[key] = per * playEq;
        nxtFull[key] = per * SEASON_WEEKS * role * ageF * (usedBase ? 1 : team);
        nxt[key] = nxtFull[key] * (timeline.long ? LONG_DYNASTY : 1);
        if (dyn) dyn[key] = (DYNASTY_ROS * healthy[key] + DYNASTY_NEXT * nxtFull[key]) * LONG_DYNASTY;
      }
      return { pl, timeline, games: basis, age, ros, nxt, healthy, nxtFull, dyn, rate };
    });

    const blank = () => ({ qb1: [0, 0], sflex: [0, 0] });
    const maxPar = { ppr: blank(), half: blank(), std: blank() };
    const repl = { ppr: { qb1: {}, sflex: {} }, half: { qb1: {}, sflex: {} }, std: { qb1: {}, sflex: {} } };

    function measure(row, key, mode, horizon) {
      if (horizon === 'dynasty' && row.dyn && row.dyn[key] != null) return row.dyn[key];
      if (horizon === 'redraft') return row.ros[key];
      return DYNASTY_ROS * row.ros[key] + DYNASTY_NEXT * row.nxt[key];
    }
    function measureHealthy(row, key, mode, horizon) {
      if (horizon === 'dynasty' && row.dyn && row.dyn[key] != null) return row.dyn[key] / LONG_DYNASTY;
      if (horizon === 'redraft') return row.healthy[key];
      return DYNASTY_ROS * row.healthy[key] + DYNASTY_NEXT * row.nxtFull[key];
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
      const pre = {};
      for (const key of SCORINGS) {
        pre[key] = {};
        for (const mode of QB_MODES) {
          const pack = [];
          for (const horizon of ['redraft', 'dynasty']) {
            const hi = horizon === 'redraft' ? 0 : 1;
            const pts = measureHealthy(row, key, mode, horizon);
            const line = (repl[key][mode][row.pl.pos] || [0, 0])[hi];
            pack.push(scaled(pts - line, pts, line, maxPar[key][mode][hi]));
          }
          pre[key][mode] = pack;
        }
      }
      const tl = row.timeline;
      const showInj = tl.serious || tl.miss > 0 || tl.long;
      row.pl.tv = {
        age: row.age,
        g: row.games,
        miss: tl.long ? row.games : tl.miss,
        season: !!tl.long,
        ros: SCORINGS.map(k => round1(row.ros[k])),
        nxt: SCORINGS.map(k => round1(row.nxt[k])),
        base: SCORINGS.map(k => round1(row.rate[k])),
        pre, v, par,
        inj: showInj ? { st: tl.label || (tl.long ? 'IR' : 'Injured'), body: tl.detail || null, ret: tl.ret, long: !!tl.long, miss: tl.miss, note: tl.note || '' } : null,
        starter: !!row.pl.starter,
      };
    }

    const rankScore = pl => Math.max(pl.tv.v.ppr.qb1[0], pl.tv.v.ppr.qb1[1]);
    const ranked = players.slice().sort((a, b) => (rankScore(b) - rankScore(a)) || (b.tv.ros[0] - a.tv.ros[0]));
    ranked.forEach((pl, i) => { pl.tv.top = i < TOP_N; });

    data.meta = data.meta || {};
    data.meta.trade = {
      v: 2,
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
    if (tv.inj) {
      const baked = tv.inj.long ? Infinity : (tv.inj.miss || 0);
      if (!(extra > baked) || tv.inj.long) return base;
      const basis = tv.g || 1;
      const now = gameEq(basis, extra, extra >= 2);
      const was = gameEq(basis, baked, baked >= 2);
      if (!was) return base;
      if (hi === 1) return round1(base * (DYNASTY_ROS * (now / was) + DYNASTY_NEXT));
      return round1(base * now / was);
    }
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
  function injLabel(pl) {
    const inj = pl && pl.tv && pl.tv.inj;
    if (!inj || !inj.st) return '';
    const bits = [inj.st];
    if (inj.body) bits.push(inj.body);
    if (inj.ret) bits.push('back week ' + inj.ret);
    else if (inj.note) bits.push(inj.note);
    return bits.join(' · ');
  }
  function preValue(pl) {
    const tv = pl && pl.tv;
    if (!tv || !tv.pre) return null;
    const hi = tradeState.horizon === 'dynasty' ? 1 : 0;
    const pack = tv.pre[tradeState.scoring] && tv.pre[tradeState.scoring][tradeState.qb];
    return pack ? pack[hi] : null;
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
        let range = 'No weekly projection';
        if (!row.pl.tradeOnly) {
          try {
            const pr = app.project(row.pl, app.state.week, tradeState.scoring);
            range = pr.bye ? 'Bye this week' : `Proj ${f1(pr.pts)} · Floor ${f1(pr.floor)} · Ceiling ${f1(pr.ceil)}`;
          } catch (e) { range = 'No weekly projection'; }
        }
        const tag = injLabel(row.pl);
        const pre = preValue(row.pl);
        const was = pre != null && pre - row.value >= 0.5 ? `<span class="trade-pre">${pre.toFixed(1)} if healthy</span>` : '';
        return `<li class="trade-card"><div><div class="trade-name">${esc(row.name)} <span class="pos ${esc(row.pos)}">${esc(row.pos)}</span> <span class="meta">${esc(row.team)}</span></div>${tag ? `<div class="trade-inj">${esc(tag)}</div>` : ''}<div class="trade-meta"><b class="trade-val">${row.value.toFixed(1)}</b> value${was ? ' · ' + was : ''} · ${range}</div></div><button type="button" class="trade-x" data-side="${side}" data-id="${esc(row.id)}" aria-label="Remove ${esc(row.name)} from side ${side.toUpperCase()}">×</button></li>`;
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
      list.innerHTML = items.length ? items.map((p, i) => {
        const tag = injLabel(p);
        const pre = preValue(p);
        const now = liveValue(p);
        const was = pre != null && pre - now >= 0.5 ? ` · ${pre.toFixed(1)} if healthy` : '';
        return `<li role="option" data-id="${esc(p.id)}" aria-selected="${i === active}"><span class="pos ${esc(p.pos)}">${esc(p.pos)}</span> ${esc(p.name)} <span class="meta">${esc(p.team)} · ${now.toFixed(1)}${was}${tag ? ' · ' + esc(tag) : ''}</span></li>`;
      }).join('') : `<li class="empty">${tradeState.all ? 'No players match.' : 'No top-150 or starter match. Search all players for a lower fallback value.'}</li>`;
      list.hidden = false;
      input.setAttribute('aria-expanded', 'true');
      list.querySelectorAll('li[data-id]').forEach(li => li.addEventListener('mousedown', e => { e.preventDefault(); addPlayer(side, li.dataset.id); input.value = ''; close(); }));
    };
    input.addEventListener('input', () => {
      const q = norm(input.value.trim());
      if (q.length < 2) { close(); return; }
      const toks = q.split(/\s+/);
      const pool = ml().state.data.players.filter(p => p.tv && (tradeState.all || p.tv.top || p.tv.starter));
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
    gamesBasis, gameEq, parseNews, injuryPlan, sumOutlook, IR_MIN, LONG_DYNASTY,
    ageFromBirth, spearman, adjustSide, gradeGap, analyze, valueOf, attachTrade, backtest, round1,
    ensure, init, render: renderTrade,
  };
});
