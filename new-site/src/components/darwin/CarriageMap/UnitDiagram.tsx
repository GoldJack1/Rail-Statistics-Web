'use client'

import React, { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { resolveDarwinBrowserUrl } from '@/utils/darwinReadyFetch'
import { drawingUrl } from '@/utils/trainDrawings'
import './UnitDiagram.css'

/**
 * Side-on drawings of trains, built from per-car SVGs served by the Darwin API at
 * /api/darwin/drawings/... (cut from GB Trains drawings, CC BY 4.0 — see docs/FORMATION_DIAGRAMS.md).
 * The art lives on the VPS, not in this repo, so it can be updated for every client at once.
 *
 * - `TrainDiagram`: one or more units in a row, optional per-car loading bars,
 *   `fallback` shown when we have no art (so callers keep their placeholder).
 * - `UnitDiagram`: single unit, shown on the unit page (renders nothing without art).
 * - `DiagramAttribution`: page-footer credit; renders only while a drawing is on screen.
 *
 * Beta site only for now (NEXT_PUBLIC_BETA_SITE).
 */

interface CarRef { car: string; flip: boolean }
interface OperatorArt {
  formations: Record<string, CarRef[]>
  sizes: Record<string, number>
}
interface DiagramIndex {
  credit: string
  /** Hash of the whole set; added to car URLs so an update bypasses cached cars. */
  version?: string
  classes: Record<string, { group: string; operators: Record<string, OperatorArt> }>
}

export type DiagramLoadTone = 'ontime' | 'delayed' | 'cancelled' | null

export interface DiagramUnit {
  /** PTAC fleet id such as "800/1". Preferred when present. */
  fleetId?: string | null
  /** Unit number such as "800033"; the class is read from its first three digits. */
  unitId?: string | null
  vehicleCount: number
}

const ENABLED = process.env.NEXT_PUBLIC_BETA_SITE === 'true'

/** GB Trains uses different slugs for a few classes. */
/** 91 = LNER InterCity 225 (class 91 + Mk4 coaches), drawn as one train under `ic225`. */
const CLASS_ALIAS: Record<string, string> = { '555': 't-w-555', '91': 'ic225' }

/** Darwin TOC code -> operator folder in train-svgs (livery). Falls back to "base". */
const TOC_TO_OPERATOR: Record<string, string> = {
  GW: 'gwr', GR: 'lner', NT: 'northern', AW: 'tfw', SR: 'scotrail', EM: 'emr',
  LN: 'lnr', XC: 'crosscountry', SE: 'southeastern', SN: 'southern', SW: 'swr',
  CC: 'c2c', LE: 'greater-anglia', HX: 'heathrow-express', GX: 'gatwick-express',
  CH: 'chiltern', LM: 'wmr', TP: 'tpe', HT: 'hull', GC: 'grand-central', LD: 'lumo',
}

const TONE_COLOR: Record<'ontime' | 'delayed' | 'cancelled', string> = {
  ontime: 'hsl(141 72% 42%)',
  delayed: 'hsl(53 78% 52%)',
  cancelled: 'hsl(0 72% 52%)',
}

/**
 * Services whose operator runs a single class, for boards that carry no unit numbers.
 * SJ = South Yorkshire Supertram: the Sheffield-Rotherham tram-train (class 399).
 */
const TOC_DEFAULT_CLASS: Record<string, string> = { SJ: '399' }

/** Diagram units to draw when the service has no unit data; [] when unknown. */
export function defaultDiagramUnitsForToc(toc: string | null | undefined): DiagramUnit[] {
  const cls = toc ? TOC_DEFAULT_CLASS[toc.trim().toUpperCase()] : null
  return cls ? [{ fleetId: cls, vehicleCount: 0 }] : []
}

let indexPromise: Promise<DiagramIndex | null> | null = null
function loadIndex(): Promise<DiagramIndex | null> {
  if (!indexPromise) {
    // No `cache: 'no-store'` here: the API sends a short cache header, so repeat page loads are free.
    indexPromise = fetch(drawingUrl('index.json', undefined, resolveDarwinBrowserUrl))
      .then((r) => (r.ok ? (r.json() as Promise<DiagramIndex>) : null))
      .catch(() => null)
      .then((index) => {
        // If the API was unreachable, try again later instead of caching the failure for the session.
        if (!index) setTimeout(() => { indexPromise = null }, 30_000)
        return index
      })
  }
  return indexPromise
}

function useDiagramIndex(): DiagramIndex | null {
  const [index, setIndex] = useState<DiagramIndex | null>(null)
  useEffect(() => {
    if (!ENABLED) return
    let live = true
    loadIndex().then((i) => { if (live) setIndex(i) })
    return () => { live = false }
  }, [])
  return index
}

export function classSlug(unit: DiagramUnit): string | null {
  // Fleet ids look like "800/1", "087/2" or, for locomotive + coach sets, "G91/M".
  const fromFleet = /^\s*[A-Za-z]?0*(\d{1,3})(?:\/|\s*$)/.exec(unit.fleetId || '')
  const fromUnit = /^\s*(\d{3})\d{3}\s*$/.exec(unit.unitId || '')
  const num = fromFleet?.[1] || fromUnit?.[1]
  if (num) return CLASS_ALIAS[num] || num
  // LNER InterCity 225 sets are numbered NL01-NL31 (fleet "G91/M"); boards carry no fleet id.
  if (/^\s*NL\d{2}\s*$/i.test(unit.unitId || '')) return 'ic225'
  return null
}

/**
 * Fit a drawn formation to `n` vehicles. Same length: as drawn. Longer: repeat the
 * drawn middle cars. Shorter: drop middle cars. Approximate for sets the drawing
 * doesn't cover exactly (e.g. a 9-car 800 from the 5-car drawing).
 */
function fitCars(drawn: CarRef[], n: number): CarRef[] {
  if (n <= 0 || drawn.length === 0) return []
  if (drawn.length === n) return drawn
  if (n === 1) return [drawn[0]]
  const first = drawn[0]
  const last = drawn[drawn.length - 1]
  const mids = drawn.slice(1, -1)
  const want = n - 2
  const out: CarRef[] = [first]
  if (mids.length === 0) {
    for (let i = 0; i < want; i++) out.push(first)
  } else if (want <= mids.length) {
    const start = Math.floor((mids.length - want) / 2)
    out.push(...mids.slice(start, start + want))
  } else {
    for (let i = 0; i < want; i++) out.push(mids[i % mids.length])
  }
  out.push(last)
  return out
}

function pickFormation(art: OperatorArt, n: number): CarRef[] | null {
  const candidates = Object.values(art.formations).filter((f) => f.length > 0)
  if (candidates.length === 0) return null
  candidates.sort((a, b) => Math.abs(a.length - n) - Math.abs(b.length - n) || b.length - a.length)
  return candidates[0]
}

interface UnitView {
  slug: string
  /** <group>/<class>/<operator> under /api/drawings */
  path: string
  version?: string
  art: OperatorArt
  cars: CarRef[]
  total: number
}

/**
 * Which operator's art to draw. The operator's own livery when it has one; the generic ("base") art when
 * the operator has none, or when only the generic art is drawn at the right length (a Northern 170 is
 * 3-car but only the generic 170 is drawn in 3 cars), so the car count is right even if the livery is not.
 */
export function chooseOperatorKey(
  operators: Record<string, { formations: Record<string, CarRef[]> }>,
  wanted: string,
  vehicleCount: number,
): string | undefined {
  const hasLength = (key: string) =>
    Object.values(operators[key]?.formations || {}).some((f) => f.length === vehicleCount)
  if (operators[wanted]) {
    if (vehicleCount > 0 && wanted !== 'base' && !hasLength(wanted) && operators.base && hasLength('base')) {
      return 'base'
    }
    return wanted
  }
  return operators.base ? 'base' : Object.keys(operators)[0]
}

function buildView(
  index: DiagramIndex,
  unit: DiagramUnit,
  reversed: boolean,
  toc: string | null | undefined,
): UnitView | null {
  const slug = classSlug(unit)
  const cls = slug ? index.classes[slug] : null
  if (!slug || !cls) return null
  const wanted = (toc && TOC_TO_OPERATOR[toc.toUpperCase()]) || 'base'
  const opKey = chooseOperatorKey(cls.operators, wanted, unit.vehicleCount)
  const art = opKey ? cls.operators[opKey] : null
  if (!art) return null
  // vehicleCount 0 = unknown: draw the set as GB Trains drew it.
  const drawn = unit.vehicleCount > 0
    ? pickFormation(art, unit.vehicleCount)
    : (art.formations.standard?.length ? art.formations.standard : pickFormation(art, 99))
  if (!drawn) return null
  let cars = unit.vehicleCount > 0 ? fitCars(drawn, unit.vehicleCount) : drawn
  if (reversed) cars = [...cars].reverse().map((c) => ({ ...c, flip: !c.flip }))
  const total = cars.reduce((s, c) => s + (art.sizes[c.car] || 0), 0)
  if (!total) return null
  return { slug, path: `${cls.group}/${slug}/${opKey}`, version: index.version, art, cars, total }
}

/** Footer label for a drawing slug. */
function slugLabel(slug: string): string {
  if (slug === 'ic225') return 'InterCity 225'
  if (slug === 'ic125') return 'InterCity 125'
  if (slug === 't-w-555') return 'class 555'
  return `class ${slug}`
}

/* Which classes' drawings are on screen, so a page footer can credit them. */
const shown = new Map<string, number>()
const listeners = new Set<() => void>()
let snapshot: string[] = []
function emit() {
  snapshot = [...shown.keys()].sort()
  listeners.forEach((l) => l())
}
function registerDiagrams(slugs: string[]): () => void {
  for (const s of slugs) shown.set(s, (shown.get(s) || 0) + 1)
  emit()
  return () => {
    for (const s of slugs) {
      const n = (shown.get(s) || 1) - 1
      if (n <= 0) shown.delete(s)
      else shown.set(s, n)
    }
    emit()
  }
}
function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => { listeners.delete(cb) }
}
const getSnapshot = () => snapshot
const getServerSnapshot = (): string[] => []

