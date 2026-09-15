import { describe, expect, it } from 'vitest'
import {
  CONTACTLESS_PAYG_AREAS,
  SMARTCARD_PAYG_AREAS,
  visiblePaygAreas,
} from '@/types/paygMatrix'

describe('visiblePaygAreas', () => {
  it('hides London & SE and Oyster 1–9 unless admin mode is on', () => {
    const publicContactless = visiblePaygAreas(CONTACTLESS_PAYG_AREAS, false)
    const publicSmartcards = visiblePaygAreas(SMARTCARD_PAYG_AREAS, false)
    expect(publicContactless.map((area) => area.id)).not.toContain('london-south-east')
    expect(publicSmartcards.map((area) => area.id)).not.toContain('oyster-1-9')
    expect(visiblePaygAreas(CONTACTLESS_PAYG_AREAS, true).map((area) => area.id)).toContain(
      'london-south-east'
    )
    expect(visiblePaygAreas(SMARTCARD_PAYG_AREAS, true).map((area) => area.id)).toContain(
      'oyster-1-9'
    )
  })
})
