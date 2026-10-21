export const revalidate = 60;
export const metadata = { title: "EGATS | Register for Camp", robots: "noindex" };
import { createClient } from "@/lib/supabase/server";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, MapPin, Calendar, Users, DollarSign, AlertCircle, CheckCircle2 } from "lucide-react";
import { formatDate } from "@/lib/utils";
import type { Camp, CampRegistration } from "@/types/database";
import CampRegisterForm from "./CampRegisterForm";

export default async function CampRegisterPage({
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

  // Must be a dancer
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (!profile || profile.role !== "dancer") redirect("/dashboard");

  // Fetch camp
  const { data: camp } = await supabase.from("camps").select("*").eq("id", id).single();
  if (!camp) notFound();
  const c = camp as Camp;

  // Check if dancer profile exists
  const { data: dancerProfile } = await supabase
    .from("dancer_profiles")
    .select("id")
    .eq("user_id", user.id)
    .single();

  // Check if already registered
  let alreadyRegistered = false;
  if (dancerProfile) {
    const { data: existing } = await supabase
      .from("camp_registrations")
      .select("id")
      .eq("camp_id", id)
      .eq("dancer_id", dancerProfile.id)
      .single();
    alreadyRegistered = !!existing;
  }

  const spotsLeft = c.max_capacity - c.current_registered;
  const isSoldOut = c.is_sold_out || spotsLeft <= 0;
  const deadlinePassed = new Date(c.registration_deadline) < new Date();

  return (
    <div className="max-w-2xl space-y-8">
      <Link
        href={`/dashboard/camps`}
        className="inline-flex items-center gap-2 text-sm text-white/40 hover:text-white/70 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" /> Back to Camps
      </Link>

      {/* Camp summary card */}
      <div className="bg-white/[0.04] border border-white/10 rounded-2xl p-6">
        <h1 className="text-2xl font-bold mb-4">{c.name}</h1>
        <div className="flex flex-wrap gap-5 text-sm text-white/50 mb-4">
          <div className="flex items-center gap-2">
            <MapPin className="w-4 h-4" />
            {c.city}{c.state ? `, ${c.state}` : ""}{c.venue_name ? ` · ${c.venue_name}` : ""}
          </div>
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4" />
            {formatDate(c.start_date)}
            {c.end_date !== c.start_date && ` – ${formatDate(c.end_date)}`}
          </div>
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4" />
            {spotsLeft > 0 ? `${spotsLeft} spots left` : "Full"}
          </div>
          <div className="flex items-center gap-2">
            <DollarSign className="w-4 h-4" />
            {c.registration_fee_cents === 0 ? "Free" : `$${c.registration_fee_cents / 100}`}
          </div>
        </div>
        {c.description && (
          <p className="text-sm text-white/60 leading-relaxed">{c.description}</p>
        )}
        <p className="text-xs text-white/30 mt-3">
          Registration deadline: {formatDate(c.registration_deadline)}
        </p>
      </div>

      {/* State: sold out */}
      {(isSoldOut || deadlinePassed) && (
        <div className="flex items-start gap-3 bg-red-500/10 border border-red-500/25 rounded-2xl p-6">
          <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
          <div>
            <div className="font-bold text-red-300 mb-1">
              {deadlinePassed ? "Registration Closed" : "Camp is Sold Out"}
            </div>
            <p className="text-sm text-white/50">
              {deadlinePassed
                ? "The registration deadline for this camp has passed."
                : "This camp has reached its capacity. Check back for future camps."}
            </p>
          </div>
        </div>
      )}

      {/* State: already registered */}
      {!isSoldOut && !deadlinePassed && alreadyRegistered && (
        <div className="flex items-start gap-3 bg-green-500/10 border border-green-500/25 rounded-2xl p-6">
          <CheckCircle2 className="w-5 h-5 text-green-400 shrink-0 mt-0.5" />
          <div>
            <div className="font-bold text-green-300 mb-1">Already Registered</div>
            <p className="text-sm text-white/50">
              You are already registered for this camp. Check your email for details.
            </p>
          </div>
        </div>
      )}

      {/* Registration form */}
      {!isSoldOut && !deadlinePassed && !alreadyRegistered && (
        <CampRegisterForm
          campId={id}
          campName={c.name}
          scholarshipSpotsAvailable={c.scholarship_spots > 0}
          travelReimbursementAvailable={c.travel_reimbursement_cap_cents > 0}
        />
      )}
    </div>
  );
}
