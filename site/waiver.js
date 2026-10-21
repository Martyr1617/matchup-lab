/* Waiver adds for My Team.
   Loaded before team.js in the browser (globalThis.MLWaiver) and via require() in Node.
   A pickup is paired with the least valuable player who can actually leave the roster,
   at any position. The add is shown only when that swap raises combined trade value. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MLWaiver = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const ELIG = {
    QB: ['QB'], RB: ['RB'], WR: ['WR'], TE: ['TE'], K: ['K'], DEF: ['DEF'],
    FLEX: ['RB', 'WR', 'TE'], SUPER_FLEX: ['QB', 'RB', 'WR', 'TE'], WRRB_FLEX: ['RB', 'WR'], REC_FLEX: ['WR', 'TE'],
  };
  // Dynasty value at or above this is long-term upside, so the player stays.
  const UPSIDE = 5;
  // Combined rest-of-season plus dynasty value at or above this is a star.
  const STAR = 15;
  // An injured player at or above this combined value is still worth keeping.
  const INJURED_VALUE = 5;
  // Weights are hit-rate gaps from the 2022–2025 waiver study (scripts/waiver_study.py).
  // A player-week is eligible when season-to-date PPR sits outside QB12 / RB24 / WR36 / TE12
  // and he was active in the last three weeks. A hit finishes inside that cut from the next
  // week through week 17. Recent points and volume share (RB carries, WR/TE targets, QB snaps)
  // are the full top-vs-bottom gaps. Air yards, a handcuff promotion, and a rising rookie are
  // 15–20% of their gaps, so they move a tie without overturning a held-out season.
  // The touchdown-fluke term is 20% of the gap versus other big weeks, and it is negative.
  const W_RECENCY = 0.26;
  const W_VOLUME = 0.25;
  const W_AIR = 0.03;
  const W_INHERITS = 0.03;
  const W_ROOKIE = 0.03;
  const W_FLUKE = -0.02;

  function num(n) { return typeof n === 'number' && isFinite(n) ? n : 0; }

  function tvOf(player) {
    if (!player) return null;
    if (player.tv && (player.tv.v || player.tv.pre || player.tv.inj || player.tv.top)) return player.tv;
    if (player.ml && player.ml.tv) return player.ml.tv;
    return null;
  }

  function packOf(tv, scoring, mode, field) {
    const node = tv && tv[field] && tv[field][scoring] && tv[field][scoring][mode];
    const ros = node ? num(node[0]) : 0;
    const dynasty = node ? num(node[1]) : 0;
    return { ros, dynasty, combined: ros + dynasty };
  }

  // Dedicated slots set the floor. A superflex lineup also keeps a quarterback
  // for every QB-eligible slot. Bye weeks do not add an extra spare: trade
  // value already ignores byes, and depth is only the lineup's required count.
  function minDepth(slots) {
    const min = {};
    let qbSlots = 0;
    for (const slot of slots || []) {
      const elig = ELIG[slot] || [];
      if (elig.includes('QB')) qbSlots += 1;
      if (elig.length === 1) min[elig[0]] = (min[elig[0]] || 0) + 1;
    }
    if (qbSlots >= 2) min.QB = Math.max(min.QB || 0, qbSlots);
    return min;
  }

  function dropReason(name) {
    return `Drop ${name}: low value, no long-term upside`;
  }

  function rawOf(player) {
    return (player && player.ml) || player || {};
  }

  function logsOf(player) {
    const ml = rawOf(player);
    return (ml.log || []).slice().sort((a, b) => num(a.wk) - num(b.wk));
  }

  function recencyOf(logs) {
    if (!logs.length) return null;
    const last = num(logs[logs.length - 1].wk);
    let s = 0;
    let w = 0;
    for (const g of logs) {
      const wt = 0.7 ** (last - num(g.wk));
      s += wt * num(g.ppr);
      w += wt;
    }
    return w ? s / w : null;
  }

  function sumKey(logs, key) {
    let t = 0;
    for (const g of logs) t += num(g[key]);
    return t;
  }

  function snapSeries(logs) {
    const out = [];
    for (const g of logs) {
      if (g.sp != null && isFinite(Number(g.sp))) out.push(Number(g.sp));
    }
    return out;
  }

  function teamTotals(players) {
    const out = {};
    for (const p of players || []) {
      if (!p || !p.team) continue;
      const t = out[p.team] || (out[p.team] = { ca: 0, tg: 0 });
      for (const g of p.log || []) {
        t.ca += num(g.ca);
        t.tg += num(g.tg);
      }
    }
    return out;
  }

  function signalsOf(player, ctx) {
    const ml = rawOf(player);
    const logs = logsOf(player);
    const pos = player.pos || ml.pos;
    const team = player.team || ml.team;
    const snaps = snapSeries(logs);
    const advSnap = ml.adv && ml.adv.snap_pct != null && isFinite(Number(ml.adv.snap_pct)) ? Number(ml.adv.snap_pct) : null;
    const snapLast = snaps.length ? snaps[snaps.length - 1] : advSnap;
    const snapPrior = snaps.length >= 2 ? snaps.slice(0, -1).reduce((a, b) => a + b, 0) / (snaps.length - 1) : null;
    const snapDelta = snapLast != null && snapPrior != null ? snapLast - snapPrior : null;
    const rising3 = snaps.length >= 3
      && snaps[snaps.length - 1] > snaps[snaps.length - 2]
      && snaps[snaps.length - 2] > snaps[snaps.length - 3]
      && snaps[snaps.length - 1] >= 0.40;
    const tm = team && ctx && ctx.totals ? ctx.totals[team] : null;
    let volume = null;
    if (pos === 'RB' && tm && tm.ca > 0) volume = sumKey(logs, 'ca') / tm.ca;
    else if ((pos === 'WR' || pos === 'TE') && ml.adv && ml.adv.tgt_share != null && isFinite(Number(ml.adv.tgt_share))) volume = Number(ml.adv.tgt_share);
    else if ((pos === 'WR' || pos === 'TE') && tm && tm.tg > 0) volume = sumKey(logs, 'tg') / tm.tg;
    else if (pos === 'QB') volume = snapLast;
    let air = null;
    if ((pos === 'WR' || pos === 'TE') && ml.adv && ml.adv.ay_share != null && isFinite(Number(ml.adv.ay_share))) air = Number(ml.adv.ay_share);
    const last = logs.length ? logs[logs.length - 1] : null;
    let fluke = 0;
    if (last) {
      const ppr = num(last.ppr);
      const tdPts = 6 * (num(last.rtd) + num(last.rctd)) + 4 * num(last.ptd);
      if (pos === 'QB') {
        if (ppr >= 18 && tdPts >= 0.45 * ppr && num(last.py) < 220) fluke = 1;
      } else if (ppr >= 12 && tdPts >= 0.5 * ppr && (num(last.tg) + num(last.ca)) <= 6) {
        fluke = 1;
      }
    }
    let inherits = 0;
    const week = ctx && ctx.week;
    const roles = ctx && ctx.roles && week != null ? ctx.roles[String(week)] : null;
    if (roles && (pos === 'RB' || pos === 'WR') && team && ml.id != null) {
      const chart = (((roles.chart || {})[team] || {})[pos] || []).map(String);
      const idx = chart.indexOf(String(ml.id));
      if (idx === 1 || idx === 2) {
        const starter = chart[0];
        const out = new Set((roles.out || []).map(String));
        const starterPl = (ctx.byId || {})[starter];
        const stLogs = starterPl && starterPl.log ? starterPl.log.slice().sort((a, b) => num(a.wk) - num(b.wk)) : [];
        const stSnaps = snapSeries(stLogs);
        const stSnap = stSnaps.length ? stSnaps[stSnaps.length - 1] : null;
        const stWeek = stLogs.reduce((m, g) => Math.max(m, num(g.wk)), 0);
        const myWeek = last ? num(last.wk) : 0;
        const starterDown = out.has(starter) || (stSnap != null && stSnap < 0.25) || (myWeek > 0 && stWeek < myWeek);
        const played = (snapLast != null && snapLast >= 0.35) || (last && (num(last.tg) + num(last.ca)) >= 8);
        if (starterDown && played) inherits = 1;
      }
    }
    const rookie = ml.rookie === 1 || ml.rookie === true;
    const rookieUp = (pos === 'RB' || pos === 'WR') && rookie && (rising3 || (snapDelta != null && snapDelta >= 0.10 && snapLast != null && snapLast >= 0.45)) ? 1 : 0;
    return { pos, recency: recencyOf(logs), volume, air, inherits, rookieUp, rising3, fluke, snapLast };
  }

  function percentilize(rows, key) {
    const groups = {};
    for (const row of rows) {
      const pos = row.sig.pos || '?';
      (groups[pos] || (groups[pos] = [])).push(row);
    }
    for (const list of Object.values(groups)) {
      const usable = list.filter(r => r.sig[key] != null && isFinite(r.sig[key]));
      usable.sort((a, b) => a.sig[key] - b.sig[key]);
      let i = 0;
      while (i < usable.length) {
        let j = i;
        while (j + 1 < usable.length && usable[j + 1].sig[key] === usable[i].sig[key]) j += 1;
        const avg = (i + j) / 2 + 1;
        const pct = avg / usable.length;
        for (let k = i; k <= j; k += 1) usable[k].pct[key] = pct;
        i = j + 1;
      }
      for (const row of list) if (row.pct[key] == null) row.pct[key] = 0.5;
    }
  }

  function scoreOf(row) {
    const p = row.pct;
    return W_RECENCY * p.recency + W_VOLUME * p.volume + W_AIR * p.air
      + W_INHERITS * p.inherits + W_ROOKIE * p.rookieUp + W_FLUKE * p.fluke;
  }

  function whyText(row) {
    const s = row.sig;
    const bits = [];
    if (s.inherits) {
      const pct = s.snapLast != null ? Math.round(s.snapLast * 100) : null;
      bits.push(pct != null ? `Starter out, inherits ~${pct}% snaps` : 'Starter out, inherits the role');
    }
    if (s.rookieUp) bits.push(s.rising3 ? 'Rookie routes up 3 straight weeks' : 'Rookie snap share up');
    if (!s.inherits && row.pct.volume >= 0.65 && s.volume != null) {
      const pct = Math.round(s.volume * 100);
      if (s.pos === 'RB') bits.push(`Carries share ${pct}%`);
      else if (s.pos === 'WR' || s.pos === 'TE') bits.push(`Target share ${pct}%`);
      else bits.push(`Playing ${pct}% of snaps`);
    }
    if (!bits.length && row.pct.air >= 0.65 && s.air != null) bits.push(`Air-yard share ${Math.round(s.air * 100)}%`);
    if (s.fluke) bits.push('TD-fluke warning');
    if (!bits.length && s.recency != null) bits.push('Recent scoring leads the wire');
    return bits.join('. ');
  }

  function advise(opts) {
    const scoring = (opts && opts.scoring) || 'ppr';
    const mode = opts && opts.qbMode === 'sflex' ? 'sflex' : 'qb1';
    const roster = (opts && opts.roster) || [];
    const starterKeys = new Set(((opts && opts.opt) || []).filter(Boolean).map(p => p.key));
    const min = minDepth(opts && opts.slots);
    const have = {};
    for (const p of roster) {
      if (p && p.pos) have[p.pos] = (have[p.pos] || 0) + 1;
    }

    const expendable = [];
    for (const p of roster) {
      if (!p || p.key == null) continue;
      if (starterKeys.has(p.key)) continue;
      const tv = tvOf(p);
      const cur = packOf(tv, scoring, mode, 'v');
      const pre = packOf(tv, scoring, mode, 'pre');
      if (cur.combined >= STAR) continue;
      if (cur.dynasty >= UPSIDE) continue;
      if (tv && tv.inj && (cur.combined >= INJURED_VALUE || cur.dynasty >= UPSIDE || pre.combined >= STAR || pre.dynasty >= UPSIDE)) continue;
      const need = min[p.pos] || 0;
      if (need && (have[p.pos] || 0) <= need) continue;
      expendable.push({ p, value: cur.combined });
    }
    expendable.sort((a, b) => (a.value - b.value) || String(a.p.name || '').localeCompare(String(b.p.name || '')));

    const out = [];
    for (const e of (opts && opts.freeAgents) || []) {
      const add = packOf(tvOf(e), scoring, mode, 'v').combined;
      const options = expendable.filter(row => add - row.value > 0);
      if (!options.length) continue;
      const alts = options.slice(1, 3);
      out.push({
        e,
        drop: options[0].p,
        alts: alts.map(row => row.p),
        gain: add - options[0].value,
        reason: dropReason(options[0].p.name),
        altReasons: alts.map(row => dropReason(row.p.name)),
      });
    }
    const players = (opts && opts.players) || [];
    const byId = {};
    for (const p of players) if (p && p.id != null) byId[String(p.id)] = p;
    const ctx = { totals: teamTotals(players), roles: opts && opts.roles, week: opts && opts.week, byId };
    for (const row of out) {
      row.sig = signalsOf(row.e, ctx);
      row.pct = {};
    }
    for (const key of ['recency', 'volume', 'air', 'inherits', 'rookieUp', 'fluke']) percentilize(out, key);
    for (const row of out) {
      row.score = scoreOf(row);
      row.why = whyText(row);
    }
    out.sort((a, b) => (b.score - a.score) || (b.gain - a.gain) || String(a.e.name || '').localeCompare(String(b.e.name || '')));
    return out;
  }

  return {
    advise, minDepth, dropReason, signalsOf, whyText, teamTotals,
    UPSIDE, STAR, INJURED_VALUE,
    W_RECENCY, W_VOLUME, W_AIR, W_INHERITS, W_ROOKIE, W_FLUKE,
  };
});
