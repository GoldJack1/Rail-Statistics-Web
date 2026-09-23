#!/bin/bash
# Run ON the VPS as root (after: ssh root@159.195.214.118)
# Cockpit listens only on 127.0.0.1:9090 — not on the public internet.
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y cockpit
mkdir -p /etc/systemd/system/cockpit.socket.d
cat >/etc/systemd/system/cockpit.socket.d/listen.conf <<'EOF'
[Socket]
ListenStream=
ListenStream=127.0.0.1:9090
EOF
cat >/etc/cockpit/cockpit.conf <<'EOF'
[WebService]
AllowUnencrypted = true
ProtocolHeader = X-Forwarded-Proto
EOF
systemctl daemon-reload
systemctl enable --now cockpit.socket
ss -tlnp | grep 9090 || true
ufw status || true
echo "Cockpit is localhost-only. From your Mac:"
echo "  ssh -N -L 9090:127.0.0.1:9090 root@159.195.214.118"
echo "Then open http://127.0.0.1:9090  (log in as darwin, not root)"
