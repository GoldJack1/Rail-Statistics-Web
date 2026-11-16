"""Download WestRail642fan's UK side-on train drawings from Wikimedia Commons.

Reads westrail_uploads.json (from the allimages listing), skips non-rail and
non-UK items, fetches url + licence metadata in batches, downloads each PNG to
data/formation-images/<class>/ and writes data/formation-images/manifest.json
(licence, author, source page) so attribution can be shown on the site.
Polite: ~1 request / 3 s, honours Retry-After.
"""
import json, re, sys, time, urllib.parse, urllib.request
from pathlib import Path

UA = "RailStatsFormationResearch/1.0 (non-commercial rail statistics project)"
HERE = Path(__file__).parent
OUT = HERE.parent.parent / "data" / "formation-images"
OUT.mkdir(parents=True, exist_ok=True)
SKIP = ("HMS_", "Odakyu", "SBB_", "Amtrak", "Keisei", "Gautrain", "Acela")


def get(url):
    for _ in range(6):
        time.sleep(3)
        try:
            return urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA})).read()
        except urllib.error.HTTPError as e:
            wait = int(e.headers.get("retry-after", "40")) + 5
            print(f"HTTP {e.code}, waiting {wait}s", flush=True)
            time.sleep(wait)
    raise SystemExit("giving up: " + url)


def api(**p):
    p["format"] = "json"
    return json.loads(get("https://commons.wikimedia.org/w/api.php?" + urllib.parse.urlencode(p)))


names = [
    i["name"] for i in json.load(open(HERE / "westrail_uploads.json"))
    if i["name"].lower().endswith(".png") and not i["name"].startswith(SKIP)
]
print(len(names), "files", flush=True)

manifest = {}
for k in range(0, len(names), 40):
    batch = names[k:k + 40]
    d = api(
        action="query", prop="imageinfo", iiprop="url|size|extmetadata",
        iiextmetadatafilter="LicenseShortName|Artist|LicenseUrl",
        titles="|".join("File:" + n for n in batch),
    )
    for page in d["query"]["pages"].values():
        ii = page["imageinfo"][0]
        md = ii.get("extmetadata", {})
        name = page["title"][5:].replace(" ", "_")
        m = re.search(r"Class[_ ](\d{3})", name)
        cls = m.group(1) if m else "other"
        manifest[name] = {
            "class": cls,
            "file": f"{cls}/{name}",
            "width": ii["width"], "height": ii["height"],
            "source": "https://commons.wikimedia.org/wiki/" + urllib.parse.quote(page["title"].replace(" ", "_")),
            "licence": md.get("LicenseShortName", {}).get("value"),
            "licenceUrl": md.get("LicenseUrl", {}).get("value"),
            "author": "WestRail642fan",
            "_url": ii["url"],
        }

for n, (name, m) in enumerate(sorted(manifest.items()), 1):
    dest = OUT / m["file"]
    if dest.exists():
        continue
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(get(m["_url"]))
    print(f"{n}/{len(manifest)} {m['file']}", flush=True)

for m in manifest.values():
    m.pop("_url", None)
(OUT / "manifest.json").write_text(json.dumps(manifest, indent=1, sort_keys=True))
print("done", len(manifest))
