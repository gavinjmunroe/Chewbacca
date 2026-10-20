"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import {
  ArrowRight,
  ArrowUpRight,
  Briefcase,
  Calendar,
  Globe,
  Plus,
  TrendingUp,
} from "lucide-react";
import { apiClient } from "@/lib/api-client";
import { Skeleton } from "@/components/ui/skeleton";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { formatNumber, relativeTime } from "@/lib/utils";
import type { Engagement } from "@/types/sourcing";

export default function EngagementsListPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["engagements"],
    queryFn: apiClient.listEngagements,
  });

  const summary = useMemo(() => summarize(data ?? []), [data]);

  return (
    <div className="relative">
      <div className="absolute inset-0 -z-10 bg-mesh" />
      <div className="absolute inset-x-0 top-0 -z-10 h-[480px] bg-grid opacity-30 [mask-image:linear-gradient(to_bottom,black,transparent)]" />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-12 md:pt-16 fade-in-up">
        <section>
          <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-6">
            <div className="min-w-0">
              <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-indigo-500/10 text-indigo-300 border border-indigo-500/20">
                <Briefcase className="w-3 h-3" />
                Portfolio
              </div>
              <h1 className="mt-3 text-4xl md:text-6xl font-bold tracking-tight bg-gradient-to-r from-white via-white to-zinc-500 bg-clip-text text-transparent">
                Engagements
              </h1>
              <p className="mt-3 max-w-2xl text-zinc-400 leading-relaxed">
                Every engagement is one PE-client mandate. Theses, companies,
                and outreach roll up underneath. Open one to see its full
                pipeline.
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Button
                leftIcon={<Plus className="w-4 h-4" />}
                size="lg"
                className="cursor-pointer"
              >
                New engagement
              </Button>
            </div>
          </div>
        </section>

        <section className="mt-10 grid grid-cols-2 md:grid-cols-4 gap-3">
          <PulseStat
            label="Engagements"
            value={summary.totalCount}
            sub={`${summary.activeCount} active`}
            icon={Briefcase}
            accent="indigo"
            isLoading={isLoading}
          />
          <PulseStat
            label="Companies in motion"
            value={summary.inMotion}
            sub={`of ${formatNumber(summary.totalCompanies)} sourced`}
            icon={Globe}
            accent="violet"
            isLoading={isLoading}
          />
          <PulseStat
            label="Meetings booked"
            value={summary.totalMeetings}
            sub="this engagement window"
            icon={Calendar}
            accent="emerald"
            isLoading={isLoading}
          />
          <PulseStat
            label="In LOI"
            value={summary.totalLoi}
            sub="across the portfolio"
            icon={TrendingUp}
            accent="amber"
            isLoading={isLoading}
          />
        </section>

        <section className="mt-12 mb-20">
          <div className="flex items-end justify-between mb-5">
            <div>
              <h2 className="text-2xl font-semibold tracking-tight">
                Open books
              </h2>
              <p className="text-sm text-zinc-500 mt-1">
                Sorted by most recent activity. Click through to a thesis pipe.
              </p>
            </div>
          </div>

          {isLoading ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-64 rounded-2xl" />
              ))}
            </div>
          ) : data && data.length > 0 ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {data.map((e) => (
                <EngagementCard key={e.engagement_id} engagement={e} />
              ))}
            </div>
          ) : (
            <EmptyState
              icon={Briefcase}
              title="No engagements yet"
              description="Spin up a client mandate to start organizing theses, companies, and outreach."
              action={
                <Button leftIcon={<Plus className="w-4 h-4" />}>
                  Create the first engagement
                </Button>
              }
            />
          )}
        </section>
      </div>
    </div>
  );
}

function summarize(engagements: Engagement[]) {
  const totalCount = engagements.length;
  const activeCount = engagements.filter((e) => e.status === "active").length;
  let totalCompanies = 0;
  let inMotion = 0;
  let totalMeetings = 0;
  let totalLoi = 0;
  for (const e of engagements) {
    const m = e.metrics;
    totalCompanies += m.companies_count;
    inMotion += m.meetings_booked + m.in_loi + m.closed_won;
    totalMeetings += m.meetings_booked;
    totalLoi += m.in_loi;
  }
  return {
    totalCount,
    activeCount,
    totalCompanies,
    inMotion,
    totalMeetings,
    totalLoi,
  };
}

const accentMap: Record<
  "indigo" | "violet" | "emerald" | "amber",
  { bubble: string; text: string }
