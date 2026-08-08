'use client'

import React from 'react'
import StationCardSkeleton from '../StationCardSkeleton/StationCardSkeleton'

interface StationsCardGridSkeletonProps {
  count: number
  /** Same ref as the live card grid so column count can be measured while loading. */
  gridRef?: React.Ref<HTMLDivElement>
}

const StationsCardGridSkeleton: React.FC<StationsCardGridSkeletonProps> = ({
  count,
  gridRef,
}) => (
  <div
    ref={gridRef}
    className="stations-page-grid"
    aria-busy="true"
    aria-label="Loading stations"
  >
    {Array.from({ length: count }, (_, index) => (
      <StationCardSkeleton key={`station-card-skeleton-${index}`} />
    ))}
  </div>
)

export default StationsCardGridSkeleton
