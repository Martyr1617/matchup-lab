const test = require('node:test');
const assert = require('node:assert/strict');
const { optimize, isMultiQb, slotsFromSleeper, slotsFromEspn, separateSameTeamQbs } = require('../site/lineup');

const SF = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'SUPER_FLEX'];
const STD = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX'];

function p(key, pos, team, value, extra) {
  return { key, pos, team, value, name: key, ...extra };
}

test('superflex swaps a same-team backup for the next eligible player and adds no explanation', () => {
  const geno = p('geno', 'QB', 'SEA', 20);
  const lock = p('lock', 'QB', 'SEA', 14);
  const staff = p('staff', 'QB', 'LAR', 13);
  const rb = p('rb', 'RB', 'SEA', 12);
  const keys = Object.keys(geno);
  const lineup = optimize(SF, [geno, lock, staff, rb], null);
  const started = lineup.filter(Boolean).map(x => x.key);
  assert.ok(started.includes('geno'));
  assert.ok(started.includes('staff'));
  assert.ok(!started.includes('lock'));
  assert.deepEqual(Object.keys(geno), keys);
  assert.equal(geno.note, undefined);
  assert.equal(lineup.some(x => x && (x.swap || x.reason || x.badge)), false);
});

test('a flex scores ahead of the other-team QB when that flex is the better play', () => {
  const geno = p('geno', 'QB', 'SEA', 20);
  const lock = p('lock', 'QB', 'SEA', 17);
  const staff = p('staff', 'QB', 'LAR', 13);
  const rb = p('rb', 'RB', 'DAL', 16);
  const lineup = optimize(['QB', 'SUPER_FLEX'], [geno, lock, staff, rb], null);
  const started = lineup.filter(Boolean).map(x => x.key);
  assert.deepEqual(started.sort(), ['geno', 'rb']);
});

test('a one-QB league still starts the better quarterback', () => {
  const geno = p('geno', 'QB', 'SEA', 20);
  const lock = p('lock', 'QB', 'SEA', 14);
  const rb = p('rb', 'RB', 'DAL', 12);
  const lineup = optimize(STD, [geno, lock, rb], null);
  assert.equal(lineup[0].key, 'geno');
  assert.ok(lineup.filter(Boolean).some(x => x.key === 'rb'));
});

test('two QB slots take the next quarterback from another team', () => {
  const geno = p('geno', 'QB', 'SEA', 20);
  const lock = p('lock', 'QB', 'SEA', 14);
  const staff = p('staff', 'QB', 'LAR', 13);
  const lineup = optimize(['QB', 'QB', 'RB'], [geno, lock, staff, p('rb', 'RB', 'DAL', 10)], null);
  assert.deepEqual(lineup.slice(0, 2).map(x => x.key).sort(), ['geno', 'staff']);
});

test('the second slot stays empty when the only other option is the same team', () => {
  const geno = p('geno', 'QB', 'SEA', 20);
  const lock = p('lock', 'QB', 'SEA', 14);
  const lineup = optimize(['QB', 'SUPER_FLEX'], [geno, lock], null);
  const qbs = lineup.filter(x => x && x.pos === 'QB');
  assert.equal(qbs.length, 1);
  assert.equal(qbs[0].key, 'geno');
  assert.ok(lineup.includes(null));
});

test('the better quarterback moves into the QB slot when he was sitting in superflex', () => {
  const geno = p('geno', 'QB', 'SEA', 20);
  const lock = p('lock', 'QB', 'SEA', 14);
  const staff = p('staff', 'QB', 'LAR', 13);
  const slots = ['QB', 'SUPER_FLEX'];
  const assignment = [lock, geno];
  separateSameTeamQbs(slots, assignment, [geno, lock, staff], new Set());
  assert.equal(assignment[0].key, 'geno');
  assert.equal(assignment[1].key, 'staff');
});

test('two locked same-team quarterbacks stay where they are', () => {
  const geno = p('geno', 'QB', 'SEA', 20, { locked: true });
  const lock = p('lock', 'QB', 'SEA', 14, { locked: true });
  const staff = p('staff', 'QB', 'LAR', 13);
  const current = [{ slot: 'QB', key: 'geno' }, { slot: 'SUPER_FLEX', key: 'lock' }];
  const lineup = optimize(['QB', 'SUPER_FLEX'], [geno, lock, staff], current);
  assert.equal(lineup[0].key, 'geno');
  assert.equal(lineup[1].key, 'lock');
});

test('multi-QB detection follows Sleeper and ESPN slot lists', () => {
  assert.equal(isMultiQb(SF), true);
  assert.equal(isMultiQb(['QB', 'QB']), true);
  assert.equal(isMultiQb(['SUPER_FLEX', 'SUPER_FLEX']), true);
  assert.equal(isMultiQb(STD), false);
  assert.equal(isMultiQb(['QB', 'FLEX']), false);
  const sleeper = slotsFromSleeper(['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'SUPERFLEX', 'BN', 'IR', 'TAXI']);
  assert.deepEqual(sleeper, SF);
  assert.equal(isMultiQb(sleeper), true);
  const espnSf = slotsFromEspn({ 0: 1, 2: 2, 4: 2, 6: 1, 23: 1, 7: 1 });
  assert.ok(espnSf.includes('SUPER_FLEX'));
  assert.equal(isMultiQb(espnSf), true);
  assert.equal(isMultiQb(slotsFromEspn({ 0: 2, 2: 2, 4: 2, 6: 1 })), true);
  assert.equal(isMultiQb(slotsFromEspn({ 0: 1, 2: 2, 4: 2, 6: 1, 23: 1 })), false);
});