> = {
  indigo: {
    bubble: "bg-indigo-500/10 border-indigo-500/30",
    text: "text-indigo-300",
  },
  violet: {
    bubble: "bg-violet-500/10 border-violet-500/30",
    text: "text-violet-300",
  },
  emerald: {
    bubble: "bg-emerald-500/10 border-emerald-500/30",
    text: "text-emerald-300",
  },
  amber: {
    bubble: "bg-amber-500/10 border-amber-500/30",
    text: "text-amber-300",
  },
};

function PulseStat({
  label,
  value,
  sub,
  icon: Icon,
  accent,
  isLoading,
}: {
  label: string;
  value: number;
  sub: string;
  icon: typeof Briefcase;
  accent: "indigo" | "violet" | "emerald" | "amber";
  isLoading: boolean;
}) {
  const a = accentMap[accent];
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-wider text-zinc-500">
          {label}
        </span>
        <span
          className={`grid place-items-center w-7 h-7 rounded-lg border ${a.bubble} ${a.text}`}
        >
          <Icon className="w-3.5 h-3.5" />
        </span>
      </div>
      {isLoading ? (
        <Skeleton className="mt-3 h-8 w-16" />
      ) : (
        <div className="mt-3 text-3xl font-bold tracking-tight tabular-nums">
          {formatNumber(value)}
        </div>
      )}
      <div className="mt-1 text-xs text-zinc-500">{sub}</div>
    </Card>
  );
}

function EngagementCard({ engagement }: { engagement: Engagement }) {
  const m = engagement.metrics;
  const stages = [
    { label: "Sourced", value: m.companies_count, color: "bg-zinc-700" },
    {
      label: "Meetings",
      value: m.meetings_booked,
      color: "bg-indigo-500",
    },
    { label: "In LOI", value: m.in_loi, color: "bg-amber-500" },
    { label: "Closed", value: m.closed_won, color: "bg-emerald-500" },
  ];
  const peak = Math.max(...stages.map((s) => s.value), 1);
  const active = engagement.status === "active";

  return (
    <Link
      href={`/engagements/${engagement.engagement_id}`}
      className="group block h-full"
    >
      <Card className="p-6 hover:border-zinc-700 transition-all duration-200 h-full">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-xs text-zinc-500">
              <Briefcase className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">{engagement.client_firm_name}</span>
              <span className="text-zinc-700">·</span>
              <span className="text-zinc-400 tabular-nums">
                opened {relativeTime(engagement.started_at)}
              </span>
            </div>
            <h3 className="mt-1.5 text-xl font-semibold tracking-tight text-zinc-50 group-hover:text-white">
              {engagement.engagement_name}
            </h3>
            <p className="mt-1.5 text-sm text-zinc-400 line-clamp-2">
              {engagement.description}
            </p>
          </div>
          <div className="flex flex-col items-end gap-2 shrink-0">
            <Badge variant={active ? "emerald" : "zinc"}>
              {active && (
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              )}
              {engagement.status}
            </Badge>
            <ArrowUpRight className="w-5 h-5 text-zinc-600 group-hover:text-indigo-400 transition-colors" />
          </div>
        </div>

        <div className="mt-6">
          <div className="flex items-end gap-1.5 h-16">
            {stages.map((s) => (
              <div
                key={s.label}
                className="flex-1 flex flex-col justify-end items-stretch"
              >
                <div
                  className={`${s.color} rounded-md transition-all duration-300 group-hover:opacity-100 opacity-80`}
                  style={{
                    height: `${Math.max(8, (s.value / peak) * 100)}%`,
                  }}
                  aria-hidden
                />
              </div>
            ))}
          </div>
          <div className="mt-3 grid grid-cols-4 gap-1.5">
            {stages.map((s) => (
              <div key={s.label} className="text-center">
                <div className="text-lg font-semibold tracking-tight tabular-nums text-zinc-100">
                  {formatNumber(s.value)}
                </div>
                <div className="text-[10px] uppercase tracking-wider text-zinc-500 mt-0.5">
                  {s.label}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-5 pt-4 border-t border-zinc-800/80 flex items-center justify-between text-xs">
          <span className="text-zinc-500">
            {m.theses_count} {m.theses_count === 1 ? "thesis" : "theses"} live
          </span>
          <span className="inline-flex items-center gap-1 text-indigo-400 group-hover:text-indigo-300 transition-colors">
            Open pipeline
            <ArrowRight className="w-3 h-3" />
          </span>
        </div>
      </Card>
    </Link>
  );
}
