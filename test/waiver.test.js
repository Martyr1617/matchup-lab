const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { advise } = require('../site/waiver');

const STD = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DEF'];
const SF = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'SUPER_FLEX'];

function guy(name, pos, ros, dyn, extra) {
  const tv = {
    v: { ppr: { qb1: [ros, dyn], sflex: [ros, dyn] } },
    ...(extra && extra.tv),
  };
  if (extra && extra.sflex) tv.v.ppr.sflex = extra.sflex;
  return { key: name, name, pos, status: extra && extra.status, tv, bye: !!(extra && extra.bye) };
}

function add(name, pos, ros, dyn) {
  return { key: 'fa-' + name, name, pos, tv: { v: { ppr: { qb1: [ros, dyn], sflex: [ros, dyn] } } } };
}

const baseRoster = () => [
  guy('Starter QB', 'QB', 30, 28, { tv: { top: true } }),
  guy('Starter RB', 'RB', 18, 16, { tv: { top: true } }),
  guy('Other RB', 'RB', 14, 12, { tv: { top: true } }),
  guy('Starter WR', 'WR', 16, 15, { tv: { top: true } }),
  guy('Other WR', 'WR', 12, 11, { tv: { top: true } }),
  guy('Starter TE', 'TE', 10, 9, { tv: { top: true } }),
  guy('Flex WR', 'WR', 9, 8, { tv: { top: true } }),
];

test('a bench RB or WR is the drop for a quarterback or tight end pickup', () => {
  const roster = baseRoster().concat([
    guy('Bench RB', 'RB', 0.2, 0.1),
    guy('Bench WR', 'WR', 0.4, 0.2),
  ]);
  const opt = roster.slice(0, 7);
  const te = add('Waiver TE', 'TE', 6, 4);
  const qb = add('Waiver QB', 'QB', 5, 3);
  const rows = advise({ roster, opt, slots: STD, freeAgents: [te, qb], scoring: 'ppr', qbMode: 'qb1' });
  assert.equal(rows.length, 2);
  for (const row of rows) {
    assert.equal(row.drop.name, 'Bench RB');
    assert.notEqual(row.drop.pos, row.e.pos);
    assert.ok(row.gain > 0);
    assert.equal(row.reason, 'Drop Bench RB: low value, no long-term upside');
    assert.deepEqual(row.alts.map(p => p.name), ['Bench WR']);
    assert.deepEqual(row.altReasons, ['Drop Bench WR: low value, no long-term upside']);
  }
  assert.equal(rows[0].e.name, 'Waiver TE');
  assert.ok(rows[0].gain > rows[1].gain);
});

test('stars and injured high-value players stay off the drop list', () => {
  const star = guy('Bench Star', 'WR', 18, 16);
  const hurt = guy('Returning Star', 'RB', 0.05, 0.05, {
    tv: { inj: { st: 'Out', ret: 12 }, pre: { ppr: { qb1: [22, 30], sflex: [22, 30] } } },
  });
  const upside = guy('Young Stash', 'WR', 0.2, 6);
  const scrub = guy('Scrub WR', 'WR', 0.4, 0.2);
  const roster = baseRoster().concat([star, hurt, upside, scrub]);
  const opt = roster.slice(0, 7);
  const pickup = add('Waiver QB', 'QB', 12, 8);
  const rows = advise({ roster, opt, slots: STD, freeAgents: [pickup], scoring: 'ppr', qbMode: 'qb1' });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].drop.name, 'Scrub WR');
  const named = [rows[0].drop.name, ...rows[0].alts.map(p => p.name)];
  assert.ok(!named.includes('Bench Star'));
  assert.ok(!named.includes('Returning Star'));
  assert.ok(!named.includes('Young Stash'));
  assert.equal(rows[0].reason, 'Drop Scrub WR: low value, no long-term upside');

  const onlyStars = advise({
    roster: roster.filter(p => p.name !== 'Scrub WR'),
    opt, slots: STD, freeAgents: [pickup], scoring: 'ppr', qbMode: 'qb1',
  });
  assert.deepEqual(onlyStars, []);
});

