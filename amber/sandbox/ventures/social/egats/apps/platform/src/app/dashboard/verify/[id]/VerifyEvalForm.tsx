"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, XCircle, Star, AlertCircle } from "lucide-react";
import type { VerificationTier } from "@/types/database";

interface Props {
  recordId: string;
  tierAwarded: VerificationTier;
}

const inputCls =
  "w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-white/20 focus:outline-none focus:border-violet-500/50 transition-colors";
const labelCls = "block text-xs font-semibold text-white/50 uppercase tracking-widest mb-2";

function StarRating({
  value,
  onChange,
  label,
}: {
  value: number;
  onChange: (v: number) => void;
  label: string;
}) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-sm text-white/70">{label}</span>
      <div className="flex gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => onChange(n)}
            className="transition-colors p-0.5"
          >
            <Star
              className={`w-5 h-5 ${
                n <= value ? "text-amber-400 fill-amber-400" : "text-white/20 hover:text-white/40"
              }`}
            />
          </button>
        ))}
      </div>
    </div>
  );
}

function Toggle({
  value,
  onChange,
  label,
}: {
  value: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-sm text-white/70">{label}</span>
      <button
        type="button"
        onClick={() => onChange(!value)}
        className={`relative w-10 h-5 rounded-full transition-colors ${
          value ? "bg-violet-600" : "bg-white/10"
        }`}
      >
        <span
          className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
            value ? "translate-x-5" : "translate-x-0.5"
          }`}
        />
      </button>
    </div>
  );
}

export default function VerifyEvalForm({ recordId, tierAwarded }: Props) {
  const router = useRouter();
  const isTier1 = tierAwarded === "1";

  // Tier 1 fields
  const [identityVerified, setIdentityVerified] = useState(false);
  const [attendedCamp, setAttendedCamp] = useState(false);

  // Tier 2 fields
  const [techSkill, setTechSkill] = useState(0);
  const [musicality, setMusicality] = useState(0);
  const [professionalism, setProfessionalism] = useState(0);
  const [stagePresence, setStagePresence] = useState(0);

  // Shared
  const [notes, setNotes] = useState("");
  const [recommendation, setRecommendation] = useState<"approved" | "rejected" | "">("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!recommendation) {
      setError("Please select approve or reject before submitting");
      return;
    }

    if (!isTier1) {
      if (!techSkill || !musicality || !professionalism || !stagePresence) {
        setError("All dimension scores are required for Tier 2 evaluation");
        return;
      }
    }

    setSubmitting(true);
    try {
      const dimensionScores: Record<string, number> = isTier1
        ? {
            identity_verified: identityVerified ? 1 : 0,
            attended_camp: attendedCamp ? 1 : 0,
          }
        : {
            technique: techSkill,
            musicality,
            professionalism,
            stage_presence: stagePresence,
          };

      const res = await fetch(`/api/verification-records/${recordId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: recommendation,
          evaluatorNotes: notes.trim() || null,
          dimensionScores,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Submission failed");
      }

      router.push("/dashboard/verify");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="bg-white/[0.04] border border-white/10 rounded-2xl p-6 space-y-6">
      <div>
        <h2 className="font-bold text-lg mb-0.5">
          Evaluation: Tier {tierAwarded} Rubric
        </h2>
        <p className="text-sm text-white/40">
          {isTier1
            ? "Tier 1 verifies real identity and camp attendance."
            : "Tier 2 evaluates technical performance across four dimensions."}
        </p>
      </div>

      {error && (
        <div role="alert" aria-live="assertive" className="flex items-start gap-2 bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 text-sm text-red-300">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          {error}
        </div>
      )}

      {/* Rubric */}
      <div className="space-y-1">
        <label className={labelCls}>Rubric</label>
        {isTier1 ? (
          <div className="space-y-2 bg-white/[0.03] rounded-xl p-4">
            <Toggle
              label="Identity verified in person"
              value={identityVerified}
              onChange={setIdentityVerified}
            />
            <Toggle
              label="Confirmed camp attendance"
              value={attendedCamp}
              onChange={setAttendedCamp}
            />
          </div>
        ) : (
          <div className="space-y-1 bg-white/[0.03] rounded-xl p-4">
            <StarRating label="Technical Skill" value={techSkill} onChange={setTechSkill} />
            <StarRating label="Musicality" value={musicality} onChange={setMusicality} />
            <StarRating label="Professionalism" value={professionalism} onChange={setProfessionalism} />
            <StarRating label="Stage Presence" value={stagePresence} onChange={setStagePresence} />
          </div>
        )}
      </div>

      {/* Notes */}
      <div>
        <label className={labelCls}>Evaluator Notes</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          placeholder="Feedback visible to the dancer (optional)..."
          className={`${inputCls} resize-none`}
        />
      </div>

      {/* Recommendation */}
      <div>
        <label className={labelCls}>Decision *</label>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => setRecommendation("approved")}
            className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl border text-sm font-semibold transition-all ${
              recommendation === "approved"
                ? "bg-green-500/20 border-green-500/50 text-green-300"
                : "bg-white/5 border-white/10 text-white/50 hover:text-white hover:border-white/20"
            }`}
          >
            <CheckCircle2 className="w-4 h-4" />
            Approve
          </button>
          <button
            type="button"
            onClick={() => setRecommendation("rejected")}
            className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl border text-sm font-semibold transition-all ${
              recommendation === "rejected"
                ? "bg-red-500/20 border-red-500/50 text-red-300"
                : "bg-white/5 border-white/10 text-white/50 hover:text-white hover:border-white/20"
            }`}
          >
            <XCircle className="w-4 h-4" />
            Reject
          </button>
        </div>
      </div>

      <button
        type="submit"
        disabled={submitting || !recommendation}
        className="w-full flex items-center justify-center gap-2 bg-violet-600 hover:bg-violet-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold px-6 py-3.5 rounded-xl transition-colors"
      >
        {submitting ? (
          <>
            <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            Submitting...
          </>
        ) : (
          "Submit Evaluation"
        )}
      </button>
    </form>
  );
}
