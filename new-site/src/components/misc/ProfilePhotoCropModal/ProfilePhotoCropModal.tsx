'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { BUTWideButton } from '@/components/buttons'
import './ProfilePhotoCropModal.css'

const OUTPUT_SIZE = 512
const MAX_SCALE_FACTOR = 6
const JPEG_QUALITY = 0.82

export type ProfilePhotoCropModalProps = {
  imageUrl: string
  open: boolean
  busy?: boolean
  onCancel: () => void
  onConfirm: (blob: Blob) => void
}

type Transform = {
  scale: number
  minScale: number
  tx: number
  ty: number
  imgW: number
  imgH: number
}

function clampTransform(t: Transform, crop: number): Transform {
  const mappedW = t.imgW * t.scale
  const mappedH = t.imgH * t.scale
  let { tx, ty } = t

  if (mappedW <= crop) {
    tx = (crop - mappedW) / 2
  } else {
    if (tx > 0) tx = 0
    if (tx + mappedW < crop) tx = crop - mappedW
  }

  if (mappedH <= crop) {
    ty = (crop - mappedH) / 2
  } else {
    if (ty > 0) ty = 0
    if (ty + mappedH < crop) ty = crop - mappedH
  }

  return { ...t, tx, ty }
}

function initialTransform(imgW: number, imgH: number, crop: number): Transform {
  const minScale = Math.max(crop / imgW, crop / imgH)
  return clampTransform(
    {
      scale: minScale,
      minScale,
      tx: (crop - imgW * minScale) / 2,
      ty: (crop - imgH * minScale) / 2,
      imgW,
      imgH,
    },
    crop
  )
}

