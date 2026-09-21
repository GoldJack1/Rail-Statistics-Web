'use client'

import React, { useEffect, useRef } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Moon, Sun } from '@phosphor-icons/react'
import { useAuth } from '../../../contexts/AuthContext'
import { useStationAdminMode } from '../../../hooks/useStationAdminMode'
import { useIsStationEditor } from '../../../hooks/useIsStationEditor'
import { useTheme } from '../../../hooks/useTheme'
import { isAccountSystemEnabled } from '@/lib/accountSystemConfig'
import { isLocalDevLoginBypassEnabled } from '@/utils/localDevFlags'
import {
  ensureStationAdminModeDefaultOn,
  isStationAdminSearchParam,
  writeStationAdminModeEnabled,
} from '../../../utils/stationAdminModeStorage'
import { BUTFooterLink, TOGToggleVisited } from '../../buttons'
import './Footer.css'

/** Window for successive taps/clicks on the copyright text to open login. */
const LOGIN_TAP_WINDOW_MS = 700

const Footer: React.FC = () => {
  const { user, logout } = useAuth()
  const { isEditor } = useIsStationEditor()
  const { toggleTheme } = useTheme()
  const pathname = usePathname() ?? '/'
  const searchParams = useSearchParams()
  const search = searchParams?.toString() ? `?${searchParams.toString()}` : ''
  const router = useRouter()
  const adminModeActive = useStationAdminMode()
  const loginTapRef = useRef({ count: 0, lastAt: 0 })
  const syncAdminSearchParam =
    pathname === '/stations' ||
    pathname === '/stations/map' ||
    pathname === '/admin/stations' ||
    pathname === '/admin/map'

  useEffect(() => {
    if (isLocalDevLoginBypassEnabled()) {
      ensureStationAdminModeDefaultOn()
    }
  }, [])

  useEffect(() => {
    if (user && isStationAdminSearchParam(search)) {
      writeStationAdminModeEnabled(true)
    }
  }, [user, search])

  const handleAdminModeChange = (nextOn: boolean) => {
    writeStationAdminModeEnabled(nextOn)

    if (!syncAdminSearchParam) return

    const params = new URLSearchParams(searchParams?.toString() ?? '')
    if (nextOn) {
      params.set('admin', '1')
    } else {
      params.delete('admin')
    }
    const query = params.toString()
    router.replace(query.length > 0 ? `${pathname}?${query}` : pathname, { scroll: false })
  }

  /** Counts clicks and touch taps (touch still fires `click`); `event.detail` is unreliable on mobile. */
  const handleCopyrightClick = () => {
    if (user) return
    const now = Date.now()
    const { count, lastAt } = loginTapRef.current
    const nextCount = now - lastAt < LOGIN_TAP_WINDOW_MS ? count + 1 : 1
    if (nextCount >= 3) {
      loginTapRef.current = { count: 0, lastAt: 0 }
      router.push('/log-in')
      return
    }
    loginTapRef.current = { count: nextCount, lastAt: now }
  }

  return (
    <footer className="site-footer app-footer">
      <div className="site-footer-inner">
        <div className="site-footer-primary-row">
          <div className="site-footer-brand">
            <p onClick={handleCopyrightClick}>&copy; {new Date().getFullYear()} Rail Statistics</p>
          </div>
          <div className="site-footer-links site-footer-links--base-row">
            <BUTFooterLink to="/">
              Home
            </BUTFooterLink>
              <BUTFooterLink to="/stations">
                Stations
              </BUTFooterLink>
              <BUTFooterLink to="/fares">
                Fares
              </BUTFooterLink>
              <BUTFooterLink to="/stations/map">
                Maps
              </BUTFooterLink>
              <BUTFooterLink to="/departures">
                Departures
              </BUTFooterLink>
              <BUTFooterLink to="/bash-planner">
                Bash
              </BUTFooterLink>
              <BUTFooterLink to="/units">
                Units
              </BUTFooterLink>
            <BUTFooterLink to="/migration">
              Migration
            </BUTFooterLink>
            {isAccountSystemEnabled ? (
              <BUTFooterLink to="/pricing">
                Pricing
              </BUTFooterLink>
            ) : null}
            <BUTFooterLink to="/privacy">
              Privacy
            </BUTFooterLink>
            <BUTFooterLink to="/eula">
              EULA
            </BUTFooterLink>
          </div>
          <BUTFooterLink onActivate={toggleTheme} className="site-footer-theme-toggle" ariaLabel="Toggle theme">
            <span className="site-footer-theme-toggle__icon site-footer-theme-toggle__icon--sun" aria-hidden>
              <Sun className="site-footer-theme-toggle__glyph site-footer-theme-toggle__glyph--bold" size={16} weight="bold" />
              <Sun className="site-footer-theme-toggle__glyph site-footer-theme-toggle__glyph--fill" size={16} weight="fill" />
            </span>
            <span className="site-footer-theme-toggle__icon site-footer-theme-toggle__icon--moon" aria-hidden>
              <Moon className="site-footer-theme-toggle__glyph site-footer-theme-toggle__glyph--bold" size={16} weight="bold" />
              <Moon className="site-footer-theme-toggle__glyph site-footer-theme-toggle__glyph--fill" size={16} weight="fill" />
            </span>
          </BUTFooterLink>
        </div>
        {isEditor ? (
          <div className="site-footer-secondary-row">
            <div className="site-footer-admin-toggle">
              <span className="site-footer-admin-toggle__label">Admin</span>
              <TOGToggleVisited
                checked={adminModeActive}
                onChange={handleAdminModeChange}
                ariaLabel="Admin mode"
                className="site-footer-admin-toggle__control"
              />
            </div>
            <div className="site-footer-links site-footer-links--logged-in-row">
              <BUTFooterLink to="/admin/messages">
                Messages
              </BUTFooterLink>
              <BUTFooterLink to="/admin/network-messages">
                Network Messages
              </BUTFooterLink>
              <BUTFooterLink to="/admin/d-payg">
                D-PAYG
              </BUTFooterLink>
              <BUTFooterLink to="/admin/api-status">
                API Status
              </BUTFooterLink>
              <BUTFooterLink to="/admin/design-system">
                Design System
              </BUTFooterLink>
              {user ? (
                <BUTFooterLink onActivate={logout} className="site-footer-logout">
                  Log out
                </BUTFooterLink>
              ) : null}
            </div>
          </div>
        ) : user ? (
          <div className="site-footer-secondary-row">
            <div className="site-footer-links site-footer-links--logged-in-row">
              <BUTFooterLink onActivate={logout} className="site-footer-logout">
                Log out
              </BUTFooterLink>
            </div>
          </div>
        ) : null}
      </div>
    </footer>
  )
}

export default Footer
