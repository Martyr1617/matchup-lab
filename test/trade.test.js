const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const trade = require('../site/trade');

const site = path.join(__dirname, '..', 'site');
const data = JSON.parse(fs.readFileSync(path.join(site, 'data.json'), 'utf8'));

function row(id, name, value, extra) {
  return { id, name, value, ...extra };
}

test('injury text maps to games missed and a vague blurb does not', () => {
  assert.equal(trade.missFromText('placed on IR'), Infinity);
  assert.equal(trade.missFromText('PUP list'), Infinity);
  assert.equal(trade.missFromText('suspended'), Infinity);
  assert.equal(trade.missFromText('ruled out'), 1);
  assert.equal(trade.missFromText('Doubtful'), 0.75);
  assert.equal(trade.missFromText('Questionable'), 0.25);
  assert.equal(trade.missFromText('limited in practice'), 0.25);
  assert.equal(trade.missFromText('under the weather'), 0);
  assert.equal(trade.newsMiss([{ injury: true, headline: 'dealing with a sore knee' }]), 0);
  assert.equal(trade.newsMiss([{ injury: true, headline: 'ruled out for Sunday' }]), 1);
  assert.equal(trade.combineMiss(0.25, 1), 1);
  assert.equal(trade.availability(12, 1), 11 / 12);
  assert.equal(trade.availability(12, Infinity), 0);
  assert.equal(trade.availability(12, 0.25), (12 - 0.25) / 12);
});

test('status miss keeps a quarter game and IR is the season', () => {
  assert.equal(trade.statusMiss({ sl_inj: { status: 'Questionable' } }), 0.25);
  assert.equal(trade.statusMiss({ inj: { practice: 'Limited Participation in Practice' } }), 0.25);
  assert.equal(trade.statusMiss({ sl_inj: { status: 'IR' } }), Infinity);
  const stored = trade.round1(0.25);
  assert.notEqual(stored, 0.25);
  const q = data.players.find(p => p.tv && p.tv.miss === 0.25);
  assert.ok(q, 'a questionable player keeps miss 0.25');
});

test('age curve favors a young running back over a 30-year-old', () => {
  assert.ok(trade.ageFactor('RB', 24) > trade.ageFactor('RB', 30));
  assert.equal(trade.ageFactor('QB', 30), 1.08);
  assert.equal(trade.ageFactor('QB', 38), 0.4);
});

test('a 2-for-1 discounts the deeper side by 4 percent and caps at 12', () => {
  const two = trade.adjustSide(100, 2, 1);
  assert.equal(two.cut, 0.04);
  assert.equal(two.total, 96);
  const pile = trade.adjustSide(100, 6, 1);
  assert.equal(pile.cut, 0.12);
  assert.equal(pile.total, 88);
  const even = trade.adjustSide(50, 2, 2);
  assert.equal(even.cut, 0);
  assert.equal(even.total, 50);
});

test('grading thresholds and edge cases', () => {
  assert.deepEqual(trade.gradeGap(0), ['A+', 'fair']);
  assert.deepEqual(trade.gradeGap(0.04), ['A+', 'fair']);
  assert.deepEqual(trade.gradeGap(0.08), ['A', 'fair']);
  assert.deepEqual(trade.gradeGap(0.12), ['B', 'edge']);
  assert.deepEqual(trade.gradeGap(0.18), ['C', 'clear']);
  assert.deepEqual(trade.gradeGap(0.26), ['D', 'lopsided']);
  assert.deepEqual(trade.gradeGap(0.30), ['F', 'lopsided']);

  const dup = trade.analyze(
    [row('a', 'Ada', 40), row('a', 'Ada', 40)],
    [row('b', 'Bea', 40)],
  );
  assert.equal(dup.a.players.length, 1);
  assert.match(dup.notes.join(' '), /counted once/);

  const both = trade.analyze(
    [row('a', 'Ada', 80), row('s', 'Sam', 20)],
    [row('s', 'Sam', 20), row('b', 'Bea', 70)],
  );
  assert.equal(both.a.total, 80);
  assert.equal(both.b.total, 70);
  assert.match(both.notes.join(' '), /both sides/);

  const empty = trade.analyze([row('a', 'Ada', 90)], []);
  assert.equal(empty.empty, true);
  assert.equal(empty.grade, null);
  assert.equal(empty.verdict, 'Add at least one player to each side.');

  const depth = trade.analyze(
    [row('a', 'Ace', 50), row('c', 'Cam', 50)],
    [row('b', 'Bea', 100)],
  );
  assert.equal(depth.a.cut, 0.04);
  assert.equal(depth.a.total, 96);
  assert.equal(depth.b.cut, 0);
});

