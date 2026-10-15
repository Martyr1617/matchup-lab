const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('path');

const site = path.join(__dirname, '..', 'site');
const read = name => fs.readFileSync(path.join(site, name), 'utf8');

function rgb(h) {
  const x = h.replace('#', '');
  return [parseInt(x.slice(0, 2), 16), parseInt(x.slice(2, 4), 16), parseInt(x.slice(4, 6), 16)];
}
function lum(c) {
  const f = v => {
    v /= 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = c.map(f);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a, b) {
  const hi = Math.max(lum(rgb(a)), lum(rgb(b)));
  const lo = Math.min(lum(rgb(a)), lum(rgb(b)));
  return (hi + 0.05) / (lo + 0.05);
}

test('settings cog, pre-paint boot, and 32 team themes are wired', () => {
  const html = read('index.html');
  const app = read('app.js');
  const css = read('themes.css');
  const icon = read('icon.svg');
  assert.match(html, /id="settingsBtn"/);
  assert.match(html, /aria-haspopup="dialog"/);
  assert.match(html, /aria-controls="settingsDialog"/);
  assert.match(html, /id="settingsDialog"[\s\S]*role="dialog"/);
  assert.match(html, /aria-modal="true"/);
  assert.match(html, /data-appearance="light"/);
  assert.match(html, /data-appearance="dark"/);
  assert.match(html, /data-appearance="system"/);
  assert.match(html, /id="theme-boot"/);
  assert.match(html, /localStorage\.getItem\(KEY_A\)/);
  assert.match(html, /ml-appearance/);
  assert.match(html, /ml-team/);
  assert.match(html, /prefers-color-scheme: dark/);
  assert.match(html, /meta\[name="theme-color"\]/);
  assert.match(html, /themes\.css/);
  assert.match(app, /function openSettings/);
  assert.match(app, /e\.key === 'Escape'/);
  assert.match(app, /localStorage\.setItem\(APPEAR_KEY/);
  assert.match(app, /addEventListener\('change', onScheme\)/);
  assert.doesNotMatch(app, /themeToggle/);
  assert.doesNotMatch(html, /team-logo|nfl-logo/i);
  assert.doesNotMatch(app, /<img[^>]+theme/i);
  assert.match(icon, /#0B3D24/);
  assert.match(icon, /#F5C518/);
  assert.match(read('sw.js'), /themes\.css/);
  const themes = JSON.parse(html.match(/var THEMES = (\[[\s\S]*?\]);/)[1]);
  assert.equal(themes.length, 33);
  assert.equal(themes[0].id, 'ml');
  assert.equal(themes[0].name, 'Matchup Lab');
  const clubs = themes.filter(t => t.id !== 'ml');
  assert.equal(clubs.length, 32);
  const divisions = new Set(clubs.map(t => t.division));
  for (const name of ['AFC East', 'AFC North', 'AFC South', 'AFC West', 'NFC East', 'NFC North', 'NFC South', 'NFC West']) {
    assert.ok(divisions.has(name), name);
  }
  for (const t of clubs) {
    assert.match(t.primary, /^#[0-9a-f]{6}$/);
    assert.match(t.secondary, /^#[0-9a-f]{6}$/);
    assert.ok(!/logo/i.test(t.name));
    for (const mode of ['light', 'dark']) {
      const block = css.match(new RegExp('html\\[data-team="' + t.id + '"\\]\\[data-theme="' + mode + '"\\] \\{([^}]+)\\}'));
      assert.ok(block, t.id + ' ' + mode);
      const tok = Object.fromEntries([...block[1].matchAll(/(--[\w-]+):\s*([^;]+);/g)].map(m => [m[1], m[2].trim()]));
      assert.equal(tok['--color-bg'], t.chrome[mode], t.id + ' ' + mode + ' chrome');
      const pairs = [
        [tok['--color-text'], tok['--color-surface']],
        [tok['--color-text-muted'], tok['--color-surface-2']],
        [tok['--color-text-faint'], tok['--color-surface']],
        [tok['--color-gold'], tok['--color-surface']],
        [tok['--color-gold-ink'], tok['--color-gold']],
        [tok['--color-primary-ink'], tok['--color-primary']],
        [tok['--color-on-header'], tok['--color-field-deep']],
        [tok['--color-on-header-muted'], tok['--color-field-deep']],
        [tok['--color-floor'], tok['--color-surface']],
        [tok['--color-ceil'], tok['--color-surface']],
        [tok['--color-good'], tok['--color-surface']],
        [tok['--color-bad'], tok['--color-surface']],
        [tok['--color-link'], tok['--color-surface']],
      ];
      for (const [fg, bg] of pairs) {
        const ratio = contrast(fg, bg);
        assert.ok(ratio >= 4.5, `${t.id} ${mode} ${fg} on ${bg} = ${ratio.toFixed(2)}`);
      }
      assert.ok(contrast(tok['--chart-line'], tok['--color-surface']) >= 3, t.id + ' chart');
    }
  }
});
