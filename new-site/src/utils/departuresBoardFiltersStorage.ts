import type { DepartureServiceType } from '@/types/darwin'

const STORAGE_KEY = 'railstats:departuresBoardFilters:v1'

export type DeparturesBoardMode = 'departures' | 'arrivals'
export type DeparturesStopMode = 'calling' | 'passing'
export type DeparturesStatusFilter = 'on-time' | 'early' | 'delayed' | 'cancelled'

const SERVICE_TYPES = new Set<DepartureServiceType>(['passenger', 'freight', 'rail-replacement', 'other'])
const STOP_MODES = new Set<DeparturesStopMode>(['calling', 'passing'])
const STATUSES = new Set<DeparturesStatusFilter>(['on-time', 'early', 'delayed', 'cancelled'])

export type DeparturesBoardFilters = {
  code: string
  boardMode: DeparturesBoardMode
  toc: string[] | null
  serviceTypes: DepartureServiceType[] | null
  platforms: string[] | null
  statuses: DeparturesStatusFilter[] | null
  places: string[] | null
  stopModes: DeparturesStopMode[] | null
}

/** `null` means every option. An empty list means none. */
export function narrowSelection<T extends string>(selection: readonly T[] | null, options: readonly T[]): T[] {
  if (selection === null) return [...options]
  const allowed = new Set(options)
  return selection.filter((item): item is T => allowed.has(item))
}

/** Select All collapses to `null`. Clear All stays an empty list. */
export function selectionFromDropdown<T extends string>(selected: readonly T[], options: readonly T[]): T[] | null {
  if (selected.length === 0) return []
  if (options.length > 0 && options.every((option) => selected.includes(option))) return null
  return [...selected]
}

function stringListOrNull(value: unknown): string[] | null | undefined {
  if (value === null) return null
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) return undefined
  return value
}

function enumListOrNull<T extends string>(value: unknown, allowed: Set<T>): T[] | null | undefined {
  const list = stringListOrNull(value)
  if (list === undefined) return undefined
  if (list === null) return null
  if (list.some((item) => !allowed.has(item as T))) return undefined
  return list as T[]
}

export function readDeparturesBoardFilters(code: string): DeparturesBoardFilters | null {
  if (typeof window === 'undefined' || !code) return null
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<DeparturesBoardFilters>
    if (!parsed || parsed.code !== code) return null
    if (parsed.boardMode !== 'departures' && parsed.boardMode !== 'arrivals') return null
    const toc = stringListOrNull(parsed.toc)
    const serviceTypes = enumListOrNull(parsed.serviceTypes, SERVICE_TYPES)
    const platforms = stringListOrNull(parsed.platforms)
    const statuses = enumListOrNull(parsed.statuses, STATUSES)
    const places = stringListOrNull(parsed.places)
    const stopModes = enumListOrNull(parsed.stopModes, STOP_MODES)
    if (
      toc === undefined
      || serviceTypes === undefined
      || platforms === undefined
      || statuses === undefined
      || places === undefined
      || stopModes === undefined
    ) return null
    return {
      code,
      boardMode: parsed.boardMode,
      toc,
      serviceTypes,
      platforms,
      statuses,
      places,
      stopModes,
    }
  } catch {
    return null
  }
}

export function writeDeparturesBoardFilters(state: DeparturesBoardFilters): void {
  if (typeof window === 'undefined' || !state.code) return
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    /* private mode */
  }
}

export function clearDeparturesBoardFilters(): void {
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.removeItem(STORAGE_KEY)
  } catch {
    /* private mode */
  }
}
