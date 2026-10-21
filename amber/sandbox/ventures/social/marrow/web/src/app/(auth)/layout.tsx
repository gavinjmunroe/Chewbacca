import Link from 'next/link'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Marrow — Sign in',
}

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-stone-50 flex flex-col">
      {/* Top bar */}
      <header className="fixed top-0 inset-x-0 z-10 h-14 bg-white border-b border-stone-100 flex items-center px-6">
        <Link href="/" className="flex items-center gap-2 group">
          <div className="w-7 h-7 rounded-lg bg-indigo-600 flex items-center justify-center transition-transform group-hover:scale-105">
            <span className="text-white font-bold text-sm">M</span>
          </div>
          <span className="font-semibold text-stone-900 text-[15px]">Marrow</span>
        </Link>
      </header>

      {/* Content */}
      <main className="flex-1 flex items-center justify-center pt-14 px-4 py-12">
        {children}
      </main>

      {/* Footer */}
      <footer className="py-4 text-center">
        <p className="text-xs text-stone-400">
          © 2026 Marrow · The Recruiting OS for Student Organizations
        </p>
      </footer>
    </div>
  )
}
