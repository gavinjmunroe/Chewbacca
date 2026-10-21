"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Eye, EyeOff } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

function getPasswordStrength(pw: string): number {
  let score = 0;
  if (pw.length >= 8) score++;
  if (/[A-Z]/.test(pw)) score++;
  if (/[0-9]/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  return score;
}

const PW_STRENGTH_LABELS = ["", "Weak", "Fair", "Good", "Strong"];
const PW_STRENGTH_COLORS = ["", "bg-red-500", "bg-orange-500", "bg-yellow-400", "bg-green-500"];
const PW_STRENGTH_TEXT = ["", "text-red-400", "text-orange-400", "text-yellow-400", "text-green-400"];

export default function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const pwStrength = getPasswordStrength(password);

  // Supabase sends the recovery token as a hash fragment; the SSR client
  // will pick it up automatically via onAuthStateChange, but we ensure the
  // session is live before the user can submit.
  useEffect(() => {
    const supabase = createClient();
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        // Session is now active — user can set a new password.
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      setError(error.message);
      setLoading(false);
    } else {
      setSuccess(true);
      setTimeout(() => router.push("/dashboard"), 2000);
    }
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
          <p className="text-sm text-white/40">Set a new password</p>
        </div>

        {success ? (
          <div className="bg-white/[0.04] border border-white/10 rounded-3xl px-7 py-10 text-center">
            <div className="w-12 h-12 bg-green-500/10 border border-green-500/20 rounded-2xl flex items-center justify-center mx-auto mb-5">
              <svg className="w-5 h-5 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h2 className="text-lg font-bold text-white mb-2.5">Password updated</h2>
            <p className="text-sm text-white/45 leading-relaxed">
              Redirecting you to your dashboard…
            </p>
          </div>
        ) : (
          <div className="bg-white/[0.04] border border-white/10 rounded-3xl px-7 py-8">
            <form onSubmit={handleSubmit} className="space-y-5">

              {/* New Password */}
              <div>
                <label htmlFor="rp-password" className="block text-[13px] font-medium text-white/60 mb-2">
                  New password
                </label>
                <div className="relative">
                  <input
                    id="rp-password"
                    type={showPw ? "text" : "password"}
                    required
                    minLength={8}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Min. 8 characters"
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 pr-12 py-3 text-sm text-white placeholder-white/20 focus:outline-none focus:border-violet-500/50 focus:ring-2 focus:ring-violet-500/10 transition-all"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw((s) => !s)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60 transition-colors p-1"
                  >
                    {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {password.length > 0 && (
                  <div className="mt-2">
                    <div className="flex gap-1 mb-1">
                      {[1, 2, 3, 4].map((i) => (
                        <div
                          key={i}
                          className={`h-1 flex-1 rounded-full transition-all ${
                            i <= pwStrength ? PW_STRENGTH_COLORS[pwStrength] : "bg-white/10"
                          }`}
                        />
                      ))}
                    </div>
                    <p className={`text-[11px] font-medium ${PW_STRENGTH_TEXT[pwStrength]}`}>
                      {PW_STRENGTH_LABELS[pwStrength]}
                    </p>
                  </div>
                )}
              </div>

              {/* Confirm Password */}
              <div>
                <label htmlFor="rp-confirm" className="block text-[13px] font-medium text-white/60 mb-2">
                  Confirm password
                </label>
                <input
                  id="rp-confirm"
                  type={showPw ? "text" : "password"}
                  required
                  minLength={8}
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  placeholder="Re-enter your password"
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
                {loading ? "Updating…" : "Update Password"}
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
