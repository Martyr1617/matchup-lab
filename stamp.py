"""Version-stamp asset URLs in site/index.html so browsers never mix old and new files."""
import hashlib, re, pathlib
site = pathlib.Path(__file__).parent / 'site'
html = (site / 'index.html').read_text()
normalized_html = re.sub(r'\?v=[0-9a-f]+', '', html)
normalized_html = re.sub(r'<script>window\.ML_VER=.*?</script>\n?', '', normalized_html)
sw = (site / 'sw.js').read_text()
normalized_sw = re.sub(r"const VER = '[0-9a-f]+';", "const VER = 'VERSION';", sw)
hashed = ['app.js', 'model.js', 'lineup.js', 'waiver.js', 'team.js', 'glossary.js', 'trade.js', 'chants.js', 'chants.json', 'styles.css', 'themes.css', 'data.json', 'chart.umd.min.js',
          'manifest.webmanifest', 'icon.svg', 'favicon.ico', 'icon-192.png', 'icon-512.png', 'icon-512-maskable.png', 'apple-touch-icon.png']
ver = hashlib.sha1(b''.join((site / f).read_bytes() for f in hashed) + normalized_html.encode() + normalized_sw.encode()).hexdigest()[:10]
for f in ['app.js', 'model.js', 'lineup.js', 'waiver.js', 'team.js', 'glossary.js', 'trade.js', 'chants.js', 'styles.css', 'themes.css', 'chart.umd.min.js']:
    html = re.sub(r'(["\'])' + re.escape(f) + r'(\?v=[0-9a-f]+)?\1', r'\1' + f + '?v=' + ver + r'\1', html)
html = re.sub(r'<script>window\.ML_VER=.*?</script>\n?', '', html)
html = html.replace('<script src="chart.umd.min.js', '<script>window.ML_VER="' + ver + '";</script>\n<script src="chart.umd.min.js', 1)
(site / 'index.html').write_text(html)
sw = re.sub(r"const VER = '[0-9a-f]+';", "const VER = '%s';" % ver, sw, count=1)
(site / 'sw.js').write_text(sw)
print('stamped', ver)
