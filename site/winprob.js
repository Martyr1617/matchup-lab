/* Win probability for a fantasy matchup.
   Loaded before team.js in the browser (globalThis.MLWinProb) and via require() in Node.
   Outcomes are independent normals. In-progress players keep the points already
   scored; the rest of their projection, and the same share of their variance,
   is what is left on the clock. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MLWinProb = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const SKILL_SLOTS = new Set(['QB', 'RB', 'WR', 'TE', 'FLEX', 'SUPER_FLEX', 'WRRB_FLEX', 'REC_FLEX']);

  function normCdf(z) {
    const t = 1 / (1 + 0.2316419 * Math.abs(z));
    const d = 0.3989423 * Math.exp(-z * z / 2);
    const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
    return z > 0 ? 1 - p : p;
  }

  function positionPrior(pos) {
    if (pos === 'K') return { mean: 8, sd: 3.5 };
    if (pos === 'DEF') return { mean: 7, sd: 4.5 };
    if (pos === 'QB') return { mean: 15, sd: 6.5 };
    if (pos === 'RB') return { mean: 8, sd: 5 };
    if (pos === 'WR') return { mean: 8, sd: 5.5 };
    if (pos === 'TE') return { mean: 6, sd: 4.5 };
    return { mean: 4, sd: 3 };
  }

  function clockMinutes(value) {
    const m = String(value == null ? '' : value).match(/(\d+):(\d{2})/);
    if (!m) return null;
    return Number(m[1]) + Number(m[2]) / 60;
  }

  function phaseFromScore(score) {
    const meta = (score && score.metadata) || {};
    const status = score && score.status;
    const over = meta.is_over === true || meta.is_over === 'true';
    if (status === 'complete' || over) return { status: 'final', fraction: 0, label: 'Final' };
    const started = status === 'in_game' || meta.is_in_progress === true || meta.is_in_progress === 'true' || meta.has1st_quarter_started === true || meta.has1st_quarter_started === 'true';
    if (!started || status === 'pre_game') return { status: 'yet', fraction: 1, label: 'Yet to play' };
    const qStr = String(meta.quarter || '');
    if (/half/i.test(qStr)) return { status: 'live', fraction: 0.5, label: 'In progress' };
    let q = Number(meta.quarter_num);
    if (!q) {
      const n = qStr.match(/\d+/);
      q = n ? Number(n[0]) : 0;
    }
    const clock = clockMinutes(meta.time_remaining);
    if (q >= 5) {
      const left = clock == null ? 5 : clock;
      return { status: 'live', fraction: Math.max(0.02, Math.min(0.2, left / 60)), label: 'In progress' };
    }
    if (!q) return { status: 'live', fraction: 0.5, label: 'In progress' };
    const qLeft = clock == null ? 7.5 : Math.max(0, Math.min(15, clock));
    const elapsed = (q - 1) * 15 + (15 - qLeft);
    return { status: 'live', fraction: Math.max(0, Math.min(1, (60 - elapsed) / 60)), label: 'In progress' };
  }

  function remain(p) {
    const f = p && p.fraction == null ? 1 : Math.max(0, Math.min(1, Number(p && p.fraction) || 0));
    const live = Number(p && p.live) || 0;
    if (!(f > 0)) return { live, mean: 0, var: 0 };
    const mean = (Number(p.mean) || 0) * f;
    const sd = Number(p.sd) || 0;
    return { live, mean, var: sd * sd * f };
  }

  function sideOf(players) {
    let live = 0, remMean = 0, remVar = 0;
    for (const p of players || []) {
      if (!p) continue;
      const r = remain(p);
      live += r.live;
      remMean += r.mean;
      remVar += r.var;
    }
    return { live, mean: live + remMean, sd: Math.sqrt(remVar) };
  }

  function winProb(me, opp) {
    const mine = me && me.sd != null ? me : sideOf(me);
    const theirs = opp && opp.sd != null ? opp : sideOf(opp);
    const v = mine.sd * mine.sd + theirs.sd * theirs.sd;
    if (v < 1e-8) {
      if (mine.mean > theirs.mean + 1e-6) return 1;
      if (mine.mean < theirs.mean - 1e-6) return 0;
      return 0.5;
    }
    return normCdf((mine.mean - theirs.mean) / Math.sqrt(v));
  }

  function probOf(players, opp) {
    return winProb(sideOf(players), opp);
  }

  function candsFor(slot, free, used, elig) {
    let list = free.filter(p => p && !used.has(p.key) && (elig[slot] || []).includes(p.pos));
    if (list.length > 8) {
      const by = fn => list.slice().sort((a, b) => fn(b) - fn(a));
      const keep = new Set();
      for (const p of by(p => p.mean).slice(0, 6)) keep.add(p.key);
      for (const p of by(p => (p.ceil != null ? p.ceil : p.mean + (p.sd || 0))).slice(0, 4)) keep.add(p.key);
      for (const p of by(p => (p.floor != null ? p.floor : p.mean - (p.sd || 0))).slice(0, 4)) keep.add(p.key);
      list = list.filter(p => keep.has(p.key));
    }
    return list;
  }

  function greedyFill(slots, openIdx, fixed, free, elig, scoreFn) {
    const used = new Set(fixed.filter(p => p && p.key).map(p => p.key));
    const assign = fixed.map(p => (p == null ? null : p));
    const ranked = free.slice().sort((a, b) => scoreFn(b) - scoreFn(a));
    for (const i of openIdx) {
      const pick = ranked.find(p => !used.has(p.key) && (elig[slots[i]] || []).includes(p.pos));
      if (pick) { assign[i] = pick; used.add(pick.key); }
    }
    return assign;
  }

  function climb(seed, slots, openIdx, free, elig, opp) {
    const cur = seed.map(p => p || null);
    let bestP = probOf(cur, opp);
    for (let guard = 0; guard < 8; guard++) {
      let changed = false;
      for (const i of openIdx) {
        const used = new Set(cur.filter((p, j) => p && j !== i).map(p => p.key));
        let local = cur[i];
        let localP = bestP;
        for (const cand of candsFor(slots[i], free, used, elig)) {
          const trial = cur.slice();
          trial[i] = cand;
          const pr = probOf(trial, opp);
          if (pr > localP + 1e-7) { localP = pr; local = cand; }
        }
        if (local && (!cur[i] || local.key !== cur[i].key)) {
          cur[i] = local;
          bestP = localP;
          changed = true;
        }
      }
      if (!changed) break;
    }
    return { players: cur, prob: bestP };
  }

  function alignSeed(seed, slots, fixed, elig) {
    const used = new Set();
    const out = slots.map((_, i) => {
      if (fixed[i] === undefined) return null;
      if (fixed[i] && fixed[i].key) used.add(fixed[i].key);
      return fixed[i];
    });
    slots.forEach((slot, i) => {
      if (fixed[i] !== undefined) return;
      const p = seed && seed[i];
      if (!p || !p.key || used.has(p.key) || p.locked || !p.playable) return;
      if (!(elig[slot] || []).includes(p.pos)) return;
      out[i] = p;
      used.add(p.key);
    });
    return out;
  }

  function suggest(opts) {
    const slots = opts.slots || [];
    const elig = opts.elig || {};
    const opp = opts.opp || { mean: 0, sd: 1 };
    const minGain = opts.minGain == null ? 0.02 : opts.minGain;
    const current = slots.map((_, i) => (opts.current && opts.current[i]) || null);
    const roster = opts.roster || [];
    const fixed = slots.map((slot, i) => {
      const p = current[i];
      if (!SKILL_SLOTS.has(slot)) return p;
      if (p && p.locked) return p;
      return undefined;
    });
    const fixedKeys = new Set(fixed.filter(p => p && p.key).map(p => p.key));
    const free = roster.filter(p => p && p.playable && !p.locked && !fixedKeys.has(p.key));
    const openIdx = fixed.map((v, i) => (v === undefined ? i : -1)).filter(i => i >= 0);
    const baseFixed = fixed.map(p => (p === undefined ? null : p));
    const seeds = [current.map(p => p || null)];
    if (openIdx.length) {
      seeds.push(greedyFill(slots, openIdx, baseFixed, free, elig, p => p.mean || 0));
      seeds.push(greedyFill(slots, openIdx, baseFixed, free, elig, p => (p.floor != null ? p.floor : (p.mean || 0) - (p.sd || 0))));
      seeds.push(greedyFill(slots, openIdx, baseFixed, free, elig, p => (p.ceil != null ? p.ceil : (p.mean || 0) + (p.sd || 0))));
      for (const alt of opts.altSeeds || []) seeds.push(alignSeed(alt, slots, fixed, elig));
    }
    let best = { players: current.map(p => p || null), prob: probOf(current, opp) };
    for (const seed of seeds) {
      const climbed = openIdx.length ? climb(seed, slots, openIdx, free, elig, opp) : { players: seed, prob: probOf(seed, opp) };
      if (climbed.prob > best.prob + 1e-9) best = climbed;
    }
    const currentProb = probOf(current, opp);
    const gain = best.prob - currentProb;
    const swaps = [];
    if (gain >= minGain - 1e-12) {
      best.players.forEach((p, i) => {
        const was = current[i];
        if ((p && p.key) !== (was && was.key)) swaps.push({ start: p, sit: was, slot: slots[i] });
      });
    }
    const curSide = sideOf(current);
    return {
      currentProb,
      bestProb: swaps.length ? best.prob : currentProb,
      gain: swaps.length ? gain : 0,
      swaps,
      players: swaps.length ? best.players : current.map(p => p || null),
      currentMean: curSide.mean,
      currentLive: curSide.live,
      oppMean: opp.mean,
      oppLive: opp.live || 0,
      underdog: currentProb < 0.5,
      show: swaps.length > 0,
    };
  }

  return { normCdf, positionPrior, clockMinutes, phaseFromScore, remain, sideOf, winProb, suggest, SKILL_SLOTS };
});
