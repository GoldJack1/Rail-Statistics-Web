'use client'

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { CaretLeft, CaretRight } from '@phosphor-icons/react'

import { BUTBaseButton, BUTTextNumberCircleButton, BUTWideButton } from '@/components/buttons'

import './BoardDateTimePickers.css'

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'] as const
const WHEEL_ITEM = 44
const WHEEL_VIEW = 220

type PickerMode = 'day' | 'month' | 'year'
type SlideDirection = 'forward' | 'back'

type DateSnapshot = {
  mode: PickerMode
  cursor: { year: number; month: number }
  yearCursor: number
}

const SLIDE_MS = 350

function parseIso(iso: string): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!match) return null
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) }
}

function toIso(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

/** Monday = 0. */
function leadingBlankDays(year: number, month: number): number {
  const weekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay()
  return (weekday + 6) % 7
}

function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const index = year * 12 + (month - 1) + delta
  const normalized = ((index % 12) + 12) % 12
  return { year: Math.floor(index / 12), month: normalized + 1 }
}

function decadeStart(year: number): number {
  return year - (year % 10)
}

function snapshotKey(snapshot: DateSnapshot): string {
  return `${snapshot.mode}-${snapshot.cursor.year}-${snapshot.cursor.month}-${snapshot.yearCursor}`
}

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export function BoardDatePicker({
  value,
  isDateEnabled,
  onChange,
}: {
  value: string
  min: string
  max: string
  isDateEnabled: (iso: string) => boolean
  onChange: (iso: string) => void
}) {
  const initial = parseIso(value)
  const [snap, setSnap] = useState<DateSnapshot>(() => ({
    mode: 'day',
    cursor: { year: initial?.year ?? 2026, month: initial?.month ?? 1 },
    yearCursor: initial?.year ?? 2026,
  }))
  const [motion, setMotion] = useState<{ from: DateSnapshot; dir: SlideDirection } | null>(null)
  const snapRef = useRef(snap)
  const timerRef = useRef<number | null>(null)
  snapRef.current = snap

  useEffect(() => () => {
    if (timerRef.current) window.clearTimeout(timerRef.current)
  }, [])

  const { mode, cursor, yearCursor } = snap

  const commit = (patch: Partial<DateSnapshot>, dir: SlideDirection) => {
    const current = snapRef.current
    const next: DateSnapshot = {
      mode: patch.mode ?? current.mode,
      cursor: patch.cursor ?? current.cursor,
      yearCursor: patch.yearCursor ?? current.yearCursor,
    }
    if (snapshotKey(next) === snapshotKey(current)) return
    snapRef.current = next
    setSnap(next)
    if (prefersReducedMotion()) return
    if (timerRef.current) window.clearTimeout(timerRef.current)
    setMotion({ from: current, dir })
    timerRef.current = window.setTimeout(() => setMotion(null), SLIDE_MS)
  }

  const headerLabel = mode === 'year'
    ? `${decadeStart(yearCursor)}s`
    : mode === 'month'
      ? String(yearCursor)
      : `${MONTHS[cursor.month - 1]} ${cursor.year}`

  const goPrevious = () => {
    if (mode === 'year') commit({ yearCursor: yearCursor - 10 }, 'back')
    else if (mode === 'month') commit({ yearCursor: yearCursor - 1 }, 'back')
    else commit({ cursor: shiftMonth(cursor.year, cursor.month, -1) }, 'back')
  }

  const goNext = () => {
    if (mode === 'year') commit({ yearCursor: yearCursor + 10 }, 'forward')
    else if (mode === 'month') commit({ yearCursor: yearCursor + 1 }, 'forward')
    else commit({ cursor: shiftMonth(cursor.year, cursor.month, 1) }, 'forward')
  }

  const openCenter = () => {
    if (mode === 'day') commit({ mode: 'month', yearCursor: cursor.year }, 'forward')
    else if (mode === 'month') commit({ mode: 'year' }, 'forward')
  }

  const pagingDays = mode === 'day' && (!motion || motion.from.mode === 'day')

  return (
    <div className="dep-date-picker">
      <div className="dep-date-picker__bar">
        <BUTBaseButton
          type="button"
          variant="wide"
          shape="left-rounded"
          width="hug"
          colorVariant="primary"
          className="dep-date-picker__nav-side"
          ariaLabel="Previous"
          icon={<CaretLeft size={16} weight="bold" aria-hidden />}
          onClick={goPrevious}
        />
        <BUTBaseButton
          type="button"
          variant="wide"
          shape="squared"
          width="fill"
          colorVariant="primary"
          className="dep-date-picker__nav-center"
          ariaLabel={headerLabel}
          onClick={openCenter}
        >
          {headerLabel}
        </BUTBaseButton>
        <BUTBaseButton
          type="button"
          variant="wide"
          shape="right-rounded"
          width="hug"
          colorVariant="primary"
          className="dep-date-picker__nav-side"
          ariaLabel="Next"
          icon={<CaretRight size={16} weight="bold" aria-hidden />}
          onClick={goNext}
        />
      </div>

      {pagingDays ? <WeekdayRow /> : null}

      <div className="dep-date-stage">
        {motion ? (
          <div className={`dep-date-stage__layer is-leaving is-${motion.dir}`} aria-hidden="true">
            <DatePickerLayer
              snapshot={motion.from}
              includeWeekdays={motion.from.mode !== snap.mode}
              value={value}
              isDateEnabled={isDateEnabled}
              onCommit={commit}
              onChange={onChange}
            />
          </div>
        ) : null}
        <div
          key={snapshotKey(snap)}
          className={motion ? `dep-date-stage__layer is-entering is-${motion.dir}` : 'dep-date-stage__layer'}
        >
          <DatePickerLayer
            snapshot={snap}
            includeWeekdays={snap.mode === 'day' && !pagingDays}
            value={value}
            isDateEnabled={isDateEnabled}
            onCommit={commit}
            onChange={onChange}
          />
        </div>
      </div>
    </div>
  )
}

