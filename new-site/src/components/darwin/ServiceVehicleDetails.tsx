'use client'

import type { ConsistData, PtacVehicle } from '@/types/darwin'

export type ServiceUnitGroup = {
  unitKey: string
  unitId: string | null
  fleetId: string | null
  resourceType: string | null
  unitStatus: string | null
  endOfDayMiles: number | null
  reversed: boolean
  vehicles: PtacVehicle[]
}

function formatDateOnly(value: string | null | undefined): string {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'Europe/London',
  })
}

function renderDetailField(
  label: string,
  value: string | number | null | undefined,
  opts?: { fullWidth?: boolean }
) {
  if (value == null) return null
  const text = String(value).trim()
  if (!text || text === '—') return null
  return (
    <div className={`svc-allocation-field${opts?.fullWidth ? ' svc-allocation-field--block' : ''}`}>
      <span className="svc-allocation-label">{label}</span>
      <span className="svc-allocation-value">{text}</span>
    </div>
  )
}

function sharedFrom(
  vehicles: PtacVehicle[],
  pick: (v: PtacVehicle) => string | null
) {
  if (vehicles.length === 0) return null
  const first = pick(vehicles[0])
  if (!first) return null
  return vehicles.every((v) => pick(v) === first) ? first : null
}

function summariseEnteredService(vehicles: PtacVehicle[], sharedEntered: string | null) {
  if (sharedEntered) return formatDateOnly(sharedEntered)
  const enteredByDate = new Map<string, string[]>()
  vehicles.forEach((v) => {
    const date = v.dateEnteredService || 'Unknown date'
    const label = v.vehicleId || `Pos ${v.position ?? '—'}`
    const arr = enteredByDate.get(date) || []
    arr.push(label)
    enteredByDate.set(date, arr)
  })
  return [...enteredByDate.entries()]
    .map(([date, ids]) => `${formatDateOnly(date)}: ${ids.join(', ')}`)
    .join('; ')
}

export function groupUnitsFromConsist(consist: ConsistData | null | undefined): ServiceUnitGroup[] {
  if (!consist?.allocations?.length) return []
  const map = new Map<string, ServiceUnitGroup>()
  consist.allocations.forEach((a) => {
    ;(a.resourceGroups || []).forEach((g, groupIdx) => {
      const unitKey = `unit-${g.unitId || 'unknown'}-${g.fleetId || 'unknown'}-${groupIdx}`
      const existing = map.get(unitKey)
      if (!existing) {
        map.set(unitKey, {
          unitKey,
          unitId: g.unitId || null,
          fleetId: g.fleetId || null,
          resourceType: g.typeOfResourceLabel || g.typeOfResource || null,
          unitStatus: g.status || null,
          endOfDayMiles: g.endOfDayMiles ?? null,
          reversed: !!a.reversed,
          vehicles: [...(g.vehicles || [])],
        })
        return
      }
      const seen = new Set(existing.vehicles.map((v) => `${v.vehicleId || ''}-${v.position ?? ''}`))
      for (const v of g.vehicles || []) {
        const vk = `${v.vehicleId || ''}-${v.position ?? ''}`
        if (!seen.has(vk)) {
          existing.vehicles.push(v)
          seen.add(vk)
        }
      }
    })
  })
  return [...map.values()]
}

type ServiceVehicleDetailsProps = {
  consist: ConsistData | null | undefined
}

