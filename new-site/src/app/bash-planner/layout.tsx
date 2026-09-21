import StationsDataBoundary from '@/contexts/StationsDataBoundary'

export default function BashPlannerLayout({ children }: { children: React.ReactNode }) {
  return <StationsDataBoundary>{children}</StationsDataBoundary>
}
