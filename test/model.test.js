const test = require('node:test');
const assert = require('node:assert/strict');
const { lgamma, makeDist, project, normName, propMean, PREDICTIVE_SPREAD, SNAP_BLEND } = require('../site/model');

function factors() {
  return { rush_att: 1, ypc: 1, rush_td: 1, pass_att: 1, comp_pct: 1, ypa: 1, pass_td: 1, int: 1 };
}
function defense(pts) {
  return {
    factors: factors(),
    pos_factors: { QB: 1, RB: 1, WR: 1, TE: 1 },
    pos_yds_factors: { RB: 1, WR: 1, TE: 1 },
    ranks: { fp_QB: 16, fp_RB: 16, fp_WR: 16, fp_TE: 16 },
    allowed: { pts_pg: pts },
  };
}
function env(extra) {
  return {
    data: {
      league: { ypc: 4.3, ypa: 7.1, comp_pct: 0.65, ypt: 7.5, rush_td_rate: 0.03, pass_td_rate: 0.045, int_rate: 0.02, rec_td_rate: 0.05 },
      defense: { NYJ: defense(20), BUF: defense(24) },
      schedule: {
        6: [{ home: 'BUF', away: 'NYJ', id: 'g6', spread_line: 6.5, total_line: 47, home_score: null, away_score: null }],
      },
      team_off: { BUF: { pts_pg: 28 }, NYJ: { pts_pg: 18 } },
    },
    market: null,
    wx: {},
    ...extra,
  };
}
const qb = {
  id: 'qb1', name: 'Josh Allen', pos: 'QB', team: 'BUF', g: 5, cv: 0.35,
  ids: { espn: '3918298' },
  w: { pa: 34, py: 250, ptd: 1.8, int: 0.6, ca: 6, ry: 32, rtd: 0.4, tg: 0, rc: 0, rcy: 0, rctd: 0 },
  t: { pa: 170, py: 1250, ptd: 9, int: 3, ca: 30, ry: 160, rtd: 2, tg: 0, rc: 0, rcy: 0, rctd: 0, fl: 1, two: 0 },
  adv: {},
};

test('normal outcome quantiles match a widened CV', () => {
  assert.ok(Math.abs(lgamma(1)) < 1e-10);
  assert.ok(Math.abs(lgamma(5) - Math.log(24)) < 1e-8);
  assert.equal(PREDICTIVE_SPREAD, 1.25);
  const dist = makeDist(15, 0.4);
  const sd = 15 * 0.4 * PREDICTIVE_SPREAD;
  assert.ok(Math.abs(dist.sd - sd) < 1e-9);
  assert.ok(Math.abs(dist.quantile(0.5) - 15) < 1e-6);
  assert.ok(Math.abs(dist.quantile(0.1) - (15 + sd * -1.28155156554)) < 1e-4);
  assert.ok(Math.abs(dist.quantile(0.9) - (15 + sd * 1.28155156554)) < 1e-4);
  assert.ok(Math.abs(dist.cdf(dist.quantile(0.1)) - 0.1) < 1e-6);
  assert.ok(Math.abs(dist.pOver(15) - 0.5) < 1e-6);
  assert.ok(dist.pdf(15) > dist.pdf(15 + sd));
});

test('project scores a starter and sends a bye team to zero', () => {
  const pr = project(qb, 6, 'ppr', env());
  assert.equal(pr.bye, false);
  assert.equal(pr.home, true);
  assert.equal(pr.opp, 'NYJ');
  assert.ok(pr.pts > 8 && pr.pts < 40, pr.pts);
  assert.ok(pr.floor < pr.pts && pr.pts < pr.ceil);
  assert.ok(pr.bb.boom >= 0 && pr.bb.boom <= 1);
  assert.ok(pr.bb.bust >= 0 && pr.bb.bust <= 1);
  const off = project({ ...qb, team: 'KC' }, 6, 'ppr', env());
  assert.equal(off.bye, true);
  assert.equal(off.pts, 0);
});

