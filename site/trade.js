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

   Missed games are filled by a replacement starter, not by zero.
     Rest-of-season value is the healthy per-game surplus above the
     positional baseline, times the share of remaining games he will play.
     A missed week costs only his production minus replacement level.
     Questionable, or limited / DNP practice: 0.25 of a game.
     Doubtful: 0.75. Out: 1 game.
     IR or PUP: at least 4 games from the last game played. If that minimum
     is already served and the player is still on IR, count two more games
     unless a headline says he is practicing or designated to return
     (then one more game) or names a return week.
     Fantasy playoff weeks 14–17 count 1.5× inside that share, for every
     player. Week 18 counts once. A bye is not a miss, so a week-14 bye
     does not cost more than a week-6 bye.
     The first game back from IR, or from a layoff of two games or more,
     counts at 0.90. There is no second discount on top of that.
     A long-term injury (ACL, Achilles, season-ending) plays no games, so
     redraft value is near zero before ADP, unless a current report says he
     is practicing in full or limited and trending up, or a headline names a
     return in the next two weeks. That report overrides a stale IR, PUP, or
     out tag. A full week of practice is a one-game discount. Limited and
     improving is two games. "Out for the season" or a return date next year
     still plays no games. Dynasty keeps the healthy outlook and discounts a
     true season-ending injury by 7 percent. A short absence shaves only
     15 percent of the redraft haircut off dynasty.
     A returning player whose healthy rate is a starter rate, and who has no
     teammate with a 10-point prior season or a 14-point current pace, keeps
     that healthy rest-of-season rate. A fill-in workload does not take it.
     A vague injury blurb does not change the timeline.
     A player with at least two games is shrunk toward the best of his last
     few full seasons, counting that history as two games, and then moved
     20 percent of the way toward the points pace implied by his current
     redraft market rank. One or two quiet weeks do not set the rate alone.
     The market rank is the FantasyCalc redraft board. A season-ending
     injury stays on the injury timeline.

   Hurt players, and anyone with no current-week projection, use a healthy
   baseline instead of a depressed or missing 2026 sample: 65 percent of the
   last season with at least 6 games, 35 percent of a games-weighted career.
   The card shows the injury-adjusted value, the healthy value, and the
   games he is expected to miss.

   Scarcity is a positional baseline, not a hard cutoff:
     1QB:       QB20, RB30, WR36, TE12
     Superflex: QB32, RB30, WR36, TE12
     QB20 is a streaming quarterback, so a top 1QB quarterback is worth a
     mid-tier RB1 or WR1 and no more. QB32 is deep enough that superflex
     quarterbacks carry real value and the elites sit with the top skill
     players. RB30 and WR36 stand in for two starters plus the flex.
     Surplus = projected points − that baseline (it may be negative).
     The value curve is a softplus, T × ln(1 + exp(surplus / T)), T = 20.
     Clear of the baseline it is linear in surplus. Below the baseline it
     eases toward zero and keeps rising with projected points, so a better
     player is never worth less than a worse one. The 0–100 scale divides
     by the largest curve value in that scoring, format, and horizon.

   Dynasty is 60% of the healthy rest-of-season total and 40% a
   next-season outlook: healthy points per game × 17 × age curve × role
   (volume versus the positional median, 0.75–1.15) × team offense
   (points per game versus the league, clamped 0.90–1.10). A short-term
   injury only shaves a small part of that. A long-term injury discounts
   the whole dynasty figure by 7 percent.

   Every team's starting quarterback, top running back, top receivers, and
   starting tight end stay searchable even when they are outside the top 250.
   So do QB2, the top three running backs, the top five receivers, the top
   two tight ends, and anyone with a meaningful recent season. Players
   added only for that list do not move the replacement line.

   Consolidation: each extra player on the deeper side discounts that
   side by 4% of its total, capped at 12%. A 2-for-1 is a 4% depth
   discount. The same player on both sides is dropped from both totals.
   A duplicate on one side is kept once.

   Grades use the gap as a share of the larger side:
     ≤4% A+ fair, ≤8% A fair, ≤12% B slight edge,
     ≤18% C clear winner, ≤26% D lopsided, else F lopsided.

   ADP is a season-to-date average draft position, mostly from preseason
   drafts, so it is not an in-season trade price. A curve fit on healthy
   players in the top 150 of that ADP maps the draft slot onto this 0–100
   scale, separately for each scoring, quarterback format, and horizon.
   The blend is 5% redraft / 15% dynasty for a healthy player and 30% / 35%
   when missed games have already cut the projection. It only moves a value
   up, and it never goes above that player's healthy-baseline value.
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
    qb1: { QB: 20, RB: 30, WR: 36, TE: 12 },
    sflex: { QB: 32, RB: 30, WR: 36, TE: 12 },
  };
  const DYNASTY_ROS = 0.6;
  const DYNASTY_NEXT = 0.4;
  const CONSOLIDATION = 0.04;
  const CONSOLIDATION_CAP = 0.12;
  const TOP_N = 250;
  // ADP curve is fit on the top of the draft board, separate from the
  // searchable trade set, so widening search does not refit that curve.
  const ADP_FIT_N = 150;
  const CURVE_T = 20;
  const SEASON_WEEKS = 17;
  // [redraft, dynasty]. Healthy players already sit on the healthy baseline,
  // so the smaller weight usually does not move them.
  const ADP_WEIGHT = { healthy: [0.05, 0.15], hurt: [0.30, 0.35] };
  // Two games of prior-season pace, then 20 percent of the market-implied pace.
  // Tuned on 2024–2025: rest-of-season PPR error fell and positional rank held.
  const TALENT_K = 2;
  const MARKET_W = 0.2;
  const PLAYOFF_WEIGHT = 1.5;
  const RETURN_RAMP = 0.9;
  // Share of the redraft haircut that dynasty feels on a short absence.
  const DYNASTY_SHORT = 0.15;

  const AGE_CURVE = {
    QB: { start: 24, peak0: 28, peak1: 33, cliff: 38 },
    RB: { start: 21, peak0: 23, peak1: 26, cliff: 30 },
    WR: { start: 22, peak0: 25, peak1: 29, cliff: 33 },
    TE: { start: 22, peak0: 26, peak1: 29, cliff: 33 },
  };

  function round1(n) { return Math.round(n * 10) / 10; }
  function round2(n) { return Math.round(n * 100) / 100; }
  function round3(n) { return Math.round(n * 1000) / 1000; }
  function round4(n) { return Math.round(n * 10000) / 10000; }
  // Stars stay on tenths. Below 1 the tail keeps hundredths, and below 0.1
  // it keeps thousandths, so a deeper projection does not collapse to 0.
  function publishValue(n) {
    if (!(n > 0)) return 0;
    const capped = Math.min(100, n);
    if (capped >= 1) return round1(capped);
    if (capped >= 0.1) return round2(capped);
    return Math.max(0.001, round3(capped));
  }

  // Monotone curve from ADP (1 is the top pick) to value, fit on healthy
  // players. Bins of about a dozen picks, median value, pooled so a later
  // pick is never worth more than an earlier one.
  function fitAdpCurve(points) {
    const rows = (points || []).filter(p => p && p.adp > 0 && p.value >= 0 && !p.hurt)
      .sort((a, b) => a.adp - b.adp)
      .slice(0, ADP_FIT_N);
    if (rows.length < 40) return null;
    const size = Math.max(8, Math.round(rows.length / 12));
    const bins = [];
    for (let i = 0; i < rows.length; i += size) {
      const chunk = rows.slice(i, i + size);
      if (chunk.length < 4) continue;
      const adp = chunk.reduce((s, p) => s + p.adp, 0) / chunk.length;
      const vals = chunk.map(p => p.value).sort((a, b) => a - b);
      bins.push([adp, vals[Math.floor((vals.length - 1) / 2)], chunk.length]);
    }
    if (bins.length < 4) return null;
    const pool = [];
    for (const bin of bins) {
      pool.push(bin.slice());
      while (pool.length >= 2 && pool[pool.length - 2][1] < pool[pool.length - 1][1]) {
        const left = pool[pool.length - 2];
        const right = pool[pool.length - 1];
        const w = left[2] + right[2];
        pool[pool.length - 2] = [(left[0] * left[2] + right[0] * right[2]) / w, (left[1] * left[2] + right[1] * right[2]) / w, w];
        pool.pop();
      }
    }
    return function (adp) {
      if (adp <= pool[0][0]) return pool[0][1];
      if (adp >= pool[pool.length - 1][0]) return pool[pool.length - 1][1];
      for (let i = 1; i < pool.length; i++) {
        if (adp <= pool[i][0]) {
          const span = Math.log(pool[i][0]) - Math.log(pool[i - 1][0]);
          const t = span ? (Math.log(adp) - Math.log(pool[i - 1][0])) / span : 0;
          return pool[i - 1][1] + t * (pool[i][1] - pool[i - 1][1]);
        }
      }
      return pool[pool.length - 1][1];
    };
  }

  function adpRank(pl, mode) {
    if (mode === 'sflex' && pl.adp_sf > 0) return pl.adp_sf;
    return pl.adp > 0 ? pl.adp : 0;
  }

  // Move toward the draft-slot value only when that slot is worth more, and
  // stop at the healthy baseline. A worse ADP does not cut the projection.
  function blendValue(value, healthy, slot, weight) {
    const cap = Math.max(value, healthy);
    const mixed = (1 - weight) * value + weight * slot;
    return publishValue(Math.min(cap, Math.max(value, mixed)));
  }

  // model is this year's projected points per game. prior is the recent
  // full-season pace. expert is the pace implied by market rank. A
  // season-ending injury keeps the model rate, which the injury timeline
  // then discounts.
  function talentRate(model, prior, games, expert, longTerm) {
    let rate = num(model);
    const n = num(games);
    if (!longTerm && prior > 0 && n >= 2) rate = (n * rate + TALENT_K * prior) / (n + TALENT_K);
    if (!longTerm && expert > 0 && n >= 2) rate = (1 - MARKET_W) * rate + MARKET_W * expert;
    return rate;
  }

  function marketOf(pl, market) {
    if (!market || !pl) return null;
    const sl = pl.ids && pl.ids.sl;
    if (sl && market[sl]) return market[sl];
    if (pl.id && market[pl.id]) return market[pl.id];
    return null;
  }

  function marketCurves(players, baselines, market) {
    const curves = {};
    baselines = baselines || {};
    for (const key of SCORINGS) {
      const points = [];
      for (const pl of players || []) {
        const row = marketOf(pl, market);
        const hist = baselines[pl.id] || (pl.ids && baselines[pl.ids.sl]) || null;
        if (!row || !(row.rank > 0) || !hist || !(hist[key] > 0)) continue;
        points.push({ adp: row.rank, value: hist[key], hurt: false });
      }
      curves[key] = fitAdpCurve(points);
    }
    return curves;
  }

  function blendAdp(players) {
    const curves = {};
    for (const key of SCORINGS) {
      curves[key] = {};
      for (const mode of QB_MODES) {
        curves[key][mode] = [0, 1].map(hi => fitAdpCurve((players || []).filter(p => p && p.tv).map(p => ({
          adp: adpRank(p, mode),
          value: p.tv.v[key][mode][hi],
          hurt: !!(p.tv && p.tv.inj),
        }))));
      }
    }
    for (const pl of players || []) {
      if (!pl || !pl.tv || !pl.tv.v) continue;
      for (const key of SCORINGS) {
        for (const mode of QB_MODES) {
          const rank = adpRank(pl, mode);
          for (let hi = 0; hi < 2; hi++) {
            const curve = curves[key][mode][hi];
            if (!curve || !rank) continue;
            const w = (pl.tv.inj ? ADP_WEIGHT.hurt : ADP_WEIGHT.healthy)[hi];
            pl.tv.v[key][mode][hi] = blendValue(pl.tv.v[key][mode][hi], pl.tv.pre[key][mode][hi], curve(rank), w);
          }
        }
      }
    }
    return players;
  }

  // Walk the sub-1 tail from the better projection to the worse one.
  // A tie, or a small inversion, steps down by a thousandth so two different
  // projections do not share a value, without pulling the rest of the curve down.
  function untieTail(players) {
    const rosIndex = { ppr: 0, half: 1, std: 2 };
    for (const key of SCORINGS) {
      for (const mode of QB_MODES) {
        for (let hi = 0; hi < 2; hi++) {
          for (const pos of ['QB', 'RB', 'WR', 'TE']) {
            const rows = (players || []).filter(p => p && p.pos === pos && p.tv && p.tv.v && p.tv.par && p.tv.v[key][mode][hi] > 0 && p.tv.v[key][mode][hi] < 1);
            rows.sort((a, b) => {
              const dp = b.tv.par[key][mode][hi] - a.tv.par[key][mode][hi];
              if (dp) return dp;
              const ros = b.tv.ros[rosIndex[key]] - a.tv.ros[rosIndex[key]];
              if (ros) return ros;
              return String(a.id).localeCompare(String(b.id));
            });
            let groupPar = null;
            let groupRos = null;
            let groupFloor = null;
            let betterPar = null;
            let betterFloor = null;
            for (const p of rows) {
              const par = p.tv.par[key][mode][hi];
              const ros = p.tv.ros[rosIndex[key]];
              let v = p.tv.v[key][mode][hi];
              if (groupPar != null && par < groupPar - 1e-9) {
                betterFloor = groupFloor;
                betterPar = groupPar;
              }
              const ceiling = betterFloor != null && par < betterPar - 1e-9 ? betterFloor
                : (groupPar != null && Math.abs(par - groupPar) < 1e-9 && ros < groupRos - 1e-9 ? groupFloor : null);
              if (ceiling != null && v >= ceiling && !(p.adp && p.tv.inj)) {
                const step = ceiling >= 0.1 ? 0.001 : 0.0001;
                let nv = round4(ceiling - step);
                if (!(nv > 0) || nv >= ceiling) nv = round4(ceiling * 0.5);
                if (!(nv > 0)) nv = 0.0001;
                v = nv;
                p.tv.v[key][mode][hi] = v;
              }
              if (groupPar == null || par < groupPar - 1e-9) {
                groupPar = par;
                groupRos = ros;
                groupFloor = v;
              } else if (ros < groupRos - 1e-9) {
                groupRos = ros;
                groupFloor = v;
              } else if (groupFloor == null || v < groupFloor) groupFloor = v;
            }
          }
        }
      }
    }
    return players;
  }

  function valueText(n) {
    const v = Number(n) || 0;
    if (!(v > 0)) return '0.0';
    if (v >= 1) return round1(v).toFixed(1);
    const shown = round4(v);
    const evenHundredth = Math.abs(shown * 100 - Math.round(shown * 100)) < 1e-6;
    if (v < 0.1 || !evenHundredth) {
      const text = shown.toFixed(4).replace(/0+$/, '');
      const decimals = (text.split('.')[1] || '');
      return decimals.length < 2 ? shown.toFixed(2) : text;
    }
    return round2(shown).toFixed(2);
  }
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

  function weekWeight(week) {
    return week >= 14 && week <= 17 ? PLAYOFF_WEIGHT : 1;
  }

  // Share of the weighted remaining slate he actually plays. Missed games
  // come off the front. A fractional miss reduces that week. The first week
  // with any play is the only ramp, and only when the timeline asks for it.
  function playedShare(nextWeek, miss, ramp) {
    if (miss === Infinity) return 0;
    const start = nextWeek || 1;
    const weights = [];
    for (let wk = start; wk <= 18; wk++) weights.push(weekWeight(wk));
    const total = weights.reduce((s, x) => s + x, 0);
    if (!(total > 0)) return 0;
    let left = Number(miss) || 0;
    if (left < 0) left = 0;
    let played = 0;
    let ramped = false;
    for (const wt of weights) {
      if (left >= 1 - 1e-9) { left -= 1; continue; }
      const frac = left > 1e-9 ? 1 - left : 1;
      left = 0;
      let piece = wt * frac;
      if (ramp && !ramped) { piece *= RETURN_RAMP; ramped = true; }
      played += piece;
    }
    if (played <= 0) return 0;
    return played / total;
  }

  function dynastyShare(share) {
    return 1 - DYNASTY_SHORT * (1 - (share || 0));
  }

  const SEASON_OUTLOOK = /out for the (rest of the )?season|miss(?:ing)? the rest of (?:the )?season|season-ending|season ending|ruled out for the (?:year|season)|not coming back|won'?t return this season/;

  function foldName(text) {
    return String(text || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[.'’`-]/g, ' ').replace(/\b(jr|sr|ii|iii|iv|v)\b/g, ' ')
      .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  }

  // A roundup that names several players only counts when the phrase sits
  // next to this player's name. A headline with no name still counts.
  function phraseNear(text, name, re) {
    const s = String(text || '').toLowerCase();
    if (!re.test(s)) return false;
    const folded = foldName(name);
    if (!folded) return true;
    const last = folded.split(' ').filter(w => w.length > 2).pop() || '';
    const needles = last && last !== folded ? [folded, last] : [folded];
    const spots = [];
    for (const needle of needles) {
      let from = 0;
      while (from < s.length) {
        const at = s.indexOf(needle, from);
        if (at < 0) break;
        spots.push(at);
        from = at + needle.length;
      }
    }
    if (!spots.length) return false;
    for (const at of spots) {
      if (re.test(s.slice(Math.max(0, at - 80), at + folded.length + 220))) return true;
    }
    return false;
  }

  function practiceLevel(text) {
    const s = String(text || '').toLowerCase();
    if (!s) return '';
    if (/full participant|full participation|practiced in full|practiced full|full practice/.test(s)) return 'full';
    if (/limited participant|limited participation|limited practice/.test(s)) return 'limited';
    if (/did not participate|did not practice|\bdnp\b/.test(s)) return 'dnp';
    return '';
  }

  function trendingText(text) {
    return /designated to return|practice window|upgraded to limited|trending up|increased practice/.test(String(text || '').toLowerCase());
  }

  function parseNews(text, name) {
    const s = String(text || '').toLowerCase();
    const out = {};
    if (!s) return out;
    if (phraseNear(s, name, SEASON_OUTLOOK)) out.long = true;
    let m = s.match(/(?:return(?:s|ing)?|back|targeting|target(?:ing)?|debut)\D{0,60}week\s*(\d{1,2})/);
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
    if (phraseNear(s, name, /full participant|full participation|practiced in full|practiced full|full practice/)) {
      out.practicing = true;
      out.full = true;
    } else if (phraseNear(s, name, /returning to practice|returned to practice|return to practice|practicing again/)) out.practicing = true;
    if (phraseNear(s, name, /limited participant|limited participation|limited practice/)) out.limited = true;
    if (phraseNear(s, name, /designated to return|practice window|upgraded to limited|trending up|increased practice/)) out.trending = true;
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

  function seasonNote() {
    return {
      serious: true, long: true, miss: 0, eq: 0, full: 0, ramp: false,
      ret: null, practice: '', practiceBack: false, lead: false,
    };
  }

  function injuryPlan(input) {
    input = input || {};
    const nextWeek = input.nextWeek || 1;
    const basis = input.basis || 1;
    const lastWeek = input.lastWeek || 0;
    const news = Object.assign({}, ...(input.news || []).map(text => parseNews(text, input.name)));
    const cls = classifyStatus(input.status, input.body);
    const label = input.status || '';
    const detail = input.body || '';
    const comment = String(input.comment || '');
    const level = practiceLevel(input.practice) || practiceLevel(comment) || (news.full ? 'full' : (news.limited ? 'limited' : ''));
    const trending = !!(input.trending || news.trending || (level === 'limited' && trendingText(comment)));
    const seasonWords = !!(news.long || input.returnFar || phraseNear(comment, input.name, SEASON_OUTLOOK));
    const gone = seasonNote();
    gone.miss = basis;
    gone.full = basis;
    gone.label = label || 'IR';
    gone.detail = detail;
    gone.note = 'Out for the season';
    gone.kind = cls.kind || 'ir';
    if (seasonWords || (cls.kind === 'susp' && !news.missWeeks && !news.returnWeek && level !== 'full')) return gone;

    function shortReturn(reason) {
      let miss = reason === 'limited' ? 2 : 1;
      if (reason === 'full' && (cls.kind === 'q' || cls.kind === 'd')) miss = cls.kind === 'd' ? 0.75 : 0.25;
      if (reason === 'week' && news.returnWeek) miss = Math.max(cls.kind === 'q' ? 0.25 : 1, news.returnWeek - nextWeek);
      miss = Math.max(0, Math.min(basis, miss));
      const served = lastWeek ? Math.max(0, nextWeek - lastWeek - 1) : (nextWeek > 2 ? nextWeek - 1 : 0);
      const ramp = miss >= 0.75 && (served >= 2 || cls.kind === 'ir' || cls.kind === 'out');
      const serious = miss >= 0.75;
      const ret = miss >= 1 ? nextWeek + Math.ceil(miss) : (news.returnWeek || null);
      const practice = reason === 'limited' ? 'Limited, trending up' : (reason === 'week' ? 'Returning' : 'Full practice');
      let note = 'Full practice. Short absence, not out for the season.';
      if (reason === 'limited') note = 'Practice is trending up. Short absence, not out for the season.';
      if (reason === 'week') note = 'Expected back soon. Short absence, not out for the season.';
      return {
        serious, long: false, miss, eq: gameEq(basis, miss, ramp), full: basis,
        ramp, ret, label, detail, note, kind: cls.kind === 'ok' ? 'q' : cls.kind,
        practice, practiceBack: true, lead: false,
      };
    }

    if (level === 'full' || (level === 'limited' && trending)) return shortReturn(level === 'full' ? 'full' : 'limited');
    if (news.returnWeek && news.returnWeek <= nextWeek + 1 && (cls.long || cls.kind === 'ir' || cls.kind === 'out')) return shortReturn('week');
    const soft = phraseNear(comment, input.name, /isn'?t believed to be a long-term|not believed to be a long-term|not a long-term|able to play|expected to play/);
    if (!(soft && (cls.kind === 'q' || cls.kind === 'd')) && cls.long) return gone;

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
      if (input.returnWeek && input.returnWeek > (ret || nextWeek) && input.returnWeek <= 18) ret = input.returnWeek;
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
      practice: '', practiceBack: false, lead: false,
    };
  }

  // A fill-in can be getting the carries while the starter is out. He is
  // real competition only with a starter's prior season or a bellcow pace.
  function isLead(pl, players, baselines) {
    baselines = baselines || {};
    const priorOf = o => {
      if (!o) return 0;
      const b = baselines[o.id] || (o.ids && baselines[o.ids.sl]) || null;
      if (b && b.ppr) return num(b.ppr);
      return num(o.prior_ppr);
    };
    const self = priorOf(pl) || num(pl.ppr_pg) || (pl.tv && pl.tv.base && num(pl.tv.base[0]));
    if (!(self >= 8)) return false;
    const touch = { QB: 20, RB: 12, WR: 7, TE: 5 }[pl.pos] || 8;
    for (const o of players || []) {
      if (!o || o === pl || o.id === pl.id || o.team !== pl.team || o.pos !== pl.pos) continue;
      if (priorOf(o) >= 10) return false;
      if ((o.g || 0) >= 4 && num(o.ppr_pg) >= 14) return false;
      if (volumeOf(o) >= touch && num(o.ppr_pg) >= 10 && (o.g || 0) >= 4) return false;
    }
    return true;
  }

  function weekForDate(data, iso) {
    const day = String(iso || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
    const season = data && data.meta && data.meta.season;
    if (season && Number(day.slice(0, 4)) > Number(season)) return null;
    const sched = (data && data.schedule) || {};
    for (const wk of Object.keys(sched)) {
      for (const g of sched[wk] || []) {
        if ((g.date || '').slice(0, 10) === day) return Number(wk);
      }
    }
    let week = null;
    for (const wk of Object.keys(sched)) {
      for (const g of sched[wk] || []) {
        const d = (g.date || '').slice(0, 10);
        if (d && d >= day) {
          const w = Number(wk);
          if (week == null || w < week) week = w;
        }
      }
    }
    return week;
  }

  function readEspnPractice(payload) {
    const rows = [];
    for (const club of (payload && payload.injuries) || []) {
      for (const inj of club.injuries || []) {
        const name = (inj.athlete || {}).displayName;
        if (!name) continue;
        const details = inj.details || {};
        rows.push({
          name,
          status: inj.status || '',
          body: details.type || '',
          comment: [inj.shortComment, inj.longComment].filter(Boolean).join(' '),
          returnDate: details.returnDate || '',
        });
      }
    }
    return rows;
  }

  function practiceInput(pl, row, data, news) {
    const nextWeek = (data.meta && data.meta.next_week) || (pl.tv && pl.tv.week) || 1;
    const season = data.meta && data.meta.season;
    const returnFar = !!(row && row.returnDate && season && Number(String(row.returnDate).slice(0, 4)) > Number(season));
    return {
      status: (pl.sl_inj && pl.sl_inj.status) || (row && row.status) || '',
      body: (pl.sl_inj && pl.sl_inj.body) || (row && row.body) || '',
      lastWeek: pl.last_wk || 0,
      nextWeek,
      basis: (pl.tv && pl.tv.g) || gamesBasis(data),
      news: news || [],
      name: pl.name,
      comment: (row && row.comment) || '',
      practice: (row && row.comment) || '',
      returnWeek: returnFar ? null : (row && weekForDate(data, row.returnDate)),
      returnFar,
      trending: !!(row && trendingText(row.comment)),
    };
  }

  function leadNote(plan) {
    if (plan && plan.lead && plan.practice === 'Full practice') {
      plan.note = 'Full practice. Lead role, so the rest-of-season value stays near his healthy baseline.';
    }
    return plan;
  }

  // Rewrite a baked trade card when a live practice report clears a
  // season-long tag, or shortens an IR clock to a game or two.
  function reprice(pl, plan, data) {
    const tv = pl && pl.tv;
    const meta = data && data.meta && data.meta.trade;
    if (!tv || !tv.base || !tv.v || !meta || !meta.repl || !meta.max) return false;
    const wasLong = !!(tv.season || (tv.inj && tv.inj.long));
    const basis = tv.g || plan.full || 1;
    const week = tv.week || (data.meta && data.meta.next_week) || 1;
    if (wasLong && !plan.long && Array.isArray(tv.nxt)) tv.nxt = tv.nxt.map(n => round1(num(n) / LONG_DYNASTY));
    const share = plan.long ? 0 : playedShare(week, plan.miss, plan.ramp);
    const play = plan.long ? 0 : gameEq(basis, plan.miss, plan.ramp);
    tv.ros = tv.base.map(per => round1(num(per) * play));
    tv.share = Math.round(share * 10000) / 10000;
    tv.season = !!plan.long;
    tv.miss = plan.long ? basis : plan.miss;
    for (let i = 0; i < SCORINGS.length; i++) {
      const key = SCORINGS[i];
      const per = num(tv.base[i]);
      const healthy = per * basis;
      const nxtFull = num(tv.nxt && tv.nxt[i]);
      const blend = DYNASTY_ROS * healthy + DYNASTY_NEXT * nxtFull;
      for (const mode of QB_MODES) {
        const lines = meta.repl[key] && meta.repl[key][mode] && meta.repl[key][mode][pl.pos];
        const caps = meta.max[key] && meta.max[key][mode];
        if (!lines || !caps) continue;
        const packV = [];
        const packP = [];
        for (let hi = 0; hi < 2; hi++) {
          const line = num(lines[hi]);
          const healthyPts = hi === 0 ? healthy : blend;
          let surplus;
          if (plan.long && hi === 1) surplus = healthyPts * LONG_DYNASTY - line;
          else if (!(share > 0)) surplus = -line;
          else {
            const use = hi === 0 ? share : dynastyShare(share);
            const healthySurplus = healthyPts - line;
            surplus = use * healthySurplus;
            if (surplus > healthySurplus) surplus = healthySurplus;
          }
          packP.push(round1(surplus));
          packV.push(scaled(surplus, num(caps[hi])));
        }
        tv.v[key][mode] = packV;
        if (tv.par && tv.par[key]) tv.par[key][mode] = packP;
      }
    }
    tv.inj = {
      st: plan.label || (plan.long ? 'IR' : 'Injured'),
      body: plan.detail || null,
      ret: plan.ret,
      long: !!plan.long,
      miss: plan.miss,
      note: plan.note || '',
      practice: plan.practice || '',
      lead: !!plan.lead,
    };
    return true;
  }

  function applyPractice(data, payload) {
    if (!data || !payload || !(data.players || []).length) return 0;
    const byName = new Map();
    for (const pl of data.players) if (pl && pl.name) byName.set(foldName(pl.name), pl);
    let n = 0;
    for (const row of readEspnPractice(payload)) {
      const pl = byName.get(foldName(row.name));
      if (!pl || !pl.tv) continue;
      const plan = leadNote(injuryPlan(practiceInput(pl, row, data, [])));
      if (plan.practiceBack) plan.lead = isLead(pl, data.players, {});
      leadNote(plan);
      const bakedMiss = (pl.tv.season || (pl.tv.inj && pl.tv.inj.long)) ? Infinity : num(pl.tv.miss);
      const falseSeason = !!(pl.tv.season || (pl.tv.inj && pl.tv.inj.long)) && !plan.long;
      const shorter = plan.practiceBack && bakedMiss > plan.miss + 0.05;
      if (!falseSeason && !shorter) continue;
      if (reprice(pl, plan, data)) n += 1;
    }
    return n;
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

  function curve(surplus) {
    const x = surplus / CURVE_T;
    let sp;
    if (x > 30) sp = x;
    else if (x < -30) sp = Math.exp(x);
    else sp = Math.log(1 + Math.exp(x));
    return CURVE_T * sp;
  }

  function scaled(surplus, maxCurve) {
    if (!(maxCurve > 0)) return 0;
    return publishValue(100 * curve(surplus) / maxCurve);
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
    const practiceByName = new Map();
    for (const row of readEspnPractice(opts.espn)) practiceByName.set(foldName(row.name), row);
    const mktCurves = marketCurves(players, baselines, opts.market || null);
    const rows = players.map(pl => {
      const outlook = sumOutlook(pl, data, project, scoringTable);
      const basis = outlook.games;
      const statusText = (pl.sl_inj && pl.sl_inj.status) || (pl.inj && pl.inj.status) || (pl.inj && pl.inj.practice) || '';
      const bodyText = (pl.sl_inj && pl.sl_inj.body) || (pl.inj && pl.inj.injury) || '';
      const report = practiceByName.get(foldName(pl.name));
      const seasonYear = data.meta && data.meta.season;
      const returnFar = !!(report && report.returnDate && seasonYear && Number(String(report.returnDate).slice(0, 4)) > Number(seasonYear));
      let timeline = injuryPlan({
        status: statusText, body: bodyText, lastWeek: pl.last_wk || 0, nextWeek, basis,
        news: newsById[pl.id] || [], name: pl.name,
        comment: report && report.comment, practice: report && report.comment,
        returnWeek: returnFar ? null : (report && weekForDate(data, report.returnDate)),
        returnFar, trending: !!(report && trendingText(report.comment)),
      });
      if (timeline.practiceBack) timeline.lead = isLead(pl, players, baselines);
      timeline = leadNote(timeline);
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
      if (!timeline.long && (pl.g || 0) >= 2 && !usedBase) {
        const row = marketOf(pl, opts.market);
        for (const key of SCORINGS) {
          const expert = row && mktCurves[key] ? mktCurves[key](row.rank) : 0;
          const prior = hist && hist[key];
          rate[key] = talentRate(rate[key], prior, pl.g || 0, expert, false);
        }
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

    function measureHealthy(row, key, mode, horizon) {
      if (horizon === 'dynasty' && row.dyn && row.dyn[key] != null) return row.dyn[key] / LONG_DYNASTY;
      if (horizon === 'redraft') return row.healthy[key];
      return DYNASTY_ROS * row.healthy[key] + DYNASTY_NEXT * row.nxtFull[key];
    }

    for (const row of rows) {
      row.share = row.timeline.long ? 0 : playedShare(nextWeek, row.timeline.miss, row.timeline.ramp);
    }

    // The replacement starter is a full-season healthy player. Missed games
    // are worth that starter's points, so the line is not dragged down by
    // the injured totals.
    function surplusOf(row, key, mode, horizon) {
      const hi = horizon === 'redraft' ? 0 : 1;
      const healthyPts = measureHealthy(row, key, mode, horizon);
      const line = (repl[key][mode][row.pl.pos] || [0, 0])[hi];
      const healthySurplus = healthyPts - line;
      if (horizon === 'dynasty' && row.timeline.long) return healthyPts * LONG_DYNASTY - line;
      const share = horizon === 'redraft' ? row.share : dynastyShare(row.share);
      if (!(share > 0)) return -line;
      const surplus = share * healthySurplus;
      return surplus > healthySurplus ? healthySurplus : surplus;
    }

    for (const key of SCORINGS) {
      for (const mode of QB_MODES) {
        for (const horizon of ['redraft', 'dynasty']) {
          const byPos = {};
          for (const row of rows) {
            if (row.pl.added) continue;
            (byPos[row.pl.pos] = byPos[row.pl.pos] || []).push({ pts: measureHealthy(row, key, mode, horizon), row });
          }
          const hi = horizon === 'redraft' ? 0 : 1;
          for (const pos of Object.keys(SLOTS[mode])) {
            repl[key][mode][pos] = repl[key][mode][pos] || [0, 0];
            repl[key][mode][pos][hi] = round1(replacementPoints(byPos[pos] || [], SLOTS[mode][pos]));
          }
          let max = 0;
          for (const row of rows) {
            if (row.pl.added) continue;
            max = Math.max(max, curve(surplusOf(row, key, mode, horizon)));
          }
          maxPar[key][mode][hi] = max;
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
            const surplus = surplusOf(row, key, mode, horizon);
            packP.push(round1(surplus));
            packV.push(scaled(surplus, maxPar[key][mode][hi]));
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
            pack.push(scaled(pts - line, maxPar[key][mode][hi]));
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
        inj: showInj ? { st: tl.label || (tl.long ? 'IR' : 'Injured'), body: tl.detail || null, ret: tl.ret, long: !!tl.long, miss: tl.miss, note: tl.note || '', practice: tl.practice || '', lead: !!tl.lead } : null,
        share: Math.round(row.share * 10000) / 10000,
        week: nextWeek,
        starter: !!row.pl.starter,
        keep: !!row.pl.keep,
      };
    }

    blendAdp(players);
    untieTail(players);

    const rankScore = pl => Math.max(pl.tv.v.ppr.qb1[0], pl.tv.v.ppr.qb1[1]);
    const ranked = players.slice().sort((a, b) => (rankScore(b) - rankScore(a)) || (b.tv.ros[0] - a.tv.ros[0]));
    ranked.forEach((pl, i) => { pl.tv.top = i < TOP_N; });

    data.meta = data.meta || {};
    const maxOut = { ppr: blank(), half: blank(), std: blank() };
    for (const key of SCORINGS) {
      for (const mode of QB_MODES) {
        maxOut[key][mode] = maxPar[key][mode].map(round1);
      }
    }
    data.meta.trade = {
      v: 7,
      playoff: PLAYOFF_WEIGHT,
      ramp: RETURN_RAMP,
      top: TOP_N,
      slots: SLOTS,
      curve: { t: CURVE_T },
      dynasty: [DYNASTY_ROS, DYNASTY_NEXT],
      consolidation: CONSOLIDATION,
      cap: CONSOLIDATION_CAP,
      adp: ADP_WEIGHT,
      talent: TALENT_K,
      market: MARKET_W,
      max: maxOut,
      repl,
    };
    return data;
  }

  function shareRatio(wasShare, nowShare, hi) {
    const was = wasShare > 0 ? wasShare : 1;
    if (hi === 1) {
      const wasD = dynastyShare(was);
      const nowD = dynastyShare(nowShare || 0);
      return wasD > 0 ? nowD / wasD : 0;
    }
    return (nowShare || 0) / was;
  }

  function valueOf(player, opts) {
    const tv = player && player.tv;
    if (!tv || !tv.v) return 0;
    const scoring = SCORINGS.includes(opts && opts.scoring) ? opts.scoring : 'ppr';
    const mode = opts && opts.qb === 'sflex' ? 'sflex' : 'qb1';
    const hi = opts && opts.horizon === 'dynasty' ? 1 : 0;
    const base = tv.v[scoring][mode][hi];
    const extra = opts && opts.newsMiss ? opts.newsMiss : 0;
    const week = tv.week || 1;
    if (tv.inj) {
      const baked = tv.inj.long ? Infinity : (tv.inj.miss || 0);
      if (!(extra > baked) || tv.inj.long) return base;
      const now = playedShare(week, extra, extra >= 2);
      return publishValue(base * shareRatio(tv.share, now, hi));
    }
    const status = tv.season ? Infinity : (tv.miss || 0);
    const miss = combineMiss(status, extra);
    if (miss === status || !tv.g) return base;
    if (miss === Infinity) return hi === 1 ? publishValue(base * LONG_DYNASTY) : 0;
    const now = playedShare(week, miss, miss >= 2);
    const was = tv.share > 0 ? tv.share : playedShare(week, status, status >= 2);
    return publishValue(base * shareRatio(was, now, hi));
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
    const returning = A.concat(B).filter(p => p.ret);
    if (returning.length === 1) {
      const p = returning[0];
      notes.push(p.name + "'s value counts the games after his week " + p.ret + " return. A replacement starter covers the weeks he misses.");
    } else if (returning.length > 1) {
      const bits = returning.map(p => p.name + ' (week ' + p.ret + ')');
      const list = bits.length === 2 ? bits[0] + ' and ' + bits[1] : bits.slice(0, -1).join(', ') + ', and ' + bits[bits.length - 1];
      notes.push('Return timing sets the value for ' + list + '. A replacement starter covers the weeks they miss.');
    }
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

  // 12-team role bands from current value, not from season rank.
  const ROLE_CUTS = { QB: [12, 24], RB: [12, 24, 36], WR: [12, 24, 36], TE: [12, 24] };

  function tierOf(pos, rank) {
    const cuts = ROLE_CUTS[pos];
    if (!cuts || !rank) return '';
    for (let i = 0; i < cuts.length; i++) if (rank <= cuts[i]) return pos + (i + 1);
    return '';
  }

  function roleArticle(label) {
    return /^rb/i.test(label) ? 'an' : 'a';
  }

  function rankPool(pool) {
    const rows = (pool || []).filter(p => p && p.id != null && p.pos && Number.isFinite(Number(p.value))).map(p => ({ ...p, value: num(p.value) }));
    const by = {};
    for (const p of rows) (by[p.pos] || (by[p.pos] = [])).push(p);
    for (const pos of Object.keys(by)) {
      by[pos].sort((a, b) => b.value - a.value || String(a.id).localeCompare(String(b.id)));
      by[pos].forEach((p, i) => {
        p.rank = i + 1;
        p.tier = tierOf(pos, p.rank);
        p.mid = pos === 'TE' && p.rank >= 5 && p.rank <= 8;
      });
    }
    return rows;
  }

  // Smallest value that, added to `behind`, gets the grade to A (within 8%).
  // The search uses analyze(), so the depth discount is included.
  function valueNeeded(sideA, sideB, behind) {
    let lo = 0, hi = 160, best = null;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      const ghost = { id: '__gap__', name: 'piece', pos: 'WR', value: mid };
      const next = behind === 'a' ? analyze(sideA.concat(ghost), sideB) : analyze(sideA, sideB.concat(ghost));
      const covers = !next.empty && next.pct <= 0.08;
      const over = !next.empty && (next.winner === behind || next.winner === 'even');
      if (covers) { best = mid; hi = mid; }
      else if (over) hi = mid;
      else lo = mid;
    }
    if (best == null) return null;
    const shown = Math.ceil(best * 10 - 1e-9) / 10;
    return shown;
  }

  function land(sideA, sideB) {
    const g = analyze(sideA, sideB);
    if (g.empty || g.pct > 0.12) return null;
    return g;
  }

  function fairer(sideA, sideB, pool) {
    const result = analyze(sideA, sideB);
    const out = { fair: false, grade: result.grade, behind: null, need: null, suggestions: [], note: '' };
    if (result.empty) return out;
    if (result.pct <= 0.08) return { ...out, fair: true, note: 'This looks fair' };
    const behind = result.winner === 'a' ? 'b' : 'a';
    const ahead = behind === 'a' ? 'b' : 'a';
    out.behind = behind;
    const ranked = rankPool(pool);
    const byId = new Map(ranked.map(p => [p.id, p]));
    const taken = new Set(result.a.players.concat(result.b.players).map(p => p.id));
    const free = ranked.filter(p => !taken.has(p.id) && p.value > 0 && p.tier);
    const sideRows = { a: result.a.players, b: result.b.players };
    const full = sideRows[behind].length >= 5;
    out.need = full ? null : valueNeeded(sideRows.a, sideRows.b, behind);

    const groups = new Map();
    for (const p of free) {
      if (!groups.has(p.tier)) groups.set(p.tier, []);
      groups.get(p.tier).push(p);
      if (p.mid) {
        if (!groups.has('mid TE1')) groups.set('mid TE1', []);
        groups.get('mid TE1').push(p);
      }
    }

    function pack(p, g) {
      return { id: p.id, name: p.name, pos: p.pos, value: p.value, inj: p.inj || '', grade: g.grade, gap: g.gap };
    }

    const ideas = [];
    if (!full) {
      for (const [label, players] of groups) {
        const examples = [];
        for (const p of players) {
          const nextA = behind === 'a' ? sideRows.a.concat(p) : sideRows.a;
          const nextB = behind === 'b' ? sideRows.b.concat(p) : sideRows.b;
          const g = land(nextA, nextB);
          if (g) examples.push(pack(p, g));
        }
        examples.sort((a, b) => (gradeRank(a.grade) - gradeRank(b.grade)) || (a.gap - b.gap));
        if (!examples.length) continue;
        ideas.push({
          kind: 'add', side: behind, outId: null,
          text: 'Add ' + roleArticle(label) + ' ' + label + ' to Side ' + behind.toUpperCase(),
          need: out.need, from: result.grade, to: examples[0].grade,
          examples: examples.slice(0, 3),
        });
      }
    }

    const leadRows = sideRows[ahead];
    for (const piece of leadRows) {
      const known = byId.get(piece.id);
      const fromTier = known && known.tier;
      if (!fromTier) continue;
      const lower = lowerTiers(piece.pos || known.pos, fromTier);
      for (const label of lower) {
        const players = groups.get(label) || [];
        const examples = [];
        for (const p of players) {
          const swapped = leadRows.filter(x => x.id !== piece.id).concat(p);
          const nextA = ahead === 'a' ? swapped : sideRows.a;
          const nextB = ahead === 'b' ? swapped : sideRows.b;
          const g = land(nextA, nextB);
          if (g) examples.push(pack(p, g));
        }
        examples.sort((a, b) => (gradeRank(a.grade) - gradeRank(b.grade)) || (a.gap - b.gap));
        if (!examples.length) continue;
        ideas.push({
          kind: 'swap', side: ahead, outId: piece.id,
          text: 'Swap Side ' + ahead.toUpperCase() + "'s " + fromTier + ' for a lower-tier ' + label,
          need: out.need, from: result.grade, to: examples[0].grade,
          examples: examples.slice(0, 3),
        });
      }
    }

    ideas.sort((a, b) => (a.kind === 'add' ? 0 : 1) - (b.kind === 'add' ? 0 : 1) || gradeRank(a.to) - gradeRank(b.to));
    const seen = new Set();
    for (const idea of ideas) {
      if (seen.has(idea.text)) continue;
      seen.add(idea.text);
      out.suggestions.push(idea);
      if (out.suggestions.length >= 4) break;
    }

    if (out.suggestions.length < 2) {
      const small = leadRows.slice().sort((a, b) => num(a.value) - num(b.value))[0];
      if (small && leadRows.length > 1) {
        const rest = leadRows.filter(p => p.id !== small.id);
        const g = land(ahead === 'a' ? rest : sideRows.a, ahead === 'b' ? rest : sideRows.b);
        if (g) {
          out.suggestions.push({
            kind: 'remove', side: ahead, outId: small.id,
            text: 'Remove the smaller piece from Side ' + ahead.toUpperCase(),
            need: out.need, from: result.grade, to: g.grade,
            examples: [{ id: small.id, name: small.name, pos: small.pos, value: small.value, inj: small.inj || '', grade: g.grade, gap: g.gap }],
          });
        }
      }
    }

    if (!out.suggestions.length && full) out.note = 'Side ' + behind.toUpperCase() + ' already has 5 players, so there is no room to add.';
    else if (!out.suggestions.length) out.note = 'No top-' + TOP_N + ' piece gets this to an A or a B in one move.';
    return out;
  }

  function gradeRank(g) {
    return { 'A+': 0, A: 1, B: 2, C: 3, D: 4, F: 5 }[g] ?? 9;
  }

  function lowerTiers(pos, tier) {
    const order = (ROLE_CUTS[pos] || []).map((_, i) => pos + (i + 1));
    const i = order.indexOf(tier);
    return i < 0 ? [] : order.slice(i + 1);
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
    if (inj.practice && !inj.long) {
      const bits = [inj.practice];
      if (inj.body) bits.push(inj.body);
      if (inj.ret) bits.push('back week ' + inj.ret);
      return bits.join(' · ');
    }
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
    const inj = pl.tv.inj;
    return {
      id: pl.id, name: pl.name, pos: pl.pos, team: pl.team, value: liveValue(pl),
      miss: miss === Infinity ? 'season' : miss,
      ret: inj && inj.ret ? inj.ret : null,
      long: !!(inj && inj.long),
      pl,
    };
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
        const injured = !!(row.pl.tv && row.pl.tv.inj);
        const adpNum = tradeState.qb === 'sflex' && row.pl.adp_sf > 0 ? row.pl.adp_sf : row.pl.adp;
        const adp = adpNum > 0 ? ` · <span class="trade-adp" title="Season-to-date average draft position. Most of it comes from preseason drafts, so it is not a live trade price.">ADP ${Number(adpNum).toFixed(1)}</span>` : '';
        let facts = '';
        if (injured) {
          const pre = preValue(row.pl);
          const healthy = pre != null ? `<div class="trade-meta"><span class="trade-k">Healthy value</span> <b class="trade-pre">${valueText(pre)}</b></div>` : '';
          const inj = row.pl.tv.inj;
          let missed = 'Expected games missed: rest of season';
          if (!inj.long && !row.long) {
            const n = Math.round((Number(inj.miss) || 0) * 100) / 100;
            const games = n === 1 ? '1 game' : n + ' games';
            missed = 'Expected games missed: ' + games + (inj.ret ? ' · return week ' + inj.ret : '');
          }
          facts = healthy + `<div class="trade-meta">${esc(missed)}</div>`;
        }
        const valueLabel = injured ? 'Injury-adjusted value' : 'value';
        return `<li class="trade-card"><div><div class="trade-name">${esc(row.name)} <span class="pos ${esc(row.pos)}">${esc(row.pos)}</span> <span class="meta">${esc(row.team)}</span></div>${tag ? `<div class="trade-inj">${esc(tag)}</div>` : ''}<div class="trade-meta"><b class="trade-val">${valueText(row.value)}</b> ${valueLabel}${adp} · ${range}</div>${facts}</div><button type="button" class="trade-x" data-side="${side}" data-id="${esc(row.id)}" aria-label="Remove ${esc(row.name)} from side ${side.toUpperCase()}">×</button></li>`;
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
    const ideas = result.empty ? null : fairer(rows.a, rows.b, fairPool());
    box.innerHTML = `<div class="trade-totals"><span>Side A <b>${result.a.total.toFixed(1)}</b></span><span>Side B <b>${result.b.total.toFixed(1)}</b></span></div><div class="trade-bar" role="img" aria-label="Side A ${bar.toFixed(0)} percent, side B ${(100 - bar).toFixed(0)} percent"><span class="ta" style="width:${bar}%"></span><span class="tb" style="width:${100 - bar}%"></span></div><div class="trade-verdict">${grade}<p>${esc(result.verdict)}</p></div>${result.notes.length ? `<ul class="trade-notes">${result.notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}${fairerHtml(ideas, esc)}`;
    box.querySelectorAll('.trade-pick').forEach(btn => btn.addEventListener('click', () => {
      const side = btn.dataset.side;
      if (btn.dataset.kind === 'remove') {
        tradeState[side] = tradeState[side].filter(id => id !== btn.dataset.id);
        renderTrade();
        return;
      }
      if (btn.dataset.kind === 'swap' && btn.dataset.out) tradeState[side] = tradeState[side].filter(id => id !== btn.dataset.out);
      addPlayer(side, btn.dataset.id);
    }));
  }
  function fairPool() {
    const data = ml() && ml().state && ml().state.data;
    if (!data) return [];
    return data.players.filter(p => p.tv && p.tv.top).map(p => {
      const row = cardRow(p.id);
      return row && { id: row.id, name: row.name, pos: row.pos, value: row.value, inj: injLabel(p) };
    }).filter(Boolean);
  }
  function fairerHtml(ideas, esc) {
    if (!ideas) return '';
    const head = '<section class="trade-fair" aria-label="Make it fairer"><h3>Make it fairer</h3>';
    if (ideas.fair) return head + '<p class="trade-fair-note">This looks fair</p></section>';
    const items = ideas.suggestions.map(s => {
      const need = s.kind === 'add' && s.need != null ? `About ${Number(s.need).toFixed(1)} value to close the gap. ` : '';
      const move = s.to ? `Grade would move from ${s.from} to ${s.to}.` : '';
      const picks = s.examples.map(ex => {
        const inj = ex.inj ? ` · <span class="trade-inj">${esc(ex.inj)}</span>` : '';
        const verb = s.kind === 'remove' ? 'Remove' : (s.kind === 'swap' ? 'Swap in' : 'Add');
        return `<button type="button" class="trade-pick" data-kind="${esc(s.kind)}" data-side="${esc(s.side)}" data-id="${esc(ex.id)}" data-out="${esc(s.outId || '')}" aria-label="${esc(verb + ' ' + ex.name + ' on side ' + s.side.toUpperCase())}"><span class="trade-pick-name">${esc(ex.name)}</span><span class="trade-pick-meta">${valueText(ex.value)} · ${esc(ex.grade)}${inj}</span></button>`;
      }).join('');
      return `<li><p class="trade-fair-title">${esc(s.text)}</p><p class="trade-fair-sub">${esc(need + move)}</p><div class="trade-picks">${picks}</div></li>`;
    }).join('');
    const note = ideas.note ? `<p class="trade-fair-note">${esc(ideas.note)}</p>` : '';
    return head + note + (items ? `<ul class="trade-ideas">${items}</ul>` : '') + '</section>';
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
        const was = pre != null && pre - now >= 0.5 ? ` · ${valueText(pre)} if healthy` : '';
        return `<li role="option" data-id="${esc(p.id)}" aria-selected="${i === active}"><span class="pos ${esc(p.pos)}">${esc(p.pos)}</span> ${esc(p.name)} <span class="meta">${esc(p.team)} · ${valueText(now)}${was}${tag ? ' · ' + esc(tag) : ''}</span></li>`;
      }).join('') : `<li class="empty">${tradeState.all ? 'No players match.' : 'No top-' + TOP_N + ', depth-chart, or recent-producer match. Search all players for a lower fallback value.'}</li>`;
      list.hidden = false;
      input.setAttribute('aria-expanded', 'true');
      list.querySelectorAll('li[data-id]').forEach(li => li.addEventListener('mousedown', e => { e.preventDefault(); addPlayer(side, li.dataset.id); input.value = ''; close(); }));
    };
    input.addEventListener('input', () => {
      const q = norm(input.value.trim());
      if (q.length < 2) { close(); return; }
      const toks = q.split(/\s+/);
      const pool = ml().state.data.players.filter(p => p.tv && (tradeState.all || p.tv.top || p.tv.starter || p.tv.keep));
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
  // An older published file already has a value for every player. Widen the
  // searchable set and separate tied tail values without rebuilding projections.
  function upgradeTrade(data) {
    const meta = data && data.meta && data.meta.trade;
    if (!meta || !(data.players || []).some(p => p.tv && p.tv.v)) return data;
    if (meta.v >= 6 && meta.top >= TOP_N) return data;
    untieTail(data.players);
    const rankScore = pl => Math.max(pl.tv.v.ppr.qb1[0], pl.tv.v.ppr.qb1[1]);
    const ranked = data.players.filter(pl => pl.tv && pl.tv.v).sort((a, b) => (rankScore(b) - rankScore(a)) || ((b.tv.ros[0] || 0) - (a.tv.ros[0] || 0)));
    ranked.forEach((pl, i) => { pl.tv.top = i < TOP_N; });
    meta.v = 6;
    meta.top = TOP_N;
    return data;
  }

  function ensure(data) {
    if (!data) return data;
    if (data.meta && data.meta.trade && (data.players || []).some(p => p.tv)) return upgradeTrade(data);
    const project = (typeof window !== 'undefined' && window.MLModel && window.MLModel.project) || null;
    if (!project) return data;
    attachTrade(data, { project, scoring: window.MLModel.SCORING, ages: {} });
    return data;
  }
  function snapshot() {
    return { a: tradeState.a.slice(), b: tradeState.b.slice() };
  }
  function restore(saved) {
    if (!saved) return;
    const ids = list => (Array.isArray(list) ? list.filter(id => typeof id === 'string' && id).slice(0, 5) : null);
    const a = ids(saved.a), b = ids(saved.b);
    if (a) tradeState.a = a;
    if (b) tradeState.b = b;
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
    SCORINGS, QB_MODES, SLOTS, DYNASTY_ROS, DYNASTY_NEXT, CONSOLIDATION, CONSOLIDATION_CAP, TOP_N, ADP_FIT_N, CURVE_T, AGE_CURVE, PREF,
    curve, scaled,
    missFromText, statusMiss, newsMiss, combineMiss, availability, ageFactor, roleFactor, teamFactor, pointsOf,
    gamesBasis, gameEq, weekWeight, playedShare, dynastyShare, PLAYOFF_WEIGHT, RETURN_RAMP, DYNASTY_SHORT,
    parseNews, injuryPlan, isLead, applyPractice, sumOutlook, IR_MIN, LONG_DYNASTY,
    ageFromBirth, spearman, adjustSide, gradeGap, analyze, fairer, tierOf, valueOf, attachTrade, backtest, round1,
    fitAdpCurve, blendValue, blendAdp, ADP_WEIGHT, talentRate, marketCurves, TALENT_K, MARKET_W,
    ensure, init, render: renderTrade, snapshot, restore,
  };
});
