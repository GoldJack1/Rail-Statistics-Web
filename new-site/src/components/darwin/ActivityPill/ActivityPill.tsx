'use client'

import React from 'react'
import { decodeActivity, importantActivities, type DarwinActivity } from '../../../utils/darwinActivity'
import './ActivityPill.css'

/**
 * Compact pill rendering one or more decoded Darwin activity codes for a stop.
 * By default only the *important* codes (set-down only, pick-up only, request
 * stop, reversing, etc.) are shown — the trivial "T", "TB", "TF" tokens are
 * suppressed because they're already implied by the stop marker style.
 *
 * Pass `showAll` to include every code (useful for the future "operations
 * audit" view).
 */
export const ActivityPill: React.FC<{
  activity: string | null | undefined
  showAll?: boolean
  className?: string
}> = ({ activity, showAll, className }) => {
  const tokens: DarwinActivity[] = showAll ? decodeActivity(activity) : importantActivities(activity)
  if (tokens.length === 0) return null
  return (
    <span className={['act-pill-row act-pill-row--text', className].filter(Boolean).join(' ')}>
      {tokens.map((t, i) => (
        <span
          key={`${t.code}-${i}`}
          className="act-note"
          title={`Darwin activity code: ${t.code}`}
        >
          ({t.label})
        </span>
      ))}
    </span>
  )
}

export default ActivityPill
