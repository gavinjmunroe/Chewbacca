export const revalidate = 60;
export const metadata = { title: "EGATS | Camp Details", robots: "noindex" };
import { createClient } from "@/lib/supabase/server";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { MapPin, Calendar, Users, DollarSign, ArrowLeft, Clock, CheckCircle2, AlertCircle, Award } from "lucide-react";
import { formatDate } from "@/lib/utils";
import WaitlistButton from "./WaitlistButton";

export default async function CampDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: camp } = await supabase.from("camps").select("*").eq("id", id).single();
  if (!camp) notFound();

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  const isDancer = profile?.role === "dancer";

  // Check if dancer is already registered and waitlist status
  let isRegistered = false;
  let dancerProfileId: string | null = null;
  let waitlistPosition: number | null = null;
  let isOnWaitlist = false;
  if (isDancer) {
    const { data: dancer } = await supabase.from("dancer_profiles").select("id").eq("user_id", user.id).single();
    dancerProfileId = dancer?.id || null;
    if (dancerProfileId) {
      const [{ data: reg }, { data: waitlistEntry }] = await Promise.all([
        supabase
          .from("camp_registrations")
          .select("id")
          .eq("camp_id", id)
          .eq("dancer_id", dancerProfileId)
          .maybeSingle(),
        supabase
          .from("camp_waitlist")
          .select("position")
          .eq("camp_id", id)
          .eq("dancer_id", dancerProfileId)
          .maybeSingle(),
      ]);
      isRegistered = !!reg;
      isOnWaitlist = !!waitlistEntry;
      waitlistPosition = waitlistEntry?.position ?? null;
    }
  }

  const hasCapacity = camp.max_capacity != null && camp.max_capacity > 0;
  const spotsLeft = hasCapacity ? camp.max_capacity - camp.current_registered : null;
  const pct = hasCapacity ? (camp.current_registered / camp.max_capacity) * 100 : 0;
  const isFull = hasCapacity && (camp.current_registered ?? 0) >= camp.max_capacity;
  const isDeadlinePassed = new Date(camp.registration_deadline) < new Date();

  return (
    <div className="max-w-3xl space-y-8">
      <Link href="/dashboard/camps" className="inline-flex items-center gap-2 text-sm text-white/40 hover:text-white/70 transition-colors">
        <ArrowLeft className="w-4 h-4" /> Back to Camps
      </Link>

      {/* Header */}
      <div className="bg-white/[0.04] border border-white/10 rounded-3xl p-8">
        <div className="flex items-start justify-between gap-6 flex-wrap mb-6">
          <div>
            <h1 className="text-3xl font-bold mb-2">{camp.name}</h1>
            <div className="flex flex-wrap gap-4 text-sm text-white/50">
              <div className="flex items-center gap-2">
                <MapPin className="w-4 h-4" />
                {camp.city}{camp.state ? `, ${camp.state}` : ""}{camp.venue_name ? ` · ${camp.venue_name}` : ""}
              </div>
              <div className="flex items-center gap-2">
                <Calendar className="w-4 h-4" />
                {formatDate(camp.start_date)}{camp.end_date !== camp.start_date ? ` – ${formatDate(camp.end_date)}` : ""}
              </div>
            </div>
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold mb-1">
              {camp.registration_fee_cents === 0 ? "Free" : `$${camp.registration_fee_cents / 100}`}
            </div>
            {camp.is_sold_out ? (
              <span className="text-xs bg-red-500/20 text-red-400 px-3 py-1 rounded-full font-semibold">Sold Out</span>
            ) : isDeadlinePassed ? (
              <span className="text-xs bg-zinc-700/50 text-zinc-400 px-3 py-1 rounded-full font-semibold">Registration Closed</span>
            ) : (
              <span className="text-xs bg-green-500/20 text-green-400 px-3 py-1 rounded-full font-semibold">Open</span>
            )}
          </div>
        </div>

        {/* Stats grid */}
        <div className="grid sm:grid-cols-3 gap-4 mb-6">
          <div className="bg-white/[0.03] border border-white/5 rounded-xl p-4">
            <div className="flex items-center gap-2 text-white/40 text-xs mb-2"><Users className="w-3.5 h-3.5" /> Capacity</div>
            <div className="flex items-center gap-2">
              <span className="font-semibold text-sm">{camp.current_registered}/{camp.max_capacity}</span>
              {isFull ? (
                <span className="text-[10px] font-bold bg-red-500/20 text-red-400 px-2 py-0.5 rounded-full">Full</span>
              ) : spotsLeft !== null && (
                <span className={`text-[10px] font-semibold ${
                  pct < 50 ? "text-green-400" : pct < 75 ? "text-amber-400" : "text-red-400"
                }`}>
                  {spotsLeft} spot{spotsLeft !== 1 ? "s" : ""} left
                </span>
              )}
            </div>
            {hasCapacity && (
              <div className="h-1.5 bg-white/10 rounded-full mt-2 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${pct >= 75 ? "bg-red-500" : pct >= 50 ? "bg-amber-500" : "bg-green-500"}`}
                  style={{ width: `${Math.min(pct, 100)}%` }}
                />
              </div>
            )}
          </div>
          <div className="bg-white/[0.03] border border-white/5 rounded-xl p-4">
            <div className="flex items-center gap-2 text-white/40 text-xs mb-2"><Clock className="w-3.5 h-3.5" /> Reg. Deadline</div>
            <div className="font-semibold text-sm">{formatDate(camp.registration_deadline)}</div>
          </div>
          {camp.travel_reimbursement_cap_cents > 0 && (
            <div className="bg-white/[0.03] border border-white/5 rounded-xl p-4">
              <div className="flex items-center gap-2 text-green-400 text-xs mb-2"><DollarSign className="w-3.5 h-3.5" /> Travel Aid</div>
              <div className="font-semibold text-sm text-green-400">Up to ${camp.travel_reimbursement_cap_cents / 100}</div>
            </div>
          )}
        </div>

        {/* Description */}
        {camp.description && (
          <div className="mb-6">
            <div className="text-xs font-semibold text-white/40 uppercase tracking-widest mb-3">About This Camp</div>
            <p className="text-white/70 text-sm leading-relaxed whitespace-pre-wrap">{camp.description}</p>
          </div>
        )}

        {/* What you earn */}
        <div className="mb-6">
          <div className="text-xs font-semibold text-white/40 uppercase tracking-widest mb-3">What You Earn</div>
          <div className="grid sm:grid-cols-2 gap-3">
            {[
              { icon: Award, text: "Verification evaluation: earn Tier 1 or Tier 2 badge" },
              { icon: CheckCircle2, text: "Filmed performance clips for your portfolio" },
              { icon: CheckCircle2, text: "Written evaluator feedback" },
              { icon: CheckCircle2, text: "Access to recruiter visibility on platform" },
            ].map(({ icon: Icon, text }) => (
              <div key={text} className="flex items-start gap-2.5 text-sm text-white/60">
                <Icon className="w-4 h-4 text-violet-400 shrink-0 mt-0.5" />
                {text}
              </div>
            ))}
          </div>
        </div>

        {/* Scholarship info */}
        {camp.scholarship_available && (
          <div className="mb-6 bg-amber-500/5 border border-amber-500/20 rounded-xl p-4 text-sm text-white/60">
            <div className="font-semibold text-amber-400 mb-1">Scholarship Available</div>
            Need-based scholarships are available. You can apply in the registration form.
          </div>
        )}

        {/* CTA */}
        {isDancer && (
          <div>
            {isRegistered ? (
              <div className="flex items-center gap-3 bg-green-500/10 border border-green-500/25 rounded-xl px-5 py-4 text-green-400">
                <CheckCircle2 className="w-5 h-5 shrink-0" />
                <div>
                  <div className="font-semibold">You&apos;re registered!</div>
                  <div className="text-sm text-green-400/70">Watch your email for camp details.</div>
                </div>
              </div>
            ) : camp.is_sold_out || isFull ? (
              <WaitlistButton
                campId={id}
                initialOnWaitlist={isOnWaitlist}
                initialPosition={waitlistPosition}
              />
            ) : isDeadlinePassed ? (
              <div className="flex items-center gap-3 bg-zinc-700/20 border border-white/10 rounded-xl px-5 py-4 text-white/40">
                <AlertCircle className="w-5 h-5 shrink-0" />
                <div className="font-semibold">Registration Closed</div>
              </div>
            ) : (
              <Link
                href={`/dashboard/camps/${id}/register`}
                className="inline-flex items-center gap-2 bg-violet-600 hover:bg-violet-500 text-white font-bold px-8 py-4 rounded-xl transition-colors text-sm"
              >
                Register for This Camp →
              </Link>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