test('a higher total raises the projection and wind lowers it', () => {
  const base = project(qb, 6, 'ppr', env());
  const shootout = env();
  shootout.data.schedule[6][0] = { ...shootout.data.schedule[6][0], total_line: 58 };
  const high = project(qb, 6, 'ppr', shootout);
  assert.ok(high.pts > base.pts, `${high.pts} vs ${base.pts}`);
  const windy = env();
  windy.wx = { g6: { status: 'ok', wind: 25, gust: 30, precip: 0, snow: 0, pop: 0, temp: 60 } };
  const wet = project(qb, 6, 'ppr', windy);
  assert.ok(wet.pts < base.pts);
  assert.ok(wet.wx.pass < 1);
});

test('home favorite from a positive nflverse spread is the home team', () => {
  const home = project(qb, 6, 'ppr', env());
  const away = project({ ...qb, id: 'qb2', name: 'Aaron Rodgers', team: 'NYJ' }, 6, 'ppr', env());
  // spread_line > 0 means the home team is favored; the app negates it for home perspective.
  assert.ok(home.vg.teamSpread < 0);
  assert.ok(away.vg.teamSpread > 0);
  assert.ok(home.vg.itt > away.vg.itt);
});

test('props are keyed by ESPN id so same-name players do not collide', () => {
  const e = env();
  e.market = {
    week: 6,
    props: {
      '3918298': { name: 'Josh Allen', espn: '3918298', game: 'NYJ@BUF', pass_yds: { line: 275 } },
      '999': { name: 'Josh Allen', espn: '999', game: 'NYJ@BUF', pass_yds: { line: 40 } },
    },
  };
  const pr = project(qb, 6, 'ppr', e);
  assert.equal(pr.pm.pass_yds.line, 275);
  const other = project({ ...qb, ids: { espn: '999' } }, 6, 'ppr', e);
  assert.equal(other.pm.pass_yds.line, 40);
  // An older file keyed only by name still works for a player with no ESPN id.
  const legacy = env();
  legacy.market = { week: 6, props: { joshallen: { name: 'Josh Allen', game: 'NYJ@BUF', pass_yds: { line: 260 } } } };
  const unnamed = project({ ...qb, ids: {} }, 6, 'ppr', legacy);
  assert.equal(unnamed.pm.pass_yds.line, 260);
  assert.equal(normName('Josh Allen Jr.'), 'joshallen');
});

function seaWeek(roles, players) {
  const e = env();
  e.data.schedule[3] = [{ home: 'WAS', away: 'SEA', id: 'g3', spread_line: 3, total_line: 45, home_score: null, away_score: null }];
  e.data.defense.WAS = defense(22);
  e.data.team_off.SEA = { pts_pg: 24 };
  e.data.team_off.WAS = { pts_pg: 20 };
  e.data.roles = roles ? { 3: roles } : null;
  e.data.players = players;
  return e;
}
const darnold = {
  id: '00-0034869', name: 'Sam Darnold', pos: 'QB', team: 'SEA', g: 1, cv: 0.4,
  w: { pa: 2, py: 14, ptd: 0, int: 0, ca: 1, ry: 4, rtd: 0, tg: 0, rc: 0, rcy: 0, rctd: 0 },
  t: { pa: 2, py: 14, ptd: 0, int: 0, ca: 1, ry: 4, rtd: 0, tg: 0, rc: 0, rcy: 0, rctd: 0, fl: 0, two: 0 },
  log: [{ wk: 1, pa: 2, py: 14, ptd: 0 }],
};
const lock = {
  id: '00-0035704', name: 'Drew Lock', pos: 'QB', team: 'SEA', g: 2, cv: 0.4,
  w: { pa: 24, py: 170, ptd: 1, int: 0.5, ca: 2, ry: 8, rtd: 0, tg: 0, rc: 0, rcy: 0, rctd: 0 },
  t: { pa: 48, py: 340, ptd: 2, int: 1, ca: 4, ry: 16, rtd: 0, tg: 0, rc: 0, rcy: 0, rctd: 0, fl: 0, two: 0 },
  log: [{ wk: 1, pa: 22 }, { wk: 2, pa: 26 }],
};
const charted = { out: [], chart: { SEA: { QB: [darnold.id, lock.id] } } };

