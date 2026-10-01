#!/usr/bin/env bash
# Local helper for the netcup Darwin VPS (rail-core live boards).
# Uses SSH host alias `netcup-darwin` (see ~/.ssh/config).
set -euo pipefail

HOST="${DARWIN_VPS_HOST:-netcup-darwin}"
REMOTE_DIR="${RAIL_CORE_DIR:-/home/darwin/rail-core}"
UNITS="rail-core-query rail-core-ingest rail-core-kafka rail-core-ptac"

usage() {
  cat <<'EOF'
Run this on your Mac, from the website repo:

  ./scripts/darwin-vps.sh <command>

  ssh         Open an SSH session
  status      rail-core units, memory, disk, :4001 ping
  logs [N]    Last N journal lines
  follow      Live logs
  start       Start query, ingest, kafka, ptac
  stop        Stop those four
  restart     Restart those four
  health      Local /api/ping and /api/departures/PAD on :4001
  fetch-tt     Run 04:00 timetable pull now (rail-core-tt)
  publish-rdm  Upload NLC, TOPS, CIF from ~/Downloads to GCS
EOF
}

need_host() {
  if ! ssh -o BatchMode=yes -o ConnectTimeout=8 "$HOST" true >/dev/null 2>&1; then
    echo "Cannot SSH to $HOST. Try: ssh $HOST" >&2
    exit 1
  fi
}

remote() {
  ssh -o BatchMode=yes "$HOST" "$@"
}

remote_tty() {
  ssh -t "$HOST" "$@"
}

cmd="${1:-}"
shift || true

case "$cmd" in
  ""|-h|--help|help)
    usage
    ;;
  ssh)
    exec ssh "$HOST"
    ;;
  status)
    need_host
    remote "set -e
for u in ${UNITS}; do systemctl is-active \$u; sudo systemctl status \$u --no-pager -l | head -8; echo; done
echo \"caddy: \$(systemctl is-active caddy)\"
echo
free -h
echo
df -h /
echo '--- ping :4001 ---'
curl -fsS --max-time 3 http://127.0.0.1:4001/api/ping || echo 'ping: not ready'"
    ;;
  logs)
    need_host
    n="${1:-80}"
    remote "sudo journalctl -u rail-core-query -u rail-core-ingest -u rail-core-kafka -u rail-core-ptac -n ${n} --no-pager"
    ;;
  follow)
    need_host
    remote_tty "sudo journalctl -u rail-core-query -u rail-core-ingest -u rail-core-kafka -u rail-core-ptac -f"
    ;;
  start)
    need_host
    remote "sudo systemctl start ${UNITS} && systemctl is-active ${UNITS}"
    ;;
  stop)
    need_host
    remote "sudo systemctl stop ${UNITS} && systemctl is-active ${UNITS} || true"
    ;;
  restart)
    need_host
    remote "sudo systemctl restart ${UNITS} && systemctl is-active ${UNITS}"
    ;;
  health)
    need_host
    remote "echo '--- ping :4001 ---'
curl -fsS --max-time 5 http://127.0.0.1:4001/api/ping || echo not-ready
echo
echo '--- PAD 1h ---'
curl -fsS --max-time 8 'http://127.0.0.1:4001/api/departures/PAD?hours=1' | head -c 400
echo"
    ;;
  reboot)
    need_host
    printf 'Reboot the Darwin VPS (%s)? Type yes: ' "$HOST"
    read -r answer
    if [ "$answer" != "yes" ]; then
      echo "Aborted."
      exit 1
    fi
    remote "sudo reboot" || true
    echo "Reboot sent."
    ;;
  fetch-tt)
    need_host
    remote "sudo systemctl start rail-core-tt && sudo journalctl -u rail-core-tt -n 40 --no-pager"
    ;;
  publish-rdm)
    root="$(cd "$(dirname "$0")/.." && pwd)"
    exec bash "$root/rail-core/scripts/publish-rdm-files.sh" "${1:-$HOME/Downloads}"
    ;;
  *)
    echo "Unknown command: $cmd" >&2
    usage
    exit 1
    ;;
esac
