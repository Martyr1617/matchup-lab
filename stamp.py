"""Version-stamp asset URLs in site/index.html so browsers never mix old and new files."""
import hashlib, re, pathlib
site = pathlib.Path(__file__).parent / 'site'
h = (site / 'index.html').read_text()
ver = hashlib.sha1(b''.join((site / f).read_bytes() for f in ['app.js', 'team.js', 'glossary.js', 'styles.css', 'data.json', 'chart.umd.min.js'])).hexdigest()[:10]
for f in ['app.js', 'team.js', 'glossary.js', 'styles.css', 'chart.umd.min.js']:
    h = re.sub(r'(["\'])' + re.escape(f) + r'(\?v=[0-9a-f]+)?\1', r'\1' + f + '?v=' + ver + r'\1', h)
h = re.sub(r'<script>window\.ML_VER=.*?</script>\n?', '', h)
h = h.replace('<script src="chart.umd.min.js', '<script>window.ML_VER="' + ver + '";</script>\n<script src="chart.umd.min.js', 1)
(site / 'index.html').write_text(h)
print('stamped', ver)
