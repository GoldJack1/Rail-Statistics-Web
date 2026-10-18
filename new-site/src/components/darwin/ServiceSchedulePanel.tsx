import type { ServiceDetail } from '@/types/darwin'
import { schedulePanelRows } from '@/utils/serviceSchedule'

export function ServiceSchedulePanel({ data }: { data: ServiceDetail }) {
  const rows = schedulePanelRows(data)
  if (!rows.length) return null
  return (
    <aside className="svc-schedule-panel" aria-label="Schedule identity">
      <ul className="svc-schedule-panel__list">
        {rows.map((row) => (
          <li key={row.text}>{row.text}</li>
        ))}
      </ul>
    </aside>
  )
}
