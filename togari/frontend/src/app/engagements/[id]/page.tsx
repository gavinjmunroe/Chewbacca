"use client";

import { use, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Briefcase,
  Calendar,
  Globe,
  Plus,
  Sparkles,
  Target,
  TrendingUp,
  Users,
} from "lucide-react";
import { apiClient } from "@/lib/api-client";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { formatCurrency, formatNumber, relativeTime } from "@/lib/utils";
import type { Engagement, Thesis } from "@/types/sourcing";

export default function EngagementDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const engagement = useQuery({
    queryKey: ["engagement", id],
    queryFn: () => apiClient.getEngagement(id),
  });
  const theses = useQuery({
    queryKey: ["engagement-theses", id],
    queryFn: () => apiClient.listTheses(id),
  });

  const e = engagement.data;
  const active = e?.status === "active";

  return (
    <div className="relative">
      <div className="absolute inset-0 -z-10 bg-mesh" />
      <div className="absolute inset-x-0 top-0 -z-10 h-[440px] bg-grid opacity-25 [mask-image:linear-gradient(to_bottom,black,transparent)]" />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-12 md:pt-16 fade-in-up">
        <Link
          href="/engagements"
          className="inline-flex items-center gap-1.5 text-sm text-zinc-400 hover:text-zinc-100 transition-all duration-200 cursor-pointer"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          All engagements
        </Link>

        <header className="mt-6 flex flex-col md:flex-row md:items-end md:justify-between gap-6">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-zinc-400">
              <span className="inline-flex items-center gap-1.5">
                <Briefcase className="w-3.5 h-3.5 text-zinc-500" />
                {engagement.isLoading ? (
                  <Skeleton className="h-4 w-32" />
                ) : (
                  (e?.client_firm_name ?? "—")
                )}
              </span>
              {e && (
                <>
                  <span className="text-zinc-700">·</span>
                  <span className="tabular-nums">
                    opened {relativeTime(e.started_at)}
                  </span>
                </>
              )}
            </div>
            <h1 className="mt-3 text-4xl md:text-5xl font-bold tracking-tight bg-gradient-to-r from-white via-white to-zinc-400 bg-clip-text text-transparent">
              {engagement.isLoading ? (
                <Skeleton className="h-12 w-96" />
              ) : (
                e?.engagement_name
              )}
            </h1>
            <p className="mt-3 max-w-2xl text-zinc-400 leading-relaxed">
              {e?.description}
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Badge variant={active ? "emerald" : "zinc"}>
                {active && (
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                )}
                {e?.status ?? "—"}
              </Badge>
              {e && (
                <Badge variant="indigo">
                  {formatNumber(e.metrics.theses_count)}{" "}
                  {e.metrics.theses_count === 1 ? "thesis" : "theses"}
                </Badge>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button
              variant="secondary"
              size="lg"
              leftIcon={<Sparkles className="w-4 h-4" />}
            >
              Brief Caleb
            </Button>
            <Button size="lg" leftIcon={<Plus className="w-4 h-4" />}>
              New thesis
            </Button>
          </div>
        </header>

        <section className="mt-10 grid grid-cols-1 lg:grid-cols-3 gap-6">
          <PipelineFunnel
            isLoading={engagement.isLoading}
            engagement={e ?? null}
          />
          <MetricStack
            engagement={e ?? null}
            isLoading={engagement.isLoading}
          />
        </section>

        <section className="mt-12 mb-20">
          <div className="flex items-end justify-between mb-5">
            <div>
              <h2 className="text-2xl font-semibold tracking-tight">Theses</h2>
              <p className="text-sm text-zinc-500 mt-1">
                Each thesis defines a slice of the mandate. Open one for the
                tier rail and outreach pipe.
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              leftIcon={<Plus className="w-3.5 h-3.5" />}
            >
              Add thesis
            </Button>
          </div>

          {theses.isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 2 }).map((_, i) => (
                <Skeleton key={i} className="h-24 w-full rounded-2xl" />
              ))}
            </div>
          ) : theses.data && theses.data.length > 0 ? (
            <ul className="space-y-3">
              {theses.data.map((t) => (
                <ThesisRow key={t.thesis_id} thesis={t} />
              ))}
            </ul>
          ) : (
            <EmptyState
              icon={Target}
              title="No theses yet"
              description="Define an investment thesis to begin sourcing companies into this engagement."
              action={
                <Button leftIcon={<Plus className="w-4 h-4" />}>
                  Create the first thesis
                </Button>
              }
            />
          )}
        </section>
      </div>
    </div>
  );
}

