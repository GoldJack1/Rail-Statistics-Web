import type { MetadataRoute } from 'next'
import { SITE_URL } from '@/lib/site'

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date()
  const publicRoutes = [
    '',
    '/home',
    '/stations',
    '/stations/map',
    '/migration',
    '/departures',
    '/units',
    '/account',
    '/leaderboards',
    '/privacy',
    '/eula',
    '/buttons',
  ]

  return publicRoutes.map((path) => ({
    url: `${SITE_URL}${path}`,
    lastModified,
    changeFrequency: path === '' || path === '/stations/map' ? 'weekly' : 'monthly',
    priority: path === '' ? 1 : path === '/stations/map' || path === '/migration' ? 0.9 : 0.6,
  }))
}
