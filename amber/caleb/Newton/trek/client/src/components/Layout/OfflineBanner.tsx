/**
 * OfflineBanner — connectivity + sync state indicator.
 *
 * States:
 *   offline + N queued  →  amber pill "Offline · N queued"
 *   offline + 0 queued  →  amber pill "Offline"
 *   online  + N pending →  blue pill  "Syncing N…"
 *   online  + 0 pending →  hidden
 *
 * Rendered as a small floating pill anchored to the bottom-center of the
 * viewport so it never competes with top navigation or sticky modal
 * headers. On mobile it hovers just above the bottom tab bar.
 */
import React, { useState, useEffect } from 'react'
import { WifiOff, RefreshCw } from 'lucide-react'
import { mutationQueue } from '../../sync/mutationQueue'

const POLL_MS = 3_000

export default function OfflineBanner(): React.ReactElement | null {
  const [isOnline, setIsOnline] = useState(navigator.onLine)
  const [pendingCount, setPendingCount] = useState(0)

  useEffect(() => {
    const onOnline  = () => setIsOnline(true)
    const onOffline = () => setIsOnline(false)
    window.addEventListener('online',  onOnline)
    window.addEventListener('offline', onOffline)
    return () => {
      window.removeEventListener('online',  onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    async function poll() {
      const n = await mutationQueue.pendingCount()
      if (!cancelled) setPendingCount(n)
    }
    poll()
    const id = setInterval(poll, POLL_MS)
    return () => { cancelled = true; clearInterval(id) }
  }, [])

  const hidden = isOnline && pendingCount === 0
  if (hidden) return null

  const offline = !isOnline
  const bg    = offline ? '#92400e' : '#1e40af'
  const text  = '#fff'

  const label = offline
    ? pendingCount > 0
      ? `Offline · ${pendingCount} queued`
      : 'Offline'
    : `Syncing ${pendingCount}…`

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed',
        // Hover above the mobile bottom nav; on desktop --bottom-nav-h is 0,
        // so the pill sits 16px from the bottom.
        bottom: 'calc(var(--bottom-nav-h) + 16px)',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 9999,
        background: bg,
        color: text,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '6px 14px',
        borderRadius: 999,
        boxShadow: '0 4px 16px rgba(0,0,0,0.18), 0 0 0 1px rgba(255,255,255,0.08)',
        fontSize: 12,
        fontWeight: 600,
        whiteSpace: 'nowrap',
        pointerEvents: 'none',
      }}
    >
      {offline
        ? <WifiOff size={12} />
        : <RefreshCw size={12} style={{ animation: 'spin 1s linear infinite' }} />
      }
      {label}
    </div>
  )
}
