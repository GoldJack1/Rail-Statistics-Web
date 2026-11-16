"""Build the set of per-car SVGs the apps use, ready to put on the VPS.

Only classes seen on the site (see /units) and only the non-raised drawings are included.
Re-run after cut_cars.py / tighten_cars.py, then upload with rail-core/scripts/deploy-drawings.sh.

Output (local, not committed): data/formation-images/publish/
    index.json                                  classes, formations, car widths and heights, credit, "png", "version"
    <group>/<class>/<operator>/<CODE>.svg
    <group>/<class>/<operator>/<CODE>.png       the same car pre-rendered at PNG_PX_PER_UNIT, for clients
                                                that cannot draw SVG (iOS; index.png.pxPerUnit says the scale)
The VPS serves these at /api/drawings/... (see rail-core/src/drawings-route.js). "version" is a
hash of every file, so clients re-fetch cars the moment the art changes.
"""
import base64, hashlib, html, json, re, shutil, subprocess
from pathlib import Path

ROOT = Path(__file__).parent.parent.parent
SRC = ROOT / "data" / "formation-images" / "train-svgs"
DST = ROOT / "data" / "formation-images" / "publish"
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
PNG_PX_PER_UNIT = 2.0  # art is 10 units per metre: a 26 m car is about 520 px wide

CLASSES = ("150 153 155 156 158 159 165 166 168 170 171 172 175 180 185 195 196 197 220 221 222 230 231 "
           "318 320 323 331 333 334 345 350 357 360 375 376 377 379 380 385 387 390 395 397 398 444 450 "
           "458 465 466 484 700 701 707 717 720 730 745 755 756 769 777 800 801 802 803 805 807 810 "
           "139 399 t-w-555 ic125 ic225").split()

def rasterize(svg_files):
    """Render each car SVG to a PNG next to it, using headless Chrome (canvas), PNG_PX_PER_UNIT px per unit."""
    js = """
    const files = %s; const out = {};
    (async () => {
      for (const f of files) {
        const img = new Image();
        img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(f.svg);
        try { await img.decode(); } catch (e) { out[f.name] = null; continue; }
        const c = document.createElement('canvas'); c.width = f.w; c.height = f.h;
        c.getContext('2d').drawImage(img, 0, 0, f.w, f.h);
        out[f.name] = c.toDataURL('image/png').split(',')[1];
      }
      document.getElementById('out').textContent = JSON.stringify(out);
    })();
    """
    tmp = Path(__file__).parent / "_raster.html"
    done = 0
    for i in range(0, len(svg_files), 20):
        batch = []
        for p in svg_files[i:i + 20]:
            text = p.read_text()
            m = re.search(r'viewBox="([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+)"', text)
            w, h = float(m.group(3)), float(m.group(4))
            batch.append({"name": str(p), "svg": text,
                          "w": max(1, round(w * PNG_PX_PER_UNIT)), "h": max(1, round(h * PNG_PX_PER_UNIT))})
        tmp.write_text("<!doctype html><body><pre id=out></pre><script>" + js % json.dumps(batch) + "</script>")
        res = subprocess.run([CHROME, "--headless", "--disable-gpu", "--no-sandbox", "--virtual-time-budget=60000",
                              "--dump-dom", f"file://{tmp}"], capture_output=True, text=True, timeout=600).stdout
        m = re.search(r'<pre id="out">(.*?)</pre>', res, re.S)
        data = json.loads(html.unescape(m.group(1))) if m else {}
        for name, b64 in data.items():
            if not b64:
                raise SystemExit("could not rasterize " + name)
            Path(name).with_suffix(".png").write_bytes(base64.b64decode(b64))
            done += 1
    tmp.unlink(missing_ok=True)
    return done


idx = json.load(open(SRC / "index.json"))
out = {"credit": idx["credit"], "licence": idx["licence"], "licenceUrl": idx["licenceUrl"],
       "source": idx["source"], "classes": {}}
if DST.exists():
    shutil.rmtree(DST)
n = 0
for c in CLASSES:
    e = idx["classes"].get(c)
    if not e:
        print("missing", c)
        continue
    ops = {}
    for op, d in e["operators"].items():
        forms = {k: v for k, v in d["formations"].items() if k in ("standard", "2car")}
        codes = {x["car"] for f in forms.values() for x in f}
        if not codes:
            continue
        heights = {}
        for code in codes:
            vb = re.search(r'viewBox="[-\d.]+ [-\d.]+ [-\d.]+ ([-\d.]+)"', (SRC / e["group"] / c / op / f"{code}.svg").read_text())
            heights[code] = round(float(vb.group(1)), 2)
        ops[op] = {"formations": forms, "sizes": {k: d["sizes"][k] for k in codes}, "heights": heights}
        for code in codes:
            src = SRC / e["group"] / c / op / f"{code}.svg"
            dst = DST / e["group"] / c / op / f"{code}.svg"
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(src, dst)
            n += 1
    out["classes"][c] = {"group": e["group"], "operators": ops}
n_png = rasterize(sorted(DST.rglob("*.svg")))
print("png cars", n_png)
out["png"] = {"pxPerUnit": PNG_PX_PER_UNIT}
h = hashlib.sha256()
for f in sorted(DST.rglob("*.svg")):
    h.update(str(f.relative_to(DST)).encode())
    h.update(f.read_bytes())
h.update(json.dumps(out, sort_keys=True).encode())
out["version"] = h.hexdigest()[:12]
(DST / "index.json").write_text(json.dumps(out, separators=(",", ":")))
tot = sum(f.stat().st_size for f in DST.rglob("*") if f.is_file())
print("classes", len(out["classes"]), "files", n, f"{tot/1e6:.1f} MB")
