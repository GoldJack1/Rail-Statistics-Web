'use client'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Camera,
  CloudArrowUp,
  EnvelopeSimple,
  IdentificationCard,
  Password,
  ShieldCheck,
  Storefront,
  Trophy,
} from '@phosphor-icons/react'
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage'
import { BUTWideButton } from '@/components/buttons'
import { TextCard } from '@/components/cards'
import AccountConfirmModal from '@/components/misc/AccountConfirmModal/AccountConfirmModal'
import {
  AccountAuthShell,
  AccountContentShell,
} from '@/components/misc/AccountPageShell/AccountPageShell'
import {
  AccountSectionNav,
  type AccountSection,
} from '@/components/misc/AccountSectionNav/AccountSectionNav'
import CameraCaptureModal from '@/components/misc/CameraCaptureModal/CameraCaptureModal'
import ProfilePhotoCropModal from '@/components/misc/ProfilePhotoCropModal/ProfilePhotoCropModal'
import ProfilePhotoSourceSheet from '@/components/misc/ProfilePhotoSourceSheet/ProfilePhotoSourceSheet'
import TXTINPBUTWideButton from '@/components/textInputButtons/plain/TXTINPBUTWideButton'
import { useConsumerAuth } from '@/contexts/ConsumerAuthContext'
import {
  LEADERBOARD_FAIR_NETWORK_IDS,
  isValidUsername,
  leaderboardNetworkDisplayName,
  normalizeUsername,
} from '@/services/accountModels'
import { ensureUserAccountsFirebase } from '@/services/userAccountsFirebase'
import { publishLeaderboardIfNeeded } from '@/services/leaderboardService'
import {
  devOverrideMessageFromPrefs,
  fetchAccountSubscriptionStatus,
  type AccountSubscriptionStatus,
} from '@/services/subscriptionStatus'
import { fetchCloudDevOverrideFlags } from '@/services/encryptedVaultSync'
import SubscriptionSettingsPanel from '@/components/misc/SubscriptionSettingsPanel/SubscriptionSettingsPanel'
import '../account.css'

const TOPICS = [
  {
    id: 'photo',
    title: 'Profile photo',
    sub: 'Change or remove the photo shown on leaderboards.',
    icon: Camera,
  },
  {
    id: 'name',
    title: 'Name & username',
    sub: 'Update your display name and @username.',
    icon: IdentificationCard,
  },
  {
    id: 'password',
    title: 'Password',
    sub: 'Change your account password.',
    icon: Password,
  },
  {
    id: 'twoFactor',
    title: '2-Factor Auth',
    sub: 'Authenticator status, or replace your app.',
    icon: ShieldCheck,
  },
  {
    id: 'email',
    title: 'Email',
    sub: 'View your address or request a change.',
    icon: EnvelopeSimple,
  },
  {
    id: 'leaderboards',
    title: 'Leaderboards',
    sub: 'Opt in and choose what you share.',
    icon: Trophy,
  },
  {
    id: 'cloudSync',
    title: 'Cloud sync',
    sub: 'Recovery key, status, and Sync Now.',
    icon: CloudArrowUp,
  },
  {
    id: 'subscription',
    title: 'Subscription',
    sub: 'Subscribe on the web, or manage an existing App Store, Google Play, or Stripe plan.',
    icon: Storefront,
  },
] as const

type TopicId = (typeof TOPICS)[number]['id']
type PendingLeave = { type: 'back' } | { type: 'topic'; id: TopicId }

function isTopicId(value: string | null | undefined): value is TopicId {
  return Boolean(value && TOPICS.some((t) => t.id === value))
}

function looksLikeEmail(value: string): boolean {
  return value.includes('@') && value.includes('.')
}

