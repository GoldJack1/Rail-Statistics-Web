export type CallingPatternTone =
  | 'ontime'
  | 'early'
  | 'delay-1'
  | 'delay-16'
  | 'delay-30'
  | 'delay-60'
  | 'cancelled'

export function delayMinutesTone(deltaMinutes: number): CallingPatternTone {
  if (deltaMinutes <= 15) return 'delay-1'
  if (deltaMinutes <= 29) return 'delay-16'
  if (deltaMinutes <= 59) return 'delay-30'
  return 'delay-60'
}