function PipelineFunnel({
  isLoading,
  engagement,
}: {
  isLoading: boolean;
  engagement: Engagement | null;
}) {
  const stages = useMemo(() => {
    const m = engagement?.metrics;
    return [
      {
        label: "Sourced",
        value: m?.companies_count ?? 0,
        accent: "from-zinc-600 to-zinc-700",
        text: "text-zinc-200",
      },
      {
        label: "Meetings booked",
        value: m?.meetings_booked ?? 0,
        accent: "from-indigo-500 to-indigo-600",
        text: "text-indigo-200",
      },
      {
        label: "In LOI",
        value: m?.in_loi ?? 0,
        accent: "from-amber-500 to-amber-600",
        text: "text-amber-200",
      },
      {
        label: "Closed won",
        value: m?.closed_won ?? 0,
        accent: "from-emerald-500 to-emerald-600",
        text: "text-emerald-200",
      },
    ];
  }, [engagement]);
  const peak = Math.max(...stages.map((s) => s.value), 1);
  const top = stages[0].value;

  return (
    <Card className="lg:col-span-2 p-6 md:p-7">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-indigo-400" />
          <h3 className="text-sm font-semibold uppercase tracking-wider text-zinc-300">
            Pipeline funnel
          </h3>
        </div>
        <span className="text-xs text-zinc-500 tabular-nums">
          {top > 0
            ? `${Math.round((stages[3].value / top || 0) * 100)}% closed`
            : "no data"}
        </span>
      </div>

      {isLoading ? (
        <div className="mt-6 space-y-3">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-4/5" />
          <Skeleton className="h-10 w-2/5" />
          <Skeleton className="h-10 w-1/5" />
        </div>
      ) : (
        <div className="mt-6 space-y-3">
          {stages.map((s, i) => {
            const pct = (s.value / peak) * 100;
            const previous = i === 0 ? null : stages[i - 1];
            const conv =
              previous && previous.value > 0
                ? Math.round((s.value / previous.value) * 100)
                : null;
            return (
              <div key={s.label}>
                <div className="flex items-center justify-between text-xs mb-1.5">
                  <span className="text-zinc-300 font-medium">{s.label}</span>
                  <span className="flex items-center gap-2">
                    {conv !== null && (
                      <span className="text-zinc-500 tabular-nums">
                        {conv}%
                      </span>
                    )}
                    <span className="text-zinc-100 font-semibold tabular-nums">
                      {formatNumber(s.value)}
                    </span>
                  </span>
                </div>
                <div className="relative h-9 rounded-lg bg-zinc-950/60 overflow-hidden border border-zinc-800/80">
                  <div
                    className={`absolute inset-y-0 left-0 bg-gradient-to-r ${s.accent} transition-all duration-500`}
                    style={{ width: `${Math.max(2, pct)}%` }}
                  />
                  <div className="absolute inset-0 grid grid-cols-12 pointer-events-none opacity-30">
                    {Array.from({ length: 12 }).map((_, k) => (
                      <div
                        key={k}
                        className="border-r border-white/5 last:border-none"
                      />
                    ))}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

function MetricStack({
  engagement,
  isLoading,
}: {
  engagement: Engagement | null;
  isLoading: boolean;
}) {
  const m = engagement?.metrics;
  const inMotion =
    (m?.meetings_booked ?? 0) + (m?.in_loi ?? 0) + (m?.closed_won ?? 0);
  const inMotionPct =
    m && m.companies_count > 0
      ? Math.round((inMotion / m.companies_count) * 100)
      : 0;

  return (
    <div className="space-y-3">
      <Card className="p-5">
        <div className="flex items-center justify-between">
          <span className="text-[11px] uppercase tracking-wider text-zinc-500">
            In motion
          </span>
          <Globe className="w-3.5 h-3.5 text-zinc-600" />
        </div>
        {isLoading ? (
          <Skeleton className="mt-3 h-9 w-24" />
        ) : (
          <>
            <div className="mt-3 text-4xl font-bold tracking-tight tabular-nums bg-gradient-to-r from-white to-zinc-400 bg-clip-text text-transparent">
              {inMotionPct}%
            </div>
            <div className="mt-1 text-xs text-zinc-500">
              {formatNumber(inMotion)} of{" "}
              {formatNumber(m?.companies_count ?? 0)} sourced
            </div>
            <div className="mt-4 h-1.5 rounded-full bg-zinc-800 overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-indigo-500 to-violet-500"
                style={{ width: `${inMotionPct}%` }}
              />
            </div>
          </>
        )}
      </Card>

      <Card className="p-5">
        <div className="flex items-center justify-between">
          <span className="text-[11px] uppercase tracking-wider text-zinc-500">
            Meetings this window
          </span>
          <Calendar className="w-3.5 h-3.5 text-zinc-600" />
        </div>
        {isLoading ? (
          <Skeleton className="mt-3 h-8 w-12" />
        ) : (
          <>
            <div className="mt-3 text-3xl font-bold tracking-tight tabular-nums text-emerald-300">
              {formatNumber(m?.meetings_booked ?? 0)}
            </div>
            <div className="mt-1 text-xs text-zinc-500">booked</div>
          </>
        )}
      </Card>

      <Card className="p-5">
        <div className="flex items-center justify-between">
          <span className="text-[11px] uppercase tracking-wider text-zinc-500">
            Coverage
          </span>
          <Users className="w-3.5 h-3.5 text-zinc-600" />
        </div>
        {isLoading ? (
          <Skeleton className="mt-3 h-8 w-12" />
        ) : (
          <>
            <div className="mt-3 text-3xl font-bold tracking-tight tabular-nums text-zinc-100">
              {formatNumber(m?.theses_count ?? 0)}
            </div>
            <div className="mt-1 text-xs text-zinc-500">theses live</div>
          </>
        )}
      </Card>
    </div>
  );
}

function ThesisRow({ thesis }: { thesis: Thesis }) {
  const geo = thesis.geo_constraints?.slice(0, 3) ?? [];
  const moreGeo = (thesis.geo_constraints?.length ?? 0) - geo.length;
  const active = thesis.status === "active";

  return (
    <li>
      <Link href={`/theses/${thesis.thesis_id}`} className="group block">
        <Card className="p-5 hover:border-zinc-700 transition-all duration-200">
          <div className="flex items-start gap-5 flex-wrap md:flex-nowrap">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-semibold tracking-tight text-zinc-50 group-hover:text-white truncate">
                  {thesis.thesis_name}
                </h3>
                <Badge variant={active ? "emerald" : "zinc"}>
                  {active && (
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                  )}
                  {thesis.status}
                </Badge>
              </div>
              <p className="mt-1 text-sm text-zinc-400 line-clamp-2 max-w-2xl">
                {thesis.description}
              </p>
            </div>

            <div className="flex items-center gap-5 shrink-0">
              <Stat
                label="Revenue"
                value={`${formatCurrency(thesis.revenue_range?.min, {
                  compact: true,
                })} – ${formatCurrency(thesis.revenue_range?.max, {
                  compact: true,
                })}`}
              />
              <Stat
                label="Headcount"
                value={`${formatNumber(
                  thesis.headcount_range?.min ?? 0,
                )} – ${formatNumber(thesis.headcount_range?.max ?? 0)}`}
              />
              <Stat
                label="Geo"
                value={
                  geo.length
                    ? `${geo.join(", ")}${moreGeo > 0 ? ` +${moreGeo}` : ""}`
                    : "any"
                }
              />
            </div>

            <ArrowUpRight className="hidden md:block w-5 h-5 text-zinc-600 group-hover:text-indigo-400 transition-colors mt-1 shrink-0" />
          </div>

          <div className="mt-4 pt-4 border-t border-zinc-800/80 flex items-center justify-between text-xs">
            <div className="flex items-center gap-2 text-zinc-500">
              <span>
                Updated{" "}
                <span className="text-zinc-300 tabular-nums">
                  {relativeTime(thesis.updated_at)}
                </span>
              </span>
            </div>
            <span className="inline-flex items-center gap-1 text-indigo-400 group-hover:text-indigo-300 transition-colors">
              Open pipe
              <ArrowRight className="w-3 h-3" />
            </span>
          </div>
        </Card>
      </Link>
    </li>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] uppercase tracking-wider text-zinc-500">
        {label}
      </div>
      <div className="mt-0.5 text-sm font-medium text-zinc-200 tabular-nums whitespace-nowrap">
        {value}
      </div>
    </div>
  );
}
