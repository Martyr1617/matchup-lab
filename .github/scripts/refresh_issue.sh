#!/usr/bin/env bash
# Open one issue for a refresh problem, or comment if that issue is already open.
# Deduped so an hourly failure does not file a new issue every run.
set -euo pipefail
title=${1:-Data refresh failed}
body="Workflow run: ${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}

${title} at $(date -u +%Y-%m-%dT%H:%MZ)."
existing=$(gh issue list --state open --limit 20 --json number,title --jq ".[] | select(.title == \"${title}\") | .number" | head -n 1 || true)
if [ -n "${existing}" ]; then
  gh issue comment "${existing}" --body "${body}"
else
  gh issue create --title "${title}" --body "${body}"
fi