test('a low-value starter is not the drop when a bench player is', () => {
  const cheapStart = guy('Cheap Start', 'RB', 0.02, 0.01);
  const scrub = guy('Scrub WR', 'WR', 0.5, 0.2);
  const roster = [
    guy('Starter QB', 'QB', 20, 18, { tv: { top: true } }),
    cheapStart,
    guy('Other RB', 'RB', 12, 10, { tv: { top: true } }),
    guy('Starter WR', 'WR', 11, 10, { tv: { top: true } }),
    guy('Other WR', 'WR', 9, 8, { tv: { top: true } }),
    guy('Starter TE', 'TE', 8, 7, { tv: { top: true } }),
    scrub,
  ];
  const opt = [roster[0], cheapStart, roster[2], roster[3], roster[4], roster[5]];
  const rows = advise({
    roster, opt, slots: STD, freeAgents: [add('Waiver TE', 'TE', 3, 2)], scoring: 'ppr', qbMode: 'qb1',
  });
  assert.equal(rows[0].drop.name, 'Scrub WR');
  assert.ok(!rows[0].alts.some(p => p.name === 'Cheap Start'));
});

test('the only player at a required position is not a drop', () => {
  const onlyTe = guy('Only TE', 'TE', 0.05, 0.02);
  const onlyQb = guy('Only QB', 'QB', 0.04, 0.02);
  const benchWr = guy('Bench WR', 'WR', 0.5, 0.2);
  const roster = [
    onlyQb,
    guy('RB1', 'RB', 14, 12, { tv: { top: true } }),
    guy('RB2', 'RB', 10, 9, { tv: { top: true } }),
    guy('WR1', 'WR', 12, 11, { tv: { top: true } }),
    guy('WR2', 'WR', 9, 8, { tv: { top: true } }),
    onlyTe,
    benchWr,
  ];
  const opt = roster.slice(0, 6);
  const rows = advise({
    roster, opt, slots: STD, freeAgents: [add('Waiver QB', 'QB', 5, 4)], scoring: 'ppr', qbMode: 'qb1',
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].drop.name, 'Bench WR');
  assert.ok(!rows[0].alts.some(p => p.name === 'Only TE' || p.name === 'Only QB'));

  const alone = advise({
    roster: roster.filter(p => p.name !== 'Bench WR'),
    opt, slots: STD, freeAgents: [add('Waiver QB', 'QB', 5, 4)], scoring: 'ppr', qbMode: 'qb1',
  });
  assert.deepEqual(alone, []);
});

test('superflex keeps two quarterbacks and can still drop a third for another position', () => {
  const qb1 = guy('QB One', 'QB', 20, 18, { tv: { top: true } });
  const qb2 = guy('QB Two', 'QB', 0.3, 0.2);
  const qb3 = guy('QB Three', 'QB', 0.15, 0.1);
  const roster = [
    qb1, qb2,
    guy('RB1', 'RB', 14, 12, { tv: { top: true } }),
    guy('RB2', 'RB', 10, 9, { tv: { top: true } }),
    guy('WR1', 'WR', 12, 10, { tv: { top: true } }),
    guy('WR2', 'WR', 9, 8, { tv: { top: true } }),
    guy('TE1', 'TE', 8, 7, { tv: { top: true } }),
    qb3,
  ];
  const opt = [qb1, roster[2], roster[3], roster[4], roster[5], roster[6], qb2];
  const kept = advise({
    roster: roster.filter(p => p !== qb3),
    opt, slots: SF, freeAgents: [add('Waiver TE', 'TE', 4, 3)], scoring: 'ppr', qbMode: 'sflex',
  });
  assert.deepEqual(kept, []);

  const rows = advise({
    roster, opt, slots: SF, freeAgents: [add('Waiver TE', 'TE', 4, 3)], scoring: 'ppr', qbMode: 'sflex',
  });
  assert.equal(rows[0].drop.name, 'QB Three');
  assert.equal(rows[0].drop.pos, 'QB');
  assert.equal(rows[0].e.pos, 'TE');
  assert.ok(!rows[0].alts.some(p => p.name === 'QB Two'));
});

