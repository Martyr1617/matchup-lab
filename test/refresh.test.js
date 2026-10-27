const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const site = path.join(__dirname, '..', 'site');
const read = name => fs.readFileSync(path.join(site, name), 'utf8');

test('the refresh button reloads the Sleeper roster instead of redrawing memory', () => {
  const app = read('app.js');
  const team = read('team.js');
  const refresh = app.slice(app.indexOf('async function refreshData'), app.indexOf('function bindRefresh'));
  assert.match(refresh, /await window\.MLTeam\.reload\(\)/);
  assert.match(refresh, /fillWeeks\(true\)/);
  assert.match(refresh, /roster === 'league'/);
  assert.match(refresh, /visible = 'Updated'|mode\)/);
  assert.match(app, /visible = 'Refreshing…'/);
  assert.match(app, /visible = 'Updated'/);
  assert.match(team, /async function reloadLeague/);
  assert.match(team, /cache: 'reload'/);
  assert.match(team, /'_='/);
  assert.match(team, /reload: reloadLeague/);
  assert.match(team, /league\/\$\{leagueId\}\/rosters/);
  assert.match(team, /league\/\$\{leagueId\}\/users/);
  assert.match(team, /matchups\/\$\{week\}/);
  // The saved-team record is the route back to the league, not a stored lineup.
  assert.doesNotMatch(team, /localStorage\.(get|set)Item\([^)]*starter/);
  assert.match(team, /never a roster/);
});

test('reload replaces starters from an uncached roster response and keeps the route', async () => {
  const calls = [];
  let starters = ['111'];
  const store = {};
  // A stale roster parked in localStorage must not be where the lineup comes from.
  store['ml-roster'] = JSON.stringify({ starters: ['999'] });
  const json = body => ({
    ok: true,
    status: 200,
    headers: { get() { return null; } },
    json: async () => body,
  });
  function fetch(url, opts) {
    const u = String(url);
    calls.push({ url: u, cache: opts && opts.cache, credentials: opts && opts.credentials });
    if (u.includes('/user/') && !u.includes('/leagues/')) return Promise.resolve(json({ user_id: 'u1', username: 'joedolan', display_name: 'Joe' }));
    if (u.includes('/leagues/nfl/')) return Promise.resolve(json([]));
    if (u.includes('/rosters')) {
      return Promise.resolve(json([{
        roster_id: 1, owner_id: 'u1', players: ['111', '222'], starters: starters.slice(), reserve: [], taxi: [],
      }]));
    }
    if (u.includes('/users')) return Promise.resolve(json([{ user_id: 'u1', display_name: 'Joe', metadata: { team_name: 'Faheyyy' } }]));
    if (u.includes('/matchups/')) {
      return Promise.resolve(json([{ roster_id: 1, matchup_id: 3, points: 1, players_points: {}, starters: starters.slice(), starters_points: [1] }]));
    }
    if (u.includes('/scores/')) return Promise.resolve(json([]));
    if (u.includes('/league/')) return Promise.resolve(json({ name: 'Lowcountry Legends', roster_positions: ['QB', 'BN'], scoring_settings: { rec: 0.5 } }));
    return Promise.reject(new Error('unexpected ' + u));
  }
  const sandbox = {
    console,
    fetch,
    setTimeout() { return 0; },
    clearTimeout() {},
    encodeURIComponent,
    decodeURIComponent,
    URL,
    Date,
    document: {
      addEventListener() {},
      querySelector() { return null; },
      querySelectorAll() { return []; },
      visibilityState: 'visible',
      hidden: false,
    },
    location: {
      hash: '#team=sleeper/joedolan/1389720497964466176/1',
      pathname: '/matchup-lab/',
      search: '',
    },
    history: {
      replaceState(_s, _t, url) {
        if (typeof url === 'string' && url.startsWith('#')) sandbox.location.hash = url;
      },
    },
    localStorage: {
      getItem(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
      setItem(k, v) { store[k] = String(v); },
      removeItem(k) { delete store[k]; },
    },
    navigator: { onLine: true, userAgent: 'test', storage: null },
    MLLineup: {
      ELIG: {},
      slotsFromSleeper(pos) { return (pos || []).filter(s => s !== 'BN' && s !== 'IR' && s !== 'TAXI'); },
      slotsFromEspn() { return []; },
      optimize() { return { assigned: [] }; },
      separateSameTeamQbs(x) { return x; },
      sleeperTeamLinks() { return { web: 'https://sleeper.com' }; },
      sleeperOpenPlan() { return null; },
    },
    MLWinProb: {
      phaseFromScore() { return { status: 'yet', label: 'Yet to play', fraction: 1 }; },
      sideOf() { return { mean: 0, sd: 0, live: 0 }; },
      suggest() { return { show: false, swaps: [] }; },
    },
  };
  sandbox.window = sandbox;
  sandbox.ML = {
    state: {
      week: 8,
      view: 'board',
      scoring: 'half',
      data: {
        meta: { season: 2026, next_week: 8 },
        players: [
          { id: 'a', name: 'First Start', pos: 'QB', team: 'CHI', ids: { sl: '111' }, ppr_pg: 10 },
          { id: 'b', name: 'New Start', pos: 'QB', team: 'CHI', ids: { sl: '222' }, ppr_pg: 12 },
        ],
        team_names: { CHI: 'Chicago Bears' },
        schedule: { 8: [{ home: 'CHI', away: 'GB', date: '2026-10-30', time: '13:00' }] },
      },
    },
    setView(v) { this.state.view = v; },
    esc(s) { return String(s == null ? '' : s); },
    tn(s) { return s; },
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(site, 'team.js'), 'utf8'), sandbox, { filename: 'team.js' });
  await sandbox.MLTeam.init();
  const team = () => sandbox.MLTeam._T.league.teams.find(t => t.id === '1');
  assert.equal(team().currentSlots[0].key, 'sl:111');
  const first = calls.filter(c => c.url.includes('/rosters'));
  assert.equal(first.length, 1);
  assert.equal(first[0].cache, 'reload');
  assert.match(first[0].url, /[?&]_=\d+/);

  starters = ['222'];
  const before = calls.length;
  const result = await sandbox.MLTeam.reload();
  assert.equal(result, 'league');
  assert.equal(team().currentSlots.map(c => c.key).join(','), 'sl:222');
  assert.equal(sandbox.MLTeam._T.teamId, '1');
  assert.match(sandbox.location.hash, /1389720497964466176\/1/);
  const again = calls.slice(before).filter(c => c.url.includes('/rosters'));
  assert.equal(again.length, 1);
  assert.equal(again[0].cache, 'reload');
  assert.match(again[0].url, /[?&]_=\d+/);
  assert.notEqual(again[0].url, first[0].url);
  const saved = JSON.stringify(store);
  assert.doesNotMatch(saved, /"starters":\["222"\]/);
  assert.match(saved, /ml-roster/);
  assert.equal(JSON.parse(store['ml-roster']).starters[0], '999');
});
