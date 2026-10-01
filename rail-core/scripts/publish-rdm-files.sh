#!/usr/bin/env bash
# Publish RDM static files to Firebase Storage prefixes the 04:00 VPS job pulls.
# Usage: ./rail-core/scripts/publish-rdm-files.sh [drop-dir]
set -euo pipefail

DROP="${1:-${RDM_DROP_DIR:-$HOME/Downloads}}"
BUCKET="${TT_GCS_BUCKET:-gs://rail-statistics.firebasestorage.app}"
CORPUS="${TT_GCS_CORPUS:-$BUCKET/DARWINCORPUS}"
TOPS="${TT_GCS_TOPS:-$BUCKET/DARWINTOPS}"
LONG="${TT_GCS_LONG:-$BUCKET/DARWINLONGRANGETTFILES}"
GSUTIL="${GSUTIL_PATH:-gsutil}"

if [[ ! -d "$DROP" ]]; then
  echo "drop directory not found: $DROP" >&2
  exit 1
fi

copy_newest() {
  local glob=$1 dest=$2
  local f
  f="$(ls -t $glob 2>/dev/null | head -1 || true)"
  if [[ -z "${f:-}" || ! -f "$f" ]]; then
    echo "skip (none): $glob"
    return 0
  fi
  echo "upload $(basename "$f") -> $dest"
  "$GSUTIL" -m cp -n "$f" "$dest/"
}

echo "publishing from $DROP"

copy_newest "$DROP"/NLC*.xml.gz "$CORPUS"
copy_newest "$DROP"/NLC*.xml "$CORPUS"
copy_newest "$DROP"/tops-location*.csv "$TOPS"
copy_newest "$DROP"/timetable_full.zip "$LONG"
copy_newest "$DROP"/timetable_full*.zip "$LONG"

echo "done"
