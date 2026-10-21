export const revalidate = 60;
export const metadata = { title: 'EGATS | Camps', robots: 'noindex' };
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { MapPin, Calendar, ArrowRight, CheckCircle2 } from "lucide-react";
import { formatDate } from "@/lib/utils";
import CampsFilterClient from "./CampsFilterClient";

export default async function CampsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: profile } = user
    ? await supabase.from("profiles").select("role").eq("id", user.id).single()
    : { data: null };

  const isDancer = profile?.role === "dancer";

  // Fetch dancer profile + registrations if dancer
  let registeredCampIds = new Set<string>();
  if (isDancer && user) {
    const { data: dancer } = await supabase
      .from("dancer_profiles")
      .select("id")
      .eq("user_id", user.id)
      .single();

    if (dancer) {
      const { data: regs } = await supabase
        .from("camp_registrations")
        .select("camp_id, status, camp:camps(id, name, city, state, start_date, end_date, registration_fee_cents)")
        .eq("dancer_id", dancer.id)
        .order("created_at", { ascending: false });

      registeredCampIds = new Set((regs || []).map((r) => r.camp_id as string));

      // Pass registrations to render
      const myRegistrations = (regs || []) as unknown as Array<{
        camp_id: string;
        status: string;
        camp: { id: string; name: string; city: string; state?: string; start_date: string; end_date?: string; registration_fee_cents: number } | null;
      }>;

      // Fetch all upcoming camps for Browse section
      const { data: allCamps } = await supabase
        .from("camps")
        .select("*")
        .eq("is_published", true)
        .gte("registration_deadline", new Date().toISOString().split("T")[0])
        .order("start_date")
        .limit(50);

      const browseCamps = (allCamps || []).filter((c) => !registeredCampIds.has(c.id));

      return (
        <DancerCampsView
          myRegistrations={myRegistrations}
          browseCamps={browseCamps}
        />
      );
    }
  }

  // Non-dancer or unauthenticated: show all upcoming camps
  const { data: camps } = await supabase
    .from("camps")
    .select("*")
    .eq("is_published", true)
    .gte("registration_deadline", new Date().toISOString().split("T")[0])
    .order("start_date")
    .limit(50);

  return <AllCampsView camps={camps || []} />;
}

// ── Dancer view (My Registrations + Browse) ──────────────────────────────────

function DancerCampsView({
  myRegistrations,
  browseCamps,
}: {
  myRegistrations: Array<{
    camp_id: string;
    status: string;
    camp: { id: string; name: string; city: string; state?: string; start_date: string; end_date?: string; registration_fee_cents: number } | null;
  }>;
  browseCamps: Record<string, unknown>[];
}) {
  return (
    <div className="space-y-12">
      <div>
        <h1 className="text-3xl font-bold mb-1">EGATS Camps</h1>
        <p className="text-white/50 text-sm max-w-xl leading-relaxed">
          Real-world evaluation. Real signal. Camps are the foundation of the EGATS trust engine,
          open to all dancers, structured like a professional evaluation day.
        </p>
      </div>

      {/* My Registrations */}
      <div>
        <h2 className="font-bold text-xl mb-4">My Registrations</h2>
        {myRegistrations.length === 0 ? (
          <div className="text-center py-10 bg-white/[0.02] border border-white/5 rounded-2xl">
            <Calendar className="w-10 h-10 text-white/15 mx-auto mb-3" />
            <p className="text-sm text-white/30">You haven&apos;t registered for any camps yet.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {myRegistrations.map((reg) =>
              reg.camp ? (
                <Link
                  key={reg.camp_id}
                  href={`/dashboard/camps/${reg.camp_id}`}
                  className="flex items-center justify-between bg-white/[0.04] border border-white/10 rounded-2xl p-5 card-hover group"
                >
                  <div>
                    <div className="flex items-center gap-3 mb-1">
                      <span className="font-bold group-hover:text-violet-300 transition-colors">
                        {reg.camp.name}
                      </span>
                      <span className="flex items-center gap-1 text-xs bg-green-500/20 text-green-400 px-2 py-0.5 rounded-full font-semibold capitalize">
                        <CheckCircle2 className="w-3 h-3" /> {reg.status}
                      </span>
                    </div>
                    <div className="flex gap-4 text-sm text-white/40">
                      <span className="flex items-center gap-1.5">
                        <MapPin className="w-3.5 h-3.5" />
                        {reg.camp.city}{reg.camp.state ? `, ${reg.camp.state}` : ""}
                      </span>
                      <span className="flex items-center gap-1.5">
                        <Calendar className="w-3.5 h-3.5" />
                        {formatDate(reg.camp.start_date)}
                      </span>
                    </div>
                  </div>
                  <ArrowRight className="w-4 h-4 text-white/30 group-hover:text-violet-400 transition-colors" />
                </Link>
              ) : null
            )}
          </div>
        )}
      </div>

      {/* Browse Camps */}
      <div>
        <h2 className="font-bold text-xl mb-4">Browse Upcoming Camps</h2>
        <CampsFilterClient camps={browseCamps} />
      </div>
    </div>
  );
}

// ── All camps view (recruiter / non-dancer) ──────────────────────────────────

function AllCampsView({ camps }: { camps: Record<string, unknown>[] }) {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold mb-1">EGATS Camps</h1>
        <p className="text-white/50 text-sm max-w-xl leading-relaxed">
          Real-world evaluation. Real signal. Camps are the foundation of the EGATS trust engine,
          open to all dancers, structured like a professional evaluation day.
        </p>
      </div>

      {/* What to expect */}
      <div className="bg-gradient-to-r from-violet-500/10 to-amber-500/5 border border-violet-500/20 rounded-2xl p-6">
        <h2 className="font-bold mb-4">What to expect at a camp</h2>
        <div className="grid sm:grid-cols-3 gap-4 text-sm text-white/60">
          {[
            { title: "One-Day Core Format", desc: "Structured like a professional eval: technique blocks, direction test, on-camera performance, and a brief professionalism interview." },
            { title: "Travel Reimbursement", desc: "Cap-based reimbursement available. Needs-based scholarships for dancers who require extra support. Distance tiers determine cap level." },
            { title: "Verification Outcomes", desc: "Tier 1 or Tier 2 verification earned within 2 weeks of camp. All attendees receive filmed clips and written evaluator feedback." },
          ].map((item) => (
            <div key={item.title} className="bg-white/5 rounded-xl p-4">
              <div className="font-semibold text-white mb-2">{item.title}</div>
              <div className="leading-relaxed">{item.desc}</div>
            </div>
          ))}
        </div>
      </div>

      <CampsFilterClient camps={camps} />
    </div>
  );
}