/**
 * Page-footer credit for the drawings (CC BY 4.0 requires attribution). Renders
 * nothing unless a drawing is on the page. Put it beside the data-licence line.
 */
export const DiagramAttribution: React.FC<{
  className?: string
  /** Rendered before the credit only while it shows (e.g. a footer separator). */
  before?: React.ReactNode
}> = ({ className, before }) => {
  const slugs = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
  if (slugs.length === 0) return null
  return (
    <>
    {before}
    <span className={className}>
      Train drawings: GB Trains (
      <a href="https://gbtrains.uk/stock/" target="_blank" rel="noopener noreferrer">gbtrains.uk</a>
      ), CC BY 4.0
      {slugs.length === 1 && (
        <>
          {' '}·{' '}
          <a href={`https://gbtrains.uk/stock/${slugs[0]}/`} target="_blank" rel="noopener noreferrer">
            {slugLabel(slugs[0])}
          </a>
        </>
      )}
      .
    </span>
    </>
  )
}

export const TrainDiagram: React.FC<{
  units: DiagramUnit[]
  reversed?: boolean
  toc?: string | null
  /** One tone per vehicle across the whole train, in display order. Draws a thin bar under each car. */
  loadTones?: DiagramLoadTone[]
  /** Shown while loading and when there is no art for these units. */
  fallback?: React.ReactNode
  className?: string
}> = ({ units, reversed = false, toc, loadTones, fallback = null, className }) => {
  const index = useDiagramIndex()
  const unitsKey = units.map((u) => `${u.fleetId || ''}|${u.unitId || ''}|${u.vehicleCount}`).join(',')

  const views = useMemo(() => {
    if (!ENABLED || !index || units.length === 0) return null
    const built = units.map((u) => buildView(index, u, reversed, toc))
    if (built.some((v) => v === null)) return null
    const list = built as UnitView[]
    return reversed ? [...list].reverse() : list
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, unitsKey, reversed, toc])

  const slugKey = views ? [...new Set(views.map((v) => v.slug))].join(',') : ''
  useEffect(() => {
    if (!slugKey) return
    return registerDiagrams(slugKey.split(','))
  }, [slugKey])

  const scrollRef = useRef<HTMLDivElement>(null)
  const drag = useRef<{ x: number; left: number; moved: boolean } | null>(null)
  const [more, setMore] = useState(false) // more train off to the right
  const [less, setLess] = useState(false) // already scrolled: train hidden off to the left
  const [scrollable, setScrollable] = useState(false)
  const hasViews = !!views

  // Track whether the strip overflows and whether there is more to the right (shows an edge fade).
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const update = () => {
      const over = el.scrollWidth - el.clientWidth
      setScrollable(over > 2)
      setMore(over - el.scrollLeft > 4)
      setLess(over > 2 && el.scrollLeft > 4)
    }
    update()
    el.addEventListener('scroll', update, { passive: true })
    const ro = new ResizeObserver(update)
    ro.observe(el)
    if (el.firstElementChild) ro.observe(el.firstElementChild)
    return () => {
      el.removeEventListener('scroll', update)
      ro.disconnect()
    }
  }, [hasViews, unitsKey])

  if (!views) return <>{fallback}</>

  // Mouse drag to scroll (touch and trackpads scroll natively). A drag must not "click" the
  // card it sits in, since boards make the whole card a button.
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = scrollRef.current
    if (!el || e.pointerType !== 'mouse' || e.button !== 0 || el.scrollWidth <= el.clientWidth + 2) return
    drag.current = { x: e.clientX, left: el.scrollLeft, moved: false }
  }
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = scrollRef.current
    const d = drag.current
    if (!el || !d) return
    const dx = e.clientX - d.x
    if (!d.moved && Math.abs(dx) > 4) {
      d.moved = true
      try { el.setPointerCapture(e.pointerId) } catch { /* pointer already gone */ }
    }
    if (d.moved) el.scrollLeft = d.left - dx
  }
  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = scrollRef.current
    try {
      if (drag.current?.moved && el?.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId)
    } catch { /* ignore */ }
    // keep `moved` until the click that follows the pointer-up has been swallowed
    if (drag.current && !drag.current.moved) drag.current = null
  }
  const swallowClickAfterDrag = (e: React.MouseEvent<HTMLDivElement>) => {
    if (drag.current?.moved) {
      e.stopPropagation()
      e.preventDefault()
    }
    drag.current = null
  }

  // Keep every car the same height: if any car shows a loading bar, reserve the space on all.
  const showBars = !!loadTones?.some(Boolean)
  let carNo = 0
  return (
    <div
      ref={scrollRef}
      className={[
        'cmap-diagram',
        scrollable ? 'cmap-diagram--scrollable' : '',
        scrollable && more ? 'cmap-diagram--more' : '',
        scrollable && less ? 'cmap-diagram--less' : '',
        className,
      ].filter(Boolean).join(' ')}
      role="img"
      aria-label={`Side view of ${views.map((v) => `class ${v.slug}`).join(' + ')}, ${views.reduce((n, v) => n + v.cars.length, 0)} vehicles`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onClickCapture={swallowClickAfterDrag}
    >
      {/* Every car is drawn at one shared scale (see --cmap-diagram-scale in UnitDiagram.css),
          so a longer train is simply wider and the strip scrolls sideways. */}
      <div className="cmap-diagram-track">
        {views.map((v, vi) => (
          <div key={`${v.slug}-${vi}`} className="cmap-diagram-unit">
            {v.cars.map((c, i) => {
              const tone = loadTones?.[carNo++] ?? null
              return (
                <div
                  key={`${c.car}-${i}`}
                  className="cmap-diagram-cell"
                  style={{ width: `calc(${v.art.sizes[c.car] || 0} * var(--cmap-diagram-scale, 0.42) * 1px + var(--cmap-diagram-overlap, 1px))` }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    className={c.flip ? 'cmap-diagram-car cmap-diagram-car--flip' : 'cmap-diagram-car'}
                    src={drawingUrl(`${v.path}/${c.car}.svg`, v.version, resolveDarwinBrowserUrl)}
                    alt=""
                    draggable={false}
                  />
                  {showBars ? (
                    <span
                      className="cmap-diagram-load"
                      style={{ background: tone ? TONE_COLOR[tone] : 'transparent' }}
                    />
                  ) : null}
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}

/** Single unit (unit page). Renders nothing when we have no art for the class. */
export const UnitDiagram: React.FC<{
  fleetId: string | null | undefined
  vehicleCount: number
  reversed?: boolean
  toc?: string | null
}> = ({ fleetId, vehicleCount, reversed = false, toc }) => (
  <TrainDiagram units={[{ fleetId, vehicleCount }]} reversed={reversed} toc={toc} />
)

export default UnitDiagram