function WeekdayRow() {
  return (
    <div className="dep-date-picker__weekdays" aria-hidden="true">
      {WEEKDAYS.map((label) => (
        <span key={label}>{label}</span>
      ))}
    </div>
  )
}

function DatePickerLayer({
  snapshot,
  includeWeekdays,
  value,
  isDateEnabled,
  onCommit,
  onChange,
}: {
  snapshot: DateSnapshot
  includeWeekdays: boolean
  value: string
  isDateEnabled: (iso: string) => boolean
  onCommit: (patch: Partial<DateSnapshot>, dir: SlideDirection) => void
  onChange: (iso: string) => void
}) {
  if (snapshot.mode === 'month') {
    return (
      <div className="dep-date-picker__choice-grid" role="listbox" aria-label="Choose a month">
        {MONTHS.map((name, index) => {
          const month = index + 1
          const selected = snapshot.cursor.year === snapshot.yearCursor && snapshot.cursor.month === month
          return (
            <BUTWideButton
              key={name}
              type="button"
              width="fill"
              instantAction
              colorVariant="primary"
              pressed={selected}
              ariaLabel={name}
              onClick={() => onCommit({ mode: 'day', cursor: { year: snapshot.yearCursor, month } }, 'back')}
            >
              {name}
            </BUTWideButton>
          )
        })}
      </div>
    )
  }

  if (snapshot.mode === 'year') {
    return (
      <div className="dep-date-picker__choice-grid" role="listbox" aria-label="Choose a year">
        {Array.from({ length: 10 }, (_, index) => decadeStart(snapshot.yearCursor) + index).map((year) => (
          <BUTWideButton
            key={year}
            type="button"
            width="fill"
            instantAction
            colorVariant="primary"
            pressed={snapshot.cursor.year === year}
            ariaLabel={String(year)}
            onClick={() => onCommit({ mode: 'month', yearCursor: year }, 'back')}
          >
            {year}
          </BUTWideButton>
        ))}
      </div>
    )
  }

  const count = daysInMonth(snapshot.cursor.year, snapshot.cursor.month)
  const blanks = leadingBlankDays(snapshot.cursor.year, snapshot.cursor.month)
  const cells: Array<{ iso: string; day: number; inMonth: boolean }> = []
  const prev = shiftMonth(snapshot.cursor.year, snapshot.cursor.month, -1)
  const prevCount = daysInMonth(prev.year, prev.month)
  for (let index = 0; index < blanks; index += 1) {
    const day = prevCount - blanks + index + 1
    cells.push({ iso: toIso(prev.year, prev.month, day), day, inMonth: false })
  }
  for (let day = 1; day <= count; day += 1) {
    cells.push({ iso: toIso(snapshot.cursor.year, snapshot.cursor.month, day), day, inMonth: true })
  }
  const next = shiftMonth(snapshot.cursor.year, snapshot.cursor.month, 1)
  let nextDay = 1
  while (cells.length < 42) {
    cells.push({ iso: toIso(next.year, next.month, nextDay), day: nextDay, inMonth: false })
    nextDay += 1
  }

  return (
    <div className="dep-date-picker__days">
      {includeWeekdays ? <WeekdayRow /> : null}
      <div className="dep-date-picker__grid" role="grid" aria-label="Choose a date">
        {cells.map((cell) => {
          const enabled = cell.inMonth && isDateEnabled(cell.iso)
          return (
            <BUTTextNumberCircleButton
              key={cell.iso}
              type="button"
              instantAction
              colorVariant="primary"
              text={String(cell.day)}
              ariaLabel={cell.iso}
              pressed={cell.iso === value}
              disabled={!enabled}
              onClick={() => onChange(cell.iso)}
            />
          )
        })}
      </div>
    </div>
  )
}

