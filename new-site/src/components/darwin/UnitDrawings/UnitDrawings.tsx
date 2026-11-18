'use client'

import React, { useEffect, useRef, useState } from 'react'
import { resolveDarwinBrowserUrl } from '@/utils/darwinReadyFetch'
import type { TrainDrawing } from '@/types/darwin'
import './UnitDrawings.css'

export function drawingImageUrl(d: TrainDrawing): string {
  const url = resolveDarwinBrowserUrl(`/api/darwin/drawings/${d.id}.svg`)
  return d.v ? `${url}?v=${encodeURIComponent(d.v)}` : url
}

/**
 * Whole-unit drawings from the API, scaled to `height` px (the height of the coach pills they replace).
 * Long units scroll sideways (swipe, trackpad or mouse drag) with an edge fade on the side that has more.
 */
export const UnitDrawings: React.FC<{
  drawings?: TrainDrawing[] | null
  height: number
  className?: string
}> = ({ drawings, height, className }) => {
  const ref = useRef<HTMLDivElement>(null)
  const drag = useRef<{ x: number; left: number; moved: boolean } | null>(null)
  const [more, setMore] = useState(false) // content hidden to the right
  const [less, setLess] = useState(false) // already scrolled: content hidden to the left
  const [scrollable, setScrollable] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => {
      const over = el.scrollWidth - el.clientWidth
      setScrollable(over > 2)
      setMore(over - el.scrollLeft > 4)
      setLess(over > 2 && el.scrollLeft > 4)
    }
    update()
    el.addEventListener('scroll', update, { passive: true })
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null
    ro?.observe(el)
    el.querySelectorAll('img').forEach((img) => img.addEventListener('load', update))
    return () => {
      el.removeEventListener('scroll', update)
      ro?.disconnect()
    }
  }, [drawings])

  if (!drawings || drawings.length === 0) return null

  const onPointerDown = (e: React.PointerEvent) => {
    const el = ref.current
    if (!el || e.pointerType !== 'mouse' || e.button !== 0 || el.scrollWidth <= el.clientWidth + 2) return
    drag.current = { x: e.clientX, left: el.scrollLeft, moved: false }
  }
  const onPointerMove = (e: React.PointerEvent) => {
    const el = ref.current
    const d = drag.current
    if (!el || !d) return
    const dx = e.clientX - d.x
    if (!d.moved && Math.abs(dx) > 4) d.moved = true
    if (d.moved) el.scrollLeft = d.left - dx
  }
  const endDrag = () => {
    // Leave `moved` set until the click that follows the drag has been swallowed.
    setTimeout(() => {
      drag.current = null
    }, 0)
  }
  // A drag must not "click" the card underneath.
  const onClickCapture = (e: React.MouseEvent) => {
    if (drag.current?.moved) {
      e.stopPropagation()
      e.preventDefault()
    }
  }

  return (
    <div
      ref={ref}
      className={[
        'unit-drawings',
        scrollable ? 'unit-drawings--scrollable' : '',
        more ? 'unit-drawings--more' : '',
        less ? 'unit-drawings--less' : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      style={{ height: height + 2 }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerLeave={endDrag}
      onClickCapture={onClickCapture}
    >
      {drawings.map((d) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={d.id}
          className="unit-drawings__img"
          src={drawingImageUrl(d)}
          alt=""
          draggable={false}
          loading="lazy"
          decoding="async"
          style={{ height, width: (d.width / d.height) * height }}
        />
      ))}
    </div>
  )
}
