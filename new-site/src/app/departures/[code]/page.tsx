import DarwinDeparturesPageClient from '@/components/darwin/DarwinDeparturesPageClient'
import { loadDeparturesSnapshot } from '@/utils/loadDeparturesSnapshot'

export default async function DeparturesStationPage({
  params,
  searchParams,
}: {
  params: Promise<{ code?: string }>
  searchParams: Promise<{ date?: string; at?: string; passengers?: string }>
}) {
  const { code } = await params
  const q = await searchParams
  const initialSnapshot = code
    ? await loadDeparturesSnapshot({
        code,
        hours: 24,
        date: q.date,
        at: q.at,
        cis: q.passengers === '1',
      })
    : null
  return <DarwinDeparturesPageClient initialSnapshot={initialSnapshot} />
}
