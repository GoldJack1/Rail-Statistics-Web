"""Cut GB Trains whole-train SVG drawings into one SVG per car.

Input : data/formation-images/gbtrains/<slug>/*.svg  (base, -liv-<operator>, -raised; -x2 skipped)
Output: data/formation-images/train-svgs/<group>/<slug>/<operator>/<CODE>.svg
        data/formation-images/train-svgs/index.json   (classes sorted, formations as ordered car lists)

Naming follows RTT's folder idea (<class group>/<operator>/<car code>), with the class folder added
so cars from different classes in one group (e.g. 800 and 801 in 80x) never collide.
Car codes here are END (end/cab vehicle) and MID (intermediate), numbered when art differs
(END, END2, MID, MID2...). "-raised" art (pantographs up) gets a "-raised" suffix.
Each drawing is already one <g> per car; widths are measured by headless Chrome (getBBox).

Credit: every output file keeps "Drawing: GB Trains, gbtrains.uk, CC BY 4.0".
"""
import hashlib, json, re, subprocess, sys, html
import xml.etree.ElementTree as ET
from pathlib import Path

HERE = Path(__file__).parent
ROOT = HERE.parent.parent / "data" / "formation-images"
SRC = ROOT / "gbtrains"
OUT = ROOT / "train-svgs"
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
NS = "http://www.w3.org/2000/svg"
ET.register_namespace("", NS)
CREDIT = "Drawing: GB Trains, gbtrains.uk, CC BY 4.0"


def tag(e):
    return e.tag.split("}")[1] if "}" in e.tag else e.tag


def class_group(slug):
    return slug[:2] + "x" if re.fullmatch(r"\d{3}", slug) else slug


def parse_name(slug, fname):
    stem = fname[:-4]
    if stem.endswith("-x2"):
        return None
    rest = stem[len(slug):] if stem.startswith(slug) else stem
    raised = rest.endswith("-raised")
    if raised:
        rest = rest[: -len("-raised")]
    two = rest.endswith("-2car")
    if two:
        rest = rest[: -len("-2car")]
    m = re.fullmatch(r"-liv-(.+)", rest)
    op = m.group(1) if m else ("base" if rest == "" else None)
    if op is None:
        return None
    return op, raised, two


def car_groups(root):
    # Cars are top-level groups with a transform and no class. Classed groups are
    # overlays ("credit", "ole" = overhead wire in the raised-pantograph drawings).
    return [e for e in root if tag(e) == "g" and e.get("transform") and not e.get("class")]


def measure(files):
    """Return {file: [(x0, x1), ...]} local bbox x-range per car group, via Chrome getBBox."""
    result = {}
    batch = []
    def run(batch):
        parts = ["<!doctype html><body>"]
        for i, f in enumerate(batch):
            s = f.read_text()
            s = re.sub(r"^<\?xml[^>]*\?>", "", s).strip()
            s = s.replace("<svg ", f'<svg data-i="{i}" ', 1)
            parts.append(s)
        parts.append("<pre id=out></pre><script>const o=[];document.querySelectorAll('svg[data-i]').forEach(s=>{"
                     "const gs=[...s.children].filter(e=>e.tagName==='g'&&e.getAttribute('transform')&&!e.getAttribute('class'));"
                     "o.push(gs.map(g=>{const b=g.getBBox();return [b.x,b.x+b.width]}))});"
                     "document.getElementById('out').textContent=JSON.stringify(o)</script>")
        tmp = HERE / "_measure.html"
        tmp.write_text("".join(parts))
        out = subprocess.run([CHROME, "--headless", "--disable-gpu", "--no-sandbox", "--virtual-time-budget=4000",
                              "--dump-dom", f"file://{tmp}"], capture_output=True, text=True, timeout=300).stdout
        m = re.search(r'<pre id="out">(.*?)</pre>', out, re.S)
        data = json.loads(html.unescape(m.group(1)))
        for f, boxes in zip(batch, data):
            result[f] = boxes
        tmp.unlink()
    for f in files:
        batch.append(f)
        if len(batch) == 40:
            run(batch); batch = []
            print("  measured", len(result), flush=True)
    if batch:
        run(batch)
    return result


