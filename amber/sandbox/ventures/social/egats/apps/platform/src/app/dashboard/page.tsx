import type { Metadata } from "next";
export const revalidate = 60;
export const metadata: Metadata = {
  title: "Dashboard",
  description: "Your EGATS dashboard: manage applications, bookings, and opportunities.",
  robots: "noindex",
};
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import {
  ArrowRight, Award, Calendar, Briefcase, BookOpen,
  TrendingUp, Users, Bookmark, Plus, Bell,
  CheckCircle2, Clock, XCircle, MessageSquare, Star,
} from "lucide-react";
import VerificationBadge from "@/components/verification-badge";
import JobCard from "@/components/job-card";
import type { Job } from "@/types/database";
import { formatDate } from "@/lib/utils";

// ─── Helpers ────────────────────────────────────────────────────────────────

function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

// ─── Stat Card ───────────────────────────────────────────────────────────────

type StatColor = "violet" | "green" | "amber" | "blue" | "pink";

const STAT_COLORS: Record<StatColor, { glow: string; border: string; icon: string; num: string }> = {
  violet: {
    glow: "radial-gradient(ellipse 80% 60% at 50% 0%, rgba(191,90,242,0.14) 0%, transparent 70%)",
    border: "rgba(191,90,242,0.2)",
    icon: "text-violet-400",
    num: "text-white",
  },
  green: {
    glow: "radial-gradient(ellipse 80% 60% at 50% 0%, rgba(48,209,88,0.12) 0%, transparent 70%)",
    border: "rgba(48,209,88,0.2)",
    icon: "text-green-400",
    num: "text-white",
  },
  amber: {
    glow: "radial-gradient(ellipse 80% 60% at 50% 0%, rgba(255,214,10,0.12) 0%, transparent 70%)",
    border: "rgba(255,214,10,0.2)",
    icon: "text-amber-400",
    num: "text-white",
  },
  blue: {
    glow: "radial-gradient(ellipse 80% 60% at 50% 0%, rgba(10,132,255,0.12) 0%, transparent 70%)",
    border: "rgba(10,132,255,0.2)",
    icon: "text-blue-400",
    num: "text-white",
  },
  pink: {
    glow: "radial-gradient(ellipse 80% 60% at 50% 0%, rgba(255,55,95,0.12) 0%, transparent 70%)",
    border: "rgba(255,55,95,0.2)",
    icon: "text-pink-400",
    num: "text-white",
  },
};

function StatCard({
  icon: Icon,
  label,
  value,
  color,
  href,
}: {
  icon: React.ElementType;
  label: string;
  value: string | number;
  color: StatColor;
  href?: string;
}) {
  const c = STAT_COLORS[color];
  const inner = (
    <div
      className="relative rounded-2xl p-5 h-full flex flex-col gap-3 transition-all duration-200 hover:translate-y-[-2px]"
      style={{
        background: "#1C1C1E",
        border: `1px solid ${c.border}`,
        boxShadow: "0 1px 2px rgba(0,0,0,0.3)",
      }}
    >
      {/* Top glow */}
      <div
        className="absolute inset-0 rounded-2xl pointer-events-none"
        style={{ background: c.glow }}
      />
      <div className={`relative w-8 h-8 rounded-xl flex items-center justify-center`}
        style={{ background: `${c.border}44` }}>
        <Icon className={`w-4 h-4 ${c.icon}`} />
      </div>
      <div className="relative">
        <div className={`text-[28px] font-black tracking-tight leading-none ${c.num}`}>{value}</div>
        <div className="text-[11px] text-white/40 mt-1.5 font-medium uppercase tracking-wider">{label}</div>
      </div>
    </div>
  );

  if (href) {
    return (
      <Link href={href} className="block">
        {inner}
      </Link>
    );
  }
  return inner;
}

// ─── Getting Started Card ────────────────────────────────────────────────────

