'use client'

import { useMemo } from 'react'
import { useParams, useRouter } from 'next/navigation'

import { UnitCatalogCard } from '@/components/cards'
import { paramAsString } from '@/utils/nextParams'
import { classKey, fleetInBand, parseBandSlug, withUnitDay } from '@/utils/unitClassBands'
import { UnitsBrowseLayout, UnitsBrowseStatus, useUnitsBrowse } from '../../UnitsBrowseLayout'

function ClassesMain({ bandSlug }: { bandSlug: string }) {
  const router = useRouter()
  const { fleets, fleetsStatus, fleetsError, reload, selectedDay } = useUnitsBrowse()
  const band = parseBandSlug(bandSlug)

  const classes = useMemo(() => {
    if (!band) return []
    const grouped = new Map<string, { fleetId: string; unitCount: number }>()
    for (const fleet of fleets) {
      if (!fleetInBand(fleet.fleetId, band)) continue
      const key = classKey(fleet.fleetId)
      const existing = grouped.get(key)
      if (existing) existing.unitCount += fleet.unitCount
      else grouped.set(key, { fleetId: key, unitCount: fleet.unitCount })
    }
    return [...grouped.values()].sort((a, b) => a.fleetId.localeCompare(b.fleetId, undefined, { numeric: true }))
  }, [band, fleets])

  if (!band) {
    return <p className="units-service-muted">That class range is not valid.</p>
  }

  if (fleetsStatus !== 'ok') {
    return (
      <UnitsBrowseStatus
        status={fleetsStatus}
        error={fleetsError}
        onRetry={reload}
        loadingLabel="Loading classes..."
      />
    )
  }

  if (classes.length === 0) {
    return <p className="units-service-muted">No classes in {band.label}.</p>
  }

  return (
    <>
      <header className="units-service-content-head">
        <h2>Classes {band.label}</h2>
        <p>{classes.length} {classes.length === 1 ? 'class' : 'classes'}</p>
      </header>
      <div className="units-service-unit-grid">
        {classes.map((fleet) => (
          <UnitCatalogCard
            key={fleet.fleetId}
            unitId={fleet.fleetId}
            fleetId={fleet.fleetId}
            eyebrow="Class"
            subtitle={`${fleet.unitCount.toLocaleString('en-GB')} unit${fleet.unitCount === 1 ? '' : 's'}`}
            onClick={() => router.push(withUnitDay(`/units/class/${encodeURIComponent(fleet.fleetId)}`, selectedDay))}
          />
        ))}
      </div>
    </>
  )
}

export default function UnitsRangePage() {
  const params = useParams()
  const bandSlug = paramAsString(params?.band)
  const band = parseBandSlug(bandSlug)

  return (
    <UnitsBrowseLayout
      title={band ? `Classes ${band.label}` : 'Class range'}
      subtitle="Pick a class to see its units"
      backTo="/units"
      backLabel="All ranges"
    >
      <ClassesMain bandSlug={bandSlug} />
    </UnitsBrowseLayout>
  )
}