test('a quarterback who is only valuable in superflex is protected in that format', () => {
  const stash = guy('SF Stash', 'QB', 0.2, 0.1, { sflex: [18, 16] });
  const scrub = guy('Bench RB', 'RB', 0.3, 0.1);
  const roster = baseRoster().concat([guy('QB Two', 'QB', 8, 7, { tv: { top: true } }), stash, scrub]);
  const opt = roster.slice(0, 7);
  const oneQb = advise({
    roster, opt, slots: STD, freeAgents: [add('Waiver TE', 'TE', 3, 2)], scoring: 'ppr', qbMode: 'qb1',
  });
  assert.equal(oneQb[0].drop.name, 'SF Stash');
  const sflex = advise({
    roster, opt, slots: SF, freeAgents: [add('Waiver TE', 'TE', 3, 2)], scoring: 'ppr', qbMode: 'sflex',
  });
  assert.equal(sflex[0].drop.name, 'Bench RB');
  assert.ok(!sflex[0].alts.some(p => p.name === 'SF Stash'));
});

test('a bye does not force an extra spare, and a same-value player is not an upgrade', () => {
  const byeRb = guy('Bye RB', 'RB', 8, 6, { tv: { top: true }, bye: true });
  const benchRb = guy('Extra RB', 'RB', 0.2, 0.1);
  const roster = [
    guy('QB', 'QB', 20, 18, { tv: { top: true } }),
    byeRb,
    guy('RB2', 'RB', 12, 10, { tv: { top: true } }),
    guy('WR1', 'WR', 11, 9, { tv: { top: true } }),
    guy('WR2', 'WR', 9, 8, { tv: { top: true } }),
    guy('TE', 'TE', 8, 7, { tv: { top: true } }),
    benchRb,
  ];
  const opt = roster.slice(0, 6);
  const rows = advise({
    roster, opt, slots: STD, freeAgents: [add('Waiver QB', 'QB', 2, 1)], scoring: 'ppr', qbMode: 'qb1',
  });
  assert.equal(rows[0].drop.name, 'Extra RB');

  const thin = roster.filter(p => p !== benchRb);
  const blocked = advise({
    roster: thin, opt, slots: STD, freeAgents: [add('Waiver QB', 'QB', 2, 1)], scoring: 'ppr', qbMode: 'qb1',
  });
  assert.deepEqual(blocked, []);

  const noUpgrade = advise({
    roster, opt, slots: STD, freeAgents: [add('Small Add', 'QB', 0.1, 0.05)], scoring: 'ppr', qbMode: 'qb1',
  });
  assert.deepEqual(noUpgrade, []);
});

test('two alternatives are offered and a lesser add is left off', () => {
  const roster = baseRoster().concat([
    guy('Drop A', 'RB', 0.1, 0.05),
    guy('Drop B', 'WR', 0.2, 0.1),
    guy('Drop C', 'WR', 0.3, 0.1),
    guy('Drop D', 'RB', 0.45, 0.2),
  ]);
  const opt = roster.slice(0, 7);
  const rows = advise({
    roster, opt, slots: STD, freeAgents: [add('Waiver TE', 'TE', 4, 2)], scoring: 'ppr', qbMode: 'qb1',
  });
  assert.equal(rows[0].drop.name, 'Drop A');
  assert.deepEqual(rows[0].alts.map(p => p.name), ['Drop B', 'Drop C']);
  assert.equal(rows[0].altReasons.length, 2);
});

test('opportunity outranks a higher trade value, and the drop stays the cheapest player', () => {
  const { advise } = require('../site/waiver');
  const roster = baseRoster().concat([
    guy('Bench RB', 'RB', 0.2, 0.1),
    guy('Bench WR', 'WR', 0.4, 0.2),
  ]);
  const opt = roster.slice(0, 7);
  const team = [
    { id: 'workhorse', team: 'NYJ', pos: 'RB', log: [{ wk: 6, ca: 18, tg: 1, ppr: 14, sp: 0.72 }] },
    { id: 'volume', team: 'NYJ', pos: 'RB', name: 'Volume Back', log: [
      { wk: 4, ca: 8, tg: 2, ppr: 7, sp: 0.4 },
      { wk: 5, ca: 10, tg: 2, ppr: 8, sp: 0.48 },
      { wk: 6, ca: 12, tg: 3, ppr: 9, sp: 0.55 },
    ] },
    { id: 'quiet', team: 'NYJ', pos: 'RB', name: 'Quiet Back', log: [
      { wk: 6, ca: 1, tg: 0, ppr: 6, sp: 0.08 },
    ] },
    { id: 'fluke', team: 'NYJ', pos: 'RB', name: 'Fluke Back', log: [
      { wk: 5, ca: 2, tg: 1, ppr: 3, sp: 0.2 },
      { wk: 6, ca: 1, tg: 2, ppr: 14, rtd: 2, sp: 0.22 },
    ] },
  ];
  const volume = add('Volume Back', 'RB', 3, 1);
  volume.ml = team[1];
  const quiet = add('Quiet Back', 'RB', 9, 2);
  quiet.ml = team[2];
  const fluke = add('Fluke Back', 'RB', 5, 1);
  fluke.ml = team[3];
  const rows = advise({
    roster, opt, slots: STD, freeAgents: [quiet, volume, fluke], scoring: 'ppr', qbMode: 'qb1',
    players: team,
  });
  assert.equal(rows[0].e.name, 'Volume Back');
  assert.equal(rows[0].drop.name, 'Bench RB');
  assert.match(rows[0].why, /Carries share/);
  assert.ok(rows[0].score > rows.find(r => r.e.name === 'Quiet Back').score);
  const flukeRow = rows.find(r => r.e.name === 'Fluke Back');
  assert.match(flukeRow.why, /TD-fluke warning/);
  assert.ok(flukeRow.score < rows.find(r => r.e.name === 'Volume Back').score);
});

