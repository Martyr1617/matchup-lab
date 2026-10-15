"""Build per-team light/dark CSS variables and the pre-paint theme catalog.

Official club colors are the swatch. Button ink, text, and chart lines are
shifted only when the raw color would miss WCAG AA (4.5:1) on its surface.
"""
import json
import pathlib
import re

ROOT = pathlib.Path(__file__).parent
CSS_PATH = ROOT / 'site' / 'themes.css'
HTML_PATH = ROOT / 'site' / 'index.html'

# id, name, division, primary, secondary. Hex values are the clubs' published colors.
TEAMS = [
    ('buf', 'Buffalo Bills', 'AFC East', '#00338D', '#C60C30'),
    ('mia', 'Miami Dolphins', 'AFC East', '#008E97', '#FC4C02'),
    ('ne', 'New England Patriots', 'AFC East', '#002244', '#C60C30'),
    ('nyj', 'New York Jets', 'AFC East', '#125740', '#000000'),
    ('bal', 'Baltimore Ravens', 'AFC North', '#241773', '#9E7C0C'),
    ('cin', 'Cincinnati Bengals', 'AFC North', '#FB4F14', '#000000'),
    ('cle', 'Cleveland Browns', 'AFC North', '#311D00', '#FF3C00'),
    ('pit', 'Pittsburgh Steelers', 'AFC North', '#FFB612', '#101820'),
    ('hou', 'Houston Texans', 'AFC South', '#03202F', '#A71930'),
    ('ind', 'Indianapolis Colts', 'AFC South', '#002C5F', '#A2AAAD'),
    ('jax', 'Jacksonville Jaguars', 'AFC South', '#006778', '#D7A22A'),
    ('ten', 'Tennessee Titans', 'AFC South', '#0C2340', '#4B92DB'),
    ('den', 'Denver Broncos', 'AFC West', '#FB4F14', '#002244'),
    ('kc', 'Kansas City Chiefs', 'AFC West', '#E31837', '#FFB81C'),
    ('lv', 'Las Vegas Raiders', 'AFC West', '#000000', '#A5ACAF'),
    ('lac', 'Los Angeles Chargers', 'AFC West', '#0080C6', '#FFC20E'),
    ('dal', 'Dallas Cowboys', 'NFC East', '#003594', '#869397'),
    ('nyg', 'New York Giants', 'NFC East', '#0B2265', '#A71930'),
    ('phi', 'Philadelphia Eagles', 'NFC East', '#004C54', '#A5ACAF'),
    ('was', 'Washington Commanders', 'NFC East', '#5A1414', '#FFB612'),
    ('chi', 'Chicago Bears', 'NFC North', '#0B162A', '#C83803'),
    ('det', 'Detroit Lions', 'NFC North', '#0076B6', '#B0B7BC'),
    ('gb', 'Green Bay Packers', 'NFC North', '#203731', '#FFB612'),
    ('min', 'Minnesota Vikings', 'NFC North', '#4F2683', '#FFC62F'),
    ('atl', 'Atlanta Falcons', 'NFC South', '#A71930', '#000000'),
    ('car', 'Carolina Panthers', 'NFC South', '#0085CA', '#101820'),
    ('no', 'New Orleans Saints', 'NFC South', '#D3BC8D', '#101820'),
    ('tb', 'Tampa Bay Buccaneers', 'NFC South', '#D50A0A', '#FF7900'),
    ('ari', 'Arizona Cardinals', 'NFC West', '#97233F', '#FFB612'),
    ('lar', 'Los Angeles Rams', 'NFC West', '#003594', '#FFA300'),
    ('sf', 'San Francisco 49ers', 'NFC West', '#AA0000', '#B3995D'),
    ('sea', 'Seattle Seahawks', 'NFC West', '#002244', '#69BE28'),
]

