#!/usr/bin/env bash
# Re-pull nflverse 2026 data and rebuild site/data.json for Matchup Lab.
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p data
B="https://github.com/nflverse/nflverse-data/releases/download"
curl -fsSL -o data/players_2026.csv  "$B/stats_player/stats_player_week_2026.csv"
curl -fsSL -o data/team_2026.csv     "$B/stats_team/stats_team_week_2026.csv"
curl -fsSL -o data/injuries_2026.csv "$B/injuries/injuries_2026.csv"
curl -fsSL -o data/games.csv         "https://github.com/nflverse/nfldata/raw/master/data/games.csv"
curl -fsSL -o data/sleeper_players.json "https://api.sleeper.app/v1/players/nfl"
curl -fsSL -o data/db_playerids.csv "https://github.com/dynastyprocess/data/raw/master/files/db_playerids.csv"
# Advanced layers (optional: a failed download keeps the previous copy and the build marks metrics unavailable)
opt() { curl -fsSL -o "$1.tmp" "$2" && mv "$1.tmp" "$1" || { rm -f "$1.tmp"; echo "WARN: could not refresh $1"; }; }
opt data/pbp_2026.csv.gz       "$B/pbp/play_by_play_2026.csv.gz"
opt data/snaps_2026.csv        "$B/snap_counts/snap_counts_2026.csv"
opt data/ngs_passing.csv.gz    "$B/nextgen_stats/ngs_passing.csv.gz"
opt data/ngs_rushing.csv.gz    "$B/nextgen_stats/ngs_rushing.csv.gz"
opt data/ngs_receiving.csv.gz  "$B/nextgen_stats/ngs_receiving.csv.gz"
opt data/pfr_pass_2026.csv     "$B/pfr_advstats/advstats_week_pass_2026.csv"
opt data/pfr_rush_2026.csv     "$B/pfr_advstats/advstats_week_rush_2026.csv"
opt data/pfr_rec_2026.csv      "$B/pfr_advstats/advstats_week_rec_2026.csv"
opt data/ftn_2026.csv          "$B/ftn_charting/ftn_charting_2026.csv"
opt data/ep_2026.csv           "https://github.com/ffverse/ffopportunity/releases/download/latest-data/ep_weekly_2026.csv"
python3 build_data.py
python3 stamp.py
