import { NextResponse } from 'next/server'
import { isAccountSystemEnabled } from '@/lib/accountSystemConfig'

/** 503 when consumer account / Stripe web billing is disabled for this deployment. */
export function accountSystemDisabledResponse() {
  if (isAccountSystemEnabled) return null
  return NextResponse.json(
    { error: 'Account and web billing are not available on this deployment.' },
    { status: 503 }
  )
}
