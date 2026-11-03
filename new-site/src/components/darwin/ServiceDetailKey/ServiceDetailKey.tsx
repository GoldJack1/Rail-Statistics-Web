'use client'

import { useState } from 'react'
import { Info } from '@phosphor-icons/react'

import { BUTWideButton } from '@/components/buttons'
import { SidePane } from '@/components/darwin/SidePane/SidePane'

import './ServiceDetailKey.css'

const CALLING_COLOUR_KEY: { tone: string; label: string; detail: string }[] = [
  { tone: 'early', label: 'Early', detail: 'If a train is running a minute or more before the booked time.' },
  { tone: 'ontime', label: 'On time', detail: 'The train is running on time as per the timetable.' },
  { tone: 'delay-1', label: '1–15 min late', detail: 'The train is running between 1 to 15 minutes late.' },
  { tone: 'delay-16', label: '16–29 min late', detail: 'The train is running between 16 to 29 minutes late.' },
  { tone: 'delay-30', label: '30–59 min late', detail: 'The train is running between 30 to 59 minutes late.' },
  { tone: 'delay-60', label: '60+ min late', detail: 'The train is running 60 minutes or more late.' },
  { tone: 'cancelled', label: 'Cancelled', detail: 'The train has been cancelled and will not stop/pass this point.' },
]

const MAP_MARKERS: { kind: string; label: string; detail: string }[] = [
  { kind: 'stop', label: 'Stopping', detail: 'This indicates that the train is booked to stop at this station.' },
  { kind: 'pass', label: 'Passing station', detail: 'This indicates that the train is booked to pass through this station and not stop.' },
  { kind: 'junction', label: 'Passing junction', detail: 'This indicates where a junction is that the train is booked on the timetable to pass through.' },
  { kind: 'live', label: "Train's current location", detail: 'This indicates where the train is currently at. (Please note this is not a true reflection of the train location, but rather an estimated position based on the timings.)' },
  { kind: 'you', label: 'Your location', detail: "If you have enabled the live location, you'll see where you are currently on the map." },
  { kind: 'route', label: 'Route', detail: "This is where the train will be traveling, shown in the train operator's colour. (Please note the exact routing may not be correct.)" },
]

export function ServiceDetailKey({ disabled = false }: { disabled?: boolean }) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <BUTWideButton
        type="button"
        width="hug"
        instantAction
        disabled={disabled}
        icon={<Info size={16} weight="bold" aria-hidden />}
        ariaLabel="Key"
        pressed={open}
        onClick={() => setOpen(true)}
      >
        Key
      </BUTWideButton>
      <SidePane open={open} title="Key" onClose={() => setOpen(false)}>
        <section className="svc-key-section" aria-labelledby="svc-key-calling">
          <h3 className="svc-key-section__title" id="svc-key-calling">
            Calling pattern
          </h3>
          <p className="svc-key-section__intro">
            Each row takes its colour from how late that call is. The colour follows the departure, and the destination follows the arrival.
          </p>
          <ul className="svc-stops-key svc-stops-key--pane">
            {CALLING_COLOUR_KEY.map((item) => (
              <li key={item.tone} className="svc-key-entry">
                <span className={`svc-stops-key__item svc-stops-key__item--${item.tone}`}>
                  {item.label}
                </span>
                <p className="svc-key-entry__detail">{item.detail}</p>
              </li>
            ))}
          </ul>
        </section>
        <section className="svc-key-section" aria-labelledby="svc-key-map">
          <h3 className="svc-key-section__title" id="svc-key-map">
            Map
          </h3>
          <ul className="svc-key-markers">
            {MAP_MARKERS.map((item) => (
              <li key={item.kind} className="svc-key-marker-row">
                <span className={`svc-key-marker svc-key-marker--${item.kind}`} aria-hidden />
                <span className="svc-key-marker-row__text">
                  <span className="svc-key-marker-row__label">{item.label}</span>
                  <span className="svc-key-entry__detail">{item.detail}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      </SidePane>
    </>
  )
}