test('published values sit on a 0–100 scale with scarcity and injury', () => {
  const skill = data.players.filter(p => /^(QB|RB|WR|TE)$/.test(p.pos));
  assert.ok(skill.every(p => p.tv && p.tv.v && p.tv.v.ppr && p.tv.v.ppr.qb1 && p.tv.v.ppr.sflex));
  const top = skill.filter(p => p.tv.top);
  assert.equal(top.length, 150);
  assert.equal(data.meta.trade.top, 150);
  for (const p of skill) {
    for (const scoring of ['ppr', 'half', 'std']) {
      for (const mode of ['qb1', 'sflex']) {
        for (const v of p.tv.v[scoring][mode]) {
          assert.ok(v >= 0 && v <= 100, p.name + ' ' + v);
        }
      }
    }
  }
  const best = Math.max(...skill.map(p => p.tv.v.ppr.qb1[0]));
  assert.equal(best, 100);
  const below = skill.filter(p => p.tv.par.ppr.qb1[0] <= 0);
  assert.ok(below.length > 0);
  assert.ok(below.every(p => p.tv.v.ppr.qb1[0] <= 8));

  const ir = skill.find(p => p.tv.season && p.tv.base && p.tv.base[0] >= 12);
  assert.ok(ir, 'a season-ending star keeps a baseline');
  assert.ok(ir.tv.v.ppr.qb1[0] < 8, ir.name + ' redraft ' + ir.tv.v.ppr.qb1[0]);
  assert.ok(ir.tv.v.ppr.qb1[1] > ir.tv.v.ppr.qb1[0] + 10, ir.name + ' dynasty');

  const qb = skill.filter(p => p.pos === 'QB' && p.tv.v.ppr.qb1[0] > 5)
    .sort((a, b) => b.tv.v.ppr.sflex[0] - a.tv.v.ppr.sflex[0])[0];
  assert.ok(qb.tv.v.ppr.sflex[0] > qb.tv.v.ppr.qb1[0], qb.name);

  const wr = skill.find(p => p.pos === 'WR' && p.tv.top);
  assert.equal(wr.tv.v.ppr.qb1[0], wr.tv.v.ppr.sflex[0]);

  const news = trade.valueOf(qb, { scoring: 'ppr', qb: 'qb1', horizon: 'redraft', newsMiss: 1, max: data.meta.trade.max.ppr.qb1[0] });
  assert.ok(news < qb.tv.v.ppr.qb1[0]);
  assert.equal(trade.valueOf(qb, { scoring: 'ppr', qb: 'qb1', horizon: 'redraft', newsMiss: 0 }), qb.tv.v.ppr.qb1[0]);
});

test('rest-of-season values rank with later actual points', () => {
  const { project, SCORING } = require('../site/model');
  const result = trade.backtest(data, project, SCORING);
  assert.ok(result.n >= 50, 'n=' + result.n);
  assert.ok(result.spearman >= 0.5, 'spearman=' + result.spearman);
  if (data.meta.trade.backtest) {
    assert.ok(Math.abs(data.meta.trade.backtest.spearman - result.spearman) < 0.02);
  }
});

test('a bye is not a missed game and every player shares the games basis', () => {
  assert.equal(trade.gamesBasis({ meta: { next_week: 6 } }), 13);
  assert.equal(trade.gameEq(13, 0, false), 13);
  const scoring = {
    ppr: { rec: 1, py: 0.04, ptd: 4, int: -2, ry: 0.1, rtd: 6, rcy: 0.1, rctd: 6, fl: -2, two: 2 },
    half: { rec: 0.5, py: 0.04, ptd: 4, int: -2, ry: 0.1, rtd: 6, rcy: 0.1, rctd: 6, fl: -2, two: 2 },
    std: { rec: 0, py: 0.04, ptd: 4, int: -2, ry: 0.1, rtd: 6, rcy: 0.1, rctd: 6, fl: -2, two: 2 },
  };
  const comps = { rc: 6, rcy: 80, rctd: 0.5, py: 0, ptd: 0, int: 0, ry: 10, rtd: 0.2, fl: 0, two: 0 };
  const pack = {
    meta: { next_week: 6, last_completed_week: 5, season: 2026 },
    team_off: { DAL: { pts_pg: 24 }, PHI: { pts_pg: 24 } },
    players: [
      { id: 'bye', name: 'Bye Week', pos: 'WR', team: 'DAL', g: 5, last_wk: 5, ppr_pg: 16, std_pg: 10, w: { tg: 8 }, t: {} },
      { id: 'full', name: 'Full Slate', pos: 'WR', team: 'PHI', g: 5, last_wk: 5, ppr_pg: 16, std_pg: 10, w: { tg: 8 }, t: {} },
    ],
  };
  const project = (pl, week) => (pl.id === 'bye' && week === 14) ? { bye: true } : { comps };
  trade.attachTrade(pack, { project, scoring });
  assert.equal(pack.players[0].tv.ros[0], pack.players[1].tv.ros[0]);
  assert.ok(pack.players[0].tv.ros[0] > 0);
  assert.equal(pack.players[0].tv.g, 13);
});

