"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Shield } from "lucide-react";

export default function AcceptTermsPage() {
  const router = useRouter();
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAccept() {
    setAccepting(true);
    setError(null);
    try {
      const res = await fetch("/api/terms-accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version: "1.0" }),
      });
      if (!res.ok) {
        setError("Failed to record acceptance. Please try again.");
        return;
      }
      router.push("/dashboard");
      router.refresh();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setAccepting(false);
    }
  }

  return (
    <div className="min-h-[70vh] flex items-center justify-center px-4">
      <div className="w-full max-w-lg bg-white/[0.04] border border-white/10 rounded-3xl p-8">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-xl bg-violet-500/15 flex items-center justify-center shrink-0">
            <Shield className="w-5 h-5 text-violet-400" />
          </div>
          <div>
            <h1 className="text-[18px] font-bold text-white">Terms of Service Update</h1>
            <p className="text-[12px] text-white/40">Version 1.0</p>
          </div>
        </div>

        <p className="text-[14px] text-white/60 leading-relaxed mb-6">
          Please review and accept the EGATS Terms of Service and Privacy Policy to continue
          using your account. By accepting, you agree to our platform rules, data handling
          practices, and community guidelines.
        </p>

        <div className="bg-white/[0.03] border border-white/[0.07] rounded-2xl p-5 mb-6 space-y-3 max-h-64 overflow-y-auto">
          <h2 className="text-[13px] font-semibold text-white">Summary of Key Terms</h2>
          <ul className="space-y-2 text-[13px] text-white/50 leading-relaxed list-disc list-inside">
            <li>You must be 18 years or older to use EGATS.</li>
            <li>Your profile and portfolio content must be accurate and original.</li>
            <li>Recruiters and dancers must honor confirmed bookings.</li>
            <li>Harassment, fraud, or impersonation will result in account termination.</li>
            <li>We collect and process your data as described in our Privacy Policy.</li>
            <li>You can request a full export or deletion of your data at any time.</li>
            <li>EGATS reserves the right to remove content that violates these terms.</li>
          </ul>
          <p className="text-[12px] text-white/30 pt-1">
            Full terms available at{" "}
            <Link href="/terms" className="text-violet-400 hover:text-violet-300 underline underline-offset-2">
              egats.com/terms
            </Link>{" "}
            and{" "}
            <Link href="/privacy" className="text-violet-400 hover:text-violet-300 underline underline-offset-2">
              egats.com/privacy
            </Link>.
          </p>
        </div>

        {error && (
          <div
            role="alert"
            className="bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 text-[13px] text-red-400 mb-4"
          >
            {error}
          </div>
        )}

        <button
          onClick={handleAccept}
          disabled={accepting}
          className="w-full bg-violet-600 hover:bg-violet-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold py-3.5 rounded-xl text-[14px] transition-colors"
        >
          {accepting ? "Recording acceptance..." : "I Accept: Continue to Dashboard"}
        </button>

        <p className="text-center text-[11px] text-white/25 mt-4">
          By clicking &ldquo;I Accept&rdquo;, you confirm you have read and agree to the Terms of Service (v1.0).
        </p>
      </div>
    </div>
  );
}
