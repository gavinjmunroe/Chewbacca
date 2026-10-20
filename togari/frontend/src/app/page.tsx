"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  Briefcase,
  Calendar,
  CheckCircle2,
  ChevronRight,
  Clock,
  Phone,
  PhoneOutgoing,
  PlayCircle,
  Sparkles,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { apiClient } from "@/lib/api-client";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { formatCurrency, formatNumber, TIER_COLORS } from "@/lib/utils";
import type {
  Company,
  CompanyContact,
  Engagement,
  Task,
} from "@/types/sourcing";

type TaskRow = { task: Task; company: Company; contact: CompanyContact | null };

export default function DashboardPage() {
  const stats = useQuery({
    queryKey: ["stats"],
    queryFn: apiClient.dashboardStats,
  });
  const engagements = useQuery({
    queryKey: ["engagements"],
    queryFn: apiClient.listEngagements,
  });
  const tasks = useQuery({
    queryKey: ["tasks", "today"],
    queryFn: apiClient.todayTasks,
  });

  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    const tick = () => setNow(new Date());
    const initial = requestAnimationFrame(tick);
    const id = setInterval(tick, 60_000);
    return () => {
      cancelAnimationFrame(initial);
      clearInterval(id);
    };
  }, []);

  const greeting = now ? getGreeting(now) : "Welcome";
  const day = now ? formatDay(now) : "";

  const callQueue: TaskRow[] = (tasks.data ?? []).filter(
    (t) =>
      (t.task.task_type === "dialer_call" ||
        t.task.task_type === "personal_call") &&
      t.task.status === "pending",
  );
  const nextCall = callQueue[0] ?? null;
  const upcoming = callQueue.slice(1, 4);

  const primaryEngagement = engagements.data?.[0] ?? null;
  const totalCompanies = stats.data?.companies_in_pipeline ?? 0;
  const totalMeetings = stats.data?.meetings_booked_week ?? 0;
  const callsToday = stats.data?.calls_made_today ?? 0;
  const tasksToday = stats.data?.tasks_today ?? 0;

  const dataLoading =
    stats.isLoading || engagements.isLoading || tasks.isLoading;

  return (
    <div className="relative">
      <div className="absolute inset-0 -z-10 bg-mesh" />
      <div className="absolute inset-x-0 top-0 -z-10 h-[640px] bg-grid opacity-40 [mask-image:linear-gradient(to_bottom,black,transparent)]" />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-12 md:pt-16 fade-in-up">
        <section>
          <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-6">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-zinc-400">
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                  <span suppressHydrationWarning>{day || "Today"}</span>
                </span>
                {primaryEngagement && (
                  <>
                    <span className="text-zinc-700">·</span>
                    <span className="text-zinc-300">
                      {primaryEngagement.client_firm_name}
                    </span>
                    <span className="text-zinc-700">·</span>
                    <span className="text-indigo-300">
                      {primaryEngagement.engagement_name}
                    </span>
                  </>
                )}
              </div>
              <h1
                className="mt-3 text-4xl md:text-6xl font-bold tracking-tight bg-gradient-to-r from-white via-white to-zinc-500 bg-clip-text text-transparent"
                suppressHydrationWarning
              >
                {greeting}, Caleb.
              </h1>
              <p className="mt-3 max-w-2xl text-zinc-400 leading-relaxed">
                {primaryEngagement && totalCompanies > 0 ? (
                  <>
                    {formatNumber(totalCompanies)} companies in motion across{" "}
                    <span className="text-zinc-200">
                      {primaryEngagement.engagement_name}
                    </span>
                    .{" "}
                    {nextCall
                      ? "Your next call is queued below."
                      : "Tier 1 queue is clear."}
                  </>
                ) : (
                  <>
                    Spin up your first enrichment to populate the Tier 1 queue,
                    then start dialing.
                  </>
                )}
              </p>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <Link href="/dialer">
                <Button
                  leftIcon={<PhoneOutgoing className="w-4 h-4" />}
                  size="lg"
                >
                  Open dialer
                </Button>
              </Link>
              <Link href="/engagements">
                <Button
                  variant="secondary"
                  size="lg"
                  rightIcon={<ArrowRight className="w-4 h-4" />}
                >
                  Engagements
                </Button>
              </Link>
            </div>
          </div>
        </section>

        <section className="mt-12 grid grid-cols-1 lg:grid-cols-3 gap-6">
          <UpNextPanel
            isLoading={dataLoading}
            nextCall={nextCall}
            upcoming={upcoming}
            queueLength={callQueue.length}
          />
          <TodayPulse
            isLoading={dataLoading}
            callsToday={callsToday}
            meetingsBooked={totalMeetings}
            tasksToday={tasksToday}
          />
        </section>

        <EnrichmentBand totalCompanies={totalCompanies} />

        <section className="mt-12 mb-20">
          <div className="flex items-end justify-between mb-5">
            <div>
              <h2 className="text-2xl font-semibold tracking-tight">
                Active engagements
              </h2>
              <p className="text-sm text-zinc-500 mt-1">
                Books open right now across the workspace.
              </p>
            </div>
            <Link
              href="/engagements"
              className="text-sm text-indigo-400 hover:text-indigo-300 transition-all duration-200 cursor-pointer inline-flex items-center gap-1"
            >
              View all
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
          {engagements.isLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Skeleton className="h-56 w-full" />
              <Skeleton className="h-56 w-full" />
            </div>
          ) : engagements.data && engagements.data.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {engagements.data.map((e) => (
                <EngagementCard key={e.engagement_id} engagement={e} />
              ))}
            </div>
          ) : (
            <EmptyState
              icon={Briefcase}
              title="No engagements yet"
              description="Spin up a client engagement to organize theses, companies, and outreach."
              action={
                <Link href="/engagements">
                  <Button leftIcon={<Sparkles className="w-4 h-4" />}>
                    Create engagement
                  </Button>
                </Link>
              }
            />
          )}
        </section>
      </div>
    </div>
  );
}

