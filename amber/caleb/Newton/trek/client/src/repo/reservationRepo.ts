import { reservationsApi } from '../api/client'
import { offlineDb, upsertReservations } from '../db/offlineDb'
import type { Reservation } from '../types'

export const reservationRepo = {
  async list(tripId: number | string): Promise<{ reservations: Reservation[] }> {
    if (!navigator.onLine) {
      const cached = await offlineDb.reservations
        .where('trip_id')
        .equals(Number(tripId))
        .toArray()
      return { reservations: cached }
    }
    const result = await reservationsApi.list(tripId)
    upsertReservations(result.reservations)
    return result
  },
}
