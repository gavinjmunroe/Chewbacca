import React, { useCallback, useState } from 'react'
import { Copy, Check } from 'lucide-react'

interface CopyButtonProps {
  value: string
  size?: number
  title?: string
  className?: string
  onCopy?: () => void
}

// Button that morphs between copy icon and check icon for 1.5s after click.
export function CopyButton({ value, size = 14, title, className, onCopy }: CopyButtonProps): React.ReactElement {
  const [copied, setCopied] = useState(false)

  const handleClick = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      onCopy?.()
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      // noop
    }
  }, [value, onCopy])

  return (
    <button
      type="button"
      onClick={handleClick}
      title={title}
      className={className}
      style={{
        position: 'relative',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: size + 12,
        height: size + 12,
        border: 'none',
        background: 'transparent',
        color: copied ? '#22c55e' : 'var(--text-muted)',
        cursor: 'pointer',
        borderRadius: 6,
      }}
    >
      <Copy size={size} style={{
        position: 'absolute',
        transition: 'opacity 200ms cubic-bezier(0.23,1,0.32,1), transform 200ms cubic-bezier(0.23,1,0.32,1)',
        opacity: copied ? 0 : 1,
        transform: copied ? 'scale(0.6) rotate(-45deg)' : 'scale(1) rotate(0)',
      }} />
      <Check size={size} style={{
        position: 'absolute',
        transition: 'opacity 200ms cubic-bezier(0.23,1,0.32,1), transform 200ms cubic-bezier(0.23,1,0.32,1)',
        opacity: copied ? 1 : 0,
        transform: copied ? 'scale(1) rotate(0)' : 'scale(0.6) rotate(45deg)',
        strokeWidth: 2.5,
      }} />
    </button>
  )
}

export default CopyButton
