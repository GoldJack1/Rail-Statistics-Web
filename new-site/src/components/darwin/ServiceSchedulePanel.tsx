import type { ServiceDetail } from '@/types/darwin'
import { overviewSidebarModel, type OverviewField } from '@/utils/serviceSchedule'

function OverviewFieldBlock({ field }: { field: OverviewField }) {
  return (
    <div className="svc-overview-side__field">
      <span className="svc-overview-side__label">{field.label}</span>
      <span className="svc-overview-side__value">{field.value}</span>
      {field.note ? <span className="svc-overview-side__note">{field.note}</span> : null}
    </div>
  )
}

export function ServiceSchedulePanel({
  data,
  operator,
}: {
  data: ServiceDetail
  operator?: string | null
}) {
  const model = overviewSidebarModel(data)
  const operatorName = String(operator || '').trim()
  const formedAt = model.fields.findIndex((field) => field.label === 'Formed by')
  const beforeFormed = formedAt === -1 ? model.fields : model.fields.slice(0, formedAt)
  const formed = formedAt === -1 ? null : model.fields[formedAt]
  const afterFormed = formedAt === -1 ? [] : model.fields.slice(formedAt + 1)
  const hasOperatorGroup = Boolean(operatorName || model.category || model.extras.length)
  if (!model.lines.length && !model.pair.length && !model.fields.length && !operatorName) return null
  return (
    <div className="svc-overview-side" aria-label="Schedule identity">
      {hasOperatorGroup ? (
        <div className="svc-overview-side__group">
          {operatorName ? (
            <div className="svc-overview-side__field">
              <span className="svc-overview-side__label">Operator</span>
              <span className="svc-overview-side__value">{operatorName}</span>
            </div>
          ) : null}
          {model.category ? <p className="svc-overview-side__line svc-overview-side__line--secondary">{model.category}</p> : null}
          {model.extras.map((line) => (
            <p key={line} className="svc-overview-side__line">{line}</p>
          ))}
        </div>
      ) : null}
      {model.pair.length > 0 && (
        <div className={`svc-overview-side__pair${model.pair.length === 1 ? ' svc-overview-side__pair--single' : ''}`}>
          {model.pair.map((field) => (
            <OverviewFieldBlock key={field.label} field={field} />
          ))}
        </div>
      )}
      {beforeFormed.map((field) => (
        <OverviewFieldBlock key={field.label} field={field} />
      ))}
      {formed || model.pathed ? (
        <div className="svc-overview-side__group">
          {formed ? <OverviewFieldBlock field={formed} /> : null}
          {model.pathed ? <p className="svc-overview-side__line">{model.pathed}</p> : null}
        </div>
      ) : null}
      {afterFormed.map((field) => (
        <OverviewFieldBlock key={field.label} field={field} />
      ))}
      {model.operating ? <p className="svc-overview-side__line svc-overview-side__line--secondary">{model.operating}</p> : null}
    </div>
  )
}
