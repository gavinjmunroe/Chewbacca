import { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { MapPin, Calendar, DollarSign, Users, Clock, ArrowRight, ArrowLeft } from "lucide-react";
import VerificationBadge from "@/components/verification-badge";
import { formatPay, formatDate } from "@/lib/utils";
import type { Job } from "@/types/database";

export const revalidate = 60;

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const supabase = await createClient();
  const { data: job } = await supabase
    .from("jobs")
    .select("title, city, state, recruiter:recruiter_profiles(company_name)")
    .eq("id", id)
    .single();

  if (!job) return { title: "Job | EGATS" };

  const recruiter = job.recruiter as unknown as { company_name: string } | null;
  const location = job.city ? `${job.city}${job.state ? `, ${job.state}` : ""}` : null;
  const desc = [recruiter?.company_name, location].filter(Boolean).join(" · ");

  return {
    title: `${job.title} | EGATS`,
    description: `${job.title}${desc ? ` at ${desc}` : ""}. Apply on EGATS, the professional platform for dancers.`,
    openGraph: {
      title: `${job.title} | Job on EGATS`,
      description: `Apply for ${job.title}${recruiter?.company_name ? ` at ${recruiter.company_name}` : ""} on EGATS.`,
    },
  };
}

export default async function PublicJobPage({ params }: Props) {
  const { id } = await params;
  const supabase = await createClient();

  // Check if visitor is logged in
  const { data: { user } } = await supabase.auth.getUser();

  const { data: job } = await supabase
    .from("jobs")
    .select("*, recruiter:recruiter_profiles(company_name, profile:profiles(display_name, location))")
    .eq("id", id)
    .single();

  if (!job) notFound();

  const j = job as unknown as Job;

  // Only show open jobs publicly
  if (j.status !== "open") notFound();

  const recruiter = j.recruiter as unknown as { company_name: string; profile: { display_name: string; location: string | null } } | null;

  return (
    <div className="min-h-screen bg-[#09090B] text-white">
      {/* Minimal public nav */}
      <header className="sticky top-0 z-40 bg-[rgba(9,9,11,0.9)] backdrop-blur-xl border-b border-white/[0.07]">
        <div className="max-w-4xl mx-auto px-6 h-14 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 group">
            {/* eslint_disable-next-line @next/next/no-img-element */}
            <img
              src="/egatslogosimple.png"
              alt="EGATS"
              className="w-6 h-6 object-contain"
              style={{ filter: "invert(40%) sepia(1) saturate(4) hue-rotate(242deg) brightness(1.1)" }}
            />
            <span className="text-sm font-bold tracking-tight text-white">EGATS</span>
          </Link>
          <div className="flex items-center gap-3">
            <Link
              href="/login"
              className="text-sm text-white/50 hover:text-white transition-colors"
            >
              Sign in
            </Link>
            <Link
              href="/signup"
              className="text-sm font-semibold bg-violet-600 hover:bg-violet-500 text-white px-4 py-1.5 rounded-lg transition-colors"
            >
              Get started
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-12 space-y-8">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-sm text-white/40 hover:text-white/70 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" /> Back to EGATS
        </Link>

        <div className="bg-white/[0.04] border border-white/10 rounded-3xl p-8">
          {/* Header */}
          <div className="flex items-start justify-between gap-6 flex-wrap mb-6">
            <div>
              <div className="flex items-center gap-3 flex-wrap mb-3">
                <span className="text-xs font-semibold bg-violet-500/20 text-violet-300 px-3 py-1 rounded-full">{j.role_type}</span>
                <VerificationBadge tier={j.min_verification_tier} size="sm" showLabel />
                <span className="text-xs font-semibold px-3 py-1 rounded-full bg-green-500/20 text-green-400">
                  Open
                </span>
              </div>
              <h1 className="text-3xl font-bold mb-2">{j.title}</h1>
              {recruiter?.company_name && (
                <div className="text-white/50 text-base">{recruiter.company_name}</div>
              )}
            </div>

            {/* CTA */}
            <div className="flex flex-col gap-3 min-w-[180px]">
              {user ? (
                <Link
                  href={`/dashboard/jobs/${id}`}
                  className="flex items-center justify-center gap-2 bg-violet-600 hover:bg-violet-500 text-white font-semibold px-5 py-3 rounded-xl text-sm transition-colors"
                >
                  Apply for this role <ArrowRight className="w-4 h-4" />
                </Link>
              ) : (
                <Link
                  href={`/signup?as=dancer`}
                  className="flex items-center justify-center gap-2 bg-violet-600 hover:bg-violet-500 text-white font-semibold px-5 py-3 rounded-xl text-sm transition-colors"
                >
                  Apply for this role <ArrowRight className="w-4 h-4" />
                </Link>
              )}
            </div>
          </div>

          {/* Stats grid */}
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            {[
              {
                icon: MapPin,
                label: "Location",
                value: j.remote_possible ? "Remote" : j.city ? `${j.city}${j.state ? `, ${j.state}` : ""}` : "TBD",
              },
              {
                icon: Calendar,
                label: "Start Date",
                value: j.start_date ? formatDate(j.start_date) : "Flexible",
              },
              {
                icon: DollarSign,
                label: "Pay",
                value: formatPay(j.pay_range_min_cents, j.pay_range_max_cents, j.pay_type),
              },
              {
                icon: Users,
                label: "Positions",
                value: `${j.head_count} position${j.head_count > 1 ? "s" : ""}`,
              },
            ].map(({ icon: Icon, label, value }) => (
              <div key={label} className="bg-white/[0.03] border border-white/5 rounded-xl p-4">
                <div className="flex items-center gap-2 text-white/40 text-xs mb-1">
                  <Icon className="w-3.5 h-3.5" />{label}
                </div>
                <div className="font-semibold text-sm">{value}</div>
              </div>
            ))}
          </div>

          {/* Styles needed */}
          {j.styles_needed?.length > 0 && (
            <div className="mb-6">
              <div className="text-xs font-semibold text-white/40 uppercase tracking-widest mb-3">Styles Needed</div>
              <div className="flex flex-wrap gap-2">
                {j.styles_needed.map((s: string) => (
                  <span key={s} className="bg-violet-500/15 border border-violet-500/25 text-violet-300 text-sm px-3 py-1.5 rounded-full font-medium">{s}</span>
                ))}
              </div>
            </div>
          )}

          {/* Description */}
          {j.description && (
            <div className="mb-6">
              <div className="text-xs font-semibold text-white/40 uppercase tracking-widest mb-3">About This Role</div>
              <p className="text-white/70 text-sm leading-relaxed whitespace-pre-wrap">{j.description}</p>
            </div>
          )}

          {/* Requirements */}
          {!!j.requirements?.length && (
            <div className="mb-6">
              <div className="text-xs font-semibold text-white/40 uppercase tracking-widest mb-3">Requirements</div>
              <ul className="space-y-2">
                {(j.requirements ?? []).map((req: string) => (
                  <li key={req} className="flex items-start gap-2 text-sm text-white/60">
                    <span className="w-4 h-4 text-violet-400 shrink-0 mt-0.5">✓</span>
                    {req}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Deadline */}
          {j.application_deadline && (
            <div className="mt-6 pt-6 border-t border-white/5 flex items-center gap-2 text-sm text-amber-400">
              <Clock className="w-4 h-4" />
              Application deadline: <strong>{formatDate(j.application_deadline)}</strong>
            </div>
          )}
        </div>

        {/* Bottom CTA banner */}
        <div className="bg-violet-600/10 border border-violet-500/20 rounded-2xl p-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div>
            <div className="font-semibold text-white mb-1">Ready to apply?</div>
            <div className="text-sm text-white/50">
              {user
                ? "Head to your dashboard to submit your application."
                : "Create a free dancer account to apply for this role."}
            </div>
          </div>
          {user ? (
            <Link
              href={`/dashboard/jobs/${id}`}
              className="flex items-center gap-2 bg-violet-600 hover:bg-violet-500 text-white font-semibold px-6 py-3 rounded-xl text-sm transition-colors whitespace-nowrap"
            >
              Apply now <ArrowRight className="w-4 h-4" />
            </Link>
          ) : (
            <Link
              href="/signup?as=dancer"
              className="flex items-center gap-2 bg-violet-600 hover:bg-violet-500 text-white font-semibold px-6 py-3 rounded-xl text-sm transition-colors whitespace-nowrap"
            >
              Join & apply <ArrowRight className="w-4 h-4" />
            </Link>
          )}
        </div>
      </main>
    </div>
  );
}
