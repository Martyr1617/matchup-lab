#!/usr/bin/env python3
"""Download a compact ADP file for the trade builder.

ESPN's average draft position is the season-to-date average across ESPN leagues.
Most of those drafts happen before the season, so the number is not an in-season
trade price. The ownership timestamp is the day that average was last refreshed.

Fantasy Football Calculator's 12-team 2QB board is the superflex ADP when the
feed is up. A failure leaves the previous data/adp.json in place and exits 0.
"""
import json
import os
import sys
import urllib.request
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.abspath(__file__))
DEST = os.path.join(ROOT, 'data', 'adp.json')
POS = {1: 'QB', 2: 'RB', 3: 'WR', 4: 'TE'}


def get(url, headers):
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=40) as res:
        return json.load(res)


def espn_rows():
    headers = {
        'User-Agent': 'matchup-lab',
        'X-Fantasy-Filter': json.dumps({
            'players': {
                'limit': 1500,
                'sortAdp': {'sortAsc': True, 'sortPriority': 1},
                'filterSlotIds': {'value': [0, 2, 4, 6, 17, 23]},
            }
        }),
    }
    url = 'https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/2026/segments/0/leaguedefaults/3?view=kona_player_info'
    payload = get(url, headers)
    rows = []
    stamp = None
    for item in payload.get('players') or []:
        pl = item.get('player') or {}
        own = pl.get('ownership') or {}
        adp = own.get('averageDraftPosition')
        pos = POS.get(pl.get('defaultPositionId'))
        if not pos or not adp or adp <= 0 or adp > 300 or not pl.get('id'):
            continue
        if own.get('date'):
            stamp = own['date']
        rows.append({
            'espn': str(pl['id']),
            'name': pl.get('fullName') or '',
            'pos': pos,
            'adp': round(float(adp), 1),
        })
    if not rows:
        raise RuntimeError('ESPN returned no ADP rows')
    date = datetime.now(timezone.utc).strftime('%Y-%m-%d')
    if stamp:
        date = datetime.fromtimestamp(stamp / 1000, timezone.utc).strftime('%Y-%m-%d')
    return rows, date


def ffc_sf():
    url = 'https://fantasyfootballcalculator.com/api/v1/adp/2qb?teams=12&year=2026'
    payload = get(url, {'User-Agent': 'matchup-lab'})
    meta = payload.get('meta') or {}
    out = {}
    for pl in payload.get('players') or []:
        if pl.get('position') not in ('QB', 'RB', 'WR', 'TE'):
            continue
        if not pl.get('name') or not pl.get('adp'):
            continue
        out[(pl['name'], pl['position'])] = round(float(pl['adp']), 1)
    return out, meta.get('end_date') or meta.get('start_date') or '', meta


def main():
    os.makedirs(os.path.dirname(DEST), exist_ok=True)
    try:
        rows, date = espn_rows()
        sf, sf_date, sf_meta = {}, '', {}
        try:
            sf, sf_date, sf_meta = ffc_sf()
        except Exception as exc:
            print('WARN: 2QB ADP unavailable:', exc, file=sys.stderr)
        matched = 0
        for row in rows:
            hit = sf.get((row['name'], row['pos']))
            if hit:
                row['sf'] = hit
                matched += 1
        doc = {
            'source': 'ESPN',
            'date': date,
            'note': 'Season-to-date average draft position across ESPN leagues. Most of that average is preseason drafts, so it is not an in-season trade price.',
            'sf_source': 'Fantasy Football Calculator 2QB' if matched else '',
            'sf_date': sf_date if matched else '',
            'sf_drafts': sf_meta.get('total_drafts') if matched else 0,
            'players': rows,
        }
        tmp = DEST + '.part'
        with open(tmp, 'w') as fh:
            json.dump(doc, fh, separators=(',', ':'))
        os.replace(tmp, DEST)
        print('adp', len(rows), 'date', date, 'sf', matched, sf_date)
    except Exception as exc:
        print('WARN: ADP was not refreshed:', exc, file=sys.stderr)
        if not os.path.exists(DEST):
            print('WARN: no previous ADP file', file=sys.stderr)
        return 0
    return 0


if __name__ == '__main__':
    sys.exit(main())
