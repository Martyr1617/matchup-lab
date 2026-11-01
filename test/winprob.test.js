const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { phaseFromScore, remain, sideOf, winProb, suggest } = require('../site/winprob');

const ELIG = {
  QB: ['QB'], RB: ['RB'], WR: ['WR'], TE: ['TE'], FLEX: ['RB', 'WR', 'TE'],
  K: ['K'], DEF: ['DEF'],
};

function guy(key, pos, mean, sd, extra) {
  return {
    key, pos, name: key, mean, sd,
    floor: mean - sd, ceil: mean + sd,
    live: 0, fraction: 1, locked: false, playable: true,
    ...extra,
  };
}

test('a first-quarter clock leaves most of the variance', () => {
  const phase = phaseFromScore({ status: 'in_game', metadata: { is_in_progress: true, quarter_num: 1, time_remaining: '5:33' } });
  assert.equal(phase.status, 'live');
  assert.ok(Math.abs(phase.fraction - (60 - (15 - 5.55)) / 60) < 0.01, phase.fraction);
  const part = remain({ mean: 20, sd: 10, live: 4, fraction: phase.fraction });
  assert.ok(Math.abs(part.mean - 20 * phase.fraction) < 1e-9);
  assert.ok(Math.abs(part.var - 100 * phase.fraction) < 1e-9);
  assert.equal(part.live, 4);
});

test('a final game keeps the points already scored and no variance', () => {
  const phase = phaseFromScore({ status: 'complete', metadata: { is_over: true, quarter_num: 4, time_remaining: '0:00' } });
  assert.equal(phase.fraction, 0);
  const side = sideOf([{ mean: 18, sd: 8, live: 22.4, fraction: 0 }]);
  assert.equal(side.live, 22.4);
  assert.equal(side.mean, 22.4);
  assert.equal(side.sd, 0);
  assert.equal(winProb(side, { mean: 20, sd: 0 }), 1);
  assert.equal(winProb(side, { mean: 22.4, sd: 0 }), 0.5);
});

test('an underdog takes the higher ceiling even with a lower mean', () => {
  const safe = guy('safe', 'RB', 18, 3);
  const boom = guy('boom', 'RB', 14, 14);
  const locked = guy('qb', 'QB', 70, 6, { locked: true, playable: false });
  const opp = { mean: 100, sd: 8, live: 0 };
  const out = suggest({
    slots: ['QB', 'RB'],
    current: [locked, safe],
    roster: [locked, safe, boom],
    opp, elig: ELIG, minGain: 0.02,
  });
  assert.equal(out.show, true);
  assert.equal(out.underdog, true);
  assert.equal(out.swaps.length, 1);
  assert.equal(out.swaps[0].start.key, 'boom');
  assert.equal(out.swaps[0].sit.key, 'safe');
  assert.ok(out.bestProb > out.currentProb);
  assert.ok(out.gain >= 0.02);
});

test('a favorite takes the higher floor even with a lower mean', () => {
  const safe = guy('safe', 'RB', 12, 1);
  const boom = guy('boom', 'RB', 14, 16);
  const locked = guy('qb', 'QB', 90, 5, { locked: true, playable: false });
  const opp = { mean: 80, sd: 8, live: 0 };
  const out = suggest({
    slots: ['QB', 'RB'],
    current: [locked, boom],
    roster: [locked, safe, boom],
    opp, elig: ELIG, minGain: 0.02,
  });
  assert.equal(out.show, true);
  assert.equal(out.underdog, false);
  assert.equal(out.swaps[0].start.key, 'safe');
  assert.equal(out.swaps[0].sit.key, 'boom');
  assert.ok(out.gain >= 0.02);
});

test('a started player is locked once the game has started', () => {
  const started = guy('started', 'RB', 10, 4, { locked: true, playable: false, fraction: 0.4, live: 6 });
  const boom = guy('boom', 'RB', 30, 12);
  const out = suggest({
    slots: ['RB'],
    current: [started],
    roster: [started, boom],
    opp: { mean: 40, sd: 8 },
    elig: ELIG,
    minGain: 0.02,
  });
  assert.equal(out.show, false);
  assert.equal(out.swaps.length, 0);
  assert.equal(out.reason, 'locked');
  assert.ok(!out.swaps.some(s => (s.start && s.start.key) === 'started' || (s.sit && s.sit.key) === 'boom' && false));
});

test('a favorite with no useful swap keeps the safer starters', () => {
  const safe = guy('safe', 'RB', 14, 2);
  const worse = guy('worse', 'RB', 8, 3);
  const locked = guy('qb', 'QB', 40, 1, { locked: true, playable: false, live: 30, fraction: 0 });
  const out = suggest({
    slots: ['QB', 'RB'],
    current: [locked, safe],
    roster: [locked, safe, worse],
    opp: { mean: 20, sd: 4, live: 10 },
    elig: ELIG,
    minGain: 0.02,
  });
  assert.equal(out.show, false);
  assert.equal(out.reason, 'ahead');
  assert.ok(out.currentProb > 0.5);
  assert.equal(out.swaps.length, 0);
  assert.ok(out.players[0].locked);
  assert.equal(out.players[0].key, 'qb');
});

test('an underdog with no useful swap does not chase a worse ceiling', () => {
  const safe = guy('safe', 'WR', 10, 2);
  const worse = guy('worse', 'WR', 6, 2);
  const out = suggest({
    slots: ['WR'],
    current: [safe],
    roster: [safe, worse],
    opp: { mean: 40, sd: 6, live: 20 },
    elig: ELIG,
    minGain: 0.02,
  });
  assert.equal(out.show, false);
  assert.equal(out.reason, 'behind');
  assert.ok(out.currentProb < 0.5);
  assert.equal(out.swaps.length, 0);
});

