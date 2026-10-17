const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const site = path.join(__dirname, '..', 'site');
const read = name => fs.readFileSync(path.join(site, name), 'utf8');

test('every team has one text chant and the splash uses it', () => {
  const chants = JSON.parse(read('chants.json'));
  const js = read('chants.js');
  const inline = JSON.parse(js.slice(js.indexOf('{'), js.lastIndexOf('}') + 1));
  assert.deepEqual(inline, chants);
  const html = read('index.html');
  const themes = JSON.parse(html.match(/var THEMES = (\[[\s\S]*?\]);/)[1]);
  const clubs = themes.filter(t => t.id !== 'ml').map(t => t.id);
  assert.equal(clubs.length, 32);
  assert.equal(Object.keys(chants).length, 33);
  assert.equal(chants.ml, 'MATCHUP LAB');
  for (const id of clubs) {
    assert.equal(typeof chants[id], 'string', id);
    assert.ok(chants[id].trim().length > 1, id);
    assert.ok(!/logo|redskin/i.test(chants[id]), id);
  }
  assert.equal(chants.gb, 'GO PACK GO');
  assert.equal(chants.min, 'SKOL');
  assert.equal(chants.phi, 'FLY EAGLES FLY');
  assert.equal(chants.no, 'WHO DAT');
  assert.match(html, /id="splash"/);
  assert.match(html, /id="splashChant"/);
  assert.match(html, /id="splashMark"/);
  assert.match(html, /src="chants.js/);
  assert.match(html, /ml-splash-shown/);
  assert.match(html, /setTimeout\(hide, reduce \? 500 : 1700\)/);
  assert.match(html, /e\.key === 'Escape'/);
  assert.match(html, /id="splashSkip"/);
  assert.match(html, /id="splashToggle"/);
  assert.match(html, /id="splashSoundToggle"/);
  assert.match(html, /Splash sound/);
  assert.match(html, /id="splashCredits"/);
  assert.match(read('styles.css'), /@keyframes splash-in/);
  assert.match(read('styles.css'), /html\[data-splash="off"\] \.splash/);
  assert.match(read('sw.js'), /chants\.js/);
  const app = read('app.js');
  assert.match(app, /function initSplash/);
  assert.match(app, /OfflineAudioContext/);
  assert.match(app, /audio\/chants\//);
  assert.match(app, /display-mode: standalone/);
  assert.match(app, /audio\.volume = 0\.4/);
  assert.match(app, /ml-splash-sound/);
  assert.match(app, /localStorage\.getItem\(key\) !== '0'/);
  assert.doesNotMatch(app, /speechSynthesis/);
  assert.doesNotMatch(app, /initSplash\(\)[\s\S]{0,80}refreshData|refreshData[\s\S]{0,200}initSplash/);
  const refresh = app.slice(app.indexOf('async function refreshData'), app.indexOf('function bindRefresh'));
  assert.doesNotMatch(refresh, /splash|ml-splash/);
});
