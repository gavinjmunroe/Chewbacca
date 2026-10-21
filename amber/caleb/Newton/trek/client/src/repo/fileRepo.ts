import { filesApi } from '../api/client'
import { offlineDb, upsertTripFiles } from '../db/offlineDb'
import type { TripFile } from '../types'

export const fileRepo = {
  async list(tripId: number | string): Promise<{ files: TripFile[] }> {
    if (!navigator.onLine) {
      const cached = await offlineDb.tripFiles
        .where('trip_id')
        .equals(Number(tripId))
        .toArray()
      return { files: cached }
    }
    const result = await filesApi.list(tripId)
    upsertTripFiles(result.files)
    return result
  },
}