test('an even matchup with no two-point gain stays put', () => {
  const a = guy('a', 'WR', 12, 4);
  const b = guy('b', 'WR', 12.05, 4);
  const out = suggest({
    slots: ['WR'],
    current: [a],
    roster: [a, b],
    opp: { mean: 12, sd: 30, live: 0 },
    elig: ELIG,
    minGain: 0.02,
  });
  assert.equal(out.show, false);
  assert.equal(out.reason, 'even');
  assert.ok(Math.abs(out.currentProb - 0.5) < 0.05);
});

test('a locked starter is not the player a suggestion tells you to bench', () => {
  const locked = guy('locked', 'RB', 8, 3, { locked: true, playable: false, live: 4, fraction: 0.3 });
  const safe = guy('safe', 'WR', 16, 2);
  const boom = guy('boom', 'WR', 12, 12);
  const out = suggest({
    slots: ['RB', 'WR'],
    current: [locked, safe],
    roster: [locked, safe, boom],
    opp: { mean: 80, sd: 8 },
    elig: ELIG,
    minGain: 0.02,
  });
  assert.equal(out.players[0].key, 'locked');
  assert.ok(!out.swaps.some(s => s.slot === 'RB' || (s.sit && s.sit.key === 'locked') || (s.start && s.start.key === 'locked')));
});

test('a tiny win-chance gain is not a suggestion', () => {
  const a = guy('a', 'WR', 10, 5);
  const b = guy('b', 'WR', 10.05, 5);
  const out = suggest({
    slots: ['WR'],
    current: [a],
    roster: [a, b],
    opp: { mean: 100, sd: 20 },
    elig: ELIG,
    minGain: 0.02,
  });
  assert.equal(out.show, false);
});

test('a max-points seed is the fallback when no swap raises the win chance', () => {
  const safe = guy('safe', 'RB', 12, 2);
  const boom = guy('boom', 'RB', 18, 3);
  const locked = guy('qb', 'QB', 20, 4, { locked: true, playable: false });
  const opp = { mean: 40, sd: 8, live: 0 };
  const out = suggest({
    slots: ['QB', 'RB'],
    current: [locked, safe],
    roster: [locked, safe, boom],
    opp, elig: ELIG, minGain: 0.02,
    altSeeds: [[locked, boom]],
  });
  assert.equal(out.show, true);
  assert.equal(out.swaps[0].start.key, 'boom');
  assert.ok(out.bestProb + 1e-9 >= winProb([locked, boom], opp));
});

test('live scoring polls every 30 seconds and updates numbers in place', () => {
  const team = fs.readFileSync(path.join(__dirname, '..', 'site', 'team.js'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '..', 'site', 'styles.css'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '..', 'site', 'index.html'), 'utf8');
  assert.match(team, /const LIVE_MS = 30 \* 1000/);
  assert.match(team, /const IDLE_MS = 30 \* 60 \* 1000/);
  assert.match(team, /class="live-pill"/);
  assert.match(team, /class="live-dot"/);
  assert.match(team, /function tickText/);
  assert.match(team, /function patchLive/);
  assert.match(team, /status === 429/);
  assert.match(team, /retry-after/);
  assert.match(team, /if \(gamesAreLive\(\) \|\| age >= IDLE_MS\) refreshLive\(\)\.finally/);
  assert.match(team, /function liveTabOpen/);
  assert.match(team, /state\.view === 'live'/);
  assert.match(team, /visibilityState !== 'hidden'/);
  assert.doesNotMatch(team, /Updated \$\{|ptClock|AM PT|PM PT/);
  assert.match(team, /every 30 seconds/);
  assert.match(team, /every 30 minutes/);
  assert.match(css, /@keyframes live-pulse/);
  assert.match(css, /@keyframes live-tick/);
  assert.match(html, /about every 30 seconds/);
  assert.match(html, /data-view="live"/);
  assert.match(html, /id="view-live"/);
  const results = team.slice(team.indexOf('function renderResults'), team.indexOf('function render('));
  assert.match(results, /id="optimal-lineup"/);
  assert.match(results, /id="openSleeper"/);
  assert.doesNotMatch(results, /id="liveMount"|class="live-pill"|id="winprob-lineup"|Win probability/);
  const live = team.slice(team.indexOf('function renderLive'), team.indexOf('function rosterIds'));
  assert.match(live, /id="liveMount"/);
  assert.match(live, /liveBlock\(A, L\)/);
  assert.match(team, /showLive/);
  assert.match(team, /function adviceIdle/);
  assert.match(team, /all remaining starters are already the safer plays/);
  assert.match(team, /no higher-ceiling swap among players who haven't kicked off/);
  assert.match(team, /Every starter's game has already started/);
  assert.match(team, /adviceLine\(A\)/);
  assert.match(readApp(), /MLTeam\.showLive/);
});

function readApp() {
  return fs.readFileSync(path.join(__dirname, '..', 'site', 'app.js'), 'utf8');
}

test('kickers and defenses stay in the slot they already occupy', () => {
  const k1 = guy('k1', 'K', 8, 3);
  const k2 = guy('k2', 'K', 12, 3);
  const wr = guy('wr', 'WR', 14, 6);
  const out = suggest({
    slots: ['WR', 'K'],
    current: [wr, k1],
    roster: [wr, k1, k2],
    opp: { mean: 10, sd: 4 },
    elig: ELIG,
    minGain: 0,
  });
  assert.ok(!out.swaps.some(s => s.slot === 'K'));
});
