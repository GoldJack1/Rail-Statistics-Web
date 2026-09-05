'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage'
import { BUTWideButton } from '@/components/buttons'
import { TextCard } from '@/components/cards'
import {
  AccountAuthShell,
  AccountContentShell,
} from '@/components/misc/AccountPageShell/AccountPageShell'
import TXTINPWideButton from '@/components/textInputs/plain/TXTINPWideButton'
import { useConsumerAuth } from '@/contexts/ConsumerAuthContext'
import { LEADERBOARD_FAIR_NETWORK_IDS } from '@/services/accountModels'
import { ensureUserAccountsFirebase } from '@/services/userAccountsFirebase'
import { publishLeaderboardIfNeeded } from '@/services/leaderboardService'
import './settings.css'
import '../account.css'

const TOPICS = [
  { id: 'photo', title: 'Profile photo', sub: 'Change or remove the photo shown on leaderboards.' },
  { id: 'name', title: 'Name & username', sub: 'Update your display name and @username.' },
  { id: 'password', title: 'Password', sub: 'Change your account password.' },
  { id: 'twoFactor', title: '2-Factor Auth', sub: 'Authenticator status, or replace your app.' },
  { id: 'email', title: 'Email', sub: 'View your address or request a change.' },
  { id: 'leaderboards', title: 'Leaderboards', sub: 'Opt in and choose what you share.' },
  { id: 'cloudSync', title: 'Cloud sync', sub: 'Recovery key, status, and Sync Now.' },
] as const

type TopicId = (typeof TOPICS)[number]['id']

async function resizeToJpeg(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file)
  const max = 512
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height))
  const w = Math.max(1, Math.round(bitmap.width * scale))
  const h = Math.max(1, Math.round(bitmap.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not process image.')
  ctx.drawImage(bitmap, 0, 0, w, h)
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.82))
  if (!blob) throw new Error('Could not encode image.')
  if (blob.size > 2 * 1024 * 1024) throw new Error('Image must be under 2MB.')
  return blob
}

