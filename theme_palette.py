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


# Matchup Lab's own field and gold. A team block must not reuse these, or the
# page still reads as the default green and yellow theme.
BANNED = {
    '#0b3d24', '#062016', '#0a2e1d', '#04140d', '#123d28', '#184a32', '#1f5a3c',
    '#0c2619', '#123221', '#173e29', '#24563c', '#1a4630', '#2f6d4c',
    '#1c4a28', '#16381f', '#1c4d34', '#163528', '#3d3410', '#3a3012',
    '#f5c518', '#ffd84a', '#1a1402', '#b7e4c7', '#c6f5a8',
}

# Same luminance steps as the default field, so a club colors the whole page
# instead of a pale wash. Light is the brighter field; dark is the deeper one.
FIELD = {
    True: dict(bg=0.024, surface=0.042, surface2=0.062, offset=0.088, border=0.135, field=0.040, deep=0.014),
    False: dict(bg=0.008, surface=0.018, surface2=0.030, offset=0.046, border=0.078, field=0.016, deep=0.006),
}


def set_lum(color, target):
    """Move luminance to `target` by mixing with black or white, keeping hue."""
    c = rgb(color) if isinstance(color, str) else color
    cur = lum(c)
    if abs(cur - target) < 0.0008:
        return hex_of(c)
    anchor = (0, 0, 0) if cur > target else (255, 255, 255)
    lo, hi = 0.0, 1.0
    best = c
    for _ in range(24):
        t = (lo + hi) / 2
        nxt = mix(c, anchor, t)
        best = nxt
        got = lum(nxt)
        if abs(got - target) < 0.0008:
            break
        if (got > target) == (cur > target):
            lo = t
        else:
            hi = t
    return hex_of(best)


def chroma(color):
    r, g, b = (v / 255 for v in (rgb(color) if isinstance(color, str) else color))
    mx, mn = max(r, g, b), min(r, g, b)
    return 0.0 if mx <= 1e-9 else (mx - mn) / mx


def nudge(color):
    """Step off an exact default-theme hex without leaving the hue."""
    if not isinstance(color, str) or not color.startswith('#'):
        return color
    c = color.lower()
    for _ in range(6):
        if c not in BANNED:
            return c
        vals = list(rgb(c))
        i = max(range(3), key=lambda k: vals[k])
        vals[i] = vals[i] - 16 if vals[i] >= 16 else vals[i] + 16
        c = hex_of(vals)
    return c


def paint_seed(primary, secondary):
    """Field hue. A black, white, or gray swatch yields to the other color."""
    def colored(c):
        return chroma(c) >= 0.08 and lum(rgb(c)) >= 0.004
    if colored(primary):
        return primary
    if colored(secondary):
        return secondary
    return secondary if lum(rgb(secondary)) >= lum(rgb(primary)) else primary


def boost(color, target=0.58):
    """Saturate a dull team color so the field reads as strongly as the default green.

    Near-grays (silver, black) are left alone so a Raiders theme stays metal.
    """
    ch = chroma(color)
    if ch < 0.08 or ch >= target:
        return color
    r, g, b = rgb(color)
    mx, mn = max(r, g, b), min(r, g, b)
    span = mx - mn
    pure = tuple((v - mn) / span * 255 for v in (r, g, b))
    amt = min(1.0, (target - ch) / target)
    return hex_of(tuple((r, g, b)[i] * (1 - amt) + pure[i] * amt for i in range(3)))


def accent_source(primary, secondary, field):
    """The swatch that should pop on the field. A near-black swatch yields to the field hue."""
    other = secondary if field.lower() == primary.lower() else primary
    # Relative chroma of a near-black hex is noise (a 16,24,32 "navy" is still black).
    if lum(rgb(other)) < 0.04:
        return field
    if chroma(other) >= 0.06 or lum(rgb(other)) >= 0.2:
        return other
    return field


