'use client'

import { useCallback, useState } from 'react'
import './home.css'
import HomeDownloadPlatformModal from '@/components/models/HomeDownloadPlatformModal/HomeDownloadPlatformModal'
import { resolveAppDownloadAction } from '@/utils/appDownload'
import HomeHeroImagePreloader from './home/HomeHeroImagePreloader'
import Hero1DownloadSplash from './home/sections/Hero1DownloadSplash'
import HeroNewestStations from './home/sections/HeroNewestStations'
import HeroUpcomingStations from './home/sections/HeroUpcomingStations'
import HeroNotifications from './home/sections/HeroNotifications'
import Hero3StationDetail from './home/sections/Hero3StationDetail'
import HeroMapHybrid from './home/sections/HeroMapHybrid'
import Hero5SearchFilter from './home/sections/Hero5SearchFilter'
import HeroVisitsFavourites from './home/sections/HeroVisitsFavourites'
import Hero7Subscription from './home/sections/Hero7Subscription'
import Hero8ClosingDownload from './home/sections/Hero8ClosingDownload'
import Hero9Migrate from './home/sections/Hero9Migrate'
import { isAccountSystemEnabled } from '@/lib/accountSystemConfig'

export default function HomePage() {
  const [downloadModalOpen, setDownloadModalOpen] = useState(false)

  const onDownloadCta = useCallback(() => {
    const action = resolveAppDownloadAction()
    if (action.type === 'redirect') {
      window.location.href = action.url
      return
    }
    setDownloadModalOpen(true)
  }, [])

  return (
    <div className="container">
      <div className="main">
        <Hero1DownloadSplash onDownloadCta={onDownloadCta} />
        <HomeHeroImagePreloader />

        <HomeDownloadPlatformModal open={downloadModalOpen} onClose={() => setDownloadModalOpen(false)} />

        <HeroNewestStations />
        <HeroUpcomingStations />
        <HeroNotifications onDownloadCta={onDownloadCta} />
        <Hero3StationDetail />
        <HeroMapHybrid onDownloadCta={onDownloadCta} />
        <Hero5SearchFilter />
        <HeroVisitsFavourites onDownloadCta={onDownloadCta} />
        {isAccountSystemEnabled ? <Hero7Subscription /> : null}
        <Hero8ClosingDownload onDownloadCta={onDownloadCta} />
        <Hero9Migrate />
      </div>
    </div>
  )
}
