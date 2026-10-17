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
function chroma(hex) {
  const [r, g, b] = rgb(hex).map(v => v / 255);
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  return mx === 0 ? 0 : (mx - mn) / mx;
}
function channelDist(a, b) {
  const ca = rgb(a);
  const cb = rgb(b);
  return Math.hypot(ca[0] - cb[0], ca[1] - cb[1], ca[2] - cb[2]);
}
function hueDeg(hex) {
  const [r, g, b] = rgb(hex).map(v => v / 255);
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  if (mx - mn < 0.06) return null;
  const d = mx - mn;
  let h;
  if (mx === r) h = ((g - b) / d) % 6;
  else if (mx === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return h * 60;
}
function hueClose(a, b) {
  const ha = hueDeg(a);
  const hb = hueDeg(b);
  if (ha == null || hb == null) return channelDist(a, b) < 36;
  const d = Math.abs(ha - hb);
  return Math.min(d, 360 - d) <= 32;
}
const DEFAULT_ACCENTS = new Set([
  '#0b3d24', '#062016', '#0a2e1d', '#04140d', '#123d28', '#184a32', '#1f5a3c',
  '#0c2619', '#123221', '#173e29', '#24563c', '#1a4630', '#2f6d4c',
  '#1c4a28', '#16381f', '#1c4d34', '#163528', '#3d3410', '#3a3012',
  '#f5c518', '#ffd84a', '#1a1402', '#b7e4c7', '#c6f5a8',
]);

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
      assert.ok(contrast(tok['--color-good'], tok['--color-good-bg']) >= 4.5, t.id + ' ' + mode + ' good pill');
      assert.ok(contrast(tok['--color-bad'], tok['--color-bad-bg']) >= 4.5, t.id + ' ' + mode + ' bad pill');
      assert.ok(contrast(tok['--color-warn'], tok['--color-warn-bg']) >= 4.5, t.id + ' ' + mode + ' warn pill');
      assert.ok(contrast(tok['--color-text'], tok['--color-bg']) >= 4.5, t.id + ' ' + mode + ' text on page');
      assert.ok(contrast(tok['--color-gold'], tok['--color-bg']) >= 4.5, t.id + ' ' + mode + ' accent on page');
      for (const [left, right] of [
        ['--color-good', '--color-bad'],
        ['--color-good', '--color-warn'],
        ['--color-bad', '--color-warn'],
        ['--color-good', '--color-gold'],
        ['--color-bad', '--color-gold'],
        ['--color-warn', '--color-gold'],
      ]) {
        const fg = tok[left];
        const bg = tok[right];
        const distinct = !hueClose(fg, bg) || contrast(fg, bg) >= 1.45;
        assert.ok(distinct, `${t.id} ${mode} ${left} blends into ${right}`);
      }
      const flat = Object.values(tok).join(' ').toLowerCase();
      for (const h of flat.match(/#[0-9a-f]{6}/g) || []) {
        assert.ok(!DEFAULT_ACCENTS.has(h), `${t.id} ${mode} still uses default accent ${h}`);
      }
      assert.ok(!/rgba\(\s*245\s*,\s*197\s*,\s*24/.test(flat), t.id + ' chart still uses default gold');
      const seedC = Math.max(chroma(t.primary), chroma(t.secondary));
      if (seedC >= 0.12) {
        assert.ok(chroma(tok['--color-bg']) >= 0.18, `${t.id} ${mode} page is barely tinted (${chroma(tok['--color-bg']).toFixed(2)})`);
        assert.ok(chroma(tok['--color-surface']) >= 0.18, `${t.id} ${mode} cards are barely tinted`);
      } else {
        assert.ok(channelDist(tok['--color-gold'], t.secondary) < 80, `${t.id} ${mode} accent left the secondary swatch`);
      }
    }
    assert.ok(
      lum(rgb(css.match(new RegExp('html\\[data-team="' + t.id + '"\\]\\[data-theme="light"\\] \\{([^}]+)\\}'))[1].match(/--color-bg:\s*([^;]+)/)[1].trim()))
        > lum(rgb(css.match(new RegExp('html\\[data-team="' + t.id + '"\\]\\[data-theme="dark"\\] \\{([^}]+)\\}'))[1].match(/--color-bg:\s*([^;]+)/)[1].trim())),
      t.id + ' light field should be brighter than dark',
    );
  }
});

test('component colors follow the theme instead of a hard-coded green or gold', () => {
  const css = read('styles.css');
  const splash = css.slice(css.indexOf('Opening splash'), css.indexOf('Settings'));
  assert.doesNotMatch(splash, /#0b3d24|#062016|#f5c518|#ffd84a|#f7f4ea/i);
  const rules = css.slice(css.indexOf('Base'));
  const leaked = rules.match(/#(?:0b3d24|062016|0a2e1d|04140d|f5c518|ffd84a|b7e4c7)/gi);
  assert.equal(leaked, null, 'stylesheet rules still hard-code ' + leaked);
});
