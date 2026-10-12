'use client'

import { isBetaSite } from '@/utils/localDevFlags'
import { useStationAdminMode } from '@/hooks/useStationAdminMode'

/**
 * WIP UI: everyone on the beta site, or a live admin with admin mode on.
 * Delete the gate when the feature ships publicly on live.
 */
export function usePreviewFeature(): boolean {
  const adminMode = useStationAdminMode()
  return isBetaSite() || adminMode
}
