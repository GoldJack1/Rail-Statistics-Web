import { NextRequest, NextResponse } from 'next/server'
import { getPaygFarePayload } from '@/server/paygMatrixStore'

export const maxDuration = 60

export async function GET(request: NextRequest) {
  const areaId = request.nextUrl.searchParams.get('areaId')?.trim() ?? ''
  const origin = request.nextUrl.searchParams.get('origin')?.trim() ?? ''
  const dest = request.nextUrl.searchParams.get('dest')?.trim() ?? ''
  const collectionId = request.nextUrl.searchParams.get('collectionId')?.trim() || undefined
  if (!areaId || !origin || !dest) {
    return NextResponse.json({ error: 'areaId, origin and dest are required' }, { status: 400 })
  }
  try {
    const fare = await getPaygFarePayload(areaId, origin, dest, collectionId)
    return NextResponse.json({ fare })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to load PAYG fare'
    const status = message.startsWith('Unknown') ? 404 : 500
    return NextResponse.json({ error: message }, { status })
  }
}
