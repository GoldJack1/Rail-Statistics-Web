#!/usr/bin/env python3
"""VPS-only: map legacy darwin .env → rail-core/.env. Run on the server as root."""
from pathlib import Path

legacy = Path("/home/darwin/darwin-local-test/.env")
dest = Path("/home/darwin/rail-core/.env")
kv = {}
for line in legacy.read_text().splitlines():
    line = line.strip()
    if not line or line.startswith("#") or "=" not in line:
        continue
    k, v = line.split("=", 1)
    kv[k.strip()] = v.strip().strip('"').strip("'")

brokers = kv.get("DARWIN_BOOTSTRAP") or kv.get("DARWIN_PUSH_BROKERS") or ""
out = {
    "QUERY_PORT": "4001",
    "INGEST_PORT": "4003",
    "DATA_DIR": "/home/darwin/rail-core/data",
    "TT_DIR": "/home/darwin/rail-core/tt",
    "RETENTION_DAYS": "30",
    "INTERNAL_API_KEY": kv.get("INTERNAL_API_KEY", ""),
    "DARWIN_PUSH_BROKERS": brokers,
    "DARWIN_PUSH_TOPIC": kv.get("DARWIN_TOPIC", ""),
    "DARWIN_PUSH_USERNAME": kv.get("DARWIN_USERNAME", ""),
    "DARWIN_PUSH_PASSWORD": kv.get("DARWIN_PASSWORD", ""),
    "DARWIN_PUSH_CONSUMER_GROUP": kv.get("DARWIN_GROUP_ID") or "rail-core",
    "INGEST_URL": "http://127.0.0.1:4003/ingest/darwin",
    "PTAC_ENABLED": "1",
    "SOURCE_HSP": "nrdp",
    "SOURCE_TIMETABLE": "nrdp",
    "NRDP_HSP_ORIGIN": "https://hsp-prod.rockshore.net",
    "NR_STOMP_HOST": "datafeeds.networkrail.co.uk",
    "NR_STOMP_PORT": "61618",
    "NR_RTPPM_TOPIC": "/topic/RTPPM_ALL",
    "NR_TRUST_TOPIC": "/topic/TRAIN_MVT_ALL_TOC",
}
lines = [f"{k}={v}\n" for k, v in out.items()]
dest.write_text("".join(lines))
dest.chmod(0o600)
print("wrote rail-core/.env keys:", ", ".join(out.keys()))
