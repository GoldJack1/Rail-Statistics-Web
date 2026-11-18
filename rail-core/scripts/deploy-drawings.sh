#!/usr/bin/env bash
# Upload the train drawings to the VPS so every client (web, iOS, Android) picks them up from
# /api/drawings/... with no app or site release. Run from the Mac after
#   node rail-core/scripts/build-drawings.mjs
#
#   rail-core/scripts/deploy-drawings.sh dev     # /home/darwin/rail-core-dev/assets/train-drawings  (api-dev)
#   rail-core/scripts/deploy-drawings.sh prod    # /home/darwin/rail-core/assets/train-drawings      (api-raildata)
#
# The query server reads the directory per request, so no restart is needed. Cars are cached for a
# day at the edge; index.json (5 min) carries a "version" that clients add to car URLs, so an
# update reaches everyone within minutes.
set -euo pipefail
TARGET="${1:-}"
HOST="${RAIL_CORE_HOST:-rail-core-lon}"
SRC="${DRAWINGS_SRC:-$(cd "$(dirname "$0")/.." && pwd)/assets/train-drawings-build}"
case "$TARGET" in
  dev)  DEST="/home/darwin/rail-core-dev/assets/train-drawings" ;;
  prod) DEST="/home/darwin/rail-core/assets/train-drawings" ;;
  *) echo "usage: $0 dev|prod" >&2; exit 2 ;;
esac
[[ -f "$SRC/index.json" ]] || { echo "missing $SRC/index.json - run build-drawings.mjs first" >&2; exit 1; }
VERSION=$(python3 -c "import json,sys;print(json.load(open(sys.argv[1]))['version'])" "$SRC/index.json")
echo "Uploading drawings version $VERSION to $HOST:$DEST"
ssh "$HOST" "mkdir -p '$DEST'"
# Cars first, index last, so a client never sees an index that points at cars not there yet.
rsync -a --delete --exclude index.json "$SRC/" "$HOST:$DEST/"
rsync -a "$SRC/index.json" "$HOST:$DEST/index.json"
ssh "$HOST" "chown -R darwin:darwin '$DEST'"
echo "done"
