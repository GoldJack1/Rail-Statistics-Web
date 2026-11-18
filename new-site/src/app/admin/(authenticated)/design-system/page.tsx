'use client'

import React from 'react'
import { TextCard } from '@/components/cards'
import { PageTopHeader } from '@/components/misc'
import './DesignSystemHomePage.css'

const SECTIONS = [
  {
    title: 'Colours',
    description: 'Core light/dark theme colours, text, borders, and accents.',
    to: '/admin/design-system/colours',
  },
  {
    title: 'Typography',
    description: 'Font families, variable-weight specimens, and scale tokens.',
    to: '/admin/design-system/typography',
  },
  {
    title: 'Buttons',
    description: 'Primary button variants, bars, and visit state controls.',
    to: '/admin/design-system/buttons',
  },
  {
    title: 'Layout',
    description: 'Spacing, radii, containers, and layout composition patterns.',
    to: '/admin/design-system/layout',
  },
  {
    title: 'Components',
    description: 'High-level reusable UI components and where they are used.',
    to: '/admin/design-system/components',
  },
  {
    title: 'Icons',
    description: 'Current icon usage patterns and shared icon guidance.',
    to: '/admin/design-system/icons',
  },
  {
    title: 'Heroes',
    description: 'Static and carousel heroes: type scale, panel fill, CTAs, button colours, and carousel chrome.',
    to: '/admin/design-system/heros',
  },
]

const DesignSystemHomePage: React.FC = () => {
  return (
    <div className="ds-home-page">
      <PageTopHeader
        title="Site Design System"
        subtitle="Central reference for typography, colour tokens, interaction states, and shared UI patterns used across Rail Statistics."
      />

      <div className="container container--full-bleed">
        <div className="ds-home">
        <section className="ds-home__layout">
          <div className="ds-home__left">
            <h2 className="ds-home__section-title">System Sections</h2>
            <div className="ds-home__stack">
              {SECTIONS.map((section) => (
                <div key={section.to} className="ds-home__text-card">
                  <TextCard
                    title={section.title}
                    description={section.description}
                    to={section.to}
                  />
                </div>
              ))}
            </div>
          </div>

          <aside className="ds-home__right">
            <article className="ds-home__preview-panel">
              <header className="ds-home__preview-header">
                <h3>Rail Statistics UI Snapshot</h3>
                <p>A brief visual sample inspired by the Stations page structure and styling.</p>
              </header>

              <div className="ds-home__preview-metrics">
                <div className="ds-home__preview-metric">
                  <span className="ds-home__preview-label">Theme</span>
                  <span className="ds-home__preview-value">Token driven</span>
                </div>
                <div className="ds-home__preview-metric">
                  <span className="ds-home__preview-label">Layout</span>
                  <span className="ds-home__preview-value">Cards + Panels</span>
                </div>
              </div>

              <div className="ds-home__preview-card">
                <div className="ds-home__preview-card-head">
                  <h4>Station-style surface</h4>
                  <span className="ds-home__preview-chip">Preview</span>
                </div>
                <p className="ds-home__preview-copy">
                  Elevated card containers, compact metadata, and clear action affordances.
                </p>
                <div className="ds-home__preview-meta">
                  <span className="ds-home__preview-chip ds-home__preview-chip--muted">Spacing tokens</span>
                  <span className="ds-home__preview-chip ds-home__preview-chip--muted">Type scale</span>
                  <span className="ds-home__preview-chip ds-home__preview-chip--muted">State colors</span>
                </div>
              </div>

              <div className="ds-home__preview-list">
                <div className="ds-home__preview-list-item">
                  <div>
                    <p className="ds-home__preview-list-title">Paddington</p>
                    <p className="ds-home__preview-list-subtitle">LONPAD • Major station</p>
                  </div>
                  <span className="ds-home__preview-chip ds-home__preview-chip--muted">Open</span>
                </div>
                <div className="ds-home__preview-list-item">
                  <div>
                    <p className="ds-home__preview-list-title">Bristol Temple Meads</p>
                    <p className="ds-home__preview-list-subtitle">BRI • Regional hub</p>
                  </div>
                  <span className="ds-home__preview-chip ds-home__preview-chip--muted">Review</span>
                </div>
              </div>

              <div className="ds-home__preview-footer">
                <div className="ds-home__swatches">
                  <span className="ds-home__swatch ds-home__swatch--bg-primary" />
                  <span className="ds-home__swatch ds-home__swatch--bg-secondary" />
                  <span className="ds-home__swatch ds-home__swatch--bg-tertiary" />
                  <span className="ds-home__swatch ds-home__swatch--accent" />
                </div>
                <div className="ds-home__preview-actions">
                  <span className="ds-home__preview-chip ds-home__preview-chip--muted">Filter</span>
                  <span className="ds-home__preview-chip ds-home__preview-chip--muted">Sort</span>
                  <span className="ds-home__preview-chip ds-home__preview-chip--muted">Compare</span>
                </div>
              </div>
            </article>
          </aside>
        </section>
        </div>
      </div>
    </div>
  )
}

export default DesignSystemHomePage

