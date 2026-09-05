'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { BUTWideButton } from '@/components/buttons'
import {
  AccountAuthShell,
  AccountContentShell,
} from '@/components/misc/AccountPageShell/AccountPageShell'
import TXTINPWideButton from '@/components/textInputs/plain/TXTINPWideButton'
import { useConsumerAuth } from '@/contexts/ConsumerAuthContext'
import './account.css'

export default function AccountHubPage() {
  const router = useRouter()
  const {
    user,
    profile,
    loading,
    vaultUnlocked,
    vaultRememberedOnDevice,
    needsEmailVerify,
    needsTotpEnroll,
    syncStatus,
    signOut,
    unlockVault,
    forgetDeviceVault,
    syncNow,
  } = useConsumerAuth()

  const [recovery, setRecovery] = useState('')
  const [rememberDevice, setRememberDevice] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (loading) return
    if (!user) {
      router.replace('/account/sign-in')
      return
    }
    if (needsEmailVerify) {
      router.replace('/account/verify-email')
      return
    }
    if (needsTotpEnroll) {
      router.replace('/account/mfa')
    }
  }, [loading, user, needsEmailVerify, needsTotpEnroll, router])

  const lastSyncedLabel = useMemo(() => {
    const d = syncStatus.lastSyncedAt
    if (!d) return null
    return d.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })
  }, [syncStatus.lastSyncedAt])

  if (loading) {
    return (
      <AccountAuthShell title="Account">
        <p className="rs-account-info" style={{ textAlign: 'center' }}>
          Loading…
        </p>
      </AccountAuthShell>
    )
  }

  if (!user) {
    return (
      <AccountAuthShell title="Account">
        <p className="rs-account-info" style={{ textAlign: 'center' }}>
          Redirecting to sign in…
        </p>
      </AccountAuthShell>
    )
  }

  if (needsEmailVerify || needsTotpEnroll) {
    return (
      <AccountAuthShell title="Account">
        <p className="rs-account-info" style={{ textAlign: 'center' }}>
          Finishing account setup…
        </p>
      </AccountAuthShell>
    )
  }

  return (
    <AccountContentShell title="Account" actionButton={{ to: '/', label: 'Back to home' }} panel>
      <div className="rs-account-profile">
        {profile?.avatarURL ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="rs-account-avatar" src={profile.avatarURL} alt="" />
        ) : (
          <div className="rs-account-avatar rs-account-avatar--placeholder" aria-hidden>
            ●
          </div>
        )}
        <div>
          <p className="rs-account-profile__name">{profile?.displayName ?? 'Account'}</p>
          <p className="rs-account-profile__meta">@{profile?.username}</p>
          <p className="rs-account-profile__meta">{profile?.email ?? user.email}</p>
        </div>
      </div>

      <div className="rs-account-divider" />

      <p className="rs-account-section-label">Cloud sync</p>
      {vaultUnlocked ? (
        <div className="rs-account-form-block">
          <p className="rs-account-info">
            Ready on this device. Loads stations from cloud; saves when you change visit or favourite.
            {lastSyncedLabel ? ` Last synced ${lastSyncedLabel}.` : ''}
            {vaultRememberedOnDevice
              ? ' This browser will unlock cloud sync after you sign in again.'
              : ''}
          </p>
          <BUTWideButton
            type="button"
            width="fill"
            disabled={syncStatus.isSyncing}
            onClick={() => void syncNow()}
          >
            {syncStatus.isSyncing ? 'Syncing…' : 'Reload from cloud'}
          </BUTWideButton>
          {vaultRememberedOnDevice ? (
            <BUTWideButton
              type="button"
              width="fill"
              onClick={() => forgetDeviceVault()}
            >
              Forget this device
            </BUTWideButton>
          ) : null}
        </div>
      ) : (
        <div className="rs-account-form-block">
          <p className="rs-account-info">
            Enter your recovery key to enable cloud sync on this device. It is not your account
            password — we can’t recover it for you.
          </p>
          <TXTINPWideButton
            id="recovery"
            placeholder="Recovery key"
            value={recovery}
            onChange={setRecovery}
            autoComplete="off"
            spellCheck={false}
            colorVariant="secondary"
          />
          <label className="rs-account-check">
            <input
              type="checkbox"
              checked={rememberDevice}
              onChange={(e) => setRememberDevice(e.target.checked)}
            />
            <span>Remember this device — keep cloud sync unlocked on this browser after sign-in</span>
          </label>
          {error ? <p className="rs-account-error">{error}</p> : null}
          <BUTWideButton
            type="button"
            width="fill"
            colorVariant="accent"
            disabled={busy || recovery.trim().length < 16}
            onClick={() => {
              setBusy(true)
              setError(null)
              void unlockVault(recovery, { rememberDevice })
                .catch((e) => setError(e instanceof Error ? e.message : String(e)))
                .finally(() => setBusy(false))
            }}
          >
            {busy ? 'Unlocking…' : 'Enable cloud sync'}
          </BUTWideButton>
        </div>
      )}

      {syncStatus.statusMessage ? <p className="rs-account-info">{syncStatus.statusMessage}</p> : null}
      {syncStatus.lastError ? <p className="rs-account-error">{syncStatus.lastError}</p> : null}

      <div className="rs-account-actions">
        <BUTWideButton type="button" width="fill" onClick={() => router.push('/account/settings')}>
          Account Settings
        </BUTWideButton>
        <BUTWideButton type="button" width="fill" onClick={() => router.push('/leaderboards')}>
          View Leaderboard
        </BUTWideButton>
      </div>

      <div className="rs-account-sticky-out">
        <BUTWideButton type="button" width="fill" colorVariant="red-action" onClick={() => void signOut()}>
          Sign out
        </BUTWideButton>
      </div>
    </AccountContentShell>
  )
}