export function ServiceVehicleDetails({ consist }: ServiceVehicleDetailsProps) {
  const unitGroups = groupUnitsFromConsist(consist)

  if (unitGroups.length === 0) {
    return (
      <div className="unit-service-vehicles">
        <p className="unit-muted">No allocation groups available for this service.</p>
      </div>
    )
  }

  return (
    <div className="unit-service-vehicles">
      <section className="svc-collapsible-card svc-vehicle-card" aria-label="Vehicle details & logs">
        <h3 className="svc-pattern-title">Vehicle details & logs</h3>
        <p className="svc-allocation-subtitle">
          Full allocation fields and defect logs for each vehicle in the formation above.
        </p>
        <div className="svc-vehicle-list">
          {unitGroups.map((g) => {
            const sortedVehicles = g.vehicles
              .slice()
              .sort((a, b) => (a.position ?? 999) - (b.position ?? 999))
            const shared = {
              vehicleType: sharedFrom(sortedVehicles, (v) => v.typeOfVehicle || null),
              plannedGroup: sharedFrom(sortedVehicles, (v) => v.plannedGroupId || null),
              maxSpeed: sharedFrom(sortedVehicles, (v) => (v.maximumSpeedMph != null ? `${v.maximumSpeedMph} mph` : null)),
              brakeType: sharedFrom(sortedVehicles, (v) => v.trainBrakeTypeLabel || v.trainBrakeType || null),
              status: sharedFrom(sortedVehicles, (v) => v.vehicleStatus || null),
              category: sharedFrom(sortedVehicles, (v) => v.registeredCategoryLabel || v.registeredCategory || null),
              liveryDecor: sharedFrom(sortedVehicles, (v) => ([v.livery, v.decor].filter(Boolean).join(' · ') || null)),
              entered: sharedFrom(sortedVehicles, (v) => v.dateEnteredService || null),
            }

            return (
              <article className="svc-unit-item" key={g.unitKey}>
                <header className="svc-vehicle-head">
                  <h3 className="svc-vehicle-title">Unit {g.unitId || 'Unknown'}</h3>
                </header>
                <div className="svc-unit-shared">
                  <h4 className="svc-vehicle-logs-title">Whole unit (shared details)</h4>
                  <div className="svc-allocation-grid">
                    {renderDetailField('Fleet', g.fleetId)}
                    {renderDetailField('Resource type', g.resourceType)}
                    {renderDetailField('Unit status', g.unitStatus)}
                    {renderDetailField('End-of-day miles', g.endOfDayMiles)}
                    {renderDetailField('Vehicle count', sortedVehicles.length)}
                    {g.reversed ? renderDetailField('Formation direction', 'Reversed') : null}
                    {renderDetailField('Vehicle type', shared.vehicleType)}
                    {renderDetailField('Planned group', shared.plannedGroup)}
                    {renderDetailField('Max speed', shared.maxSpeed)}
                    {renderDetailField('Brake type', shared.brakeType)}
                    {renderDetailField('Status', shared.status)}
                    {renderDetailField('Category', shared.category)}
                    {renderDetailField('Livery / decor', shared.liveryDecor)}
                    {renderDetailField(
                      'Date entered service',
                      summariseEnteredService(sortedVehicles, shared.entered),
                      { fullWidth: true }
                    )}
                  </div>
                </div>

                <div className="svc-unit-vehicles">
                  {sortedVehicles.map((v, vIdx) => {
                    const defects = v.defects || []
                    const lengthWeight = (v.lengthMm != null || v.weightTonnes != null)
                      ? `${v.lengthMm != null ? `${v.lengthMm} mm` : '—'} / ${v.weightTonnes != null ? `${v.weightTonnes} t` : '—'}`
                      : null
                    return (
                      <article className="svc-vehicle-item" key={`${g.unitKey}-v-${v.vehicleId || vIdx}`}>
                        <header className="svc-vehicle-head">
                          <h4 className="svc-vehicle-title">{v.vehicleId || `Vehicle ${vIdx + 1}`}</h4>
                          <div className="svc-allocation-tags">
                            {v.position != null && <span className="svc-allocation-tag">Pos {v.position}</span>}
                            {defects.length > 0 && (
                              <span className="svc-allocation-tag svc-allocation-tag--warn">
                                {defects.length} log{defects.length === 1 ? '' : 's'}
                              </span>
                            )}
                          </div>
                        </header>
                        <div className="svc-allocation-grid">
                          {renderDetailField('Specific type', v.specificType || null)}
                          {renderDetailField('Seats', v.numberOfSeats ?? null)}
                          {renderDetailField('Cabs', v.cabs ?? null)}
                          {renderDetailField('Length / weight', lengthWeight)}
                          {renderDetailField('Special characteristics', v.specialCharacteristics || null)}
                          {renderDetailField('Vehicle name', v.vehicleName || null)}
                          {renderDetailField(
                            'Date entered service',
                            v.dateEnteredService ? formatDateOnly(v.dateEnteredService) : null
                          )}
                        </div>
                        {defects.length > 0 ? (
                          <ul className="svc-vehicle-log-list">
                            {defects.map((d, idx) => (
                              <li className="svc-vehicle-log-item" key={`${v.vehicleId || vIdx}-d-${idx}`}>
                                <span className="svc-vehicle-log-main">
                                  {d.code || 'No code'} — {d.description || 'No description'}
                                </span>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className="svc-vehicle-no-logs">Logs: 0</p>
                        )}
                      </article>
                    )
                  })}
                </div>
              </article>
            )
          })}
        </div>
      </section>
    </div>
  )
}
