import DarwinDeparturesPageClient from '@/components/darwin/DarwinDeparturesPageClient'
import { parseBoardWindowHours } from '@/utils/boardWindowHours'
import { loadDeparturesSnapshot } from '@/utils/loadDeparturesSnapshot'

export default async function DeparturesStationPage({
  params,
  searchParams,
}: {
  params: Promise<{ code?: string }>
  searchParams: Promise<{ date?: string; at?: string; passengers?: string; hours?: string }>
}) {
  const { code } = await params
  const q = await searchParams
  const date = typeof q.date === 'string' ? q.date : undefined
  const at = typeof q.at === 'string' ? q.at : undefined
  const hours = parseBoardWindowHours(q.hours, { fullDay: Boolean(date) && !at })
  const initialSnapshot = code
    ? await loadDeparturesSnapshot({
        code,
        hours,
        date,
        at,
        cis: q.passengers === '1',
      })
    : null
  return <DarwinDeparturesPageClient initialSnapshot={initialSnapshot} />
}
