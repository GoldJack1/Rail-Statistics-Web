'use client'

import React, { useEffect, useState } from 'react'
import { X } from '@phosphor-icons/react'

import TextCard from '@/components/cards/TextCard/TextCard'
import type { TextCardState } from '@/components/cards/TextCard/TextCard'
import type { StationMessage } from '../../../types/darwin'
import '@/components/stations/NetworkMessageAlertBanner.css'
import './StationMessages.css'

const COLLAPSE_THRESHOLD = 2
const DISMISSED_KEY = 'rs.darwin.dismissedMessages'
const STATUS_DISRUPTIONS_BOILERPLATE_RE =
  /(?:^|\s)Latest information can be found in\s*\.?\s*Status and Disruptions\.?/gi
const PROMOTE_TO_MAJOR_RE =
  /\b(unable to run|no trains(?: are)? running|line (?:is )?closed|service(?:s)? suspended)\b/i

/** Match http(s) URLs and bare www. hosts for linkification. */
const URL_IN_TEXT_RE =
  /\b((?:https?:\/\/|www\.)[^\s<]+[^\s<.,;:!?)\]'"])/gi

function readDismissed(): Set<string> {
  try {
    const raw = window.localStorage.getItem(DISMISSED_KEY)
    if (!raw) return new Set()
    const parsed = JSON.parse(raw)
    return new Set(Array.isArray(parsed) ? parsed.map(String) : [])
  } catch {
    return new Set()
  }
}

function writeDismissed(ids: Set<string>): void {
  try {
    window.localStorage.setItem(DISMISSED_KEY, JSON.stringify([...ids]))
  } catch {}
}

function sanitizeMessageText(text: string): string {
  return text
    .replace(STATUS_DISRUPTIONS_BOILERPLATE_RE, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

function deriveDisplaySeverity(message: StationMessage): number {
  const feedSeverity = Math.max(0, Math.min(3, Math.floor(message.severity || 0)))
  if (feedSeverity >= 2) return feedSeverity
  if (PROMOTE_TO_MAJOR_RE.test(message.plainMessage || '')) return 2
  return feedSeverity
}

/** Darwin OW 0–3 → same TextCard colours as network-message priorities. */
function textCardStateForSeverity(severity: number): TextCardState {
  if (severity >= 3) return 'redAction'
  if (severity === 2) return 'accent'
  if (severity === 1) return 'favAction'
  return 'default'
}

function hrefForMatchedUrl(raw: string): string {
  const trimmed = raw.trim()
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  return `https://${trimmed}`
}

function linkifyText(text: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = []
  let lastIndex = 0
  const re = new RegExp(URL_IN_TEXT_RE.source, URL_IN_TEXT_RE.flags)
  let match: RegExpExecArray | null
  while ((match = re.exec(text)) !== null) {
    const start = match.index
    const raw = match[1] ?? match[0]
    if (start > lastIndex) {
      nodes.push(text.slice(lastIndex, start))
    }
    const href = hrefForMatchedUrl(raw)
    nodes.push(
      <a
        key={`link-${start}-${raw}`}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="network-message-alert-banner__link"
      >
        {raw}
      </a>
    )
    lastIndex = start + raw.length
  }
  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex))
  }
  return nodes.length > 0 ? nodes : [text]
}

export const StationMessages: React.FC<{
  messages: StationMessage[]
  /** When provided, dismissed-id state is scoped under this key as well, so
   * dismissals at one CRS don't suppress at others (rare, but cleaner). */
  scope?: string
}> = ({ messages }) => {
  const [dismissed, setDismissed] = useState<Set<string>>(() => readDismissed())
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    setDismissed(readDismissed())
  }, [messages])

  if (!messages || messages.length === 0) return null

  const visible = messages
    .filter((m) => !dismissed.has(m.id) && m.plainMessage)
    .map((m) => ({ ...m, plainMessage: sanitizeMessageText(m.plainMessage) }))
    .filter((m) => m.plainMessage.length >= 3)
  if (visible.length === 0) return null

  const showAll = expanded || visible.length <= COLLAPSE_THRESHOLD
  const shown = showAll ? visible : visible.slice(0, COLLAPSE_THRESHOLD)
  const hiddenCount = visible.length - shown.length

  function dismiss(id: string) {
    const next = new Set(dismissed)
    next.add(id)
    writeDismissed(next)
    setDismissed(next)
  }

  return (
    <div className="network-message-alert-banner dep-station-messages" role="region" aria-label="Station messages">
      {shown.map((m) => {
        const sev = deriveDisplaySeverity(m)
        return (
          <div
            key={m.id}
            className={`network-message-alert-banner__item network-message-alert-banner__item--priority-${
              sev >= 3 ? 1 : sev === 2 ? 2 : sev === 1 ? 3 : 4
            }`}
          >
            <TextCard
              static
              title=""
              description={(
                <span className="network-message-alert-banner__description">
                  <span className="network-message-alert-banner__paragraphs">
                    <span className="network-message-alert-banner__paragraph">
                      <span className="network-message-alert-banner__paragraph-text">
                        {linkifyText(m.plainMessage)}
                      </span>
                    </span>
                  </span>
                </span>
              )}
              state={textCardStateForSeverity(sev)}
              trailingIcon={(
                <button
                  type="button"
                  className="dep-station-messages__dismiss"
                  aria-label="Dismiss message"
                  onClick={() => dismiss(m.id)}
                >
                  <X size={16} weight="bold" aria-hidden />
                </button>
              )}
              className="network-message-alert-banner__card"
              ariaLabel={m.plainMessage}
            />
          </div>
        )
      })}
      {hiddenCount > 0 && (
        <button
          type="button"
          className="network-message-alert-banner__toggle"
          onClick={() => setExpanded(true)}
        >
          Show {hiddenCount} more message{hiddenCount === 1 ? '' : 's'}
        </button>
      )}
    </div>
  )
}

export default StationMessages
