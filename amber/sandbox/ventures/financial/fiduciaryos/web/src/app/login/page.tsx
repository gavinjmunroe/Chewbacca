"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  useEffect(() => { inputRef.current?.focus(); }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });

    if (res.ok) {
      setLoading(false);
      router.push("/dashboard");
    } else {
      const data = await res.json();
      setError(data.error ?? "Incorrect password");
      setPassword("");
      setLoading(false);
      inputRef.current?.focus();
    }
  }

  return (
    <main
      className="flex min-h-dvh items-center justify-center px-6"
      style={{ background: "var(--bg)" }}
    >
      <div
        aria-hidden
        style={{
          position: "fixed", inset: 0, pointerEvents: "none",
          background: "radial-gradient(ellipse 60% 40% at 50% 40%, rgba(48,209,88,0.04) 0%, transparent 70%)",
        }}
      />

      <div className="fade-up w-full max-w-sm">
        <div className="mb-10 flex flex-col items-center gap-4">
          <div
            style={{
              width: 64, height: 64, borderRadius: 18,
              background: "linear-gradient(145deg, #1c2e1e, #0d1a0f)",
              border: "1px solid rgba(48,209,88,0.2)",
              display: "flex", alignItems: "center", justifyContent: "center",
              boxShadow: "0 8px 32px rgba(48,209,88,0.12)",
            }}
          >
            <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
              <path d="M16 4 L28 10 L28 22 L16 28 L4 22 L4 10 Z" stroke="#30d158" strokeWidth="1.5" fill="none" strokeLinejoin="round"/>
              <path d="M16 10 L22 13.5 L22 20.5 L16 24 L10 20.5 L10 13.5 Z" fill="rgba(48,209,88,0.15)" stroke="#30d158" strokeWidth="1" strokeLinejoin="round"/>
            </svg>
          </div>
          <div className="text-center">
            <h1 className="t-title2" style={{ color: "var(--label)" }}>FiduciaryOS</h1>
            <p className="t-footnote mt-1" style={{ color: "var(--label-3)" }}>Fiduciary-grade wealth management · Authorized access only</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="sr-only" htmlFor="password">Password</label>
            <input
              ref={inputRef}
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              autoComplete="current-password"
              required
              style={{
                width: "100%",
                padding: "14px 16px",
                background: "var(--surface-1)",
                border: error ? "1px solid var(--red)" : "1px solid var(--separator)",
                borderRadius: 12,
                color: "var(--label)",
                fontSize: 17,
                fontFamily: "var(--font)",
                letterSpacing: "-0.41px",
                outline: "none",
                transition: "border-color 0.2s",
              }}
              onFocus={(e) => { if (!error) e.target.style.borderColor = "var(--blue)"; }}
              onBlur={(e) => { e.target.style.borderColor = error ? "var(--red)" : "var(--separator)"; }}
            />
          </div>

          {error && (
            <p role="alert" className="t-footnote fade-in" style={{ color: "var(--red)", paddingLeft: 4 }}>
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading || !password}
            style={{
              width: "100%",
              padding: "14px 16px",
              background: loading || !password ? "var(--surface-2)" : "var(--blue)",
              color: loading || !password ? "var(--label-3)" : "#fff",
              border: "none",
              borderRadius: 12,
              fontSize: 17,
              fontWeight: 600,
              fontFamily: "var(--font)",
              cursor: loading || !password ? "not-allowed" : "pointer",
              transition: "background 0.2s, color 0.2s",
              letterSpacing: "-0.41px",
            }}
          >
            {loading ? "Signing in…" : "Sign In"}
          </button>
        </form>
      </div>
    </main>
  );
}
