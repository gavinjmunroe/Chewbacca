import { accommodationsApi } from '../api/client'
import { offlineDb, upsertAccommodations } from '../db/offlineDb'
import type { Accommodation } from '../types'

export const accommodationRepo = {
  async list(tripId: number | string): Promise<{ accommodations: Accommodation[] }> {
    if (!navigator.onLine) {
      const accommodations = await offlineDb.accommodations
        .where('trip_id').equals(Number(tripId)).toArray()
      return { accommodations }
    }
    const result = await accommodationsApi.list(tripId)
    upsertAccommodations(result.accommodations || []).catch(() => {})
    return result
  },
}
