#!/usr/bin/env bash
# Re-pull nflverse 2026 data and rebuild site/data.json for Matchup Lab.
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p data

# Conditional GET. A 304 keeps the file already on disk (restored from the
# workflow cache). A failed required download fails the job only when there is
# no previous copy; an optional one keeps the previous copy either way.
fetch() {
  local dest="$1" url="$2" required="${3:-1}"
  local tmp="${dest}.part" hdr="${dest}.hdr" etagf="${dest}.etag"
  local -a args=(-sS -L --max-time 180 -D "$hdr" -o "$tmp" -w '%{http_code}')
  if [ -s "$dest" ] && [ -s "$etagf" ]; then
    args+=(-H "If-None-Match: $(tr -d '\r\n' < "$etagf")")
  fi
  local code
  code=$(curl "${args[@]}" "$url" || true)
  if [ "$code" = "200" ] && [ -s "$tmp" ]; then
    mv "$tmp" "$dest"
    local etag
    etag=$(grep -i '^etag:' "$hdr" | tail -n 1 | sed 's/^[Ee][Tt][Aa][Gg]:[[:space:]]*//; s/\r$//' || true)
    if [ -n "$etag" ]; then printf '%s\n' "$etag" > "$etagf"; else rm -f "$etagf"; fi
    rm -f "$hdr"
  elif [ "$code" = "304" ] && [ -s "$dest" ]; then
    rm -f "$tmp" "$hdr"
    echo "cached $dest"
  else
    rm -f "$tmp" "$hdr"
    if [ -s "$dest" ]; then
      echo "WARN: could not refresh $dest (HTTP ${code:-none}); keeping previous copy"
    elif [ "$required" = "1" ]; then
      echo "ERROR: download failed for $dest (HTTP ${code:-none})" >&2
      exit 1
    else
      echo "WARN: could not refresh $dest (HTTP ${code:-none})"
    fi
  fi
}

B="https://github.com/nflverse/nflverse-data/releases/download"
fetch data/players_2026.csv      "$B/stats_player/stats_player_week_2026.csv"
fetch data/team_2026.csv         "$B/stats_team/stats_team_week_2026.csv"
fetch data/injuries_2026.csv     "$B/injuries/injuries_2026.csv"
# Optional: a missing depth chart leaves data.roles empty and projections unchanged.
fetch data/depth_2026.csv        "$B/depth_charts/depth_charts_2026.csv" 0
fetch data/games.csv             "https://github.com/nflverse/nfldata/raw/master/data/games.csv"
fetch data/sleeper_players.json  "https://api.sleeper.app/v1/players/nfl"
# ADP is optional. A broken feed keeps the previous file, and the trade build
# skips the blend when the file is missing.
python3 fetch_adp.py || echo "WARN: ADP was not refreshed"
fetch data/db_playerids.csv      "https://github.com/dynastyprocess/data/raw/master/files/db_playerids.csv"
# Advanced layers are optional: a failed download keeps the previous copy and the build marks metrics unavailable.
fetch data/pbp_2026.csv.gz       "$B/pbp/play_by_play_2026.csv.gz" 0
fetch data/snaps_2026.csv        "$B/snap_counts/snap_counts_2026.csv" 0
fetch data/ngs_passing.csv.gz    "$B/nextgen_stats/ngs_passing.csv.gz" 0
fetch data/ngs_rushing.csv.gz    "$B/nextgen_stats/ngs_rushing.csv.gz" 0
fetch data/ngs_receiving.csv.gz  "$B/nextgen_stats/ngs_receiving.csv.gz" 0
fetch data/pfr_pass_2026.csv     "$B/pfr_advstats/advstats_week_pass_2026.csv" 0
fetch data/pfr_rush_2026.csv     "$B/pfr_advstats/advstats_week_rush_2026.csv" 0
fetch data/pfr_rec_2026.csv      "$B/pfr_advstats/advstats_week_rec_2026.csv" 0
fetch data/ftn_2026.csv          "$B/ftn_charting/ftn_charting_2026.csv" 0
fetch data/ep_2026.csv           "https://github.com/ffverse/ffopportunity/releases/download/latest-data/ep_weekly_2026.csv" 0
# Prior seasons feed trade baselines for injured and missing players. Optional.
fetch data/player_stats.csv      "$B/player_stats/player_stats.csv" 0
fetch data/players_2025.csv      "$B/stats_player/stats_player_week_2025.csv" 0
python3 build_data.py
# News is optional. A broken feed must not fail the projection build.
python3 fetch_news.py site/data.json site/news.json ${ML_PREV_NEWS:-} || echo "WARN: news build failed; projections are unchanged"
node build_trade.js --backtest || echo "WARN: trade values were not rebuilt; projections are unchanged"
python3 stamp.py
