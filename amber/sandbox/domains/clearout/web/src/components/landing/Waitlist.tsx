"use client"

import { useState } from "react"
import { Button } from "@/components/ui/Button"
import { ArrowRight, Check } from "lucide-react"

export function Waitlist() {
  const [email, setEmail] = useState("")
  const [name, setName] = useState("")
  const [useCase, setUseCase] = useState("")
  const [submitted, setSubmitted] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!email) return
    setIsLoading(true)
    setError(null)

    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, name, use_case: useCase || undefined }),
      })

      if (res.ok) {
        setSubmitted(true)
      } else {
        throw new Error("Failed to join")
      }
    } catch {
      setError("Something went wrong. Please try again.")
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <section id="waitlist" className="py-24 border-t border-co-border relative overflow-hidden">
      <div className="max-w-xl mx-auto px-4 text-center">
        {/* Background glow */}
        <div className="absolute left-1/2 -translate-x-1/2 top-0 w-[500px] h-[300px] bg-co-blue/8 rounded-full blur-[80px] pointer-events-none" />

        <div className="relative">
          <h2 className="text-3xl md:text-4xl font-bold text-gradient mb-4">
            Get early access
          </h2>
          <p className="text-muted-foreground mb-10 max-w-sm mx-auto">
            Join the waitlist for ClearOut. Early users get free extended Pro access and the ability to shape the product.
          </p>

          {!submitted ? (
            <form onSubmit={handleSubmit} className="glass rounded-2xl p-6 text-left space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label htmlFor="waitlist-name" className="text-xs text-muted-foreground">Name</label>
                  <input
                    id="waitlist-name"
                    type="text"
                    value={name}
                    onChange={e => setName(e.target.value)}
                    placeholder="Your name"
                    className="w-full bg-co-panel border border-co-border rounded-xl px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-co-blue"
                  />
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="waitlist-use-case" className="text-xs text-muted-foreground">I&apos;m a...</label>
                  <select
                    id="waitlist-use-case"
                    value={useCase}
                    onChange={e => setUseCase(e.target.value)}
                    className="w-full bg-co-panel border border-co-border rounded-xl px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-co-blue"
                  >
                    <option value="">Select</option>
                    <option value="founder">Founder</option>
                    <option value="exec">Executive</option>
                    <option value="student">Student</option>
                    <option value="team">Team lead</option>
                    <option value="other">Other</option>
                  </select>
                </div>
              </div>

              <div className="space-y-1.5">
                <label htmlFor="waitlist-email" className="text-xs text-muted-foreground">Email *</label>
                <input
                  id="waitlist-email"
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="you@email.com"
                  required
                  className="w-full bg-co-panel border border-co-border rounded-xl px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-co-blue"
                />
              </div>

              {error && <p className="text-xs text-red-400">{error}</p>}

              <Button type="submit" loading={isLoading} className="w-full">
                Join the waitlist
                <ArrowRight className="w-4 h-4" />
              </Button>

              <p className="text-[10px] text-muted-foreground text-center">
                No spam. We&apos;ll only email you about ClearOut access.
              </p>
            </form>
          ) : (
            <div className="glass rounded-2xl p-10 flex flex-col items-center gap-4">
              <div className="w-12 h-12 rounded-full bg-green-500/15 flex items-center justify-center">
                <Check className="w-6 h-6 text-green-400" />
              </div>
              <h3 className="text-lg font-semibold text-foreground">You&apos;re on the list</h3>
              <p className="text-sm text-muted-foreground text-center max-w-xs">
                We&apos;ll reach out soon with your early access. Thanks for believing in ClearOut.
              </p>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