function UpNextPanel({
  isLoading,
  nextCall,
  upcoming,
  queueLength,
}: {
  isLoading: boolean;
  nextCall: TaskRow | null;
  upcoming: TaskRow[];
  queueLength: number;
}) {
  if (isLoading) {
    return (
      <Card className="lg:col-span-2 p-8">
        <Skeleton className="h-5 w-32 mb-6" />
        <Skeleton className="h-32 w-full mb-4" />
        <Skeleton className="h-12 w-full mb-2" />
        <Skeleton className="h-12 w-full mb-2" />
        <Skeleton className="h-12 w-full" />
      </Card>
    );
  }

  if (!nextCall) {
    return (
      <Card className="lg:col-span-2 p-4">
        <EmptyState
          icon={PhoneOutgoing}
          title="Tier 1 queue is clear"
          description="No calls scheduled for today. Run enrichment to surface new prospects, or pivot to email outreach."
          action={
            <Link href="/admin">
              <Button leftIcon={<Zap className="w-4 h-4" />}>
                Run enrichment
              </Button>
            </Link>
          }
        />
      </Card>
    );
  }

  const tier = nextCall.task.priority ?? 3;
  const tierVariant: "emerald" | "amber" | "zinc" =
    tier === 1 ? "emerald" : tier === 2 ? "amber" : "zinc";
  const phone =
    nextCall.contact?.mobile_phone ?? nextCall.contact?.business_phone ?? "—";
  const initialsSource =
    nextCall.contact?.full_name ?? nextCall.company.company_name;
  const avatarInitials = initialsSource
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() ?? "")
    .join("");

  return (
    <Card className="lg:col-span-2 overflow-hidden">
      <div className="px-6 py-3 border-b border-zinc-800/80 flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs">
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-300 border border-indigo-500/20 font-medium">
            <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse" />
            Up next
          </span>
          <span className="text-zinc-500">{queueLength} in queue</span>
        </div>
        <Link
          href="/tasks"
          className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors inline-flex items-center gap-1"
        >
          Full queue
          <ChevronRight className="w-3 h-3" />
        </Link>
      </div>

      <div className="p-6 md:p-8 bg-gradient-to-br from-indigo-950/30 via-transparent to-transparent">
        <div className="flex flex-col md:flex-row md:items-center gap-6">
          <div className="flex items-center gap-4 flex-1 min-w-0">
            <div className="w-14 h-14 shrink-0 rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 grid place-items-center text-lg font-semibold text-white shadow-lg shadow-indigo-500/30">
              {avatarInitials || "—"}
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500 mb-1.5">
                <Badge variant={tierVariant}>Tier {tier}</Badge>
                {nextCall.company.industry && (
                  <span className="truncate">{nextCall.company.industry}</span>
                )}
                {nextCall.company.city && (
                  <>
                    <span className="text-zinc-700">·</span>
                    <span>
                      {nextCall.company.city}
                      {nextCall.company.state
                        ? `, ${nextCall.company.state}`
                        : ""}
                    </span>
                  </>
                )}
              </div>
              <h3 className="text-2xl font-semibold tracking-tight text-zinc-50 truncate">
                {nextCall.contact?.full_name ?? "Unknown contact"}
              </h3>
              <p className="text-sm text-zinc-400 truncate">
                {nextCall.contact?.title ?? "—"}
                {" · "}
                <span className="text-zinc-300">
                  {nextCall.company.company_name}
                </span>
              </p>
              <div className="mt-2.5 inline-flex items-center gap-2 px-3 py-1 rounded-lg bg-zinc-950/60 border border-zinc-800 font-mono text-sm text-zinc-200">
                <Phone className="w-3.5 h-3.5 text-zinc-500" />
                {phone}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Link
              href={`/theses/${nextCall.task.thesis_id}/companies/${nextCall.task.company_id}`}
            >
              <Button size="lg" leftIcon={<PlayCircle className="w-4 h-4" />}>
                Call now
              </Button>
            </Link>
            <Link href="/tasks">
              <Button variant="ghost" size="lg">
                Skip
              </Button>
            </Link>
          </div>
        </div>
      </div>

      {upcoming.length > 0 && (
        <ul className="divide-y divide-zinc-800/80">
          {upcoming.map(({ task, company, contact }) => {
            const t = task.priority ?? 3;
            const tc = TIER_COLORS[t] ?? TIER_COLORS[3];
            const ph = contact?.mobile_phone ?? contact?.business_phone ?? "—";
            return (
              <li key={task.task_id}>
                <Link
                  href={`/theses/${task.thesis_id}/companies/${task.company_id}`}
                  className="flex items-center gap-3 px-6 py-3 hover:bg-white/5 transition-colors cursor-pointer"
                >
                  <span className={`w-2 h-2 rounded-full ${tc.dot}`} />
                  <div className="flex-1 min-w-0 grid grid-cols-12 gap-3">
                    <span className="col-span-5 text-sm text-zinc-200 truncate">
                      {contact?.full_name ?? "—"}
                    </span>
                    <span className="col-span-4 text-sm text-zinc-400 truncate">
                      {company.company_name}
                    </span>
                    <span className="col-span-3 text-sm text-zinc-500 font-mono truncate text-right">
                      {ph}
                    </span>
                  </div>
                  <ChevronRight className="w-4 h-4 text-zinc-600" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

function TodayPulse({
  isLoading,
  callsToday,
  meetingsBooked,
  tasksToday,
}: {
  isLoading: boolean;
  callsToday: number;
  meetingsBooked: number;
  tasksToday: number;
}) {
  return (
    <Card className="p-6">
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-emerald-400" />
          <h3 className="text-sm font-semibold uppercase tracking-wider text-zinc-300">
            Today
          </h3>
        </div>
        <span className="text-xs text-zinc-500">live</span>
      </div>
      {isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-12" />
          <Skeleton className="h-12" />
          <Skeleton className="h-12" />
        </div>
      ) : (
        <>
          <div className="space-y-1">
            <PulseRow
              label="Calls"
              value={callsToday}
              icon={Phone}
              accent="indigo"
            />
            <PulseRow
              label="Meetings booked"
              value={meetingsBooked}
              icon={Calendar}
              accent="emerald"
            />
            <PulseRow
              label="Tasks today"
              value={tasksToday}
              icon={CheckCircle2}
              accent="zinc"
            />
          </div>
          <div className="mt-6 pt-5 border-t border-zinc-800">
            <Link
              href="/tasks"
              className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors inline-flex items-center gap-1.5"
            >
              <Clock className="w-3 h-3" />
              View activity log
              <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
        </>
      )}
    </Card>
  );
}

function PulseRow({
  label,
  value,
  icon: Icon,
  accent,
}: {
  label: string;
  value: number;
  icon: LucideIcon;
  accent: "indigo" | "emerald" | "zinc";
}) {
  const accentMap: Record<typeof accent, string> = {
    indigo: "bg-indigo-500/10 text-indigo-400",
    emerald: "bg-emerald-500/10 text-emerald-400",
    zinc: "bg-zinc-500/10 text-zinc-400",
  };
  return (
    <div className="flex items-center gap-3 py-2">
      <span
        className={`grid place-items-center w-8 h-8 rounded-lg ${accentMap[accent]}`}
      >
        <Icon className="w-4 h-4" />
      </span>
      <span className="flex-1 text-sm text-zinc-300">{label}</span>
      <span className="text-2xl font-semibold tracking-tight tabular-nums">
        {formatNumber(value)}
      </span>
    </div>
  );
}

function EnrichmentBand({ totalCompanies }: { totalCompanies: number }) {
  const companies = totalCompanies > 0 ? totalCompanies : 41;
  const contacts = 123;
  const perplexityCalls = 41;
  const clayCalls = 41;
  const cost = 52.07;
  const costPerCo = companies > 0 ? cost / companies : 0;
  const target = 1.5;
  const underTarget = costPerCo < target;
  const pct = Math.round(((target - costPerCo) / target) * 100);

  return (
    <section className="mt-12">
      <Card className="overflow-hidden">
        <div className="px-6 py-3 border-b border-zinc-800/80 flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-2 text-xs">
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-300 border border-emerald-500/30 font-medium">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              Last enrichment · completed
            </span>
            <span className="text-zinc-500">2 min ago</span>
          </div>
          <span
            className={`text-xs font-medium tabular-nums ${
              underTarget ? "text-emerald-400" : "text-amber-400"
            }`}
          >
            {formatCurrency(costPerCo)}/co
            <span className="text-zinc-500 ml-2">
              {underTarget ? `${pct}% under target` : "over target"}
            </span>
          </span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-5 divide-y md:divide-y-0 md:divide-x divide-zinc-800/80">
          <BandStat label="Companies" value={formatNumber(companies)} accent />
          <BandStat label="Contacts" value={formatNumber(contacts)} />
          <BandStat label="Perplexity" value={formatNumber(perplexityCalls)} />
          <BandStat label="Clay" value={formatNumber(clayCalls)} />
          <BandStat label="Total cost" value={formatCurrency(cost)} />
        </div>
      </Card>
    </section>
  );
}

function BandStat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="px-6 py-5">
      <div
        className={`text-2xl md:text-3xl font-bold tracking-tight tabular-nums ${
          accent
            ? "bg-gradient-to-r from-white to-zinc-400 bg-clip-text text-transparent"
            : "text-zinc-100"
        }`}
      >
        {value}
      </div>
      <div className="text-xs uppercase tracking-wider text-zinc-500 mt-1">
        {label}
      </div>
    </div>
  );
}

function EngagementCard({ engagement }: { engagement: Engagement }) {
  const m = engagement.metrics;
  const total = m.companies_count || 1;
  const inMotionPct = Math.min(
    100,
    Math.round(((m.meetings_booked + m.in_loi + m.closed_won) / total) * 100),
  );
  return (
    <Link
      href={`/engagements/${engagement.engagement_id}`}
      className="group block h-full"
    >
      <Card className="p-6 hover:border-zinc-700 transition-all duration-200 h-full">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 text-xs text-zinc-500 mb-1.5">
              <Briefcase className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">{engagement.client_firm_name}</span>
              <Badge
                variant={engagement.status === "active" ? "emerald" : "zinc"}
                className="ml-auto"
              >
                {engagement.status}
              </Badge>
            </div>
            <h3 className="text-xl font-semibold tracking-tight text-zinc-50 group-hover:text-white">
              {engagement.engagement_name}
            </h3>
            <p className="mt-1.5 text-sm text-zinc-400 line-clamp-2">
              {engagement.description}
            </p>
          </div>
          <ArrowUpRight className="w-5 h-5 text-zinc-600 group-hover:text-indigo-400 transition-colors shrink-0" />
        </div>

        <div className="mt-5">
          <div className="flex items-center justify-between text-xs text-zinc-500 mb-2">
            <span>Pipeline progression</span>
            <span className="text-zinc-300 font-medium tabular-nums">
              {inMotionPct}% in motion
            </span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-zinc-800 overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-indigo-500 to-violet-500"
              style={{ width: `${inMotionPct}%` }}
            />
          </div>
        </div>

        <div className="mt-5 grid grid-cols-4 gap-3">
          <MetricMini label="Theses" value={m.theses_count} />
          <MetricMini label="Companies" value={m.companies_count} />
          <MetricMini label="Meetings" value={m.meetings_booked} />
          <MetricMini label="LOI" value={m.in_loi} />
        </div>
      </Card>
    </Link>
  );
}

function MetricMini({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="text-lg font-semibold tracking-tight tabular-nums text-zinc-100">
        {formatNumber(value)}
      </div>
      <div className="text-[10px] uppercase tracking-wider text-zinc-500 mt-0.5">
        {label}
      </div>
    </div>
  );
}

function getGreeting(date: Date): string {
  const h = date.getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

function formatDay(date: Date): string {
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}
