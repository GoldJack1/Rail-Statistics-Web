#!/usr/bin/env bash
# Local helper for the netcup Darwin VPS.
# Uses SSH host alias `netcup-darwin` (see ~/.ssh/config).
set -euo pipefail

HOST="${DARWIN_VPS_HOST:-netcup-darwin}"
SERVICE="${DARWIN_VPS_SERVICE:-darwin}"
REMOTE_DIR="${DARWIN_VPS_DIR:-/home/darwin/darwin-local-test}"

usage() {
  cat <<'EOF'
Run this on your Mac, from the website repo (not after you SSH into the VPS):

  ./scripts/darwin-vps.sh <command>

This script SSHs to host alias `netcup-darwin` for you.

  ssh         Open an SSH session as darwin (no password)
  status      Service, memory, disk, local ping
  logs [N]    Last N journal lines (default 80)
  follow      Live daemon logs
  start       Start darwin
  stop        Stop darwin
  restart     Restart darwin
  health      Local /api/ping and a short /api/health
  data        Disk use, history days, unit-catalog days
  fetch       Download today's PPTimetable files from GCS now
  reboot      Reboot the VPS (asks yes first)

Already on the VPS? Use: darwin-vps status
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
sudo systemctl status ${SERVICE} --no-pager -l | head -35
echo
echo \"caddy: \$(systemctl is-active caddy 2>/dev/null || echo unknown)  darwin: \$(systemctl is-active ${SERVICE})\"
echo
free -h
echo
df -h /
echo
curl -fsS --max-time 3 http://127.0.0.1:4001/api/ping || echo 'ping: not ready'"
    ;;
  logs)
    need_host
    n="${1:-80}"
    remote "sudo journalctl -u ${SERVICE} -n ${n} --no-pager"
    ;;
  follow)
    need_host
    remote_tty "sudo journalctl -u ${SERVICE} -f"
    ;;
  start)
    need_host
    remote "sudo systemctl start ${SERVICE} && systemctl is-active ${SERVICE}"
    ;;
  stop)
    need_host
    remote "sudo systemctl stop ${SERVICE} && systemctl is-active ${SERVICE} || true"
    ;;
  restart)
    need_host
    remote "sudo systemctl restart ${SERVICE} && systemctl is-active ${SERVICE}"
    ;;
  health)
    need_host
    remote "echo '--- ping ---'
curl -fsS --max-time 5 http://127.0.0.1:4001/api/ping || echo not-ready
echo
echo '--- health (truncated) ---'
curl -fsS --max-time 12 http://127.0.0.1:4001/api/health | head -c 2000
echo"
    ;;
  data)
    need_host
    remote "set -e
cd ${REMOTE_DIR}
echo '=== sizes ==='
du -sh . state state/history state/unit-catalog.json ttis 2>/dev/null || true
echo
echo '=== disk ==='
df -h /
echo
echo '=== history days ==='
ls -1 state/history 2>/dev/null | tail -n 40 || echo '(none)'
echo
echo '=== unit-catalog days ==='
python3 - <<'PY'
import json, os, re
p = '${REMOTE_DIR}/state/unit-catalog.json'
iso = re.compile(r'^\\d{4}-\\d{2}-\\d{2}$')
if not os.path.isfile(p):
    print('(no unit-catalog.json)')
    raise SystemExit
with open(p) as f:
    data = json.load(f)
days = set()
for pair in data.get('units') or []:
    entry = pair[1] if isinstance(pair, list) and len(pair) > 1 else pair
    if not isinstance(entry, dict):
        continue
    miles = entry.get('endOfDayMileageByDate') or {}
    if isinstance(miles, dict):
        days.update(k for k in miles if iso.match(str(k)))
    for svc in entry.get('services') or []:
        if isinstance(svc, dict):
            for key in ('date', 'day', 'operatingDay'):
                v = svc.get(key)
                if iso.match(str(v or '')):
                    days.add(v)
print('\\n'.join(sorted(days)) if days else '(no ISO days found)')
print('units:', len(data.get('units') or []))
print('savedAt:', data.get('savedAt') or '')
PY"
    ;;
  fetch)
    need_host
    remote "set -euo pipefail
export GOOGLE_APPLICATION_CREDENTIALS=/home/darwin/.config/gcloud/tt-fetch-sa.json
export CLOUDSDK_CORE_PROJECT=rail-statistics
export GSUTIL_PATH=/usr/bin/gsutil
cd ${REMOTE_DIR}
/usr/bin/node fetch-daily-timetables.mjs
ls -1 tt | tail -20"
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
  *)
    echo "Unknown command: $cmd" >&2
    usage
    exit 1
    ;;
esac
