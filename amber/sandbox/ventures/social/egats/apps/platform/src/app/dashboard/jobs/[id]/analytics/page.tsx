export const revalidate = 60;
export const metadata = { title: "EGATS | Job Analytics", robots: "noindex" };

import { createClient } from "@/lib/supabase/server";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, BarChart2, Users, TrendingUp, MapPin, Music } from "lucide-react";
import type { Application } from "@/types/database";

// ── helpers ──────────────────────────────────────────────────────────────────

function groupByDate(apps: Application[]): Record<string, number> {
  const counts: Record<string, number> = {};
  const now = new Date();
  // pre-fill last 14 days with 0
  for (let i = 13; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    counts[d.toISOString().slice(0, 10)] = 0;
  }
  for (const app of apps) {
    const day = app.created_at.slice(0, 10);
    if (day in counts) counts[day] = (counts[day] ?? 0) + 1;
  }
  return counts;
}

function topN<T extends string>(items: T[], n = 5): { value: T; count: number }[] {
  const map = new Map<T, number>();
  for (const item of items) map.set(item, (map.get(item) ?? 0) + 1);
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([value, count]) => ({ value, count }));
}

function avg(nums: number[]): number {
  if (!nums.length) return 0;
  return nums.reduce((s, n) => s + n, 0) / nums.length;
}

// ── page ─────────────────────────────────────────────────────────────────────

