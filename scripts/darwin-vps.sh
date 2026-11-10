#!/usr/bin/env bash
# Local helper for the London Darwin VPS (rail-core live + staging query).
# Uses SSH host alias `rail-core-lon` (see ~/.ssh/config).
set -euo pipefail

HOST="${DARWIN_VPS_HOST:-rail-core-lon}"
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
  rail-graph   Copy the passenger rail file to dev and live, then restart query
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
  rail-graph)
    need_host
    root="$(cd "$(dirname "$0")/.." && pwd)"
    src="$root/new-site/public/data/gb-passenger-rail.json"
    if [ ! -f "$src" ]; then
      echo "Missing $src" >&2
      exit 1
    fi
    scp "$src" "$HOST:/tmp/gb-passenger-rail.json"
    remote "python3 - << 'PY'
import os, shutil
pairs = [
    ('/home/darwin/rail-core-dev/.env', 'rail-core-query-dev'),
    ('/home/darwin/rail-core/.env', 'rail-core-query'),
]
src = '/tmp/gb-passenger-rail.json'
for envf, unit in pairs:
    if not os.path.isfile(envf):
        print('skip', envf)
        continue
    data = None
    with open(envf) as fh:
        for line in fh:
            line = line.strip()
            if line.startswith('DATA_DIR='):
                data = line.split('=', 1)[1].strip().strip(chr(34)).strip(chr(39))
    if not data:
        data = os.path.join(os.path.dirname(envf), 'data')
    os.makedirs(data, exist_ok=True)
    dest = os.path.join(data, 'gb-passenger-rail.json')
    shutil.copyfile(src, dest)
    print('installed', dest, 'restart', unit)
    os.system('sudo systemctl restart ' + unit)
PY"
    ;;
  *)
    echo "Unknown command: $cmd" >&2
    usage
    exit 1
    ;;
esac