function GettingStartedCard({
  role,
  profile,
  hasCamps,
  hasApplications,
  hasClips,
  hasJobs,
}: {
  role: string;
  profile: Record<string, unknown>;
  hasCamps?: boolean;
  hasApplications?: boolean;
  hasClips?: boolean;
  hasJobs?: boolean;
}) {
  const steps =
    role === "creative" || role === "dancer"
      ? [
          {
            label: "Complete your profile",
            done: !!profile?.display_name && !!profile?.bio,
            href: "/dashboard/profile",
          },
          {
            label: "Add a portfolio clip",
            done: !!hasClips,
            href: "/dashboard/portfolio",
          },
          {
            label: "Register for a camp",
            done: !!hasCamps,
            href: "/dashboard/camps",
          },
          {
            label: "Apply to your first job",
            done: !!hasApplications,
            href: "/dashboard/jobs",
          },
          {
            label: "Get verified",
            done:
              (profile?.verification_tier as string) !== "0" &&
              !!profile?.verification_tier,
            href: "/dashboard/verification",
          },
        ]
      : [
          {
            label: "Complete your company profile",
            done: !!profile?.display_name,
            href: "/dashboard/profile",
          },
          {
            label: "Post your first job",
            done: !!hasJobs,
            href: "/dashboard/jobs/new",
          },
          {
            label: "Find creatives",
            done: false,
            href: "/dashboard/dancers",
          },
        ];

  const completed = steps.filter((s) => s.done).length;
  const pct = Math.round((completed / steps.length) * 100);
  if (completed === steps.length) return null;

  return (
    <div
      className="rounded-2xl p-6 mb-2"
      style={{
        background: "linear-gradient(135deg, rgba(94,92,230,0.12) 0%, rgba(191,90,242,0.08) 100%)",
        border: "1px solid rgba(94,92,230,0.25)",
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-1">
        <div>
          <h3 className="font-bold text-[15px] tracking-tight">Getting Started</h3>
          <p className="text-[12px] text-white/40 mt-0.5">
            {completed} of {steps.length} steps complete
          </p>
        </div>
        <span className="text-[22px] font-black text-violet-400 tabular-nums">{pct}%</span>
      </div>

      {/* Progress bar */}
      <div className="h-1.5 rounded-full bg-white/[0.06] mb-5 overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{
            width: `${pct}%`,
            background: "linear-gradient(90deg, #5E5CE6 0%, #BF5AF2 100%)",
          }}
        />
      </div>

      {/* Steps */}
      <div className="space-y-1">
        {steps.map((step) => (
          <Link
            key={step.label}
            href={step.href}
            className={`flex items-center gap-3 py-2 px-3 rounded-xl text-[13px] transition-colors ${
              step.done
                ? "text-white/25 line-through cursor-default pointer-events-none"
                : "text-white/65 hover:text-white hover:bg-white/[0.05]"
            }`}
          >
            <span
              className={`w-4 h-4 rounded-full border flex-shrink-0 flex items-center justify-center text-[9px] font-bold transition-colors ${
                step.done
                  ? "bg-green-500/20 border-green-500/30 text-green-400"
                  : "border-white/15 text-transparent"
              }`}
            >
              {step.done ? "✓" : ""}
            </span>
            {step.label}
          </Link>
        ))}
      </div>
    </div>
  );
}

// ─── Activity Icon ────────────────────────────────────────────────────────────

function ActivityIcon({ type }: { type?: string }) {
  if (type?.includes("booking") || type?.includes("booked")) {
    return (
      <div className="shrink-0 w-8 h-8 rounded-full bg-green-500/10 flex items-center justify-center">
        <BookOpen className="w-3.5 h-3.5 text-green-400" />
      </div>
    );
  }
  if (type?.includes("message") || type?.includes("chat")) {
    return (
      <div className="shrink-0 w-8 h-8 rounded-full bg-blue-500/10 flex items-center justify-center">
        <MessageSquare className="w-3.5 h-3.5 text-blue-400" />
      </div>
    );
  }
  if (type?.includes("shortlist")) {
    return (
      <div className="shrink-0 w-8 h-8 rounded-full bg-amber-500/10 flex items-center justify-center">
        <Bookmark className="w-3.5 h-3.5 text-amber-400" />
      </div>
    );
  }
  if (type?.includes("reject") || type?.includes("denied")) {
    return (
      <div className="shrink-0 w-8 h-8 rounded-full bg-red-500/10 flex items-center justify-center">
        <XCircle className="w-3.5 h-3.5 text-red-400" />
      </div>
    );
  }
  if (type?.includes("approved") || type?.includes("accept") || type?.includes("verified")) {
    return (
      <div className="shrink-0 w-8 h-8 rounded-full bg-green-500/10 flex items-center justify-center">
        <CheckCircle2 className="w-3.5 h-3.5 text-green-400" />
      </div>
    );
  }
  if (type?.includes("review") || type?.includes("rating")) {
    return (
      <div className="shrink-0 w-8 h-8 rounded-full bg-yellow-500/10 flex items-center justify-center">
        <Star className="w-3.5 h-3.5 text-yellow-400" />
      </div>
    );
  }
  // Default
  return (
    <div className="shrink-0 w-8 h-8 rounded-full bg-violet-500/10 flex items-center justify-center">
      <Bell className="w-3.5 h-3.5 text-violet-400" />
    </div>
  );
}

