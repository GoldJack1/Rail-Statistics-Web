'use client'

import { useRouter } from 'next/navigation'
import React, { useCallback, useEffect, useState } from 'react'

import { TextCard } from '@/components/cards'
import { PageTopHeader } from '@/components/misc'
import { listSchemes, type DPAYGSchemeListItem } from '@/services/dpaygSchemes'
import './DpaygAdminPage.css'

const pricingLabel = (model: DPAYGSchemeListItem['pricingModel']): string =>
  model === 'dynamic' ? 'Dynamic (manual prices)' : 'Fixed table'

const schemeDescription = (scheme: DPAYGSchemeListItem): string => {
  const parts = [
    scheme.operatorBrand,
    `${scheme.stations.length} stations`,
    `${scheme.fareCount} fares`,
    pricingLabel(scheme.pricingModel)
  ].filter((part) => Boolean(part && String(part).trim()))
  return parts.join(' · ')
}

const DpaygSchemesListPage: React.FC = () => {
  const router = useRouter()
  const [rows, setRows] = useState<DPAYGSchemeListItem[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const schemes = await listSchemes()
      setRows(schemes)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load D-PAYG schemes.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="dpayg-admin-page-shell">
      <PageTopHeader title="D-PAYG" subtitle="Edit trial schemes and fare tables" />
      <div className="dpayg-admin-page">
        {error ? (
          <p className="dpayg-banner dpayg-banner--error" role="alert">
            {error}
          </p>
        ) : null}
        {loading ? <p className="dpayg-muted">Loading schemes…</p> : null}
        {!loading && rows.length === 0 && !error ? (
          <p className="dpayg-muted">No D-PAYG schemes found in railstatisticstickets.</p>
        ) : null}

        <div className="dpayg-scheme-list">
          {rows.map((scheme) => (
            <TextCard
              key={scheme.id}
              title={scheme.shortName || scheme.name || scheme.id}
              description={schemeDescription(scheme)}
              onClick={() => router.push(`/admin/d-payg/${scheme.id}`)}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

export default DpaygSchemesListPage
