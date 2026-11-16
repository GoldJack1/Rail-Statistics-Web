# Formation diagrams (own SVG, not scraped)

Goal: a side-on train formation diagram per service (like Realtime Trains shows), drawn by us as SVG, coloured and labelled from our own data. Resolution-independent, matches site styling, no third-party images.

## Why not copy RTT / Wikimedia
- RTT terms restrict scraping/reuse; their images are low-res raster.
- Wikimedia Commons search (2026-11-16, partial: API rate-limited) found no modern UK unit side-on SVGs, only historic wagon diagrams (SR/LNWR/L&YR) and photos. Use CC photos only as tracing reference (check licence/attribution per file).

## PRIMARY SOURCE (decided 2026-11-16): GB Trains, https://gbtrains.uk/stock/classes/
Vector SVG schematic side elevations per class (+ operator livery drawings where drawn), **CC BY 4.0** (attribution only, no share-alike). Credit: "Drawing: GB Trains, gbtrains.uk, CC BY 4.0", linked to the class page; keep the credit embedded in each SVG. Author per site footer: Kyle Barnard.
- Downloaded by `scripts/formation-images/download_gbtrains_all.py` (skips folders already present) into `data/formation-images/gbtrains/<class>/`, with `manifest.json`. Class pages: `https://gbtrains.uk/stock/<class>/` (e.g. 150, 800; hauled sets: `ic125`, `ic225`, `68`, `67`).
- Not on GB Trains: classes 4, 5, 57 (check what 4/5 are). 155 is listed.
- Gaps inside classes: only some operator liveries drawn; many drawings are 2-car — join cars for longer sets.
- Realtime Trains images are NOT usable: their terms (cl. 6.1, 6.4, 8.1, 10.1) forbid copying graphics and scraping.
- Secondary: WestRail642fan (CC BY-SA 4.0) and other Commons uploaders for missing liveries; the WestRail PNG download was stopped part-way (rate limits), only ~16 files fetched.

### Per-car cut (done 2026-11-16)
`scripts/formation-images/cut_cars.py` cuts every GB Trains drawing (base, `-liv-<operator>`, `-raised`; `-x2` skipped) into one SVG per car: `data/formation-images/train-svgs/<group>/<class>/<operator>/<CODE>.svg`.
- Folder idea copied from RTT (`80x/lner/DMF`): `<group>` = first two digits + `x` (80x, 15x, 39x; slug itself for non-numeric stocks like `ic125`), plus a `<class>` level so 800 and 801 cars never collide. Operator `base` = the unbranded drawing.
- Car codes are neutral: `END` (end vehicle), `MID`, `SINGLE`, numbered when art differs (`END2`, `MID3`), `-raised` suffix for pantograph-up art. RTT-style DMF/DMS/T/M codes need a per-class role map still (not machine-readable on GB Trains pages).
- `train-svgs/index.json` lists classes in order with, per operator, the car codes, car widths (px at 10 px/m) and `formations` (standard / raised / 2car) as ordered car lists with a `flip` flag (mirror the car for the far end). 163 classes, ~1,760 car files.
- Each car file keeps the GB Trains credit (comment, desc). Car groups = top-level `<g>` with a transform and no class; `class="ole"` is the overhead wire overlay.

### Serving: from the VPS API, not the site (so every platform updates at once)
The finished car SVGs are **not in the repo or the web build**. They live on the VPS and the query server serves them (`rail-core/src/drawings-route.js`), public and read-only (the art is CC BY 4.0):

| Request | Returns |
|---|---|
| `GET /api/drawings/index.json` | `{ credit, licence, licenceUrl, source, version, classes }`. Per class: `group` and `operators.<operator>.formations.{standard,2car}` (ordered `[{car, flip}]`) and `sizes` (car width, 10 units per metre). |
| `GET /api/drawings/<group>/<class>/<operator>/<CODE>.svg` | One car, e.g. `80x/800/gwr/END5.svg`. Draw each at `width = size x scale`, mirror it when `flip` is true. |

- **Hosts:** `https://api-dev.railstatistics.co.uk` (dev) and `https://api-raildata.railstatistics.co.uk` (live). The web site reaches them as `/api/darwin/drawings/...` through the same origin handling as every other API call (`resolveDarwinBrowserUrl`).
- **Updating:** append `?v=<index.version>` to car URLs. `index.json` is cached 5 minutes, cars up to a day, and the version changes whenever any file changes, so an update reaches web, iOS and Android within minutes with no app or site release. Treat a failed index fetch as "no drawing" and keep the old pills.
- **Credit:** show "Train drawings: GB Trains (gbtrains.uk), CC BY 4.0" wherever a drawing is on screen (`credit` and `source` are in the index).
- **Choosing the class and livery (web logic in `UnitDiagram.tsx`):** class from the PTAC `fleetId` (`800/1` gives 800; `G91/M` and `NL##` set numbers map to `ic225`, `555` to `t-w-555`) or the first three digits of a six-digit unit number; operator folder from the Darwin TOC code (`GW` gives `gwr`, and so on) falling back to `base`; fit a different car count by repeating or dropping the middle cars.

