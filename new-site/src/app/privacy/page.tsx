'use client'

import React, { useEffect, useMemo, useState } from 'react'
import BUTLink from '@/components/buttons/other/BUTLink'
import {
  LegalDocsSectionNav,
  legalDocsSubsectionId,
  type LegalDocsSection,
} from '@/components/misc/LegalDocsSectionNav/LegalDocsSectionNav'
import { PageTopHeader } from '@/components/misc'
import './PrivacyPolicyPage.css'

const SECTIONS: LegalDocsSection[] = [
  { id: 'section-1', label: '1. Information Collection' },
  { id: 'section-2', label: '2. Payments and In-App Purchases' },
  { id: 'section-3', label: '3. Third-Party Services – Advertising' },
  { id: 'section-4', label: '4. Data Sharing' },
  { id: 'section-5', label: "5. Children's Privacy" },
  { id: 'section-6', label: '6. Security' },
  { id: 'section-7', label: '7. Changes to this Privacy Policy' },
  { id: 'section-8', label: '8. Contact Us' },
]

const PrivacyPolicyPage: React.FC = () => {
  const sections = useMemo(() => SECTIONS, [])
  const [activeSectionId, setActiveSectionId] = useState<string>(sections[0].id)

  useEffect(() => {
    const syncActiveSectionFromHash = () => {
      const hashId = window.location.hash.replace('#', '')
      if (sections.some((section) => section.id === hashId)) {
        setActiveSectionId(hashId)
      }
    }

    window.addEventListener('hashchange', syncActiveSectionFromHash)
    syncActiveSectionFromHash()

    return () => {
      window.removeEventListener('hashchange', syncActiveSectionFromHash)
    }
  }, [sections])

  const handleSelectSection = (sectionId: string) => {
    setActiveSectionId(sectionId)
    if (typeof window !== 'undefined') {
      window.location.hash = sectionId
    }
  }

  return (
    <div className="container container--station-details">
      <PageTopHeader
        title="Privacy Policy"
        subtitle="Last updated August 8, 2026"
        actionButton={{ to: '/', label: 'Back to home' }}
      />
      <div className="privacy-page legal-docs-page">
        <div className="privacy-layout legal-docs-layout station-details-layout">
          <LegalDocsSectionNav
            sections={sections}
            activeSectionId={activeSectionId}
            onSelect={handleSelectSection}
            ariaLabel="Privacy Policy sections"
          />

          <main className="privacy-content legal-docs-main station-details-main">
            <div className="legal-docs-card">
              <p className="privacy-intro">
                Thank you for using Rail Statistics (&quot;we,&quot; &quot;our,&quot; or &quot;us&quot;). Your privacy is important, and this Privacy Policy explains how your information is collected, used, and protected.
              </p>

              {activeSectionId === 'section-1' && (
                <section id="section-1" className="privacy-section">
                  <h2>1. Information Collection</h2>
                  <h3 id={legalDocsSubsectionId('Device Information and Crash Reports')}>
                    Device Information and Crash Reports
                  </h3>
                  <p>
                    Rail Statistics may collect device-specific data, including device identifiers, operating system versions, and crash reports. This information helps improve app stability and performance.
                  </p>
                  <h3 id={legalDocsSubsectionId('Local Data Storage')}>1.1 – Local Data Storage</h3>
                  <p>
                    The app allows you to import data (e.g., station visits and ticket data) from files on your device. All imported data remains solely on your device and is not transmitted or shared externally by the app. However, imported data can appear on your other devices via the widget functionality provided by Apple&apos;s ecosystem.
                  </p>
                </section>
              )}

              {activeSectionId === 'section-2' && (
                <section id="section-2" className="privacy-section">
                  <h2>2. Payments and In-App Purchases</h2>
                  <p>
                    Rail Statistics offers in-app purchases managed exclusively by Apple. When you make an in-app purchase, payment transactions are processed directly by Apple. Rail Statistics does not collect, store, or have access to any of your payment details or billing information. Please refer to <BUTLink href="https://www.apple.com/legal/privacy/" target="_blank" rel="noopener noreferrer">Apple&apos;s Privacy Policy</BUTLink> for details about how your payment information is processed and secured.
                  </p>
                </section>
              )}

              {activeSectionId === 'section-3' && (
                <section id="section-3" className="privacy-section">
                  <h2>3. Third-Party Services – Advertising</h2>
                  <h3 id={legalDocsSubsectionId('Mobile app – Google AdMob')}>
                    Mobile app – Google AdMob
                  </h3>
                  <p>
                    The Rail Statistics mobile app uses Google AdMob to serve advertisements. When you first launch the app, you will be asked to consent to advertising data collection. This data is securely stored, managed, and processed by Google in compliance with applicable privacy laws, including the GDPR where it applies. For more details, please review <BUTLink href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer">Google&apos;s privacy policy</BUTLink> and <BUTLink href="https://support.google.com/admob/answer/6128543" target="_blank" rel="noopener noreferrer">Google&apos;s AdMob help on privacy</BUTLink>.
                  </p>
                  <h3 id={legalDocsSubsectionId('Website – Google AdSense')}>
                    Website – Google AdSense
                  </h3>
                  <p>
                    The Rail Statistics website (including <BUTLink href="https://railstatistics.co.uk" target="_blank" rel="noopener noreferrer">railstatistics.co.uk</BUTLink>) uses Google AdSense to display advertisements. Google and its partners may collect and process information — such as cookies, device identifiers, IP address, and browsing activity on our site — to show ads, measure performance, and (where permitted) personalise advertising.
                  </p>
                  <p>
                    You can learn how Google uses data when you use our sites or apps in <BUTLink href="https://policies.google.com/technologies/partner-sites" target="_blank" rel="noopener noreferrer">Google&apos;s partner sites policy</BUTLink>, and review <BUTLink href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer">Google&apos;s privacy policy</BUTLink>. Visitors in the UK, European Economic Area, and Switzerland are shown Google&apos;s consent message (via AdSense Privacy &amp; messaging) so they can accept, decline, or manage options for advertising cookies and personalised ads before that processing takes place. You can also manage ad personalisation via <BUTLink href="https://adssettings.google.com/" target="_blank" rel="noopener noreferrer">Google Ads Settings</BUTLink>.
                  </p>
                </section>
              )}

              {activeSectionId === 'section-4' && (
                <section id="section-4" className="privacy-section">
                  <h2>4. Data Sharing</h2>
                  <p>
                    Rail Statistics does not sell your personal data. We do not share or transmit your data externally except as needed for the third-party advertising services described in section 3 (Google AdMob in the app and Google AdSense on the website), or where required by law. User-generated data imported into the mobile app remains stored on your device(s), subject to any on-device sharing features provided by your platform (for example Apple widgets).
                  </p>
                </section>
              )}

              {activeSectionId === 'section-5' && (
                <section id="section-5" className="privacy-section">
                  <h2>5. Children&apos;s Privacy</h2>
                  <p>
                    Rail Statistics is not intended for use by individuals under the age of 16. We do not knowingly collect personal information from children under 16. If we become aware of data collected from individuals under 16 without parental consent, we will promptly delete it.
                  </p>
                </section>
              )}

              {activeSectionId === 'section-6' && (
                <section id="section-6" className="privacy-section">
                  <h2>6. Security</h2>
                  <p>
                    We are committed to protecting the security of your information. All data imported and stored in the Rail Statistics app remains on-device. However, no method of electronic storage is 100% secure, and while we strive to protect your data, we cannot guarantee its absolute security.
                  </p>
                </section>
              )}

              {activeSectionId === 'section-7' && (
                <section id="section-7" className="privacy-section">
                  <h2>7. Changes to this Privacy Policy</h2>
                  <p>
                    We may update this Privacy Policy periodically. Any changes will be reflected by revising the &quot;Effective Date&quot; above. We encourage you to periodically review this policy to stay informed about how we protect your information.
                  </p>
                </section>
              )}

              {activeSectionId === 'section-8' && (
                <section id="section-8" className="privacy-section">
                  <h2>8. Contact Us</h2>
                  <p>
                    For any questions or concerns regarding this Privacy Policy, don&apos;t hesitate to get in touch with us by email at: <BUTLink href="mailto:support@railstatistics.co.uk">support@railstatistics.co.uk</BUTLink>. By using Rail Statistics, you acknowledge and agree to this Privacy Policy.
                  </p>
                </section>
              )}
            </div>
          </main>
        </div>
      </div>
    </div>
  )
}

export default PrivacyPolicyPage