function readWheelIndex(element: HTMLDivElement, count: number): number {
  const index = Math.round(element.scrollTop / WHEEL_ITEM)
  return Math.max(0, Math.min(count - 1, index))
}

export function BoardTimePicker({
  value,
  onChange,
}: {
  value: string
  onChange: (hhmm: string) => void
}) {
  return (
    <>
      <div className="dep-time-picker dep-time-picker--wheel">
        <TimeWheel value={value} onChange={onChange} />
      </div>
      <div className="dep-time-picker dep-time-picker--sunflower">
        <SunflowerTimePicker value={value} onChange={onChange} />
      </div>
    </>
  )
}

function SunflowerTimePicker({
  value,
  onChange,
}: {
  value: string
  onChange: (hhmm: string) => void
}) {
  const match = /^(\d{2}):(\d{2})$/.exec(value)
  const hour = match?.[1] ?? '00'
  const minute = match?.[2] ?? '00'
  const valueRef = useRef(value)
  valueRef.current = value
  const minuteInputRef = useRef<HTMLInputElement>(null)
  const hourReplaceRef = useRef(false)
  const minuteReplaceRef = useRef(false)
  const [part, setPart] = useState<'hour' | 'minute'>('hour')
  const [hourDraft, setHourDraft] = useState<string | null>(null)
  const [minuteDraft, setMinuteDraft] = useState<string | null>(null)
  const steps = part === 'hour' ? 24 : 12
  const handSteps = part === 'hour' ? 24 : 60
  const handIndex = part === 'hour' ? Number(hour) : Number(minute)

  const publish = (nextHour: string, nextMinute: string) => {
    const next = `${nextHour}:${nextMinute}`
    if (next !== valueRef.current) onChange(next)
  }

  const commitHour = (raw: string) => {
    const parsed = Number(raw)
    setHourDraft(null)
    if (!raw || !Number.isInteger(parsed) || parsed < 0 || parsed > 23) return
    publish(String(parsed).padStart(2, '0'), minute)
  }

  const commitMinute = (raw: string) => {
    const parsed = Number(raw)
    setMinuteDraft(null)
    if (!raw || !Number.isInteger(parsed) || parsed < 0 || parsed > 59) return
    publish(hour, String(parsed).padStart(2, '0'))
  }

  const indexFromPointer = (event: ReactPointerEvent<HTMLDivElement>, count: number) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const x = event.clientX - (rect.left + rect.width / 2)
    const y = event.clientY - (rect.top + rect.height / 2)
    let degrees = Math.atan2(x, -y) * (180 / Math.PI)
    if (degrees < 0) degrees += 360
    return Math.round(degrees / (360 / count)) % count
  }

  const scrub = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (part === 'hour') {
      const next = indexFromPointer(event, 24)
      if (next == null) return
      publish(String(next).padStart(2, '0'), minute)
      return
    }
    const next = indexFromPointer(event, 60)
    if (next == null) return
    publish(hour, String(next).padStart(2, '0'))
  }

  return (
    <div className="dep-sun">
    <div
      className="dep-sun-clock"
      style={{ ['--hand-angle' as string]: `${(handIndex / handSteps) * 360 - 90}deg` }}
      onPointerDown={(event) => {
        if ((event.target as HTMLElement).closest('button')) return
        event.currentTarget.setPointerCapture(event.pointerId)
        scrub(event)
      }}
      onPointerMove={(event) => {
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
        scrub(event)
      }}
      onPointerUp={(event) => {
        if (part === 'hour' && event.currentTarget.hasPointerCapture(event.pointerId)) setPart('minute')
      }}
    >
      <div className="dep-sun-clock__face" aria-hidden="true" />
      <div className="dep-sun-clock__hand" aria-hidden="true" />
      {Array.from({ length: steps }, (_, index) => {
        const label = part === 'hour'
          ? String(index).padStart(2, '0')
          : String(index * 5).padStart(2, '0')
        const angle = (index / steps) * Math.PI * 2 - Math.PI / 2
        const selected = part === 'hour' ? label === hour : label === minute
        return (
          <BUTTextNumberCircleButton
            key={`${part}-${label}`}
            type="button"
            instantAction
            colorVariant="primary"
            text={label}
            ariaLabel={part === 'hour' ? `${label} hours` : `${label} minutes`}
            pressed={selected}
            className="dep-sun-clock__petal"
            style={{
              left: `calc(50% + ${Math.cos(angle) * 160}px)`,
              top: `calc(50% + ${Math.sin(angle) * 160}px)`,
            }}
            onClick={() => {
              if (part === 'hour') {
                publish(label, minute)
                setPart('minute')
                return
              }
              publish(hour, label)
            }}
          />
        )
      })}
    </div>
    <div className="dep-sun-readout">
      <div className="dep-sun-readout__time">
      <input
        className={`dep-sun-readout__hour${part === 'hour' ? ' is-active' : ''}`}
        inputMode="numeric"
        autoComplete="off"
        aria-label={`${hour} hours`}
        value={hourDraft ?? hour}
        onFocus={(event) => {
          setPart('hour')
          hourReplaceRef.current = true
          const input = event.currentTarget
          requestAnimationFrame(() => input.select())
        }}
        onMouseUp={(event) => event.currentTarget.select()}
        onChange={(event) => {
          let digits = event.target.value.replace(/\D/g, '')
          if (hourReplaceRef.current) {
            hourReplaceRef.current = false
            const previous = (hourDraft ?? hour).replace(/\D/g, '')
            if (previous && digits.includes(previous) && digits !== previous) digits = digits.replace(previous, '')
          }
          digits = digits.slice(0, 2)
          setHourDraft(digits)
          const parsed = Number(digits)
          const complete = digits.length === 2 || (digits.length === 1 && parsed >= 3)
          if (!complete || parsed > 23) return
          publish(String(parsed).padStart(2, '0'), minute)
          setHourDraft(null)
          setPart('minute')
          minuteInputRef.current?.focus()
        }}
        onBlur={(event) => commitHour(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') minuteInputRef.current?.focus()
        }}
      />
      <span className="dep-sun-readout__colon" aria-hidden="true">:</span>
      <input
        ref={minuteInputRef}
        className={`dep-sun-readout__minute${part === 'minute' ? ' is-active' : ''}`}
        inputMode="numeric"
        autoComplete="off"
        aria-label={`${minute} minutes`}
        value={minuteDraft ?? minute}
        onFocus={(event) => {
          setPart('minute')
          minuteReplaceRef.current = true
          const input = event.currentTarget
          requestAnimationFrame(() => input.select())
        }}
        onMouseUp={(event) => event.currentTarget.select()}
        onChange={(event) => {
          let digits = event.target.value.replace(/\D/g, '')
          if (minuteReplaceRef.current) {
            minuteReplaceRef.current = false
            const previous = (minuteDraft ?? minute).replace(/\D/g, '')
            if (previous && digits.includes(previous) && digits !== previous) digits = digits.replace(previous, '')
          }
          digits = digits.slice(0, 2)
          setMinuteDraft(digits)
          if (digits.length < 2) return
          const parsed = Number(digits)
          if (parsed > 59) return
          publish(hour, String(parsed).padStart(2, '0'))
          setMinuteDraft(null)
        }}
        onBlur={(event) => commitMinute(event.currentTarget.value)}
      />
      </div>
    </div>
    </div>
  )
}

