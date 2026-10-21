export const revalidate = 60;
export const metadata = { title: "EGATS | Verify Record", robots: "noindex" };
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { createClient } from "@/lib/supabase/server";
import { ArrowLeft } from "lucide-react";
import type { VerificationTier } from "@/types/database";
import { TIER_LABELS } from "@/types/database";
import VerificationBadge from "@/components/verification-badge";
import VerifyEvalForm from "./VerifyEvalForm";

interface RecordDetail {
  id: string;
  dancer_id: string;
  camp_id: string | null;
  tier_awarded: VerificationTier;
  verifier_id: string | null;
  revoked: boolean;
  notes: string | null;
  verified_at: string;
  dancer: {
    id: string;
    user_id: string;
    styles: string[];
    experience_years: number;
    verification_tier: VerificationTier;
    profile: {
      display_name: string;
      avatar_url: string | null;
      location: string | null;
    } | null;
    clips: {
      id: string;
      title: string;
      clip_url: string;
      thumbnail_url: string | null;
      styles: string[];
    }[];
  } | null;
  camp: { name: string } | null;
}

export default async function VerifyDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (!profile || profile.role !== "verifier") redirect("/dashboard");

  const { data: record } = await supabase
    .from("verification_records")
    .select(
      `*,
      dancer:dancer_profiles(
        id, user_id, styles, experience_years, verification_tier,
        profile:profiles(display_name, avatar_url, location),
        clips:portfolio_clips(id, title, clip_url, thumbnail_url, styles)
      ),
      camp:camps(name)`
    )
    .eq("id", id)
    .single();

  if (!record) notFound();
  const r = record as unknown as RecordDetail;

  const isAlreadyEvaluated = !!r.verifier_id;
  const dancerName = r.dancer?.profile?.display_name ?? "Unknown Dancer";
  const currentTier = r.dancer?.verification_tier ?? "0";

  return (
    <div className="max-w-2xl space-y-8">
      <Link
        href="/dashboard/verify"
        className="inline-flex items-center gap-2 text-sm text-white/40 hover:text-white/70 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" /> Back to Queue
      </Link>

      {/* Dancer header */}
      <div className="bg-white/[0.04] border border-white/10 rounded-2xl p-6">
        <div className="flex items-start gap-4 flex-wrap">
          <div className="w-16 h-16 rounded-full bg-white/[0.07] border border-white/[0.08] overflow-hidden flex items-center justify-center text-white/40 text-lg font-semibold shrink-0">
            {r.dancer?.profile?.avatar_url ? (
              <Image
                src={r.dancer.profile.avatar_url}
                alt={dancerName}
                width={64}
                height={64}
                className="w-full h-full object-cover"
              />
            ) : (
              dancerName.slice(0, 2).toUpperCase()
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 flex-wrap mb-1">
              <h1 className="text-xl font-bold">{dancerName}</h1>
              <VerificationBadge tier={currentTier} size="sm" showLabel />
            </div>
            {r.dancer?.profile?.location && (
              <p className="text-sm text-white/50">{r.dancer.profile.location}</p>
            )}
            <div className="flex flex-wrap gap-4 mt-3 text-sm text-white/50">
              <span>{r.dancer?.experience_years ?? "—"} years experience</span>
              {r.dancer?.styles?.length ? (
                <span>{r.dancer.styles.join(", ")}</span>
              ) : null}
            </div>
          </div>
        </div>

        <div className="mt-5 pt-5 border-t border-white/10 flex flex-wrap gap-4 text-sm">
          <div className="bg-white/[0.03] rounded-xl px-4 py-2.5">
            <div className="text-xs text-white/40 mb-0.5">Requesting Tier</div>
            <div className="font-semibold text-violet-300">
              {r.tier_awarded}: {TIER_LABELS[r.tier_awarded]}
            </div>
          </div>
          {r.camp && (
            <div className="bg-white/[0.03] rounded-xl px-4 py-2.5">
              <div className="text-xs text-white/40 mb-0.5">Camp</div>
              <div className="font-semibold">{r.camp.name}</div>
            </div>
          )}
          <div className="bg-white/[0.03] rounded-xl px-4 py-2.5">
            <div className="text-xs text-white/40 mb-0.5">Submitted</div>
            <div className="font-semibold">
              {new Date(r.verified_at).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
              })}
            </div>
          </div>
        </div>

        {/* Clips */}
        {r.dancer?.clips?.length ? (
          <div className="mt-5 pt-5 border-t border-white/10">
            <div className="text-xs font-semibold text-white/40 uppercase tracking-widest mb-3">
              Portfolio Clips
            </div>
            <div className="flex flex-wrap gap-3">
              {r.dancer.clips.map((clip) => (
                <a
                  key={clip.id}
                  href={clip.clip_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 bg-white/5 border border-white/10 hover:border-violet-500/40 rounded-lg px-3 py-2 text-sm transition-colors"
                >
                  {clip.thumbnail_url && (
                    <Image
                      src={clip.thumbnail_url}
                      alt={clip.title}
                      width={32}
                      height={32}
                      className="w-8 h-8 rounded object-cover"
                    />
                  )}
                  <span className="text-white/70">{clip.title}</span>
                  {clip.styles?.length ? (
                    <span className="text-xs text-white/30">· {clip.styles.join(", ")}</span>
                  ) : null}
                </a>
              ))}
            </div>
          </div>
        ) : (
          <div className="mt-4 text-sm text-white/30">No portfolio clips submitted</div>
        )}
      </div>

      {/* Already evaluated state */}
      {isAlreadyEvaluated ? (
        <div className="bg-white/[0.04] border border-white/10 rounded-2xl p-6 text-center">
          <p className="text-white/50 text-sm">
            This record has already been evaluated.
            {r.revoked && (
              <span className="ml-1 text-red-400">Decision: Rejected</span>
            )}
          </p>
          {r.notes && (
            <p className="text-white/40 text-xs mt-2 italic">{r.notes}</p>
          )}
        </div>
      ) : (
        <VerifyEvalForm recordId={id} tierAwarded={r.tier_awarded} />
      )}
    </div>
  );
}
