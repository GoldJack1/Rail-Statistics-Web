'use client'

import React, { useCallback } from 'react'

import PaygFareLookupClient from '@/components/tickets/PaygFareLookupClient'
import { useStationAdminMode } from '@/hooks/useStationAdminMode'
import {
  getPaygMatrixFare,
  hydratePaygMatrixArea,
  listPaygMatrixAreas,
} from '@/services/paygMatrixCatalog'
import { SMARTCARD_PAYG_AREAS, visiblePaygAreas } from '@/types/paygMatrix'

const SmartcardFaresPageClient: React.FC = () => {
  const isAdminMode = useStationAdminMode()
  const loadAreas = useCallback(
    async () => listPaygMatrixAreas(visiblePaygAreas(SMARTCARD_PAYG_AREAS, isAdminMode)),
    [isAdminMode]
  )

  const hydrateArea = useCallback(
    async (area: { id: string }, collectionId?: string) => {
      const def = SMARTCARD_PAYG_AREAS.find((row) => row.id === area.id)
      if (!def) throw new Error('Unknown smartcard area')
      return hydratePaygMatrixArea(def, collectionId)
    },
    []
  )

  const getFare = useCallback(
    async (area: { id: string }, originCrs: string, destCrs: string, collectionId?: string) => {
      const def = SMARTCARD_PAYG_AREAS.find((row) => row.id === area.id)
      if (!def) return { fare: null }
      const loaded = await getPaygMatrixFare(def, originCrs, destCrs, collectionId)
      if (!loaded) return { fare: null }
      return {
        fare: loaded,
        dailyCapPence: loaded.dailyCapPence,
        weeklyCapPence: loaded.weeklyCapPence,
        originZone: loaded.originZone,
        destZone: loaded.destZone,
      }
    },
    []
  )

  return (
    <PaygFareLookupClient
      basePath="/smartcard-fares"
      hubPath="/fares/smartcards"
      title="Smartcard PAYG"
      subtitle="Look up smartcard PAYG singles and caps."
      areaKind="payg"
      emptyIntro="Enter origin and destination, then tap Find fares to see published singles for this journey."
      loadAreas={loadAreas}
      hydrateArea={hydrateArea}
      getFare={getFare}
    />
  )
}

export default SmartcardFaresPageClient
