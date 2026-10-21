"use client"

import Link from "next/link"
import { useState } from "react"
import { Zap, Menu, X } from "lucide-react"
import { Button } from "@/components/ui/Button"

export function LandingNav() {
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 border-b border-white/[0.06] bg-co-dark/80 backdrop-blur-xl">
      <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2 group">
          <div className="w-7 h-7 rounded-lg bg-co-blue flex items-center justify-center group-hover:bg-co-blue/80 transition-colors">
            <Zap className="w-3.5 h-3.5 text-white" />
          </div>
          <span className="font-semibold text-white text-sm">ClearOut</span>
        </Link>

        {/* Desktop nav */}
        <div className="hidden md:flex items-center gap-6">
          {["Features", "How it works", "Pricing"].map(item => (
            <a
              key={item}
              href={`#${item.toLowerCase().replace(/\s+/g, "-")}`}
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              {item}
            </a>
          ))}
        </div>

        {/* CTA */}
        <div className="hidden md:flex items-center gap-2">
          <Link href="/login">
            <Button variant="ghost" size="sm">Sign in</Button>
          </Link>
          <a href="#waitlist">
            <Button size="sm">Get early access</Button>
          </a>
        </div>

        {/* Mobile menu */}
        <button
          className="md:hidden p-1.5 text-muted-foreground hover:text-foreground"
          onClick={() => setMenuOpen(!menuOpen)}
        >
          {menuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      </div>

      {/* Mobile nav */}
      {menuOpen && (
        <div className="md:hidden border-t border-co-border bg-co-dark px-4 py-4 space-y-3">
          {["Features", "How it works", "Pricing"].map(item => (
            <a
              key={item}
              href={`#${item.toLowerCase().replace(/\s+/g, "-")}`}
              className="block text-sm text-muted-foreground"
              onClick={() => setMenuOpen(false)}
            >
              {item}
            </a>
          ))}
          <div className="pt-2 flex flex-col gap-2">
            <Link href="/login" onClick={() => setMenuOpen(false)}>
              <Button variant="secondary" className="w-full">Sign in</Button>
            </Link>
            <a href="#waitlist" onClick={() => setMenuOpen(false)}>
              <Button className="w-full">Get early access</Button>
            </a>
          </div>
        </div>
      )}
    </nav>
  )
}
