'use client'

import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from '@phosphor-icons/react'

import { BUTCircleButton, BUTWideButton } from '@/components/buttons'
import '@/components/models/StationModal/StationModal.css'

import './SidePane.css'

const MOTION_MS = 420

export function SidePane({
  open,
  title,
  onClose,
  children,
  footer,
  elevated = false,
  closeOnEscape = true,
}: {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  /** Draws above another open pane, for a picker opened from search. */
  elevated?: boolean
  /** When a pane is stacked on top, the one underneath should ignore Escape. */
  closeOnEscape?: boolean
}) {
  const [phase, setPhase] = useState<'closed' | 'opening' | 'open' | 'closing'>('closed')
  const titleId = useId()
  const paneRef = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)
  const shown = phase !== 'closed'
  const entered = phase === 'open'

  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    if (open) {
      setPhase((current) => (current === 'open' || current === 'opening' ? current : 'opening'))
      return
    }
    setPhase((current) => (current === 'closed' || current === 'closing' ? current : 'closing'))
  }, [open])

  useEffect(() => {
    if (phase !== 'opening') return
    let second = 0
    const first = window.requestAnimationFrame(() => {
      second = window.requestAnimationFrame(() => setPhase('open'))
    })
    return () => {
      window.cancelAnimationFrame(first)
      window.cancelAnimationFrame(second)
    }
  }, [phase])

  useEffect(() => {
    if (phase !== 'closing') return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const timer = window.setTimeout(() => setPhase('closed'), reduced ? 0 : MOTION_MS)
    return () => window.clearTimeout(timer)
  }, [phase])

  useEffect(() => {
    if (!shown) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [shown])

  useEffect(() => {
    if (!shown || !closeOnEscape) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCloseRef.current()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [shown, closeOnEscape])

  useEffect(() => {
    if (!entered) return
    const mobile = window.matchMedia('(max-width: 639px)').matches
    const selector = mobile ? '.svc-side-pane__dismiss' : '.modal-close'
    paneRef.current?.querySelector<HTMLButtonElement>(selector)?.focus()
  }, [entered])

  if (!shown || typeof document === 'undefined') return null

  const portalRoot = (document.fullscreenElement as HTMLElement | null) ?? document.body

  return createPortal(
    <div className={`svc-side-pane__root${entered ? ' is-open' : ''}${elevated ? ' svc-side-pane__root--elevated' : ''}`}>
      <div className="svc-side-pane__backdrop" onClick={() => onCloseRef.current()} />
      <div
        ref={paneRef}
        className="svc-side-pane"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="modal-header">
          <h2 className="modal-title" id={titleId}>
            {title}
          </h2>
          <BUTCircleButton
            type="button"
            instantAction
            colorVariant="primary"
            className="modal-close"
            ariaLabel="Close"
            onClick={() => onCloseRef.current()}
            icon={<X size={24} weight="regular" aria-hidden />}
          />
        </div>
        <div className="svc-side-pane__body">{children}</div>
        <div className={`svc-side-pane__footer${footer ? ' svc-side-pane__footer--split' : ''}`}>
          {footer}
          <BUTWideButton
            type="button"
            width="fill"
            instantAction
            colorVariant="red-action"
            className="svc-side-pane__dismiss"
            onClick={() => onCloseRef.current()}
          >
            Close
          </BUTWideButton>
        </div>
      </div>
    </div>,
    portalRoot,
  )
}
