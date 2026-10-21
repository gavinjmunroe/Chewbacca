"use client";
import { useEffect, useState } from "react";
import { ShieldCheck, ShieldAlert, ShieldOff, Clock, CheckCircle2, XCircle, ChevronRight, Send } from "lucide-react";
import VerificationBadge from "@/components/verification-badge";
import type { VerificationTier } from "@/types/database";

interface VerificationRecord {
  id: string;
  tier_awarded: VerificationTier;
  verifier_id: string | null;
  revoked: boolean;
  notes: string | null;
  created_at: string;
  verified_at: string;
  camp?: { name: string; city: string; state: string } | null;
}

function recordStatus(r: VerificationRecord): "pending" | "approved" | "revoked" {
  if (r.revoked) return "revoked";
  if (r.verifier_id) return "approved";
  return "pending";
}

const TIER_INFO: Record<VerificationTier, { label: string; description: string; requirements: string[] }> = {
  "0": {
    label: "Unverified",
    description: "Basic account with no verification. You can browse and apply to open listings.",
    requirements: [],
  },
  "1": {
    label: "Verified Dancer",
    description: "Identity confirmed. Recruiters see your profile as a real, legitimate dancer.",
    requirements: [
      "Complete your profile (bio, location, styles, experience)",
      "Upload at least one portfolio clip",
      "Attend or apply through a verified EGATS camp",
    ],
  },
  "2": {
    label: "Elite Verified",
    description: "Professional-grade verification. Access premium listings and featured placement.",
    requirements: [
      "Hold Tier 1 verification",
      "Minimum 3 portfolio clips",
      "At least 2 completed bookings",
      "Average rating above 4.0",
      "Evaluator review and approval",
    ],
  },
};

