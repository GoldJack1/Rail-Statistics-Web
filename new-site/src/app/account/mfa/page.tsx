'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import QRCode from 'qrcode'
import { BUTWideButton } from '@/components/buttons'
import { AccountAuthShell } from '@/components/misc/AccountPageShell/AccountPageShell'
import TXTINPWideButton from '@/components/textInputs/plain/TXTINPWideButton'
import { useConsumerAuth } from '@/contexts/ConsumerAuthContext'
import { MFA_AUTOFILL, MFA_OTP_INPUT_NAME } from '@/constants/mfaAutofill'
import type { TotpSecret } from '@/services/consumerAccountAuth'
import '../account.css'

export default function AccountMfaPage() {
  const router = useRouter()
  const { user, hasTotp, needsEmailVerify, beginTotpEnroll, finishTotpEnroll, refreshUser, signOut } =
    useConsumerAuth()
  const secretRef = useRef<TotpSecret | null>(null)
  const [secretKey, setSecretKey] = useState<string | null>(null)
  const [qrUrl, setQrUrl] = useState<string | null>(null)
  const [showQr, setShowQr] = useState(false)
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!user) {
      router.replace('/account/sign-in')
      return
    }
    if (needsEmailVerify) {
      router.replace('/account/verify-email')
      return
    }
    if (hasTotp) {
      router.replace('/account')
      return
    }

    let cancelled = false
    void beginTotpEnroll()
      .then(({ secret, qrUrl: uri, secretKey: key }) => {
        if (cancelled) return
        secretRef.current = secret
        setSecretKey(key)
        return QRCode.toDataURL(uri, { margin: 1, width: 220 })
      })
      .then((dataUrl) => {
        if (!cancelled && dataUrl) setQrUrl(dataUrl)
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      })

    return () => {
      cancelled = true
    }
  }, [user, hasTotp, needsEmailVerify, beginTotpEnroll, router])

  if (!user) return null

  return (
    <AccountAuthShell
      title="Set up 2-Factor Auth"
      subtitle="Add an authenticator app. This step is required and cannot be skipped."
    >
      {showQr && qrUrl ? (
        <div className="rs-account-qr">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qrUrl} alt="Authenticator QR code" />
        </div>
      ) : secretKey ? (
        <code className="rs-account-secret-display">{secretKey}</code>
      ) : (
        <p className="rs-account-info" style={{ textAlign: 'center' }}>
          Preparing authenticator setup…
        </p>
      )}

      <div className="rs-account-form-stack">
        <BUTWideButton
          type="button"
          width="fill"
          disabled={!secretKey}
          onClick={() => setShowQr((v) => !v)}
        >
          {showQr ? 'Show secret key' : 'View QR code'}
        </BUTWideButton>

        <TXTINPWideButton
          id="totp-enroll"
          value={code}
          onChange={setCode}
          placeholder="6-digit code"
          inputMode="numeric"
          autoComplete={MFA_AUTOFILL.signInOtp}
          name={MFA_OTP_INPUT_NAME}
          colorVariant="secondary"
        />
        {error ? <p className="rs-account-error">{error}</p> : null}
        <BUTWideButton
          type="button"
          width="fill"
          colorVariant="accent"
          disabled={busy || !secretRef.current}
          onClick={() => {
            const secret = secretRef.current
            if (!secret) return
            setBusy(true)
            setError(null)
            void finishTotpEnroll(secret, code)
              .then(() => refreshUser())
              .then(() => router.replace('/account'))
              .catch((e) => setError(e instanceof Error ? e.message : String(e)))
              .finally(() => setBusy(false))
          }}
        >
          Enable 2-Factor Auth
        </BUTWideButton>
        <BUTWideButton type="button" width="fill" colorVariant="red-action" onClick={() => void signOut()}>
          Sign out
        </BUTWideButton>
      </div>
    </AccountAuthShell>
  )
}