test('IR timelines keep a return and an ACL is a redraft zero', () => {
  const fresh = trade.injuryPlan({ status: 'IR', body: 'Ankle', lastWeek: 5, nextWeek: 6, basis: 13, news: [] });
  assert.equal(fresh.ret, 10);
  assert.equal(fresh.miss, 4);
  assert.ok(fresh.eq > 0);
  const back = trade.injuryPlan({ status: 'IR', body: 'Ankle', lastWeek: 1, nextWeek: 6, basis: 13, news: ['A.J. Brown returning to practice'] });
  assert.equal(back.ret, 7);
  assert.ok(back.eq > fresh.eq);
  const acl = trade.injuryPlan({ status: 'IR', body: 'Knee - ACL', lastWeek: 3, nextWeek: 6, basis: 13, news: [] });
  assert.equal(acl.long, true);
  assert.equal(acl.eq, 0);
  assert.equal(trade.parseNews('designated to return in week 12').returnWeek, 12);
  assert.equal(trade.parseNews('dealing with a sore knee').long, undefined);
});

test('starters and injured stars stay searchable', () => {
  const teams = Object.keys(data.team_names);
  assert.equal(teams.length, 32);
  for (const tm of teams) {
    const qb = data.players.find(p => p.team === tm && p.pos === 'QB' && p.tv && p.tv.starter);
    const rb = data.players.find(p => p.team === tm && p.pos === 'RB' && p.tv && p.tv.starter);
    const wr = data.players.find(p => p.team === tm && p.pos === 'WR' && p.tv && p.tv.starter);
    assert.ok(qb && qb.tv.v.ppr.qb1[0] > 0, tm + ' QB');
    assert.ok(rb && rb.tv, tm + ' RB');
    assert.ok(wr && wr.tv, tm + ' WR');
  }
  const dak = data.players.find(p => p.name === 'Dak Prescott');
  assert.ok(dak && dak.tv.starter && dak.tv.v.ppr.qb1[0] > 0 && dak.tv.v.ppr.sflex[0] > dak.tv.v.ppr.qb1[0]);
  const brown = data.players.find(p => p.name === 'A.J. Brown');
  assert.ok(brown && brown.tv, 'A.J. Brown is valued');
  const order = data.players.filter(p => p.tv).sort((a, b) => Math.max(b.tv.v.ppr.qb1[0], b.tv.v.ppr.qb1[1]) - Math.max(a.tv.v.ppr.qb1[0], a.tv.v.ppr.qb1[1]));
  const brownRank = order.findIndex(p => p.id === brown.id);
  assert.ok(brownRank >= 0 && brownRank < 80, 'rank ' + brownRank);
  assert.ok(brown.tv.v.ppr.qb1[0] > 10, 'redraft ' + brown.tv.v.ppr.qb1[0]);
  assert.ok(brown.tv.pre.ppr.qb1[0] > brown.tv.v.ppr.qb1[0]);
  assert.equal(brown.tv.inj && brown.tv.inj.ret, 7);
  assert.match(brown.tv.inj.st + ' ' + brown.tv.inj.body, /IR/);
  assert.match(brown.tv.inj.body, /Ankle/);
  const src = fs.readFileSync(path.join(site, 'trade.js'), 'utf8');
  assert.match(src, /tv\.starter/);
});

test('the trade tab, prefs, and cache name the new script', () => {
  const html = fs.readFileSync(path.join(site, 'index.html'), 'utf8');
  const sw = fs.readFileSync(path.join(site, 'sw.js'), 'utf8');
  const src = fs.readFileSync(path.join(site, 'trade.js'), 'utf8');
  assert.match(html, /data-view="trade"/);
  assert.match(html, /src="trade\.js/);
  assert.match(src, /ml-trade-scoring/);
  assert.match(src, /ml-trade-qb/);
  assert.match(src, /ml-trade-horizon/);
  assert.match(sw, /trade\.js/);
  assert.match(sw, /data\|market\|news/);
});
