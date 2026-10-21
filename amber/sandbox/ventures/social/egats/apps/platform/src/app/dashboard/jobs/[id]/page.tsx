export const revalidate = 60;
export const metadata = { title: "EGATS | Job Details", robots: "noindex" };
import { createClient } from "@/lib/supabase/server";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { MapPin, Calendar, DollarSign, Users, Clock, ArrowLeft, Pencil, BarChart2, Download } from "lucide-react";
import VerificationBadge from "@/components/verification-badge";
import { formatPay, formatDate } from "@/lib/utils";
import type { Job, Application, DancerProfile } from "@/types/database";
import JobActions from "./JobActions";

export default async function JobDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();

  const { data: job } = await supabase
    .from("jobs")
    .select("*, recruiter:recruiter_profiles(*, profile:profiles(display_name, avatar_url, location))")
    .eq("id", id)
    .single();

  if (!job) notFound();
  const j = job as unknown as Job;

  let applications: Application[] = [];
  let hasApplied = false;
  let dancerProfile: DancerProfile | null = null;
  let isJobOwner = false;

  if (profile?.role === "recruiter") {
    const { data: recruiterProfile } = await supabase
      .from("recruiter_profiles")
      .select("id")
      .eq("user_id", user.id)
      .single();
    if (recruiterProfile && j.recruiter_id === recruiterProfile.id) {
      isJobOwner = true;
    }

    const { data: apps } = await supabase
      .from("applications")
      .select("*, dancer:dancer_profiles(*, profile:profiles(display_name, avatar_url, location), clips:portfolio_clips(thumbnail_url, clip_url, is_featured, styles))")
      .eq("job_id", id)
      .order("ai_match_score", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false });
    applications = apps as unknown as Application[] || [];
  } else {
    const { data: dp } = await supabase.from("dancer_profiles").select("*").eq("user_id", user.id).single();
    dancerProfile = dp;
    if (dp) {
      const { data: existingApp } = await supabase.from("applications").select("id").eq("job_id", id).eq("dancer_id", dp.id).single();
      hasApplied = !!existingApp;
    }
  }

  return (
    <div className="space-y-8 max-w-4xl">
      <Link href="/dashboard/jobs" className="inline-flex items-center gap-2 text-sm text-white/40 hover:text-white/70 transition-colors">
        <ArrowLeft className="w-4 h-4" /> Back to Jobs
      </Link>

      <div className="bg-white/[0.04] border border-white/10 rounded-3xl p-8">
        <div className="flex items-start justify-between gap-6 flex-wrap mb-6">
          <div>
            <div className="flex items-center gap-3 flex-wrap mb-3">
              <span className="text-xs font-semibold bg-violet-500/20 text-violet-300 px-3 py-1 rounded-full">{j.role_type}</span>
              <VerificationBadge tier={j.min_verification_tier} size="sm" showLabel />
              <span className={`text-xs font-semibold px-3 py-1 rounded-full ${
                (j.status as string) === "open"
                  ? "bg-green-500/20 text-green-400"
                  : (j.status as string) === "cancelled"
                  ? "bg-red-500/20 text-red-400"
                  : "bg-zinc-700/50 text-zinc-400"
              }`}>
                {j.status}
              </span>
            </div>
            <h1 className="text-3xl font-bold mb-2">{j.title}</h1>
            <div className="text-white/50 text-base">{(j.recruiter as unknown as { company_name: string })?.company_name}</div>
          </div>
          <div className="flex flex-col items-end gap-3">
            {isJobOwner && (
              <div className="flex items-center gap-2">
                <Link
                  href={`/dashboard/jobs/${id}/analytics`}
                  className="flex items-center gap-2 bg-white/5 hover:bg-white/10 border border-white/10 text-white/70 hover:text-white font-semibold px-5 py-2.5 rounded-xl text-sm transition-colors"
                >
                  <BarChart2 className="w-4 h-4" />
                  View Analytics
                </Link>
                <Link
                  href={`/dashboard/jobs/${id}/edit`}
                  className="flex items-center gap-2 bg-white/5 hover:bg-white/10 border border-white/10 text-white/70 hover:text-white font-semibold px-5 py-2.5 rounded-xl text-sm transition-colors"
                >
                  <Pencil className="w-4 h-4" />
                  Edit Job
                </Link>
              </div>
            )}
            <JobActions
              jobId={id}
              jobStatus={j.status}
              applicationDeadline={j.application_deadline}
              userRole={profile?.role || "dancer"}
              hasApplied={hasApplied}
              applications={applications}
            />
          </div>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {[
            { icon: MapPin, label: "Location", value: j.remote_possible ? "Remote" : j.city ? `${j.city}${j.state ? `, ${j.state}` : ""}` : "TBD" },
            { icon: Calendar, label: "Start Date", value: j.start_date ? formatDate(j.start_date) : "Flexible" },
            { icon: DollarSign, label: "Pay", value: formatPay(j.pay_range_min_cents, j.pay_range_max_cents, j.pay_type) },
            { icon: Users, label: "Positions", value: `${j.head_count} position${j.head_count > 1 ? "s" : ""}` },
          ].map(({ icon: Icon, label, value }) => (
            <div key={label} className="bg-white/[0.03] border border-white/5 rounded-xl p-4">
              <div className="flex items-center gap-2 text-white/40 text-xs mb-1"><Icon className="w-3.5 h-3.5" />{label}</div>
              <div className="font-semibold text-sm">{value}</div>
            </div>
          ))}
        </div>

        <div className="mb-6">
          <div className="text-xs font-semibold text-white/40 uppercase tracking-widest mb-3">Styles Needed</div>
          <div className="flex flex-wrap gap-2">
            {j.styles_needed.map((s) => (
              <span key={s} className="bg-violet-500/15 border border-violet-500/25 text-violet-300 text-sm px-3 py-1.5 rounded-full font-medium">{s}</span>
            ))}
          </div>
        </div>

        <div className="mb-6">
          <div className="text-xs font-semibold text-white/40 uppercase tracking-widest mb-3">About This Role</div>
          <p className="text-white/70 text-sm leading-relaxed whitespace-pre-wrap">{j.description}</p>
        </div>

        {j.requirements?.length ? (
          <div>
            <div className="text-xs font-semibold text-white/40 uppercase tracking-widest mb-3">Requirements</div>
            <ul className="space-y-2">
              {j.requirements.map((req) => (
                <li key={req} className="flex items-start gap-2 text-sm text-white/60">
                  <span className="w-4 h-4 text-violet-400 shrink-0 mt-0.5">✓</span>
                  {req}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {j.application_deadline && (
          <div className="mt-6 pt-6 border-t border-white/5 flex items-center gap-2 text-sm text-amber-400">
            <Clock className="w-4 h-4" />
            Application deadline: <strong>{formatDate(j.application_deadline)}</strong>
          </div>
        )}
      </div>

      {isJobOwner && applications.length > 0 && (() => {
        const total = applications.length;
        const shortlisted = applications.filter((a) => a.status === "shortlisted").length;
        const audition = applications.filter((a) => a.status === "audition_requested").length;
        const booked = applications.filter((a) => a.status === "booked").length;
        const pct = (n: number) => total > 0 ? Math.round((n / total) * 100) : 0;

        return (
          <div className="bg-white/[0.03] border border-white/10 rounded-2xl p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="text-xs font-semibold text-white/40 uppercase tracking-widest">Application Funnel</div>
              {isJobOwner && applications && applications.length > 0 && (
                <a
                  href={`/api/export/applications?jobId=${id}`}
                  className="flex items-center gap-1.5 text-xs text-white/40 hover:text-white/70 transition-colors"
                  download
                >
                  <Download className="w-3.5 h-3.5" />
                  Export CSV
                </a>
              )}
            </div>
            <div className="grid grid-cols-4 gap-3">
              {[
                { label: "Total Applied", count: total, color: "text-white" },
                { label: "Shortlisted", count: shortlisted, color: "text-violet-400" },
                { label: "Audition Req.", count: audition, color: "text-blue-400" },
                { label: "Booked", count: booked, color: "text-green-400" },
              ].map(({ label, count, color }) => (
                <div key={label} className="bg-white/[0.04] border border-white/5 rounded-xl p-4 text-center">
                  <div className={`text-2xl font-bold ${color} mb-1`}>{count}</div>
                  <div className="text-xs text-white/40">{label}</div>
                  {count > 0 && count !== total && (
                    <div className="text-xs text-white/20 mt-0.5">{pct(count)}%</div>
                  )}
                </div>
              ))}
            </div>
          </div>
        );
      })()}
    </div>
  );
}
