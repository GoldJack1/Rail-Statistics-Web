'use client'

import { useEffect, useRef, useState } from 'react'
import { BUTWideButton } from '@/components/buttons'
import './CameraCaptureModal.css'

export type CameraCaptureModalProps = {
  open: boolean
  onCancel: () => void
  /** Called with an object URL of a captured still (caller should revoke). */
  onCapture: (objectUrl: string) => void
}

export default function CameraCaptureModal({ open, onCancel, onCapture }: CameraCaptureModalProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setError(null)
    setReady(false)

    void (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error('Camera isn’t available in this browser.')
        }
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: 'user' },
            width: { ideal: 1280 },
            height: { ideal: 1280 },
          },
        })
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        streamRef.current = stream
        const video = videoRef.current
        if (video) {
          video.srcObject = stream
          await video.play()
          setReady(true)
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Could not open the camera.')
        }
      }
    })()

    return () => {
      cancelled = true
      streamRef.current?.getTracks().forEach((t) => t.stop())
      streamRef.current = null
      if (videoRef.current) videoRef.current.srcObject = null
    }
  }, [open])

  const takePicture = () => {
    const video = videoRef.current
    if (!video || !video.videoWidth) return
    const side = Math.min(video.videoWidth, video.videoHeight)
    const sx = (video.videoWidth - side) / 2
    const sy = (video.videoHeight - side) / 2
    const canvas = document.createElement('canvas')
    canvas.width = side
    canvas.height = side
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.drawImage(video, sx, sy, side, side, 0, 0, side, side)
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          setError('Could not capture photo.')
          return
        }
        onCapture(URL.createObjectURL(blob))
      },
      'image/jpeg',
      0.92
    )
  }

  if (!open) return null

  return (
    <div className="rs-camera-overlay" role="presentation">
      <div
        className="rs-camera-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="rs-camera-title"
      >
        <h2 id="rs-camera-title" className="rs-camera-title">
          Take Picture
        </h2>
        <div className="rs-camera-preview">
          <video ref={videoRef} className="rs-camera-video" playsInline muted autoPlay />
        </div>
        {error ? <p className="rs-camera-error">{error}</p> : null}
        <div className="rs-camera-actions">
          <BUTWideButton
            type="button"
            width="fill"
            colorVariant="accent"
            disabled={!ready || Boolean(error)}
            onClick={takePicture}
          >
            Take photo
          </BUTWideButton>
          <BUTWideButton type="button" width="fill" onClick={onCancel}>
            Cancel
          </BUTWideButton>
        </div>
      </div>
    </div>
  )
}
