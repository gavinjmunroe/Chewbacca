/**
 * usePendingMutations — returns the set of entity IDs that have a pending
 * or syncing mutation for a given trip.
 *
 * Components use this to render a clock/pending indicator on list rows.
 * Polls Dexie every 2 s so the indicator clears automatically once synced.
 */
import { useState, useEffect } from 'react'
import { mutationQueue } from '../sync/mutationQueue'

const POLL_MS = 2_000

export function usePendingMutations(tripId: number): Set<number> {
  const [pendingIds, setPendingIds] = useState<Set<number>>(new Set())

  useEffect(() => {
    let cancelled = false

    async function refresh() {
      const pending = await mutationQueue.pending(tripId)
      if (cancelled) return

      const ids = new Set<number>()
      for (const m of pending) {
        // Extract entity id from the mutation URL (last numeric segment)
        const match = m.url.match(/\/(\d+)$/)
        if (match) ids.add(Number(match[1]))
        // Also include tempId for offline-created items
        if (m.tempId !== undefined) ids.add(m.tempId)
      }
      setPendingIds(ids)
    }

    refresh()
    const timer = setInterval(refresh, POLL_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [tripId])

  return pendingIds
}
