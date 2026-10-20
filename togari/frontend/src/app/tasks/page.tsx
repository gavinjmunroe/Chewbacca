"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import {
  CheckCircle2,
  Clock,
  Filter,
  ListChecks,
  Mail,
  Phone,
  Search,
  Send,
} from "lucide-react";
import { apiClient } from "@/lib/api-client";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { TIER_COLORS, relativeTime } from "@/lib/utils";
import type { Company, CompanyContact, Task } from "@/types/sourcing";

type TaskRow = { task: Task; company: Company; contact: CompanyContact | null };

const TYPE_FILTERS = [
  { value: null, label: "All" },
  { value: "dialer_call", label: "Dialer" },
  { value: "personal_call", label: "Personal" },
  { value: "email", label: "Email" },
  { value: "linkedin_dm", label: "LinkedIn" },
] as const;

const TIER_META: Record<
  number,
  { title: string; sub: string; variant: "emerald" | "amber" | "zinc" }
> = {
  1: {
    title: "Tier 1",
    sub: "Owner intent verified. Call first.",
    variant: "emerald",
  },
  2: {
    title: "Tier 2",
    sub: "Adjacent fit. Second-pass outreach.",
    variant: "amber",
  },
  3: {
    title: "Tier 3 & nurture",
    sub: "Long-tail. Async-first cadence.",
    variant: "zinc",
  },
};