ML = {
    'id': 'ml',
    'name': 'Matchup Lab',
    'division': '',
    'primary': '#0B3D24',
    'secondary': '#F5C518',
    'chrome': {'light': '#0a2e1d', 'dark': '#04140d'},
}


def rgb(h):
    h = h.lstrip('#')
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def hex_of(c):
    return '#{:02x}{:02x}{:02x}'.format(*(max(0, min(255, round(v))) for v in c))


def mix(a, b, t):
    return tuple(a[i] * (1 - t) + b[i] * t for i in range(3))


def lum(c):
    def f(v):
        v = v / 255
        return v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4
    r, g, b = (f(x) for x in c)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def contrast(a, b):
    la, lb = lum(rgb(a) if isinstance(a, str) else a), lum(rgb(b) if isinstance(b, str) else b)
    hi, lo = max(la, lb), min(la, lb)
    return (hi + 0.05) / (lo + 0.05)


def toward(color, target, bg, minimum, cap=0.92):
    """Move color toward target until it clears `minimum` against bg."""
    if contrast(color, bg) >= minimum:
        return color
    best = color
    for i in range(1, 41):
        t = min(cap, i / 40)
        c = hex_of(mix(rgb(color), rgb(target) if isinstance(target, str) else target, t))
        best = c
        if contrast(c, bg) >= minimum:
            return c
    return best


def ink_for(fill):
    dark, light = '#14120e', '#f7f4ea'
    return dark if contrast(fill, dark) >= contrast(fill, light) else light


def clamp_lum(color, max_lum=None, min_lum=None):
    c = rgb(color)
    if max_lum is not None and lum(c) > max_lum:
        for i in range(1, 41):
            nxt = mix(c, (4, 5, 7), i / 40)
            if lum(nxt) <= max_lum:
                return hex_of(nxt)
        return hex_of(mix(c, (4, 5, 7), 1))
    if min_lum is not None and lum(c) < min_lum:
        for i in range(1, 41):
            nxt = mix(c, (255, 252, 246), i / 40)
            if lum(nxt) >= min_lum:
                return hex_of(nxt)
        return hex_of(mix(c, (255, 252, 246), 1))
    return color


def channel_dist(a, b):
    return sum((rgb(a)[i] - rgb(b)[i]) ** 2 for i in range(3)) ** 0.5


def hue_deg(color):
    r, g, b = (v / 255 for v in rgb(color))
    mx, mn = max(r, g, b), min(r, g, b)
    if mx - mn < 0.06:
        return None
    d = mx - mn
    if mx == r:
        h = ((g - b) / d) % 6
    elif mx == g:
        h = (b - r) / d + 2
    else:
        h = (r - g) / d + 4
    return h * 60


def hue_close(a, b):
    ha, hb = hue_deg(a), hue_deg(b)
    if ha is None or hb is None:
        return channel_dist(a, b) < 36
    d = abs(ha - hb)
    return min(d, 360 - d) <= 32


def pick_button(primary, secondary, surface, light):
    """Keep the team hue. A very dark primary on a dark surface yields to the secondary."""
    order = (primary, secondary)
    if not light and lum(rgb(primary)) < 0.08:
        order = (secondary, primary)
    for seed in order:
        fill, ink = readable_fill(seed, surface)
        if hue_close(fill, seed) and contrast(fill, surface) >= 2.0 and contrast(fill, ink) >= 4.5:
            return fill, ink
    return readable_fill(order[0], surface)


def readable_fill(fill, surface, minimum=4.5):
    """Keep the team hue, but darken or lighten until some ink clears AA."""
    # 3:1 against the surface keeps a pale gold or silver from disappearing into the page.
    dark, light = '#14120e', '#f7f4ea'
    if contrast(fill, dark) >= minimum and contrast(fill, surface) >= 3.0:
        return fill, dark
    if contrast(fill, light) >= minimum and contrast(fill, surface) >= 3.0:
        return fill, light
    dark_try = toward(fill, '#100e0c', surface, 3.0)
    # Search a darker fill whose white ink passes, staying as close as possible.
    best = None
    for i in range(0, 41):
        c = hex_of(mix(rgb(fill), (12, 10, 8), i / 40))
        if contrast(c, '#f7f4ea') >= minimum:
            best = (c, '#f7f4ea')
            break
    if best and contrast(best[0], surface) >= 1.5:
        return best
    for i in range(0, 41):
        c = hex_of(mix(rgb(fill), (255, 252, 245), i / 40))
        if contrast(c, '#14120e') >= minimum:
            return c, '#14120e'
    return dark_try, '#f7f4ea'


