"""Download GB Trains (gbtrains.uk) side-elevation SVGs for the classes we use.

Licence: CC BY 4.0. Credit required: "Drawing: GB Trains, gbtrains.uk, CC BY 4.0"
linked to the class page; the credit embedded in each SVG must stay.
Writes data/formation-images/gbtrains/<slug>/*.svg and gbtrains/manifest_all_rest.json.
Polite: honours robots.txt disallow for /assets, 1.5 s between requests.
"""
import json, re, sys, time, urllib.request, urllib.error
from pathlib import Path

BASE = "https://gbtrains.uk"
UA = "RailStatsFormationResearch/1.0 (non-commercial rail statistics project)"
OUT = Path(__file__).parent.parent.parent / "data" / "formation-images" / "gbtrains"
OUT.mkdir(parents=True, exist_ok=True)

def _slugs():
    html = get(BASE + "/stock/classes/") or ""
    found = sorted(set(re.findall(r'href="/stock/([A-Za-z0-9_\-]+)/"', html)))
    skip = {"classes", "compare"}
    return [x for x in found if x not in skip and not (OUT / x).exists()]
SLUGS = None


def get(url, binary=False):
    for _ in range(5):
        time.sleep(1.5)
        try:
            d = urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=30).read()
            return d if binary else d.decode("utf-8", "replace")
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            wait = int(e.headers.get("retry-after", "30")) + 5
            print(f"HTTP {e.code} {url}, waiting {wait}s", flush=True)
            time.sleep(wait)
    return None


robots = get(BASE + "/robots.txt") or ""
print("robots.txt:\n" + robots[:600], flush=True)
if re.search(r"(?im)^disallow:\s*/(assets|stock)", robots):
    raise SystemExit("robots.txt disallows /assets or /stock - stopping")

SLUGS = _slugs()
print(len(SLUGS), "new class pages", flush=True)
manifest = {}
for slug in SLUGS:
    page = f"{BASE}/stock/{slug}/"
    html = get(page)
    if not html:
        print("no page", slug, flush=True)
        continue
    links = sorted(set(re.findall(r'/assets/svg/stock/[A-Za-z0-9_\-./]+?\.svg(?:\?v=[0-9a-f]+)?', html)))
    for link in links:
        path = link.split("?")[0]
        name = path.rsplit("/", 1)[1]
        dest = OUT / slug / name
        if not dest.exists():
            data = get(BASE + link, binary=True)
            if not data or b"<svg" not in data[:2000]:
                continue
            dest.parent.mkdir(exist_ok=True)
            dest.write_bytes(data)
        manifest[f"{slug}/{name}"] = {
            "class": slug, "file": f"gbtrains/{slug}/{name}", "page": page,
            "kind": "download" if "/dl/" in path else "livery",
            "author": "GB Trains", "licence": "CC BY 4.0",
            "licenceUrl": "https://creativecommons.org/licenses/by/4.0/",
            "credit": "Drawing: GB Trains, gbtrains.uk, CC BY 4.0",
        }
    print(f"{slug}: {len(links)} svg", flush=True)
    (OUT / "manifest_all_rest.json").write_text(json.dumps(manifest, indent=1, sort_keys=True))
print("done", len(manifest))