test('a handcuff and a rising rookie get the backtested reasons', () => {
  const starter = { id: 'starter', team: 'PIT', pos: 'WR', log: [{ wk: 4, tg: 8, ca: 0, ppr: 12, sp: 0.8 }] };
  const cuff = {
    id: 'cuff', team: 'PIT', pos: 'WR', name: 'Cuff',
    log: [{ wk: 6, tg: 9, ca: 0, ppr: 16, sp: 0.65 }],
  };
  const rookie = {
    id: 'rook', team: 'NO', pos: 'WR', name: 'Rook', rookie: 1,
    adv: { tgt_share: 0.12, ay_share: 0.1 },
    log: [
      { wk: 4, tg: 3, ca: 0, ppr: 4, sp: 0.30 },
      { wk: 5, tg: 4, ca: 0, ppr: 6, sp: 0.45 },
      { wk: 6, tg: 5, ca: 0, ppr: 7, sp: 0.62 },
    ],
  };
  const filler = {
    id: 'fill', team: 'NO', pos: 'WR', name: 'Fill',
    adv: { tgt_share: 0.04, ay_share: 0.02 },
    log: [{ wk: 6, tg: 1, ca: 0, ppr: 2, sp: 0.2 }],
  };
  const roster = baseRoster().concat([guy('Bench RB', 'RB', 0.2, 0.1)]);
  const opt = roster.slice(0, 7);
  const a = add('Cuff', 'WR', 4, 1); a.ml = cuff;
  const b = add('Rook', 'WR', 4, 1); b.ml = rookie;
  const c = add('Fill', 'WR', 4, 1); c.ml = filler;
  const rows = advise({
    roster, opt, slots: STD, freeAgents: [a, b, c], scoring: 'ppr', qbMode: 'qb1',
    players: [starter, cuff, rookie, filler, { id: 'pit-other', team: 'PIT', pos: 'WR', log: [{ wk: 6, tg: 10, ca: 0 }] }],
    roles: { 7: { out: ['starter'], chart: { PIT: { WR: ['starter', 'cuff'] } } } },
    week: 7,
  });
  const cuffRow = rows.find(r => r.e.name === 'Cuff');
  const rookRow = rows.find(r => r.e.name === 'Rook');
  assert.match(cuffRow.why, /Starter out, inherits ~65% snaps/);
  assert.match(rookRow.why, /Rookie routes up 3 straight weeks/);
  assert.equal(cuffRow.drop.name, 'Bench RB');
});

test('the team view asks for expendable drops instead of a same-position swap', () => {
  const team = fs.readFileSync(path.join(__dirname, '..', 'site', 'team.js'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '..', 'site', 'index.html'), 'utf8');
  assert.match(team, /MLWaiver\.advise/);
  assert.match(team, /Suggested drop/);
  assert.match(team, /w\.reason/);
  assert.match(team, /w\.why/);
  assert.match(team, /w\.altReasons/);
  assert.doesNotMatch(team, /Upgrade over/);
  assert.doesNotMatch(team, /weakest eligible starter/);
  assert.match(html, /src="waiver\.js/);
});