function TierCard({ tier }: { tier: VerificationTier }) {
  const info = TIER_INFO[tier];
  return (
    <div className="bg-white/[0.03] border border-white/[0.08] rounded-xl p-4 flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <VerificationBadge tier={tier} size="sm" showLabel />
      </div>
      <p className="text-xs text-white/50 leading-relaxed">{info.description}</p>
      {info.requirements.length > 0 && (
        <ul className="mt-1 space-y-1">
          {info.requirements.map((r) => (
            <li key={r} className="flex items-start gap-2 text-[11px] text-white/40">
              <ChevronRight className="w-3 h-3 mt-0.5 shrink-0 text-violet-400/60" />
              {r}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function RecordRow({ record }: { record: VerificationRecord }) {
  const status = recordStatus(record);
  const date = new Date(record.created_at).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const reviewDate = record.verifier_id
    ? new Date(record.verified_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    : null;

  return (
    <div className="flex items-start gap-3 py-3 border-b border-white/[0.06] last:border-0">
      <div className="mt-0.5">
        {status === "pending" && <Clock className="w-4 h-4 text-amber-400" />}
        {status === "approved" && <CheckCircle2 className="w-4 h-4 text-green-400" />}
        {status === "revoked" && <XCircle className="w-4 h-4 text-red-400" />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold text-white">
            Tier {record.tier_awarded} verification
          </span>
          <span
            className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${
              status === "pending"
                ? "bg-amber-500/15 text-amber-400"
                : status === "approved"
                ? "bg-green-500/15 text-green-400"
                : "bg-red-500/15 text-red-400"
            }`}
          >
            {status.charAt(0).toUpperCase() + status.slice(1)}
          </span>
          {record.camp && (
            <span className="text-[10px] text-white/35">
              via {record.camp.name}, {record.camp.city}
            </span>
          )}
        </div>
        <p className="text-xs text-white/35 mt-0.5">
          Submitted {date}{reviewDate ? ` · Reviewed ${reviewDate}` : ""}
        </p>
        {record.notes && (
          <p className="text-xs text-white/50 mt-1.5 bg-white/[0.03] rounded-lg px-3 py-2 italic">
            &ldquo;{record.notes}&rdquo;
          </p>
        )}
      </div>
    </div>
  );
}

export default function VerificationPage() {
  const [records, setRecords] = useState<VerificationRecord[]>([]);
  const [currentTier, setCurrentTier] = useState<VerificationTier>("0");
  const [loading, setLoading] = useState(true);
  const [applyOpen, setApplyOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState(false);

  async function load() {
    try {
      // Fetch records from existing verification-records API (returns array for dancers)
      const [recsRes, profileRes] = await Promise.all([
        fetch("/api/verification-records"),
        fetch("/api/profile"),
      ]);
      if (recsRes.ok) {
        const recs = await recsRes.json();
        setRecords(Array.isArray(recs) ? recs : []);
      }
      if (profileRes.ok) {
        const profile = await profileRes.json();
        setCurrentTier(profile?.dancer_profile?.verification_tier ?? "0");
      }
    } catch {
      // silently degrade
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const hasPending = records.some((r) => !r.verifier_id && !r.revoked);
  const lastApproved = records.find((r) => r.verifier_id && !r.revoked);

  async function handleApply(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch("/api/verification-records", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (res.ok) {
        setSubmitSuccess(true);
        setApplyOpen(false);
        await load();
      } else {
        const body = await res.json();
        setSubmitError(body.error ?? "Failed to submit request");
      }
    } catch {
      setSubmitError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-6 h-6 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold mb-1">Verification</h1>
        <p className="text-white/40 text-sm">Your verification status and application history</p>
      </div>

      {/* Current tier */}
      <div className="bg-white/[0.04] border border-white/10 rounded-2xl p-6">
        <div className="flex items-center justify-between gap-4 flex-wrap mb-4">
          <div>
            <p className="text-xs font-semibold text-white/40 uppercase tracking-widest mb-2">Current Status</p>
            <VerificationBadge tier={currentTier} size="lg" showLabel />
          </div>
          {lastApproved && (
            <div className="text-right">
              <p className="text-xs text-white/30">Last verified</p>
              <p className="text-sm text-white/60 mt-0.5">
                {new Date(lastApproved.verified_at).toLocaleDateString("en-US", {
                  month: "long",
                  day: "numeric",
                  year: "numeric",
                })}
              </p>
            </div>
          )}
        </div>

        {/* Pending state */}
        {hasPending && (
          <div className="flex items-center gap-3 bg-amber-500/10 border border-amber-500/25 rounded-xl px-4 py-3 text-sm text-amber-300">
            <Clock className="w-4 h-4 shrink-0" />
            Your verification request is under review. We&apos;ll notify you when a decision is made.
          </div>
        )}

        {/* Apply button */}
        {!hasPending && (
          <button
            onClick={() => { setApplyOpen(true); setSubmitSuccess(false); setSubmitError(null); }}
            className="flex items-center gap-2 px-5 py-2.5 bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold rounded-xl transition-colors mt-4"
          >
            <Send className="w-3.5 h-3.5" />
            Apply for Verification
          </button>
        )}

        {submitSuccess && (
          <div className="flex items-center gap-3 bg-green-500/10 border border-green-500/25 rounded-xl px-4 py-3 text-sm text-green-300 mt-4">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            Application submitted! Our team will review it shortly.
          </div>
        )}
      </div>

      {/* Apply form */}
      {applyOpen && (
        <div className="bg-white/[0.04] border border-violet-500/30 rounded-2xl p-6">
          <h2 className="text-base font-bold mb-2">Apply for Verification</h2>
          <p className="text-sm text-white/40 mb-5">
            Submitting this application requests the next tier above your current Tier {currentTier}.
            Our team will review your portfolio and profile.
          </p>
          <form onSubmit={handleApply} className="space-y-4">
            {submitError && (
              <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 text-[13px] text-red-400">
                {submitError}
              </div>
            )}
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setApplyOpen(false)}
                className="flex-1 px-4 py-3 border border-white/10 text-white/50 hover:text-white/70 text-sm font-medium rounded-xl transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="flex-1 px-4 py-3 bg-violet-600 hover:bg-violet-500 disabled:opacity-60 text-white text-sm font-semibold rounded-xl transition-colors"
              >
                {submitting ? "Submitting…" : "Submit Application"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Tier reference */}
      <div className="bg-white/[0.04] border border-white/10 rounded-2xl p-6">
        <h2 className="text-base font-bold mb-4 flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-violet-400" />
          Verification Tiers
        </h2>
        <div className="space-y-3">
          <TierCard tier="0" />
          <TierCard tier="1" />
          <TierCard tier="2" />
        </div>
      </div>

      {/* History */}
      {records.length > 0 && (
        <div className="bg-white/[0.04] border border-white/10 rounded-2xl p-6">
          <h2 className="text-base font-bold mb-4 flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 text-violet-400" />
            Application History
          </h2>
          <div>
            {records.map((r) => (
              <RecordRow key={r.id} record={r} />
            ))}
          </div>
        </div>
      )}

      {records.length === 0 && !hasPending && (
        <div className="bg-white/[0.04] border border-white/10 rounded-2xl p-6 text-center">
          <ShieldOff className="w-8 h-8 text-white/15 mx-auto mb-3" />
          <p className="text-sm text-white/40">No verification history yet.</p>
          <p className="text-xs text-white/25 mt-1">Submit your first application above to get started.</p>
        </div>
      )}
    </div>
  );
}
