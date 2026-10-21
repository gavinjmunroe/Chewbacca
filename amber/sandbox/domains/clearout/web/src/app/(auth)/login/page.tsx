"use client"

export const dynamic = "force-dynamic"

import { useState } from "react"
import { createClient } from "@/lib/supabase/client"
import Link from "next/link"
import { Mail, ArrowRight, Loader2, Zap } from "lucide-react"

export default function LoginPage() {
  const [email, setEmail] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [isGoogleLoading, setIsGoogleLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const supabase = createClient()

  async function handleGoogleLogin() {
    setIsGoogleLoading(true)
    setError(null)
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${window.location.origin}/api/auth/callback`,
          scopes: "openid email profile",
        },
      })
      if (error) throw error
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong")
      setIsGoogleLoading(false)
    }
  }

  async function handleMagicLink(e: React.FormEvent) {
    e.preventDefault()
    if (!email) return
    setIsLoading(true)
    setError(null)

    try {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: `${window.location.origin}/api/auth/callback`,
        },
      })
      if (error) throw error
      setSent(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send login link")
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-co-dark flex items-center justify-center p-4">
      {/* Background glow */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[600px] h-[400px] bg-co-blue/5 rounded-full blur-3xl" />
      </div>

      <div className="w-full max-w-sm relative">
        {/* Logo */}
        <div className="text-center mb-8">
          <Link href="/" className="inline-flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-co-blue flex items-center justify-center">
              <Zap className="w-4 h-4 text-white" />
            </div>
            <span className="text-xl font-semibold text-white">ClearOut</span>
          </Link>
          <h1 className="mt-6 text-2xl font-semibold text-white">
            {sent ? "Check your inbox" : "Sign in to ClearOut"}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {sent
              ? `We sent a login link to ${email}`
              : "Your AI communication command center"}
          </p>
        </div>

        {!sent ? (
          <div className="glass rounded-2xl p-6 space-y-4">
            {/* Google OAuth */}
            <button
              onClick={handleGoogleLogin}
              disabled={isGoogleLoading}
              className="w-full flex items-center justify-center gap-3 px-4 py-3 rounded-xl bg-white text-gray-900 font-medium text-sm hover:bg-gray-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isGoogleLoading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <svg className="w-4 h-4" viewBox="0 0 24 24">
                  <path
                    fill="#4285F4"
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  />
                  <path
                    fill="#34A853"
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                  />
                  <path
                    fill="#EA4335"
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                  />
                </svg>
              )}
              Continue with Google
            </button>

            <div className="relative flex items-center">
              <div className="flex-grow border-t border-co-border" />
              <span className="px-3 text-xs text-muted-foreground">or</span>
              <div className="flex-grow border-t border-co-border" />
            </div>

            {/* Magic Link */}
            <form onSubmit={handleMagicLink} className="space-y-3">
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="your@email.com"
                  required
                  className="w-full pl-10 pr-4 py-3 rounded-xl bg-co-panel border border-co-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-co-blue transition-all"
                />
              </div>

              <button
                type="submit"
                disabled={isLoading || !email}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-co-blue text-white font-medium text-sm hover:bg-co-blue/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <>
                    Continue with email
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </form>

            {error && (
              <p className="text-xs text-red-400 text-center">{error}</p>
            )}

            <p className="text-xs text-muted-foreground text-center">
              By signing in, you agree to our{" "}
              <Link href="/terms" className="text-co-blue hover:underline">
                Terms
              </Link>{" "}
              and{" "}
              <Link href="/privacy" className="text-co-blue hover:underline">
                Privacy Policy
              </Link>
            </p>
          </div>
        ) : (
          <div className="glass rounded-2xl p-8 text-center">
            <div className="w-12 h-12 rounded-full bg-co-blue/20 flex items-center justify-center mx-auto mb-4">
              <Mail className="w-6 h-6 text-co-blue" />
            </div>
            <p className="text-sm text-muted-foreground mb-4">
              Click the link in the email to sign in. It expires in 10 minutes.
            </p>
            <button
              onClick={() => setSent(false)}
              className="text-xs text-co-blue hover:underline"
            >
              Use a different email
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
