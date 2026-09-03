'use client'

import React, { useCallback, useEffect, useId, useState } from 'react'
import { usePathname } from 'next/navigation'
import { useAppHeaderOffset } from '@/hooks/useAppHeaderOffset'
import { resolveAppDownloadAction } from '@/utils/appDownload'
import { BUTBaseButton, BUTHeaderLink, BUTWideButton } from '../../buttons'
import HomeDownloadPlatformModal from '../../models/HomeDownloadPlatformModal/HomeDownloadPlatformModal'
import {
  MobileHeaderPanel,
  MobileHeaderTitle,
  MobileHeaderToggle,
  type MobileHeaderNavItem,
} from './MobileHeader'
import './Header.css'

/** Title shown next to the logo on narrow viewports (main nav items stay in the hamburger). */
function getHeaderPageTitle(pathname: string): string {
  if (pathname === '/' || pathname === '/home') return 'Home'
  if (pathname === '/migration') return 'Migration'
  if (pathname === '/log-in') return 'Log in'
  if (pathname === '/privacy') return 'Privacy Policy'
  if (pathname === '/eula') return 'EULA'
  if (pathname === '/buttons') return 'Buttons'
  if (pathname.startsWith('/admin/stations/new')) return 'New station'
  if (pathname.startsWith('/admin/stations/pending-review')) return 'Pending review'
  if (pathname === '/stations/map') return 'Maps'
  if (pathname.startsWith('/stations/')) return 'Station'
  if (pathname === '/stations') return 'Stations'
  if (pathname === '/d-payg-fares' || pathname === '/tickets') return 'D-PAYG Fares'
  if (pathname.startsWith('/admin/design-system/colours')) return 'Colours'
  if (pathname.startsWith('/admin/design-system/typography')) return 'Typography'
  if (pathname.startsWith('/admin/design-system/buttons')) return 'Buttons'
  if (pathname.startsWith('/admin/design-system/layout')) return 'Layout'
  if (pathname.startsWith('/admin/design-system/components')) return 'Components'
  if (pathname.startsWith('/admin/design-system/icons')) return 'Icons'
  if (pathname.startsWith('/admin/design-system/heros')) return 'Heros'
  if (pathname.startsWith('/admin/design-system')) return 'Design system'
  if (pathname.startsWith('/admin/stations')) return 'Stations'
  if (pathname.startsWith('/admin/messages')) return 'Messages'
  if (pathname.startsWith('/admin/network-messages')) return 'Network Messages'
  if (pathname.startsWith('/admin/d-payg')) return 'D-PAYG'
  if (pathname.startsWith('/units')) return 'Units'
  if (pathname.startsWith('/admin/api-status')) return 'API Status'
  return 'Rail Statistics'
}

const Header: React.FC = () => {
  const pathname = usePathname() ?? '/'
  const mobileNavId = useId()
  /** Don’t stack “log-in → migration” in history, or browser Back from migration returns to login. */
  const logoNavReplace = pathname === '/log-in'

  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [downloadModalOpen, setDownloadModalOpen] = useState(false)
  const headerRef = useAppHeaderOffset<HTMLElement>(mobileMenuOpen)

  const isHomeActive = pathname === '/' || pathname === '/home'
  const isStationsActive = pathname === '/stations' || pathname.startsWith('/admin/stations')
  const isDpaygFaresActive = pathname === '/d-payg-fares' || pathname === '/tickets'
  const isMapActive = pathname === '/stations/map' || pathname === '/admin/map'

  const pageTitle = getHeaderPageTitle(pathname)

  const navItems: MobileHeaderNavItem[] = [
    { to: '/', label: 'Home', active: isHomeActive },
    { to: '/stations', label: 'Stations', active: isStationsActive && !isMapActive },
    { to: '/d-payg-fares', label: 'D-PAYG Fares', active: isDpaygFaresActive },
    { to: '/stations/map', label: 'Maps', active: isMapActive },
  ]

  const onDownloadApp = useCallback(() => {
    const action = resolveAppDownloadAction()
    if (action.type === 'redirect') {
      window.location.href = action.url
      return
    }
    setDownloadModalOpen(true)
    setMobileMenuOpen(false)
  }, [])

  useEffect(() => {
    setMobileMenuOpen(false)
  }, [pathname])

  useEffect(() => {
    if (!mobileMenuOpen) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMobileMenuOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [mobileMenuOpen])

  const closeMobileMenu = () => setMobileMenuOpen(false)

  return (
    <header
      ref={headerRef}
      className={`universal-header${mobileMenuOpen ? ' universal-header--menu-open' : ''}`}
    >
      {/*
        iOS Safari (esp. 26+ “Liquid Glass”): in-tab chrome tint is derived from fixed
        elements with a solid background-color near the top — not theme-color. A plain strip
        under the real header avoids backdrop-filter sampling a black/wrong tone.
        https://github.com/andesco/safari-color-tinting
      */}
      <div className="safari-toolbar-tint" aria-hidden="true" />
      <div className="header-inner">
        <div className="header-container">
          <div className="header-left">
            <BUTHeaderLink
              to="/"
              replace={logoNavReplace}
              className="logo-link logo-link--full"
              ariaLabel="Rail Statistics home"
            >
              <div className="logo">
                <span className="logo-text">Rail Statistics</span>
              </div>
            </BUTHeaderLink>
            <MobileHeaderTitle pageTitle={pageTitle} logoNavReplace={logoNavReplace} />
          </div>

          <div className="header-right">
            <nav className="header-nav header-nav--desktop" aria-label="Main">
              <div className="header-nav-links">
                {navItems.map(({ to, label, active }) => (
                  <BUTHeaderLink key={to} to={to} active={active}>
                    <span className="header-nav-link__label">{label}</span>
                  </BUTHeaderLink>
                ))}
              </div>
            </nav>
            <BUTWideButton
              type="button"
              width="hug"
              colorVariant="accent"
              className="header-download-app-button header-download-app-button--desktop"
              onClick={onDownloadApp}
            >
              Download app
            </BUTWideButton>
            <MobileHeaderToggle
              menuOpen={mobileMenuOpen}
              navId={mobileNavId}
              onMenuOpenChange={setMobileMenuOpen}
            />
          </div>
        </div>

        <MobileHeaderPanel menuOpen={mobileMenuOpen} navId={mobileNavId} onClose={closeMobileMenu}>
          <nav className="header-nav header-nav--mobile" aria-label="Main">
            <ul className="header-mobile-nav-list">
              {navItems.map(({ to, label, active }) => (
                <li key={to}>
                  <BUTHeaderLink to={to} active={active} onClick={closeMobileMenu}>
                    <span className="header-nav-link__label">{label}</span>
                  </BUTHeaderLink>
                </li>
              ))}
              <li className="header-mobile-nav-list__download">
                <BUTBaseButton
                  type="button"
                  variant="wide"
                  shape="squared"
                  width="fill"
                  colorVariant="accent"
                  className="header-download-app-button--menu"
                  onClick={onDownloadApp}
                >
                  Download app
                </BUTBaseButton>
              </li>
            </ul>
          </nav>
        </MobileHeaderPanel>
      </div>

      <HomeDownloadPlatformModal
        open={downloadModalOpen}
        onClose={() => setDownloadModalOpen(false)}
      />
    </header>
  )
}

export default Header
