"""Checks that must pass before data.json is published.

A failed check exits non-zero so the workflow does not replace the data branch.
"""
import json
import sys
from datetime import datetime, timezone

# The 32 NFL clubs the defense table is built from.
TEAMS = {
    'ARI', 'ATL', 'BAL', 'BUF', 'CAR', 'CHI', 'CIN', 'CLE', 'DAL', 'DEN', 'DET', 'GB',
    'HOU', 'IND', 'JAX', 'KC', 'LA', 'LAC', 'LV', 'MIA', 'MIN', 'NE', 'NO', 'NYG', 'NYJ',
    'PHI', 'PIT', 'SEA', 'SF', 'TB', 'TEN', 'WAS',
}
# Flags build_advanced always sets, true or false. A missing key means the build
# skipped a source instead of recording that it was unavailable.
EXPECTED_AVAIL = (
    'pbp', 'snaps', 'ngs_passing', 'ngs_rushing', 'ngs_receiving',
    'pressure', 'broken_tackles', 'xfp',
)


def parse_generated(text):
    return datetime.strptime(text, '%Y-%m-%d %H:%M UTC').replace(tzinfo=timezone.utc)


def validate(data, now=None, max_age_hours=6):
    """Return a list of problems. Empty means the file is safe to publish."""
    errors = []
    now = now or datetime.now(timezone.utc)
    players = data.get('players') or []
    if len(players) <= 200:
        errors.append(f'too few players ({len(players)})')
    meta = data.get('meta') or {}
    week = meta.get('next_week')
    if isinstance(week, bool) or not isinstance(week, int) or not 1 <= week <= 18:
        errors.append(f'next_week {week!r} is outside 1-18')
    generated = meta.get('generated')
    try:
        stamp = parse_generated(generated or '')
    except (TypeError, ValueError):
        errors.append(f'generated is not a UTC timestamp: {generated!r}')
        stamp = None
    if stamp is not None:
        age_hours = (now - stamp).total_seconds() / 3600
        # A small negative window covers clock skew. Anything older was not just built.
        if age_hours < -1 or age_hours > max_age_hours:
            errors.append(f'generated is not recent ({generated}, {age_hours:.1f}h from now)')
    missing = sorted(TEAMS - set((data.get('defense') or {})))
    if missing:
        errors.append('defense is missing teams: ' + ', '.join(missing))
    avail = data.get('avail') or {}
    absent = [key for key in EXPECTED_AVAIL if key not in avail]
    if absent:
        errors.append('avail flags missing: ' + ', '.join(absent))
    return errors


def mark_market_stale(market, reason):
    """Return a copy of a previous market file flagged so the app can say so."""
    out = dict(market)
    out['stale'] = True
    out['stale_reason'] = reason
    return out


def main(path='site/data.json'):
    with open(path) as f:
        data = json.load(f)
    errors = validate(data)
    if errors:
        for err in errors:
            print('INVALID', err, file=sys.stderr)
        return 1
    meta = data['meta']
    print('ok', 'players', len(data['players']), 'last', meta['last_completed_week'], 'next', meta['next_week'])
    return 0


if __name__ == '__main__':
    sys.exit(main(*sys.argv[1:]))
