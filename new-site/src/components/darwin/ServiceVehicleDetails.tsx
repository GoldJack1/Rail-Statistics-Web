'use client'

import { useState } from 'react'

import type { ConsistData, PtacVehicle } from '@/types/darwin'
import { ChevronRightIcon } from '@/components/icons'
import AutoAnimateCollapse from '@/components/misc/AutoAnimateCollapse/AutoAnimateCollapse'
import SidebarDropdownSection from '@/components/misc/SidebarDropdownSection/SidebarDropdownSection'
import StationDetailField from '@/components/models/StationDetails/StationDetailField'

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

function joinMeta(parts: Array<string | number | null | undefined>): string {
  return parts
    .map((part) => (part == null ? '' : String(part).trim()))
    .filter(Boolean)
    .join(' · ')
}

function formatMiles(value: number | null | undefined): string | null {
  if (value == null || !Number.isFinite(value)) return null
  return `${value.toLocaleString('en-GB')} miles`
}

function formatDateOnly(value: string | null | undefined): string | null {
  if (!value) return null
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
) {
  if (value == null) return null
  const text = String(value).trim()
  if (!text || text === '—') return null
  return <StationDetailField label={label} value={text} />
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

function VehicleRow({
  vehicle,
  unitKey,
  index,
}: {
  vehicle: PtacVehicle
  unitKey: string
  index: number
}) {
  const [open, setOpen] = useState(false)
  const defects = vehicle.defects || []
  const title = vehicle.vehicleId || `Vehicle ${index + 1}`
  const vehicleMeta = joinMeta([
    vehicle.specificType,
    vehicle.numberOfSeats != null ? `${vehicle.numberOfSeats} seats` : null,
    vehicle.cabs ? `${vehicle.cabs} cab${vehicle.cabs === 1 ? '' : 's'}` : null,
    vehicle.vehicleName,
  ])
  const lengthWeight = (vehicle.lengthMm != null || vehicle.weightTonnes != null)
    ? `${vehicle.lengthMm != null ? `${vehicle.lengthMm} mm` : '—'} / ${vehicle.weightTonnes != null ? `${vehicle.weightTonnes} t` : '—'}`
    : null
  const detailsId = `${unitKey}-v-${vehicle.vehicleId || index}-details`

  return (
    <article className={`svc-vehicle-item${open ? ' svc-vehicle-item--open' : ''}`}>
      <button
        type="button"
        className="svc-vehicle-line svc-vehicle-line--toggle"
        aria-expanded={open}
        aria-controls={detailsId}
        onClick={() => setOpen((current) => !current)}
      >
        <h4 className="svc-vehicle-title">{title}</h4>
        {vehicleMeta ? <span className="svc-vehicle-meta">{vehicleMeta}</span> : null}
        {vehicle.position != null && (
          <span className="svc-vehicle-pos">Pos {vehicle.position}</span>
        )}
        {defects.length > 0 && (
          <span className="svc-allocation-tag svc-allocation-tag--warn">
            {defects.length} log{defects.length === 1 ? '' : 's'}
          </span>
        )}
        <ChevronRightIcon className="svc-vehicle-chevron" aria-hidden />
      </button>
      <AutoAnimateCollapse isOpen={open} className="svc-vehicle-collapse" id={detailsId}>
        <div className="svc-vehicle-detail">
          {renderDetailField('Specific type', vehicle.specificType || null)}
          {renderDetailField('Seats', vehicle.numberOfSeats ?? null)}
          {renderDetailField('Cabs', vehicle.cabs ?? null)}
          {renderDetailField('Length / weight', lengthWeight)}
          {renderDetailField('Special characteristics', vehicle.specialCharacteristics || null)}
          {renderDetailField('Vehicle name', vehicle.vehicleName || null)}
          {renderDetailField('Date entered service', formatDateOnly(vehicle.dateEnteredService))}
        </div>
        {defects.length > 0 ? (
          <ul className="svc-vehicle-log-list">
            {defects.map((d, idx) => (
              <li className="svc-vehicle-log-item" key={`${vehicle.vehicleId || index}-d-${idx}`}>
                <span className="svc-vehicle-log-main">
                  {d.code || 'No code'} — {d.description || 'No description'}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </AutoAnimateCollapse>
    </article>
  )
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
      {unitGroups.map((g) => {
        const sortedVehicles = g.vehicles
          .slice()
          .sort((a, b) => (a.position ?? 999) - (b.position ?? 999))
        const logCount = sortedVehicles.reduce((sum, v) => sum + (v.defects?.length || 0), 0)
        const maxSpeed = sharedFrom(sortedVehicles, (v) => (
          v.maximumSpeedMph != null ? `${v.maximumSpeedMph} mph` : null
        ))
        const unitMeta = joinMeta([
          g.fleetId,
          formatMiles(g.endOfDayMiles),
          maxSpeed,
          g.reversed ? 'Reversed' : null,
        ])

        return (
          <SidebarDropdownSection
            key={g.unitKey}
            title={`Unit ${g.unitId || 'Unknown'}`}
            defaultExpanded={false}
            className="svc-content-dropdown"
            titleAddon={logCount > 0 ? (
              <span className="svc-allocation-tag svc-allocation-tag--warn">
                {logCount} log{logCount === 1 ? '' : 's'}
              </span>
            ) : undefined}
          >
            {unitMeta ? <p className="svc-unit-meta">{unitMeta}</p> : null}

            <div className="svc-unit-vehicles">
              {sortedVehicles.map((v, vIdx) => (
                <VehicleRow
                  key={`${g.unitKey}-v-${v.vehicleId || vIdx}`}
                  vehicle={v}
                  unitKey={g.unitKey}
                  index={vIdx}
                />
              ))}
            </div>
          </SidebarDropdownSection>
        )
      })}
    </div>
  )
}
