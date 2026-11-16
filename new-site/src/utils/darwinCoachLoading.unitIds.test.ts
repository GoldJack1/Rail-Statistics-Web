import { coachCountFromUnitIds } from './darwinCoachLoading'

describe('coachCountFromUnitIds', () => {
  it('treats a Class 158 as two cars', () => {
    expect(coachCountFromUnitIds(['158867'])).toBe(2)
  })

  it('sums coupled units', () => {
    expect(coachCountFromUnitIds(['158867', '158868'])).toBe(4)
  })
})

describe('coachCountFromUnitIds by operator', () => {
  it('draws Northern 170s as 3-car and East Midlands Railway 170s as 2-car', () => {
    expect(coachCountFromUnitIds(['170401'], 'NT')).toBe(3)
    expect(coachCountFromUnitIds(['170401', '170402'], 'NT')).toBe(6)
    expect(coachCountFromUnitIds(['170201'], 'EM')).toBe(2)
    expect(coachCountFromUnitIds(['170201', '170202'], 'EM')).toBe(4)
  })

  it('keeps the class default for other operators and when the operator is unknown', () => {
    expect(coachCountFromUnitIds(['170101'], 'XC')).toBe(2)
    expect(coachCountFromUnitIds(['170101'])).toBe(2)
    expect(coachCountFromUnitIds(['170101'], null)).toBe(2)
  })

  it('does not change classes that do not vary by operator', () => {
    expect(coachCountFromUnitIds(['158867'], 'NT')).toBe(2)
    expect(coachCountFromUnitIds(['221107'], 'XC')).toBe(5)
  })

  it('is case-insensitive on the operator code', () => {
    expect(coachCountFromUnitIds(['170401'], 'nt')).toBe(3)
  })
})
