'use client'

import { usePathname } from 'next/navigation'

/**
 * Mirrors the old `App.tsx` logic that added `app-main--stations-layout` for
 * stations browse/map/detail (and D-PAYG fares) routes so those pages can fill
 * the main column down to the footer (and manage their own scroll where needed).
 */
export default function AppMain({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const isStationsLayout =
    pathname.startsWith('/admin/stations') ||
    pathname === '/stations' ||
    pathname.startsWith('/stations/') ||
    pathname === '/d-payg-fares' ||
    pathname.startsWith('/d-payg-fares/')

  return (
    <main className={`main-content app-main${isStationsLayout ? ' app-main--stations-layout' : ''}`}>
      {children}
    </main>
  )
}
