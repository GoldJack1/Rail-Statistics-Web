'use client'

import React from 'react'
import { stationDetailsSubsectionId } from '@/utils/stationDetailsTabSubheaders'
import { TextSkeletonLine } from '@/components/misc/Skeleton/TextSkeletonLine'

interface StationDetailsSubsectionProps {
  title: string
  children: React.ReactNode
  className?: string
  skeleton?: boolean
}

export function StationDetailsSubsection({
  title,
  children,
  className,
  skeleton = false,
}: StationDetailsSubsectionProps) {
  return (
    <div
      id={stationDetailsSubsectionId(title)}
      className={['station-details-subsection', className].filter(Boolean).join(' ')}
    >
      <h4 className="station-details-subsection__title">
        {skeleton ? <TextSkeletonLine>{title}</TextSkeletonLine> : title}
      </h4>
      {children}
    </div>
  )
}

export default StationDetailsSubsection
