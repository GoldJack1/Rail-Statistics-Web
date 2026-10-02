import { describe, expect, it } from 'vitest'
import { parseServicePath, serviceHref } from './serviceUrl'

describe('service URLs', () => {
  it('parses uid, date, section and mode', () => {
    expect(parseServicePath(['G01161', '2026-10-02', 'formation', 'simple'])).toEqual({
      id: 'G01161',
      date: '2026-10-02',
      section: 'formation',
      mode: 'simple',
    })
  })

  it('accepts a Darwin RID and defaults the section', () => {
    expect(parseServicePath(['202610027101161', '2026-10-02'])).toEqual({
      id: '202610027101161',
      date: '2026-10-02',
      section: 'overview',
      mode: null,
    })
  })

  it('builds a short canonical path', () => {
    expect(serviceHref({ id: 'G01161', date: '2026-10-02', section: 'calling', mode: 'detailed' })).toBe(
      '/services/G01161/2026-10-02/calling/detailed',
    )
  })
})