// ─── Section Header ───────────────────────────────────────────────────────────

function SectionHeader({ title, href, linkLabel = "View all" }: { title: string; href?: string; linkLabel?: string }) {
  return (
    <div className="flex items-center justify-between mb-4">
      <h2 className="font-bold text-[17px] tracking-tight">{title}</h2>
      {href && (
        <Link
          href={href}
          className="flex items-center gap-1 text-[12px] text-violet-400 hover:text-violet-300 transition-colors font-medium"
        >
          {linkLabel}
          <ArrowRight className="w-3 h-3" />
        </Link>
      )}
    </div>
  );
}

// ─── Empty State ──────────────────────────────────────────────────────────────

function EmptyState({ icon: Icon, message, cta, href }: {
  icon: React.ElementType;
  message: string;
  cta?: string;
  href?: string;
}) {
  return (
    <div
      className="rounded-2xl p-8 text-center"
      style={{ background: "rgba(28,28,30,0.5)", border: "1px solid rgba(84,84,88,0.3)" }}
    >
      <Icon className="w-8 h-8 text-white/15 mx-auto mb-3" />
      <p className="text-[13px] text-white/35 mb-3">{message}</p>
      {cta && href && (
        <Link href={href} className="text-[13px] text-violet-400 hover:text-violet-300 transition-colors font-medium">
          {cta} →
        </Link>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  if (!profile) redirect("/login");

  if (profile.role === "recruiter") {
    return <RecruiterDashboard userId={user.id} displayName={profile.display_name} />;
  }

  return <CreativeDashboard userId={user.id} displayName={profile.display_name} />;
}

// ─── Creative Dashboard ───────────────────────────────────────────────────────

async function CreativeDashboard({
  userId,
  displayName,
}: {
  userId: string;
  displayName: string;
}) {
  const supabase = await createClient();
  const today = new Date().toISOString().split("T")[0];

  const [
    { data: dancer },
    { data: upcomingCamps },
    { data: recentApplications },
    { data: featuredJobs },
    { count: activeApplicationsCount },
    { count: upcomingBookingsCount },
    { count: completedBookingsCount },
    { data: recentNotifications },
    { count: clipsCount },
    { count: campRegCount },
    { count: totalApplicationsCount },
  ] = await Promise.all([
    supabase.from("dancer_profiles").select("*").eq("user_id", userId).single(),
    supabase
      .from("camps")
      .select("*")
      .eq("is_published", true)
      .gte("start_date", today)
      .order("start_date")
      .limit(2),
    supabase
      .from("applications")
      .select("*, job:jobs(title, role_type, city)")
      .eq("user_id", userId)
      .gte("created_at", new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString())
      .order("created_at", { ascending: false })
      .limit(5),
    supabase
      .from("jobs")
      .select("*, recruiter:recruiter_profiles(company_name)")
      .eq("status", "open")
      .order("created_at", { ascending: false })
      .limit(4),
    supabase
      .from("applications")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId)
      .in("status", ["pending", "shortlisted", "audition_requested"]),
    supabase
      .from("bookings")
      .select("*", { count: "exact", head: true })
      .eq("dancer_id", userId)
      .eq("status", "confirmed")
      .gte("start_date", today),
    supabase
      .from("bookings")
      .select("*", { count: "exact", head: true })
      .eq("dancer_id", userId)
      .eq("status", "completed"),
    supabase
      .from("notifications")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(5),
    supabase
      .from("portfolio_clips")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId),
    supabase
      .from("camp_registrations")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId),
    supabase
      .from("applications")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId),
  ]);

  const tier = dancer?.verification_tier || "0";
  const nextTier = tier === "0" ? "1" : tier === "1" ? "2" : null;
  const avgRating = dancer?.avg_rating ? dancer.avg_rating.toFixed(1) : "—";

  const profileFieldsFilled = [
    dancer?.display_name,
    dancer?.bio,
    dancer?.city,
    dancer?.styles?.length,
  ].filter(Boolean).length;
  const profileCompleteness = Math.round((profileFieldsFilled / 4) * 100);

  return (
    <div className="space-y-8">
      {/* ── Welcome ── */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[12px] text-white/30 font-medium uppercase tracking-widest mb-1">
            {getGreeting()}
          </p>
          <h1 className="text-[28px] font-black tracking-tight leading-none">
            {displayName.split(" ")[0]}
            <span className="text-white/20">.</span>
          </h1>
          <p className="text-[13px] text-white/35 mt-1.5">Your EGATS dashboard</p>
        </div>
        <VerificationBadge tier={tier} size="lg" showLabel />
      </div>

      {/* ── Onboarding ── */}
      {profileCompleteness < 60 && (
        <GettingStartedCard
          role={dancer?.role || "creative"}
          profile={{
            display_name: dancer?.display_name,
            bio: dancer?.bio,
            verification_tier: tier,
          }}
          hasCamps={(campRegCount ?? 0) > 0}
          hasApplications={(totalApplicationsCount ?? 0) > 0}
          hasClips={(clipsCount ?? 0) > 0}
        />
      )}

      {/* ── Verification upgrade ── */}
      {nextTier && (
        <div
          className="rounded-2xl p-5 flex items-center justify-between gap-4"
          style={
            nextTier === "2"
              ? {
                  background:
                    "linear-gradient(135deg, rgba(255,214,10,0.10) 0%, rgba(255,159,10,0.06) 100%)",
                  border: "1px solid rgba(255,214,10,0.2)",
                }
              : {
                  background:
                    "linear-gradient(135deg, rgba(10,132,255,0.10) 0%, rgba(94,92,230,0.06) 100%)",
                  border: "1px solid rgba(94,92,230,0.2)",
                }
          }
        >
          <div className="flex items-center gap-4 min-w-0">
            <div
              className="shrink-0 w-10 h-10 rounded-xl flex items-center justify-center text-lg"
              style={
                nextTier === "2"
                  ? { background: "rgba(255,214,10,0.15)" }
                  : { background: "rgba(94,92,230,0.15)" }
              }
            >
              {nextTier === "2" ? "🏆" : "✅"}
            </div>
            <div className="min-w-0">
              <div className="font-bold text-[14px] tracking-tight">
                Unlock Tier {nextTier} Verification
              </div>
              <div className="text-[12px] text-white/45 mt-0.5 leading-snug">
                {nextTier === "1"
                  ? "Attend an EGATS camp to earn your Verified Human badge."
                  : "Get evaluated by a vetted professional to earn EGATS Verified Talent."}
              </div>
            </div>
          </div>
          <Link
            href="/dashboard/camps"
            className={`shrink-0 flex items-center gap-1.5 font-semibold px-4 py-2 rounded-full text-[13px] transition-all whitespace-nowrap ${
              nextTier === "2"
                ? "bg-amber-400 text-black hover:bg-amber-300"
                : "bg-indigo-600 text-white hover:bg-indigo-500"
            }`}
          >
            View Camps <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      )}

      {/* ── Stats ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          icon={Briefcase}
          label="Active Applications"
          value={activeApplicationsCount ?? 0}
          color="violet"
          href="/dashboard/jobs"
        />
        <StatCard
          icon={BookOpen}
          label="Upcoming Bookings"
          value={upcomingBookingsCount ?? 0}
          color="green"
          href="/dashboard/bookings"
        />
        <StatCard
          icon={Award}
          label="Completed Bookings"
          value={completedBookingsCount ?? 0}
          color="amber"
          href="/dashboard/bookings"
        />
        <StatCard
          icon={TrendingUp}
          label="Avg Rating"
          value={avgRating}
          color="blue"
        />
      </div>

      {/* ── Camps + Applications ── */}
      <div className="grid md:grid-cols-2 gap-6">
        {/* Upcoming Camps */}
        <div>
          <SectionHeader title="Upcoming Camps" href="/dashboard/camps" />
          {upcomingCamps?.length ? (
            <div className="space-y-2">
              {upcomingCamps.map((camp) => (
                <Link
                  key={camp.id}
                  href={`/dashboard/camps/${camp.id}`}
                  className="flex items-center justify-between px-5 py-4 rounded-xl transition-all hover:translate-y-[-1px]"
                  style={{
                    background: "#1C1C1E",
                    border: "1px solid rgba(84,84,88,0.45)",
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLElement).style.borderColor = "rgba(191,90,242,0.3)";
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLElement).style.borderColor = "rgba(84,84,88,0.45)";
                  }}
                >
                  <div>
                    <div className="font-semibold text-[14px]">{camp.name}</div>
                    <div className="text-[11px] text-white/40 mt-1">
                      {camp.city}
                      {camp.state ? `, ${camp.state}` : ""} ·{" "}
                      {formatDate(camp.start_date)}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-[11px] text-white/35 tabular-nums">
                      {camp.current_registered}/{camp.max_capacity}
                    </div>
                    <div
                      className={`text-[10px] font-bold mt-1 uppercase tracking-wider ${
                        camp.is_sold_out ? "text-red-400" : "text-green-400"
                      }`}
                    >
                      {camp.is_sold_out ? "Sold Out" : "Open"}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <EmptyState
              icon={Calendar}
              message="No upcoming camps yet."
              cta="Browse camps"
              href="/dashboard/camps"
            />
          )}
        </div>

        {/* Recent Applications */}
        <div>
          <SectionHeader title="Recent Applications" href="/dashboard/jobs" linkLabel="Browse jobs" />
          {recentApplications?.length ? (
            <div className="space-y-2">
              {recentApplications.map((app) => {
                const statusConfig: Record<string, { bg: string; text: string; label: string }> = {
                  booked:              { bg: "rgba(48,209,88,0.15)",    text: "#4CD964", label: "Booked" },
                  shortlisted:         { bg: "rgba(191,90,242,0.15)",   text: "#D097F5", label: "Shortlisted" },
                  audition_requested:  { bg: "rgba(10,132,255,0.15)",   text: "#5AC8FA", label: "Audition" },
                  rejected:            { bg: "rgba(255,69,58,0.15)",    text: "#FF6961", label: "Rejected" },
                  pending:             { bg: "rgba(120,120,128,0.18)",  text: "rgba(235,235,245,0.45)", label: "Pending" },
                };
                const sc = statusConfig[app.status] || statusConfig.pending;
                return (
                  <div
                    key={app.id}
                    className="flex items-center justify-between px-5 py-4 rounded-xl"
                    style={{
                      background: "#1C1C1E",
                      border: "1px solid rgba(84,84,88,0.35)",
                    }}
                  >
                    <div className="min-w-0">
                      <div className="font-semibold text-[14px] truncate">
                        {(app.job as { title: string })?.title}
                      </div>
                      <div className="text-[11px] text-white/40 mt-0.5">
                        {(app.job as { role_type: string })?.role_type}
                      </div>
                    </div>
                    <span
                      className="shrink-0 text-[11px] font-bold px-2.5 py-1 rounded-full ml-3"
                      style={{ background: sc.bg, color: sc.text }}
                    >
                      {sc.label}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <EmptyState
              icon={Briefcase}
              message="No applications yet."
              cta="Browse open roles"
              href="/dashboard/jobs"
            />
          )}
        </div>
      </div>

      {/* ── Recent Activity ── */}
      <div>
        <SectionHeader title="Recent Activity" />
        {recentNotifications?.length ? (
          <div className="space-y-2">
            {recentNotifications.map(
              (n: { id: string; title: string; body: string; created_at: string; type?: string }) => (
                <div
                  key={n.id}
                  className="flex items-start gap-3 px-4 py-3.5 rounded-xl"
                  style={{
                    background: "rgba(28,28,30,0.6)",
                    border: "1px solid rgba(84,84,88,0.25)",
                  }}
                >
                  <ActivityIcon type={n.type} />
                  <div className="flex-1 min-w-0 pt-0.5">
                    <div className="text-[13px] font-semibold leading-tight truncate">{n.title}</div>
                    <div className="text-[11px] text-white/35 mt-0.5 line-clamp-1">{n.body}</div>
                  </div>
                  <div className="shrink-0 text-[10px] text-white/20 mt-0.5 whitespace-nowrap">
                    <Clock className="w-2.5 h-2.5 inline mr-1 opacity-60" />
                    {timeAgo(n.created_at)}
                  </div>
                </div>
              )
            )}
          </div>
        ) : (
          <EmptyState icon={Bell} message="No recent activity." />
        )}
      </div>

      {/* ── Featured Jobs ── */}
      {featuredJobs?.length ? (
        <div>
          <SectionHeader title="Open Roles" href="/dashboard/jobs" />
          <div className="grid md:grid-cols-2 gap-4">
            {featuredJobs.map((job) => (
              <JobCard key={job.id} job={job as unknown as Job} />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ─── Recruiter Dashboard ──────────────────────────────────────────────────────

async function RecruiterDashboard({
  userId,
  displayName,
}: {
  userId: string;
  displayName: string;
}) {
  const supabase = await createClient();

  const { data: recruiter } = await supabase
    .from("recruiter_profiles")
    .select("*")
    .eq("user_id", userId)
    .single();

  const recruiterId = recruiter?.id;
  const today = new Date().toISOString().split("T")[0];
  void today;

  const [
    { data: activeJobs },
    { data: shortlists },
    { count: totalApplicationsCount },
    { count: pendingApplicationsCount },
    { count: completedBookingsCount },
    { data: recentNotifications },
    { count: shortlistCount },
  ] = await Promise.all([
    recruiterId
      ? supabase
          .from("jobs")
          .select("*")
          .eq("status", "open")
          .eq("recruiter_id", recruiterId)
          .order("created_at", { ascending: false })
          .limit(5)
      : Promise.resolve({ data: [], count: null, error: null }),
    recruiterId
      ? supabase
          .from("shortlists")
          .select("*")
          .eq("recruiter_id", recruiterId)
          .order("updated_at", { ascending: false })
          .limit(4)
      : Promise.resolve({ data: [], count: null, error: null }),
    recruiterId
      ? supabase
          .from("applications")
          .select("*, job:jobs!inner(recruiter_id)", { count: "exact", head: true })
          .eq("job.recruiter_id", recruiterId)
      : Promise.resolve({ data: null, count: 0, error: null }),
    recruiterId
      ? supabase
          .from("applications")
          .select("*, job:jobs!inner(recruiter_id)", { count: "exact", head: true })
          .eq("job.recruiter_id", recruiterId)
          .eq("status", "pending")
      : Promise.resolve({ data: null, count: 0, error: null }),
    recruiterId
      ? supabase
          .from("bookings")
          .select("*", { count: "exact", head: true })
          .eq("recruiter_id", recruiterId)
          .eq("status", "completed")
      : Promise.resolve({ data: null, count: 0, error: null }),
    supabase
      .from("notifications")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(5),
    recruiterId
      ? supabase
          .from("shortlists")
          .select("*", { count: "exact", head: true })
          .eq("recruiter_id", recruiterId)
      : Promise.resolve({ data: null, count: 0, error: null }),
  ]);

  void completedBookingsCount;

  const recruiterFieldsFilled = [recruiter?.display_name, recruiter?.company_name, recruiter?.bio].filter(
    Boolean
  ).length;
  const recruiterCompleteness = Math.round((recruiterFieldsFilled / 3) * 100);

  return (
    <div className="space-y-8">
      {/* ── Welcome ── */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[12px] text-white/30 font-medium uppercase tracking-widest mb-1">
            {getGreeting()}
          </p>
          <h1 className="text-[28px] font-black tracking-tight leading-none">
            {displayName.split(" ")[0]}
            <span className="text-white/20">.</span>
          </h1>
          <p className="text-[13px] text-white/35 mt-1.5">
            Recruiter Dashboard
            {recruiter?.company_name && (
              <span className="text-white/20"> · {recruiter.company_name}</span>
            )}
          </p>
        </div>
        <Link
          href="/dashboard/jobs/new"
          className="flex items-center gap-2 bg-violet-600 hover:bg-violet-500 text-white font-semibold px-5 py-2.5 rounded-full text-[13px] transition-all shrink-0"
        >
          <Plus className="w-4 h-4" />
          Post a Role
        </Link>
      </div>

      {/* ── Onboarding ── */}
      {recruiterCompleteness < 60 && (
        <GettingStartedCard
          role="recruiter"
          profile={{ display_name: recruiter?.display_name }}
          hasJobs={(activeJobs?.length ?? 0) > 0}
        />
      )}

      {/* ── Stats ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          icon={Briefcase}
          label="Active Jobs"
          value={activeJobs?.length ?? 0}
          color="violet"
          href="/dashboard/jobs"
        />
        <StatCard
          icon={Users}
          label="Total Applications"
          value={totalApplicationsCount ?? 0}
          color="blue"
        />
        <StatCard
          icon={Clock}
          label="Pending Reviews"
          value={pendingApplicationsCount ?? 0}
          color="amber"
        />
        <StatCard
          icon={Bookmark}
          label="Shortlists"
          value={shortlistCount ?? 0}
          color="green"
          href="/dashboard/shortlists"
        />
      </div>

      {/* ── Jobs + Shortlists ── */}
      <div className="grid md:grid-cols-2 gap-6">
        {/* Active Jobs */}
        <div>
          <SectionHeader title="Active Jobs" href="/dashboard/jobs" />
          {activeJobs?.length ? (
            <div className="space-y-2">
              {activeJobs.map((job) => (
                <Link
                  key={job.id}
                  href={`/dashboard/jobs/${job.id}`}
                  className="flex items-center justify-between px-5 py-4 rounded-xl transition-all"
                  style={{
                    background: "#1C1C1E",
                    border: "1px solid rgba(84,84,88,0.45)",
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLElement).style.borderColor = "rgba(191,90,242,0.3)";
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLElement).style.borderColor = "rgba(84,84,88,0.45)";
                  }}
                >
                  <div className="min-w-0">
                    <div className="font-semibold text-[14px] truncate">{job.title}</div>
                    <div className="text-[11px] text-white/40 mt-0.5">
                      {job.total_applications} applicant
                      {job.total_applications !== 1 ? "s" : ""}
                    </div>
                  </div>
                  <span
                    className="shrink-0 text-[10px] font-bold px-2.5 py-1 rounded-full uppercase tracking-wide ml-3"
                    style={{
                      background: "rgba(48,209,88,0.14)",
                      color: "#4CD964",
                    }}
                  >
                    Open
                  </span>
                </Link>
              ))}
            </div>
          ) : (
            <EmptyState
              icon={Briefcase}
              message="No active job posts."
              cta="Post your first role"
              href="/dashboard/jobs/new"
            />
          )}
        </div>

        {/* Shortlists */}
        <div>
          <SectionHeader title="Shortlists" href="/dashboard/shortlists" />
          {shortlists?.length ? (
            <div className="space-y-2">
              {shortlists.map((sl) => (
                <Link
                  key={sl.id}
                  href={`/dashboard/shortlists/${sl.id}`}
                  className="flex items-center justify-between px-5 py-4 rounded-xl transition-all"
                  style={{
                    background: "#1C1C1E",
                    border: "1px solid rgba(84,84,88,0.45)",
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLElement).style.borderColor = "rgba(191,90,242,0.3)";
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLElement).style.borderColor = "rgba(84,84,88,0.45)";
                  }}
                >
                  <div className="min-w-0">
                    <div className="font-semibold text-[14px] truncate">{sl.name}</div>
                    <div className="text-[11px] text-white/40 mt-0.5">
                      {sl.dancer_ids.length} creative
                      {sl.dancer_ids.length !== 1 ? "s" : ""}
                    </div>
                  </div>
                  <Bookmark className="shrink-0 w-4 h-4 text-white/15 ml-3" />
                </Link>
              ))}
            </div>
          ) : (
            <EmptyState
              icon={Bookmark}
              message="No shortlists yet."
              cta="Browse creatives"
              href="/dashboard/dancers"
            />
          )}
        </div>
      </div>

      {/* ── Recent Activity ── */}
      <div>
        <SectionHeader title="Recent Activity" />
        {recentNotifications?.length ? (
          <div className="space-y-2">
            {recentNotifications.map(
              (n: { id: string; title: string; body: string; created_at: string; type?: string }) => (
                <div
                  key={n.id}
                  className="flex items-start gap-3 px-4 py-3.5 rounded-xl"
                  style={{
                    background: "rgba(28,28,30,0.6)",
                    border: "1px solid rgba(84,84,88,0.25)",
                  }}
                >
                  <ActivityIcon type={n.type} />
                  <div className="flex-1 min-w-0 pt-0.5">
                    <div className="text-[13px] font-semibold leading-tight truncate">{n.title}</div>
                    <div className="text-[11px] text-white/35 mt-0.5 line-clamp-1">{n.body}</div>
                  </div>
                  <div className="shrink-0 text-[10px] text-white/20 mt-0.5 whitespace-nowrap">
                    <Clock className="w-2.5 h-2.5 inline mr-1 opacity-60" />
                    {timeAgo(n.created_at)}
                  </div>
                </div>
              )
            )}
          </div>
        ) : (
          <EmptyState icon={Bell} message="No recent activity." />
        )}
      </div>
    </div>
  );
}
