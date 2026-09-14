'use client'

import React, { useEffect, useState, useRef } from 'react'
import TextCard from '@/components/cards/TextCard/TextCard'
import {
  ADSENSE_CLIENT,
  ADSENSE_IN_FEED_LAYOUT_KEY,
  ADSENSE_SLOTS,
  isAdSenseEnabled,
} from './adsenseConfig'
import './AdSlot.css'

export type AdSlotVariant = 'banner' | 'section' | 'inFeed'

/** Empty-slot floor — real creatives are 50–100px (horizontal) or taller (in-feed). */
const AD_PLACEHOLDER_MIN_HEIGHT_PX = 90
const SECTION_MAX_WIDTH_MQ = '(max-width: 1023px)'
const SCRIPT_WAIT_MS = 8000

interface AdSlotProps {
  variant: AdSlotVariant
  className?: string
  /** Optional label override; AdSense requires ads to be labelled. */
  label?: string
  /** @deprecated Kept for call-site compatibility. */
  reserveLineStripSpace?: boolean
  /** @deprecated Kept for call-site compatibility. */
  reserveOpenedOnSpace?: boolean
  /** @deprecated Kept for call-site compatibility. */
  showOpenedOnRow?: boolean
}

declare global {
  interface Window {
    /** Queue before script load; object with push() after adsbygoogle.js loads. */
    adsbygoogle?: { push: (...args: unknown[]) => number; loaded?: boolean } | unknown[]
  }
}

function isElementVisible(el: HTMLElement): boolean {
  if (el.offsetWidth <= 0) return false
  const style = window.getComputedStyle(el)
  if (style.display === 'none' || style.visibility === 'hidden') return false
  return true
}

/**
 * Ready once we can enqueue a unit. Before the script loads we create a queue
 * array; after load `adsbygoogle` is a non-array object that still has push().
 * Do not use Array.isArray alone — that fails after the script hydrates.
 */
function isAdsbygoogleReady(): boolean {
  if (typeof window === 'undefined') return false
  window.adsbygoogle = window.adsbygoogle || []
  return typeof window.adsbygoogle.push === 'function'
}

/**
 * Grow the card to the creative. Do not scale or clip — AdSense treats that as a
 * modified ad, and 72px is smaller than every standard display size.
 */
function sizeCardToCreative(el: HTMLElement) {
  const frame = el.parentElement
  if (!frame?.classList.contains('rs-ad-slot__unit-frame')) return

  el.style.removeProperty('transform')
  el.style.removeProperty('width')
  el.style.removeProperty('max-width')
  el.style.removeProperty('margin-left')

  const iframe = el.querySelector('iframe')
  const naturalHeight = Math.max(iframe?.offsetHeight ?? 0, el.offsetHeight)
  if (naturalHeight <= 0) return

  frame.style.height = `${naturalHeight}px`
}

