"""Crop every per-car SVG to its solid body so neighbouring cars butt with no gap.

cut_cars.py crops each car to its painted bounding box, which can include couplers,
buffers or gangway details that stick out past the body. Joining cars on that box then
leaves visible gaps. This rasterises each car (headless Chrome), finds the rows that are
solid body (>=90% filled, nearly full width), and trims the viewBox to the leftmost and
rightmost body pixel. It also updates the widths in train-svgs/index.json.

Run after cut_cars.py and before publish_to_public.py.   python3 -I tighten_cars.py [--dry]
"""
import json, re, subprocess, sys, html
from pathlib import Path

HERE = Path(__file__).parent
OUT = HERE.parent.parent / "data" / "formation-images" / "train-svgs"
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
RASTER_W = 1600
MIN_TRIM = 0.3  # svg units (0.03 m); ignore smaller differences
DRY = "--dry" in sys.argv

JS = """
const files = %s;
const W = %d;
const out = {};
(async () => {
  for (const [name, svg] of Object.entries(files)) {
    const img = new Image();
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    try { await img.decode(); } catch (e) { out[name] = null; continue; }
    const H = Math.max(1, Math.round(img.naturalHeight * W / img.naturalWidth));
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d'); g.drawImage(img, 0, 0, W, H);
    const d = g.getImageData(0, 0, W, H).data;
    let L = W, R = -1;
    for (let y = 0; y < H; y++) {
      let first = -1, last = -1, n = 0;
      for (let x = 0; x < W; x++) { if (d[(y * W + x) * 4 + 3] > 40) { if (first < 0) first = x; last = x; n++; } }
      if (first < 0) continue;
      const span = last - first + 1;
      if (span >= 0.6 * W && n / span >= 0.9) { if (first < L) L = first; if (last > R) R = last; }
    }
    out[name] = R < 0 ? null : [L, W - 1 - R];
  }
  document.getElementById('out').textContent = JSON.stringify(out);
})();
"""


def measure(batch):
    files = {str(p.relative_to(OUT)): p.read_text() for p in batch}
    page = ("<!doctype html><body><pre id=out></pre><script>" + JS % (json.dumps(files), RASTER_W) + "</script>")
    tmp = HERE / "_tighten.html"
    tmp.write_text(page)
    res = subprocess.run([CHROME, "--headless", "--disable-gpu", "--no-sandbox", "--virtual-time-budget=60000",
                          "--dump-dom", f"file://{tmp}"], capture_output=True, text=True, timeout=600).stdout
    tmp.unlink()
    m = re.search(r'<pre id="out">(.*?)</pre>', res, re.S)
    return json.loads(html.unescape(m.group(1))) if m else {}


def main():
    cars = sorted(p for p in OUT.rglob("*.svg"))
    print(len(cars), "car files", flush=True)
    index = json.load(open(OUT / "index.json"))
    changed = 0
    worst = []
    for i in range(0, len(cars), 25):
        batch = cars[i:i + 25]
        res = measure(batch)
        for p in batch:
            rel = str(p.relative_to(OUT))
            r = res.get(rel)
            if not r:
                continue
            s = p.read_text()
            m = re.search(r'viewBox="([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+)"', s)
            x, y, w, h = (float(v) for v in m.groups())
            unit = w / RASTER_W
            tl, tr = r[0] * unit, r[1] * unit
            if tl < MIN_TRIM and tr < MIN_TRIM:
                continue
            worst.append((round(tl + tr, 2), rel))
            nx, nw = x + tl, w - tl - tr
            if nw < w * 0.5:
                print("  skip (would remove >50%):", rel)
                continue
            changed += 1
            if not DRY:
                s = s.replace(m.group(0), f'viewBox="{nx:.2f} {y} {nw:.2f} {h}"', 1)
                p.write_text(s)
                group, slug, op, code = rel[:-4].split("/")
                try:
                    index["classes"][slug]["operators"][op]["sizes"][code] = round(nw, 2)
                except KeyError:
                    pass
        print("  done", min(i + 25, len(cars)), flush=True)
    if not DRY:
        (OUT / "index.json").write_text(json.dumps(index, indent=1))
    worst.sort(reverse=True)
    print("trimmed", changed, "of", len(cars))
    print("largest trims (svg units, 10 = 1 m):", worst[:15])


if __name__ == "__main__":
    main()
