"""List candidate Wikimedia Commons images for UK rail classes.

Usage: python3 -I commons_list.py 800 801 802 ...
Writes candidates-<class>.json next to this script (title, url, size, licence,
author, categories hit). Polite: 1 request / 3 s, backs off on HTTP 429.
"""
import json, sys, time, urllib.parse, urllib.request
from pathlib import Path

UA = "RailStatsFormationResearch/1.0 (non-commercial rail statistics project)"
OUT = Path(__file__).parent / "candidates"
OUT.mkdir(exist_ok=True)


def api(**p):
    p["format"] = "json"
    url = "https://commons.wikimedia.org/w/api.php?" + urllib.parse.urlencode(p)
    for attempt in range(6):
        time.sleep(3)
        try:
            return json.load(urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA})))
        except urllib.error.HTTPError as e:
            wait = int(e.headers.get("retry-after", "40")) + 5
            print(f"  HTTP {e.code}, waiting {wait}s", file=sys.stderr)
            time.sleep(wait)
    return {}


def files_in_category(cat, limit=200):
    d = api(
        action="query", generator="categorymembers", gcmtitle=cat, gcmtype="file",
        gcmlimit=limit, prop="imageinfo", iiprop="url|size|mime|extmetadata",
        iiextmetadatafilter="LicenseShortName|Artist|Credit|ImageDescription",
    )
    out = []
    for page in d.get("query", {}).get("pages", {}).values():
        ii = (page.get("imageinfo") or [{}])[0]
        md = ii.get("extmetadata", {})
        out.append({
            "title": page["title"],
            "url": ii.get("url"),
            "mime": ii.get("mime"),
            "width": ii.get("width"),
            "height": ii.get("height"),
            "licence": md.get("LicenseShortName", {}).get("value"),
            "author": md.get("Artist", {}).get("value"),
            "description": md.get("ImageDescription", {}).get("value"),
            "category": cat,
        })
    return out


for cls in sys.argv[1:]:
    cat = f"Category:British Rail Class {cls}"
    print("==", cat)
    items = files_in_category(cat)
    (OUT / f"{cls}.json").write_text(json.dumps(items, indent=1))
    svgs = [i for i in items if i["mime"] == "image/svg+xml"]
    print(f"  {len(items)} files, {len(svgs)} svg")
    for i in svgs:
        print("   SVG", i["title"], i["licence"])
