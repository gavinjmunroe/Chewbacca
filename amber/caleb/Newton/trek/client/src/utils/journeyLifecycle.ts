export type JourneyLifecycle = 'archived' | 'live' | 'upcoming' | 'completed' | 'draft'

export function computeJourneyLifecycle(
  status: string,
  tripDateMin: string | null | undefined,
  tripDateMax: string | null | undefined,
): JourneyLifecycle {
  if (status === 'archived') return 'archived'

  if (tripDateMin && tripDateMax) {
    const today = new Date().toISOString().split('T')[0]
    if (tripDateMin <= today && today <= tripDateMax) return 'live'
    if (tripDateMin > today) return 'upcoming'
    return 'completed'
  }

  if (!tripDateMin && !tripDateMax) {
    return 'draft'
  }

  // Single boundary: only start or only end
  if (tripDateMin && !tripDateMax) {
    const today = new Date().toISOString().split('T')[0]
    return tripDateMin > today ? 'upcoming' : 'live'
  }
  if (!tripDateMin && tripDateMax) {
    const today = new Date().toISOString().split('T')[0]
    return tripDateMax < today ? 'completed' : 'live'
  }

  return 'completed'
}