export default function AccountSettingsPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const {
    user,
    profile,
    loading,
    vaultUnlocked,
    vaultRememberedOnDevice,
    hasTotp,
    needsEmailVerify,
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
    resendVerification,
    refreshUser,
  } = useConsumerAuth()

  const topicFromUrl = searchParams.get('topic')
  const [topic, setTopic] = useState<TopicId>(() =>
    isTopicId(topicFromUrl) ? topicFromUrl : 'photo'
  )
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [subscriptionError, setSubscriptionError] = useState<string | null>(null)

  const [displayName, setDisplayName] = useState(() => profile?.displayName ?? '')
  const [username, setUsername] = useState(() => profile?.username ?? '')
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [emailPassword, setEmailPassword] = useState('')
  const [newEmail, setNewEmail] = useState('')
  const [recovery, setRecovery] = useState('')
  const [rememberDevice, setRememberDevice] = useState(true)
  const [subscription, setSubscription] = useState<AccountSubscriptionStatus | null>(null)
  const [subscriptionLoading, setSubscriptionLoading] = useState(false)
  const [subscriptionDevOverrideNote, setSubscriptionDevOverrideNote] = useState<string | null>(null)
  const [cropImageUrl, setCropImageUrl] = useState<string | null>(null)
  const [showPhotoSource, setShowPhotoSource] = useState(false)
  const [showCamera, setShowCamera] = useState(false)
  const [cameraAvailable, setCameraAvailable] = useState(false)
  const [pendingLeave, setPendingLeave] = useState<PendingLeave | null>(null)

  const libraryInputRef = useRef<HTMLInputElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setCameraAvailable(Boolean(navigator.mediaDevices?.getUserMedia))
  }, [])

  useEffect(() => {
    if (!profile) return
    if (topic === 'name') {
      setDisplayName(profile.displayName)
      setUsername(profile.username)
    }
  }, [profile, topic])

  const trimmedDisplayName = displayName.trim()
  const trimmedUsername = username.trim()
  const savedDisplayName = (profile?.displayName ?? '').trim()
  const savedUsername = (profile?.username ?? '').trim()
  const trimmedNewEmail = newEmail.trim()

  const hasUnsavedNameChanges =
    trimmedDisplayName !== savedDisplayName || trimmedUsername !== savedUsername
  const canSaveName =
    hasUnsavedNameChanges &&
    !busy &&
    trimmedDisplayName.length > 0 &&
    isValidUsername(trimmedUsername)

  const hasUnsavedPasswordChanges =
    currentPassword.length > 0 || newPassword.length > 0 || confirmPassword.length > 0
  const canSavePassword =
    !busy &&
    currentPassword.length > 0 &&
    newPassword.length >= 8 &&
    newPassword === confirmPassword

  const hasUnsavedEmailChanges = trimmedNewEmail.length > 0 || emailPassword.length > 0
  const canRequestEmailChange =
    hasUnsavedEmailChanges &&
    !busy &&
    emailPassword.length > 0 &&
    looksLikeEmail(trimmedNewEmail) &&
    trimmedNewEmail.toLowerCase() !== (profile?.email ?? '').toLowerCase()

  const hasUnsavedCloudUnlock = !vaultUnlocked && recovery.trim().length > 0
  const canEnableCloudSync = !busy && recovery.trim().length > 0

  const hasUnsavedChanges = useMemo(() => {
    switch (topic) {
      case 'name':
        return hasUnsavedNameChanges
      case 'password':
        return hasUnsavedPasswordChanges
      case 'email':
        return hasUnsavedEmailChanges
      case 'cloudSync':
        return hasUnsavedCloudUnlock
      default:
        return false
    }
  }, [
    topic,
    hasUnsavedNameChanges,
    hasUnsavedPasswordChanges,
    hasUnsavedEmailChanges,
    hasUnsavedCloudUnlock,
  ])

  useEffect(() => {
    if (!hasUnsavedChanges) return
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [hasUnsavedChanges])

  const resetTopicDraft = (topicId: TopicId) => {
    if (!profile) return
    if (topicId === 'name') {
      setDisplayName(profile.displayName)
      setUsername(profile.username)
    }
    if (topicId === 'password') {
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
    }
    if (topicId === 'email') {
      setEmailPassword('')
      setNewEmail('')
    }
    if (topicId === 'cloudSync') {
      setRecovery('')
      setRememberDevice(true)
    }
  }

  const applyTopic = (nextId: TopicId) => {
    setTopic(nextId)
    setError(null)
    setInfo(null)
    resetTopicDraft(nextId)
    const params = new URLSearchParams(searchParams.toString())
    if (nextId === 'photo') params.delete('topic')
    else params.set('topic', nextId)
    const qs = params.toString()
    router.replace(qs ? `/account/settings?${qs}` : '/account/settings', { scroll: false })
  }

  useEffect(() => {
    if (!isTopicId(topicFromUrl) || topicFromUrl === topic) return
    setTopic(topicFromUrl)
    setError(null)
    setInfo(null)
    resetTopicDraft(topicFromUrl)
    // URL is source of truth for deep links (e.g. pricing → subscription).
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally exclude topic/reset helpers
  }, [topicFromUrl])

  const requestLeave = (next: PendingLeave) => {
    if (hasUnsavedChanges) {
      setPendingLeave(next)
      return
    }
    if (next.type === 'back') {
      router.push('/account')
      return
    }
    applyTopic(next.id)
  }

  const confirmDiscard = () => {
    const next = pendingLeave
    setPendingLeave(null)
    if (!next) return
    resetTopicDraft(topic)
    if (next.type === 'back') {
      router.push('/account')
      return
    }
    applyTopic(next.id)
  }

  const openCropFromFile = (file: File | undefined | null) => {
    if (!file) return
    setError(null)
    setInfo(null)
    const url = URL.createObjectURL(file)
    setCropImageUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev)
      return url
    })
  }

  const closeCropModal = () => {
    setCropImageUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev)
      return null
    })
    if (libraryInputRef.current) libraryInputRef.current.value = ''
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const uploadCroppedAvatar = async (blob: Blob) => {
    if (!profile) return
    setBusy(true)
    setError(null)
    try {
      const { storage } = await ensureUserAccountsFirebase()
      const path = `avatars/${profile.uid}/profile.jpg`
      const storageRef = ref(storage, path)
      await uploadBytes(storageRef, blob, { contentType: 'image/jpeg' })
      const url = await getDownloadURL(storageRef)
      const next = { ...profile, avatarURL: url }
      await saveProfileFields(next)
      await publishLeaderboardIfNeeded({ profile: next, catalogue: [], force: true })
      setInfo('Profile photo updated.')
      noteDiaryChanged()
      closeCropModal()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const lastSynced = useMemo(() => {
    const d = syncStatus.lastSyncedAt
    return d ? d.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : null
  }, [syncStatus.lastSyncedAt])

  const sections = useMemo(
    (): AccountSection[] =>
      TOPICS.map((t) => ({
        id: t.id,
        label: t.title,
        icon: t.icon,
      })),
    []
  )

  const activeTopic = TOPICS.find((t) => t.id === topic) ?? TOPICS[0]

  const subscriptionLoadGen = useRef(0)

  const refreshSubscriptionStatus = useCallback(async () => {
    if (!user) return
    const gen = ++subscriptionLoadGen.current
    setSubscriptionLoading(true)
    setSubscriptionError(null)
    try {
      const token = await user.getIdToken()
      const status = await fetchAccountSubscriptionStatus(token)
      if (gen !== subscriptionLoadGen.current) return
      setSubscription(status)
    } catch (err) {
      if (gen !== subscriptionLoadGen.current) return
      setSubscription(null)
      setSubscriptionError(err instanceof Error ? err.message : String(err))
    } finally {
      if (gen === subscriptionLoadGen.current) {
        setSubscriptionLoading(false)
      }
    }
    if (vaultUnlocked) {
      try {
        const flags = await fetchCloudDevOverrideFlags(user.uid)
        if (gen === subscriptionLoadGen.current) {
          setSubscriptionDevOverrideNote(devOverrideMessageFromPrefs(flags))
        }
      } catch {
        if (gen === subscriptionLoadGen.current) setSubscriptionDevOverrideNote(null)
      }
    }
  }, [user, vaultUnlocked])

  const getSubscriptionIdToken = useCallback(() => user!.getIdToken(), [user])

  useEffect(() => {
    if (topic !== 'subscription' || !user) return
    const gen = ++subscriptionLoadGen.current
    setSubscriptionLoading(true)
    setSubscriptionError(null)
    setSubscriptionDevOverrideNote(null)
    void (async () => {
      try {
        const token = await user.getIdToken()
        const status = await fetchAccountSubscriptionStatus(token)
        if (gen !== subscriptionLoadGen.current) return
        setSubscription(status)
      } catch (err) {
        if (gen !== subscriptionLoadGen.current) return
        setSubscription(null)
        setSubscriptionError(err instanceof Error ? err.message : String(err))
      } finally {
        if (gen === subscriptionLoadGen.current) {
          setSubscriptionLoading(false)
        }
      }
      if (vaultUnlocked) {
        try {
          const flags = await fetchCloudDevOverrideFlags(user.uid)
          if (gen === subscriptionLoadGen.current) {
            setSubscriptionDevOverrideNote(devOverrideMessageFromPrefs(flags))
          }
        } catch {
          if (gen === subscriptionLoadGen.current) setSubscriptionDevOverrideNote(null)
        }
      }
    })()
  }, [topic, user, vaultUnlocked])

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

  return (
    <AccountContentShell
      title="Account Settings"
      actionButton={{
        label: 'Back',
        onClick: (e) => {
          e.preventDefault()
          requestLeave({ type: 'back' })
        },
      }}
      detailsLayout
    >
      <div className="account-page">
        <div
          className="account-layout station-details-layout"
          style={{ ['--station-details-min-section-count' as string]: 8 }}
        >
          <AccountSectionNav
            sections={sections}
            activeSectionId={topic}
            onSelect={(sectionId) => {
              const next = TOPICS.find((t) => t.id === sectionId)
              if (!next || next.id === topic) return
              requestLeave({ type: 'topic', id: next.id })
            }}
            ariaLabel="Account settings"
          />

          <main className="account-main station-details-main">
            <div className="account-card">
              <section className="rs-account-section" aria-labelledby="account-settings-topic-title">
                <h2 id="account-settings-topic-title" className="rs-account-section__title">
                  {activeTopic.title}
                </h2>
                <div className="rs-account-section__body">
                  <p className="rs-account-section__copy">{activeTopic.sub}</p>
                  {error ? <p className="rs-account-error">{error}</p> : null}
                  {info ? <p className="rs-account-info">{info}</p> : null}

                  {topic === 'photo' ? (
                    <div className="rs-account-form-stack">
                      <div className="rs-account-photo-preview">
                        {profile.avatarURL ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={profile.avatarURL}
                            alt=""
                            className="rs-account-avatar rs-account-avatar--lg"
                            width={96}
                            height={96}
                          />
                        ) : (
                          <div
                            className="rs-account-avatar rs-account-avatar--lg rs-account-avatar--placeholder"
                            aria-hidden
                          />
                        )}
                      </div>
                      <input
                        ref={libraryInputRef}
                        type="file"
                        accept="image/*"
                        className="rs-account-file-input"
                        onChange={(e) => {
                          openCropFromFile(e.target.files?.[0])
                          e.target.value = ''
                        }}
                      />
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        className="rs-account-file-input"
                        onChange={(e) => {
                          openCropFromFile(e.target.files?.[0])
                          e.target.value = ''
                        }}
                      />
                      <BUTWideButton
                        type="button"
                        width="fill"
                        colorVariant="accent"
                        disabled={busy}
                        onClick={() => setShowPhotoSource(true)}
                      >
                        {busy ? 'Uploading…' : 'Change photo'}
                      </BUTWideButton>
                      {profile.avatarURL ? (
                        <BUTWideButton
                          type="button"
                          width="fill"
                          colorVariant="red-action"
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
                      <TXTINPBUTWideButton
                        placeholder="Display name"
                        value={displayName}
                        onChange={setDisplayName}
                        colorVariant="primary"
                      />
                      <TXTINPBUTWideButton
                        placeholder="Username"
                        value={username}
                        onChange={setUsername}
                        colorVariant="primary"
                      />
                      <BUTWideButton
                        type="button"
                        width="fill"
                        colorVariant="accent"
                        disabled={!canSaveName}
                        onClick={() => {
                          setBusy(true)
                          setError(null)
                          void updateNameUsername(trimmedDisplayName, normalizeUsername(trimmedUsername))
                            .then(() => setInfo('Saved.'))
                            .catch((e) => setError(e instanceof Error ? e.message : String(e)))
                            .finally(() => setBusy(false))
                        }}
                      >
                        {busy ? 'Saving…' : 'Save'}
                      </BUTWideButton>
                    </div>
                  ) : null}

                  {topic === 'password' ? (
                    <div className="rs-account-form-stack">
                      <TXTINPBUTWideButton
                        placeholder="Current password"
                        type="password"
                        value={currentPassword}
                        onChange={setCurrentPassword}
                        colorVariant="primary"
                      />
                      <TXTINPBUTWideButton
                        placeholder="New password (8+)"
                        type="password"
                        value={newPassword}
                        onChange={setNewPassword}
                        colorVariant="primary"
                      />
                      <TXTINPBUTWideButton
                        placeholder="Confirm new password"
                        type="password"
                        value={confirmPassword}
                        onChange={setConfirmPassword}
                        colorVariant="primary"
                      />
                      {newPassword && confirmPassword && newPassword !== confirmPassword ? (
                        <p className="rs-account-error">New passwords don’t match.</p>
                      ) : null}
                      <BUTWideButton
                        type="button"
                        width="fill"
                        colorVariant="accent"
                        disabled={!canSavePassword}
                        onClick={() => {
                          setBusy(true)
                          setError(null)
                          void changePassword(currentPassword, newPassword)
                            .then(() => {
                              setInfo('Password updated.')
                              setCurrentPassword('')
                              setNewPassword('')
                              setConfirmPassword('')
                            })
                            .catch((e) => setError(e instanceof Error ? e.message : String(e)))
                            .finally(() => setBusy(false))
                        }}
                      >
                        {busy ? 'Updating…' : 'Update password'}
                      </BUTWideButton>
                    </div>
                  ) : null}

                  {topic === 'twoFactor' ? (
                    <div className="rs-account-section__copy-stack">
                      <p className="rs-account-section__meta">
                        Status: {hasTotp ? 'Enabled' : 'Not set up'}
                      </p>
                      <p className="rs-account-section__copy">
                        2-Factor Auth is required for Rail Statistics accounts. To replace your
                        authenticator, re-enrol from a signed-in session on mobile, or contact support
                        if you are locked out.
                      </p>
                      <p className="rs-account-section__meta">
                        <Link href="/account/mfa">Re-open setup (if not enrolled)</Link>
                      </p>
                    </div>
                  ) : null}

                  {topic === 'email' ? (
                    <div className="rs-account-form-stack">
                      <p className="rs-account-section__meta">Current: {profile.email}</p>
                      <p className="rs-account-section__meta">
                        Status: {needsEmailVerify ? 'Not verified' : 'Verified'}
                      </p>
                      {needsEmailVerify ? (
                        <div className="rs-account-section__actions">
                          <BUTWideButton
                            type="button"
                            width="fill"
                            colorVariant="accent"
                            disabled={busy}
                            onClick={() => {
                              setBusy(true)
                              setError(null)
                              void resendVerification()
                                .then(() => setInfo('Verification email sent.'))
                                .catch((e) => setError(e instanceof Error ? e.message : String(e)))
                                .finally(() => setBusy(false))
                            }}
                          >
                            Resend verification
                          </BUTWideButton>
                          <BUTWideButton
                            type="button"
                            width="fill"
                            disabled={busy}
                            onClick={() => {
                              setBusy(true)
                              setError(null)
                              void refreshUser()
                                .then(() => setInfo('Email status refreshed.'))
                                .catch((e) => setError(e instanceof Error ? e.message : String(e)))
                                .finally(() => setBusy(false))
                            }}
                          >
                            Refresh status
                          </BUTWideButton>
                        </div>
                      ) : null}
                      <TXTINPBUTWideButton
                        placeholder="Password"
                        type="password"
                        value={emailPassword}
                        onChange={setEmailPassword}
                        colorVariant="primary"
                      />
                      <TXTINPBUTWideButton
                        placeholder="New email"
                        type="email"
                        value={newEmail}
                        onChange={setNewEmail}
                        colorVariant="primary"
                      />
                      <BUTWideButton
                        type="button"
                        width="fill"
                        colorVariant="accent"
                        disabled={!canRequestEmailChange}
                        onClick={() => {
                          setBusy(true)
                          setError(null)
                          void requestEmailChange(emailPassword, trimmedNewEmail)
                            .then(() => {
                              setInfo('Check your new inbox to confirm the email change.')
                              setEmailPassword('')
                            })
                            .catch((e) => setError(e instanceof Error ? e.message : String(e)))
                            .finally(() => setBusy(false))
                        }}
                      >
                        {busy ? 'Sending…' : 'Send confirmation'}
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
                              leaderboardsEnabledNetworkIDs: optedIn
                                ? []
                                : profile.leaderboardsEnabledNetworkIDs,
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
                                        leaderboardsShowDisplayName:
                                          profile.leaderboardsShowDisplayName,
                                      })
                                    }}
                                  />
                                  <span>{leaderboardNetworkDisplayName(id)}</span>
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
                    vaultUnlocked ? (
                      <div className="rs-account-section__copy-stack">
                        <p className="rs-account-section__copy">
                          Cloud sync is active on this device.
                          {lastSynced ? ` Last synced ${lastSynced}.` : ''}
                          {vaultRememberedOnDevice
                            ? ' This browser unlocks sync automatically after sign-in.'
                            : ''}
                        </p>
                        <div className="rs-account-section__actions">
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
                        </div>
                      </div>
                    ) : (
                      <div className="rs-account-form-stack">
                        <p className="rs-account-section__copy">
                          Enter your recovery key to enable cloud sync on this device.
                        </p>
                        <TXTINPBUTWideButton
                          placeholder="Recovery key"
                          value={recovery}
                          onChange={setRecovery}
                          autoComplete="off"
                          spellCheck={false}
                          colorVariant="primary"
                        />
                        <label className="rs-account-check">
                          <input
                            type="checkbox"
                            checked={rememberDevice}
                            onChange={(e) => setRememberDevice(e.target.checked)}
                          />
                          <span>
                            Remember this device — keep cloud sync unlocked on this browser after
                            sign-in
                          </span>
                        </label>
                        <BUTWideButton
                          type="button"
                          width="fill"
                          colorVariant="accent"
                          disabled={!canEnableCloudSync}
                          onClick={() => {
                            setBusy(true)
                            void unlockVault(recovery, { rememberDevice })
                              .then(() => {
                                setInfo('Cloud sync enabled.')
                                setRecovery('')
                              })
                              .catch((e) => setError(e instanceof Error ? e.message : String(e)))
                              .finally(() => setBusy(false))
                          }}
                        >
                          {busy ? 'Working…' : 'Enable cloud sync'}
                        </BUTWideButton>
                      </div>
                    )
                  ) : null}

                  {topic === 'subscription' ? (
                    <SubscriptionSettingsPanel
                      getIdToken={getSubscriptionIdToken}
                      status={subscription}
                      statusLoading={subscriptionLoading}
                      statusError={subscriptionError}
                      devOverrideNote={subscriptionDevOverrideNote}
                      onStatusRefresh={refreshSubscriptionStatus}
                    />
                  ) : null}
                </div>
              </section>
            </div>
          </main>
        </div>
      </div>

      <ProfilePhotoSourceSheet
        open={showPhotoSource}
        cameraAvailable={cameraAvailable}
        onClose={() => setShowPhotoSource(false)}
        onChooseLibrary={() => libraryInputRef.current?.click()}
        onTakePicture={() => setShowCamera(true)}
        onChooseFile={() => fileInputRef.current?.click()}
      />

      <CameraCaptureModal
        open={showCamera}
        onCancel={() => setShowCamera(false)}
        onCapture={(objectUrl) => {
          setShowCamera(false)
          setCropImageUrl((prev) => {
            if (prev) URL.revokeObjectURL(prev)
            return objectUrl
          })
        }}
      />

      {cropImageUrl ? (
        <ProfilePhotoCropModal
          open
          imageUrl={cropImageUrl}
          busy={busy}
          onCancel={closeCropModal}
          onConfirm={(blob) => void uploadCroppedAvatar(blob)}
        />
      ) : null}

      <AccountConfirmModal
        open={pendingLeave != null}
        title="Unsaved Changes"
        message="Your changes will be lost."
        cancelLabel="Cancel"
        confirmLabel="Discard"
        confirmVariant="red-action"
        onCancel={() => setPendingLeave(null)}
        onConfirm={confirmDiscard}
      />
    </AccountContentShell>
  )
}
