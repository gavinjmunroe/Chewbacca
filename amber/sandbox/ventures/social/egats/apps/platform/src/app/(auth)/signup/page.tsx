"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Eye, EyeOff } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Suspense } from "react";

function SignupForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const defaultRole = searchParams.get("role") as "creative" | "recruiter" | null;
  const refCode = searchParams.get("ref");

  const [role, setRole] = useState<"creative" | "recruiter">(defaultRole || "creative");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [honeypot, setHoneypot] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  function getPasswordStrength(pw: string): number {
    let score = 0;
    if (pw.length >= 8) score++;
    if (/[A-Z]/.test(pw)) score++;
    if (/[0-9]/.test(pw)) score++;
    if (/[^A-Za-z0-9]/.test(pw)) score++;
    return score;
  }

  const pwStrength = getPasswordStrength(password);
  const pwStrengthLabels = ["", "Weak", "Fair", "Good", "Strong"];
  const pwStrengthColors = ["", "bg-red-500", "bg-orange-500", "bg-yellow-400", "bg-green-500"];
  const pwStrengthTextColors = ["", "text-red-400", "text-orange-400", "text-yellow-400", "text-green-400"];

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (honeypot) {
      setSuccess(true); // silently fake success
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords don't match.");
      return;
    }
    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { display_name: displayName, role },
        emailRedirectTo: `${window.location.origin}/dashboard`,
      },
    });
    if (error) {
      const msg = error.message;
      let friendly = msg;
      if (msg.includes("over_email_send_rate_limit") || msg.includes("rate_limit") || msg.includes("Too many") || msg.includes("too many")) {
        friendly = "Too many accounts created from this device. Please try again later.";
      }
      setError(friendly);
      setLoading(false);
    } else {
      // Record terms acceptance
      await fetch("/api/terms-accept", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ version: "1.0" }) });
      // Record referral if present — best-effort, fire and forget
      if (refCode) {
        fetch("/api/referral", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ referralCode: refCode }),
        }).catch(() => { /* ignore */ });
      }
      setSuccess(true);
    }
  }

  if (success) {
    return (
      <div className="min-h-screen bg-[#09090B] flex flex-col items-center justify-center px-6">
        <div className="w-full max-w-md text-center">
          <div className="w-12 h-12 bg-violet-500/15 border border-violet-500/25 rounded-2xl flex items-center justify-center mx-auto mb-6">
            <svg className="w-6 h-6 text-violet-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75" />
            </svg>
          </div>
          <h2 className="text-2xl font-bold mb-3">Check your email</h2>
          <p className="text-white/50 text-sm leading-relaxed">
            We sent a confirmation link to <strong className="text-white">{email}</strong>.
            Click it to activate your account and get started.
          </p>
          <Link href="/login" className="inline-block mt-8 text-violet-400 hover:text-violet-300 text-sm transition-colors">
            Back to Sign In
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#09090B] flex flex-col items-center justify-center px-6">
      <div className="w-full max-w-md">
        <div className="text-center mb-10">
          <Link href="/" className="text-2xl font-bold gradient-text">EGATS</Link>
          <p className="text-white/40 text-sm mt-2">Create your account</p>
        </div>
        <div className="bg-white/[0.04] border border-white/10 rounded-3xl p-8">
          {/* Role Toggle */}
          <div className="flex gap-2 bg-white/5 rounded-xl p-1 mb-6">
            <button
              type="button"
              onClick={() => setRole("creative")}
              className={`flex-1 py-2.5 rounded-lg text-sm font-semibold transition-all ${
                role === "creative"
                  ? "bg-violet-600 text-white"
                  : "text-white/40 hover:text-white/70"
              }`}
            >
              I&apos;m a Creative
            </button>
            <button
              type="button"
              onClick={() => setRole("recruiter")}
              className={`flex-1 py-2.5 rounded-lg text-sm font-semibold transition-all ${
                role === "recruiter"
                  ? "bg-amber-500 text-black"
                  : "text-white/40 hover:text-white/70"
              }`}
            >
              I Hire Creatives
            </button>
          </div>
          <form onSubmit={handleSignup} className="space-y-5">
            <input
              type="text"
              name="website"
              value={honeypot}
              onChange={e => setHoneypot(e.target.value)}
              tabIndex={-1}
              autoComplete="off"
              aria-hidden="true"
              style={{ position: "absolute", left: "-9999px", opacity: 0, height: 0, width: 0 }}
            />
            <div>
              <label htmlFor="signup-name" className="block text-sm text-white/60 mb-2">
                {role === "creative" ? "Your Name / Stage Name" : "Your Name"}
              </label>
              <input
                id="signup-name"
                type="text"
                required
                autoComplete="name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-white/20 focus:outline-none focus:border-violet-500/50 transition-colors"
                placeholder={role === "creative" ? "Jordan M." : "Lisa Chen"}
              />
            </div>
            <div>
              <label htmlFor="signup-email" className="block text-sm text-white/60 mb-2">Email</label>
              <input
                id="signup-email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-white/20 focus:outline-none focus:border-violet-500/50 transition-colors"
                placeholder="you@example.com"
              />
            </div>
            <div>
              <label htmlFor="signup-password" className="block text-sm text-white/60 mb-2">Password</label>
              <div className="relative">
                <input
                  id="signup-password"
                  type={showPw ? "text" : "password"}
                  required
                  minLength={8}
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 pr-12 py-3 text-sm text-white placeholder-white/20 focus:outline-none focus:border-violet-500/50 transition-colors"
                  placeholder="At least 8 characters"
                />
                <button
                  type="button"
                  onClick={() => setShowPw(s => !s)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60 transition-colors"
                  style={{ background: "none", border: "none", cursor: "pointer", padding: 0, display: "flex" }}
                >
                  {showPw ? <EyeOff style={{ width: 15, height: 15 }} /> : <Eye style={{ width: 15, height: 15 }} />}
                </button>
              </div>
              {password.length > 0 && (
                <div className="mt-2">
                  <div className="flex gap-1 mb-1">
                    {[1, 2, 3, 4].map((i) => (
                      <div
                        key={i}
                        className={`h-1 flex-1 rounded-full transition-all ${
                          i <= pwStrength ? pwStrengthColors[pwStrength] : "bg-white/10"
                        }`}
                      />
                    ))}
                  </div>
                  <p className={`text-[11px] font-medium ${pwStrengthTextColors[pwStrength]}`}>
                    {pwStrengthLabels[pwStrength]}
                  </p>
                </div>
              )}
            </div>
            <div>
              <label htmlFor="signup-confirm-password" className="block text-sm text-white/60 mb-2">Confirm Password</label>
              <input
                id="signup-confirm-password"
                type={showPw ? "text" : "password"}
                required
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className={`w-full bg-white/5 border rounded-xl px-4 py-3 text-sm text-white placeholder-white/20 focus:outline-none focus:border-violet-500/50 transition-colors ${
                  confirmPassword.length > 0 && confirmPassword !== password
                    ? "border-red-500/50"
                    : "border-white/10"
                }`}
                placeholder="Re-enter your password"
              />
              {confirmPassword.length > 0 && confirmPassword !== password && (
                <p className="text-[11px] text-red-400 mt-1">Passwords don&apos;t match.</p>
              )}
            </div>
            {error && (
              <div role="alert" aria-live="assertive" className="bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 text-red-400 text-sm">
                {error}
              </div>
            )}
            <button
              type="submit"
              disabled={loading}
              className={`w-full disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-3.5 rounded-xl transition-colors text-sm ${
                role === "creative"
                  ? "bg-violet-600 hover:bg-violet-500"
                  : "bg-amber-500 hover:bg-amber-400 text-black"
              }`}
            >
              {loading ? "Creating account..." : "Create Account"}
            </button>
          </form>
          <p className="text-center text-sm text-white/30 mt-6">
            Already have an account?{" "}
            <Link href="/login" className="text-violet-400 hover:text-violet-300 transition-colors">
              Sign in
            </Link>
          </p>
        </div>
        <p className="text-center text-xs text-white/20 mt-6 leading-relaxed px-4">
          By creating an account, you agree to EGATS{" "}
          <Link href="/terms" className="text-white/40 hover:text-white/60 underline">Terms of Service</Link>{" "}
          and{" "}
          <Link href="/privacy" className="text-white/40 hover:text-white/60 underline">Privacy Policy</Link>.
          Our verification system helps build trust across the community.
        </p>
      </div>
    </div>
  );
}

export default function SignupPage() {
  return (
    <Suspense>
      <SignupForm />
    </Suspense>
  );
}
