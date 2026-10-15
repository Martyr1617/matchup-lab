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
  assert.match(sw, /data\|market/);
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

test('the page registers the worker and declares an iOS icon', () => {
  const html = read('index.html');
  assert.match(html, /viewport-fit=cover/);
  assert.match(html, /rel="manifest"/);
  assert.match(html, /apple-touch-icon\.png" sizes="180x180"/);
  assert.match(html, /apple-mobile-web-app-capable" content="yes"/);
  assert.match(html, /apple-mobile-web-app-status-bar-style" content="black-translucent"/);
  assert.match(html, /apple-mobile-web-app-title" content="Matchup Lab"/);
  assert.match(html, /serviceWorker\.register\('sw\.js'\)/);
  assert.match(html, /rel="icon" href="icon\.svg"/);
  assert.doesNotMatch(html, /ellipse/);
  const css = read('styles.css');
  assert.match(css, /safe-area-inset-top/);
  assert.match(css, /safe-area-inset-bottom/);
  assert.match(css, /safe-area-inset-left/);
  assert.match(css, /safe-area-inset-right/);
});
