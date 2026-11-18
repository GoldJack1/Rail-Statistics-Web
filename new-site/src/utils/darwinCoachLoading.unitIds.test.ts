import { coachCountFromUnitIds } from './darwinCoachLoading'

describe('coachCountFromUnitIds', () => {
  it('treats a Class 158 as two cars', () => {
    expect(coachCountFromUnitIds(['158867'])).toBe(2)
  })

  it('sums coupled units', () => {
    expect(coachCountFromUnitIds(['158867', '158868'])).toBe(4)
  })
})
