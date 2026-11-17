'use client'

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { PageTopHeader } from '@/components/misc'
import { BUTWideButton } from '@/components/buttons'
import { DiagramAttribution, TrainDiagram, classJointGapUnits, useDiagramIndex } from '@/components/darwin/CarriageMap'
import { fetchDarwin } from '@/utils/darwinReadyFetch'
import './TrainDiagramsPage.css'

type Fleet = { fleetId: string; unitCount: number }
/** The car counts seen across a fleet's units: cars -> number of units, plus one example unit per count. */
type Observed = { counts: Record<number, { units: number; example: string; lengthM: number }> } | 'none' | 'error'

/** Class number of a fleet id: "170/4" -> "170", "G91/M" -> "ic225". Matches how the drawings are keyed. */
function fleetClass(fleetId: string): string | null {
  if (/^NL\d{2}$/i.test(fleetId) || /^G?91\//i.test(fleetId)) return 'ic225'
  const m = /^[A-Za-z]?0*(\d{1,3})(?:\/|$)/.exec(fleetId)
  if (!m) return null
  return m[1] === '555' ? 't-w-555' : m[1]
}

/** Classes GB Trains itself lists in a 2-car version (checked against gbtrains.uk/stock/<class>/). */
const TWO_CAR_CLASSES = new Set(['150', '155', '156', '158', '165', '168', '170', '171', '172', '175', '195', '196', '197'])

/**
 * GB Trains' "-2car" livery drawings of a longer train show only the two end cars in that livery, not a 2-car
 * train. They are a partial drawing unless the class really runs 2-car units.
 */
function isLiveryEndsOnly(slug: string, name: string, formation: unknown[], all: Record<string, unknown[]>): boolean {
  return name === '2car' && formation.length === 2 && (all.standard?.length ?? 0) > 2 && !TWO_CAR_CLASSES.has(slug)
}

function operatorLabel(key: string): string {
  return key === 'base' ? 'Generic' : key.replace(/-/g, ' ')
}

async function sampleFleet(fleetId: string): Promise<Observed> {
  try {
    const counts: Record<number, { units: number; example: string; lengthM: number }> = {}
    let cursor: number | null = 0
    while (cursor !== null) {
      const res = await fetchDarwin(`/api/darwin/units/catalog?fleet=${encodeURIComponent(fleetId)}&limit=200&cursor=${cursor}`)
      if (!res.ok) return 'error'
      const page = (await res.json()) as {
        units?: { unitId: string; vehicleCount?: number | null; lengthMm?: number | null }[]
        nextCursor?: number | null
      }
      for (const u of page.units || []) {
        if (!u.vehicleCount) continue
        const c = (counts[u.vehicleCount] ||= { units: 0, example: u.unitId, lengthM: Math.round((u.lengthMm || 0) / 100) / 10 })
        c.units += 1
      }
      cursor = page.nextCursor ?? null
    }
    return Object.keys(counts).length ? { counts } : 'none'
  } catch {
    return 'error'
  }
}

/** Review marks kept in this browser only: formation key -> 'ok' | 'remove', class slug -> note. */
type Review = { marks: Record<string, 'ok' | 'remove'>; notes: Record<string, string>; gaps: Record<string, number>; gapsVersion?: number; scale?: number }
const REVIEW_KEY = 'rs-train-diagram-review-v1'
const GAPS_VERSION = 3
const DEFAULT_SCALE = 2.05

function loadReview(): Review {
  try {
    const raw = window.localStorage.getItem(REVIEW_KEY)
    if (raw) {
      const saved = { marks: {}, notes: {}, gaps: {}, ...(JSON.parse(raw) as Partial<Review>) } as Review
      // Version 3: the slider now holds the gap itself (it was an offset from the default), so older saved
      // slider values mean something else. Drop them once; marks and notes stay.
      if (saved.gapsVersion !== GAPS_VERSION) return { ...saved, gaps: {}, gapsVersion: GAPS_VERSION }
      return saved
    }
  } catch { /* private window: start empty */ }
  return { marks: {}, notes: {}, gaps: {}, gapsVersion: GAPS_VERSION }
}

const TrainDiagramsPage: React.FC = () => {
  const index = useDiagramIndex()
  const [review, setReview] = useState<Review>({ marks: {}, notes: {}, gaps: {} })
  const [reviewLoaded, setReviewLoaded] = useState(false)
  const [onlyUnreviewed, setOnlyUnreviewed] = useState(false)
  const [copied, setCopied] = useState(false)
  const [fleets, setFleets] = useState<Fleet[]>([])
  const [observed, setObserved] = useState<Record<string, Observed>>({})
  const [checking, setChecking] = useState(false)
  const [progress, setProgress] = useState(0)
  const [query, setQuery] = useState('')
  const [onlyMismatch, setOnlyMismatch] = useState(false)

  useEffect(() => {
    setReview(loadReview())
    setReviewLoaded(true)
  }, [])
  useEffect(() => {
    if (!reviewLoaded) return
    try { window.localStorage.setItem(REVIEW_KEY, JSON.stringify(review)) } catch { /* ignore */ }
  }, [review, reviewLoaded])

  const mark = (key: string, value: 'ok' | 'remove') =>
    setReview((r) => {
      const marks = { ...r.marks }
      if (marks[key] === value) delete marks[key]
      else marks[key] = value
      return { ...r, marks }
    })
  const setGap = (slug: string, units: number) => setReview((r) => ({ ...r, gaps: { ...r.gaps, [slug]: units } }))
  const clearGap = (slug: string) =>
    setReview((r) => {
      const gaps = { ...r.gaps }
      delete gaps[slug]
      return { ...r, gaps }
    })
  const setNote = (slug: string, text: string) =>
    setReview((r) => ({ ...r, notes: { ...r.notes, [slug]: text } }))

  /** The review as text to paste back: what to remove, what is confirmed, and the variations wanted. */
  const exportReview = async () => {
    const remove = Object.entries(review.marks).filter(([, v]) => v === 'remove').map(([k]) => k)
    const ok = Object.entries(review.marks).filter(([, v]) => v === 'ok').map(([k]) => k)
    const notes = Object.fromEntries(Object.entries(review.notes).filter(([, v]) => v.trim()))
    // Spacing per class: the gap between cars, + a gap and - an overlap, from the class's fixed value on the site.
    // 10 drawing units = 1 m, so mm = units x 100.
    const spacing = Object.fromEntries(
      [...new Set([...Object.keys(review.gaps), ...classes.map((c) => c.slug).filter((sl) => classJointGapUnits(sl) !== undefined)])]
        .sort((x, y) => x.localeCompare(y, undefined, { numeric: true }))
        .map((slug) => {
          const units = review.gaps[slug] ?? classJointGapUnits(slug) ?? 0
          return [slug, { gapUnits: units, gapMm: Math.round(units * 100), source: slug in review.gaps ? 'set on this page' : 'site default' }]
        }),
    )
    const text = JSON.stringify({ remove, ok, variationsNeeded: notes, spacing, previewScale: review.scale ?? DEFAULT_SCALE }, null, 2)
    try { await navigator.clipboard.writeText(text) } catch { window.prompt('Copy this review', text) }
    setCopied(true)
    window.setTimeout(() => setCopied(false), 2000)
  }

  useEffect(() => {
    let live = true
    fetchDarwin('/api/darwin/units/fleets')
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { fleets?: Fleet[] } | null) => { if (live && d?.fleets) setFleets(d.fleets) })
      .catch(() => {})
    return () => { live = false }
  }, [])

  /** Read every fleet's car counts from the unit catalogue, four fleets at a time. */
  const check = useCallback(async () => {
    setChecking(true)
    setProgress(0)
    const queue = fleets.map((f) => f.fleetId)
    let done = 0
    const worker = async () => {
      for (let id = queue.shift(); id; id = queue.shift()) {
        const result = await sampleFleet(id)
        setObserved((o) => ({ ...o, [id]: result }))
        setProgress(++done)
      }
    }
    await Promise.all([worker(), worker(), worker(), worker()])
    setChecking(false)
  }, [fleets])

  const classes = useMemo(() => {
    if (!index) return []
    const fleetsByClass = new Map<string, Fleet[]>()
    for (const f of fleets) {
      const c = fleetClass(f.fleetId)
      if (c) fleetsByClass.set(c, [...(fleetsByClass.get(c) || []), f])
    }
    const slugs = new Set([...Object.keys(index.classes), ...fleetsByClass.keys()])
    return [...slugs]
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
      .map((slug) => {
        const art = index.classes[slug]
        const lengths = new Set<number>()
        for (const op of Object.values(art?.operators || {})) {
          for (const [name, f] of Object.entries(op.formations)) {
            if (!isLiveryEndsOnly(slug, name, f, op.formations)) lengths.add(f.length)
          }
        }
        const classFleets = fleetsByClass.get(slug) || []
        const missing = classFleets
          .map((f) => ({ f, o: observed[f.fleetId] }))
          .filter(({ o }) => o && typeof o === 'object' && Object.keys(o.counts).some((n) => !lengths.has(Number(n))))
        return { slug, art, lengths, fleets: classFleets, missing }
      })
  }, [index, fleets, observed])

  const q = query.trim().toLowerCase()
  const visible = classes.filter((c) => {
    if (onlyMismatch && (!c.missing.length && c.art)) return false
    if (onlyUnreviewed && c.art) {
      const keys = Object.entries(c.art.operators).flatMap(([op, o]) => Object.keys(o.formations).map((n) => `${c.slug}/${op}/${n}`))
      if (keys.every((k) => review.marks[k])) return false
    }
    if (!q) return true
    return c.slug.toLowerCase().includes(q) || c.fleets.some((f) => f.fleetId.toLowerCase().includes(q))
  })
  const checkedCount = Object.keys(observed).length
  const mismatchTotal = classes.reduce((n, c) => n + c.missing.length, 0)

  /** One row per distinct drawing of an operator; formations that draw identically are listed under one row. */
  const rowsFor = (opArt: { formations: Record<string, { car: string; flip: boolean }[]> }) => {
    const bySig = new Map<string, { name: string; n: number; also: string[] }>()
    for (const [name, f] of Object.entries(opArt.formations)) {
      const sig = f.map((c) => c.car + (c.flip ? '~' : '')).join(',')
      const hit = bySig.get(sig)
      if (hit) hit.also.push(name)
      else bySig.set(sig, { name, n: f.length, also: [] })
    }
    return [...bySig.values()].sort((a, b) => a.n - b.n)
  }
  const keysOf = (slug: string, art: NonNullable<(typeof classes)[number]['art']>) =>
    Object.entries(art.operators).flatMap(([op, o]) => rowsFor(o).map((r) => `${slug}/${op}/${r.name}`))

  const totals = useMemo(() => {
    let all = 0, ok = 0, remove = 0
    for (const c of classes) {
      if (!c.art) continue
      for (const k of keysOf(c.slug, c.art)) {
        all += 1
        if (review.marks[k] === 'ok') ok += 1
        else if (review.marks[k] === 'remove') remove += 1
      }
    }
    return { all, ok, remove }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classes, review.marks])

  const markClass = (slug: string, art: NonNullable<(typeof classes)[number]['art']>) =>
    setReview((r) => {
      const marks = { ...r.marks }
      for (const k of keysOf(slug, art)) if (!marks[k]) marks[k] = 'ok'
      return { ...r, marks }
    })

  const className = (slug: string) =>
    slug === 'ic225' ? 'InterCity 225' : slug === 'ic125' ? 'InterCity 125' : slug === 't-w-555' ? 'Class 555' : `Class ${slug}`

  return (
    <div className="ds-tdp-page">
      <PageTopHeader
        title="Train Unit Diagrams"
        subtitle="Every drawn formation by class and operator. Review each one, then copy your review back."
      />
      <div className="container container--full-bleed">
        <div className="ds-tdp" style={{ ['--tdp-scale' as string]: review.scale ?? DEFAULT_SCALE }}>
          <div className="ds-tdp__info">
            <section className="ds-tdp__info-card">
              <h2>Drawings</h2>
              <p>Each row is one drawn formation for an operator, drawn exactly as the site would show it. Art is GB Trains, CC BY 4.0.</p>
            </section>
            <section className="ds-tdp__info-card">
              <h2>Fleet check</h2>
              <p>
                Counts the cars of every unit in each fleet. A fleet turns red when some units run at a length that no
                operator is drawn at.
                {checkedCount > 0 && ` ${checkedCount} checked, ${mismatchTotal} flagged.`}
              </p>
            </section>
            <section className="ds-tdp__info-card">
              <h2>Your review</h2>
              <p>
                Mark each drawing <strong>Correct</strong> or <strong>Remove</strong>, and note any variation a class still
                needs. Everything saves in this browser.
              </p>
            </section>
          </div>

          <div className="ds-tdp__bar">
            <input
              className="ds-tdp__search"
              type="search"
              placeholder="Filter by class or fleet, e.g. 170 or 800/1"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <div className="ds-tdp__chips" role="group" aria-label="Filters">
              <button type="button" className={`ds-tdp__chip${onlyMismatch ? ' is-on' : ''}`} aria-pressed={onlyMismatch} onClick={() => setOnlyMismatch((v) => !v)}>
                Has a problem
              </button>
              <button type="button" className={`ds-tdp__chip${onlyUnreviewed ? ' is-on' : ''}`} aria-pressed={onlyUnreviewed} onClick={() => setOnlyUnreviewed((v) => !v)}>
                Not reviewed
              </button>
            </div>
            <div className="ds-tdp__scale">
              <label htmlFor="tdp-scale">Drawing scale</label>
              <input
                id="tdp-scale"
                type="range"
                min={0.3}
                max={2.5}
                step={0.05}
                value={review.scale ?? DEFAULT_SCALE}
                onChange={(e) => setReview((r) => ({ ...r, scale: Number(e.target.value) }))}
              />
              <output>{(review.scale ?? DEFAULT_SCALE).toFixed(2)}×</output>
              <span className="ds-tdp__scale-hint">site: 0.42 boards / 0.6 cards</span>
            </div>
            <div className="ds-tdp__progress" aria-live="polite">
              <span>{totals.ok + totals.remove} / {totals.all} reviewed</span>
              <span className="ds-tdp__count ds-tdp__count--ok">{totals.ok} correct</span>
              <span className="ds-tdp__count ds-tdp__count--remove">{totals.remove} remove</span>
            </div>
            <div className="ds-tdp__actions">
              <BUTWideButton onClick={check} disabled={checking || fleets.length === 0}>
                {checking ? `Checking ${progress}/${fleets.length}…` : checkedCount ? 'Re-check fleets' : 'Check fleets'}
              </BUTWideButton>
              <BUTWideButton onClick={exportReview}>{copied ? 'Copied' : 'Copy my review'}</BUTWideButton>
            </div>
          </div>

          {!index && <p className="ds-tdp__loading">Loading the drawings index…</p>}

          {visible.map(({ slug, art, lengths, fleets: classFleets }) => {
            const keys = art ? keysOf(slug, art) : []
            const done = keys.filter((k) => review.marks[k]).length
            return (
              <section key={slug} className="ds-tdp__class" id={`class-${slug}`}>
                <header className="ds-tdp__class-head">
                  <h2>{className(slug)}</h2>
                  <span className="ds-tdp__pill">{art ? `Drawn at ${[...lengths].sort((a, b) => a - b).join(', ')} cars` : 'No drawing'}</span>
                  {art && <span className={`ds-tdp__pill${done === keys.length ? ' ds-tdp__pill--done' : ''}`}>{done}/{keys.length} reviewed</span>}
                  {art && (
                    <button type="button" className="ds-tdp__link" onClick={() => markClass(slug, art)}>
                      Mark the rest correct
                    </button>
                  )}
                </header>

                {classFleets.length > 0 && (
                  <ul className="ds-tdp__fleets">
                    {classFleets.map((f) => {
                      const o = observed[f.fleetId]
                      const obs = o && typeof o === 'object' ? o : null
                      const bad = !art || (obs && Object.keys(obs.counts).some((n) => !lengths.has(Number(n))))
                      return (
                        <li key={f.fleetId} className={`ds-tdp__fleet${bad && (obs || !art) ? ' ds-tdp__fleet--bad' : obs ? ' ds-tdp__fleet--ok' : ''}`}>
                          <strong>{f.fleetId}</strong>
                          <span>{f.unitCount} units</span>
                          <span>
                            {obs ? Object.entries(obs.counts).map(([n, c]) => `${n} cars × ${c.units}`).join(' · ')
                              : o === 'error' ? 'check failed' : o === 'none' ? 'no consist data' : 'not checked'}
                          </span>
                        </li>
                      )
                    })}
                  </ul>
                )}

                {art && (
                  <div className="ds-tdp__operators">
                    {Object.entries(art.operators).map(([op, opArt]) => (
                      <div key={op} className="ds-tdp__operator">
                        <h3>{operatorLabel(op)}</h3>
                        {rowsFor(opArt).map((r) => {
                          const key = `${slug}/${op}/${r.name}`
                          const state = review.marks[key]
                          const partial = isLiveryEndsOnly(slug, r.name, opArt.formations[r.name], opArt.formations)
                          return (
                            <div key={r.name} className={`ds-tdp__row${state ? ` ds-tdp__row--${state}` : ''}`}>
                              <div className="ds-tdp__row-top">
                                <span className="ds-tdp__row-label">
                                  {partial ? 'Livery ends only (partial)' : `${r.n} cars`}
                                  {r.name !== 'standard' && r.name !== `${r.n}car` && !partial && <em> · {r.name}</em>}
                                  {r.also.length > 0 && <em> · same as {r.also.join(', ')}</em>}
                                </span>
                                <div className="ds-tdp__seg" role="group" aria-label={`Review ${key}`}>
                                  <button type="button" className={`ds-tdp__seg-btn ds-tdp__seg-btn--ok${state === 'ok' ? ' is-on' : ''}`} aria-pressed={state === 'ok'} onClick={() => mark(key, 'ok')}>
                                    Correct
                                  </button>
                                  <button type="button" className={`ds-tdp__seg-btn ds-tdp__seg-btn--remove${state === 'remove' ? ' is-on' : ''}`} aria-pressed={state === 'remove'} onClick={() => mark(key, 'remove')}>
                                    Remove
                                  </button>
                                </div>
                              </div>
                              <TrainDiagram units={[{ fleetId: slug, vehicleCount: r.n, operator: op, formation: r.name }]} gapUnits={review.gaps[slug] ?? classJointGapUnits(slug, op, r.n)} />
                            </div>
                          )
                        })}
                      </div>
                    ))}
                  </div>
                )}

                <div className="ds-tdp__gap">
                  <label htmlFor={`gap-${slug}`}>Gap between cars</label>
                  <input
                    id={`gap-${slug}`}
                    type="range"
                    min={-20}
                    max={20}
                    step={0.25}
                    value={review.gaps[slug] ?? classJointGapUnits(slug) ?? 0}
                    onChange={(e) => setGap(slug, Number(e.target.value))}
                  />
                  <output>
                    {review.gaps[slug] === undefined && classJointGapUnits(slug) === undefined
                      ? 'auto'
                      : `${(review.gaps[slug] ?? classJointGapUnits(slug) ?? 0) > 0 ? '+' : ''}${review.gaps[slug] ?? classJointGapUnits(slug)} units`}
                  </output>
                  <span className="ds-tdp__scale-hint">
                    {review.gaps[slug] !== undefined ? 'changed here' : classJointGapUnits(slug) !== undefined ? 'site default' : 'measured per joint'}
                  </span>
                  <button type="button" className="ds-tdp__link ds-tdp__link--inline" onClick={() => clearGap(slug)} disabled={review.gaps[slug] === undefined}>
                    Reset
                  </button>
                </div>

                <label className="ds-tdp__notes">
                  <span>Variations this class still needs</span>
                  <textarea
                    value={review.notes[slug] || ''}
                    onChange={(e) => setNote(slug, e.target.value)}
                    placeholder="Operator, car count, livery, sub-class…"
                    rows={2}
                  />
                </label>
              </section>
            )
          })}
          <DiagramAttribution />
        </div>
      </div>
    </div>
  )
}

export default TrainDiagramsPage
