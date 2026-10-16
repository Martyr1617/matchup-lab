const test = require('node:test');
const assert = require('node:assert/strict');
const { buildSnapshot, kickoffUTC } = require('../scripts/snapshot_projections');

test('Thursday night kickoff is 8:15pm Eastern as UTC', () => {
  const iso = kickoffUTC({ date: '2026-10-15', time: '20:15' });
  assert.equal(iso, '2026-10-16T00:15:00Z');
  // Sunday 1:00pm Eastern in October is still EDT.
  assert.equal(kickoffUTC({ date: '2026-10-18', time: '13:00' }), '2026-10-18T17:00:00Z');
  // A January kickoff is EST (UTC-5).
  assert.equal(kickoffUTC({ date: '2027-01-10', time: '13:00' }), '2027-01-10T18:00:00Z');
});

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

test('snapshot stores projection, floor, ceiling, trade value, and the game line', () => {
  const data = {
    meta: { season: 2026, next_week: 6, generated: '2026-10-15 16:35 UTC' },
    league: { ypc: 4.3, ypa: 7.1, comp_pct: 0.65, ypt: 7.5, rush_td_rate: 0.03, pass_td_rate: 0.045, int_rate: 0.02, rec_td_rate: 0.05 },
    defense: { DEN: defense(20), SEA: defense(22) },
    schedule: {
      6: [{ home: 'DEN', away: 'SEA', id: '2026_06_SEA_DEN', date: '2026-10-15', time: '20:15', spread_line: -2.5, total_line: 40.5 }],
    },
    team_off: { SEA: { pts_pg: 24 }, DEN: { pts_pg: 22 } },
    players: [{
      id: 'qb1', name: 'Sam Darnold', pos: 'QB', team: 'SEA', g: 5, cv: 0.35,
      ids: { espn: '3912547' },
      w: { pa: 34, py: 250, ptd: 1.8, int: 0.6, ca: 6, ry: 32, rtd: 0.4, tg: 0, rc: 0, rcy: 0, rctd: 0 },
      t: { pa: 170, py: 1250, ptd: 9, int: 3, ca: 30, ry: 160, rtd: 2, tg: 0, rc: 0, rcy: 0, rctd: 0, fl: 1, two: 0 },
      tv: { v: { ppr: { qb1: [32.7, 40.1], sflex: [55, 60] } } },
      adv: {},
    }, {
      id: 'bye', name: 'Bye Player', pos: 'RB', team: 'KC', g: 5, cv: 0.4,
      w: { pa: 0, py: 0, ptd: 0, int: 0, ca: 10, ry: 40, rtd: 0.3, tg: 2, rc: 1, rcy: 8, rctd: 0 },
      t: { pa: 0, py: 0, ptd: 0, int: 0, ca: 50, ry: 200, rtd: 1, tg: 10, rc: 6, rcy: 40, rctd: 0, fl: 0, two: 0 },
      adv: {},
    }],
  };
  const market = { week: 6, as_of: '2026-10-15T16:35:20Z', games: { 'SEA@DEN': { spread_home: 2.5, total: 40.5 } }, props: {} };
  const snap = buildSnapshot(data, market);
  assert.equal(snap.stamp, '2026-10-15T16-35Z');
  assert.equal(snap.week, 6);
  assert.equal(snap.players.length, 1);
  const qb = snap.players[0];
  assert.equal(qb.name, 'Sam Darnold');
  assert.equal(qb.game, '2026_06_SEA_DEN');
  assert.equal(qb.espn, '3912547');
  assert.equal(typeof qb.proj, 'number');
  assert.ok(qb.floor <= qb.proj && qb.proj <= qb.ceil);
  assert.deepEqual(qb.tv.qb1, [32.7, 40.1]);
  assert.deepEqual(qb.tv.sflex, [55, 60]);
  assert.equal(snap.games[0].kickoff, '2026-10-16T00:15:00Z');
  assert.equal(snap.games[0].total, 40.5);
  assert.equal(snap.games[0].spread_home, 2.5);
});