export default function AccountSettingsPage() {
  const {
    user,
    profile,
    loading,
    vaultUnlocked,
    vaultRememberedOnDevice,
    hasTotp,
    syncStatus,
    unlockVault,
    forgetDeviceVault,
    syncNow,
    updateNameUsername,
    changePassword,
    requestEmailChange,
    updateBoardPrefs,
    saveProfileFields,
    noteDiaryChanged,
  } = useConsumerAuth()

  const [topic, setTopic] = useState<TopicId | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const [displayName, setDisplayName] = useState('')
  const [username, setUsername] = useState('')
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [newEmail, setNewEmail] = useState('')
  const [recovery, setRecovery] = useState('')
  const [rememberDevice, setRememberDevice] = useState(true)

  const lastSynced = useMemo(() => {
    const d = syncStatus.lastSyncedAt
    return d ? d.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : null
  }, [syncStatus.lastSyncedAt])

  if (loading) {
    return (
      <AccountAuthShell title="Account Settings">
        <p className="rs-account-info" style={{ textAlign: 'center' }}>
          Loading…
        </p>
      </AccountAuthShell>
    )
  }

  if (!user || !profile) {
    return (
      <AccountContentShell
        title="Account Settings"
        subtitle="Sign in to manage account settings."
        actionButton={{ to: '/account/sign-in', label: 'Back' }}
      >
        <TextCard title="Sign in" description="Access your Rail Statistics account." to="/account/sign-in" />
      </AccountContentShell>
    )
  }

  if (!topic) {
    return (
      <AccountContentShell
        title="Account Settings"
        actionButton={{ to: '/account', label: 'Back' }}
      >
        {TOPICS.map((t) => (
          <TextCard
            key={t.id}
            title={t.title}
            description={t.sub}
            onClick={() => {
              setTopic(t.id)
              setError(null)
              setInfo(null)
              if (t.id === 'name') {
                setDisplayName(profile.displayName)
                setUsername(profile.username)
              }
            }}
          />
        ))}
      </AccountContentShell>
    )
  }

  const title = TOPICS.find((t) => t.id === topic)?.title ?? 'Settings'

  return (
    <AccountContentShell
      title={title}
      actionButton={{
        label: 'Back',
        onClick: () => {
          setTopic(null)
          setError(null)
          setInfo(null)
        },
      }}
    >
      {error ? <p className="rs-account-error">{error}</p> : null}
      {info ? <p className="rs-account-info">{info}</p> : null}

      {topic === 'photo' ? (
        <div className="rs-account-actions">
          <input
            type="file"
            accept="image/*"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (!file) return
              setBusy(true)
              setError(null)
              void (async () => {
                const { storage } = await ensureUserAccountsFirebase()
                const blob = await resizeToJpeg(file)
                const path = `avatars/${profile.uid}/profile.jpg`
                const storageRef = ref(storage, path)
                await uploadBytes(storageRef, blob, { contentType: 'image/jpeg' })
                const url = await getDownloadURL(storageRef)
                const next = { ...profile, avatarURL: url }
                await saveProfileFields(next)
                await publishLeaderboardIfNeeded({ profile: next, catalogue: [], force: true })
                setInfo('Profile photo updated.')
                noteDiaryChanged()
              })()
                .catch((err) => setError(err instanceof Error ? err.message : String(err)))
                .finally(() => setBusy(false))
            }}
          />
          {profile.avatarURL ? (
            <BUTWideButton
              type="button"
              width="fill"
              disabled={busy}
              onClick={() => {
                setBusy(true)
                void (async () => {
                  const { storage } = await ensureUserAccountsFirebase()
                  try {
                    await deleteObject(ref(storage, `avatars/${profile.uid}/profile.jpg`))
                  } catch {
                    /* may already be gone */
                  }
                  const next = { ...profile, avatarURL: null }
                  await saveProfileFields(next)
                  setInfo('Profile photo removed.')
                })()
                  .catch((err) => setError(err instanceof Error ? err.message : String(err)))
                  .finally(() => setBusy(false))
              }}
            >
              Remove photo
            </BUTWideButton>
          ) : null}
        </div>
      ) : null}

      {topic === 'name' ? (
        <div className="rs-account-form-stack">
          <TXTINPWideButton
            placeholder="Display name"
            value={displayName}
            onChange={setDisplayName}
            colorVariant="secondary"
          />
          <TXTINPWideButton
            placeholder="Username"
            value={username}
            onChange={setUsername}
            colorVariant="secondary"
          />
          <BUTWideButton
            type="button"
            width="fill"
            colorVariant="accent"
            disabled={busy}
            onClick={() => {
              setBusy(true)
              setError(null)
              void updateNameUsername(displayName, username)
                .then(() => setInfo('Saved.'))
                .catch((e) => setError(e instanceof Error ? e.message : String(e)))
                .finally(() => setBusy(false))
            }}
          >
            Save
          </BUTWideButton>
        </div>
      ) : null}

      {topic === 'password' ? (
        <div className="rs-account-form-stack">
          <TXTINPWideButton
            placeholder="Current password"
            type="password"
            value={currentPassword}
            onChange={setCurrentPassword}
            colorVariant="secondary"
          />
          <TXTINPWideButton
            placeholder="New password (8+)"
            type="password"
            value={newPassword}
            onChange={setNewPassword}
            colorVariant="secondary"
          />
          <BUTWideButton
            type="button"
            width="fill"
            colorVariant="accent"
            disabled={busy}
            onClick={() => {
              setBusy(true)
              setError(null)
              void changePassword(currentPassword, newPassword)
                .then(() => {
                  setInfo('Password updated.')
                  setCurrentPassword('')
                  setNewPassword('')
                })
                .catch((e) => setError(e instanceof Error ? e.message : String(e)))
                .finally(() => setBusy(false))
            }}
          >
            Update password
          </BUTWideButton>
        </div>
      ) : null}

      {topic === 'twoFactor' ? (
        <div>
          <p className="rs-account-info">Status: {hasTotp ? 'Enabled' : 'Not set up'}</p>
          <p className="rs-account-info">
            2-Factor Auth is required for Rail Statistics accounts. To replace your authenticator,
            re-enrol from a signed-in session on mobile, or contact support if you are locked out.
          </p>
          <Link href="/account/mfa">Re-open setup (if not enrolled)</Link>
        </div>
      ) : null}

      {topic === 'email' ? (
        <div className="rs-account-form-stack">
          <p className="rs-account-info">Current: {profile.email}</p>
          <TXTINPWideButton
            placeholder="Password"
            type="password"
            value={currentPassword}
            onChange={setCurrentPassword}
            colorVariant="secondary"
          />
          <TXTINPWideButton
            placeholder="New email"
            type="email"
            value={newEmail}
            onChange={setNewEmail}
            colorVariant="secondary"
          />
          <BUTWideButton
            type="button"
            width="fill"
            colorVariant="accent"
            disabled={busy}
            onClick={() => {
              setBusy(true)
              setError(null)
              void requestEmailChange(currentPassword, newEmail)
                .then(() => setInfo('Check your new inbox to confirm the email change.'))
                .catch((e) => setError(e instanceof Error ? e.message : String(e)))
                .finally(() => setBusy(false))
            }}
          >
            Send confirmation
          </BUTWideButton>
        </div>
      ) : null}

      {topic === 'leaderboards' ? (
        <div className="rs-account-form-stack">
          <label className="rs-account-check">
            <input
              type="checkbox"
              checked={profile.leaderboardsOptIn}
              onChange={(e) => {
                const optedIn = e.target.checked
                void updateBoardPrefs({
                  leaderboardsOptIn: optedIn,
                  leaderboardsShowOnAllNetworks: optedIn ? true : false,
                  leaderboardsEnabledNetworkIDs: optedIn ? [] : profile.leaderboardsEnabledNetworkIDs,
                  leaderboardsShowDisplayName: profile.leaderboardsShowDisplayName,
                }).then(() => setInfo('Leaderboard preferences updated.'))
              }}
            />
            <span>Opt in to leaderboards</span>
          </label>
          {profile.leaderboardsOptIn ? (
            <>
              <label className="rs-account-check">
                <input
                  type="checkbox"
                  checked={profile.leaderboardsShowOnAllNetworks}
                  onChange={(e) => {
                    void updateBoardPrefs({
                      leaderboardsOptIn: true,
                      leaderboardsShowOnAllNetworks: e.target.checked,
                      leaderboardsEnabledNetworkIDs: profile.leaderboardsEnabledNetworkIDs,
                      leaderboardsShowDisplayName: profile.leaderboardsShowDisplayName,
                    })
                  }}
                />
                <span>All networks</span>
              </label>
              {!profile.leaderboardsShowOnAllNetworks
                ? LEADERBOARD_FAIR_NETWORK_IDS.map((id) => (
                    <label key={id} className="rs-account-check">
                      <input
                        type="checkbox"
                        checked={profile.leaderboardsEnabledNetworkIDs.includes(id)}
                        onChange={(e) => {
                          const set = new Set(profile.leaderboardsEnabledNetworkIDs)
                          if (e.target.checked) set.add(id)
                          else set.delete(id)
                          void updateBoardPrefs({
                            leaderboardsOptIn: true,
                            leaderboardsShowOnAllNetworks: false,
                            leaderboardsEnabledNetworkIDs: [...set],
                            leaderboardsShowDisplayName: profile.leaderboardsShowDisplayName,
                          })
                        }}
                      />
                      <span>{id}</span>
                    </label>
                  ))
                : null}
              <label className="rs-account-check">
                <input
                  type="checkbox"
                  checked={profile.leaderboardsShowDisplayName}
                  onChange={(e) => {
                    void updateBoardPrefs({
                      leaderboardsOptIn: true,
                      leaderboardsShowOnAllNetworks: profile.leaderboardsShowOnAllNetworks,
                      leaderboardsEnabledNetworkIDs: profile.leaderboardsEnabledNetworkIDs,
                      leaderboardsShowDisplayName: e.target.checked,
                    })
                  }}
                />
                <span>Show display name (username always shown)</span>
              </label>
            </>
          ) : null}
        </div>
      ) : null}

      {topic === 'cloudSync' ? (
        <div className="rs-account-form-stack">
          {vaultUnlocked ? (
            <>
              <p className="rs-account-info">
                Cloud sync ready on this device.
                {lastSynced ? ` Last synced ${lastSynced}.` : ''}
                {vaultRememberedOnDevice
                  ? ' This browser will unlock cloud sync after you sign in again.'
                  : ''}
              </p>
              <BUTWideButton
                type="button"
                width="fill"
                colorVariant="accent"
                disabled={syncStatus.isSyncing}
                onClick={() => void syncNow()}
              >
                Sync Now
              </BUTWideButton>
              {vaultRememberedOnDevice ? (
                <BUTWideButton
                  type="button"
                  width="fill"
                  onClick={() => {
                    forgetDeviceVault()
                    setInfo('This browser will no longer unlock cloud sync automatically.')
                  }}
                >
                  Forget this device
                </BUTWideButton>
              ) : null}
            </>
          ) : (
            <div className="rs-account-form-stack">
              <p className="rs-account-info">Enter your recovery key to enable cloud sync on this device.</p>
              <TXTINPWideButton
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
              <BUTWideButton
                type="button"
                width="fill"
                colorVariant="accent"
                disabled={busy}
                onClick={() => {
                  setBusy(true)
                  void unlockVault(recovery, { rememberDevice })
                    .then(() => setInfo('Cloud sync enabled.'))
                    .catch((e) => setError(e instanceof Error ? e.message : String(e)))
                    .finally(() => setBusy(false))
                }}
              >
                Enable cloud sync
              </BUTWideButton>
            </div>
          )}
        </div>
      ) : null}
    </AccountContentShell>
  )
}
