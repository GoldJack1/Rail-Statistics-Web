'use client'

import { useEffect, useMemo, useState } from 'react'
import { BUTWideButton } from '@/components/buttons'
import { TextCard } from '@/components/cards'
import { AccountContentShell } from '@/components/misc/AccountPageShell/AccountPageShell'
import { useConsumerAuth } from '@/contexts/ConsumerAuthContext'
import {
  fetchLeaderboardEntries,
  publishLeaderboardIfNeeded,
  type LeaderboardEntry,
} from '@/services/leaderboardService'
import { LEADERBOARD_FAIR_NETWORK_IDS } from '@/services/accountModels'
import { getMergedNetworkStations } from '@/services/stationsDataService'
import '../account/account.css'

export default function LeaderboardsPage() {
  const { user, profile, vaultUnlocked, loading } = useConsumerAuth()
  const [mode, setMode] = useState<'all' | 'network'>('all')
  const [networkId, setNetworkId] = useState<string>(LEADERBOARD_FAIR_NETWORK_IDS[0]!)
  const [rows, setRows] = useState<LeaderboardEntry[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    setBusy(true)
    void fetchLeaderboardEntries(mode)
      .then((data) => {
        if (!cancelled) setRows(data)
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      })
      .finally(() => {
        if (!cancelled) setBusy(false)
      })
    return () => {
      cancelled = true
    }
  }, [mode])

  const ranked = useMemo(() => {
    if (mode === 'all') {
      return [...rows]
        .filter((r) => r.showOnAllNetworks)
        .sort((a, b) => b.visitedCountAll - a.visitedCountAll)
    }
    return [...rows]
      .filter((r) => r.showOnAllNetworks || r.enabledNetworkIDs.includes(networkId))
      .map((r) => ({
        row: r,
        visited: r.byNetwork[networkId]?.visitedCount ?? 0,
        total: r.byNetwork[networkId]?.total ?? 0,
        percent: r.byNetwork[networkId]?.percent ?? 0,
      }))
      .sort((a, b) => b.visited - a.visited)
  }, [rows, mode, networkId])

  return (
    <AccountContentShell
      title="Leaderboards"
      subtitle="Visited counts only. @username is always shown; display name is optional."
      actionButton={{ to: '/account', label: 'Back' }}
      narrow={false}
    >
      <div className="rs-leaderboard-tabs">
        <BUTWideButton
          type="button"
          width="hug"
          colorVariant={mode === 'all' ? 'accent' : 'primary'}
          onClick={() => setMode('all')}
        >
          All networks
        </BUTWideButton>
        <BUTWideButton
          type="button"
          width="hug"
          colorVariant={mode === 'network' ? 'accent' : 'primary'}
          onClick={() => setMode('network')}
        >
          By network
        </BUTWideButton>
      </div>

      {mode === 'network' ? (
        <div className="rs-leaderboard-tabs">
          {LEADERBOARD_FAIR_NETWORK_IDS.map((id) => (
            <BUTWideButton
              key={id}
              type="button"
              width="hug"
              colorVariant={networkId === id ? 'accent' : 'primary'}
              onClick={() => setNetworkId(id)}
            >
              {id}
            </BUTWideButton>
          ))}
        </div>
      ) : null}

      {user && profile && vaultUnlocked ? (
        <BUTWideButton
          type="button"
          width="fill"
          disabled={busy}
          onClick={() => {
            setBusy(true)
            const catalogue = getMergedNetworkStations('list').map((s) => ({
              id: s.id,
              stnarea: s.stnarea ?? '',
            }))
            void publishLeaderboardIfNeeded({ profile, catalogue, force: true })
              .then(() => fetchLeaderboardEntries(mode))
              .then(setRows)
              .catch((e) => setError(e instanceof Error ? e.message : String(e)))
              .finally(() => setBusy(false))
          }}
        >
          Publish my stats now
        </BUTWideButton>
      ) : (
        <TextCard
          static
          title="Publish your stats"
          description={
            loading
              ? 'Loading…'
              : 'Sign in and enable cloud sync to publish your visited counts.'
          }
        />
      )}

      {error ? <p className="rs-account-error">{error}</p> : null}
      {busy && !ranked.length ? <p className="rs-account-info">Loading boards…</p> : null}

      {mode === 'all'
        ? (ranked as LeaderboardEntry[]).map((r, i) => (
            <TextCard
              key={r.uid}
              static
              title={`#${i + 1} · @${r.username}`}
              description={
                <>
                  {r.showDisplayName && r.displayName ? `${r.displayName} · ` : null}
                  {r.visitedCountAll} visited · {r.percentAll}% of {r.totalAll}
                </>
              }
              trailingIcon={
                r.avatarURL ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img className="rs-leaderboard-row__avatar" src={r.avatarURL} alt="" />
                ) : (
                  <span className="rs-leaderboard-row__avatar" aria-hidden />
                )
              }
            />
          ))
        : (
            ranked as Array<{
              row: LeaderboardEntry
              visited: number
              total: number
              percent: number
            }>
          ).map((item, i) => (
            <TextCard
              key={item.row.uid}
              static
              title={`#${i + 1} · @${item.row.username}`}
              description={
                <>
                  {item.row.showDisplayName && item.row.displayName
                    ? `${item.row.displayName} · `
                    : null}
                  {item.visited} visited · {item.percent}% of {item.total}
                </>
              }
              trailingIcon={
                item.row.avatarURL ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img className="rs-leaderboard-row__avatar" src={item.row.avatarURL} alt="" />
                ) : (
                  <span className="rs-leaderboard-row__avatar" aria-hidden />
                )
              }
            />
          ))}

      {!busy && ranked.length === 0 ? (
        <TextCard static title="No entries yet" description="Be the first to publish visited counts." />
      ) : null}
    </AccountContentShell>
  )
}
