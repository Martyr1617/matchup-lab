/* Lineup slots and the assignment used by My Team.
   Loaded before team.js in the browser (globalThis.MLLineup) and via require() in Node. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MLLineup = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const ELIG = {
    QB: ['QB'], RB: ['RB'], WR: ['WR'], TE: ['TE'], K: ['K'], DEF: ['DEF'],
    FLEX: ['RB', 'WR', 'TE'], SUPER_FLEX: ['QB', 'RB', 'WR', 'TE'], WRRB_FLEX: ['RB', 'WR'], REC_FLEX: ['WR', 'TE'],
    // Sleeper IDP slots. A DL slot also accepts DE/DT, a DB slot accepts CB/S.
    DL: ['DL', 'DE', 'DT'], LB: ['LB'], DB: ['DB', 'CB', 'S'],
    DE: ['DE', 'DL'], DT: ['DT', 'DL'], CB: ['CB', 'DB'], S: ['S', 'DB'],
    IDP: ['DL', 'LB', 'DB', 'DE', 'DT', 'CB', 'S'],
    IDP_FLEX: ['DL', 'LB', 'DB', 'DE', 'DT', 'CB', 'S'],
  };
  const POOL_POS = new Set([].concat(...Object.values(ELIG)));
  const ESPN_SLOT = { 0: 'QB', 2: 'RB', 3: 'WRRB_FLEX', 4: 'WR', 5: 'REC_FLEX', 6: 'TE', 23: 'FLEX', 7: 'SUPER_FLEX', 17: 'K', 16: 'DEF' };
  const ESPN_SLOT_ORDER = [0, 2, 4, 6, 3, 5, 23, 7, 17, 16];

  function slotsFromSleeper(rosterPositions) {
    return (rosterPositions || [])
      .filter(s => s !== 'BN' && s !== 'IR' && s !== 'TAXI')
      .map(s => (s === 'SUPERFLEX' ? 'SUPER_FLEX' : s));
  }

  function slotsFromEspn(lineupSlotCounts) {
    const counts = lineupSlotCounts || {};
    const slots = [];
    for (const id of ESPN_SLOT_ORDER) {
      const n = Number(counts[id] || counts[String(id)] || 0);
      for (let i = 0; i < n; i++) slots.push(ESPN_SLOT[id]);
    }
    return slots;
  }

  function isMultiQb(slots) {
    return (slots || []).filter(s => (ELIG[s] || []).includes('QB')).length >= 2;
  }

  function isQbOnly(slot) {
    const elig = ELIG[slot];
    return !!elig && elig.length === 1 && elig[0] === 'QB';
  }

  // Hungarian algorithm (min-cost assignment), rows <= cols
  function hungarian(cost) {
    const n = cost.length, m = cost[0].length;
    const u = new Array(n + 1).fill(0), v = new Array(m + 1).fill(0), p = new Array(m + 1).fill(0), way = new Array(m + 1).fill(0);
    for (let i = 1; i <= n; i++) {
      p[0] = i; let j0 = 0; const minv = new Array(m + 1).fill(Infinity); const used = new Array(m + 1).fill(false);
      do {
        used[j0] = true; const i0 = p[j0]; let delta = Infinity, j1 = 0;
        for (let j = 1; j <= m; j++) if (!used[j]) {
          const cur = cost[i0 - 1][j - 1] - u[i0] - v[j];
          if (cur < minv[j]) { minv[j] = cur; way[j] = j0; }
          if (minv[j] < delta) { delta = minv[j]; j1 = j; }
        }
        for (let j = 0; j <= m; j++) { if (used[j]) { u[p[j]] += delta; v[j] -= delta; } else minv[j] -= delta; }
        j0 = j1;
      } while (p[j0] !== 0);
      do { const j1 = way[j0]; p[j0] = p[j1]; j0 = j1; } while (j0);
    }
    const res = new Array(n).fill(-1);
    for (let j = 1; j <= m; j++) if (p[j]) res[p[j] - 1] = j - 1;
    return res;
  }

  function refillSlot(slot, assignment, roster, bannedTeam, curKeys) {
    const used = new Set(assignment.filter(Boolean).map(p => p.key));
    let best = null;
    for (const p of roster) {
      if (!p || used.has(p.key)) continue;
      if (p.locked && !(curKeys && curKeys.has(p.key))) continue;
      if (!(ELIG[slot] || []).includes(p.pos)) continue;
      if (p.pos === 'QB' && p.team && p.team === bannedTeam) continue;
      if (!(p.value >= 0)) continue;
      if (!best || p.value > best.value) best = p;
    }
    return best;
  }

  // In a superflex or 2QB lineup, do not start two QBs from the same NFL team.
  // The higher-value one stays. The other slot takes the next eligible player,
  // or stays empty when every alternative is that same team's QB.
  function separateSameTeamQbs(slots, assignment, roster, curKeys) {
    if (!isMultiQb(slots)) return assignment;
    const qbIdx = [];
    assignment.forEach((p, i) => {
      if (p && p.pos === 'QB' && p.team && (ELIG[slots[i]] || []).includes('QB')) qbIdx.push(i);
    });
    const byTeam = new Map();
    for (const i of qbIdx) {
      const list = byTeam.get(assignment[i].team) || [];
      list.push(i);
      byTeam.set(assignment[i].team, list);
    }
    for (const [tm, idxs] of byTeam) {
      if (idxs.length < 2) continue;
      const ranked = idxs.slice().sort((a, b) => (assignment[b].value || 0) - (assignment[a].value || 0));
      const keepKey = assignment[ranked[0]].key;
      const qbOnly = idxs.find(i => isQbOnly(slots[i]));
      if (qbOnly != null && assignment[qbOnly].key !== keepKey && !assignment[qbOnly].locked) {
        const keepAt = idxs.find(i => assignment[i] && assignment[i].key === keepKey);
        if (keepAt != null && !isQbOnly(slots[keepAt])) {
          const tmp = assignment[qbOnly];
          assignment[qbOnly] = assignment[keepAt];
          assignment[keepAt] = tmp;
        }
      }
      const vacated = [];
      for (const i of idxs) {
        const p = assignment[i];
        if (!p || p.key === keepKey || p.pos !== 'QB' || p.team !== tm) continue;
        if (p.locked) continue;
        assignment[i] = null;
        vacated.push(i);
      }
      vacated.sort((a, b) => (isQbOnly(slots[a]) ? 0 : 1) - (isQbOnly(slots[b]) ? 0 : 1));
      for (const i of vacated) assignment[i] = refillSlot(slots[i], assignment, roster, tm, curKeys);
    }
    return assignment;
  }

  function optimize(slots, roster, currentSlots) {
    const curKeys = new Set((currentSlots || []).filter(c => c.key).map(c => c.key));
    const fixed = new Array(slots.length).fill(null);
    const used = new Set();
    if (currentSlots) {
      const remaining = slots.map((s, i) => i);
      for (const c of currentSlots) {
        if (!c.key) continue;
        const pl = roster.find(p => p.key === c.key);
        if (pl && pl.locked) {
          const i = remaining.find(i => slots[i] === c.slot && fixed[i] === null);
          if (i != null) { fixed[i] = pl; used.add(pl.key); }
        }
      }
    }
    const pool = roster.filter(p => !used.has(p.key) && !(p.locked && !curKeys.has(p.key)) && POOL_POS.has(p.pos));
    const openIdx = slots.map((s, i) => i).filter(i => fixed[i] === null);
    const BIG = 1e6;
    const assignment = fixed.slice();
    if (openIdx.length && pool.length + openIdx.length > 0) {
      const cost = openIdx.map(i => {
        const row = [];
        for (const p of pool) row.push(ELIG[slots[i]]?.includes(p.pos) ? -p.value : BIG);
        for (let k = 0; k < openIdx.length; k++) row.push(0);
        return row;
      });
      const res = hungarian(cost);
      res.forEach((col, r) => { const i = openIdx[r]; assignment[i] = col >= 0 && col < pool.length && cost[r][col] < BIG ? pool[col] : null; });
    }
    return separateSameTeamQbs(slots, assignment, roster, curKeys);
  }

  const fmt1 = n => (Math.round(Number(n) * 10) / 10).toFixed(1);

  // One improving swap. Out / bye / empty sitters count as 0. A swap that
  // does not add points is omitted so an already-optimal lineup stays empty.
  function swapParts(move) {
    const start = move && move.start;
    if (!start || start.status !== 'ok' || !(start.proj >= 0)) return null;
    const sit = move.sit || null;
    const sitProj = sit && sit.status === 'ok' ? Number(sit.proj) || 0 : 0;
    const gain = Number(start.proj) - sitProj;
    if (!(gain > 0.05)) return null;
    return {
      kind: sit ? 'over' : 'empty',
      startName: start.name,
      startProj: fmt1(start.proj),
      sitName: sit ? sit.name : '',
      sitProj: fmt1(sitProj),
      gain: fmt1(gain),
    };
  }

  function swapLine(move) {
    const p = swapParts(move);
    if (!p) return null;
    if (p.kind === 'empty') return `Start ${p.startName} (${p.startProj}) in an empty slot, +${p.gain} pts`;
    return `Start ${p.startName} (${p.startProj}) over ${p.sitName} (${p.sitProj}), +${p.gain} pts`;
  }

  function swapLines(moves) {
    return (moves || []).map(swapLine).filter(Boolean);
  }

  function swapMoves(moves) {
    return (moves || []).map(swapParts).filter(Boolean);
  }

  // Where "Open in Sleeper" sends the user.
  //
  // com.sleeperbot 156.0 (versionCode 4195846), base APK from APKPure on
  // 2026-10-21, MainActivity intent filters:
  // - sleeperbot://open only. scheme sleeperbot AND host open. A path whose
  //   host is "leagues" does not match, and an intent with package=com.sleeperbot
  //   then opens the Play Store. sleeperbot://open launches the app and does
  //   not name a team, so it is not the button.
  // - sleeper:// with no host and no path. Any sleeper:// URI matches, including
  //   sleeper://leagues/<id>/team. That is the deepest path this filter allows
  //   that mirrors the web TEAM route. Whether the app's router lands on the
  //   lineup screen is best-effort: this environment cannot open the native app.
  // - https on sleeper.com / sleeper.app / sleeper.im / sleeper.dev, autoVerify,
  //   pathPattern only /topic/.*, /topics/.*, /channels/.*, /message/.*.
  //   /leagues/<id>/team does not match, so that URL stays in the browser.
  //   The web client routes it to selectedTab TEAM. Logged out, Sleeper
  //   redirects to /?redirect=/leagues/<id>/team. That page is the fallback.
  // iOS was not opened in the installed app. The App Store action
  // sleeper://picks/competition/... shows the current app accepts a path on
  // sleeper://, so iOS uses the same team path and falls back to the web page.
  function sleeperTeamLinks(leagueId) {
    const id = String(leagueId || '');
    if (!/^\d{1,20}$/.test(id)) return null;
    const web = `https://sleeper.com/leagues/${id}/team`;
    const path = `leagues/${id}/team`;
    const fallback = encodeURIComponent(web);
    return {
      web,
      app: `sleeper://${path}`,
      legacyApp: 'sleeperbot://open',
      // No package= param: that is what sends a non-matching intent to the Play Store.
      androidIntent: `intent://${path}#Intent;scheme=sleeper;action=android.intent.action.VIEW;category=android.intent.category.DEFAULT;category=android.intent.category.BROWSABLE;S.browser_fallback_url=${fallback};end`,
    };
  }

  // Desktop uses the verified web team page. Android uses the sleeper:// intent,
  // which matches the installed app's filter, and falls back to that web page.
  // iOS tries the same sleeper:// path, then the web page.
  function sleeperOpenPlan(links, ua) {
    const agent = String(ua || '');
    if (!links) return null;
    if (/Android/i.test(agent)) return { kind: 'intent', url: links.androidIntent, fallback: links.web };
    if (/iPhone|iPad|iPod/i.test(agent)) return { kind: 'app', url: links.app, fallback: links.web };
    return { kind: 'web', url: links.web, fallback: links.web };
  }

  return { ELIG, ESPN_SLOT, ESPN_SLOT_ORDER, slotsFromSleeper, slotsFromEspn, isMultiQb, optimize, separateSameTeamQbs, swapLine, swapLines, swapMoves, sleeperTeamLinks, sleeperOpenPlan };
});
