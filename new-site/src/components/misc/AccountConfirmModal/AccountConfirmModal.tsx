'use client'

import { BUTWideButton } from '@/components/buttons'
import './AccountConfirmModal.css'

export type AccountConfirmModalProps = {
  open: boolean
  title: string
  message: string
  cancelLabel?: string
  confirmLabel?: string
  confirmVariant?: 'red-action' | 'accent' | 'primary'
  onCancel: () => void
  onConfirm: () => void
}

export default function AccountConfirmModal({
  open,
  title,
  message,
  cancelLabel = 'Cancel',
  confirmLabel = 'Discard',
  confirmVariant = 'red-action',
  onCancel,
  onConfirm,
}: AccountConfirmModalProps) {
  if (!open) return null

  return (
    <div
      className="rs-account-confirm-overlay"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel()
      }}
    >
      <div
        className="rs-account-confirm-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="rs-account-confirm-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="rs-account-confirm-title" className="rs-account-confirm-title">
          {title}
        </h2>
        <p className="rs-account-confirm-message">{message}</p>
        <div className="rs-account-confirm-actions">
          <BUTWideButton
            type="button"
            width="fill"
            colorVariant={confirmVariant}
            onClick={onConfirm}
          >
            {confirmLabel}
          </BUTWideButton>
          <BUTWideButton type="button" width="fill" onClick={onCancel}>
            {cancelLabel}
          </BUTWideButton>
        </div>
      </div>
    </div>
  )
}
