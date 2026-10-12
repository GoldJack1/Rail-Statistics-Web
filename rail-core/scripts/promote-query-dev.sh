#!/usr/bin/env bash
# Copy staging query source onto prod and restart query only (not ingest/kafka/stomp/tt).
set -euo pipefail
DEV="${RAIL_CORE_DEV:-/home/darwin/rail-core-dev}"
PROD="${RAIL_CORE_PROD:-/home/darwin/rail-core}"

if [[ ! -d "$DEV/src" ]]; then
  echo "missing $DEV/src" >&2
  exit 1
fi

rsync -a "$DEV/src/" "$PROD/src/"
systemctl restart rail-core-query
systemctl --no-pager --full status rail-core-query | head -n 20
