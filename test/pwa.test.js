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
  assert.match(app, /cache: fresh \? 'reload' : 'no-cache'/);
  assert.match(app, /&fresh=1/);
  assert.match(app, /Refreshing…/);
  assert.match(app, /Already up to date/);
  assert.match(app, /ml-refresh-session/);
  assert.match(app, /MLTrade\.restore/);
  assert.match(app, /data\.json/);
  assert.match(app, /market\.json/);
  assert.match(app, /news\.json/);
  assert.match(app, /MLTrade\.ensure\(state\.data\)/);
  assert.match(app, /visible = 'Updated'/);
  assert.doesNotMatch(app, /Updated just now/);
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
  assert.match(sw, /cache: 'reload'/);
  assert.match(sw, /if \(fresh\) throw err/);
  assert.match(sw, /self\.clients\.claim\(\)/);
  assert.match(sw, /key\.startsWith\('ml-shell-'\) && key !== SHELL_CACHE/);
  assert.doesNotMatch(sw, /caches\.delete\(DATA_CACHE\)|caches\.delete\('ml-data'\)/);
});

test('refresh status is a short fading label and data refreshes itself every 30 minutes', () => {
  const app = read('app.js');
  const css = read('styles.css');
  const paint = app.slice(app.indexOf('function paintRefreshStatus'), app.indexOf('function fadeRefreshStatus'));
  assert.match(paint, /visible = 'Refreshing…'/);
  assert.match(paint, /visible = 'Already up to date'/);
  assert.match(paint, /visible = 'Updated'/);
  assert.match(paint, /Couldn't refresh/);
  assert.match(paint, /You're offline/);
  assert.doesNotMatch(paint, /generated|UTC|just now|\\n/);
  assert.match(app, /const REFRESH_HOLD_MS = 4000/);
  assert.match(app, /function fadeRefreshStatus/);
  assert.match(app, /is-fading/);
  assert.match(app, /prefers-reduced-motion: reduce/);
  assert.match(css, /\.refresh-status\.is-fading \{ opacity: 0; \}/);
  assert.doesNotMatch(css, /\.refresh-status \{[^}]*white-space: pre-line/);
  assert.match(app, /const AUTO_MS = 30 \* 60 \* 1000/);
  assert.match(app, /refreshData\(\{ silent: true \}\)/);
  assert.match(app, /document\.addEventListener\('visibilitychange', onVisibility\)/);
  assert.match(app, /document\.hidden/);
  assert.match(app, /function userIsEditing/);
  assert.match(app, /isContentEditable/);
  assert.match(app, /slUser/);
  assert.match(app, /if \(!\(silent && userIsEditing\(\)\)\) renderCurrent\(\)/);
  assert.match(app, /state\.view = view/);
  assert.match(app, /state\.week = week/);
  const auto = app.slice(app.indexOf('async function runAutoRefresh'), app.indexOf('function onVisibility'));
  assert.match(auto, /document\.hidden/);
  assert.match(auto, /userIsEditing\(\)/);
  assert.match(auto, /silent: true/);
  const shown = app.slice(app.indexOf('function onVisibility'), app.indexOf('function bindAutoRefresh'));
  assert.match(shown, /elapsed >= AUTO_MS/);
  assert.match(shown, /clearTimeout\(refreshTimer\)/);
});

test('my team has no copy-link control and still saves and lines up', () => {
  const team = read('team.js');
  const css = read('styles.css');
  assert.doesNotMatch(team, /copyTeamLink|Copy my team link|teamLinkBox|copyMsg|clipboard\.writeText|execCommand\('copy'\)/);
  assert.doesNotMatch(team, /team link below|Bookmark it or add it to your Home Screen/);
  assert.doesNotMatch(css, /\.keep-row|\.keep-link|\.btn\.sm/);
  assert.match(team, /saved-strip/);
  assert.match(team, /function rememberTeam/);
  assert.match(team, /function openFromHash/);
  assert.match(team, /Optimal Week/);
  assert.match(team, /id="teamSel"/);
});

test('defense headers stick below the app chrome and the team column sticks left', () => {
  const css = read('styles.css');
  const block = css.slice(css.indexOf('Defense table'), css.indexOf('Method'));
  assert.match(block, /\.main:has\(#view-defense:not\(\[hidden\]\)\)/);
  assert.match(block, /overflow:\s*hidden/);
  assert.match(block, /#view-defense \.table-wrap[\s\S]*overflow:\s*auto/);
  assert.match(block, /\.deftable thead th \{[^}]*position:\s*sticky;[^}]*top:\s*0;[^}]*background-color:\s*var\(--color-surface-2\)/);
  assert.match(block, /\.deftable tbody td:first-child \{[^}]*position:\s*sticky;[^}]*left:\s*0;[^}]*background-color:\s*var\(--color-surface\)/);
  assert.match(block, /\.deftable thead th:first-child \{[^}]*z-index:\s*3;[^}]*background-color:\s*var\(--color-surface-2\)/);
  assert.doesNotMatch(block, /background(?:-color)?:\s*(?:transparent|#0b3d24|#f5c518)/i);
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
