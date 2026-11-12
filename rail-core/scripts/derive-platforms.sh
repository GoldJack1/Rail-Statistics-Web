#!/usr/bin/env bash
# Regenerates config/platform-derived.json from the site's station list, the
# track and the last 14 days of calls. Run weekly by rail-core-derive-platforms.timer.
# ALSO_WRITE_TO is another file to copy the result to (the staging install's).
set -euo pipefail
cd "$(dirname "$0")/.."
LIST="$(mktemp)"
trap 'rm -f "$LIST"' EXIT
curl -fsSL --max-time 120 -o "$LIST" \
  "https://firebasestorage.googleapis.com/v0/b/rail-statistics.firebasestorage.app/o/station-exports%2Fstations_gbnr.list.json.gz?alt=media"
# The export is served either way: plain JSON or gzipped.
if [ "$(head -c 2 "$LIST" | xxd -p)" = "1f8b" ]; then
  gunzip -c "$LIST" > "$LIST.json" && mv "$LIST.json" "$LIST"
fi
node --disable-warning=ExperimentalWarning scripts/derive-platforms.js --stations "$LIST" --days 14
if [ -n "${ALSO_WRITE_TO:-}" ]; then
  cp config/platform-derived.json "$ALSO_WRITE_TO"
fi
