# Matchup Lab data

Builds the data behind Matchup Lab, a weekly fantasy football projection app. Every push to `main` publishes `site/` to GitHub Pages at <https://martyr1617.github.io/matchup-lab/>. [matchup-lab.pplx.app](https://matchup-lab.pplx.app) is a separate host and does not update from this repository.

GitHub Pages has to be turned on once by a repository admin. Open **Settings → Pages → Build and deployment** and set **Source** to **GitHub Actions**. The workflow cannot do that step: both the Actions token and the automation token get "Resource not accessible by integration" from the Pages API. After that setting is saved, the next push to `main` (or a re-run of "Deploy Matchup Lab site") publishes the site.

A scheduled GitHub Actions workflow runs every hour. Each run:

1. Downloads public nflverse / ffverse data: player and team stats, play-by-play, snap counts, Next Gen Stats, PFR advanced stats, expected fantasy points, injuries and the schedule.
2. Pulls DraftKings spreads, totals and player-prop lines from ESPN's public feed.
3. Pushes `data.json` and `market.json` to the `data` branch, which the app reads.

The Pages site keeps loading those files from `https://raw.githubusercontent.com/Martyr1617/matchup-lab/data/`. The copies committed under `site/` are the fallback when that branch cannot be reached. The hourly refresh does not deploy the page.

The same `site/` directory is the installable app. On GitHub Pages the manifest `start_url` and `scope` are `/matchup-lab/`. A service worker caches the app shell and always tries the network first for `data.json` and `market.json`, falling back to the last copy it saved. A later Capacitor wrap for the App Store or Google Play should use `webDir: "site"`. The worker registers a relative `sw.js` and caches relative shell URLs, so that wrap can serve the files at `/` and should set the manifest `start_url` and `scope` to `/` instead of the Pages subpath.

To refresh right away, go to Actions → "Refresh Matchup Lab data" → Run workflow. To republish the page, go to Actions → "Deploy Matchup Lab site" → Run workflow, or push to `main`.

## Tests

```
node --test test/model.test.js test/pwa.test.js test/lineup.test.js
python3 -m pytest tests
```

The projection math lives in `site/model.js`. The page loads it with a script tag, and Node requires the same file, so there is no build step.

## Backtest

`node backtest.js` scores every completed week from week 2 on. For each player-week it rebuilds usage from that player's earlier games only, projects the week with `site/model.js`, and compares the projection to the actual PPR points in the log. It prints mean absolute error, root-mean-square error, bias, how often the actual result landed between P10 and P90, and boom/bust calibration (the average predicted probability versus how often it happened).

Opponent factors are the published season-to-date table, so they include later weeks. Player usage does not. The script reads `site/data.json`, is not part of CI, and exits with an error if there is nothing to score.

The outcome distribution is a normal centered on the projection. Player CV is widened by 1.25× (`PREDICTIVE_SPREAD` in `site/model.js`). That factor is the 2024–2025 forecast-error ratio (about 1.16× the CV-implied spread) plus a small allowance because the residuals are a little heavier than a normal. It was not fit to the current season's handful of weeks.
