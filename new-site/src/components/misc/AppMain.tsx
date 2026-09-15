'use client'

import { usePathname } from 'next/navigation'

/**
 * Adds `app-main--stations-layout` for routes that fill the main column down to
 * the footer (and manage their own scroll where needed).
 */
export default function AppMain({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const fillsMainColumn =
    pathname.startsWith('/admin/stations') ||
    pathname === '/stations' ||
    pathname.startsWith('/stations/') ||
    pathname === '/d-payg-fares' ||
    pathname.startsWith('/d-payg-fares/') ||
    pathname === '/fares' ||
    pathname.startsWith('/fares/') ||
    pathname === '/contactless-fares' ||
    pathname.startsWith('/contactless-fares/') ||
    pathname === '/smartcard-fares' ||
    pathname.startsWith('/smartcard-fares/') ||
    pathname === '/account' ||
    pathname.startsWith('/account/') ||
    pathname === '/leaderboards' ||
    pathname.startsWith('/leaderboards/')

  return (
    <main className={`main-content app-main${fillsMainColumn ? ' app-main--stations-layout' : ''}`}>
      {children}
    </main>
  )
}
