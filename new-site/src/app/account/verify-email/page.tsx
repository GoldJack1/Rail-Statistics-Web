'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { BUTWideButton } from '@/components/buttons'
import { AccountAuthShell } from '@/components/misc/AccountPageShell/AccountPageShell'
import { useConsumerAuth } from '@/contexts/ConsumerAuthContext'
import { getUasAuth } from '@/services/userAccountsFirebase'
import '../account.css'

export default function AccountVerifyEmailPage() {
  const router = useRouter()
  const { user, refreshUser, resendVerification, signOut } = useConsumerAuth()
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (!user) {
    return (
      <AccountAuthShell title="Verify your email" subtitle="Sign in to verify your email.">
        <BUTWideButton type="button" width="fill" colorVariant="accent" onClick={() => router.push('/account/sign-in')}>
          Sign in
        </BUTWideButton>
      </AccountAuthShell>
    )
  }

  return (
    <AccountAuthShell
      title="Verify your email"
      subtitle={
        <>
          We sent a link to {user.email}. Open it, then continue. Email must be verified before
          2-Factor Auth.
        </>
      }
    >
      {error ? <p className="rs-account-error">{error}</p> : null}
      {info ? <p className="rs-account-info">{info}</p> : null}
      <div className="rs-account-actions" style={{ marginTop: 0 }}>
        <BUTWideButton
          type="button"
          width="fill"
          colorVariant="accent"
          disabled={busy}
          onClick={() => {
            setBusy(true)
            setError(null)
            void refreshUser()
              .then(() => {
                const u = getUasAuth()?.currentUser
                if (u?.emailVerified) router.replace('/account/mfa')
                else setInfo('Still not verified — check your inbox and try again.')
              })
              .catch((e) => setError(e instanceof Error ? e.message : String(e)))
              .finally(() => setBusy(false))
          }}
        >
          I’ve verified
        </BUTWideButton>
        <BUTWideButton
          type="button"
          width="fill"
          disabled={busy}
          onClick={() => {
            setBusy(true)
            setError(null)
            void resendVerification()
              .then(() => setInfo('Verification email resent.'))
              .catch((e) => setError(e instanceof Error ? e.message : String(e)))
              .finally(() => setBusy(false))
          }}
        >
          Resend email
        </BUTWideButton>
        <BUTWideButton type="button" width="fill" colorVariant="red-action" onClick={() => void signOut()}>
          Sign out
        </BUTWideButton>
      </div>
    </AccountAuthShell>
  )
}
