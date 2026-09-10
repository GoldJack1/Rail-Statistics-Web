import { notFound } from 'next/navigation'
import { isAccountSystemEnabled } from '@/lib/accountSystemConfig'

export default function PricingLayout({ children }: { children: React.ReactNode }) {
  if (!isAccountSystemEnabled) notFound()
  return children
}
