# Map marker icons — quick reference

SVG map pins for each station network, for web and native apps. All assets live in this folder.

**Machine-readable index:** [`manifest.json`](./manifest.json)

---

## File naming

```
{slug}.{theme}.{state}.svg
```

| Part | Values |
|------|--------|
| **slug** | `gbnr`, `nitranslink`, `irish-rail`, `gb-heritage`, `supertram` |
| **theme** | `light`, `dark` |
| **state** | `unselected`, `selected` |

**Example:** `gbnr.dark.selected.svg` → GB National Rail, dark map, selected pin.

There are **20 SVGs** (5 networks × 2 themes × 2 states).

---

## Network → icon mapping

Use **`collectionId`** (Firestore / app data) as the primary key. Fall back to **`stnarea`** on the station record if needed.

| Network | `collectionId` | `stnarea` | Slug | Fill colour | Pin type |
|---------|------------------|-----------|------|-------------|----------|
| GB National Rail | `stations_gbnr` | `GBNR` | `gbnr` | `#312783` | Circle |
| NI Translink | `stations_nitranslink` | `NITRANSLINK` | `nitranslink` | `#03846E` | Circle |
| Irish Rail | `stations_roiirerail` | `ROIIRERAIL` | `irish-rail` | `#32A441` | Circle |
| GB Heritage | `stations_gbheritage` | `GBHERITAGE` | `gb-heritage` | `#dc2626` | Circle |
| South Yorkshire SuperTram | `lightrail_GBSHEFFSUPERTRAM` | `GBSHEFFSUPERTRAM` | `supertram` | `#f0632a`* | Logo |

\* `#f0632a` is the network legend colour. SuperTram pins use a black/white disc + `#FF5700` arrow, not a solid fill.

---

## Pin appearance

All icons use **`viewBox="0 0 32 32"`**. Scale to your desired point size; keep aspect ratio 1:1.

### Circle networks (GBNR, Translink, Irish Rail, Heritage)

| State | Radius | Stroke | Stroke colour |
|-------|--------|--------|---------------|
| Unselected | `r=10` | `2px` | `#FFFFFF` |
| Selected | `r=11` | `3px` | `#B20016` |

Fill = network colour (table above). Light and dark themes use the **same fill and stroke**; only the map tiles / UI behind the pin differ.

### SuperTram

| State | Appearance |
|-------|------------|
| Unselected | Logo only (no ring). Black disc + orange arrow in **light**; white disc + orange arrow in **dark**. |
| Selected | Same logo inside a circle matching other selected pins: `r=11`, `stroke-width=3`, stroke `#B20016`. |

SuperTram colours:

| Part | Light | Dark |
|------|-------|------|
| Disc | `#000000` | `#FFFFFF` |
| Arrow | `#FF5700` | `#FF5700` |

---

## Choosing the right asset

```
1. Resolve network → slug (from collectionId or stnarea)
2. theme = app colour scheme / map style (light or dark)
3. state = station is selected on map ? selected : unselected
4. Load: {slug}.{theme}.{state}.svg
```

### Resolve slug from `collectionId`

| `collectionId` | Slug |
|----------------|------|
| `stations_gbnr` | `gbnr` |
| `stations_nitranslink` | `nitranslink` |
| `stations_roiirerail` | `irish-rail` |
| `stations_gbheritage` | `gb-heritage` |
| `lightrail_GBSHEFFSUPERTRAM` | `supertram` |

### Resolve slug from `stnarea`

| `stnarea` | Slug |
|-----------|------|
| `GBNR` | `gbnr` |
| `NITRANSLINK` | `nitranslink` |
| `ROIIRERAIL` | `irish-rail` |
| `GBHERITAGE` | `gb-heritage` |
| `GBSHEFFSUPERTRAM` | `supertram` |

---

## Example lookup (pseudo-code)

```ts
type Theme = 'light' | 'dark'
type State = 'unselected' | 'selected'

const SLUG_BY_COLLECTION: Record<string, string> = {
  stations_gbnr: 'gbnr',
  stations_nitranslink: 'nitranslink',
  stations_roiirerail: 'irish-rail',
  stations_gbheritage: 'gb-heritage',
  lightrail_GBSHEFFSUPERTRAM: 'supertram',
}

function mapMarkerPath(
  collectionId: string,
  theme: Theme,
  isSelected: boolean
): string {
  const slug = SLUG_BY_COLLECTION[collectionId]
  if (!slug) throw new Error(`Unknown collection: ${collectionId}`)
  const state = isSelected ? 'selected' : 'unselected'
  return `map-markers/${slug}.${theme}.${state}.svg`
}

// mapMarkerPath('stations_gbnr', 'light', true)
// → "map-markers/gbnr.light.selected.svg"
```

For bundled apps, copy the `map-markers/` folder into your asset bundle and reference by filename.

---

## Web paths

When served from the Next.js site:

```
/images/map-markers/{slug}.{theme}.{state}.svg
```

Full URLs are listed per network in [`manifest.json`](./manifest.json) under `networks[].files`.

---

## Related constants (web codebase)

If you need to stay in sync with the live map:

| Constant | Location | Purpose |
|----------|----------|---------|
| `NETWORK_MAP_COLORS` | `src/constants/stationNetworkMapColors.ts` | Network fill colours |
| `SELECTED_MARKER_BORDER_COLOR` | same file | `#B20016` selected ring |
| `NETWORK_COLLECTION_IDS` | `src/constants/stationCollections.ts` | Valid collection IDs |
| `STNAREA_TO_NETWORK_COLLECTION` | same file | `stnarea` → collection |

---

## Full file list

```
gbnr.light.unselected.svg          gbnr.light.selected.svg
gbnr.dark.unselected.svg           gbnr.dark.selected.svg

nitranslink.light.unselected.svg   nitranslink.light.selected.svg
nitranslink.dark.unselected.svg    nitranslink.dark.selected.svg

irish-rail.light.unselected.svg    irish-rail.light.selected.svg
irish-rail.dark.unselected.svg     irish-rail.dark.selected.svg

gb-heritage.light.unselected.svg   gb-heritage.light.selected.svg
gb-heritage.dark.unselected.svg    gb-heritage.dark.selected.svg

supertram.light.unselected.svg     supertram.light.selected.svg
supertram.dark.unselected.svg      supertram.dark.selected.svg
```

---

## Not covered by these assets

- **Unsaved / pending new stations** — web map uses a plain black circle (`#111111`). No SVG in this set yet.
- **“All networks” fallback** — web uses `#64748b` when the network cannot be resolved.
