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
  assert.equal(data.meta.trade.v, 4);
  assert.equal(data.meta.trade.slots.qb1.QB, 20);
  assert.equal(data.meta.trade.slots.sflex.QB, 32);
  const priced = p => p.adp && p.tv.inj;
  const below = skill.filter(p => p.tv.par.ppr.qb1[0] <= 0 && !priced(p));
  assert.ok(below.length > 0);
  const above = skill.filter(p => p.tv.par.ppr.qb1[0] > 0 && !priced(p));
  const worstAbove = Math.min(...above.map(p => p.tv.v.ppr.qb1[0]));
  assert.ok(below.every(p => p.tv.v.ppr.qb1[0] <= worstAbove));

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

test('the value curve stays smooth and a better quarterback ranks higher', () => {
  assert.equal(trade.CURVE_T, 20);
  assert.equal(trade.SLOTS.qb1.QB, 20);
  assert.equal(trade.SLOTS.sflex.QB, 32);
  let prev = -Infinity;
  for (let s = -80; s <= 160; s += 1) {
    const y = trade.curve(s);
    assert.ok(y > prev, 'curve step at ' + s);
    prev = y;
  }
  const step = s => trade.curve(s) - trade.curve(s - 1);
  assert.ok(Math.abs(step(0) - step(1)) < 0.05);

  const skill = data.players.filter(p => /^(QB|RB|WR|TE)$/.test(p.pos) && p.tv);
  for (const mode of ['qb1', 'sflex']) {
    for (const hi of [0, 1]) {
      for (const pos of ['QB', 'RB', 'WR', 'TE']) {
        const rows = skill.filter(p => p.pos === pos && !(p.adp && p.tv.inj)).sort((a, b) => b.tv.par.ppr[mode][hi] - a.tv.par.ppr[mode][hi]);
        for (let i = 1; i < rows.length; i++) {
          if (rows[i - 1].tv.par.ppr[mode][hi] <= rows[i].tv.par.ppr[mode][hi]) continue;
          assert.ok(rows[i - 1].tv.v.ppr[mode][hi] >= rows[i].tv.v.ppr[mode][hi], rows[i].name + ' outranks a better ' + pos);
        }
      }
    }
  }

  const avg = (rows, mode) => rows.reduce((s, p) => s + p.tv.v.ppr[mode][0], 0) / rows.length;
  const qbs = skill.filter(p => p.pos === 'QB').sort((a, b) => b.tv.ros[0] - a.tv.ros[0]);
  const rbs = skill.filter(p => p.pos === 'RB').sort((a, b) => b.tv.ros[0] - a.tv.ros[0]).slice(5, 12);
  const wrs = skill.filter(p => p.pos === 'WR').sort((a, b) => b.tv.ros[0] - a.tv.ros[0]).slice(5, 12);
  const qAvg = avg(qbs.slice(0, 5), 'qb1');
  const mid = avg(rbs.concat(wrs), 'qb1');
  assert.ok(qAvg > mid * 0.6 && qAvg < mid * 1.25, 'top QB ' + qAvg.toFixed(1) + ' mid skill ' + mid.toFixed(1));

  const sf = skill.slice().sort((a, b) => b.tv.v.ppr.sflex[0] - a.tv.v.ppr.sflex[0]);
  const sfQ = sf.filter(p => p.pos === 'QB').slice(0, 3);
  for (const q of sfQ) {
    const rank = sf.findIndex(p => p.id === q.id);
    assert.ok(rank >= 0 && rank < 15, q.name + ' superflex rank ' + (rank + 1));
  }
  const starters = skill.filter(p => p.pos === 'QB' && p.tv.starter);
  assert.equal(new Set(starters.map(p => p.team)).size, 32);
  for (const q of starters) {
    assert.ok(q.tv.v.ppr.qb1[0] > 0, q.name + ' 1QB');
    assert.ok(q.tv.v.ppr.sflex[0] > q.tv.v.ppr.qb1[0], q.name + ' superflex');
  }
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

test('make it fairer names a role on the side that is behind', () => {
  assert.equal(trade.tierOf('QB', 13), 'QB2');
  assert.equal(trade.tierOf('RB', 24), 'RB2');
  assert.equal(trade.tierOf('WR', 25), 'WR3');
  assert.equal(trade.tierOf('TE', 6), 'TE1');
  const pool = [];
  for (let i = 1; i <= 36; i++) pool.push({ id: 'w' + i, name: 'WR ' + i, pos: 'WR', value: 80 - i, inj: '' });
  for (let i = 1; i <= 12; i++) pool.push({ id: 't' + i, name: 'TE ' + i, pos: 'TE', value: 40 - i, inj: i === 6 ? 'IR · Ankle' : '' });
  const even = trade.fairer(
    [{ id: 'a', name: 'A', pos: 'RB', value: 50 }],
    [{ id: 'b', name: 'B', pos: 'WR', value: 54 }],
    pool
  );
  assert.equal(even.fair, true);
  assert.equal(even.note, 'This looks fair');
  assert.equal(even.suggestions.length, 0);

  const a = [{ id: 'star', name: 'Star', pos: 'WR', value: 100 }];
  const b = [{ id: 'low', name: 'Low', pos: 'RB', value: 40 }];
  const lop = trade.fairer(a, b, pool);
  assert.equal(lop.behind, 'b');
  assert.ok(lop.need >= 55 && lop.need <= 60, 'need ' + lop.need);
  const adds = lop.suggestions.filter(s => s.kind === 'add');
  assert.ok(adds.length >= 2 && adds.length <= 4);
  assert.ok(adds.every(s => s.side === 'b'));
  assert.ok(adds.every(s => !/Side A/.test(s.text)));
  const examples = adds.flatMap(s => s.examples);
  assert.ok(examples.length >= 1);
  assert.ok(examples.every(p => p.id !== 'star' && p.id !== 'low'));
  for (const p of examples) {
    const g = trade.analyze(a, b.concat(p));
    assert.ok(g.pct <= 0.12, p.name + ' ' + g.grade);
    assert.ok(g.grade === 'A+' || g.grade === 'A' || g.grade === 'B');
  }

  const hurtPool = pool.map(p => ({ ...p, inj: 'IR · Knee' }));
  const hurt = trade.fairer(a, b, hurtPool);
  const flagged = hurt.suggestions.flatMap(s => s.examples);
  assert.ok(flagged.length);
  assert.ok(flagged.every(p => p.inj === 'IR · Knee'));

  const full = trade.fairer(a, [1, 2, 3, 4, 5].map(i => ({ id: 'b' + i, name: 'B' + i, pos: 'RB', value: 8 })), pool);
  assert.equal(full.suggestions.filter(s => s.kind === 'add').length, 0);
  assert.match(full.note, /5 players/);
});

test('ADP can raise a hurt player and cannot cut or pass a healthy baseline', () => {
  assert.deepEqual(trade.ADP_WEIGHT.healthy, [0.05, 0.15]);
  assert.deepEqual(trade.ADP_WEIGHT.hurt, [0.30, 0.35]);
  assert.equal(trade.blendValue(14.5, 21.8, 21.4, 0.30), 16.6);
  assert.equal(trade.blendValue(14.5, 21.8, 5, 0.30), 14.5);
  assert.equal(trade.blendValue(14.5, 16, 40, 0.5), 16);
  assert.equal(trade.blendValue(100, 100, 30, 0.05), 100);

  const points = [];
  for (let i = 1; i <= 80; i++) points.push({ adp: i, value: Math.max(1, 90 - i), hurt: false });
  const curve = trade.fitAdpCurve(points);
  assert.ok(curve);
  assert.ok(curve(5) > curve(40), curve(5) + ' vs ' + curve(40));
  assert.ok(curve(40) >= curve(70));

  const brown = data.players.find(p => p.name === 'A.J. Brown');
  const achane = data.players.find(p => p.name === "De'Von Achane");
  const puka = data.players.find(p => p.name === 'Puka Nacua');
  if (brown && brown.adp) {
    assert.ok(brown.adp < 80, 'adp ' + brown.adp);
    assert.ok(brown.tv.v.ppr.qb1[0] > 14.5);
    assert.ok(brown.tv.v.ppr.qb1[0] <= brown.tv.pre.ppr.qb1[0]);
    assert.ok(brown.tv.v.ppr.qb1[1] <= brown.tv.pre.ppr.qb1[1]);
  }
  if (achane && achane.adp) {
    assert.ok(achane.tv.v.ppr.qb1[0] > 0);
    assert.ok(achane.tv.v.ppr.qb1[0] < 12);
    assert.ok(achane.tv.v.ppr.qb1[0] <= achane.tv.pre.ppr.qb1[0]);
  }
  if (puka) assert.equal(puka.tv.v.ppr.qb1[0], 100);
  for (const p of data.players) {
    if (!p.tv || !(p.adp > 0)) continue;
    for (const scoring of ['ppr', 'half', 'std']) {
      for (const mode of ['qb1', 'sflex']) {
        for (let hi = 0; hi < 2; hi++) {
          const v = p.tv.v[scoring][mode][hi];
          const pre = p.tv.pre[scoring][mode][hi];
          assert.ok(v <= pre + 0.05, p.name + ' ' + v + ' above healthy ' + pre);
        }
      }
    }
  }
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
