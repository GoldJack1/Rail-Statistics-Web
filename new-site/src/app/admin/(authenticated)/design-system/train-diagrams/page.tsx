'use client'

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { PageTopHeader } from '@/components/misc'
import { BUTWideButton } from '@/components/buttons'
import { DiagramAttribution, TrainDiagram, useDiagramIndex } from '@/components/darwin/CarriageMap'
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

const TrainDiagramsPage: React.FC = () => {
  const index = useDiagramIndex()
  const [fleets, setFleets] = useState<Fleet[]>([])
  const [observed, setObserved] = useState<Record<string, Observed>>({})
  const [checking, setChecking] = useState(false)
  const [progress, setProgress] = useState(0)
  const [query, setQuery] = useState('')
  const [onlyMismatch, setOnlyMismatch] = useState(false)

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
          for (const f of Object.values(op.formations)) lengths.add(f.length)
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
    if (!q) return true
    return c.slug.toLowerCase().includes(q) || c.fleets.some((f) => f.fleetId.toLowerCase().includes(q))
  })
  const checkedCount = Object.keys(observed).length
  const mismatchTotal = classes.reduce((n, c) => n + c.missing.length, 0)

  return (
    <div className="ds-tdp-page">
      <PageTopHeader
        title="Train Unit Diagrams"
        subtitle="Every drawn formation by class and operator, checked against the number of vehicles each fleet (sub-class) is seen running with."
      />
      <div className="container container--full-bleed">
        <div className="ds-tdp">
          <div className="ds-tdp__toolbar">
            <input
              className="ds-tdp__search"
              type="search"
              placeholder="Filter by class or fleet, e.g. 170 or 800/1"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <label className="ds-tdp__toggle">
              <input type="checkbox" checked={onlyMismatch} onChange={(e) => setOnlyMismatch(e.target.checked)} />
              Only classes with a problem
            </label>
            <BUTWideButton onClick={check} disabled={checking || fleets.length === 0}>
              {checking ? `Checking ${progress}/${fleets.length}…` : checkedCount ? 'Re-check fleets' : 'Check fleet formations'}
            </BUTWideButton>
          </div>
          <p className="ds-tdp__note">
            The check counts the vehicles of every unit in each fleet. A fleet is flagged when some of its units run at a length no operator&apos;s
            art is drawn at (the site then stretches or trims a drawing to fit), and a class is flagged when it
            has fleets in service but no art at all.
            {checkedCount > 0 && ` ${checkedCount} fleets checked, ${mismatchTotal} flagged.`}
          </p>

          {!index && <p className="ds-tdp__note">Loading the drawings index…</p>}

          {visible.map(({ slug, art, lengths, fleets: classFleets }) => (
            <section key={slug} className="ds-tdp__class" id={`class-${slug}`}>
              <header className="ds-tdp__class-head">
                <h2>{slug === 'ic225' ? 'InterCity 225' : slug === 'ic125' ? 'InterCity 125' : `Class ${slug}`}</h2>
                <span className="ds-tdp__lengths">
                  {art ? `Drawn at ${[...lengths].sort((a, b) => a - b).join(', ')} cars` : 'No drawing'}
                </span>
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

              {art && Object.entries(art.operators).map(([op, opArt]) => {
                const seen = new Set<string>()
                const rows = Object.entries(opArt.formations)
                  .map(([name, f]) => ({ name, n: f.length, sig: f.map((c) => c.car + (c.flip ? '~' : '')).join(',') }))
                  .filter((r) => (seen.has(r.sig) ? false : (seen.add(r.sig), true)))
                  .sort((a, b) => a.n - b.n)
                return (
                  <div key={op} className="ds-tdp__operator">
                    <h3>{operatorLabel(op)}</h3>
                    {rows.map((r) => (
                      <div key={r.name} className="ds-tdp__row">
                        <span className="ds-tdp__row-label">{r.n} cars{r.name !== 'standard' ? ` · ${r.name}` : ''}</span>
                        <TrainDiagram units={[{ fleetId: slug, vehicleCount: r.n, operator: op }]} />
                      </div>
                    ))}
                  </div>
                )
              })}
            </section>
          ))}
          <DiagramAttribution />
        </div>
      </div>
    </div>
  )
}

export default TrainDiagramsPage
