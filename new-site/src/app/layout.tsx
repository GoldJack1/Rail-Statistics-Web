import type { Metadata, Viewport } from 'next'
import { Suspense } from 'react'
import { geologica, aronetiv, aronetivNormal } from './fonts'
import { ThemeProvider } from '@/contexts/ThemeContext'
import { AuthProvider } from '@/contexts/AuthContext'
import { ConsumerAuthProvider } from '@/contexts/ConsumerAuthContext'
import { StationCollectionProvider } from '@/contexts/StationCollectionContext'
import { PhosphorIconProvider } from '@/components/icons/PhosphorIconProvider'
import Header from '@/components/misc/Header/Header'
import Footer from '@/components/misc/DeferredSiteFooter'
import AppMain from '@/components/misc/AppMain'
import ServiceWorkerRegistration from '@/components/misc/ServiceWorkerRegistration'
import FirebaseAnalytics from '@/components/misc/FirebaseAnalytics'
import AdSenseScript from '@/components/ads/AdSenseScript'
import { CONSENT_MODE_DEFAULTS_SCRIPT } from '@/components/ads/consentModeDefaults'
import { SITE_DESCRIPTION, SITE_KEYWORDS, SITE_NAME, SITE_URL } from '@/lib/site'
import './globals.css'

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: SITE_NAME,
    template: `%s | ${SITE_NAME}`,
  },
  manifest: '/manifest.json',
  description: SITE_DESCRIPTION,
  keywords: SITE_KEYWORDS,
  authors: [{ name: SITE_NAME }],
  creator: SITE_NAME,
  publisher: SITE_NAME,
  alternates: {
    canonical: '/',
  },
  openGraph: {
    type: 'website',
    locale: 'en_GB',
    url: SITE_URL,
    siteName: SITE_NAME,
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
    images: [
      {
        url: '/pwa-192x192.png',
        width: 192,
        height: 192,
        alt: `${SITE_NAME} icon`,
      },
    ],
  },
  twitter: {
    card: 'summary',
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
    images: ['/pwa-192x192.png'],
  },
  icons: {
    icon: [
      { url: '/favicon.svg?v=1', type: 'image/svg+xml' },
      { url: '/favicon.png?v=2', sizes: '512x512', type: 'image/png' },
    ],
    apple: '/apple-touch-icon.png?v=2',
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: SITE_NAME,
  },
  formatDetection: {
    telephone: false,
  },
  other: {
    'mobile-web-app-capable': 'yes',
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
  viewportFit: 'cover',
  interactiveWidget: 'overlays-content',
  colorScheme: 'light dark',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#e8eaed' },
    { media: '(prefers-color-scheme: dark)', color: '#22252d' },
  ],
}

/**
 * Runs before paint to set `data-theme` (and iOS status bar meta) from
 * localStorage, matching the old site's `applyStoredThemeToDocument()`
 * (src/hooks/useTheme.ts) so there is no light→dark flash on load.
 */
const NO_FLASH_THEME_SCRIPT = `
(function () {
  try {
    var raw = localStorage.getItem('theme');
    var theme = raw === 'dark' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', theme);
    var appleStatus = document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]');
    if (appleStatus) {
      appleStatus.setAttribute('content', theme === 'dark' ? 'black-translucent' : 'default');
    }
  } catch (e) {}
})();
`

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      className={`${geologica.variable} ${aronetiv.variable} ${aronetivNormal.variable}`}
      suppressHydrationWarning
    >
      <head>
        {/* eslint-disable-next-line @next/next/no-sync-scripts */}
        <script dangerouslySetInnerHTML={{ __html: NO_FLASH_THEME_SCRIPT }} />
        {/* Consent Mode v2 defaults before AdSense / Analytics tags */}
        {/* eslint-disable-next-line @next/next/no-sync-scripts */}
        <script dangerouslySetInnerHTML={{ __html: CONSENT_MODE_DEFAULTS_SCRIPT }} />
      </head>
      <body suppressHydrationWarning>
        <ThemeProvider>
          <PhosphorIconProvider>
          <AuthProvider>
            <ConsumerAuthProvider>
              <StationCollectionProvider>
                <ServiceWorkerRegistration />
                <AdSenseScript />
                <div className="app">
                  <Header />
                  <AppMain>
                    <Suspense fallback={null}>{children}</Suspense>
                  </AppMain>
                  <Suspense fallback={null}>
                    <Footer />
                    <FirebaseAnalytics />
                  </Suspense>
                </div>
              </StationCollectionProvider>
            </ConsumerAuthProvider>
          </AuthProvider>
          </PhosphorIconProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
