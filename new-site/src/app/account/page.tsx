'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { DeviceMobile, Gear, SignOut, Trophy, User } from '@phosphor-icons/react'
import { BUTWideButton } from '@/components/buttons'
import {
  AccountAuthShell,
  AccountContentShell,
} from '@/components/misc/AccountPageShell/AccountPageShell'
import {
  AccountSectionNav,
  type AccountSection,
} from '@/components/misc/AccountSectionNav/AccountSectionNav'
import TXTINPBUTWideButton from '@/components/textInputButtons/plain/TXTINPBUTWideButton'
import { useConsumerAuth } from '@/contexts/ConsumerAuthContext'
import './account.css'

const PROFILE_SECTION_ID = 'profile'

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

  const sections = useMemo((): AccountSection[] => {
    const items: AccountSection[] = [
      { id: PROFILE_SECTION_ID, label: 'Profile', icon: User },
      { id: 'settings', label: 'Account Settings', icon: Gear, selectable: false },
      { id: 'leaderboard', label: 'View Leaderboard', icon: Trophy, selectable: false },
    ]
    if (vaultRememberedOnDevice) {
      items.push({
        id: 'forget-device',
        label: 'Forget this device',
        icon: DeviceMobile,
        selectable: false,
        spacerAbove: 100,
      })
    }
    items.push({
      id: 'sign-out',
      label: 'Sign out',
      icon: SignOut,
      selectable: false,
      danger: true,
      // Keep the 100px gap above the destructive group when Forget device is hidden.
      spacerAbove: vaultRememberedOnDevice ? undefined : 100,
    })
    return items
  }, [vaultRememberedOnDevice])

  const handleSelectSection = (sectionId: string) => {
    if (sectionId === PROFILE_SECTION_ID) return
    if (sectionId === 'settings') {
      router.push('/account/settings')
      return
    }
    if (sectionId === 'leaderboard') {
      router.push('/leaderboards')
      return
    }
    if (sectionId === 'forget-device') {
      forgetDeviceVault()
      return
    }
    if (sectionId === 'sign-out') {
      void signOut()
    }
  }

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
    <AccountContentShell
      title="Account"
      actionButton={{ to: '/', label: 'Back to home' }}
      detailsLayout
    >
      <div className="account-page">
        <div className="account-layout station-details-layout">
          <AccountSectionNav
            sections={sections}
            activeSectionId={PROFILE_SECTION_ID}
            onSelect={handleSelectSection}
            ariaLabel="Account sections"
          />

          <main className="account-main station-details-main">
            <div className="account-card">
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

              <section className="rs-account-section" aria-labelledby="account-cloud-sync-title">
                <h2 id="account-cloud-sync-title" className="rs-account-section__title">
                  Cloud sync
                </h2>

                {vaultUnlocked ? (
                  <div className="rs-account-section__body">
                    <div className="rs-account-section__copy-stack">
                      <p className="rs-account-section__copy">
                        Cloud sync is active on this device. Visits and favourites load from the cloud
                        and save when you change them.
                      </p>
                      {lastSyncedLabel ? (
                        <p className="rs-account-section__meta">Last synced {lastSyncedLabel}</p>
                      ) : null}
                      {vaultRememberedOnDevice ? (
                        <p className="rs-account-section__meta">
                          This browser unlocks sync automatically after sign-in.
                        </p>
                      ) : null}
                      {syncStatus.statusMessage ? (
                        <p className="rs-account-section__status">{syncStatus.statusMessage}</p>
                      ) : null}
                      {syncStatus.lastError ? (
                        <p className="rs-account-error">{syncStatus.lastError}</p>
                      ) : null}
                    </div>
                    <div className="rs-account-section__actions">
                      <BUTWideButton
                        type="button"
                        width="fill"
                        disabled={syncStatus.isSyncing}
                        onClick={() => void syncNow()}
                      >
                        {syncStatus.isSyncing ? 'Syncing…' : 'Reload from cloud'}
                      </BUTWideButton>
                    </div>
                  </div>
                ) : (
                  <div className="rs-account-section__body">
                    <p className="rs-account-section__copy">
                      Enter your recovery key to enable cloud sync on this device. It is not your
                      account password — we can’t recover it for you.
                    </p>
                    <div className="rs-account-section__field">
                      <TXTINPBUTWideButton
                        id="recovery"
                        placeholder="Recovery key"
                        value={recovery}
                        onChange={setRecovery}
                        autoComplete="off"
                        spellCheck={false}
                        colorVariant="primary"
                      />
                    </div>
                    <label className="rs-account-check">
                      <input
                        type="checkbox"
                        checked={rememberDevice}
                        onChange={(e) => setRememberDevice(e.target.checked)}
                      />
                      <span>Remember this device after sign-in</span>
                    </label>
                    {error ? <p className="rs-account-error">{error}</p> : null}
                    {syncStatus.lastError ? (
                      <p className="rs-account-error">{syncStatus.lastError}</p>
                    ) : null}
                    <div className="rs-account-section__actions">
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
                  </div>
                )}
              </section>
            </div>
          </main>
        </div>
      </div>
    </AccountContentShell>
  )
}
