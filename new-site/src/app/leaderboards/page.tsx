'use client'

import { useEffect, useMemo, useState } from 'react'
import { User } from '@phosphor-icons/react'
import { BUTTabButton, BUTTwoButtonBar } from '@/components/buttons'
import { AccountContentShell } from '@/components/misc/AccountPageShell/AccountPageShell'
import { useConsumerAuth } from '@/contexts/ConsumerAuthContext'
import {
  fetchLeaderboardEntries,
  type LeaderboardEntry,
} from '@/services/leaderboardService'
import {
  LEADERBOARD_FAIR_NETWORK_IDS,
  leaderboardNetworkDisplayName,
} from '@/services/accountModels'
import '../account/account.css'
import '@/components/cards/NetworkStationTabGroup/NetworkStationTabGroup.css'

const countFormatter = new Intl.NumberFormat('en-GB')
const percentFormatter = new Intl.NumberFormat('en-GB', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
})

function formatCount(value: number): string {
  return countFormatter.format(value)
}

function formatPercent(value: number): string {
  return percentFormatter.format(value)
}

type RankedRow = {
  entry: LeaderboardEntry
  visited: number
  total: number
  percent: number
}

export default function LeaderboardsPage() {
  const { user, loading } = useConsumerAuth()
  const [mode, setMode] = useState<'all' | 'network'>('all')
  const [networkId, setNetworkId] = useState<string>(LEADERBOARD_FAIR_NETWORK_IDS[0]!)
  const [rows, setRows] = useState<LeaderboardEntry[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    setBusy(true)
    setError(null)
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

  const ranked = useMemo((): RankedRow[] => {
    if (mode === 'all') {
      return [...rows]
        .filter((r) => r.showOnAllNetworks)
        .sort((a, b) => b.visitedCountAll - a.visitedCountAll)
        .map((entry) => ({
          entry,
          visited: entry.visitedCountAll,
          total: entry.totalAll,
          percent: entry.percentAll,
        }))
    }
    return [...rows]
      .filter((r) => r.showOnAllNetworks || r.enabledNetworkIDs.includes(networkId))
      .map((entry) => ({
        entry,
        visited: entry.byNetwork[networkId]?.visitedCount ?? 0,
        total: entry.byNetwork[networkId]?.total ?? 0,
        percent: entry.byNetwork[networkId]?.percent ?? 0,
      }))
      .sort((a, b) => b.visited - a.visited)
  }, [rows, mode, networkId])

  return (
    <AccountContentShell
      title="Leaderboards"
      actionButton={{ to: '/account', label: 'Back' }}
    >
      <div className="rs-leaderboard">
        <BUTTwoButtonBar
          className="rs-leaderboard__scope-bar"
          colorVariant="primary"
          selectedIndex={mode === 'all' ? 0 : 1}
          buttons={[
            { label: 'All networks', value: 'all' },
            { label: 'By network', value: 'network' },
          ]}
          onChange={(index) => {
            if (index === 0) setMode('all')
            if (index === 1) setMode('network')
          }}
        />

        {mode === 'network' ? (
          <div
            className="rs-leaderboard__network-tabs network-station-tab-group"
            role="tablist"
            aria-label="Leaderboard network"
          >
            {LEADERBOARD_FAIR_NETWORK_IDS.map((id) => {
              const selected = networkId === id
              return (
                <BUTTabButton
                  key={id}
                  type="button"
                  width="hug"
                  role="tab"
                  instantAction
                  pressed={selected}
                  ariaSelected={selected}
                  colorVariant="primary"
                  onClick={() => setNetworkId(id)}
                >
                  <span className="network-station-tab-group__label">{leaderboardNetworkDisplayName(id)}</span>
                </BUTTabButton>
              )
            })}
          </div>
        ) : null}

        <div className="rs-leaderboard__body">
          {!user && !loading ? (
            <p className="rs-leaderboard__status">Sign in to view leaderboards.</p>
          ) : busy && ranked.length === 0 ? (
            <p className="rs-leaderboard__status">Loading…</p>
          ) : error ? (
            <p className="rs-account-error">{error}</p>
          ) : ranked.length === 0 ? (
            <p className="rs-leaderboard__status">
              No one is on the leaderboard yet. Opt in from Account to appear.
            </p>
          ) : (
            <ol className="rs-leaderboard__list">
              {ranked.map((item, index) => {
                const rank = index + 1
                const { entry, visited, total, percent } = item
                const showName = entry.showDisplayName && Boolean(entry.displayName)
                return (
                  <li key={entry.uid} className="rs-leaderboard-row">
                    <span className="rs-leaderboard-row__rank" aria-label={`Rank ${rank}`}>
                      {rank}
                    </span>
                    {entry.avatarURL ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        className="rs-leaderboard-row__avatar"
                        src={entry.avatarURL}
                        alt=""
                        width={44}
                        height={44}
                      />
                    ) : (
                      <span
                        className="rs-leaderboard-row__avatar rs-leaderboard-row__avatar--placeholder"
                        aria-hidden
                      >
                        <User weight="fill" />
                      </span>
                    )}
                    <div className="rs-leaderboard-row__identity">
                      <p className="rs-leaderboard-row__username">@{entry.username}</p>
                      {showName ? (
                        <p className="rs-leaderboard-row__display-name">{entry.displayName}</p>
                      ) : null}
                    </div>
                    <div className="rs-leaderboard-row__stats">
                      <p className="rs-leaderboard-row__visited">{formatCount(visited)}</p>
                      <p className="rs-leaderboard-row__percent">
                        {formatPercent(percent)}% of {formatCount(total)}
                      </p>
                    </div>
                  </li>
                )
              })}
            </ol>
          )}
        </div>
      </div>
    </AccountContentShell>
  )
}