**To update the drawings**
```
python3 -I new-site/scripts/formation-images/cut_cars.py        # only if the GB Trains source changed
python3 -I new-site/scripts/formation-images/tighten_cars.py
python3 -I new-site/scripts/formation-images/build_drawings.py   # writes new-site/data/formation-images/publish (local, not committed)
rail-core/scripts/deploy-drawings.sh dev                         # then prod
```
The server reads the folder on every request (default `rail-core*/assets/train-svgs`, override with `DRAWINGS_DIR`), so no restart is needed.

## Secondary source: WestRail642fan on Wikimedia Commons
~200 side-on livery drawings of UK units, one consistent style, **CC BY-SA 4.0**, author user `WestRail642fan` (https://commons.wikimedia.org/wiki/Special:ListFiles/WestRail642fan). 119–200 px tall, up to 12,000 px wide, PNG. Covers 800/801/802/803/805/807/810-era Hitachi, 390, 220/221, 158, 165/166, 168/170/171/172, 175, 180, 185, 195/196/197, 231, 331, 334, 345, 350, 357, 360, 365, 375/376/377/378, 379, 380, 385, 387, 395, 397, 444/450/458, 465/466, 700/701/707/710/717, 720/730, 745/755/756, 777, Eurostar/373/374 and more, per operator livery and car count.
- Downloaded by `scripts/formation-images/download_westrail.py` into `data/formation-images/<class>/`, with `data/formation-images/manifest.json` (source page, licence, author).
- **Licence duties:** show attribution (author + licence + link) wherever used; CC BY-SA means modified images must also be shared CC BY-SA. Original rendering of Darwin data over the top is ours.
- Not by this author / still missing: check manifest against the class list below (e.g. 150/153/155/156, 159, 318/320/323, 333, 376 variants, 444, 484, 4/5/57/68/91, 730 etc.).
- Drawings are whole-train strips, not per car: per-coach overlays (class, toilets, loading) need car boundaries cut from the strip.

## Data we already have (see `src/types/darwin.ts`)
- **Darwin `formation`** (`FormationData.coaches[]`): `number`, `class` (Standard/First/Composite/Mixed), `toilet`, `catering`.
- **PTAC `consist`** (`ConsistData` → `PtacResourceGroup` → `PtacVehicle`): `fleetId` (e.g. `158/7`, `345/0`), `unitId`, `position`, `lengthMm`, `numberOfSeats`, `cabs`, `specificType`, `livery`, `typeOfResource` (U unit, L loco+coaches, S single car, C coaches).
- Existing UI: `src/components/darwin/CarriageMap/CarriageMap.tsx` (cell-per-coach, loading). Diagram would sit alongside / inside it.

## Approach
1. One **parametric body profile per family** (`src/lib/formationDiagram/families.ts`): cab shape, car length ratios, door positions, window pitch, roof kit.
2. **Renderer** (`render.ts`): takes ordered vehicles (+ optional Darwin coach info) → SVG string. Per-coach overlays: First class band, toilet, accessible, bike, catering, coach number, loading colour.
3. **Class → family map** keyed on PTAC `fleetId` prefix (class number). Unknown class → generic coach strip (fallback).
4. Vehicle `lengthMm` from PTAC scales each car; `cabs` decides cab-end shape.

## Classes in use (beta /units, last ~30 days, 2026-11-16)
Unit counts per class. Family = proposed shared template. "?" = verify body before drawing.

### 0–99 (locos / hauled stock — formation is coach list, not fixed unit)
| Class | Units | Note |
|---|---|---|
| 4 | 2 | ? (check what these are) |
| 5 | 9 | ? |
| 57 | 5 | loco + hauled stock |
| 68 | 14 | loco + Mk5/hauled stock |
| 91 | 6 | loco + Mk4 (LNER) |

### 100–199 (DMUs)
| Class | Units | Family |
|---|---|---|
| 139 | 2 | Parry People Mover-style single car (own) |
| 150 | 112 | Sprinter (2/3-car) |
| 153 | 26 | Sprinter single car |
| 155 | 7 | Sprinter |
| 156 | 105 | Sprinter |
| 158 | 165 | Sprinter (Express) |
| 159 | 29 | Sprinter (Express) |
| 165 | 73 | Turbo |
| 166 | 21 | Turbo |
| 168 | 27 | Clubman/Turbostar |
| 170 | 121 | Turbostar |
| 171 | 17 | Turbostar |
| 172 | 39 | Turbostar |
| 175 | 16 | Coradia 175 |
| 180 | 11 | Adelante |
| 185 | 50 | Desiro DMU |
| 195 | 56 | CAF Civity DMU |
| 196 | 26 | CAF Civity DMU |
| 197 | 76 | CAF Civity DMU |

### 200–299
| Class | Units | Family |
|---|---|---|
| 220 | 34 | Voyager |
| 221 | 37 | Super Voyager (tilting) |
| 222 | 26 | Meridian |
| 230 | 6 | D-Train/battery (own) |
| 231 | 11 | FLIRT DMU |
| 253 | 21 | HST (power cars + Mk3) |

### 300–399 (EMUs)
| Class | Units | Family |
|---|---|---|
| 318 | 21 | Legacy suburban |
| 320 | 34 | Legacy suburban |
| 323 | 33 | Legacy suburban |
| 331 | 42 | CAF Civity EMU |
| 333 | 15 | Northern/Class 333 |
| 334 | 38 | Juniper |
| 345 | 73 | Aventra (Elizabeth) |
| 350 | 50 | Desiro |
| 357 | 74 | Electrostar |
| 360 | 20 | Desiro |
| 375 | 111 | Electrostar |
| 376 | 36 | Electrostar (inner suburban) |
| 377 | 239 | Electrostar |
| 379 | 26 | Electrostar |
| 380 | 38 | Desiro (Scotland) |
| 385 | 69 | Hitachi AT200 |
| 387 | 106 | Electrostar |
| 390 | 56 | Pendolino |
| 395 | 29 | Javelin |
| 397 | 12 | CAF Civity EMU (Nova 1/TPE) |
| 398 | 23 | Tram-train |

### 400–499
| Class | Units | Family |
|---|---|---|
| 444 | 45 | Desiro |
| 450 | 127 | Desiro |
| 458 | 17 | Juniper |
| 465 | 112 | Networker |
| 466 | 16 | Networker |
| 484 | 5 | Island Line (ex-LU stock) |

### 700–799
| Class | Units | Family |
|---|---|---|
| 700 | 115 | Desiro City |
| 701 | 67 | Arterio |
| 707 | 30 | Desiro City |
| 717 | 23 | Siemens Desiro City |
| 720 | 143 | Aventra |
| 730 | 81 | Aventra (WMT) |
| 745 | 20 | Stadler FLIRT (Greater Anglia) |
| 755 | 38 | Stadler FLIRT bi-mode |
| 756 | 23 | Stadler FLIRT tri-mode |
| 769 | 8 | Flex bi-mode (ex-319) |
| 777 | 53 | Stadler (Merseyrail) |

### 800–899 (Hitachi AT300 — build first)
| Class | Units | Notes |
|---|---|---|
| 800 | 80 | 5 or 9 car, bi-mode |
| 801 | 42 | 5/9 car, electric (LNER) |
| 802 | 60 | 5/9 car (GWR/TPE/Hull Trains) |
| 803 | 5 | 5 car, electric (Lumo) |
| 805 | 13 | 5 car (Avanti, bi-mode) |
| 807 | 10 | 7 car (Avanti, electric) |
| 810 | 11 | 5 car (EMR Aurora) |

### Other
| Class | Units | Note |
|---|---|---|
| LHC/S | 17 | unknown code, investigate |

## Top 14 by units (≈50% of units)
377 (239), 158 (165), 720 (143), 450 (127), 170 (121), 700 (115), 375 (111), 150 (112), 465 (112), 387 (106), 156 (105), 357 (74), 345 (73), 165 (73).

## Build order
1. **Intercity** (800/801/802/803/805/807/810 + 390 / 220/221/222): one AT300 profile + car count/cab variants first.
2. Electrostar family (375/376/377/379/387/357/345/720).
3. Desiro (350/360/444/450/185/700/701).
4. Sprinter / Turbostar DMUs.
5. Everything else; hauled stock (4/5/57/68/91) as coach lists.

## Status
- [ ] families.ts / render.ts (started: `src/lib/formationDiagram/`)
- [ ] 800 family template reviewed against photos
- [ ] Wire into CarriageMap behind a flag
- [ ] Fallback strip for unmapped classes
