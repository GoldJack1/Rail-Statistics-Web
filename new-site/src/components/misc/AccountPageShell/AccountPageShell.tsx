'use client'

import type { ReactNode } from 'react'
import { PageTopHeader } from '@/components/misc'

type ActionButton = {
  to?: string
  onClick?: React.MouseEventHandler<HTMLButtonElement | HTMLAnchorElement>
  label?: string
}

/** Auth flows (sign-in / sign-up / MFA / verify) — matches staff /log-in card layout. */
export function AccountAuthShell({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="rs-account-auth">
      <div className="rs-account-auth__card">
        <h1 className="rs-account-auth__title">{title}</h1>
        {subtitle ? <p className="rs-account-auth__subtitle">{subtitle}</p> : null}
        {children}
      </div>
    </div>
  )
}

/**
 * Hub / settings / leaderboards — full-bleed PageTopHeader, then content.
 * `panel` wraps children in the rounded account card (dashboard style).
 * `detailsLayout` uses the station-details left-panel chrome (no padded body stack).
 */
export function AccountContentShell({
  title,
  subtitle,
  actionButton,
  trailingContent,
  children,
  narrow = true,
  panel = false,
  detailsLayout = false,
}: {
  title: ReactNode
  subtitle?: ReactNode
  actionButton?: ActionButton
  /** Top-right slot (e.g. desktop banner ad). */
  trailingContent?: ReactNode
  children: ReactNode
  /** Constrain body to a readable column (default). */
  narrow?: boolean
  /** Rounded secondary card surface (account dashboard). */
  panel?: boolean
  /** Station-details-style full-bleed layout (left panel + main). */
  detailsLayout?: boolean
}) {
  return (
    <div
      className={[
        'rs-account-page-shell',
        detailsLayout ? 'rs-account-page-shell--details' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <PageTopHeader
        className="rs-account-page-header"
        title={title}
        subtitle={subtitle}
        actionButton={actionButton}
        trailingContent={trailingContent}
      />
      {detailsLayout ? (
        children
      ) : (
        <div className="rs-account-body">
          <div
            className={['rs-account-stack', narrow ? 'rs-account-stack--narrow' : '']
              .filter(Boolean)
              .join(' ')}
          >
            {panel ? <div className="rs-account-panel">{children}</div> : children}
          </div>
        </div>
      )}
    </div>
  )
}

