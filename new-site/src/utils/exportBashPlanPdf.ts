import type { BashPlanHop, BashPlanLeg, BashPlanResult } from '@/types/darwin'

function isWalkLeg(leg: Pick<BashPlanLeg, 'rid' | 'trainId'>): boolean {
  return leg.rid === '__WALK__' || leg.trainId === 'Walk'
}

function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function minutesBetween(fromTime: string, toTime: string): number | null {
  const parse = (value: string) => {
    const match = /^(\d{1,2}):(\d{2})/.exec(String(value || '').trim())
    if (!match) return null
    return Number(match[1]) * 60 + Number(match[2])
  }
  const from = parse(fromTime)
  const to = parse(toTime)
  if (from == null || to == null) return null
  let delta = to - from
  if (delta < 0) delta += 1440
  return delta
}

function minutesPhrase(minutes: number): string {
  return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`
}

function formatPlanDate(iso: string | undefined): string {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso || ''
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(dt)
}

function stationLine(name: string, crs: string, plat?: string | null): string {
  const code = crs ? ` (${crs})` : ''
  const platform = plat ? ` · platform ${plat}` : ''
  return `${name}${code}${platform}`
}

function hopHeading(hop: BashPlanHop): string {
  const walkOnly = hop.legs.length > 0 && hop.legs.every(isWalkLeg)
  const arrow = `${hop.fromName} → ${hop.toName}`
  return walkOnly ? `Walk · ${arrow}` : arrow
}

function legHtml(leg: BashPlanLeg, hop: BashPlanHop, last: boolean): string {
  const destName = last ? hop.toName : leg.toName
  const destCrs = last ? hop.toCrs : leg.toCrs
  const destArr = last ? hop.arr : leg.arr
  const travel = minutesBetween(leg.dep, destArr)
  if (isWalkLeg(leg)) {
    const mins = minutesBetween(leg.dep, destArr)
    return `<article class="leg walk">
      <p class="kicker">Walk between stations</p>
      <h4>${esc(leg.fromName)} (${esc(leg.fromCrs)}) → ${esc(leg.toName)} (${esc(leg.toCrs)})</h4>
      <p>${esc(leg.dep)} leave · ${esc(destArr)} arrive${mins != null ? ` · allow ${esc(minutesPhrase(mins))}` : ''}</p>
    </article>`
  }
  const board = leg.board
  const toc = board?.tocName || board?.toc || ''
  const platFrom = board?.platform || leg.fromPlat
  const platTo = hop.alightPlatform || leg.toPlat
  return `<article class="leg train">
    <p class="kicker">${esc(toc)}${toc ? ' · ' : ''}${esc(leg.trainId || 'Train')}</p>
    <h4>${esc(leg.dep)} ${esc(stationLine(leg.fromName, leg.fromCrs, platFrom))}</h4>
    <p>to ${esc(destArr)} ${esc(stationLine(destName, destCrs, platTo))}${travel != null ? ` · ${esc(minutesPhrase(travel))} on board` : ''}</p>
  </article>`
}

function renderBashPlanPrintHtml(result: BashPlanResult): string {
  const title = `Station bash — ${result.start?.name || ''} to ${result.end?.name || ''} — ${result.date || ''}`
  const hops = result.hops || []
  const visits = result.visitOrder || []
  const visitHtml = visits.length
    ? `<ol class="visits">${visits.map((v) => `<li>${esc(v.name)} (${esc(v.crs)}) · ${esc(v.arr)}</li>`).join('')}</ol>`
    : ''
  const hopsHtml = hops.map((hop) => {
    const risky = hop.riskyConnections.length
      ? `<p class="note">Risky before 5 minutes: ${hop.riskyConnections.map((r) => `${esc(r.trainId)} at ${esc(r.dep)}`).join(', ')}</p>`
      : ''
    return `<section class="hop">
      <h3>${esc(hopHeading(hop))}</h3>
      ${hop.legs.map((leg, i) => legHtml(leg, hop, i === hop.legs.length - 1)).join('')}
      ${risky}
    </section>`
  }).join('')

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${esc(title)}</title>
  <style>
    @page { size: A4; margin: 16mm; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      color: #111;
      background: #fff;
      font: 12pt/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
    }
    h1 { font-size: 20pt; margin: 0 0 4px; }
    .meta { color: #444; margin: 0 0 18px; }
    h2 { font-size: 11pt; letter-spacing: .08em; text-transform: uppercase; margin: 18px 0 8px; }
    h3 { font-size: 12pt; margin: 16px 0 8px; }
    h4 { font-size: 12pt; margin: 0 0 2px; font-weight: 650; }
    p { margin: 0; }
    .visits { margin: 0 0 12px; padding-left: 1.2em; }
    .hop { break-inside: avoid; border-top: 1px solid #ddd; padding-top: 8px; }
    .leg { margin: 0 0 10px; padding: 8px 10px; border-radius: 8px; background: #f4f4f4; }
    .leg.walk { background: #eef4ff; }
    .kicker { font-size: 9pt; letter-spacing: .06em; text-transform: uppercase; color: #555; margin-bottom: 2px; }
    .note { font-size: 9pt; color: #555; margin-top: 6px; }
    .foot { margin-top: 24px; font-size: 9pt; color: #666; }
  </style>
</head>
<body>
  <h1>Station bash</h1>
  <p class="meta">
    ${esc(result.start?.name)} → ${esc(result.end?.name)}<br />
    ${esc(formatPlanDate(result.date))}${result.at ? ` · start ${esc(result.at)}` : ''}${typeof result.totalMin === 'number' ? ` · ${esc(String(result.totalMin))} min` : ''}${result.finishAt ? ` · finish ${esc(result.finishAt)}` : ''}
  </p>
  ${result.caution ? `<p class="note">${esc(result.caution)}</p>` : ''}
  ${visits.length ? `<h2>Call at</h2>${visitHtml}` : ''}
  <h2>Itinerary</h2>
  ${hopsHtml}
  <p class="foot">Rail Statistics · planned interchange 5 minutes · walks between nearby stations 12 minutes</p>
</body>
</html>`
}

export function exportBashPlanPdf(result: BashPlanResult): void {
  if (typeof document === 'undefined') return
  const html = renderBashPlanPrintHtml(result)
  const frame = document.createElement('iframe')
  frame.setAttribute('aria-hidden', 'true')
  frame.style.position = 'fixed'
  frame.style.right = '0'
  frame.style.bottom = '0'
  frame.style.width = '1px'
  frame.style.height = '1px'
  frame.style.opacity = '0'
  frame.style.pointerEvents = 'none'
  frame.style.border = '0'
  document.body.appendChild(frame)
  const doc = frame.contentDocument
  if (!doc) {
    frame.remove()
    return
  }
  doc.open()
  doc.write(html)
  doc.close()
  const run = () => {
    frame.contentWindow?.focus()
    frame.contentWindow?.print()
    window.setTimeout(() => frame.remove(), 60_000)
  }
  if (frame.contentWindow?.document.readyState === 'complete') run()
  else frame.onload = run
}
