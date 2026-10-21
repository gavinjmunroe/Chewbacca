import { daysApi } from '../api/client'
import { offlineDb, upsertDays } from '../db/offlineDb'
import type { Day } from '../types'

export const dayRepo = {
  async list(tripId: number | string): Promise<{ days: Day[] }> {
    if (!navigator.onLine) {
      const cached = await offlineDb.days
        .where('trip_id')
        .equals(Number(tripId))
        .sortBy('day_number' as keyof Day)
      return { days: cached as Day[] }
    }
    const result = await daysApi.list(tripId)
    upsertDays(result.days)
    return result
  },
}