export default function ProfilePhotoCropModal({
  imageUrl,
  open,
  busy = false,
  onCancel,
  onConfirm,
}: ProfilePhotoCropModalProps) {
  const stageRef = useRef<HTMLDivElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)
  const [cropSize, setCropSize] = useState(280)
  const [transform, setTransform] = useState<Transform | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)

  const dragRef = useRef<{
    pointerId: number
    startX: number
    startY: number
    originTx: number
    originTy: number
  } | null>(null)
  const pinchRef = useRef<{
    startDist: number
    startScale: number
    focusX: number
    focusY: number
    originTx: number
    originTy: number
  } | null>(null)
  const transformRef = useRef(transform)
  transformRef.current = transform

  useEffect(() => {
    if (!open) return
    setLoadError(null)
    setTransform(null)

    const measure = () => {
      const el = stageRef.current
      if (!el) return
      const side = Math.min(el.clientWidth, el.clientHeight, 360)
      setCropSize(Math.max(200, side))
    }
    measure()
    const ro = new ResizeObserver(measure)
    if (stageRef.current) ro.observe(stageRef.current)
    return () => ro.disconnect()
  }, [open, imageUrl])

  const onImageLoad = useCallback(() => {
    const img = imgRef.current
    if (!img || !img.naturalWidth) return
    setTransform(initialTransform(img.naturalWidth, img.naturalHeight, cropSize))
  }, [cropSize])

  useEffect(() => {
    const img = imgRef.current
    if (!img?.complete || !img.naturalWidth) return
    setTransform(initialTransform(img.naturalWidth, img.naturalHeight, cropSize))
  }, [cropSize, imageUrl])

  const applyScaleAt = useCallback(
    (nextScale: number, focusX: number, focusY: number) => {
      setTransform((prev) => {
        if (!prev) return prev
        const scale = Math.min(
          Math.max(nextScale, prev.minScale),
          prev.minScale * MAX_SCALE_FACTOR
        )
        const ratio = scale / prev.scale
        const tx = focusX - (focusX - prev.tx) * ratio
        const ty = focusY - (focusY - prev.ty) * ratio
        return clampTransform({ ...prev, scale, tx, ty }, cropSize)
      })
    },
    [cropSize]
  )

  useEffect(() => {
    const stage = stageRef.current
    if (!open || !stage) return
    const onWheelNative = (e: WheelEvent) => {
      const t = transformRef.current
      if (!t) return
      e.preventDefault()
      const rect = stage.getBoundingClientRect()
      const focusX = e.clientX - rect.left
      const focusY = e.clientY - rect.top
      const factor = e.deltaY < 0 ? 1.08 : 1 / 1.08
      const nextScale = Math.min(
        Math.max(t.scale * factor, t.minScale),
        t.minScale * MAX_SCALE_FACTOR
      )
      const ratio = nextScale / t.scale
      const tx = focusX - (focusX - t.tx) * ratio
      const ty = focusY - (focusY - t.ty) * ratio
      setTransform(clampTransform({ ...t, scale: nextScale, tx, ty }, cropSize))
    }
    stage.addEventListener('wheel', onWheelNative, { passive: false })
    return () => stage.removeEventListener('wheel', onWheelNative)
  }, [open, cropSize])

  const onPointerDown = (e: React.PointerEvent) => {
    if (busy || exporting || !transform) return
    if (e.pointerType === 'touch' && (e as unknown as { isPrimary?: boolean }).isPrimary === false) {
      return
    }
    const stage = stageRef.current
    if (!stage) return
    stage.setPointerCapture(e.pointerId)
    dragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      originTx: transform.tx,
      originTy: transform.ty,
    }
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== e.pointerId || pinchRef.current) return
    const dx = e.clientX - drag.startX
    const dy = e.clientY - drag.startY
    setTransform((prev) => {
      if (!prev) return prev
      return clampTransform(
        { ...prev, tx: drag.originTx + dx, ty: drag.originTy + dy },
        cropSize
      )
    })
  }

  const onPointerUp = (e: React.PointerEvent) => {
    if (dragRef.current?.pointerId === e.pointerId) dragRef.current = null
  }

  const onTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length !== 2 || !transform) return
    dragRef.current = null
    const [a, b] = [e.touches[0]!, e.touches[1]!]
    const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)
    const rect = stageRef.current?.getBoundingClientRect()
    if (!rect) return
    pinchRef.current = {
      startDist: dist,
      startScale: transform.scale,
      focusX: (a.clientX + b.clientX) / 2 - rect.left,
      focusY: (a.clientY + b.clientY) / 2 - rect.top,
      originTx: transform.tx,
      originTy: transform.ty,
    }
  }

  const onTouchMove = (e: React.TouchEvent) => {
    const pinch = pinchRef.current
    if (!pinch || e.touches.length !== 2) return
    e.preventDefault()
    const [a, b] = [e.touches[0]!, e.touches[1]!]
    const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)
    if (pinch.startDist <= 0) return
    applyScaleAt(pinch.startScale * (dist / pinch.startDist), pinch.focusX, pinch.focusY)
  }

  const onTouchEnd = () => {
    if (!pinchRef.current) return
    pinchRef.current = null
  }

  const handleUsePhoto = async () => {
    const t = transformRef.current
    const img = imgRef.current
    if (!t || !img || !img.naturalWidth) return
    setExporting(true)
    try {
      const sx = Math.max(0, -t.tx / t.scale)
      const sy = Math.max(0, -t.ty / t.scale)
      const sw = Math.min(t.imgW - sx, cropSize / t.scale)
      const sh = Math.min(t.imgH - sy, cropSize / t.scale)
      const canvas = document.createElement('canvas')
      canvas.width = OUTPUT_SIZE
      canvas.height = OUTPUT_SIZE
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('Could not process image.')
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, OUTPUT_SIZE, OUTPUT_SIZE)
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY)
      )
      if (!blob) throw new Error('Could not encode image.')
      if (blob.size > 2 * 1024 * 1024) throw new Error('Image must be under 2MB.')
      onConfirm(blob)
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err))
    } finally {
      setExporting(false)
    }
  }

  if (!open) return null

  const disabled = busy || exporting || !transform

  return (
    <div
      className="rs-photo-crop-overlay"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy && !exporting) onCancel()
      }}
    >
      <div
        className="rs-photo-crop-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="rs-photo-crop-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="rs-photo-crop-title" className="rs-photo-crop-title">
          Adjust photo
        </h2>
        <p className="rs-photo-crop-hint">
          Drag to move and pinch or scroll to zoom so your photo fits the square.
        </p>

        <div
          ref={stageRef}
          className="rs-photo-crop-stage"
          style={{ width: cropSize, height: cropSize }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            ref={imgRef}
            src={imageUrl}
            alt=""
            className="rs-photo-crop-image"
            draggable={false}
            onLoad={onImageLoad}
            onError={() => setLoadError('Couldn’t open that image. Try another photo.')}
            style={
              transform
                ? {
                    width: transform.imgW * transform.scale,
                    height: transform.imgH * transform.scale,
                    transform: `translate(${transform.tx}px, ${transform.ty}px)`,
                  }
                : undefined
            }
          />
          <div className="rs-photo-crop-frame" aria-hidden />
        </div>

        {loadError ? <p className="rs-photo-crop-error">{loadError}</p> : null}

        <div className="rs-photo-crop-actions">
          <BUTWideButton
            type="button"
            width="fill"
            colorVariant="accent"
            disabled={disabled}
            onClick={() => void handleUsePhoto()}
          >
            {busy || exporting ? 'Working…' : 'Use photo'}
          </BUTWideButton>
          <BUTWideButton
            type="button"
            width="fill"
            disabled={busy || exporting}
            onClick={onCancel}
          >
            Cancel
          </BUTWideButton>
        </div>
      </div>
    </div>
  )
}
