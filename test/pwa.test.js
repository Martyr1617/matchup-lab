const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const site = path.join(__dirname, '..', 'site');
const read = name => fs.readFileSync(path.join(site, name), 'utf8');

test('manifest is installable at the GitHub Pages subpath', () => {
  const manifest = JSON.parse(read('manifest.webmanifest'));
  assert.equal(manifest.name, 'Matchup Lab');
  assert.equal(manifest.short_name, 'Matchup Lab');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.start_url, '/matchup-lab/');
  assert.equal(manifest.scope, '/matchup-lab/');
  assert.equal(manifest.theme_color, '#0b3d24');
  assert.equal(manifest.background_color, '#04140d');
  assert.ok(manifest.start_url.startsWith(manifest.scope));
  const icons = Object.fromEntries(manifest.icons.map(icon => [icon.purpose + ':' + icon.sizes, icon.src]));
  assert.equal(icons['any:192x192'], '/matchup-lab/icon-192.png');
  assert.equal(icons['any:512x512'], '/matchup-lab/icon-512.png');
  assert.equal(icons['maskable:512x512'], '/matchup-lab/icon-512-maskable.png');
  for (const file of ['icon-192.png', 'icon-512.png', 'icon-512-maskable.png', 'apple-touch-icon.png']) {
    const bytes = fs.statSync(path.join(site, file)).size;
    assert.ok(bytes > 500, file);
  }
});

test('service worker versions the shell and prefers fresh projection files', () => {
  const sw = read('sw.js');
  assert.match(sw, /const VER = '[0-9a-f]{10}';/);
  assert.match(sw, /const SHELL_CACHE = 'ml-shell-' \+ VER;/);
  assert.match(sw, /const DATA_CACHE = 'ml-data';/);
  assert.match(sw, /function isProjectionData/);
  assert.match(sw, /data\|market\|news/);
  assert.match(read('index.html'), /data-view="news"/);
  assert.match(read('app.js'), /news\.json/);
  assert.match(sw, /async function networkFirstData/);
  assert.doesNotMatch(sw, /caches\.match\(request\)[\s\S]{0,80}data\.json/);
  const dataFn = sw.slice(sw.indexOf('async function networkFirstData'), sw.indexOf('async function fromShell'));
  assert.match(dataFn, /await fetch\(request\)/);
  assert.match(dataFn, /cache\.put\(stable/);
  assert.match(dataFn, /cache\.match\(stable\)/);
  assert.doesNotMatch(sw, /icon-options/);
  assert.doesNotMatch(read('index.html'), /icon-options/);
  assert.equal(fs.existsSync(path.join(site, 'icon-options')), false);
});

test('news and trade sit immediately after my team', () => {
  const html = read('index.html');
  const nav = html.slice(html.indexOf('<nav class="tabs"'), html.indexOf('</nav>'));
  const views = [...nav.matchAll(/data-view="([^"]+)"/g)].map(m => m[1]);
  assert.deepEqual(views, ['board', 'team', 'news', 'trade', 'player', 'compare', 'defense', 'method']);
  assert.match(nav, /class="tab is-active" data-view="board"/);
});

test('the header refresh button updates data in place and can activate a waiting worker', () => {
  const html = read('index.html');
  const controls = html.slice(html.indexOf('<div class="controls">'), html.indexOf('</header>'));
  const refreshAt = controls.indexOf('id="refreshBtn"');
  const settingsAt = controls.indexOf('id="settingsBtn"');
  assert.ok(refreshAt > 0 && settingsAt > refreshAt);
  assert.match(controls, /aria-label="Refresh data"/);
  assert.match(controls, /id="refreshStatus" class="refresh-status" role="status" aria-live="polite"/);
  const css = read('styles.css');
  assert.match(css, /\.icon-btn \{[^}]*width: 44px;[^}]*height: 44px/);
  assert.match(css, /#refreshBtn\[aria-busy="true"\] svg \{ animation: ml-spin/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  const app = read('app.js');
  assert.match(app, /cache: fresh \? 'no-store' : 'no-cache'/);
  assert.match(app, /&fresh=1/);
  assert.match(app, /data\.json/);
  assert.match(app, /market\.json/);
  assert.match(app, /news\.json/);
  assert.match(app, /MLTrade\.ensure\(state\.data\)/);
  assert.match(app, /Updated just now/);
  assert.match(app, /Couldn't refresh/);
  assert.match(app, /You're offline/);
  assert.match(app, /state\.view = view/);
  assert.match(app, /fillWeeks\(true\)/);
  assert.match(app, /type: 'SKIP_WAITING'/);
  assert.match(html, /updateViaCache: 'none'/);
  assert.doesNotMatch(app, /pull-to-refresh|touchstart[\s\S]{0,80}refreshData/);
  const sw = read('sw.js');
  assert.match(sw, /if \(type === 'SKIP_WAITING'\) self\.skipWaiting\(\)/);
  assert.match(sw, /if \(!self\.registration\.active\) self\.skipWaiting\(\)/);
  assert.match(sw, /searchParams\.has\('fresh'\)/);
  assert.match(sw, /if \(fresh\) throw err/);
  assert.match(sw, /self\.clients\.claim\(\)/);
  assert.match(sw, /key\.startsWith\('ml-shell-'\) && key !== SHELL_CACHE/);
  assert.doesNotMatch(sw, /caches\.delete\(DATA_CACHE\)|caches\.delete\('ml-data'\)/);
});

test('the page registers the worker and declares an iOS icon', () => {
  const html = read('index.html');
  assert.match(html, /viewport-fit=cover/);
  assert.match(html, /rel="manifest"/);
  assert.match(html, /apple-touch-icon\.png" sizes="180x180"/);
  assert.match(html, /apple-mobile-web-app-capable" content="yes"/);
  assert.match(html, /apple-mobile-web-app-status-bar-style" content="black-translucent"/);
  assert.match(html, /apple-mobile-web-app-title" content="Matchup Lab"/);
  assert.match(html, /serviceWorker\.register\('sw\.js'/);
  assert.match(html, /rel="icon" href="icon\.svg"/);
  assert.doesNotMatch(html, /ellipse/);
  const css = read('styles.css');
  assert.match(css, /safe-area-inset-top/);
  assert.match(css, /safe-area-inset-bottom/);
  assert.match(css, /safe-area-inset-left/);
  assert.match(css, /safe-area-inset-right/);
});
