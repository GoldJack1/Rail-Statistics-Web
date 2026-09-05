'use client'

import { Suspense, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { BUTWideButton } from '@/components/buttons'
import { AccountAuthShell } from '@/components/misc/AccountPageShell/AccountPageShell'
import TXTINPWideButton from '@/components/textInputs/plain/TXTINPWideButton'
import { useConsumerAuth } from '@/contexts/ConsumerAuthContext'
import '../account.css'

function ResetPasswordInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { sendPasswordReset, verifyPasswordResetCode, confirmPasswordReset } = useConsumerAuth()

  const oobCode = searchParams.get('oobCode')?.trim() ?? ''
  const mode = searchParams.get('mode')
  const isCompleteFlow = Boolean(oobCode && (!mode || mode === 'resetPassword'))

  const [email, setEmail] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [verifiedEmail, setVerifiedEmail] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [checkingCode, setCheckingCode] = useState(isCompleteFlow)
  const [done, setDone] = useState(false)

  useEffect(() => {
    if (!isCompleteFlow) {
      setCheckingCode(false)
      return
    }
    let cancelled = false
    setCheckingCode(true)
    setError(null)
    void verifyPasswordResetCode(oobCode)
      .then((accountEmail) => {
        if (!cancelled) setVerifiedEmail(accountEmail)
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      })
      .finally(() => {
        if (!cancelled) setCheckingCode(false)
      })
    return () => {
      cancelled = true
    }
  }, [isCompleteFlow, oobCode, verifyPasswordResetCode])

  if (checkingCode) {
    return (
      <AccountAuthShell title="Reset password">
        <p className="rs-account-info" style={{ textAlign: 'center' }}>
          Checking reset link…
        </p>
      </AccountAuthShell>
    )
  }

  if (done) {
    return (
      <AccountAuthShell
        title="Password updated"
        subtitle="You can sign in with your new password. Cloud sync still needs your recovery key."
      >
        <div className="rs-account-form-stack">
          <BUTWideButton
            type="button"
            width="fill"
            colorVariant="accent"
            onClick={() => router.replace('/account/sign-in')}
          >
            Sign in
          </BUTWideButton>
        </div>
      </AccountAuthShell>
    )
  }

  if (isCompleteFlow) {
    return (
      <AccountAuthShell
        title="Choose a new password"
        subtitle={
          verifiedEmail
            ? `Resetting password for ${verifiedEmail}. This restores sign-in only — not cloud sync.`
            : 'Enter a new password for your account.'
        }
      >
        <div className="rs-account-form-stack">
          {error && !verifiedEmail ? (
            <>
              <p className="rs-account-error">{error}</p>
              <BUTWideButton
                type="button"
                width="fill"
                colorVariant="accent"
                onClick={() => router.replace('/account/reset-password')}
              >
                Request a new link
              </BUTWideButton>
              <p className="rs-account-info" style={{ textAlign: 'center' }}>
                <Link href="/account/sign-in">Back to sign in</Link>
              </p>
            </>
          ) : (
            <>
              <TXTINPWideButton
                placeholder="New password (8+)"
                value={newPassword}
                onChange={setNewPassword}
                type="password"
                autoComplete="new-password"
                colorVariant="secondary"
              />
              <TXTINPWideButton
                placeholder="Confirm new password"
                value={confirm}
                onChange={setConfirm}
                type="password"
                autoComplete="new-password"
                colorVariant="secondary"
              />
              {error ? <p className="rs-account-error">{error}</p> : null}
              <BUTWideButton
                type="button"
                width="fill"
                colorVariant="accent"
                disabled={busy || !verifiedEmail}
                onClick={() => {
                  if (newPassword !== confirm) {
                    setError('Passwords do not match.')
                    return
                  }
                  setBusy(true)
                  setError(null)
                  void confirmPasswordReset(oobCode, newPassword)
                    .then(() => setDone(true))
                    .catch((e) => setError(e instanceof Error ? e.message : String(e)))
                    .finally(() => setBusy(false))
                }}
              >
                {busy ? 'Saving…' : 'Update password'}
              </BUTWideButton>
              <p className="rs-account-info" style={{ textAlign: 'center' }}>
                <Link href="/account/sign-in">Back to sign in</Link>
              </p>
            </>
          )}
        </div>
      </AccountAuthShell>
    )
  }

  return (
    <AccountAuthShell
      title="Reset password"
      subtitle="We’ll email you a link. Resetting your password restores login only — you still need your recovery key for cloud sync."
    >
      <div className="rs-account-form-stack">
        <TXTINPWideButton
          placeholder="Email"
          value={email}
          onChange={setEmail}
          type="email"
          autoComplete="username"
          colorVariant="secondary"
        />
        {error ? <p className="rs-account-error">{error}</p> : null}
        {info ? <p className="rs-account-info">{info}</p> : null}
        <BUTWideButton
          type="button"
          width="fill"
          colorVariant="accent"
          disabled={busy || !email.trim()}
          onClick={() => {
            setBusy(true)
            setError(null)
            setInfo(null)
            void sendPasswordReset(email)
              .then(() =>
                setInfo('If an account exists for that email, a reset link is on its way.')
              )
              .catch((e) => setError(e instanceof Error ? e.message : String(e)))
              .finally(() => setBusy(false))
          }}
        >
          {busy ? 'Sending…' : 'Send reset link'}
        </BUTWideButton>
        <p className="rs-account-info" style={{ textAlign: 'center' }}>
          <Link href="/account/sign-in">Back to sign in</Link>
        </p>
      </div>
    </AccountAuthShell>
  )
}

export default function AccountResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <AccountAuthShell title="Reset password">
          <p className="rs-account-info" style={{ textAlign: 'center' }}>
            Loading…
          </p>
        </AccountAuthShell>
      }
    >
      <ResetPasswordInner />
    </Suspense>
  )
}
