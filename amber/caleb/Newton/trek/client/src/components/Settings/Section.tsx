import React from 'react'
import type { LucideIcon } from 'lucide-react'

interface SectionProps {
  title: string
  icon: LucideIcon
  children: React.ReactNode
}

export default function Section({ title, icon: Icon, children }: SectionProps): React.ReactElement {
  return (
    <div className="rounded-xl border overflow-hidden" style={{ background: 'var(--bg-card)', borderColor: 'var(--border-primary)', marginBottom: 24 }}>
      <div className="px-6 py-4 border-b flex items-center gap-2" style={{ borderColor: 'var(--border-secondary)' }}>
        <Icon className="w-5 h-5" style={{ color: 'var(--text-secondary)' }} />
        <h2 className="font-semibold" style={{ color: 'var(--text-primary)' }}>{title}</h2>
      </div>
      <div className="p-6 space-y-4">
        {children}
      </div>
    </div>
  )
}
