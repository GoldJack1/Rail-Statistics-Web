'use client'

import React from 'react'
import TextCard from '@/components/cards/TextCard/TextCard'
import './StationFactCard.css'

type StationFact = {
  title: string
  copy: string
  imageSrc?: string
  imageAlt?: string
}

const STATION_FACTS: Record<string, StationFact> = {
  CAR: {
    title: 'Fact about Carlisle',
    copy:
      "This is where YouTuber Michael C (aka Network News) was called out for lying about LNER not diverting up the West Coast Main Line. Still to this day, Fynn's somewhat questionable lying graphic appears many times on his channel, where Michael C has called Fynn out for lying.",
    imageSrc: '/images/stations/carlisle-fynn-michael.jpg',
    imageAlt: 'Fynn and Michael C on a train, with on-screen text calling Michael out for lying',
  },
  GRL: {
    title: 'Fact about Greenfaulds',
    copy:
      "It was between Greenfaulds and Whifflet that YouTuber Michael C (aka Network News) called Fynn out for lying about where they were sat. Unfortunately, this is also when the Michael calls Fynn out for lying segment started — alongside Lumo's first West Coast service, which is cheap and a joke.",
    imageSrc: '/images/stations/greenfaulds-michael-fynn.jpg',
    imageAlt: 'Michael C and Fynn on a train, with on-screen text: Michael calls out Fynn for lying',
  },
  LDS: {
    title: 'Fact about Leeds',
    copy:
      "This is where Fynn's next train out of Leeds, bound for Carlisle, was delayed. On his previous train he had claimed that Northern would not pull a Northern and delay him. How wrong of him to assume.",
    imageSrc: '/images/stations/leeds-fynn-northern.jpg',
    imageAlt: 'Fynn on a train with Michael crossed out and a Northern logo over the other passenger',
  },
  NRW: {
    title: 'Fact about Norwich',
    copy:
      "It was upon departing Norwich that YouTuber Dan (aka The Right Track) called Fynn out for lying about which direction they were looking. For context, they were sat facing backwards when Fynn asked 'are you looking forward to this?', and Dan replied 'I'm actually looking backwards, because I'm travelling backwards.'",
    imageSrc: '/images/stations/norwich-fynn-dan.jpg',
    imageAlt: 'Fynn on a train with Michael crossed out and Dan labelled over the other passenger',
  },
  SRA: {
    title: 'Fact about Stratford',
    copy:
      "On Fynn's previous train, he had claimed there were no delays on the Jubilee Line. Aiming to visit every c2c station in a day, he got cocky and assumed he could get from Stratford to West Ham in 15 minutes — until he was betrayed by TfL for lying to him.",
    imageSrc: '/images/stations/stratford-fynn-tfl.jpg',
    imageAlt: 'Fynn on a train with a TfL roundel over the other passenger',
  },
  SRG: {
    title: 'Fact about Seer Green & Jordans',
    copy:
      "Whilst passing through Seer Green & Jordans, Michael C gaslights himself by calling himself out for lying about not interrupting a montage, when in fact he cuts in yapping later on. Now that's some newsworthy news for so-called Network News — think we need a Fynnvestigation to get the facts right.",
    imageSrc: '/images/stations/seer-green-michael-michael.jpg',
    imageAlt: 'Two photos of Michael C on a train, with on-screen text: Michael calls out Michael for lying',
  },
}

export function StationFactCard({ crs }: { crs?: string | null }) {
  const fact = STATION_FACTS[String(crs || '').trim().toUpperCase()]
  if (!fact) return null

  return (
    <TextCard
      static
      title={fact.title}
      className="station-fact-card"
      trailingIcon={null}
      ariaLabel={fact.title}
      description={
        <>
          {fact.imageSrc ? (
            <img className="station-fact-card__image" src={fact.imageSrc} alt={fact.imageAlt ?? ''} />
          ) : null}
          <span className="station-fact-card__text">
            <span className="station-fact-card__heading">{fact.title}</span>
            <span className="station-fact-card__copy">{fact.copy}</span>
          </span>
        </>
      }
    />
  )
}

export default StationFactCard
