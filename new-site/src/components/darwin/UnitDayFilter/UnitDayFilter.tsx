'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { CalendarBlank, CaretLeft, CaretRight } from '@phosphor-icons/react'

import { BUTCircleButton, BUTTabButton } from '@/components/buttons'
import '@/components/cards/NetworkStationTabGroup/NetworkStationTabGroup.css'
import './UnitDayFilter.css'

const MAX_DATE_TABS = 12
const WEEKDAY_LABELS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']

export type UnitDayFilterProps = {
  availableDays: string[]
  selectedDay: string
  onSelect: (day: string) => void
}

function parseIsoDay(iso: string): Date {
  return new Date(`${iso}T12:00:00`)
}

function formatTabDate(iso: string, includeYear: boolean): string {
  const d = parseIsoDay(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    ...(includeYear ? { year: '2-digit' } : {}),
  })
}

function monthKey(iso: string): string {
  return iso.slice(0, 7)
}

function startOfCalendarGrid(year: number, monthIndex: number): Date {
  const first = new Date(year, monthIndex, 1, 12, 0, 0)
  const mondayOffset = (first.getDay() + 6) % 7
  first.setDate(first.getDate() - mondayOffset)
  return first
}

function ymd(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function UnitDayFilter({ availableDays, selectedDay, onSelect }: UnitDayFilterProps) {
  const rootRef = useRef<HTMLElement | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const availableSet = useMemo(() => new Set(availableDays), [availableDays])
  const monthKeys = useMemo(
    () => Array.from(new Set(availableDays.map(monthKey))).sort(),
    [availableDays]
  )
  const yearsDiffer = useMemo(() => {
    const years = new Set(availableDays.map((d) => d.slice(0, 4)))
    return years.size > 1
  }, [availableDays])

  const tabDays = useMemo(() => {
    const newest = availableDays.slice(0, MAX_DATE_TABS)
    if (selectedDay === 'all' || !availableSet.has(selectedDay) || newest.includes(selectedDay)) {
      return newest
    }
    return [selectedDay, ...newest.slice(0, MAX_DATE_TABS - 1)]
  }, [availableDays, availableSet, selectedDay])

  const initialMonth = selectedDay !== 'all' && availableSet.has(selectedDay)
    ? monthKey(selectedDay)
    : (monthKeys[monthKeys.length - 1] || monthKey(ymd(new Date())))
  const [visibleMonth, setVisibleMonth] = useState(initialMonth)

  useEffect(() => {
    if (monthKeys.length === 0) return
    if (!monthKeys.includes(visibleMonth)) {
      setVisibleMonth(monthKeys[monthKeys.length - 1])
    }
  }, [monthKeys, visibleMonth])

  useEffect(() => {
    if (!pickerOpen) return
    if (selectedDay !== 'all' && availableSet.has(selectedDay)) {
      setVisibleMonth(monthKey(selectedDay))
    }
  }, [pickerOpen, selectedDay, availableSet])

  useEffect(() => {
    if (!pickerOpen) return
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setPickerOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPickerOpen(false)
    }
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [pickerOpen])

  const monthIndex = monthKeys.indexOf(visibleMonth)
  const canPrev = monthIndex > 0
  const canNext = monthIndex >= 0 && monthIndex < monthKeys.length - 1
  const [yearStr, monthStr] = visibleMonth.split('-')
  const year = Number(yearStr)
  const month = Number(monthStr) - 1
  const monthLabel = Number.isFinite(year) && Number.isFinite(month)
    ? new Date(year, month, 1, 12).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
    : visibleMonth

  const cells = useMemo(() => {
    if (!Number.isFinite(year) || !Number.isFinite(month)) return []
    const start = startOfCalendarGrid(year, month)
    return Array.from({ length: 42 }, (_, i) => {
      const date = new Date(start)
      date.setDate(start.getDate() + i)
      const iso = ymd(date)
      return {
        iso,
        inMonth: date.getMonth() === month,
        enabled: availableSet.has(iso),
        label: String(date.getDate()),
      }
    })
  }, [availableSet, month, year])

  const chooseSelected = pickerOpen || (selectedDay !== 'all' && !tabDays.includes(selectedDay))

  return (
    <section ref={rootRef} className="unit-date-filter-card unit-day-filter" aria-label="Unit day filter">
      <span className="unit-day-filter__label">Show unit data for day</span>
      <div className="network-station-tab-group unit-day-filter__tabs" role="tablist" aria-label="Unit days">
        <BUTTabButton
          type="button"
          width="hug"
          ariaLabel="Choose date"
          onClick={() => setPickerOpen((open) => !open)}
        >
          <span className="network-station-tab-group__label">
            <CalendarBlank size={16} weight="bold" aria-hidden />
            Choose date
          </span>
        </BUTTabButton>
        <BUTTabButton
          type="button"
          width="hug"
          pressed={selectedDay === 'all' && !pickerOpen}
          ariaSelected={selectedDay === 'all' && !pickerOpen}
          onClick={() => {
            setPickerOpen(false)
            onSelect('all')
          }}
        >
          All
        </BUTTabButton>
        {tabDays.map((day) => {
          const selected = !pickerOpen && selectedDay === day
          return (
            <BUTTabButton
              key={day}
              type="button"
              width="hug"
              pressed={selected}
              ariaSelected={selected}
              onClick={() => {
                setPickerOpen(false)
                onSelect(day)
              }}
            >
              {formatTabDate(day, yearsDiffer)}
            </BUTTabButton>
          )
        })}
      </div>
      {pickerOpen && (
        <div className="unit-day-picker" role="dialog" aria-label="Choose a day with unit data">
          <div className="unit-day-picker__nav">
            <BUTCircleButton
              ariaLabel="Previous month"
              instantAction
              colorVariant="primary"
              disabled={!canPrev}
              onClick={() => {
                if (!canPrev) return
                setVisibleMonth(monthKeys[monthIndex - 1])
              }}
              icon={<CaretLeft size={16} weight="bold" aria-hidden />}
            />
            <p className="unit-day-picker__month">{monthLabel}</p>
            <BUTCircleButton
              ariaLabel="Next month"
              instantAction
              colorVariant="primary"
              disabled={!canNext}
              onClick={() => {
                if (!canNext) return
                setVisibleMonth(monthKeys[monthIndex + 1])
              }}
              icon={<CaretRight size={16} weight="bold" aria-hidden />}
            />
          </div>
          <div className="unit-day-picker__weekdays" aria-hidden>
            {WEEKDAY_LABELS.map((label) => (
              <span key={label}>{label}</span>
            ))}
          </div>
          <div className="unit-day-picker__grid">
            {cells.map((cell) => (
              <button
                key={cell.iso}
                type="button"
                className={[
                  'unit-day-picker__day',
                  cell.inMonth ? '' : 'is-outside',
                  cell.enabled ? '' : 'is-disabled',
                  selectedDay === cell.iso ? 'is-selected' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                disabled={!cell.enabled}
                aria-pressed={selectedDay === cell.iso}
                onClick={() => {
                  onSelect(cell.iso)
                  setPickerOpen(false)
                }}
              >
                {cell.label}
              </button>
            ))}
          </div>
          {availableDays.length === 0 && (
            <p className="unit-day-picker__empty">No days in this collection yet.</p>
          )}
        </div>
      )}
    </section>
  )
}

export default UnitDayFilter
