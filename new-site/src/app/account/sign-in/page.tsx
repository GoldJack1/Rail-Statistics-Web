'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { BUTWideButton } from '@/components/buttons'
import { AccountAuthShell } from '@/components/misc/AccountPageShell/AccountPageShell'
import TXTINPWideButton from '@/components/textInputs/plain/TXTINPWideButton'
import { useConsumerAuth } from '@/contexts/ConsumerAuthContext'
import { MFA_AUTOFILL, MFA_OTP_INPUT_NAME } from '@/constants/mfaAutofill'
import '../account.css'

export default function AccountSignInPage() {
  const router = useRouter()
  const { signIn, completeMfa, pendingMfaResolver, user, loading } = useConsumerAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [step, setStep] = useState<'credentials' | 'mfa'>('credentials')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!loading && user && step === 'credentials') {
      router.replace('/account')
    }
  }, [loading, user, step, router])

  return (
    <AccountAuthShell
      title={step === 'mfa' ? 'Authenticator code' : 'Welcome back'}
      subtitle={
        step === 'mfa'
          ? 'Enter the 6-digit code from your authenticator app.'
          : 'Sign in to unlock cloud sync on this device.'
      }
    >
      {step === 'credentials' ? (
        <div className="rs-account-form-stack">
          <TXTINPWideButton
            placeholder="Email"
            value={email}
            onChange={setEmail}
            type="email"
            autoComplete="username"
            colorVariant="secondary"
          />
          <TXTINPWideButton
            placeholder="Password"
            value={password}
            onChange={setPassword}
            type="password"
            autoComplete="current-password"
            colorVariant="secondary"
          />
          {error ? <p className="rs-account-error">{error}</p> : null}
          <BUTWideButton
            type="button"
            width="fill"
            colorVariant="accent"
            disabled={busy}
            onClick={() => {
              setBusy(true)
              setError(null)
              void signIn(email, password)
                .then((result) => {
                  if (result === 'mfa') setStep('mfa')
                  else router.replace('/account')
                })
                .catch((e) => setError(e instanceof Error ? e.message : String(e)))
                .finally(() => setBusy(false))
            }}
          >
            {busy ? 'Signing in…' : 'Sign in'}
          </BUTWideButton>
          <p className="rs-account-info" style={{ textAlign: 'center' }}>
            <Link href="/account/reset-password">Forgot password?</Link>
          </p>
        </div>
      ) : (
        <div className="rs-account-form-stack">
          <TXTINPWideButton
            placeholder="6-digit code"
            value={code}
            onChange={setCode}
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
            disabled={busy || !pendingMfaResolver}
            onClick={() => {
              setBusy(true)
              setError(null)
              void completeMfa(code)
                .then(() => router.replace('/account'))
                .catch((e) => setError(e instanceof Error ? e.message : String(e)))
                .finally(() => setBusy(false))
            }}
          >
            {busy ? 'Verifying…' : 'Continue'}
          </BUTWideButton>
        </div>
      )}
    </AccountAuthShell>
  )
}
