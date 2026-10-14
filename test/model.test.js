const test = require('node:test');
const assert = require('node:assert/strict');
const { lgamma, makeDist, project, normName, propMean } = require('../site/model');

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

test('gamma helpers match known values and quantiles', () => {
  assert.ok(Math.abs(lgamma(1)) < 1e-10);
  assert.ok(Math.abs(lgamma(5) - Math.log(24)) < 1e-8);
  const dist = makeDist(15, 0.4);
  assert.ok(Math.abs(dist.cdf(dist.quantile(0.1)) - 0.1) < 0.02);
  assert.ok(Math.abs(dist.cdf(dist.quantile(0.5)) - 0.5) < 0.02);
  assert.ok(Math.abs(dist.cdf(dist.quantile(0.9)) - 0.9) < 0.02);
  assert.ok(dist.quantile(0.1) < dist.quantile(0.5));
  assert.ok(dist.quantile(0.5) < dist.mean); // gamma is right-skewed
  assert.ok(dist.quantile(0.9) > dist.mean);
  assert.ok(dist.pOver(dist.mean) > 0 && dist.pOver(dist.mean) < 0.6);
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

test('propMean stays available to the player page', () => {
  assert.equal(propMean({ line: 100, p_over: 0.5 }, true), 105);
  assert.equal(propMean({ line: 20 }, false), 20);
});
