export const revalidate = 0;
export const metadata = { title: "EGATS | Admin Panel", robots: "noindex" };
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { ShieldAlert, Flag, ShieldCheck, Users, TrendingUp, BarChart2 } from "lucide-react";
import AdminActions from "./AdminActions";

interface SafetyReport {
  id: string;
  reporter_id: string;
  reported_user_id: string;
  category: string;
  description: string;
  status: string;
  admin_notes: string | null;
  created_at: string;
  updated_at: string;
  reporter: { display_name: string } | null;
  reported_user: { display_name: string } | null;
}

interface AdminStats {
  totalBookings: number | null;
  newUsersThisWeek: number | null;
  appsThisWeek: number | null;
  appsLastWeek: number | null;
  appsGrowthPct: number | null;
  verificationApprovalRate: number | null;
}

export default async function AdminPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Guard: admin only
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (!profile || profile.role !== "admin") {
    redirect("/dashboard");
  }

  // Fetch pending safety reports with reporter/reported user names
  const { data: rawReports } = await supabase
    .from("safety_reports")
    .select(`
      id,
      reporter_id,
      reported_user_id,
      category,
      description,
      status,
      admin_notes,
      created_at,
      updated_at,
      reporter:profiles!safety_reports_reporter_id_fkey(display_name),
      reported_user:profiles!safety_reports_reported_user_id_fkey(display_name)
    `)
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(50);

  const reports = (rawReports ?? []) as unknown as SafetyReport[];

  // Fetch pending verification records count
  const { count: pendingVerifications } = await supabase
    .from("verification_records")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending");

  // Fetch user role stats
  const { count: dancerCount } = await supabase
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("role", "dancer");

  const { count: recruiterCount } = await supabase
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("role", "recruiter");

  const { count: verifierCount } = await supabase
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("role", "verifier");

  // Fetch enhanced platform stats
  const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

  const [
    { count: totalBookings },
    { count: newUsersThisWeek },
    { count: appsThisWeek },
    { count: appsLastWeek },
    { count: verificationApproved },
    { count: verificationTotal },
    { count: totalCamps },
    { count: totalActiveJobs },
  ] = await Promise.all([
    supabase.from("bookings").select("*", { count: "exact", head: true }),
    supabase.from("profiles").select("*", { count: "exact", head: true }).gte("created_at", oneWeekAgo),
    supabase.from("applications").select("*", { count: "exact", head: true }).gte("created_at", oneWeekAgo),
    supabase.from("applications").select("*", { count: "exact", head: true }).gte("created_at", twoWeeksAgo).lt("created_at", oneWeekAgo),
    supabase.from("verification_records").select("*", { count: "exact", head: true }).not("verifier_id", "is", null).eq("revoked", false),
    supabase.from("verification_records").select("*", { count: "exact", head: true }).not("verifier_id", "is", null),
    supabase.from("camps").select("*", { count: "exact", head: true }),
    supabase.from("jobs").select("*", { count: "exact", head: true }).eq("status", "open"),
  ]);

  const appsGrowthPct =
    appsLastWeek
      ? Math.round(((appsThisWeek! - appsLastWeek!) / appsLastWeek!) * 100)
      : null;

  const verificationApprovalRate =
    verificationTotal
      ? Math.round((verificationApproved! / verificationTotal!) * 100)
      : null;

  const stats: AdminStats = {
    totalBookings,
    newUsersThisWeek,
    appsThisWeek,
    appsLastWeek,
    appsGrowthPct,
    verificationApprovalRate,
  };

  return (
    <div className="space-y-10">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center">
          <ShieldAlert className="w-5 h-5 text-red-400" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Admin Panel</h1>
          <p className="text-sm text-white/40">Platform moderation and oversight</p>
        </div>
      </div>

      {/* ── Section 1: User Stats ── */}
      <section>
        <div className="flex items-center gap-2 mb-4">
          <Users className="w-4 h-4 text-white/40" />
          <h2 className="text-sm font-semibold text-white/60 uppercase tracking-widest">User Stats</h2>
        </div>
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-white/[0.04] border border-white/10 rounded-2xl p-5 text-center">
            <div className="text-3xl font-bold text-white mb-1">{dancerCount ?? 0}</div>
            <div className="text-xs text-white/40 uppercase tracking-widest">Dancers</div>
          </div>
          <div className="bg-white/[0.04] border border-white/10 rounded-2xl p-5 text-center">
            <div className="text-3xl font-bold text-white mb-1">{recruiterCount ?? 0}</div>
            <div className="text-xs text-white/40 uppercase tracking-widest">Recruiters</div>
          </div>
          <div className="bg-white/[0.04] border border-white/10 rounded-2xl p-5 text-center">
            <div className="text-3xl font-bold text-white mb-1">{verifierCount ?? 0}</div>
            <div className="text-xs text-white/40 uppercase tracking-widest">Verifiers</div>
          </div>
        </div>
      </section>

      {/* ── Section 2: Platform Stats ── */}
      <section>
        <div className="flex items-center gap-2 mb-4">
          <BarChart2 className="w-4 h-4 text-white/40" />
          <h2 className="text-sm font-semibold text-white/60 uppercase tracking-widest">Platform Stats</h2>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          {/* Total Bookings */}
          <div className="bg-white/[0.04] border border-white/10 rounded-2xl p-5">
            <div className="text-2xl font-bold text-white mb-1">{stats.totalBookings ?? 0}</div>
            <div className="text-xs text-white/40 uppercase tracking-widest">Total Bookings</div>
          </div>

          {/* New Users This Week */}
          <div className="bg-white/[0.04] border border-white/10 rounded-2xl p-5">
            <div className="text-2xl font-bold text-white mb-1">{stats.newUsersThisWeek ?? 0}</div>
            <div className="text-xs text-white/40 uppercase tracking-widest">New Users (7d)</div>
          </div>

          {/* Applications This Week + Growth */}
          <div className="bg-white/[0.04] border border-white/10 rounded-2xl p-5">
            <div className="flex items-end gap-2 mb-1">
              <div className="text-2xl font-bold text-white">{stats.appsThisWeek ?? 0}</div>
              {stats.appsGrowthPct !== null && (
                <div
                  className={`flex items-center gap-0.5 text-[12px] font-semibold mb-0.5 ${
                    stats.appsGrowthPct >= 0 ? "text-green-400" : "text-red-400"
                  }`}
                >
                  <TrendingUp className="w-3 h-3" />
                  {stats.appsGrowthPct >= 0 ? "+" : ""}
                  {stats.appsGrowthPct}%
                </div>
              )}
            </div>
            <div className="text-xs text-white/40 uppercase tracking-widest">Applications (7d)</div>
            {stats.appsLastWeek !== null && (
              <div className="text-[11px] text-white/25 mt-1">
                {stats.appsLastWeek} last week
              </div>
            )}
          </div>

          {/* Verification Approval Rate */}
          <div className="bg-white/[0.04] border border-white/10 rounded-2xl p-5">
            <div className="text-2xl font-bold text-white mb-1">
              {stats.verificationApprovalRate !== null
                ? `${stats.verificationApprovalRate}%`
                : "—"}
            </div>
            <div className="text-xs text-white/40 uppercase tracking-widest">Verification Approval</div>
            <div className="text-[11px] text-white/25 mt-1">
              {verificationApproved ?? 0} of {verificationTotal ?? 0} reviewed
            </div>
          </div>

          {/* Total Camps */}
          <div className="bg-white/[0.04] border border-white/10 rounded-2xl p-5">
            <div className="text-2xl font-bold text-white mb-1">{totalCamps ?? 0}</div>
            <div className="text-xs text-white/40 uppercase tracking-widest">Total Camps</div>
          </div>

          {/* Total Active Jobs */}
          <div className="bg-white/[0.04] border border-white/10 rounded-2xl p-5">
            <div className="text-2xl font-bold text-white mb-1">{totalActiveJobs ?? 0}</div>
            <div className="text-xs text-white/40 uppercase tracking-widest">Active Jobs</div>
          </div>
        </div>
      </section>

      {/* ── Section 3: Pending Verifications ── */}
      <section>
        <div className="flex items-center gap-2 mb-4">
          <ShieldCheck className="w-4 h-4 text-white/40" />
          <h2 className="text-sm font-semibold text-white/60 uppercase tracking-widest">Pending Verifications</h2>
        </div>
        <div className="bg-white/[0.04] border border-white/10 rounded-2xl p-5 flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center">
            <ShieldCheck className="w-5 h-5 text-blue-400" />
          </div>
          <div>
            <div className="text-2xl font-bold text-white">{pendingVerifications ?? 0}</div>
            <div className="text-sm text-white/40">
              {pendingVerifications === 1 ? "verification" : "verifications"} awaiting review
            </div>
          </div>
          {(pendingVerifications ?? 0) > 0 && (
            <a
              href="/dashboard/verify"
              className="ml-auto text-sm font-semibold text-violet-400 hover:text-violet-300 transition-colors"
            >
              Go to queue →
            </a>
          )}
        </div>
      </section>

      {/* ── Section 4: Safety Reports ── */}
      <section>
        <div className="flex items-center gap-2 mb-4">
          <Flag className="w-4 h-4 text-white/40" />
          <h2 className="text-sm font-semibold text-white/60 uppercase tracking-widest">
            Safety Reports
            {reports.length > 0 && (
              <span className="ml-2 text-[11px] font-bold bg-red-500/20 text-red-400 px-1.5 py-0.5 rounded-full normal-case tracking-normal">
                {reports.length} pending
              </span>
            )}
          </h2>
        </div>

        {reports.length === 0 ? (
          <div className="bg-white/[0.02] border border-white/5 rounded-2xl py-12 text-center">
            <Flag className="w-8 h-8 text-white/15 mx-auto mb-3" />
            <p className="text-sm text-white/40">No pending safety reports</p>
          </div>
        ) : (
          <div className="space-y-3">
            {reports.map((report) => (
              <div
                key={report.id}
                className="bg-white/[0.04] border border-white/10 rounded-2xl p-5 space-y-3"
              >
                {/* Report header */}
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-semibold bg-red-500/15 text-red-400 px-2 py-0.5 rounded-full capitalize">
                        {report.category.replace(/_/g, " ")}
                      </span>
                      <span className="text-xs text-white/30">
                        {new Date(report.created_at).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })}
                      </span>
                    </div>
                    <p className="text-sm text-white/80">
                      <span className="font-semibold text-white">
                        {report.reporter?.display_name ?? "Unknown"}
                      </span>{" "}
                      reported{" "}
                      <span className="font-semibold text-white">
                        {report.reported_user?.display_name ?? "Unknown"}
                      </span>
                    </p>
                  </div>
                </div>

                {/* Description */}
                <p className="text-sm text-white/50 leading-relaxed border-t border-white/[0.06] pt-3">
                  {report.description}
                </p>

                {/* Actions */}
                <div className="flex items-center gap-2 pt-1">
                  <AdminActions reportId={report.id} />
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
