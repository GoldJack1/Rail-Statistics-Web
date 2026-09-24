import { describe, expect, it } from 'vitest'
import { postLoginPath } from './darwinPreviewAccess'

describe('postLoginPath', () => {
  it('sends Darwin preview users to departures', () => {
    expect(postLoginPath({ email: 'hello@emilychomicz.com' })).toBe('/departures')
    expect(postLoginPath({ email: '04richwin@gmail.com' }, '/admin/stations')).toBe('/departures')
  })

  it('keeps API status as a post-login destination for preview users', () => {
    expect(postLoginPath({ email: 'hello@emilychomicz.com' }, '/admin/api-status')).toBe(
      '/admin/api-status'
    )
  })

  it('sends the owner to stations admin by default', () => {
    expect(postLoginPath({ email: 'wingatejack2021@gmail.com' })).toBe('/admin/stations')
  })
})