test('a charted starter with backup volume inherits the teammate who was playing', () => {
  const bare = project(darnold, 3, 'ppr', seaWeek(null, [darnold, lock]));
  const handed = project(darnold, 3, 'ppr', seaWeek(charted, [darnold, lock]));
  assert.ok(bare.comps.pa < 8, bare.comps.pa);
  assert.ok(bare.pts < 4, bare.pts);
  assert.ok(handed.comps.pa > 15, handed.comps.pa);
  assert.ok(handed.pts > bare.pts * 3, `${handed.pts} vs ${bare.pts}`);
  assert.equal(darnold.w.pa, 2);
  // A starter who already has a full attempt line does not take anyone else's.
  const dart = { ...darnold, id: 'dart', w: { ...darnold.w, pa: 29 }, t: { ...darnold.t, pa: 29 } };
  const busy = project(dart, 3, 'ppr', seaWeek({ out: [], chart: { SEA: { QB: ['dart', lock.id] } } }, [dart, lock]));
  assert.ok(Math.abs(busy.comps.pa - bare.comps.pa * (29 / 2)) < 1.5, busy.comps.pa);
});

test('an unavailable charted starter keeps his own volume and a healthy QB1 caps the backup', () => {
  const out = project(darnold, 3, 'ppr', seaWeek({ out: [darnold.id], chart: charted.chart }, [darnold, lock]));
  assert.ok(out.comps.pa < 8, out.comps.pa);
  const capped = project(lock, 3, 'ppr', seaWeek(charted, [darnold, lock]));
  const free = project(lock, 3, 'ppr', seaWeek(null, [darnold, lock]));
  assert.ok(free.comps.pa > 15, free.comps.pa);
  assert.ok(capped.comps.pa < 6, capped.comps.pa);
  assert.equal(lock.w.pa, 24);
  // A charted starter who already throws a starter's volume does not cap teammates.
  const busy = { ...darnold, w: { ...darnold.w, pa: 30 }, t: { ...darnold.t, pa: 30 }, log: [{ wk: 1, pa: 30 }] };
  const kept = project(lock, 3, 'ppr', seaWeek({ out: [], chart: charted.chart }, [busy, lock]));
  assert.ok(kept.comps.pa > 15, kept.comps.pa);
});

test('the next charted receiver inherits an unavailable teammate only when his own usage is thin', () => {
  const wr1 = {
    id: 'wr1', name: 'WR1', pos: 'WR', team: 'SEA', g: 1, cv: 0.5,
    w: { pa: 0, py: 0, ptd: 0, int: 0, ca: 0, ry: 0, rtd: 0, tg: 8, rc: 5, rcy: 70, rctd: 0.3 },
    t: { pa: 0, py: 0, ptd: 0, int: 0, ca: 0, ry: 0, rtd: 0, tg: 8, rc: 5, rcy: 70, rctd: 0, fl: 0, two: 0 },
    log: [{ wk: 1, tg: 8 }],
  };
  const wr2 = {
    id: 'wr2', name: 'WR2', pos: 'WR', team: 'SEA', g: 1, cv: 0.5,
    w: { pa: 0, py: 0, ptd: 0, int: 0, ca: 0, ry: 0, rtd: 0, tg: 1, rc: 0, rcy: 0, rctd: 0 },
    t: { pa: 0, py: 0, ptd: 0, int: 0, ca: 0, ry: 0, rtd: 0, tg: 1, rc: 0, rcy: 0, rctd: 0, fl: 0, two: 0 },
    log: [{ wk: 1, tg: 1 }],
  };
  const deep = {
    id: 'wr4', name: 'WR4', pos: 'WR', team: 'SEA', g: 1, cv: 0.5,
    w: { ...wr2.w }, t: { ...wr2.t }, log: [{ wk: 1, tg: 1 }],
  };
  const roles = { out: ['wr1'], chart: { SEA: { WR: ['wr1', 'wr2', 'wr3', 'wr4'] } } };
  const e = seaWeek(roles, [wr1, wr2, deep]);
  const next = project(wr2, 3, 'ppr', e);
  const buried = project(deep, 3, 'ppr', e);
  assert.ok(next.comps.tg > 5, next.comps.tg);
  assert.ok(buried.comps.tg < 3, buried.comps.tg);
});

