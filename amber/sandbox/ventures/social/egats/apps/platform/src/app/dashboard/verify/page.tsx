export const revalidate = 60;
export const metadata = { title: "EGATS | Verification Queue", robots: "noindex" };
import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import type { VerificationTier } from "@/types/database";
import VerifyQueueClient from "./VerifyQueueClient";

interface PendingRecord {
  id: string;
  dancer_id: string;
  camp_id: string | null;
  requested_tier: VerificationTier;
  status: string;
  created_at: string;
  dancer: {
    id: string;
    verification_tier: VerificationTier;
    profile: {
      display_name: string;
      avatar_url: string | null;
    } | null;
  } | null;
  camp?: {
    name: string;
  } | null;
}

export default async function VerifyQueuePage() {
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

  if (!profile || profile.role !== "verifier") {
    return (
      <div className="min-h-screen bg-[#09090B] flex items-center justify-center px-4">
        <div className="text-center max-w-sm">
          <div className="w-14 h-14 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center mx-auto mb-5">
            <svg
              className="w-7 h-7 text-red-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
              />
            </svg>
          </div>
          <h1 className="text-xl font-semibold text-white mb-2">Access Denied</h1>
          <p className="text-white/50 text-sm leading-relaxed mb-6">
            The verification queue is only accessible to EGATS verifiers. Your current role does
            not have permission to view this page.
          </p>
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-white/[0.07] hover:bg-white/[0.12] border border-white/[0.08] rounded-xl text-sm font-medium text-white/70 transition-colors"
          >
            Back to Dashboard
          </Link>
        </div>
      </div>
    );
  }

  const { data: records, error } = await supabase
    .from("verification_records")
    .select(
      "*, dancer:dancer_profiles(id, verification_tier, profile:profiles(display_name, avatar_url)), camp:camps(name)"
    )
    .eq("status", "pending")
    .order("created_at", { ascending: true });

  const pending = (records ?? []) as PendingRecord[];

  return (
    <div className="min-h-screen bg-[#09090B] text-white">
      <div className="max-w-5xl mx-auto px-6 py-10">
        {/* Header */}
        <div className="flex items-center justify-between mb-10">
          <div className="flex items-center gap-4">
            <h1 className="text-2xl font-bold tracking-tight">Verification Queue</h1>
            {pending.length > 0 && (
              <span className="inline-flex items-center justify-center min-w-[26px] h-[26px] px-2 bg-violet-500 rounded-full text-[12px] font-bold text-white">
                {pending.length}
              </span>
            )}
          </div>
          <Link
            href="/dashboard"
            className="text-sm text-white/40 hover:text-white/70 transition-colors"
          >
            Back to Dashboard
          </Link>
        </div>

        {error && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 mb-6">
            <p className="text-red-400 text-sm">Failed to load verification queue: {error.message}</p>
          </div>
        )}

        {/* Empty state (no records at all) */}
        {pending.length === 0 && !error && (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="w-16 h-16 rounded-2xl bg-violet-500/10 border border-violet-500/20 flex items-center justify-center mb-5">
              <svg
                className="w-8 h-8 text-violet-400"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
                />
              </svg>
            </div>
            <h2 className="text-lg font-semibold text-white/80 mb-2">Queue is clear</h2>
            <p className="text-white/40 text-sm max-w-xs">
              There are no pending verification requests right now. Check back later.
            </p>
          </div>
        )}

        {/* Client-side queue with filters, sort, and batch actions */}
        {pending.length > 0 && <VerifyQueueClient records={pending} />}
      </div>
    </div>
  );
}
