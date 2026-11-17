"""Build the set of per-car SVGs the apps use, ready to put on the VPS.

Only classes seen on the site (see /units) and only the non-raised drawings are included.
Re-run after cut_cars.py / tighten_cars.py, then upload with rail-core/scripts/deploy-drawings.sh.

Output (local, not committed): data/formation-images/publish/
    index.json                                  classes, formations, car widths, heights and end insets, credit, "png", "version"
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
        const g = c.getContext('2d'); g.drawImage(img, 0, 0, f.w, f.h);
        // How far the solid body starts in from each end (pixels). Body rows are the rows that are solid
        // across nearly the whole car; an end counts as reached where half of those rows are filled.
        const W = f.w, H = f.h, d = g.getImageData(0, 0, W, H).data, body = [];
        for (let y = 0; y < H; y++) {
          let first = -1, last = -1, n = 0;
          for (let x = 0; x < W; x++) { if (d[(y*W+x)*4+3] > 40) { if (first < 0) first = x; last = x; n++; } }
          if (first < 0) continue;
          const span = last - first + 1;
          if (span >= 0.6 * W && n / span >= 0.9) body.push(y);
        }
        let ins = [0, 0];
        if (body.length) {
          const frac = (x) => { let k = 0; for (const y of body) if (d[(y*W+x)*4+3] > 40) k++; return k / body.length; };
          let L = 0; while (L < W && frac(L) < 0.5) L++;
          let R = 0; while (R < W && frac(W - 1 - R) < 0.5) R++;
          ins = [L, R];
        }
        out[f.name] = { png: c.toDataURL('image/png').split(',')[1], ins };
      }
      document.getElementById('out').textContent = JSON.stringify(out);
    })();
    """
    tmp = Path(__file__).parent / "_raster.html"
    done = 0
    insets = {}
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
        for name, item in data.items():
            if not item:
                raise SystemExit("could not rasterize " + name)
            Path(name).with_suffix(".png").write_bytes(base64.b64decode(item["png"]))
            insets[name] = [round(item["ins"][0] / PNG_PX_PER_UNIT, 1), round(item["ins"][1] / PNG_PX_PER_UNIT, 1)]
            done += 1
    tmp.unlink(missing_ok=True)
    return done, insets


def _car_parts(path):
    """viewBox numbers and the drawing inside <g>...</g> of a cut car SVG."""
    text = path.read_text()
    vb = [float(v) for v in re.search(r'viewBox="([^"]+)"', text).group(1).split()]
    inner = re.search(r"<g>(.*)</g></svg>\s*$", text, re.S).group(1)
    return vb, inner


def _suffix_ids(inner, suffix):
    for ident in sorted(set(re.findall(r'\bid="([^"]+)"', inner)), key=len, reverse=True):
        inner = (inner.replace(f'id="{ident}"', f'id="{ident}{suffix}"')
                 .replace(f"url(#{ident})", f"url(#{ident}{suffix})")
                 .replace(f'href="#{ident}"', f'href="#{ident}{suffix}"'))
    return inner


def make_middle_car(car_dir, a_code, b_code, out_code, slug):
    """A middle car (no cab) in an operator's livery, for a 3-car set drawn only as two cab cars.

    Each cab car's art has the cab at the left and a plain gangway end at the right (the far car is the
    same art mirrored). The middle car is the plain right half of car A, with the plain right half of car B
    mirrored in front of it, so both ends are gangway ends and the livery matches the cab cars.
    Returns (width, height) in drawing units.
    """
    (xa, ya, wa, ha), inner_a = _car_parts(car_dir / f"{a_code}.svg")
    (xb, yb, wb, hb), inner_b = _car_parts(car_dir / f"{b_code}.svg")
    half_a, half_b = wa / 2, wb / 2
    mid_a, mid_b = xa + half_a, xb + half_b
    total = half_a + half_b
    inner_b = _suffix_ids(inner_b, "-m")
    credit = "Drawing: GB Trains, gbtrains.uk, CC BY 4.0"
    svg = (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 {ya} {total:.2f} {ha}" role="img" '
        f'aria-label="Class {slug} car {out_code}"><title>Class {slug} car {out_code}</title>'
        f"<!-- {credit}. Licence CC BY 4.0 https://creativecommons.org/licenses/by/4.0/ "
        f"Source https://gbtrains.uk/stock/{slug}/. Middle car assembled from the plain halves of the two cab cars. -->"
        f"<desc>Assembled from the GB Trains drawing. {credit}.</desc>"
        f'<defs><clipPath id="mid-right"><rect x="{mid_a:.2f}" y="{ya - 5}" width="{half_a + 1:.2f}" height="{ha + 10}"/></clipPath>'
        f'<clipPath id="mid-left"><rect x="{mid_b:.2f}" y="{yb - 5}" width="{half_b + 1:.2f}" height="{hb + 10}"/></clipPath></defs>'
        f'<g transform="translate({half_b - mid_a:.3f} 0)"><g clip-path="url(#mid-right)">{inner_a}</g></g>'
        f'<g transform="translate({half_b + mid_b:.3f} 0) scale(-1 1)"><g clip-path="url(#mid-left)">{inner_b}</g></g>'
        "</svg>"
    )
    (car_dir / f"{out_code}.svg").write_text(svg)
    return round(total, 2), round(ha, 2)


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
        forms = {k: v for k, v in d["formations"].items() if k == "standard" or re.fullmatch(r"\d+car", k)}
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
    # An operator drawn only as two cab cars gets a 3-car set in its own livery when the class is also
    # drawn in 3 cars in the generic art (170, 165): a middle car assembled from its cab cars. Without
    # this a 3-car Northern 170 would be drawn in the generic (ScotRail) livery.
    base_lens = {len(f) for f in ops.get("base", {}).get("formations", {}).values()}
    for op, art in ops.items():
        std = art["formations"].get("standard", [])
        has_len3 = any(len(f) == 3 for f in art["formations"].values())
        if (op == "base" or 3 not in base_lens or has_len3 or len(std) != 2
                or std[0]["flip"] or not std[1]["flip"]):
            continue
        car_dir = DST / e["group"] / c / op
        mid_code = "MIDX"
        w, h = make_middle_car(car_dir, std[0]["car"], std[1]["car"], mid_code, c)
        art["sizes"][mid_code] = w
        art["heights"][mid_code] = h
        art["formations"]["3car"] = [std[0], {"car": mid_code, "flip": False}, std[1]]
        print("  middle car for", c, op)
    out["classes"][c] = {"group": e["group"], "operators": ops}
n_png, insets = rasterize(sorted(DST.rglob("*.svg")))
print("png cars", n_png)
# Publish each car's end insets (drawing units, left and right as drawn) so a client can close the gap at a
# joint exactly: the gap is the first car's right inset plus the next car's left inset.
for cls_id, entry in out["classes"].items():
    for op_id, art in entry["operators"].items():
        art["insets"] = {
            code: insets.get(str(DST / entry["group"] / cls_id / op_id / f"{code}.svg"), [0, 0])
            for code in art["sizes"]
        }
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