test('receiving yardage uses the position rate instead of the all-positions rate', () => {
  const wr = {
    id: 'wr1', name: 'Wideout', pos: 'WR', team: 'BUF', g: 1, cv: 0.5,
    w: { pa: 0, py: 0, ptd: 0, int: 0, ca: 0, ry: 0, rtd: 0, tg: 6, rc: 4, rcy: 50, rctd: 0.2 },
    t: { pa: 0, py: 0, ptd: 0, int: 0, ca: 0, ry: 0, rtd: 0, tg: 6, rc: 4, rcy: 50, rctd: 0, fl: 0, two: 0 },
  };
  const low = project(wr, 6, 'ppr', env());
  const e = env();
  e.data.league_pos = { WR: { rec_yds_pg: 150, tgt_pg: 18, rec_td_pg: 0.9 } };
  const high = project(wr, 6, 'ppr', e);
  assert.ok(high.comps.rcy > low.comps.rcy, `${high.comps.rcy} vs ${low.comps.rcy}`);
});

test('a missing snap share leaves the projection unchanged', () => {
  assert.equal(SNAP_BLEND, 0.35);
  assert.equal(PREDICTIVE_SPREAD, 1.25);
  const base = project(qb, 6, 'ppr', env());
  const off = project(qb, 6, 'ppr', env({ tune: { snapBlend: 0 } }));
  assert.equal(base.pts, off.pts);
  assert.equal(base.comps.pa, off.comps.pa);
});

test('recent snap share moves thin usage toward the snap-implied rate', () => {
  const thin = { ...qb, w: { ...qb.w, pa: 8 }, snapImplied: { pa: 32, ca: 2, tg: 0 } };
  const raised = project(thin, 6, 'ppr', env());
  const plain = project({ ...thin, snapImplied: null }, 6, 'ppr', env());
  assert.ok(raised.comps.pa > plain.comps.pa + 4, `${raised.comps.pa} vs ${plain.comps.pa}`);
  const frozen = project(thin, 6, 'ppr', env({ tune: { snapBlend: 0 } }));
  assert.ok(Math.abs(frozen.comps.pa - plain.comps.pa) < 0.05, frozen.comps.pa);
});

test('snap share mixes after a charted starter inherits volume', () => {
  const plain = project(darnold, 3, 'ppr', seaWeek(charted, [darnold, lock]));
  const low = project({ ...darnold, snapImplied: { pa: 2, ca: 0, tg: 0 } }, 3, 'ppr', seaWeek(charted, [darnold, lock]));
  assert.ok(low.comps.pa < plain.comps.pa, `${low.comps.pa} vs ${plain.comps.pa}`);
  assert.ok(low.comps.pa > 8, low.comps.pa);
});

test('missing defenders do not change the opponent factor unless the adjustment is on', () => {
  const e = env();
  e.data.def_avail = { 6: { NYJ: { pass_out: 0.25, pass_out_base: 0, run_out: 0, run_out_base: 0, names: ['Sauce Gardner'] } } };
  const off = project(qb, 6, 'ppr', e);
  const plain = project(qb, 6, 'ppr', env());
  assert.equal(off.pts, plain.pts);
  assert.equal(off.defNote, null);
  const on = project(qb, 6, 'ppr', { ...e, tune: { defInj: 0.5, defInjCap: 0.08, defQ: 0 } });
  assert.ok(on.pts > off.pts + 0.2, `${on.pts} vs ${off.pts}`);
  assert.equal(on.defNote, 'Sauce Gardner');
  const rb = {
    ...qb, id: 'rb1', name: 'James Cook', pos: 'RB',
    w: { ...qb.w, pa: 0, py: 0, ptd: 0, ca: 14, ry: 60, rtd: 0.3 },
    t: { ...qb.t, pa: 0, py: 0, ptd: 0, ca: 70, ry: 300, rtd: 2 },
  };
  const rbOff = project(rb, 6, 'ppr', e);
  const rbOn = project(rb, 6, 'ppr', { ...e, tune: { defInj: 0.5, defInjCap: 0.08, defQ: 0 } });
  assert.ok(Math.abs(rbOn.pts - rbOff.pts) < 0.05, `${rbOn.pts} vs ${rbOff.pts}`);
});

test('propMean stays available to the player page', () => {
  assert.equal(propMean({ line: 100, p_over: 0.5 }, true), 105);
  assert.equal(propMean({ line: 20 }, false), 20);
});
