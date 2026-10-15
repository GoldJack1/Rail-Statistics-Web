'use client'

import React from 'react'
import TextCard from '@/components/cards/TextCard/TextCard'
import './CarlisleFactCard.css'

const CARLISLE_CRS = 'CAR'

const CARLISLE_FACT =
  'This is where YouTuber Michael C (aka Network News) was called out for lying about LNER not diverting up the West Coast Main Line. Still to this day, Fynn\'s somewhat questionable lying graphic appears many times on his channel, where Michael C has called Fynn out for lying.'

export function CarlisleFactCard({ crs }: { crs?: string | null }) {
  if (String(crs || '').trim().toUpperCase() !== CARLISLE_CRS) return null

  return (
    <TextCard
      static
      title="Fact about Carlisle"
      className="carlisle-fact-card"
      trailingIcon={null}
      ariaLabel="Fact about Carlisle"
      description={
        <>
          <img
            className="carlisle-fact-card__image"
            src="/images/stations/carlisle-fynn-michael.jpg"
            alt="Fynn and Michael C on a train, with on-screen text calling Michael out for lying"
          />
          <span className="carlisle-fact-card__text">
            <span className="carlisle-fact-card__heading">Fact about Carlisle</span>
            <span className="carlisle-fact-card__copy">{CARLISLE_FACT}</span>
          </span>
        </>
      }
    />
  )
}

export default CarlisleFactCard
