const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const team = fs.readFileSync(path.join(__dirname, '..', 'site', 'team.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '..', 'site', 'styles.css'), 'utf8');

test('the live tab can switch every league for the Sleeper user', () => {
  assert.match(team, /matchuplab\.liveLeague\.v1/);
  assert.match(team, /function liveSwitcher/);
  assert.match(team, /function selectLiveLeague/);
  assert.match(team, /function ensureLivePacks/);
  assert.match(team, /class="live-league/);
  assert.match(team, /data-lid=/);
  assert.match(team, /aria-label="Your leagues"/);
  const choose = team.slice(team.indexOf('function selectLiveLeague'), team.indexOf('async function ensureLivePacks'));
  assert.doesNotMatch(choose, /location\.reload/);
  assert.match(choose, /T\.league = p\.league/);
  assert.match(choose, /setHash\(\)/);
  assert.match(team, /const bestBall = !!\(lg\.settings && Number\(lg\.settings\.best_ball\) === 1\)/);
  assert.match(team, /reason: 'bestball'/);
  assert.match(team, /Lineup is set automatically \(best ball\)/);
  assert.match(team, /league\/\$\{p\.id\}\/matchups\/\$\{week\}/);
  assert.match(css, /\.live-switch \{[^}]*overflow-x: auto/);
  assert.match(css, /\.live-league \{[^}]*min-height: 44px/);
});
