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

const AD_UNIT_HEIGHT_PX = 72
const SECTION_MAX_WIDTH_MQ = '(max-width: 1023px)'

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
    adsbygoogle?: unknown[]
  }
}

function isElementVisible(el: HTMLElement): boolean {
  if (el.offsetWidth <= 0) return false
  const style = window.getComputedStyle(el)
  if (style.display === 'none' || style.visibility === 'hidden') return false
  return true
}

function lockAdHeight(el: HTMLElement) {
  el.style.setProperty('height', `${AD_UNIT_HEIGHT_PX}px`, 'important')
  el.style.setProperty('max-height', `${AD_UNIT_HEIGHT_PX}px`, 'important')
  el.style.setProperty('min-height', '0px', 'important')
  el.querySelectorAll('iframe').forEach((iframe) => {
    iframe.style.setProperty('height', `${AD_UNIT_HEIGHT_PX}px`, 'important')
    iframe.style.setProperty('max-height', `${AD_UNIT_HEIGHT_PX}px`, 'important')
  })
}

function AdSenseUnit({ variant }: { variant: AdSlotVariant }) {
  const insRef = useRef<HTMLModElement>(null)
  const pushedRef = useRef(false)

  useEffect(() => {
    const el = insRef.current
    if (!el) return

    const tryPush = () => {
      if (pushedRef.current) return true
      if (!isElementVisible(el)) return false
      if (el.getAttribute('data-adsbygoogle-status')) {
        pushedRef.current = true
        lockAdHeight(el)
        return true
      }

      pushedRef.current = true
      try {
        ;(window.adsbygoogle = window.adsbygoogle || []).push({})
      } catch {
        // AdSense may throw if blocked, not ready, or still zero-width.
        pushedRef.current = false
        return false
      }
      lockAdHeight(el)
      return true
    }

    // Wait until the slot has a measurable width (avoids availableWidth=0).
    if (!tryPush()) {
      const resizeObserver = new ResizeObserver(() => {
        if (tryPush()) resizeObserver.disconnect()
      })
      resizeObserver.observe(el)
      const frame = el.parentElement
      if (frame) resizeObserver.observe(frame)

      const mutationObserver = new MutationObserver(() => lockAdHeight(el))
      mutationObserver.observe(el, {
        attributes: true,
        attributeFilter: ['style', 'data-adsbygoogle-status'],
        childList: true,
        subtree: true,
      })

      return () => {
        resizeObserver.disconnect()
        mutationObserver.disconnect()
      }
    }

    const mutationObserver = new MutationObserver(() => lockAdHeight(el))
    mutationObserver.observe(el, {
      attributes: true,
      attributeFilter: ['style', 'data-adsbygoogle-status'],
      childList: true,
      subtree: true,
    })
    return () => mutationObserver.disconnect()
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
      style={{ display: 'block', width: '100%' }}
      data-ad-client={ADSENSE_CLIENT}
      data-ad-slot={slot}
      data-ad-format="auto"
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
