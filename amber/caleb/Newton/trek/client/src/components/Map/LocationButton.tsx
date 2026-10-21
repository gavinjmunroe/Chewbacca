import { Navigation, LocateFixed, Locate } from 'lucide-react'
import type { TrackingMode } from '../../hooks/useGeolocation'

interface Props {
  mode: TrackingMode
  error: string | null
  onClick: () => void
  // Offset from the bottom edge — callers push this up above the mobile
  // bottom nav. Defaults to 20px for desktop.
  bottomOffset?: number
}

// Three-state FAB. Matches the Apple/Google Maps pattern:
//   off    → outline locate icon
//   show   → filled locate (blue dot is visible on the map)
//   follow → filled navigation arrow (map follows + rotates with heading)
export default function LocationButton({ mode, error, onClick, bottomOffset = 20 }: Props) {
  const Icon = mode === 'follow' ? Navigation : mode === 'show' ? LocateFixed : Locate
  const isActive = mode !== 'off'
  const title = error
    ? error
    : mode === 'off'
      ? 'Show my location'
      : mode === 'show'
        ? 'Follow my location'
        : 'Stop following'

  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      style={{
        position: 'absolute',
        bottom: bottomOffset,
        right: 12,
        zIndex: 1000,
        width: 42,
        height: 42,
        borderRadius: '50%',
        border: 'none',
        cursor: 'pointer',
        background: isActive ? '#3b82f6' : 'var(--bg-card, white)',
        color: isActive ? 'white' : (error ? '#ef4444' : 'var(--text-muted, #6b7280)'),
        boxShadow: '0 2px 10px rgba(0,0,0,0.25)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        transition: 'background 0.2s, color 0.2s',
      }}
    >
      <Icon size={20} strokeWidth={mode === 'follow' ? 2.5 : 2} />
    </button>
  )
}
