#!/usr/bin/env bash
# Stop old darwin units and remove overlay app tree ONLY after PTAC backup exists.
# Does not delete Caddy, OS, or secret files you copy first.
set -euo pipefail
HOST="${DARWIN_VPS_HOST:-netcup-darwin}"
BACKUP_OK="${1:-./backups/ptac/BACKUP_OK}"
REMOTE_OLD="${DARWIN_VPS_DIR:-/home/darwin/darwin-local-test}"
REMOTE_NEW="${RAIL_CORE_DIR:-/home/darwin/rail-core}"

if [[ ! -f "$BACKUP_OK" ]]; then
  echo "Refusing wipe: $BACKUP_OK missing. Run scripts/backup-ptac-from-vps.sh first." >&2
  exit 1
fi
if [[ "${CONFIRM_DARWIN_WIPE:-}" != "yes" ]]; then
  echo "Refusing wipe: set CONFIRM_DARWIN_WIPE=yes after the new query API is proven." >&2
  exit 1
fi

ssh -t "$HOST" bash -s <<EOF
set -euo pipefail
sudo systemctl stop darwin darwin-heavy || true
sudo systemctl disable darwin darwin-heavy || true
sudo mkdir -p ${REMOTE_NEW}/data ${REMOTE_NEW}/tt ${REMOTE_NEW}/secrets
# Keep a copy of old .env for Kafka/PTAC keys — not overlay history
if [[ -f ${REMOTE_OLD}/.env ]]; then
  sudo cp -a ${REMOTE_OLD}/.env ${REMOTE_NEW}/secrets/legacy-darwin.env
fi
sudo rm -rf ${REMOTE_OLD}/state/history
echo "Overlay history removed. App tree still at ${REMOTE_OLD} until you delete it with DELETE_OLD_TREE=yes"
if [[ "${DELETE_OLD_TREE:-}" == "yes" ]]; then
  sudo rm -rf ${REMOTE_OLD}
  echo "Removed ${REMOTE_OLD}"
fi
EOF
