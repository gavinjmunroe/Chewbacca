import { useEffect, useMemo, useRef, useState } from 'react'
import { Plane, X } from 'lucide-react'
import { airportsApi } from '../../api/client'
import { useTranslation } from '../../i18n'

export interface Airport {
  iata: string
  icao: string | null
  name: string
  city: string
  country: string
  lat: number
  lng: number
  tz: string
}

interface Props {
  value: Airport | null
  onChange: (airport: Airport | null) => void
  placeholder?: string
  style?: React.CSSProperties
}

function formatLabel(a: Airport) {
  return `${a.city || a.name} (${a.iata})`
}

export default function AirportSelect({ value, onChange, placeholder, style }: Props) {
  const { t, locale } = useTranslation()
  const countryName = useMemo(() => {
    try { return new Intl.DisplayNames([locale || 'en'], { type: 'region' }) } catch { return null }
  }, [locale])
  const displayCountry = (code: string) => {
    if (!code) return ''
    try { return countryName?.of(code) || code } catch { return code }
  }
  const [query, setQuery] = useState(value ? formatLabel(value) : '')
  const [open, setOpen] = useState(false)
  const [results, setResults] = useState<Airport[]>([])
  const [highlight, setHighlight] = useState(-1)
  const [loading, setLoading] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    setQuery(value ? formatLabel(value) : '')
  }, [value])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    if (open) document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    const trimmed = query.trim()
    if (trimmed.length < 2 || (value && trimmed === formatLabel(value))) {
      setResults([])
      return
    }
    debounceRef.current = setTimeout(async () => {
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller
      setLoading(true)
      try {
        const data = await airportsApi.search(trimmed, controller.signal)
        setResults(Array.isArray(data) ? data : [])
        setHighlight(-1)
      } catch (err: any) {
        if (err?.name !== 'AbortError' && err?.name !== 'CanceledError') {
          setResults([])
        }
      } finally {
        setLoading(false)
      }
    }, 220)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [query, value])

  const pick = (a: Airport) => {
    onChange(a)
    setQuery(formatLabel(a))
    setOpen(false)
    setResults([])
  }

  const clear = () => {
    onChange(null)
    setQuery('')
    setResults([])
  }

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open || results.length === 0) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight(h => Math.min(h + 1, results.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight(h => Math.max(h - 1, 0)) }
    else if (e.key === 'Enter' && highlight >= 0) { e.preventDefault(); pick(results[highlight]) }
    else if (e.key === 'Escape') setOpen(false)
  }

  return (
    <div ref={wrapRef} style={{ position: 'relative', ...style }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 10px', background: 'var(--bg-tertiary)', borderRadius: 10, border: '1px solid var(--border-primary)' }}>
        <Plane size={14} style={{ color: 'var(--text-faint)', flexShrink: 0 }} />
        <input
          type="text"
          value={query}
          placeholder={placeholder ?? t('airport.searchPlaceholder')}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); if (value) onChange(null) }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKey}
          style={{ flex: 1, minWidth: 0, background: 'transparent', border: 'none', outline: 'none', color: 'var(--text-primary)', fontSize: 13 }}
        />
        {value && (
          <button type="button" onClick={clear} style={{ background: 'transparent', border: 'none', padding: 2, cursor: 'pointer', color: 'var(--text-faint)', display: 'flex' }} aria-label="Clear">
            <X size={14} />
          </button>
        )}
      </div>

      {open && (loading || results.length > 0) && (
        <div style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, background: 'var(--bg-card)', border: '1px solid var(--border-primary)', borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,0.18)', maxHeight: 260, overflowY: 'auto', zIndex: 1000 }}>
          {loading && results.length === 0 && (
            <div style={{ padding: 10, fontSize: 12, color: 'var(--text-faint)' }}>{t('common.loading')}</div>
          )}
          {results.map((a, i) => (
            <button
              key={a.iata}
              type="button"
              onClick={() => pick(a)}
              onMouseEnter={() => setHighlight(i)}
              style={{
                display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                padding: '8px 12px', border: 'none', cursor: 'pointer', textAlign: 'left',
                background: i === highlight ? 'var(--bg-hover)' : 'transparent',
                color: 'var(--text-primary)', fontFamily: 'inherit',
              }}
            >
              <span style={{ fontFamily: 'ui-monospace, SFMono-Regular, monospace', fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', minWidth: 32 }}>{a.iata}</span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.city || a.name}</div>
                <div style={{ fontSize: 11, color: 'var(--text-faint)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.name}{a.country ? ` · ${displayCountry(a.country)}` : ''}</div>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
