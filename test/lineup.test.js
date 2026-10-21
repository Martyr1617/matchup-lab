const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { optimize, isMultiQb, slotsFromSleeper, slotsFromEspn, separateSameTeamQbs, swapLines, swapMoves, sleeperTeamLinks, sleeperOpenPlan } = require('../site/lineup');

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
  assert.deepEqual(slotsFromSleeper(['QB', 'DL', 'LB', 'DB', 'IDP_FLEX', 'BN', 'IR', 'TAXI']), ['QB', 'DL', 'LB', 'DB', 'IDP_FLEX']);
});

test('IDP slots start defensive players and leave a wide receiver in the skill slot', () => {
  const wr = p('wr', 'WR', 'DAL', 20);
  const de = p('de', 'DE', 'DAL', 5);
  const lb = p('lb', 'LB', 'DAL', 4);
  const lineup = optimize(['WR', 'DL', 'IDP_FLEX'], [wr, de, lb], null);
  assert.equal(lineup[0].key, 'wr');
  assert.equal(lineup[1].key, 'de');
  assert.equal(lineup[2].key, 'lb');
});

test('an out or bye player is not started when a healthy player fits the slot', () => {
  const hurt = p('hurt', 'RB', 'DAL', -1);
  const bye = p('bye', 'RB', 'NYJ', -1);
  const healthy = p('healthy', 'RB', 'DAL', 9);
  const lineup = optimize(['RB', 'FLEX'], [hurt, bye, healthy], null);
  assert.deepEqual(lineup.map(x => x && x.key), ['healthy', null]);
});

test('swap lines name the start, the player they replace, and the gain', () => {
  const lines = swapLines([
    { start: { name: 'Amon-Ra', proj: 12.34, status: 'ok' }, sit: { name: 'Bench Guy', proj: 8.1, status: 'ok' } },
    { start: { name: 'Same', proj: 4, status: 'ok' }, sit: { name: 'Other', proj: 4, status: 'ok' } },
    { start: { name: 'Empty Fill', proj: 9.05, status: 'ok' }, sit: null },
    { start: { name: 'Handcuff', proj: 6.2, status: 'ok' }, sit: { name: 'Starter', proj: 11, status: 'out' } },
    { start: null, sit: { name: 'Just Out', proj: 0, status: 'out' } },
  ]);
  assert.deepEqual(lines, [
    'Start Amon-Ra (12.3) over Bench Guy (8.1), +4.2 pts',
    'Start Empty Fill (9.1) in an empty slot, +9.1 pts',
    'Start Handcuff (6.2) over Starter (0.0), +6.2 pts',
  ]);
});

test('swap rows keep the start and the player they replace separate', () => {
  const rows = swapMoves([
    { start: { name: 'Amon-Ra', proj: 12.34, status: 'ok' }, sit: { name: 'Bench Guy', proj: 8.1, status: 'ok' } },
    { start: { name: 'Empty Fill', proj: 9.05, status: 'ok' }, sit: null },
  ]);
  assert.equal(rows[0].kind, 'over');
  assert.equal(rows[0].startName, 'Amon-Ra');
  assert.equal(rows[0].sitName, 'Bench Guy');
  assert.equal(rows[1].kind, 'empty');
});

test('Sleeper links open the league the app routes, with the web team page as fallback', () => {
  const id = '1049283494438133760';
  const links = sleeperTeamLinks(id);
  assert.equal(links.web, `https://sleeper.com/leagues/${id}/team`);
  assert.equal(links.app, `sleeper://shortcuts?league_id=${id}`);
  assert.equal(links.legacyApp, 'sleeperbot://open');
  assert.match(links.androidIntent, new RegExp(`^intent://shortcuts\\?league_id=${id}#Intent;scheme=sleeper;`));
  assert.match(links.androidIntent, /category=android\.intent\.category\.BROWSABLE/);
  assert.doesNotMatch(links.androidIntent, /package=/);
  assert.doesNotMatch(links.androidIntent, /scheme=sleeperbot/);
  const fb = links.androidIntent.split('browser_fallback_url=')[1].replace(/;end$/, '');
  assert.equal(decodeURIComponent(fb), links.web);
  assert.equal(sleeperTeamLinks('not-an-id'), null);
  assert.equal(sleeperTeamLinks(''), null);
  assert.deepEqual(sleeperOpenPlan(links, 'Mozilla/5.0'), { kind: 'web', url: links.web, fallback: links.web });
  assert.equal(sleeperOpenPlan(links, 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)').url, links.app);
  assert.equal(sleeperOpenPlan(links, 'Mozilla/5.0 (Linux; Android 14)').url, links.androidIntent);
  const team = fs.readFileSync(path.join(__dirname, '..', 'site', 'team.js'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '..', 'site', 'styles.css'), 'utf8');
  assert.match(team, /card-title">Optimal lineup/);
  assert.match(team, /Open in Sleeper/);
  assert.match(team, /already optimal for Week/);
  assert.match(team, /Total projected gain/);
  assert.match(team, /sleeperTeamLinks/);
  assert.match(team, /swapMoves/);
  assert.match(team, /class="mv in">Start/);
  assert.match(team, /class="mv out">Bench/);
  assert.match(css, /#optimal-lineup \.mv\.in \{ background: #14532d; color: #d8ffe4; \}/);
  assert.match(css, /#optimal-lineup \.mv\.out \{ background: #5c1a1a; color: #ffd0d0; \}/);
  assert.doesNotMatch(team, /method:\s*['"](?:POST|PUT|PATCH|DELETE)['"]/);
});