def text_on(bg, seed, minimum=4.5, light_mode=True):
    target = '#14120e' if light_mode else '#f7f4ea'
    return toward(seed, target, bg, minimum, cap=0.96)


def palette(primary, secondary, light):
    p, s = rgb(primary), rgb(secondary)
    if light:
        bg = clamp_lum(hex_of(mix((248, 246, 241), p, 0.05)), min_lum=0.86)
        surface = clamp_lum(hex_of(mix((255, 253, 249), p, 0.03)), min_lum=0.90)
        surface2 = clamp_lum(hex_of(mix((255, 253, 249), p, 0.08)), min_lum=0.84)
        offset = clamp_lum(hex_of(mix((255, 253, 249), p, 0.13)), min_lum=0.78)
        border = text_on(surface, hex_of(mix((255, 253, 249), p, 0.28)), 1.8, True)
        divider = text_on(surface, hex_of(mix(surface2 and rgb(surface2), p, 0.2)), 1.4, True)
        text = text_on(surface, hex_of(mix((22, 18, 14), p, 0.22)), 7.0, True)
        muted = text_on(surface2, hex_of(mix((54, 46, 36), p, 0.28)), 4.5, True)
        faint = text_on(surface, hex_of(mix((78, 68, 54), p, 0.25)), 4.5, True)
        field = readable_fill(primary, surface)[0]
        field_deep = toward(primary, '#07080a', '#f7f4ea', 8.0, cap=0.88)
        # Header is a deep team color. Foreground must be light.
        on_header = text_on(field_deep, secondary if contrast(secondary, field_deep) >= contrast(primary, field_deep) else primary, 4.5, False)
        on_header = text_on(field_deep, on_header, 4.5, False)
        on_header_muted = text_on(field_deep, hex_of(mix(rgb(on_header), rgb(field_deep), 0.28)), 4.5, False)
        scheme = 'light'
        zebra = offset
    else:
        bg = hex_of(mix((6, 7, 9), p, 0.22))
        surface = hex_of(mix((8, 10, 12), p, 0.34))
        surface2 = hex_of(mix((10, 12, 14), p, 0.46))
        offset = hex_of(mix((12, 14, 16), p, 0.55))
        # Keep surfaces actually dark even for light primaries (gold, silver, aqua).
        bg = clamp_lum(bg, max_lum=0.035)
        surface = clamp_lum(surface, max_lum=0.055)
        surface2 = clamp_lum(surface2, max_lum=0.08)
        if contrast(surface2, surface) < 1.12:
            surface2 = hex_of(mix(rgb(surface), (255, 255, 255), 0.10))
        surface2 = clamp_lum(surface2, max_lum=0.09)
        offset = clamp_lum(hex_of(mix(rgb(surface2), (255, 255, 255), 0.08)), max_lum=0.12)
        border = text_on(surface, hex_of(mix(rgb(surface2), (255, 255, 255), 0.35)), 1.45, False)
        divider = border
        text = text_on(surface, '#f7f4ea', 7.0, False)
        muted = text_on(surface2, '#d9d3c6', 4.5, False)
        faint = text_on(surface, '#c4beb2', 4.5, False)
        field_deep = clamp_lum(hex_of(mix((6, 8, 12), p, 0.78)), max_lum=0.05)
        field = field_deep
        on_header = text_on(field_deep, secondary if lum(s) > lum(p) else primary, 4.5, False)
        on_header_muted = text_on(field_deep, hex_of(mix(rgb(on_header), rgb(field_deep), 0.35)), 4.5, False)
        scheme = 'dark'
        zebra = offset

    # Projection numbers use --color-gold as text. Pills use it as a fill with --color-gold-ink.
    # A mid orange can clear a very dark surface and still fail as a button label, so keep
    # walking toward black or white until both pairs pass.
    accent_seed = secondary if contrast(secondary, surface) >= contrast(primary, surface) else primary
    ink_target = '#f7f4ea' if light else '#14120e'
    text_target = '#14120e' if light else '#f7f4ea'
    gold, gold_ink = text_target, ink_target
    for i in range(0, 41):
        c = hex_of(mix(rgb(accent_seed), rgb(text_target), i / 40))
        if contrast(c, surface) >= 4.5 and contrast(c, bg) >= 4.5 and contrast(c, ink_target) >= 4.5:
            gold, gold_ink = c, ink_target
            break

    btn, btn_ink = pick_button(primary, secondary, surface, light)
    btn_hover = hex_of(mix(rgb(btn), (255, 255, 255) if not light else (0, 0, 0), 0.12))
    if contrast(btn_hover, btn_ink) < 4.5:
        btn_hover = btn

    link = text_on(surface, primary, 4.5, light)
    floor = text_on(surface, secondary if contrast(secondary, gold) > 1.2 else primary, 4.5, light)
    ceil_c = gold
    if contrast(floor, ceil_c) < 1.25:
        floor = text_on(surface, primary, 4.5, light)

    def semantic(hue_dark, hue_light):
        seed = hue_dark if light else hue_light
        color = text_on(surface, seed, 4.5, light)
        bg_c = hex_of(mix(rgb(surface), rgb(color), 0.16 if light else 0.28))
        if contrast(color, bg_c) < 4.5:
            bg_c = hex_of(mix(rgb(surface), rgb(color), 0.10 if light else 0.18))
        if contrast(color, bg_c) < 4.5:
            # Pull the fill back toward the surface until the text clears.
            for i in range(1, 20):
                bg_c = hex_of(mix(rgb(color), rgb(surface), i / 20))
                if contrast(color, bg_c) >= 4.5:
                    break
        return color, bg_c

    good, good_bg = semantic('#0f6b34', '#b7e4c7')
    bad, bad_bg = semantic('#9f1d1d', '#ffb4b4')
    warn, warn_bg = semantic('#8a5a00', '#ffe08a')

    chart_line = text_on(surface, primary, 3.0, light)
    chart_floor = text_on(surface, floor, 3.0, light)
    chart_ceil = text_on(surface, secondary, 3.0, light)
    if contrast(chart_line, chart_ceil) < 1.2:
        chart_ceil = text_on(surface, gold, 3.0, light)
    pr, pg, pb = rgb(chart_line)
    chart_fill = 'rgba(%d, %d, %d, %.2f)' % (pr, pg, pb, 0.20 if light else 0.28)

    highlight = hex_of(mix(rgb(surface), rgb(btn), 0.22))

    return {
        'color-scheme': scheme,
        '--color-bg': bg,
        '--color-surface': surface,
        '--color-surface-2': surface2,
        '--color-surface-offset': offset,
        '--color-border': border,
        '--color-divider': divider,
        '--color-text': text,
        '--color-text-muted': muted,
        '--color-text-faint': faint,
        '--color-field': field,
        '--color-field-deep': field_deep,
        '--color-gold': gold,
        '--color-gold-bright': btn_hover if contrast(btn_hover, gold_ink) >= 4.5 else gold,
        '--color-gold-ink': gold_ink,
        '--color-floor': floor,
        '--color-ceil': ceil_c,
        '--color-primary': btn,
        '--color-primary-hover': btn_hover,
        '--color-primary-highlight': highlight,
        '--color-primary-ink': btn_ink,
        '--color-link': link,
        '--color-on-header': on_header,
        '--color-on-header-muted': on_header_muted,
        '--color-zebra': zebra,
        '--color-good': good,
        '--color-good-bg': good_bg,
        '--color-bad': bad,
        '--color-bad-bg': bad_bg,
        '--color-neutral-bg': offset,
        '--color-warn': warn,
        '--color-warn-bg': warn_bg,
        '--chart-fill': chart_fill,
        '--chart-line': chart_line,
        '--chart-floor': chart_floor,
        '--chart-ceil': chart_ceil,
        '--chart-mean': text,
    }


