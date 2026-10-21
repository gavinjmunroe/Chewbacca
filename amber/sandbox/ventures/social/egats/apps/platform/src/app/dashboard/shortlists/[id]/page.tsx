export const revalidate = 60;
export const metadata = { title: "Shortlist Detail", robots: "noindex" };

import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import {
  ArrowLeft,
  BookOpen,
  MapPin,
  Star,
  Users,
  Bookmark,
  Trash2,
} from "lucide-react";
import VerificationBadge from "@/components/verification-badge";
import { formatDate, getInitials } from "@/lib/utils";
import type { VerificationTier } from "@/types/database";

interface ShortlistDancer {
  id: string;
  user_id: string;
  verification_tier: VerificationTier;
  styles: string[];
  experience_years: number | null;
  avg_rating: number | null;
  total_bookings: number;
  availability_status: "available" | "limited" | "unavailable";
  stage_name: string | null;
  profile: {
    display_name: string | null;
    avatar_url: string | null;
    location: string | null;
  } | null;
  clips: {
    thumbnail_url: string | null;
  }[] | null;
}

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function ShortlistDetailPage({ params }: PageProps) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Get recruiter profile
  const { data: recruiter } = await supabase
    .from("recruiter_profiles")
    .select("id")
    .eq("user_id", user.id)
    .single();

  if (!recruiter) redirect("/dashboard");

  // Fetch shortlist — guard: must be owner
  const { data: shortlist } = await supabase
    .from("shortlists")
    .select("*, job:jobs(title)")
    .eq("id", id)
    .eq("recruiter_id", recruiter.id)
    .single();

  if (!shortlist) notFound();

  // Fetch all dancers in this shortlist
  const dancerIds: string[] = shortlist.dancer_ids ?? [];

  let dancers: ShortlistDancer[] = [];
  if (dancerIds.length > 0) {
    const { data } = await supabase
      .from("dancer_profiles")
      .select(
        "id, user_id, verification_tier, styles, experience_years, avg_rating, total_bookings, availability_status, stage_name, profile:profiles(display_name, avatar_url, location), clips:portfolio_clips(thumbnail_url)"
      )
      .in("id", dancerIds);
    dancers = (data as unknown as ShortlistDancer[]) ?? [];
  }

  const { data: activeBookings } = await supabase
    .from("bookings")
    .select("dancer_id")
    .eq("recruiter_id", user.id)
    .in("status", ["confirmed", "completed"]);

  const bookedDancerIds = new Set((activeBookings ?? []).map((b: { dancer_id: string }) => b.dancer_id));

  const AVAIL_CONFIG = {
    available: { label: "Available", color: "#30D158" },
    limited: { label: "Limited", color: "#FF9F0A" },
    unavailable: { label: "Unavailable", color: "rgba(120,120,128,0.5)" },
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <Link
          href="/dashboard/shortlists"
          className="inline-flex items-center gap-1.5 text-sm text-white/40 hover:text-white/70 transition-colors mb-5"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Shortlists
        </Link>

        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <Bookmark className="w-5 h-5 text-violet-400" />
              <h1 className="text-3xl font-bold">{shortlist.name}</h1>
            </div>
            <div className="flex items-center gap-4 text-sm text-white/40 mt-2">
              <div className="flex items-center gap-1.5">
                <Users className="w-4 h-4" />
                {dancers.length} dancer{dancers.length !== 1 ? "s" : ""}
              </div>
              {shortlist.job && (
                <div>
                  For: {(shortlist.job as { title: string }).title}
                </div>
              )}
              <div>Created {formatDate(shortlist.created_at)}</div>
            </div>
            {shortlist.notes && (
              <p className="text-sm text-white/50 mt-3 max-w-lg">{shortlist.notes}</p>
            )}
          </div>

          {dancers.length > 0 && (
            <button
              disabled
              title="Bulk booking coming soon"
              className="shrink-0 flex items-center gap-2 bg-white/10 text-white/40 font-semibold px-5 py-2.5 rounded-full text-sm cursor-not-allowed"
            >
              Book All
              <span className="text-[10px] bg-white/10 px-2 py-0.5 rounded-full">Soon</span>
            </button>
          )}
        </div>
      </div>

      {/* Dancer grid */}
      {dancers.length === 0 ? (
        <div className="text-center py-20 bg-white/[0.02] border border-white/5 rounded-2xl">
          <Bookmark className="w-12 h-12 text-white/20 mx-auto mb-4" />
          <h3 className="font-bold text-lg mb-2">No dancers in this shortlist yet</h3>
          <p className="text-white/40 text-sm mb-6">
            Add them from the Find Dancers page.
          </p>
          <Link
            href="/dashboard/dancers"
            className="bg-violet-600 hover:bg-violet-500 text-white font-semibold px-6 py-3 rounded-full text-sm transition-all"
          >
            Browse Dancers
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {dancers.map((dancer) => {
            const name =
              dancer.profile?.display_name || dancer.stage_name || "Dancer";
            const avail =
              AVAIL_CONFIG[dancer.availability_status] ??
              AVAIL_CONFIG.unavailable;
            const thumbUrl = dancer.clips?.[0]?.thumbnail_url;
            const isBooked = bookedDancerIds.has(dancer.user_id);

            return (
              <div
                key={dancer.id}
                className="bg-white/[0.04] border border-white/10 rounded-2xl overflow-hidden flex flex-col group"
              >
                {/* Thumbnail */}
                <div className="relative aspect-square bg-zinc-900 overflow-hidden">
                  {thumbUrl ? (
                    // eslint_disable-next-line @next/next/no-img-element
                    <img
                      src={thumbUrl}
                      alt={name}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-violet-500/15 to-zinc-900">
                      <span className="text-4xl font-black text-violet-500/25">
                        {getInitials(name)}
                      </span>
                    </div>
                  )}
                  {/* Tier badge */}
                  <div className="absolute top-2.5 right-2.5">
                    <VerificationBadge tier={dancer.verification_tier} size="sm" />
                  </div>
                  {/* Availability */}
                  <div
                    className="absolute bottom-2.5 left-2.5 flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold"
                    style={{
                      background: "rgba(0,0,0,0.6)",
                      backdropFilter: "blur(8px)",
                      color: avail.color,
                    }}
                  >
                    <span
                      className="w-1.5 h-1.5 rounded-full"
                      style={{ background: avail.color }}
                    />
                    {avail.label}
                  </div>
                </div>

                {/* Info */}
                <div className="p-4 flex flex-col gap-2.5 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-1 min-w-0">
                      <Link
                        href={`/dashboard/dancers/${dancer.id}`}
                        className="text-sm font-semibold truncate hover:text-violet-400 transition-colors"
                      >
                        {name}
                      </Link>
                      {isBooked && (
                        <span className="text-[10px] bg-green-500/20 text-green-400 border border-green-500/30 px-2 py-0.5 rounded-full font-semibold ml-2 shrink-0">
                          Booked
                        </span>
                      )}
                    </div>
                    {dancer.avg_rating ? (
                      <div className="flex items-center gap-1 text-xs font-semibold text-yellow-400 shrink-0">
                        <Star className="w-3 h-3 fill-yellow-400" />
                        {dancer.avg_rating.toFixed(1)}
                      </div>
                    ) : null}
                  </div>

                  {/* Styles */}
                  <div className="flex flex-wrap gap-1">
                    {dancer.styles.slice(0, 3).map((s) => (
                      <span
                        key={s}
                        className="text-[10px] font-medium bg-violet-500/10 text-violet-300/80 border border-violet-500/20 px-2 py-0.5 rounded-full"
                      >
                        {s}
                      </span>
                    ))}
                    {dancer.styles.length > 3 && (
                      <span className="text-[10px] text-white/25 self-center">
                        +{dancer.styles.length - 3}
                      </span>
                    )}
                  </div>

                  {/* Meta */}
                  <div className="flex items-center justify-between text-[11px] text-white/30 mt-auto">
                    <div className="flex items-center gap-1">
                      <BookOpen className="w-3 h-3" />
                      {dancer.total_bookings} bookings
                    </div>
                    {dancer.profile?.location && (
                      <div className="flex items-center gap-1">
                        <MapPin className="w-3 h-3" />
                        {dancer.profile.location}
                      </div>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex gap-2 mt-1">
                    <Link
                      href={`/dashboard/dancers/${dancer.id}`}
                      className="flex-1 text-center text-xs font-semibold py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white transition-colors"
                    >
                      View Profile
                    </Link>
                    <form
                      action={`/api/shortlists`}
                      method="POST"
                      className="shrink-0"
                    >
                      <input type="hidden" name="_method" value="DELETE" />
                      <input type="hidden" name="shortlistId" value={shortlist.id} />
                      <input type="hidden" name="dancerId" value={dancer.id} />
                      <button
                        type="submit"
                        title="Remove from shortlist"
                        className="w-9 h-9 flex items-center justify-center rounded-xl bg-white/5 hover:bg-red-500/20 hover:text-red-400 text-white/30 border border-white/10 transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </form>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
