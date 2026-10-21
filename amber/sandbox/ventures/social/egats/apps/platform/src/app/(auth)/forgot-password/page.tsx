"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(0);

  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [countdown]);

  async function sendReset() {
    setLoading(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/reset-password`,
    });
    if (error) {
      setError(error.message);
      setLoading(false);
    } else {
      setSent(true);
      setLoading(false);
      setCountdown(60);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    await sendReset();
  }

  return (
    <div className="min-h-screen bg-[#09090B] flex flex-col items-center justify-center px-6">
      <div className="w-full max-w-[420px]">

        {/* Header */}
        <div className="text-center mb-9">
          <Link href="/" className="inline-flex items-center gap-2 mb-4">
            {/* eslint_disable-next-line @next/next/no-img-element */}
            <img
              src="/egatslogosimple.png"
              alt="EGATS"
              className="w-7 h-7 object-contain"
              style={{ filter: "invert(40%) sepia(1) saturate(4) hue-rotate(242deg) brightness(1.1)" }}
            />
            <span className="text-lg font-bold text-white tracking-tight">EGATS</span>
          </Link>
          <p className="text-sm text-white/40">Reset your password</p>
        </div>

        {sent ? (
          <div className="bg-white/[0.04] border border-white/10 rounded-3xl px-7 py-10 text-center">
            <div className="w-12 h-12 bg-green-500/10 border border-green-500/20 rounded-2xl flex items-center justify-center mx-auto mb-5">
              <svg className="w-5 h-5 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h2 className="text-lg font-bold text-white mb-2.5">Check your inbox</h2>
            <p className="text-sm text-white/45 leading-relaxed mb-5">
              We sent a reset link to{" "}
              <span className="text-white/70 font-medium">{email}</span>.
              Check your spam folder if it doesn&apos;t arrive within a minute.
            </p>
            <button
              type="button"
              disabled={countdown > 0 || loading}
              onClick={sendReset}
              className="w-full bg-violet-600 hover:bg-violet-500 disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold text-sm py-3 rounded-xl transition-colors tracking-tight mb-5"
            >
              {countdown > 0 ? `Resend in ${countdown}s` : loading ? "Sending…" : "Resend Email"}
            </button>
            {error && (
              <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 text-[13px] text-red-400 leading-relaxed mb-4">
                {error}
              </div>
            )}
            <Link
              href="/login"
              className="text-[13px] text-violet-400 hover:text-violet-300 transition-colors"
            >
              Back to Sign In
            </Link>
          </div>
        ) : (
          <div className="bg-white/[0.04] border border-white/10 rounded-3xl px-7 py-8">
            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label htmlFor="fp-email" className="block text-[13px] font-medium text-white/60 mb-2">
                  Email address
                </label>
                <input
                  id="fp-email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-white/20 focus:outline-none focus:border-violet-500/50 focus:ring-2 focus:ring-violet-500/10 transition-all"
                />
              </div>

              {error && (
                <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 text-[13px] text-red-400 leading-relaxed">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-violet-600 hover:bg-violet-500 disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold text-sm py-3.5 rounded-xl transition-colors tracking-tight"
              >
                {loading ? "Sending…" : "Send Reset Link"}
              </button>
            </form>

            <p className="text-center text-[13px] text-white/30 mt-6">
              <Link href="/login" className="text-violet-400 hover:text-violet-300 transition-colors">
                Back to Sign In
              </Link>
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
