"use client";

import { use, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  ListFilter,
  Map,
  Phone,
  Sparkles,
  Target,
  Users,
} from "lucide-react";
import { apiClient } from "@/lib/api-client";
import { Skeleton } from "@/components/ui/skeleton";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import {
  formatCurrency,
  formatNumber,
  milestoneLabel,
  TIER_COLORS,
} from "@/lib/utils";
import type { ThesisDetailResponse } from "@/types/sourcing";

const KANBAN_COLUMNS = [
  "not_yet_approached",
  "researching",
  "actively_approaching",
  "initial_contact_made",
  "discovery_call_scheduled",
  "mutual_interest",
];

const TIER_COPY: Record<number, { title: string; sub: string }> = {
  1: {
    title: "Tier 1",
    sub: "Highest fit. Push to the dialer first.",
  },
  2: {
    title: "Tier 2",
    sub: "Adjacent fit. Second-pass outreach.",
  },
  3: {
    title: "Tier 3",
    sub: "Long-tail. Nurture cadence.",
  },
};

export default function ThesisPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [tierFilter, setTierFilter] = useState<number | null>(null);
  const [coverageFilter, setCoverageFilter] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["thesis", id],
    queryFn: () => apiClient.getThesis(id),
  });
  const users = useQuery({
    queryKey: ["users"],
    queryFn: apiClient.listUsers,
  });

  const filtered = useMemo(() => {
    if (!data) return null;
    return {
      ...data,
      companies: data.companies.filter((c) => {
        if (tierFilter !== null && c.thesis_company.tier !== tierFilter)
          return false;
        if (
          coverageFilter !== null &&
          c.thesis_company.coverage_user_id !== coverageFilter
        )
          return false;
        return true;
      }),
    };
  }, [data, tierFilter, coverageFilter]);

  const summary = useMemo(() => {
    if (!data) return null;
    const total = data.companies.length;
    const inMotion = data.companies.filter(
      (c) => c.thesis_company.milestone !== "not_yet_approached",
    ).length;
    return {
      total,
      inMotion,
      pct: total > 0 ? Math.round((inMotion / total) * 100) : 0,
    };
  }, [data]);

  return (
    <div className="relative">
      <div className="absolute inset-0 -z-10 bg-mesh" />
      <div className="absolute inset-x-0 top-0 -z-10 h-[420px] bg-grid opacity-25 [mask-image:linear-gradient(to_bottom,black,transparent)]" />

      <div className="max-w-[1500px] mx-auto px-4 sm:px-6 lg:px-8 pt-12 md:pt-16 fade-in-up">
        <Link
          href={data ? `/engagements/${data.engagement_id}` : "/engagements"}
          className="inline-flex items-center gap-1.5 text-sm text-zinc-400 hover:text-zinc-100 transition-all duration-200 cursor-pointer"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Back to engagement
        </Link>

        <header className="mt-6 flex flex-col lg:flex-row lg:items-end lg:justify-between gap-6">
          <div className="max-w-3xl min-w-0">
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-violet-500/10 text-violet-300 border border-violet-500/30">
              <Target className="w-3 h-3" />
              Investment thesis
            </div>
            <h1 className="mt-3 text-4xl md:text-5xl font-bold tracking-tight bg-gradient-to-r from-white via-white to-zinc-400 bg-clip-text text-transparent">
              {isLoading ? (
                <Skeleton className="h-12 w-96" />
              ) : (
                data?.thesis_name
              )}
            </h1>
            <p className="mt-3 text-zinc-400 leading-relaxed">
              {data?.description}
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              {data?.geo_constraints?.map((g) => (
                <Badge key={g} variant="violet">
                  <Map className="w-3 h-3" />
                  {g}
                </Badge>
              ))}
              {data?.revenue_range && (
                <Badge variant="indigo">
                  {formatCurrency(data.revenue_range.min, { compact: true })} –{" "}
                  {formatCurrency(data.revenue_range.max, { compact: true })}
                </Badge>
              )}
              {data?.headcount_range && (
                <Badge variant="indigo">
                  <Users className="w-3 h-3" />
                  {formatNumber(data.headcount_range.min)}–
                  {formatNumber(data.headcount_range.max)} HC
                </Badge>
              )}
              {data?.search_criteria?.keywords?.slice(0, 4).map((kw) => (
                <Badge key={kw} variant="zinc">
                  {kw}
                </Badge>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <Button
              variant="secondary"
              size="lg"
              leftIcon={<Sparkles className="w-4 h-4" />}
            >
              Re-enrich
            </Button>
            <Link href="/dialer">
              <Button size="lg" leftIcon={<Phone className="w-4 h-4" />}>
                Start calling Tier 1
              </Button>
            </Link>
          </div>
        </header>

        <section className="mt-10 grid grid-cols-1 lg:grid-cols-4 gap-3">
          <Card className="p-5 lg:col-span-1">
            <div className="flex items-center justify-between">
              <span className="text-[11px] uppercase tracking-wider text-zinc-500">
                In motion
              </span>
              <span className="text-xs text-zinc-500 tabular-nums">
                {summary ? `${summary.inMotion} / ${summary.total}` : "—"}
              </span>
            </div>
            <div className="mt-3 text-4xl font-bold tracking-tight tabular-nums bg-gradient-to-r from-white to-zinc-400 bg-clip-text text-transparent">
              {summary ? `${summary.pct}%` : "—"}
            </div>
            <div className="mt-4 h-1.5 rounded-full bg-zinc-800 overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-indigo-500 to-violet-500 transition-all duration-500"
                style={{ width: `${summary?.pct ?? 0}%` }}
              />
            </div>
          </Card>

          {[1, 2, 3].map((tier) => {
            const count =
              data?.companies.filter((c) => c.thesis_company.tier === tier)
                .length ?? 0;
            const tc = TIER_COLORS[tier];
            const copy = TIER_COPY[tier];
            const active = tierFilter === tier;
            return (
              <button
                key={tier}
                onClick={() => setTierFilter(active ? null : tier)}
                className={`text-left transition-all duration-200 cursor-pointer rounded-2xl ${
                  active ? "ring-2 ring-indigo-500/40" : ""
                }`}
              >
                <Card
                  className={`p-5 hover:border-zinc-700 transition-all duration-200 ${
                    active ? "border-indigo-500/40" : ""
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full ${tc.dot}`} />
                      <span className="text-[11px] uppercase tracking-wider text-zinc-400">
                        {copy.title}
                      </span>
                    </div>
                    <Badge
                      variant={
                        tier === 1 ? "emerald" : tier === 2 ? "amber" : "zinc"
                      }
                    >
                      {count}
                    </Badge>
                  </div>
                  <div className="mt-3 text-3xl font-bold tracking-tight tabular-nums text-zinc-100">
                    {formatNumber(count)}
                  </div>
                  <p className="mt-1 text-xs text-zinc-500">{copy.sub}</p>
                </Card>
              </button>
            );
          })}
        </section>

        <Card className="mt-6 p-3 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-zinc-500">
            <ListFilter className="w-3.5 h-3.5" /> Filters
          </div>
          <div className="flex items-center gap-1">
            {[null, 1, 2, 3].map((t) => (
              <button
                key={String(t)}
                onClick={() => setTierFilter(t)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200 cursor-pointer border ${
                  tierFilter === t
                    ? "bg-indigo-500/15 text-indigo-300 border-indigo-500/40"
                    : "bg-zinc-900 text-zinc-400 border-zinc-800 hover:border-zinc-700 hover:text-zinc-200"
                }`}
              >
                {t === null ? "All tiers" : `Tier ${t}`}
              </button>
            ))}
          </div>
          <div className="h-4 w-px bg-zinc-800" />
          <div className="flex items-center gap-1 flex-wrap">
            <button
              onClick={() => setCoverageFilter(null)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200 cursor-pointer border ${
                coverageFilter === null
                  ? "bg-indigo-500/15 text-indigo-300 border-indigo-500/40"
                  : "bg-zinc-900 text-zinc-400 border-zinc-800 hover:border-zinc-700 hover:text-zinc-200"
              }`}
            >
              All coverage
            </button>
            {users.data?.map((u) => (
              <button
                key={u.user_id}
                onClick={() => setCoverageFilter(u.user_id)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200 cursor-pointer border ${
                  coverageFilter === u.user_id
                    ? "bg-indigo-500/15 text-indigo-300 border-indigo-500/40"
                    : "bg-zinc-900 text-zinc-400 border-zinc-800 hover:border-zinc-700 hover:text-zinc-200"
                }`}
              >
                <span className="grid place-items-center w-4 h-4 rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 text-[9px] text-white font-bold">
                  {u.avatar_initial}
                </span>
                {u.full_name}
              </button>
            ))}
          </div>
        </Card>

        <section className="mt-8 mb-20">
          <div className="flex items-end justify-between mb-4">
            <div>
              <h2 className="text-xl font-semibold tracking-tight">
                Pipeline by milestone
              </h2>
              <p className="text-xs text-zinc-500 mt-1">
                Drag-and-drop coming next sprint. Click a card for the full
                company view.
              </p>
            </div>
            <span className="text-xs text-zinc-500 tabular-nums">
              {filtered?.companies.length ?? 0} of {data?.companies.length ?? 0}{" "}
              shown
            </span>
          </div>

          {isLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-72 rounded-2xl" />
              ))}
            </div>
          ) : data && filtered ? (
            filtered.companies.length === 0 ? (
              <EmptyState
                icon={Target}
                title="No companies match these filters"
                description="Loosen the tier or coverage filter, or re-enrich the thesis to surface fresh prospects."
                action={
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setTierFilter(null);
                      setCoverageFilter(null);
                    }}
                  >
                    Clear filters
                  </Button>
                }
              />
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4">
                {KANBAN_COLUMNS.map((col) => (
                  <KanbanColumn key={col} milestone={col} thesis={filtered} />
                ))}
              </div>
            )
          ) : null}
        </section>
      </div>
    </div>
  );
}

function KanbanColumn({
  milestone,
  thesis,
}: {
  milestone: string;
  thesis: ThesisDetailResponse;
}) {
  const items = thesis.companies.filter(
    (c) => c.thesis_company.milestone === milestone,
  );

  return (
    <div className="bg-zinc-900/50 border border-zinc-800 rounded-2xl p-3 min-h-[360px]">
      <div className="flex items-center justify-between px-1 py-2">
        <div className="text-[11px] font-semibold text-zinc-300 uppercase tracking-wider">
          {milestoneLabel(milestone)}
        </div>
        <span className="text-xs text-zinc-500 font-medium tabular-nums">
          {items.length}
        </span>
      </div>
      <div className="space-y-2">
        {items.length === 0 && (
          <div className="text-[11px] text-zinc-600 px-2 py-6 text-center border border-dashed border-zinc-800/80 rounded-xl">
            No companies here
          </div>
        )}
        {items.map((c) => {
          const tier = c.thesis_company.tier;
          const tc =
            tier && TIER_COLORS[tier] ? TIER_COLORS[tier] : TIER_COLORS[3];
          return (
            <Link
              key={c.thesis_company.thesis_company_id}
              href={`/theses/${thesis.thesis_id}/companies/${c.company.company_id}`}
              className="block bg-zinc-900 border border-zinc-800 rounded-xl p-3 hover:border-zinc-600 transition-all duration-200 cursor-pointer group"
            >
              <div className="flex items-center justify-between gap-2">
                <span
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider ${tc.bg} ${tc.text}`}
                >
                  T{tier ?? "?"}
                </span>
                {c.company.fit_score !== null &&
                  c.company.fit_score !== undefined && (
                    <span className="text-[10px] text-zinc-500 tabular-nums">
                      fit {c.company.fit_score}
                    </span>
                  )}
              </div>
              <div className="mt-2 text-sm font-medium text-zinc-100 line-clamp-1 group-hover:text-white">
                {c.company.company_name}
              </div>
              <div className="mt-0.5 text-xs text-zinc-500 truncate">
                {c.company.city
                  ? `${c.company.city}${
                      c.company.state ? `, ${c.company.state}` : ""
                    }`
                  : c.company.domain || "—"}
              </div>
              {c.primary_contact && (
                <div className="mt-2 pt-2 border-t border-zinc-800/80 flex items-center justify-between">
                  <span className="text-[11px] text-zinc-400 truncate">
                    {c.primary_contact.full_name}
                  </span>
                  <ArrowRight className="w-3 h-3 text-zinc-600 group-hover:text-indigo-400 transition-colors shrink-0" />
                </div>
              )}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
