"use client";

import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  Building2,
  Database,
  Lock,
  Server,
  Shield,
  Users as UsersIcon,
  Workflow,
} from "lucide-react";
import { apiClient } from "@/lib/api-client";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";

export default function AdminPage() {
  const users = useQuery({
    queryKey: ["users"],
    queryFn: apiClient.listUsers,
  });
  const health = useQuery({
    queryKey: ["integrations-health"],
    queryFn: apiClient.integrationHealth,
  });

  const healthSummary = (health.data ?? []).reduce(
    (acc, h) => {
      acc[h.status] = (acc[h.status] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

  return (
    <div className="relative">
      <div className="absolute inset-0 -z-10 bg-mesh" />
      <div className="absolute inset-x-0 top-0 -z-10 h-[360px] bg-grid opacity-25 [mask-image:linear-gradient(to_bottom,black,transparent)]" />

      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pt-12 md:pt-16 fade-in-up">
        <header className="flex flex-col md:flex-row md:items-end md:justify-between gap-6 mb-10">
          <div className="min-w-0">
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-zinc-800 text-zinc-300 border border-zinc-700">
              <Shield className="w-3 h-3" />
              48n tenant · admin
            </div>
            <h1 className="mt-3 text-4xl md:text-5xl font-bold tracking-tight bg-gradient-to-r from-white via-white to-zinc-400 bg-clip-text text-transparent">
              Admin
            </h1>
            <p className="mt-3 max-w-2xl text-zinc-400 leading-relaxed">
              Tenant identity, integration health, and the team. Anything that
              would page on-call shows up here first.
            </p>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <HealthChip
              label="Healthy"
              value={healthSummary.healthy ?? 0}
              tone="emerald"
            />
            <HealthChip
              label="Degraded"
              value={healthSummary.degraded ?? 0}
              tone="amber"
            />
            <HealthChip
              label="Down"
              value={healthSummary.down ?? 0}
              tone="rose"
            />
          </div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Card className="p-5 lg:col-span-1">
            <div className="flex items-center gap-2 mb-5">
              <Building2 className="w-4 h-4 text-indigo-400" />
              <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-300">
                Tenant
              </h2>
            </div>
            <dl className="space-y-3 text-sm">
              <Row label="Tenant ID" value="48n" mono />
              <Row label="Display name" value="48 North" />
              <Row
                label="Auth0 connection"
                value="dev-4prs757badfajpi5.us.auth0.com"
                mono
              />
              <Row label="BigQuery dataset" value="togari_sourcing" mono />
              <Row label="Region" value="us-central1" />
              <Row
                label="Status"
                value={
                  <Badge variant="emerald">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                    live
                  </Badge>
                }
              />
            </dl>
          </Card>

          <Card className="p-5 lg:col-span-2 overflow-hidden">
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-2">
                <Server className="w-4 h-4 text-indigo-400" />
                <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-300">
                  Integration health
                </h2>
              </div>
              <span className="text-xs text-zinc-500 tabular-nums">
                {health.data?.length ?? 0} services monitored
              </span>
            </div>
            {health.isLoading ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-14 rounded-xl" />
                ))}
              </div>
            ) : (
              <ul className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {health.data?.map((h) => (
                  <li
                    key={h.name}
                    className="flex items-center justify-between bg-zinc-950/60 border border-zinc-800 rounded-xl px-3 py-2.5 hover:border-zinc-700 transition-all duration-200"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span
                        className={`w-2 h-2 rounded-full shrink-0 ${
                          h.status === "healthy"
                            ? "bg-emerald-400"
                            : h.status === "degraded"
                              ? "bg-amber-400"
                              : "bg-rose-500"
                        }`}
                      />
                      <div className="min-w-0">
                        <div className="text-sm text-zinc-100 font-medium truncate">
                          {h.name}
                        </div>
                        <div className="text-[10px] uppercase tracking-wider text-zinc-500">
                          {h.status}
                        </div>
                      </div>
                    </div>
                    <div className="text-xs text-zinc-300 tabular-nums shrink-0 font-mono">
                      {h.latency_ms}ms
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-3">
          <StackChip
            icon={Database}
            label="Warehouse"
            primary="BigQuery"
            secondary="togari_sourcing · us-central1"
          />
          <StackChip
            icon={Workflow}
            label="Orchestration"
            primary="Pub/Sub + Cloud Run"
            secondary="3 topics · 1 worker pool"
          />
          <StackChip
            icon={Activity}
            label="Telemetry"
            primary="Sentry + GCP Logging"
            secondary="48n project · all envs"
          />
        </div>

        <Card className="mt-6 mb-20 overflow-hidden">
          <div className="px-6 py-4 border-b border-zinc-800/80 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <UsersIcon className="w-4 h-4 text-indigo-400" />
              <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-300">
                Users
              </h2>
            </div>
            <span className="text-xs text-zinc-500 tabular-nums">
              {users.data?.length ?? 0} active
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px]">
              <thead className="bg-zinc-950/40 border-b border-zinc-800">
                <tr className="text-left text-[10px] text-zinc-500 uppercase tracking-wider">
                  <th className="px-6 py-3 font-semibold">Name</th>
                  <th className="px-6 py-3 font-semibold">Email</th>
                  <th className="px-6 py-3 font-semibold">Role</th>
                  <th className="px-6 py-3 font-semibold">Permissions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/80">
                {users.isLoading ? (
                  <tr>
                    <td colSpan={4} className="p-4">
                      <Skeleton className="h-12 w-full" />
                    </td>
                  </tr>
                ) : (
                  users.data?.map((u) => (
                    <tr
                      key={u.user_id}
                      className="hover:bg-white/[0.02] transition-colors"
                    >
                      <td className="px-6 py-3">
                        <div className="flex items-center gap-3">
                          <span className="grid place-items-center w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 text-xs text-white font-semibold shadow-lg shadow-indigo-500/30">
                            {u.avatar_initial}
                          </span>
                          <span className="text-sm font-medium text-zinc-100">
                            {u.full_name}
                          </span>
                        </div>
                      </td>
                      <td className="px-6 py-3 text-sm text-zinc-300 font-mono">
                        {u.email}
                      </td>
                      <td className="px-6 py-3">
                        <Badge variant="zinc">{u.role}</Badge>
                      </td>
                      <td className="px-6 py-3">
                        <Badge variant="indigo">
                          <Lock className="w-3 h-3" />
                          sourcing:full
                        </Badge>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  );
}

function HealthChip({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "emerald" | "amber" | "rose";
}) {
  const toneClass =
    tone === "emerald"
      ? "text-emerald-300 border-emerald-500/30 bg-emerald-500/10"
      : tone === "amber"
        ? "text-amber-300 border-amber-500/30 bg-amber-500/10"
        : "text-rose-300 border-rose-500/30 bg-rose-500/10";
  return (
    <div
      className={`flex items-baseline gap-2 px-3 py-2 rounded-xl border ${toneClass}`}
    >
      <span className="text-2xl font-bold tabular-nums">{value}</span>
      <span className="text-[10px] uppercase tracking-wider">{label}</span>
    </div>
  );
}

function StackChip({
  icon: Icon,
  label,
  primary,
  secondary,
}: {
  icon: typeof Database;
  label: string;
  primary: string;
  secondary: string;
}) {
  return (
    <Card className="p-4 flex items-start gap-3">
      <span className="grid place-items-center w-9 h-9 rounded-xl bg-indigo-500/10 text-indigo-300 border border-indigo-500/30 shrink-0">
        <Icon className="w-4 h-4" />
      </span>
      <div className="min-w-0">
        <div className="text-[10px] uppercase tracking-wider text-zinc-500">
          {label}
        </div>
        <div className="text-sm font-semibold text-zinc-100 truncate">
          {primary}
        </div>
        <div className="text-xs text-zinc-500 truncate font-mono mt-0.5">
          {secondary}
        </div>
      </div>
    </Card>
  );
}

function Row({
  label,
  value,
  mono,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-xs text-zinc-500">{label}</dt>
      <dd
        className={
          mono
            ? "text-zinc-200 font-mono text-xs truncate text-right"
            : "text-zinc-200 text-sm truncate text-right"
        }
      >
        {value}
      </dd>
    </div>
  );
}
