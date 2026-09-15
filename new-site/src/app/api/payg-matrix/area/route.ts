import { NextRequest, NextResponse } from 'next/server'
import { getPaygAreaPayload } from '@/server/paygMatrixStore'

export const maxDuration = 60

export async function GET(request: NextRequest) {
  const areaId = request.nextUrl.searchParams.get('areaId')?.trim() ?? ''
  const collectionId = request.nextUrl.searchParams.get('collectionId')?.trim() || undefined
  if (!areaId) {
    return NextResponse.json({ error: 'areaId is required' }, { status: 400 })
  }
  try {
    const area = await getPaygAreaPayload(areaId, collectionId)
    return NextResponse.json(area)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to load PAYG area'
    const status = message.startsWith('Unknown') ? 404 : 500
    return NextResponse.json({ error: message }, { status })
  }
}
