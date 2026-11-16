"""Copy the per-car SVGs the site uses into public/train-svgs and write a trimmed index.

Only classes seen on the site (see /units) and only the non-raised drawings are published,
to keep the deploy small. Re-run after cut_cars.py.
Output: public/train-svgs/<group>/<class>/<operator>/<CODE>.svg + public/train-svgs/index.json
"""
import json, shutil
from pathlib import Path

ROOT = Path(__file__).parent.parent.parent
SRC = ROOT / "data" / "formation-images" / "train-svgs"
DST = ROOT / "public" / "train-svgs"

CLASSES = ("150 153 155 156 158 159 165 166 168 170 171 172 175 180 185 195 196 197 220 221 222 230 231 "
           "318 320 323 331 333 334 345 350 357 360 375 376 377 379 380 385 387 390 395 397 398 444 450 "
           "458 465 466 484 700 701 707 717 720 730 745 755 756 769 777 800 801 802 803 805 807 810 "
           "139 399 t-w-555 ic125 ic225").split()

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
        ops[op] = {"formations": forms, "sizes": {k: d["sizes"][k] for k in codes}}
        for code in codes:
            src = SRC / e["group"] / c / op / f"{code}.svg"
            dst = DST / e["group"] / c / op / f"{code}.svg"
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(src, dst)
            n += 1
    out["classes"][c] = {"group": e["group"], "operators": ops}
(DST / "index.json").write_text(json.dumps(out, separators=(",", ":")))
tot = sum(f.stat().st_size for f in DST.rglob("*") if f.is_file())
print("classes", len(out["classes"]), "files", n, f"{tot/1e6:.1f} MB")
