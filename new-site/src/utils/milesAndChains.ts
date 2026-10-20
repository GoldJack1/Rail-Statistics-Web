const METRES_PER_MILE = 1609.344
const CHAINS_PER_MILE = 80
const METRES_PER_CHAIN = METRES_PER_MILE / CHAINS_PER_MILE

export interface MilesAndChains {
  miles: number
  chains: number
}

function fromTotalChains(totalChains: number): MilesAndChains {
  const whole = Math.max(0, Math.round(totalChains))
  return {
    miles: Math.floor(whole / CHAINS_PER_MILE),
    chains: whole % CHAINS_PER_MILE,
  }
}

/** Nearest chain. Metres win when both are present, because miles are rounded to 0.01. */
export function milesAndChains(input: { miles?: number | null; metres?: number | null }): MilesAndChains | null {
  const metres = input.metres
  if (typeof metres === 'number' && Number.isFinite(metres) && metres >= 0) {
    return fromTotalChains(metres / METRES_PER_CHAIN)
  }
  const miles = input.miles
  if (typeof miles === 'number' && Number.isFinite(miles) && miles >= 0) {
    return fromTotalChains(miles * CHAINS_PER_MILE)
  }
  return null
}

/** RTT-style distance: `12m 08ch`. */
export function formatMilesAndChains(input: { miles?: number | null; metres?: number | null }): string | null {
  const parts = milesAndChains(input)
  if (!parts) return null
  return `${parts.miles}m ${String(parts.chains).padStart(2, '0')}ch`
}

export function milesAndChainsTitle(input: { miles?: number | null; metres?: number | null }): string | null {
  const parts = milesAndChains(input)
  if (!parts) return null
  const mileWord = parts.miles === 1 ? 'mile' : 'miles'
  const chainWord = parts.chains === 1 ? 'chain' : 'chains'
  return `${parts.miles} ${mileWord} ${parts.chains} ${chainWord} from origin`
}
