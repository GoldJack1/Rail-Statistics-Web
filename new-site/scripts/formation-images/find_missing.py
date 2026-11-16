"""Search Commons (any uploader) for side-on drawings of the classes WestRail642fan lacks.

Looks for PNG/SVG files whose title mentions the class and is wide-and-short
(aspect ratio >= 6:1), which is what the formation strips look like.
Writes missing_found.json and prints a summary.
"""
import json, sys, time, urllib.parse, urllib.request

UA = "RailStatsFormationResearch/1.0 (non-commercial rail statistics project)"
MISSING = ["150", "153", "155", "156", "159", "318", "320", "323", "222", "253", "398",
           "333", "810", "769", "484", "230", "139", "68", "91", "57", "5", "4"]


def api(**p):
    p["format"] = "json"
    url = "https://commons.wikimedia.org/w/api.php?" + urllib.parse.urlencode(p)
    for _ in range(6):
        time.sleep(4)
        try:
            return json.load(urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA})))
        except urllib.error.HTTPError as e:
            wait = int(e.headers.get("retry-after", "40")) + 5
            print(f"  HTTP {e.code}, waiting {wait}s", file=sys.stderr, flush=True)
            time.sleep(wait)
    return {}


found = {}
for cls in MISSING:
    hits = {}
    for q in (f'intitle:"Class {cls}" filetype:bitmap', f'intitle:"Class {cls}" filetype:drawing',
              f'intitle:"Class_{cls}" side diagram livery'):
        d = api(action="query", generator="search", gsrsearch=q, gsrnamespace=6, gsrlimit=40,
                prop="imageinfo", iiprop="url|size|extmetadata",
                iiextmetadatafilter="LicenseShortName|Artist")
        for p in d.get("query", {}).get("pages", {}).values():
            ii = (p.get("imageinfo") or [{}])[0]
            w, h = ii.get("width") or 0, ii.get("height") or 1
            if w / h >= 5:  # wide strip, not a photo
                md = ii.get("extmetadata", {})
                hits[p["title"]] = {
                    "w": w, "h": h, "licence": md.get("LicenseShortName", {}).get("value"),
                    "author": md.get("Artist", {}).get("value"), "url": ii.get("url"),
                }
    found[cls] = hits
    print(f"== {cls}: {len(hits)}", flush=True)
    for t, v in hits.items():
        print(f"   {v['w']}x{v['h']} {t} | {v['licence']}", flush=True)

json.dump(found, open("missing_found.json", "w"), indent=1)