def css_block(team_id, mode, tokens):
    lines = ['html[data-team="%s"][data-theme="%s"] {' % (team_id, mode)]
    lines.append('  color-scheme: %s;' % tokens['color-scheme'])
    for key, val in tokens.items():
        if key == 'color-scheme':
            continue
        lines.append('  %s: %s;' % (key, val))
    lines.append('}')
    return '\n'.join(lines)


def main():
    blocks = [
        '/* Team themes. Swatches use official club colors. Text, buttons, and charts',
        '   reuse those hues and only shift when a raw color would miss WCAG AA. */',
    ]
    catalog = [ML]
    for tid, name, division, primary, secondary in TEAMS:
        light = palette(primary, secondary, True)
        dark = palette(primary, secondary, False)
        blocks.append(css_block(tid, 'light', light))
        blocks.append(css_block(tid, 'dark', dark))
        catalog.append({
            'id': tid,
            'name': name,
            'division': division,
            'primary': primary.lower(),
            'secondary': secondary.lower(),
            'chrome': {'light': light['--color-bg'], 'dark': dark['--color-bg']},
        })
    CSS_PATH.write_text('\n\n'.join(blocks) + '\n')
    script = (
        '<script id="theme-boot">\n'
        '(function () {\n'
        "  var KEY_A = 'ml-appearance', KEY_T = 'ml-team';\n"
        "  var appearance = 'system', team = 'ml';\n"
        '  try {\n'
        "    appearance = localStorage.getItem(KEY_A) || 'system';\n"
        "    team = localStorage.getItem(KEY_T) || 'ml';\n"
        '  } catch (e) {}\n'
        "  if (appearance !== 'light' && appearance !== 'dark' && appearance !== 'system') appearance = 'system';\n"
        '  var THEMES = %s;\n'
        '  var found = null;\n'
        '  for (var i = 0; i < THEMES.length; i++) if (THEMES[i].id === team) found = THEMES[i];\n'
        "  if (!found) { team = 'ml'; found = THEMES[0]; }\n"
        "  var sysDark = window.matchMedia('(prefers-color-scheme: dark)').matches;\n"
        "  var mode = appearance === 'system' ? (sysDark ? 'dark' : 'light') : appearance;\n"
        '  var root = document.documentElement;\n'
        "  root.setAttribute('data-theme', mode);\n"
        "  root.setAttribute('data-appearance', appearance);\n"
        "  root.setAttribute('data-team', team);\n"
        '  var meta = document.querySelector(\'meta[name="theme-color"]\');\n'
        '  if (meta) meta.setAttribute(\'content\', found.chrome[mode]);\n'
        '  window.MLThemes = THEMES;\n'
        '  window.MLThemeBoot = { appearance: appearance, team: team, mode: mode };\n'
        '})();\n'
        '</script>\n'
    ) % json.dumps(catalog, separators=(',', ':'))
    html = HTML_PATH.read_text()
    html2, n = re.subn(
        r'<script id="theme-boot">[\s\S]*?</script>\n',
        script,
        html,
        count=1,
    )
    if n != 1:
        raise SystemExit('theme-boot script marker missing')
    HTML_PATH.write_text(html2)
    print('wrote', CSS_PATH, 'and theme-boot for', len(catalog), 'themes')


if __name__ == '__main__':
    main()