function TimeWheel({
  value,
  onChange,
}: {
  value: string
  onChange: (hhmm: string) => void
}) {
  const match = /^(\d{2}):(\d{2})$/.exec(value)
  const hour = match?.[1] ?? '00'
  const minute = match?.[2] ?? '00'
  const hourRef = useRef<HTMLDivElement>(null)
  const minuteRef = useRef<HTMLDivElement>(null)
  const valueRef = useRef(value)
  const readyRef = useRef(false)
  const initialHour = useRef(hour)
  const initialMinute = useRef(minute)
  valueRef.current = value

  useEffect(() => {
    if (hourRef.current) hourRef.current.scrollTop = Number(initialHour.current) * WHEEL_ITEM
    if (minuteRef.current) minuteRef.current.scrollTop = Number(initialMinute.current) * WHEEL_ITEM
    readyRef.current = true
  }, [])

  const publish = (nextHour: string, nextMinute: string) => {
    const next = `${nextHour}:${nextMinute}`
    if (next !== valueRef.current) onChange(next)
  }

  return (
    <div className="dep-time-wheel">
      <div className="dep-time-wheel__highlight" aria-hidden="true" />
      <div
        ref={hourRef}
        className="dep-time-wheel__col"
        role="listbox"
        aria-label="Hour"
        onScroll={(event) => {
          if (!readyRef.current) return
          const index = readWheelIndex(event.currentTarget, 24)
          const current = /^(\d{2}):(\d{2})$/.exec(valueRef.current)
          publish(String(index).padStart(2, '0'), current?.[2] ?? minute)
        }}
      >
        <div className="dep-time-wheel__pad" />
        {Array.from({ length: 24 }, (_, index) => {
          const label = String(index).padStart(2, '0')
          return (
            <button
              key={label}
              type="button"
              className={`dep-time-wheel__item${label === hour ? ' is-selected' : ''}`}
              aria-label={`${label} hours`}
              aria-selected={label === hour}
              onClick={() => {
                hourRef.current?.scrollTo({ top: index * WHEEL_ITEM, behavior: 'smooth' })
                publish(label, minute)
              }}
            >
              {label}
            </button>
          )
        })}
        <div className="dep-time-wheel__pad" />
      </div>
      <div
        ref={minuteRef}
        className="dep-time-wheel__col"
        role="listbox"
        aria-label="Minute"
        onScroll={(event) => {
          if (!readyRef.current) return
          const index = readWheelIndex(event.currentTarget, 60)
          const current = /^(\d{2}):(\d{2})$/.exec(valueRef.current)
          publish(current?.[1] ?? hour, String(index).padStart(2, '0'))
        }}
      >
        <div className="dep-time-wheel__pad" />
        {Array.from({ length: 60 }, (_, index) => {
          const label = String(index).padStart(2, '0')
          return (
            <button
              key={label}
              type="button"
              className={`dep-time-wheel__item${label === minute ? ' is-selected' : ''}`}
              aria-label={`${label} minutes`}
              aria-selected={label === minute}
              onClick={() => {
                minuteRef.current?.scrollTo({ top: index * WHEEL_ITEM, behavior: 'smooth' })
                publish(hour, label)
              }}
            >
              {label}
            </button>
          )
        })}
        <div className="dep-time-wheel__pad" />
      </div>
    </div>
  )
}
