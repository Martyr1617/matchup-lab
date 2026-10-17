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
    out.sort((a, b) => b.gain - a.gain || String(a.e.name || '').localeCompare(String(b.e.name || '')));
    return out;
  }

  return { advise, minDepth, dropReason, UPSIDE, STAR, INJURED_VALUE };
});
