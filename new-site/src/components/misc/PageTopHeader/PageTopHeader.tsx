'use client'

import React from 'react'
import { BackIcon } from '@/components/icons'
import { BUTLeftIconWideButton, BUTWideButton } from '../../buttons'
import './PageTopHeader.css'

type ActionButtonMode = 'text' | 'iconText' | 'icon'

interface PageTopHeaderActionButton {
  to?: string
  onClick?: React.MouseEventHandler<HTMLButtonElement | HTMLAnchorElement>
  label?: string
  mode?: ActionButtonMode
  icon?: React.ReactNode
  iconPosition?: 'left' | 'right'
  ariaLabel?: string
  className?: string
}

interface PageTopHeaderProps {
  title: React.ReactNode
  subtitle?: React.ReactNode
  titleAddon?: React.ReactNode
  /** Small label rendered above the title (e.g. TOC). */
  eyebrow?: React.ReactNode
  /** Content rendered below the subtitle (e.g. TOC chips). */
  subtitleAddon?: React.ReactNode
  className?: string
  innerClassName?: string
  actionButton?: PageTopHeaderActionButton
  actionContent?: React.ReactNode
  /** Top-right slot (e.g. desktop banner ad). Kept outside the title copy column. */
  trailingContent?: React.ReactNode
}

const PageTopHeader: React.FC<PageTopHeaderProps> = ({
  title,
  subtitle,
  titleAddon,
  eyebrow,
  subtitleAddon,
  className = '',
  innerClassName = '',
  actionButton,
  actionContent,
  trailingContent,
}) => {
  const headerClassName = ['rs-page-top-header', className].filter(Boolean).join(' ')
  const innerClassNameCombined = [
    'rs-page-top-header__inner',
    trailingContent ? 'rs-page-top-header__inner--with-trailing' : '',
    innerClassName,
  ]
    .filter(Boolean)
    .join(' ')
  const buttonLabel = actionButton?.label ?? 'Back'
  const buttonMode = actionButton?.mode ?? (actionButton ? 'iconText' : 'text')
  const buttonIcon = actionButton?.icon ?? (buttonMode !== 'text' ? <BackIcon /> : undefined)
  const buttonChildren = buttonMode === 'icon' ? undefined : buttonLabel
  const shouldUseIconButton = buttonMode !== 'text' && Boolean(buttonIcon)

  return (
    <header className={headerClassName}>
      <div className={innerClassNameCombined}>
        <div className="rs-page-top-header__copy">
          {eyebrow ? <div className="rs-page-top-header__eyebrow">{eyebrow}</div> : null}
          <h1 className="rs-page-top-header__title">
            <span className="rs-page-top-header__title-text">{title}</span>
            {titleAddon}
          </h1>
          {subtitle ? <p className="rs-page-top-header__subtitle">{subtitle}</p> : null}
          {subtitleAddon ? (
            <div className="rs-page-top-header__subtitle-addon">{subtitleAddon}</div>
          ) : null}
          {actionButton ? (
            shouldUseIconButton ? (
              <BUTLeftIconWideButton
                to={actionButton.to}
                onClick={actionButton.onClick}
                width="hug"
                className={['rs-page-top-header__action', actionButton.className].filter(Boolean).join(' ')}
                icon={buttonIcon}
                ariaLabel={actionButton.ariaLabel ?? (buttonMode === 'icon' ? buttonLabel : undefined)}
              >
                {buttonChildren}
              </BUTLeftIconWideButton>
            ) : (
              <BUTWideButton
                to={actionButton.to}
                onClick={actionButton.onClick}
                width="hug"
                className={['rs-page-top-header__action', actionButton.className].filter(Boolean).join(' ')}
                ariaLabel={actionButton.ariaLabel ?? (buttonMode === 'icon' ? buttonLabel : undefined)}
              >
                {buttonChildren}
              </BUTWideButton>
            )
          ) : null}
          {actionContent ? (
            <div className="rs-page-top-header__actions-row">
              {actionContent}
            </div>
          ) : null}
        </div>
        {trailingContent ? (
          <div className="rs-page-top-header__trailing">{trailingContent}</div>
        ) : null}
      </div>
    </header>
  )
}

export default PageTopHeader
