export const revalidate = 60;
export const metadata = { title: "EGATS | Dancer Profile", robots: "noindex" };
import { createClient } from "@/lib/supabase/server";
import { notFound, redirect } from "next/navigation";
import { MapPin, Star, Instagram, Globe, Clock, BookOpen, Shield, Play, ExternalLink } from "lucide-react";
import VerificationBadge from "@/components/verification-badge";
import { formatDate } from "@/lib/utils";
import type { DancerProfile, VerificationRecord, Review, PortfolioClip } from "@/types/database";
import DancerProfileActions from "./DancerProfileActions";
import EndorsementsSection from "./EndorsementsSection";
import DancerReviewsSection from "./DancerReviewsSection";

export default async function DancerProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();

  const { data: dancer } = await supabase
    .from("dancer_profiles")
    .select("*, profile:profiles(*)")
    .eq("id", id)
    .single();

  if (!dancer) notFound();

  const [{ data: clips }, { data: verifications }, { data: reviews }, { data: endorsementRows }] = await Promise.all([
    supabase.from("portfolio_clips").select("*").eq("dancer_id", id).order("is_featured", { ascending: false }).order("created_at", { ascending: false }),
    supabase.from("verification_records").select("*").eq("dancer_id", id).eq("revoked", false).order("verified_at", { ascending: false }),
    supabase.from("reviews").select("*, reviewer:profiles(display_name, avatar_url)").eq("reviewee_id", dancer.user_id).eq("is_public", true).order("created_at", { ascending: false }).limit(50),
    supabase.from("endorsements").select("endorser_id, skill").eq("dancer_id", id),
  ]);

  // Build endorsements grouped by skill
  const endorsementMap: Record<string, { count: number; endorsedByMe: boolean }> = {};
  for (const row of endorsementRows ?? []) {
    if (!endorsementMap[row.skill]) {
      endorsementMap[row.skill] = { count: 0, endorsedByMe: false };
    }
    endorsementMap[row.skill].count += 1;
    if (row.endorser_id === user.id) {
      endorsementMap[row.skill].endorsedByMe = true;
    }
  }
  const endorsements = Object.entries(endorsementMap)
    .map(([skill, data]) => ({ skill, count: data.count, endorsedByMe: data.endorsedByMe }))
    .sort((a, b) => b.count - a.count);

  // Viewer can endorse if they are NOT the dancer themselves
  const isOwnProfile = dancer.user_id === user.id;
  const canEndorse = !isOwnProfile;

  const d = dancer as DancerProfile & { profile: { display_name: string; bio: string | null; location: string | null; instagram_handle: string | null; tiktok_handle: string | null; website_url: string | null; avatar_url: string | null } };
  const p = d.profile;

  const AVAILABILITY_BADGE = {
    available: { color: "bg-green-500/20 text-green-400 border-green-500/30", label: "Available" },
    limited: { color: "bg-amber-500/20 text-amber-400 border-amber-500/30", label: "Limited" },
    unavailable: { color: "bg-zinc-700/50 text-zinc-400 border-zinc-600/30", label: "Unavailable" },
  };
  const avail = AVAILABILITY_BADGE[d.availability_status];

  return (
    <div className="max-w-4xl space-y-8 pb-24 sm:pb-0">
      {/* Hero */}
      <div className="bg-gradient-to-br from-zinc-900 to-zinc-950 border border-white/10 rounded-3xl overflow-hidden">
        <div className="h-24 bg-gradient-to-r from-violet-900/40 via-purple-900/20 to-zinc-900" />
        <div className="px-8 pb-8">
          <div className="-mt-12 flex items-end gap-6 mb-6">
            <div className="w-24 h-24 rounded-2xl bg-violet-500/30 border-4 border-zinc-950 flex items-center justify-center text-3xl font-black text-violet-300 shrink-0 overflow-hidden">
              {p?.avatar_url
                // eslint_disable-next-line @next/next/no-img-element
                ? <img src={p.avatar_url} alt={p.display_name} className="w-full h-full object-cover" />
                : p?.display_name?.slice(0, 2).toUpperCase()
              }
            </div>
            <div className="flex-1 min-w-0 pb-1">
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="text-2xl font-bold">{d.stage_name || p?.display_name}</h1>
                <VerificationBadge tier={d.verification_tier} size="md" showLabel />
                <span className={`text-xs font-semibold px-3 py-1 rounded-full border ${avail.color}`}>{avail.label}</span>
              </div>
              {d.stage_name && p?.display_name !== d.stage_name && (
                <div className="text-sm text-white/40 mt-0.5">{p?.display_name}</div>
              )}
            </div>
            {profile?.role === "recruiter" && (
              <div className="flex gap-3 max-sm:hidden">
                <DancerProfileActions dancerId={id} dancerName={d.stage_name || p?.display_name || ""} variant="header" />
              </div>
            )}
          </div>

          {/* Stats row */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
            {[
              { label: "Experience", value: `${d.experience_years}y`, icon: Clock },
              { label: "Bookings", value: d.total_bookings, icon: BookOpen },
              { label: "Avg Rating", value: d.avg_rating ? `${d.avg_rating.toFixed(1)} ★` : "—", icon: Star },
              { label: "Travel", value: d.travel_willingness.replace("_", " "), icon: MapPin },
            ].map(({ label, value, icon: Icon }) => (
              <div key={label} className="bg-white/[0.04] border border-white/5 rounded-xl px-4 py-3 text-center">
                <div className="text-base font-bold">{value}</div>
                <div className="text-xs text-white/40 mt-0.5 flex items-center justify-center gap-1"><Icon className="w-3 h-3" />{label}</div>
              </div>
            ))}
          </div>

          {/* Styles */}
          <div className="flex flex-wrap gap-2 mb-5">
            {d.styles.map((s) => (
              <span key={s} className="text-sm bg-violet-500/15 border border-violet-500/25 text-violet-300 px-3 py-1.5 rounded-full font-medium">{s}</span>
            ))}
          </div>

          {/* Bio */}
          {p?.bio && <p className="text-white/60 text-sm leading-relaxed mb-5">{p.bio}</p>}

          {/* Links */}
          <div className="flex flex-wrap gap-4 text-sm text-white/40">
            {p?.location && <span className="flex items-center gap-1.5"><MapPin className="w-3.5 h-3.5" />{p.location}</span>}
            {p?.instagram_handle && (
              <a href={`https://instagram.com/${p.instagram_handle.replace("@", "")}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 hover:text-white/70 transition-colors">
                <Instagram className="w-3.5 h-3.5" />@{p.instagram_handle.replace("@", "")}
                <ExternalLink className="w-3 h-3" />
              </a>
            )}
            {p?.website_url && (
              <a href={p.website_url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 hover:text-white/70 transition-colors">
                <Globe className="w-3.5 h-3.5" />Website
                <ExternalLink className="w-3 h-3" />
              </a>
            )}
            {d.union_member && <span className="text-blue-400 text-xs font-semibold bg-blue-500/10 px-2 py-0.5 rounded-full">Union Member</span>}
            {d.represented && <span className="text-amber-400 text-xs font-semibold bg-amber-500/10 px-2 py-0.5 rounded-full">Represented</span>}
          </div>
        </div>
      </div>

      {/* Mobile sticky action bar — recruiter only */}
      {profile?.role === "recruiter" && (
        <div className="sm:hidden fixed bottom-0 left-0 right-0 z-40 bg-[rgba(9,9,11,0.92)] backdrop-blur-xl border-t border-white/10 p-4 flex gap-3">
          <DancerProfileActions dancerId={id} dancerName={d.stage_name || p?.display_name || ""} variant="mobile-bar" />
        </div>
      )}

      <div className="grid lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-8">
          {/* Portfolio clips */}
          <div>
            <h2 className="font-bold text-xl mb-4">Portfolio</h2>
            {clips?.length ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {(clips as PortfolioClip[]).map((clip) => (
                  <a key={clip.id} href={clip.clip_url} target="_blank" rel="noopener noreferrer"
                    className="relative aspect-square bg-zinc-900 rounded-xl overflow-hidden group cursor-pointer block">
                    {clip.thumbnail_url
                      // eslint_disable-next-line @next/next/no-img-element
                      ? <img src={clip.thumbnail_url} alt={clip.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform" />
                      : <div className="w-full h-full flex items-center justify-center bg-zinc-800"><Play className="w-8 h-8 text-white/20" /></div>
                    }
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center">
                      <div className="w-10 h-10 rounded-full bg-white/20 backdrop-blur-sm items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity flex">
                        <Play className="w-4 h-4 text-white fill-white ml-0.5" />
                      </div>
                    </div>
                    {clip.is_featured && (
                      <div className="absolute top-2 left-2 text-[9px] font-bold bg-amber-500 text-black px-1.5 py-0.5 rounded-md">FEATURED</div>
                    )}
                    {clip.camp_generated && (
                      <div className="absolute top-2 right-2 text-[9px] font-bold bg-violet-600 text-white px-1.5 py-0.5 rounded-md">EGATS CAMP</div>
                    )}
                    <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 p-2">
                      <div className="text-xs font-semibold text-white line-clamp-1">{clip.title}</div>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {clip.styles.slice(0, 2).map((s) => (
                          <span key={s} className="text-[9px] text-white/50">{s}</span>
                        ))}
                      </div>
                    </div>
                  </a>
                ))}
              </div>
            ) : (
              <div className="text-center py-10 bg-white/[0.02] border border-white/5 rounded-xl">
                <Play className="w-8 h-8 text-white/15 mx-auto mb-2" />
                <p className="text-sm text-white/30">No clips uploaded yet.</p>
              </div>
            )}
          </div>

          {/* Endorsements */}
          <EndorsementsSection
            dancerId={id}
            initialEndorsements={endorsements}
            canEndorse={canEndorse}
          />

          {/* Reviews */}
          <DancerReviewsSection reviews={(reviews as unknown as Review[]) ?? []} />
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Verification records */}
          <div>
            <h3 className="font-bold text-base mb-4 flex items-center gap-2">
              <Shield className="w-4 h-4 text-amber-400" />
              Verification History
            </h3>
            {verifications?.length ? (
              <div className="space-y-3">
                {(verifications as VerificationRecord[]).map((v) => (
                  <div key={v.id} className="bg-white/[0.04] border border-white/10 rounded-xl p-4">
                    <div className="flex items-center justify-between mb-2">
                      <VerificationBadge tier={v.tier_awarded} size="sm" showLabel />
                      <span className="text-xs text-white/30">{formatDate(v.verified_at)}</span>
                    </div>
                    {v.overall_score && (
                      <div className="text-sm font-bold text-amber-400 mb-2">{v.overall_score.toFixed(1)}/10 overall</div>
                    )}
                    {v.styles_evaluated?.length && (
                      <div className="flex flex-wrap gap-1">
                        {v.styles_evaluated.map((s) => (
                          <span key={s} className="text-[10px] bg-white/5 text-white/40 px-2 py-0.5 rounded-full">{s}</span>
                        ))}
                      </div>
                    )}
                    {v.notes && <p className="text-xs text-white/40 mt-2 italic">"{v.notes}"</p>}
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-6 bg-white/[0.02] border border-white/5 rounded-xl">
                <Shield className="w-6 h-6 text-white/15 mx-auto mb-2" />
                <p className="text-xs text-white/30">No verifications yet.</p>
              </div>
            )}
          </div>

          {/* Quick facts */}
          <div className="bg-white/[0.03] border border-white/5 rounded-2xl p-5">
            <h3 className="font-bold text-sm mb-4">Quick Facts</h3>
            <div className="space-y-3 text-sm">
              {[
                ["Experience", `${d.experience_years} year${d.experience_years !== 1 ? "s" : ""}`],
                ["Travel", d.travel_willingness.replace("_", " ")],
                ["Availability", d.availability_status],
                ["Union Member", d.union_member ? "Yes" : "No"],
                ["Has Agent", d.represented ? "Yes" : "No"],
                ["Joined EGATS", formatDate(d.created_at)],
              ].map(([label, value]) => (
                <div key={label as string} className="flex justify-between">
                  <span className="text-white/40">{label}</span>
                  <span className="text-white/80 font-medium capitalize">{value}</span>
                </div>
              ))}
            </div>
          </div>

          {profile?.role === "recruiter" && (
            <DancerProfileActions dancerId={id} dancerName={d.stage_name || p?.display_name || ""} variant="sidebar" />
          )}
        </div>
      </div>
    </div>
  );
}
