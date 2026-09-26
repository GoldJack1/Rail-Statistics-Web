const LNWR_CRS = new Set([
  'EUS', 'MKC', 'NMP', 'BDM', 'BLY', 'WFJ', 'TRI', 'LIV', 'CRE', 'RUG', 'COV', 'BHI', 'LET',
])
const WMR_CRS = new Set([
  'BSW', 'SAD', 'WSL', 'LYE', 'STO', 'UNI', 'RDD', 'FOK', 'BMO', 'KNN', 'DDP',
])

export function formatLmTocName(
  tocName: string | null | undefined,
  tocCode: string | null | undefined,
  originCrs?: string | null,
  destCrs?: string | null,
): string {
  const raw = (tocName || tocCode || '').replace(/&amp;/gi, '&').trim()
  if (!raw) return 'Unknown Operator'
  const isLm = raw.toUpperCase() === 'LM' || /^LNR\s*&\s*WMR$/i.test(raw) || /West Midlands Trains/i.test(raw)
  if (!isLm) return raw
  const ends = [originCrs, destCrs].map((c) => (c || '').toUpperCase())
  const lnwr = ends.some((c) => LNWR_CRS.has(c))
  const wmr = ends.some((c) => WMR_CRS.has(c) && !LNWR_CRS.has(c))
  if (lnwr && !wmr) return 'London Northwestern Railway'
  if (wmr && !lnwr) return 'West Midlands Railway'
  if (lnwr) return 'London Northwestern Railway'
  return 'West Midlands Railway'
}
