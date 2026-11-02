import type { ServiceDetail, ServiceStop } from '@/types/darwin'

const CLASS_GROUPS: Record<string, string> = {
  '150': '150/153/155/156',
  '153': '150/153/155/156',
  '155': '150/153/155/156',
  '156': '150/153/155/156',
  '158': '158/159',
  '159': '158/159',
  '165': '165/166',
  '166': '165/166',
  '170': '170/171',
  '171': '170/171',
  '220': '220/221',
  '221': '220/221',
  '375': '375/377/379',
  '377': '375/377/379',
  '379': '375/377/379',
  '800': '80x',
  '801': '80x',
  '802': '80x',
  '803': '80x',
  '805': '80x',
  '807': '80x',
}

const CATEGORY: Record<string, string> = {
  OO: 'Ordinary Passenger',
  OU: 'Unadvertised Ordinary Passenger',
  OS: 'Staff Train',
  XX: 'Express Passenger',
  XZ: 'Sleeper (Domestic)',
  EE: 'Empty Coaching Stock',
  BR: 'Bus Replacement',
}

export function pathedAsText(
  powerType?: string | null,
  timingLoad?: string | null,
  speed?: string | null,
): string | null {
  const power = String(powerType || '').trim().toUpperCase()
  const load = String(timingLoad || '').trim().toUpperCase().replace(/^0+/, '')
  const classes = CLASS_GROUPS[load] || (/^\d{3}$/.test(load) ? load : '')
  const mph = Number(String(speed || '').trim())
  if (!power && !classes) return null
  const traction = power === 'EMU' ? 'on electric' : power
  const body = ['Pathed as', classes ? `Class ${classes}` : '', traction].filter(Boolean).join(' ')
  return Number.isFinite(mph) && mph > 0 ? `${body} at ${mph}mph` : body
}

export function categoryText(code?: string | null): string | null {
  const key = String(code || '').trim().toUpperCase()
  return CATEGORY[key] || null
}

export interface SchedulePanelRow {
  text: string
}

export interface OverviewField {
  label: string
  value: string
  note?: string
}

export interface OverviewSidebarModel {
  lines: string[]
  operating: string | null
  category: string | null
  pathed: string | null
  extras: string[]
  pair: OverviewField[]
  fields: OverviewField[]
}

function daysField(schedule: ServiceDetail['schedule']): OverviewField | null {
  const label = String(schedule?.daysRun || '').trim()
  const from = String(schedule?.runsFrom || '').trim()
  const to = String(schedule?.runsTo || '').trim()
  const raw = String(schedule?.daysLabel || '').trim()
  const split = raw.split(/\s+-\s+/)
  if (split.length >= 2 && split[0] && split.slice(1).join(' - ')) {
    return { label: split[0], value: split.slice(1).join(' - ') }
  }
  const range = [from, to].filter(Boolean).join(' to ')
  if (label && range) return { label, value: range }
  if (raw) return { label: label || 'Days', value: raw }
  if (range) return { label: label || 'Days', value: range }
  return null
}

function activatedNote(value: string | null | undefined): string | null {
  const raw = String(value || '').trim()
  if (!raw) return null
  const dated = raw.match(/^(\d{2}\/\d{2}\/\d{4})\s+(\d{2}:\d{2})/)
  if (dated) return `Activated ${dated[1]} at ${dated[2]}`
  return /^activated\b/i.test(raw) ? raw : `Activated ${raw}`
}

/** Identity block shown in the service sidebar, matching the overview dropdown. */
export function overviewSidebarModel(data: ServiceDetail): OverviewSidebarModel {
  const schedule = data.schedule
  const operating = String(schedule?.operatingLabel || '').trim() || null
  const category = schedule?.categoryLabel || categoryText(data.trainCat) || (data.isPassenger ? 'Passenger Service' : null)
  const pathed = schedule?.pathedAs || pathedAsText(data.powerType || schedule?.powerType, data.timingLoad || schedule?.timingLoad, schedule?.speed)
  const extras = [schedule?.seatingLabel, schedule?.reservationsLabel].map((line) => String(line || '').trim()).filter(Boolean)
  const lines = [operating, category, pathed, ...extras].filter((line): line is string => Boolean(line))

  const headcode = String(schedule?.identity || data.trainId || '').trim()
  const uid = String(schedule?.uid || data.uid || '').trim()
  const pair: OverviewField[] = []
  if (headcode) pair.push({ label: 'Headcode', value: headcode })
  if (uid) pair.push({ label: 'UID', value: uid })

  const fields: OverviewField[] = []
  const days = daysField(schedule)
  if (days) fields.push(days)
  const units = (schedule?.units?.length ? schedule.units : data.units)?.map((unit) => String(unit || '').trim()).filter(Boolean) || []
  if (units.length) fields.push({ label: 'Formed by', value: units.join(' + ') })
  const trustId = String(schedule?.trustId || '').trim()
  const activated = activatedNote(schedule?.activatedAt)
  if (trustId) fields.push({ label: 'Trust ID', value: trustId, note: activated || undefined })
  else if (activated) fields.push({ label: 'Activated', value: activated.replace(/^Activated\s+/i, '') })
  const tsc = String(schedule?.tsc || '').trim()
  if (tsc) fields.push({ label: 'TSC', value: tsc })
  const retail = String(schedule?.headcode || '').trim()
  if (retail && retail !== headcode) fields.push({ label: 'Diagram', value: retail })

  return { lines, operating, category, pathed, extras, pair, fields }
}

export function schedulePanelRows(data: ServiceDetail): SchedulePanelRow[] {
  const schedule = data.schedule
  const rows: string[] = []
  const uid = schedule?.uid || data.uid
  const identity = schedule?.identity || data.trainId
  if (uid || identity) {
    rows.push([uid ? `UID ${uid}` : '', identity ? `identity ${identity}` : ''].filter(Boolean).join(', '))
  }
  if (schedule?.tsc || schedule?.headcode) {
    rows.push(
      [schedule.tsc ? `TSC ${schedule.tsc}` : '', schedule.headcode ? `headcode ${schedule.headcode}` : '']
        .filter(Boolean)
        .join(', '),
    )
  }
  if (schedule?.daysLabel) rows.push(schedule.daysLabel)
  const category = schedule?.categoryLabel || categoryText(data.trainCat)
  if (category) rows.push(category)
  if (schedule?.operatingLabel) rows.push(schedule.operatingLabel)
  const units = (schedule?.units?.length ? schedule.units : data.units)?.filter(Boolean) || []
  if (units.length) rows.push(`Operated with ${units.join(' + ')}`)
  if (schedule?.seatingLabel) rows.push(schedule.seatingLabel)
  if (schedule?.reservationsLabel) rows.push(schedule.reservationsLabel)
  if (schedule?.trustId) rows.push(`TRUST ID ${schedule.trustId}`)
  if (schedule?.activatedAt) rows.push(`Activated ${schedule.activatedAt}`)
  const pathed = schedule?.pathedAs || pathedAsText(data.powerType, data.timingLoad, schedule?.speed)
  if (pathed) rows.push(pathed)
  return rows.filter(Boolean).map((text) => ({ text }))
}

export function stopPathNote(stop: ServiceStop, first: boolean, fallback: string | null): string | null {
  if (stop.pathedAs) return stop.pathedAs
  return first ? fallback : null
}

export function stopAllowanceNote(stop: ServiceStop): string | null {
  const notes = (stop.allowances || []).filter(Boolean)
  return notes.length ? notes.join(' · ') : null
}
