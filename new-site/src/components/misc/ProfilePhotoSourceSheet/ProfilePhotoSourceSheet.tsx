'use client'

import { TextCard } from '@/components/cards'
import './ProfilePhotoSourceSheet.css'

export type ProfilePhotoSourceSheetProps = {
  open: boolean
  cameraAvailable: boolean
  onClose: () => void
  onChooseLibrary: () => void
  onTakePicture: () => void
  onChooseFile: () => void
}

export default function ProfilePhotoSourceSheet({
  open,
  cameraAvailable,
  onClose,
  onChooseLibrary,
  onTakePicture,
  onChooseFile,
}: ProfilePhotoSourceSheetProps) {
  if (!open) return null

  return (
    <div
      className="rs-photo-source-overlay"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="rs-photo-source-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="rs-photo-source-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="rs-photo-source-title" className="rs-photo-source-title">
          Change photo
        </h2>
        <div className="rs-photo-source-list">
          <TextCard
            title="Choose from Library"
            description="Pick an existing photo from your device."
            onClick={() => {
              onClose()
              window.setTimeout(onChooseLibrary, 200)
            }}
          />
          <TextCard
            title="Take Picture"
            description={
              cameraAvailable
                ? 'Use the camera to take a new profile photo.'
                : 'Camera isn’t available on this device.'
            }
            disabled={!cameraAvailable}
            onClick={() => {
              if (!cameraAvailable) return
              onClose()
              window.setTimeout(onTakePicture, 200)
            }}
          />
          <TextCard
            title="Choose File"
            description="Select an image file from your device."
            onClick={() => {
              onClose()
              window.setTimeout(onChooseFile, 200)
            }}
          />
        </div>
        <button type="button" className="rs-photo-source-cancel" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  )
}