def inner_xml(g):
    s = "".join(ET.tostring(c, encoding="unicode") for c in g)
    return re.sub(r' xmlns(:\w+)?="[^"]+"', "", s)


def main():
    files = []
    for d in sorted(SRC.iterdir()):
        if not d.is_dir():
            continue
        for f in sorted(d.glob("*.svg")):
            if parse_name(d.name, f.name):
                files.append(f)
    print(len(files), "drawings to cut", flush=True)
    boxes = measure(files)

    index = {}
    for f in files:
        slug = f.parent.name
        op, raised, two = parse_name(slug, f.name)
        root = ET.parse(f).getroot()
        vb = [float(v) for v in root.get("viewBox").split()]
        groups = car_groups(root)
        bb = boxes[f]
        if not groups or len(groups) != len(bb):
            print("skip (no cars):", f.name)
            continue
        cls_dir = OUT / class_group(slug) / slug / op
        cls_dir.mkdir(parents=True, exist_ok=True)
        entry = index.setdefault(slug, {"group": class_group(slug), "operators": {}})
        opd = entry["operators"].setdefault(op, {"cars": {}, "formations": {}})
        codes = opd["cars"]  # hash -> code, shared across this operator's drawings
        counters = opd.setdefault("_counters", {})
        formation = []
        n = len(groups)
        for i, (g, (x0, x1)) in enumerate(zip(groups, bb)):
            inner = inner_xml(g)
            flip = "scale(-1" in (g.get("transform") or "")
            key = hashlib.md5(inner.encode()).hexdigest()[:10] + ("r" if raised else "")
            if key not in codes:
                role = "END" if i in (0, n - 1) and n > 1 else ("SINGLE" if n == 1 else "MID")
                counters[role] = counters.get(role, 0) + 1
                code = role + ("" if counters[role] == 1 else str(counters[role])) + ("-raised" if raised else "")
                codes[key] = code
                w = x1 - x0
                svg = (
                    f'<svg xmlns="{NS}" viewBox="{x0:.2f} {vb[1]} {w:.2f} {vb[3]}" role="img" '
                    f'aria-label="Class {slug} car {code}"><title>Class {slug} car {code}</title>'
                    f"<!-- {CREDIT}. Licence CC BY 4.0 https://creativecommons.org/licenses/by/4.0/ "
                    f"Source https://gbtrains.uk/stock/{slug}/ -->"
                    f"<desc>Cut from the GB Trains drawing. {CREDIT}.</desc><g>{inner}</g></svg>"
                )
                (cls_dir / f"{code}.svg").write_text(svg)
                opd.setdefault("sizes", {})[code] = round(w, 2)
            formation.append({"car": codes[key], "flip": flip})
        name = ("raised" if raised else "") + ("2car" if two else "") or "standard"
        opd["formations"][f"{name}"] = formation
    # clean helper fields, sort by class
    for slug, e in index.items():
        for op, d in e["operators"].items():
            d.pop("_counters", None)
            d["cars"] = sorted(set(d["cars"].values()))
    ordered = dict(sorted(index.items(), key=lambda kv: (not kv[0][:3].isdigit(), kv[0])))
    (OUT / "index.json").write_text(json.dumps({
        "credit": CREDIT, "licence": "CC BY 4.0", "licenceUrl": "https://creativecommons.org/licenses/by/4.0/",
        "source": "https://gbtrains.uk/stock/", "classes": ordered,
    }, indent=1))
    n_files = sum(1 for _ in OUT.rglob("*.svg"))
    print("classes:", len(ordered), "car files:", n_files)


if __name__ == "__main__":
    main()