def hsl_hex(h, s, lit):
    h = h % 360
    c = (1 - abs(2 * lit - 1)) * s
    hp = h / 60
    x = c * (1 - abs(hp % 2 - 1))
    if hp < 1:
        r, g, b = c, x, 0
    elif hp < 2:
        r, g, b = x, c, 0
    elif hp < 3:
        r, g, b = 0, c, x
    elif hp < 4:
        r, g, b = 0, x, c
    elif hp < 5:
        r, g, b = x, 0, c
    else:
        r, g, b = c, 0, x
    m = lit - c / 2
    return hex_of(((r + m) * 255, (g + m) * 255, (b + m) * 255))


def readable_accent(seed, surfaces):
    """Bright team color used as text and as a button fill.

    An official swatch is kept when it already clears AA. A dark red or navy
    is lifted in its own hue before any mix toward white, so it stays a team
    color instead of turning gray-pink.
    """
    dark, light = '#14120e', '#f7f4ea'

    def ink_of(c):
        if contrast(c, dark) >= 4.5:
            return dark
        if contrast(c, light) >= 4.5:
            return light
        return None

    def passes(c):
        ink = ink_of(c)
        if ink and all(contrast(c, s) >= 4.5 for s in surfaces):
            return ink
        return None

    ink = passes(seed)
    if ink:
        return nudge(seed), ink
    h = hue_deg(seed)
    start = seed if h is None else hsl_hex(h, 0.84, 0.62)
    ink = passes(start)
    if ink:
        return nudge(start), ink
    for i in range(1, 41):
        c = hex_of(mix(rgb(start), (255, 255, 255), i / 40))
        ink = passes(c)
        if ink:
            return nudge(c), ink
    return nudge('#f4efe2'), dark


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
    """A full team field at the same depth as the default green theme.

    Both modes stay dark enough for light text, matching Matchup Lab itself.
    Light is the brighter club field; dark is a deeper shade of the same hue.
    Near-black or near-white primaries take their tint from the other swatch.
    """
    step = FIELD[light]
    raw = paint_seed(primary, secondary)
    seed = boost(raw)
    bg = nudge(set_lum(seed, step['bg']))
    surface = nudge(set_lum(seed, step['surface']))
    surface2 = nudge(set_lum(seed, step['surface2']))
    offset = nudge(set_lum(seed, step['offset']))
    border = nudge(set_lum(seed, step['border']))
    divider = nudge(set_lum(seed, (step['surface2'] + step['border']) / 2))
    field = nudge(set_lum(seed, step['field']))
    field_deep = nudge(set_lum(seed, step['deep']))

    text = nudge(text_on(surface, '#f7f4ea', 7.0, False))
    muted = nudge(text_on(surface2, '#d9d3c6', 4.5, False))
    faint = nudge(text_on(surface, '#c4beb2', 4.5, False))
    # Muted and faint copy also sits on the page background and on cards.
    muted = nudge(text_on(bg, muted, 4.5, False))
    faint = nudge(text_on(surface, faint, 4.5, False))

    gold, gold_ink = readable_accent(accent_source(primary, secondary, raw), (surface, bg, field_deep))
    hover = hex_of(mix(rgb(gold), (255, 255, 255), 0.16))
    if contrast(hover, gold_ink) < 4.5:
        hover = gold
    hover = nudge(hover)

    on_header = gold if contrast(gold, field_deep) >= 4.5 else text
    on_header_muted = nudge(text_on(
        field_deep, hex_of(mix(rgb(on_header), rgb(field_deep), 0.42)), 4.5, False,
    ))

    def hue_dist(a, b):
        ha, hb = hue_deg(a), hue_deg(b)
        if ha is None or hb is None:
            return 0 if channel_dist(a, b) < 40 else 180
        d = abs(ha - hb)
        return min(d, 360 - d)

    def semantic(options, avoid):
        fallback = None
        fallback_gap = -1
        chosen = None
        for opt in options:
            color = nudge(text_on(surface, opt, 4.5, False))
            if contrast(color, surface) < 4.5:
                continue
            gap = min(hue_dist(color, a) for a in avoid)
            if gap > fallback_gap:
                fallback_gap = gap
                fallback = color
            # Hue distance is what keeps a grade readable on a team field.
            # Two light pastels can share a luminance and still read as different colors.
            if gap >= 40:
                chosen = color
                break
        if chosen is None:
            chosen = fallback or nudge(text_on(surface, options[-1], 4.5, False))
        if min(hue_dist(chosen, a) for a in avoid) < 40:
            base = hue_deg(chosen) or 200
            for shift in (40, 60, 80, 100, 130, 160, 200, 230):
                trial = nudge(text_on(surface, hsl_hex((base + shift) % 360, 0.74, 0.70), 4.5, False))
                if contrast(trial, surface) < 4.5:
                    continue
                if min(hue_dist(trial, a) for a in avoid) >= 40:
                    chosen = trial
                    break
        bg_c = surface
        for i in range(2, 24):
            trial = hex_of(mix(rgb(surface), rgb(chosen), i / 28))
            if contrast(chosen, trial) >= 4.5:
                bg_c = trial
                break
        return chosen, nudge(bg_c)

    avoid = [gold, primary, secondary]
    good, good_bg = semantic(
        ('#3ddc97', '#1faa7a', '#5eb0ff', '#7aa2ff', '#c6f0a4', '#8af0d8'), avoid,
    )
    bad, bad_bg = semantic(
        ('#ff6b6b', '#ff5d8f', '#ff4d6d', '#e85d4c', '#ff7ad9', '#ff8fab'), avoid + [good],
    )
    warn, warn_bg = semantic(
        ('#ffbf70', '#ffd166', '#f4a261', '#e0aaff', '#c77dff', '#ff9f1c'), avoid + [good, bad],
    )

    floor_src = primary if not hue_close(primary, gold) else '#9fd4ff'
    floor = nudge(text_on(surface, floor_src, 4.5, False))
    if hue_close(floor, gold) or contrast(floor, gold) < 1.3:
        for alt in ('#9fd4ff', '#d4c4ff', '#ffb0c8'):
            if not hue_close(alt, gold):
                floor = nudge(text_on(surface, alt, 4.5, False))
                break
    ceil_c = gold

    chart_src = boost(primary) if chroma(primary) >= 0.08 else '#d5dde8'
    chart_line = nudge(text_on(surface, chart_src, 3.0, False))
    if contrast(chart_line, gold) < 1.25 or hue_close(chart_line, gold):
        # Gold-on-gold clubs (Steelers, Saints) keep the curve in the paper color
        # so it stays on the team field instead of jumping to an unrelated hue.
        chart_line = text if contrast(text, surface) >= 3.0 else nudge(text_on(surface, '#f7f4ea', 3.0, False))
    chart_floor = floor if contrast(floor, surface) >= 3.0 else nudge(text_on(surface, floor, 3.0, False))
    chart_ceil = gold
    pr, pg, pb = rgb(chart_line)
    chart_fill = 'rgba(%d, %d, %d, %.2f)' % (pr, pg, pb, 0.28 if light else 0.34)
    highlight = nudge(hex_of(mix(rgb(surface), rgb(gold), 0.34)))

    return {
        'color-scheme': 'dark',
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
        '--color-gold-bright': hover,
        '--color-gold-ink': gold_ink,
        '--color-floor': floor,
        '--color-ceil': ceil_c,
        '--color-primary': gold,
        '--color-primary-hover': hover,
        '--color-primary-highlight': highlight,
        '--color-primary-ink': gold_ink,
        '--color-link': gold,
        '--color-on-header': on_header,
        '--color-on-header-muted': on_header_muted,
        '--color-zebra': offset,
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
        '  var splashOff = false;\n'
        '  try {\n'
        "    if (localStorage.getItem('ml-splash') === '0') splashOff = true;\n"
        "    if (sessionStorage.getItem('ml-splash-shown') === '1') splashOff = true;\n"
        '  } catch (e) {}\n'
        "  if (splashOff) root.setAttribute('data-splash', 'off');\n"
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
