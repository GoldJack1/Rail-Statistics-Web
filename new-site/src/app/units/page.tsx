'use client'

import { useMemo } from 'react'
import { useRouter } from 'next/navigation'

import { UnitCatalogCard } from '@/components/cards'
import { bandForFleetId, withUnitDay } from '@/utils/unitClassBands'
import { UnitsBrowseLayout, UnitsBrowseStatus, useUnitsBrowse } from './UnitsBrowseLayout'

function BandsMain() {
  const router = useRouter()
  const { fleets, fleetsStatus, fleetsError, reload, selectedDay } = useUnitsBrowse()

  const bands = useMemo(() => {
    const map = new Map<string, { label: string; classCount: number; unitCount: number; sort: number }>()
    for (const fleet of fleets) {
      const band = bandForFleetId(fleet.fleetId)
      const existing = map.get(band.slug)
      const sort = band.start == null ? Number.MAX_SAFE_INTEGER : band.start
      if (existing) {
        existing.classCount += 1
        existing.unitCount += fleet.unitCount
      } else {
        map.set(band.slug, {
          label: band.label,
          classCount: 1,
          unitCount: fleet.unitCount,
          sort,
        })
      }
    }
    return [...map.entries()]
      .sort((a, b) => a[1].sort - b[1].sort)
      .map(([slug, row]) => ({ slug, ...row }))
  }, [fleets])

  const statusBlock = (
    <UnitsBrowseStatus
      status={fleetsStatus}
      error={fleetsError}
      onRetry={reload}
      loadingLabel="Loading class ranges..."
    />
  )
  if (fleetsStatus !== 'ok') return statusBlock

  if (bands.length === 0) {
    return <p className="units-service-muted">No classes in the catalog yet.</p>
  }

  return (
    <>
      <header className="units-service-content-head">
        <h2>Class ranges</h2>
        <p>{bands.length} {bands.length === 1 ? 'range' : 'ranges'}</p>
      </header>
      <div className="units-service-unit-grid">
        {bands.map((band) => (
          <UnitCatalogCard
            key={band.slug}
            unitId={band.label}
            fleetId={band.slug}
            eyebrow="Class range"
            subtitle={`${band.classCount} class${band.classCount === 1 ? '' : 'es'} · ${band.unitCount.toLocaleString('en-GB')} unit${band.unitCount === 1 ? '' : 's'}`}
            onClick={() => router.push(withUnitDay(`/units/range/${encodeURIComponent(band.slug)}`, selectedDay))}
          />
        ))}
      </div>
    </>
  )
}

export default function UnitsInServicePage() {
  return (
    <UnitsBrowseLayout
      title="Units in service"
      subtitle="Pick a class range, then a class, then a unit"
    >
      <BandsMain />
    </UnitsBrowseLayout>
  )
}