export default function TasksPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["tasks", "today"],
    queryFn: apiClient.todayTasks,
  });
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<string | null>(null);

  const filtered = useMemo(() => {
    if (!data) return [];
    return data.filter(({ task, company, contact }) => {
      if (typeFilter && task.task_type !== typeFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        return (
          (company?.company_name?.toLowerCase() ?? "").includes(q) ||
          (contact?.full_name?.toLowerCase() ?? "").includes(q)
        );
      }
      return true;
    });
  }, [data, search, typeFilter]);

  const grouped = useMemo(() => groupByTier(filtered), [filtered]);
  const completionRate = useMemo(() => {
    if (!data || data.length === 0) return 0;
    const done = data.filter((r) => r.task.status === "completed").length;
    return Math.round((done / data.length) * 100);
  }, [data]);

  return (
    <div className="relative">
      <div className="absolute inset-0 -z-10 bg-mesh" />
      <div className="absolute inset-x-0 top-0 -z-10 h-[380px] bg-grid opacity-25 [mask-image:linear-gradient(to_bottom,black,transparent)]" />

      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pt-12 md:pt-16 fade-in-up">
        <header className="flex flex-col md:flex-row md:items-end md:justify-between gap-6">
          <div className="min-w-0">
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-indigo-500/10 text-indigo-300 border border-indigo-500/20">
              <ListChecks className="w-3 h-3" />
              Today
            </div>
            <h1 className="mt-3 text-4xl md:text-5xl font-bold tracking-tight bg-gradient-to-r from-white via-white to-zinc-400 bg-clip-text text-transparent">
              Your queue
            </h1>
            <p className="mt-3 max-w-2xl text-zinc-400 leading-relaxed">
              The orchestrator generates this every morning. Tier 1 leads first,
              then Tier 2, then nurture. Skip anything that doesn&apos;t fit and
              it routes to a teammate.
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <Card className="p-3 px-4 flex items-center gap-3">
              <span className="grid place-items-center w-9 h-9 rounded-xl bg-emerald-500/10 text-emerald-300 border border-emerald-500/30">
                <CheckCircle2 className="w-4 h-4" />
              </span>
              <div>
                <div className="text-xl font-bold tabular-nums text-zinc-50 leading-none">
                  {completionRate}%
                </div>
                <div className="text-[10px] uppercase tracking-wider text-zinc-500 mt-1">
                  Cleared today
                </div>
              </div>
            </Card>
          </div>
        </header>

        <Card className="mt-8 p-3 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 flex-1 min-w-[240px] bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 focus-within:ring-2 focus-within:ring-indigo-500/40 focus-within:border-indigo-500/50 transition-all duration-200">
            <Search className="w-4 h-4 text-zinc-500" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search company or contact"
              className="bg-transparent flex-1 outline-none text-sm text-zinc-100 placeholder:text-zinc-600"
            />
          </div>
          <div className="flex items-center gap-1">
            <Filter className="w-3.5 h-3.5 text-zinc-500 mr-1" />
            {TYPE_FILTERS.map((t) => (
              <button
                key={t.label}
                onClick={() => setTypeFilter(t.value)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200 cursor-pointer border ${
                  typeFilter === t.value
                    ? "bg-indigo-500/15 text-indigo-300 border-indigo-500/40"
                    : "bg-zinc-900 text-zinc-400 border-zinc-800 hover:border-zinc-700 hover:text-zinc-200"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </Card>

        <div className="mt-8 mb-20 space-y-10">
          {isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-20 w-full rounded-2xl" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={ListChecks}
              title={
                data && data.length === 0
                  ? "Queue is empty for today"
                  : "No tasks match these filters"
              }
              description={
                data && data.length === 0
                  ? "Once the morning orchestrator finishes, this is where your day starts."
                  : "Clear filters to see the full queue, or wait for the next enrichment pass."
              }
              action={
                <Button
                  variant="secondary"
                  onClick={() => {
                    setSearch("");
                    setTypeFilter(null);
                  }}
                >
                  Clear filters
                </Button>
              }
            />
          ) : (
            ([1, 2, 3] as const).map((tier) => {
              const items = grouped[tier];
              if (items.length === 0) return null;
              const meta = TIER_META[tier];
              return (
                <TierSection
                  key={tier}
                  meta={meta}
                  items={items}
                  count={items.length}
                />
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

function groupByTier(rows: TaskRow[]) {
  const buckets: Record<1 | 2 | 3, TaskRow[]> = { 1: [], 2: [], 3: [] };
  for (const r of rows) {
    const t = r.task.priority ?? 3;
    const bucket = (t === 1 ? 1 : t === 2 ? 2 : 3) as 1 | 2 | 3;
    buckets[bucket].push(r);
  }
  return buckets;
}

function TierSection({
  meta,
  items,
  count,
}: {
  meta: { title: string; sub: string; variant: "emerald" | "amber" | "zinc" };
  items: TaskRow[];
  count: number;
}) {
  return (
    <section>
      <div className="flex items-end justify-between mb-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-zinc-50">
            {meta.title}
          </h2>
          <p className="text-xs text-zinc-500 mt-0.5">{meta.sub}</p>
        </div>
        <Badge variant={meta.variant}>
          {count} {count === 1 ? "task" : "tasks"}
        </Badge>
      </div>
      <ul className="space-y-2">
        {items.map((row) => (
          <TaskRow key={row.task.task_id} row={row} />
        ))}
      </ul>
    </section>
  );
}

function TaskRow({ row }: { row: TaskRow }) {
  const { task, company, contact } = row;
  const Icon =
    task.task_type === "email"
      ? Mail
      : task.task_type === "linkedin_dm"
        ? Send
        : Phone;
  const tier = task.priority ?? 3;
  const tc = TIER_COLORS[tier] || TIER_COLORS[3];
  const done = task.status === "completed";
  const phone = contact?.mobile_phone ?? contact?.business_phone ?? null;

  return (
    <li>
      <Link
        href={`/theses/${task.thesis_id}/companies/${task.company_id}`}
        className="block group"
      >
        <Card className="p-4 flex items-center gap-4 hover:border-zinc-700 transition-all duration-200">
          <span
            className={`grid place-items-center w-10 h-10 rounded-xl ${tc.bg} ${tc.text} border ${tc.border} shrink-0`}
          >
            <Icon className="w-4 h-4" />
          </span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-semibold text-zinc-100 truncate">
                {company?.company_name ?? "Unknown company"}
              </span>
              <span className="text-zinc-700">·</span>
              <span className="text-sm text-zinc-300 truncate">
                {contact?.full_name ?? "—"}
              </span>
            </div>
            <div className="text-xs text-zinc-500 mt-1 truncate flex items-center gap-2 flex-wrap">
              <span>{contact?.title ?? "—"}</span>
              {phone && (
                <>
                  <span className="text-zinc-700">·</span>
                  <span className="font-mono tabular-nums">{phone}</span>
                </>
              )}
            </div>
          </div>
          <div className="text-right shrink-0 hidden sm:block">
            <div className="flex items-center gap-1 text-xs text-zinc-500 justify-end">
              <Clock className="w-3 h-3" />
              {relativeTime(task.scheduled_for)}
            </div>
            <Badge variant={done ? "emerald" : "zinc"} className="mt-1">
              {done && <CheckCircle2 className="w-3 h-3" />}
              {task.status}
            </Badge>
          </div>
        </Card>
      </Link>
    </li>
  );
}
