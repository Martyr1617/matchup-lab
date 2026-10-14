# Matchup Lab data

Builds the data behind [Matchup Lab](https://matchup-lab.pplx.app), a weekly fantasy football projection app.

A scheduled GitHub Actions workflow runs every hour. Each run:

1. Downloads public nflverse / ffverse data: player and team stats, play-by-play, snap counts, Next Gen Stats, PFR advanced stats, expected fantasy points, injuries and the schedule.
2. Pulls DraftKings spreads, totals and player-prop lines from ESPN's public feed.
3. Pushes `data.json` and `market.json` to the `data` branch, which the app reads.

To refresh right away, go to Actions → "Refresh Matchup Lab data" → Run workflow.