export default async function JobAnalyticsPage({
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

  // Verify this recruiter owns the job
  const { data: recruiterProfile } = await supabase
    .from("recruiter_profiles")
    .select("id")
    .eq("user_id", user.id)
    .single();

  if (!recruiterProfile) redirect("/dashboard/jobs");

  const { data: job } = await supabase
    .from("jobs")
    .select("id, title, status, view_count, recruiter_id")
    .eq("id", id)
    .single();

  if (!job) notFound();
  if (job.recruiter_id !== recruiterProfile.id) redirect("/dashboard/jobs");

  // Fetch all applications with dancer info
  const { data: rawApps } = await supabase
    .from("applications")
    .select(
      "id, status, created_at, ai_match_score, dancer:dancer_profiles(styles, profile:profiles(location))"
    )
    .eq("job_id", id)
    .order("created_at", { ascending: true });

  const apps = (rawApps ?? []) as unknown as (Application & {
    dancer?: { styles: string[]; profile?: { location?: string | null } };
  })[];

  // ── metrics ──────────────────────────────────────────────────────────────
  const total = apps.length;
  const shortlisted = apps.filter((a) => a.status === "shortlisted").length;
  const audition = apps.filter(
    (a) => a.status === "audition_requested"
  ).length;
  const booked = apps.filter((a) => a.status === "booked").length;

  const pct = (n: number) => (total > 0 ? Math.round((n / total) * 100) : 0);

  const matchScores = apps
    .map((a) => a.ai_match_score)
    .filter((s): s is number => s !== null);
  const avgScore = avg(matchScores);

  const allStyles = apps.flatMap((a) => a.dancer?.styles ?? []);
  const topStyles = topN(allStyles, 6);

  const allLocations = apps
    .map((a) => a.dancer?.profile?.location ?? null)
    .filter((l): l is string => l !== null && l.trim() !== "");
  const topLocations = topN(allLocations, 6);

  const dailyCounts = groupByDate(apps as unknown as Application[]);
  const maxDay = Math.max(...Object.values(dailyCounts), 1);
  const dateEntries = Object.entries(dailyCounts);

  const funnelStages = [
    { label: "Applied", count: total, color: "bg-white/20" },
    { label: "Shortlisted", count: shortlisted, color: "bg-violet-500/60" },
    { label: "Audition Req.", count: audition, color: "bg-blue-500/60" },
    { label: "Booked", count: booked, color: "bg-green-500/60" },
  ];

  // ── render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-8 max-w-4xl">
      <Link
        href={`/dashboard/jobs/${id}`}
        className="inline-flex items-center gap-2 text-sm text-white/40 hover:text-white/70 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" /> Back to Job
      </Link>

      <div>
        <div className="flex items-center gap-2 mb-1">
          <BarChart2 className="w-5 h-5 text-violet-400" />
          <h1 className="text-2xl font-bold">Analytics</h1>
        </div>
        <p className="text-white/40 text-sm">{job.title}</p>
      </div>

      {/* Metric cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          {
            label: "Total Applications",
            value: total,
            icon: Users,
            color: "text-white",
          },
          {
            label: "Job Views",
            value: job.view_count ?? "—",
            icon: TrendingUp,
            color: "text-violet-400",
          },
          {
            label: "Avg AI Match",
            value: matchScores.length ? `${Math.round(avgScore)}%` : "—",
            icon: BarChart2,
            color: "text-blue-400",
          },
          {
            label: "Booked",
            value: booked,
            icon: Users,
            color: "text-green-400",
          },
        ].map(({ label, value, icon: Icon, color }) => (
          <div
            key={label}
            className="bg-white/[0.04] border border-white/10 rounded-2xl p-5"
          >
            <div className="flex items-center gap-2 text-white/30 text-xs mb-2">
              <Icon className="w-3.5 h-3.5" />
              {label}
            </div>
            <div className={`text-3xl font-bold ${color}`}>{value}</div>
          </div>
        ))}
      </div>

      {/* Applications over time */}
      <div className="bg-white/[0.04] border border-white/10 rounded-2xl p-6">
        <div className="text-xs font-semibold text-white/40 uppercase tracking-widest mb-5">
          Applications: Last 14 Days
        </div>
        {total === 0 ? (
          <p className="text-white/20 text-sm">No applications yet.</p>
        ) : (
          <div className="flex items-end gap-1.5 h-24">
            {dateEntries.map(([date, count]) => (
              <div
                key={date}
                className="flex-1 flex flex-col items-center gap-1 group"
                title={`${date}: ${count}`}
              >
                <div
                  className="w-full bg-violet-500/50 rounded-sm transition-all group-hover:bg-violet-400/70"
                  style={{
                    height: `${Math.round((count / maxDay) * 100)}%`,
                    minHeight: count > 0 ? 3 : 0,
                  }}
                />
              </div>
            ))}
          </div>
        )}
        {/* X-axis labels — show first and last date */}
        {dateEntries.length > 0 && (
          <div className="flex justify-between text-[10px] text-white/20 mt-2">
            <span>{dateEntries[0][0]}</span>
            <span>{dateEntries[dateEntries.length - 1][0]}</span>
          </div>
        )}
      </div>

      {/* Conversion funnel */}
      <div className="bg-white/[0.04] border border-white/10 rounded-2xl p-6">
        <div className="text-xs font-semibold text-white/40 uppercase tracking-widest mb-5">
          Conversion Funnel
        </div>
        {total === 0 ? (
          <p className="text-white/20 text-sm">No applications yet.</p>
        ) : (
          <div className="space-y-3">
            {funnelStages.map(({ label, count, color }) => (
              <div key={label} className="flex items-center gap-3">
                <div className="w-28 text-right text-xs text-white/50 shrink-0">
                  {label}
                </div>
                <div className="flex-1 bg-white/[0.05] rounded-full h-6 overflow-hidden">
                  <div
                    className={`h-full rounded-full ${color} flex items-center justify-end pr-3 transition-all`}
                    style={{ width: `${Math.max(pct(count), count > 0 ? 4 : 0)}%` }}
                  >
                    {count > 0 && (
                      <span className="text-[10px] font-semibold text-white/80">
                        {count}
                      </span>
                    )}
                  </div>
                </div>
                <div className="w-10 text-xs text-white/30 shrink-0">
                  {pct(count)}%
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Bottom row: styles + locations */}
      <div className="grid sm:grid-cols-2 gap-6">
        {/* Top styles */}
        <div className="bg-white/[0.04] border border-white/10 rounded-2xl p-6">
          <div className="flex items-center gap-2 text-xs font-semibold text-white/40 uppercase tracking-widest mb-4">
            <Music className="w-3.5 h-3.5" /> Top Styles
          </div>
          {topStyles.length === 0 ? (
            <p className="text-white/20 text-sm">No data yet.</p>
          ) : (
            <ul className="space-y-2">
              {topStyles.map(({ value, count }) => (
                <li key={value} className="flex items-center justify-between text-sm">
                  <span className="text-white/70">{value}</span>
                  <span className="text-violet-400 font-semibold">{count}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Top locations */}
        <div className="bg-white/[0.04] border border-white/10 rounded-2xl p-6">
          <div className="flex items-center gap-2 text-xs font-semibold text-white/40 uppercase tracking-widest mb-4">
            <MapPin className="w-3.5 h-3.5" /> Top Locations
          </div>
          {topLocations.length === 0 ? (
            <p className="text-white/20 text-sm">No location data.</p>
          ) : (
            <ul className="space-y-2">
              {topLocations.map(({ value, count }) => (
                <li key={value} className="flex items-center justify-between text-sm">
                  <span className="text-white/70">{value}</span>
                  <span className="text-violet-400 font-semibold">{count}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
