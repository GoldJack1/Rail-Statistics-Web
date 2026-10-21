'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { NavigationArrow } from '@phosphor-icons/react'
import L from 'leaflet'
import { BUTCircleButton } from '../buttons'
import './MapUserLocation.css'

type Fix = { lat: number; lng: number; accuracy: number }

type GeoError = GeolocationPositionError

/** Fresh fix. maximumAge 0 is what makes Safari show the system prompt on Ask. */
const PROMPT: PositionOptions = {
  enableHighAccuracy: true,
  maximumAge: 0,
  timeout: 60000,
}

const COARSE: PositionOptions = {
  enableHighAccuracy: false,
  maximumAge: 60000,
  timeout: 20000,
}

/** Desktop Safari uses WebKit. Chrome on this Mac does not. */
function isSafari() {
  const ua = navigator.userAgent
  return /Safari/i.test(ua) && !/Chrome|Chromium|CriOS|Edg|OPR|FxiOS/i.test(ua)
}

function showFix(map: L.Map, fix: Fix, layers: { dot: L.CircleMarker | null; ring: L.Circle | null }) {
  const latlng: L.LatLngExpression = [fix.lat, fix.lng]
  const radius = Number.isFinite(fix.accuracy) && fix.accuracy > 0 ? fix.accuracy : 1
  if (!layers.dot || !layers.ring) {
    layers.ring = L.circle(latlng, {
      radius,
      pane: 'overlayPane',
      color: '#2563eb',
      weight: 1,
      fillColor: '#2563eb',
      fillOpacity: 0.12,
      interactive: false,
    }).addTo(map)
    layers.dot = L.circleMarker(latlng, {
      pane: 'markerPane',
      radius: 8,
      color: '#ffffff',
      weight: 3,
      fillColor: '#2563eb',
      fillOpacity: 1,
      interactive: true,
    }).addTo(map)
    layers.dot.bindTooltip('Your location', { direction: 'top', opacity: 0.95 })
    return
  }
  layers.dot.setLatLng(latlng)
  layers.ring.setLatLng(latlng)
  layers.ring.setRadius(radius)
}

function reveal(map: L.Map, fix: Fix) {
  map.setView([fix.lat, fix.lng], Math.max(map.getZoom(), 15), { animate: true })
}

function failureMessage(error: GeoError) {
  if (error.code === error.PERMISSION_DENIED) {
    return 'Still blocked. Turn on Location Services for Safari in System Settings, reload, then tap again.'
  }
  return 'Couldn’t find your location. Tap again to retry.'
}

/** Blue dot for this browser's location. The map moves only when the button is used. */
export function MapUserLocation({ map }: { map: L.Map | null }) {
  const [watching, setWatching] = useState(false)
  const [denied, setDenied] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const fixRef = useRef<Fix | null>(null)
  const panNextRef = useRef(false)
  const watchRef = useRef<number | null>(null)
  const pendingRef = useRef(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const askRef = useRef<() => void>(() => {})

  useEffect(() => {
    if (!map || !navigator.geolocation) return
    const root = rootRef.current
    if (!root) return
    L.DomEvent.disableClickPropagation(root)
    L.DomEvent.disableScrollPropagation(root)
    const layers: { dot: L.CircleMarker | null; ring: L.Circle | null } = { dot: null, ring: null }
    let cancelled = false

    const onFix = (position: GeolocationPosition) => {
      if (cancelled) return
      const fix = {
        lat: position.coords.latitude,
        lng: position.coords.longitude,
        accuracy: position.coords.accuracy,
      }
      fixRef.current = fix
      showFix(map, fix, layers)
      setWatching(true)
      setDenied(false)
      setNote(null)
      if (panNextRef.current) {
        panNextRef.current = false
        reveal(map, fix)
      }
    }

    const onError = (error: GeoError) => {
      if (cancelled) return
      pendingRef.current = false
      panNextRef.current = false
      const blocked = error.code === error.PERMISSION_DENIED
      setDenied(blocked)
      setNote(failureMessage(error))
      if (!fixRef.current) setWatching(false)
    }

    const watch = (options: PositionOptions, fallback: PositionOptions | null) => {
      if (watchRef.current != null) navigator.geolocation.clearWatch(watchRef.current)
      watchRef.current = navigator.geolocation.watchPosition(
        onFix,
        (error) => {
          if (cancelled || !fallback || error.code === error.PERMISSION_DENIED) return
          watch(fallback, null)
        },
        options,
      )
    }

    const request = (options: PositionOptions, allowCoarseRetry: boolean) => {
      pendingRef.current = true
      // Ask Safari before any React update. A setState above this call drops the tap, so no prompt appears.
      navigator.geolocation.getCurrentPosition(
        (position) => {
          if (cancelled) return
          pendingRef.current = false
          onFix(position)
          watch(
            { ...options, maximumAge: 5000, timeout: 20000 },
            options.enableHighAccuracy ? { ...COARSE, maximumAge: 5000 } : null,
          )
        },
        (error) => {
          if (cancelled) return
          if (allowCoarseRetry && error.code !== error.PERMISSION_DENIED) {
            request(COARSE, false)
            return
          }
          onError(error)
        },
        options,
      )
      setDenied(false)
      setNote(null)
      setWatching(true)
    }

    const onAsk = () => {
      if (!window.isSecureContext) {
        setDenied(true)
        setWatching(false)
        setNote('This page isn’t secure, so the browser won’t share your location.')
        return
      }
      if (!navigator.geolocation) {
        setDenied(true)
        setWatching(false)
        setNote('This browser can’t share your location.')
        return
      }
      panNextRef.current = true
      const fix = fixRef.current
      if (fix) reveal(map, fix)
      if (pendingRef.current || watchRef.current != null) return
      request(PROMPT, true)
    }
    askRef.current = onAsk
    // Native listener: Safari ignores a prompt started from React’s delegated click.
    const onButtonClick = (event: Event) => {
      const target = event.target
      if (!(target instanceof Element) || !target.closest('button')) return
      onAsk()
    }
    root.addEventListener('click', onButtonClick, true)

    // Chrome can report an existing grant. Safari’s permissions query can swallow the later prompt.
    const permissions = navigator.permissions
    if (!isSafari() && permissions?.query) {
      permissions
        .query({ name: 'geolocation' })
        .then((status) => {
          if (!cancelled && status.state === 'granted' && watchRef.current == null && !pendingRef.current) {
            request(COARSE, false)
          }
        })
        .catch(() => {
          /* The button still asks. */
        })
    }

    return () => {
      cancelled = true
      askRef.current = () => {}
      root.removeEventListener('click', onButtonClick, true)
      pendingRef.current = false
      if (watchRef.current != null) {
        navigator.geolocation.clearWatch(watchRef.current)
        watchRef.current = null
      }
      layers.dot?.remove()
      layers.ring?.remove()
      setWatching(false)
    }
  }, [map])

  if (!map) return null

  const label = denied ? 'Location is blocked' : watching ? 'Centre on your location' : 'Show my location'

  return createPortal(
    <div ref={rootRef} className="map-user-location">
      {note ? <p className="map-user-location__note">{note}</p> : null}
      <BUTCircleButton
        type="button"
        ariaLabel={label}
        title={note ?? label}
        pressed={watching && !denied}
        instantAction
        icon={<NavigationArrow size={16} weight={watching ? 'fill' : 'bold'} aria-hidden />}
      />
    </div>,
    map.getContainer(),
  )
}