function AdSenseUnit({ variant }: { variant: AdSlotVariant }) {
  const insRef = useRef<HTMLModElement>(null)
  const pushedRef = useRef(false)

  useEffect(() => {
    const el = insRef.current
    if (!el) return

    let cancelled = false
    let resizeObserver: ResizeObserver | null = null
    let mutationObserver: MutationObserver | null = null
    let scriptPollId = 0
    const startedAt = Date.now()

    const disconnectObservers = () => {
      resizeObserver?.disconnect()
      resizeObserver = null
      mutationObserver?.disconnect()
      mutationObserver = null
      if (scriptPollId) {
        window.clearInterval(scriptPollId)
        scriptPollId = 0
      }
    }

    const tryPush = () => {
      if (cancelled || pushedRef.current) return true
      if (!isElementVisible(el)) return false
      if (!isAdsbygoogleReady()) return false

      if (el.getAttribute('data-adsbygoogle-status')) {
        pushedRef.current = true
        sizeCardToCreative(el)
        return true
      }

      try {
        ;(window.adsbygoogle = window.adsbygoogle || []).push({})
        pushedRef.current = true
      } catch {
        // AdSense may throw if blocked, not ready, or still zero-width.
        pushedRef.current = false
        return false
      }

      requestAnimationFrame(() => {
        if (!cancelled) sizeCardToCreative(el)
      })
      return true
    }

    const armFitObserver = () => {
      if (mutationObserver) return
      mutationObserver = new MutationObserver(() => {
        if (!cancelled) sizeCardToCreative(el)
      })
      mutationObserver.observe(el, {
        attributes: true,
        attributeFilter: ['style', 'data-adsbygoogle-status'],
        childList: true,
        subtree: true,
      })
    }

    const armResizeObserver = () => {
      if (resizeObserver) return
      resizeObserver = new ResizeObserver(() => {
        if (tryPush()) {
          resizeObserver?.disconnect()
          resizeObserver = null
          armFitObserver()
        }
      })
      resizeObserver.observe(el)
      const frame = el.parentElement
      if (frame) resizeObserver.observe(frame)
    }

    if (tryPush()) {
      armFitObserver()
    } else {
      armResizeObserver()
      armFitObserver()
      // Script often loads after first paint — poll briefly instead of giving up.
      scriptPollId = window.setInterval(() => {
        if (cancelled) return
        if (tryPush()) {
          resizeObserver?.disconnect()
          resizeObserver = null
          window.clearInterval(scriptPollId)
          scriptPollId = 0
          return
        }
        if (Date.now() - startedAt > SCRIPT_WAIT_MS) {
          window.clearInterval(scriptPollId)
          scriptPollId = 0
        }
      }, 250)
    }

    return () => {
      cancelled = true
      disconnectObservers()
    }
  }, [])

  if (variant === 'inFeed') {
    return (
      <ins
        ref={insRef}
        className="adsbygoogle rs-ad-slot__ins"
        style={{ display: 'block', width: '100%', textAlign: 'center' }}
        data-ad-client={ADSENSE_CLIENT}
        data-ad-slot={ADSENSE_SLOTS.inFeed}
        data-ad-format="fluid"
        data-ad-layout-key={ADSENSE_IN_FEED_LAYOUT_KEY}
      />
    )
  }

  const slot = variant === 'banner' ? ADSENSE_SLOTS.banner : ADSENSE_SLOTS.section

  return (
    <ins
      ref={insRef}
      className="adsbygoogle rs-ad-slot__ins"
      style={{ display: 'block', width: '100%', minHeight: AD_PLACEHOLDER_MIN_HEIGHT_PX }}
      data-ad-client={ADSENSE_CLIENT}
      data-ad-slot={slot}
      data-ad-format="horizontal"
      data-full-width-responsive="true"
    />
  )
}

/**
 * AdSense unit inside a static TextCard.
 * Section units only mount on tablet/mobile so AdSense never sees width=0.
 */
const AdSlot: React.FC<AdSlotProps> = ({
  variant,
  className = '',
  label = 'Advertisement',
}) => {
  const [sectionAllowed, setSectionAllowed] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.matchMedia(SECTION_MAX_WIDTH_MQ).matches
  })

  useEffect(() => {
    if (!isAdSenseEnabled || variant !== 'section') return
    const mq = window.matchMedia(SECTION_MAX_WIDTH_MQ)
    const sync = () => setSectionAllowed(mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [variant])

  if (!isAdSenseEnabled) {
    return null
  }

  if (variant === 'section' && !sectionAllowed) {
    return null
  }

  const rootClassName = ['rs-ad-slot', `rs-ad-slot--${variant}`, className]
    .filter(Boolean)
    .join(' ')

  return (
    <aside className={rootClassName} aria-label={label} data-ad-variant={variant}>
      <TextCard
        static
        title={label}
        description={
          <div className="rs-ad-slot__unit-frame">
            <AdSenseUnit variant={variant} />
          </div>
        }
        trailingIcon={<span aria-hidden="true" />}
        className="rs-ad-slot__text-card"
        ariaLabel={label}
      />
    </aside>
  )
}

export default AdSlot
