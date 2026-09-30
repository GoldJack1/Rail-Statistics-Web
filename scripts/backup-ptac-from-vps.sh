#!/usr/bin/env bash
# Copy PTAC SQLite off the VPS before any wipe. Does not copy overlay history.
set -euo pipefail
HOST="${DARWIN_VPS_HOST:-netcup-darwin}"
REMOTE="${DARWIN_VPS_DIR:-/home/darwin/darwin-local-test}/state/darwin-state.sqlite"
OUT_DIR="${1:-./backups/ptac}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$OUT_DIR"
DEST="$OUT_DIR/darwin-state.$STAMP.sqlite"

echo "Copying $HOST:$REMOTE -> $DEST"
scp -o BatchMode=yes "$HOST:$REMOTE" "$DEST"
if ssh -o BatchMode=yes "$HOST" "test -f ${REMOTE}-wal"; then
  scp -o BatchMode=yes "$HOST:${REMOTE}-wal" "$DEST-wal" || true
fi
if ssh -o BatchMode=yes "$HOST" "test -f ${REMOTE}-shm"; then
  scp -o BatchMode=yes "$HOST:${REMOTE}-shm" "$DEST-shm" || true
fi

shasum -a 256 "$DEST" | tee "$DEST.sha256"
python3 - "$DEST" <<'PY'
import sqlite3, sys
p = sys.argv[1]
con = sqlite3.connect(p)
cur = con.cursor()
tables = [r[0] for r in cur.execute("SELECT name FROM sqlite_master WHERE type='table'")]
print("tables:", ", ".join(tables[:40]))
for guess in ("units", "unit", "catalog"):
    matches = [t for t in tables if guess in t.lower()]
    for t in matches[:5]:
        n = cur.execute(f'SELECT COUNT(*) FROM "{t}"').fetchone()[0]
        print(f"count {t}: {n}")
con.close()
PY
echo "OK. Keep this file off-box. Do not copy state/history overlays."
touch "$OUT_DIR/BACKUP_OK"
echo "$DEST" > "$OUT_DIR/BACKUP_OK"
