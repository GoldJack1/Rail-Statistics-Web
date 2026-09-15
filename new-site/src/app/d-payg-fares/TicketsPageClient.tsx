'use client'

import React, { useCallback } from 'react'

import PaygFareLookupClient from '@/components/tickets/PaygFareLookupClient'
import { getFareForOd, listSchemes } from '@/services/dpaygSchemes'

const loadDpaygAreas = async () => {
  const rows = await listSchemes()
  const trials = rows.filter((s) => s.status === 'trial' || rows.length <= 3)
  return trials.length > 0 ? trials : rows
}

const TicketsPageClient: React.FC = () => {
  const getFare = useCallback(async (area: { id: string }, originCrs: string, destCrs: string) => {
    const fare = await getFareForOd(area.id, originCrs, destCrs)
    return { fare }
  }, [])

  return (
    <PaygFareLookupClient
      basePath="/d-payg-fares"
      hubPath="/fares/d-payg"
      title="D-PAYG Fares"
      subtitle="Look up Digital PAYG trial singles and caps."
      areaKind="trial"
      emptyIntro="Enter origin and destination, then tap Find fares to see published singles for this journey."
      loadAreas={loadDpaygAreas}
      getFare={getFare}
    />
  )
}

export default TicketsPageClient
