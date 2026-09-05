/**
 * Lightweight service worker — caches static shell assets and station CDN bundles.
 * Document navigations are always network-first (Next.js SSR on Netlify).
 *
 * Generated from this template at build time — edit sw.template.js, not sw.js.
 */
const CACHE_VERSION = 'rail-stats-static-local-1788644952658'
const STATION_CACHE_VERSION = 'rail-stats-station-bundles-local-1788644952658'
const PRECACHE_URLS = [
  '/manifest.json',
  '/favicon.svg',
  '/favicon.png',
  '/apple-touch-icon.png',
  '/pwa-192x192.png',
  '/images/south-yorkshire-peoples-network-logo.svg',
  '/media/home/hero1/slide1/light.webp',
  '/media/home/hero1/slide1/dark.webp',
]

function isStaticAsset(pathname) {
  return (
    pathname.startsWith('/fonts/') ||
    pathname.startsWith('/media/') ||
    pathname.startsWith('/images/') ||
    /\.(svg|png|jpg|jpeg|webp|woff2?|otf|ttf|ico|webmanifest|json)$/i.test(pathname)
  )
}

function isStationCdnRequest(url) {
  return (
    url.hostname.endsWith('firebasestorage.googleapis.com') &&
    decodeURIComponent(url.pathname + url.search).includes('station-exports')
  )
}

async function networkFirstWithCache(cache, request) {
  try {
    const response = await fetch(request)
    if (response.ok) {
      await cache.put(request, response.clone())
    }
    return response
  } catch (error) {
    const cached = await cache.match(request)
    if (cached) return cached
    throw error
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(PRECACHE_URLS)).then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_VERSION && key !== STATION_CACHE_VERSION)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)

  if (isStationCdnRequest(url)) {
    event.respondWith(
      caches.open(STATION_CACHE_VERSION).then((cache) => networkFirstWithCache(cache, request))
    )
    return
  }

  if (url.origin !== self.location.origin) return
  if (url.pathname.startsWith('/api/')) return

  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => caches.match('/')))
    return
  }

  if (!isStaticAsset(url.pathname)) return

  event.respondWith(caches.open(CACHE_VERSION).then((cache) => networkFirstWithCache(cache, request)))
})

self.addEventListener('message', (event) => {
  if (event.data?.type !== 'stations-manifest-updated') return
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key.startsWith('rail-stats-station-bundles-'))
          .map((key) => caches.delete(key))
      )
    )
  )
})
