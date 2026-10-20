"use client";

import { use } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowUpRight,
  Building2,
  CheckCircle2,
  Globe,
  Hash,
  History,
  Mail,
  MapPin,
  Phone,
  Share2,
  Sparkles,
  TrendingUp,
  Users,
} from "lucide-react";
import { apiClient } from "@/lib/api-client";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PrimaryContactOverride } from "@/components/sourcing/primary-contact-override";
import {
  formatCurrency,
  formatNumber,
  milestoneLabel,
  relativeTime,
  TIER_COLORS,
} from "@/lib/utils";

export default function CompanyDetailPage({
  params,
}: {
  params: Promise<{ id: string; cid: string }>;
}) {
  const { id, cid } = use(params);
  const { data, isLoading } = useQuery({
    queryKey: ["company", cid],
    queryFn: () => apiClient.getCompany(cid),
  });

  if (isLoading || !data) {
    return (
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pt-12 md:pt-16">
        <Skeleton className="h-4 w-32 mb-6" />
        <Skeleton className="h-12 w-96 mb-3" />
        <Skeleton className="h-5 w-72 mb-6" />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-4">
            <Skeleton className="h-44 rounded-2xl" />
            <Skeleton className="h-72 rounded-2xl" />
          </div>
          <div className="space-y-4">
            <Skeleton className="h-72 rounded-2xl" />
            <Skeleton className="h-40 rounded-2xl" />
          </div>
        </div>
      </div>
    );
  }

  const { company, contacts, thesis_company, recent_calls } = data;
  const tier = thesis_company?.tier;
  const tc = tier && TIER_COLORS[tier] ? TIER_COLORS[tier] : TIER_COLORS[3];
  const verifiedContacts = contacts.filter((c) => c.email_verified).length;

  return (
    <div className="relative">
      <div className="absolute inset-0 -z-10 bg-mesh" />
      <div className="absolute inset-x-0 top-0 -z-10 h-[400px] bg-grid opacity-25 [mask-image:linear-gradient(to_bottom,black,transparent)]" />

      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pt-12 md:pt-16 fade-in-up">
        <Link
          href={`/theses/${id}`}
          className="inline-flex items-center gap-1.5 text-sm text-zinc-400 hover:text-zinc-100 transition-all duration-200 cursor-pointer"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Back to thesis
        </Link>

        <header className="mt-6 flex flex-col md:flex-row md:items-start md:justify-between gap-6">
          <div className="flex items-start gap-4 min-w-0">
            <span className="grid place-items-center w-14 h-14 rounded-2xl bg-zinc-900 border border-zinc-800 text-zinc-200 shadow-lg shadow-black/30 shrink-0">
              <Building2 className="w-6 h-6" />
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                {company.industry && (
                  <span className="truncate">{company.industry}</span>
                )}
                {company.industry && company.city && (
                  <span className="text-zinc-700">·</span>
                )}
                {company.city && (
                  <span>
                    {company.city}
                    {company.state ? `, ${company.state}` : ""}
                  </span>
                )}
              </div>
              <h1 className="mt-1 text-3xl md:text-5xl font-bold tracking-tight bg-gradient-to-r from-white via-white to-zinc-400 bg-clip-text text-transparent">
                {company.company_name}
              </h1>
              <div className="mt-3 flex items-center flex-wrap gap-2">
                <Badge
                  variant={
                    tier === 1 ? "emerald" : tier === 2 ? "amber" : "zinc"
                  }
                >
                  <span className={`w-1.5 h-1.5 rounded-full ${tc.dot}`} />
                  Tier {tier ?? "—"}
                </Badge>
                {thesis_company && (
                  <Badge variant="violet">
                    {milestoneLabel(thesis_company.milestone)}
                  </Badge>
                )}
                {company.fit_score !== null &&
                  company.fit_score !== undefined && (
                    <Badge variant="indigo">
                      <Sparkles className="w-3 h-3" />
                      fit {company.fit_score}
                    </Badge>
                  )}
                {company.dealcloud_id && (
                  <Badge variant="zinc">
                    <CheckCircle2 className="w-3 h-3" />
                    in DealCloud
                  </Badge>
                )}
              </div>
              {company.description && (
                <p className="mt-4 max-w-2xl text-zinc-400 leading-relaxed">
                  {company.description}
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <Link href="/dialer">
              <Button size="lg" leftIcon={<Phone className="w-4 h-4" />}>
                Call now
              </Button>
            </Link>
            <Button
              variant="secondary"
              size="lg"
              leftIcon={<Mail className="w-4 h-4" />}
            >
              Draft email
            </Button>
          </div>
        </header>

        <div className="mt-10 grid grid-cols-1 lg:grid-cols-3 gap-6 mb-20">
          <div className="lg:col-span-2 space-y-6">
            <PrimaryContactOverride companyId={cid} contacts={contacts} />

            <Card className="overflow-hidden">
              <div className="px-6 py-4 border-b border-zinc-800/80 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Users className="w-4 h-4 text-zinc-500" />
                  <h3 className="text-sm font-semibold uppercase tracking-wider text-zinc-300">
                    All contacts
                  </h3>
                </div>
                <span className="text-xs text-zinc-500 tabular-nums">
                  {contacts.length} on file ·{" "}
                  <span className="text-emerald-400">
                    {verifiedContacts} verified
                  </span>
                </span>
              </div>
              {contacts.length === 0 ? (
                <div className="p-6">
                  <EmptyState
                    icon={Users}
                    title="No contacts enriched yet"
                    description="Run an enrichment pass to surface decision-makers."
                  />
                </div>
              ) : (
                <ul className="divide-y divide-zinc-800/80">
                  {contacts.map((c) => (
                    <li
                      key={c.contact_id}
                      className="px-6 py-3 flex items-center gap-4 hover:bg-white/[0.02] transition-colors"
                    >
                      <span className="grid place-items-center w-9 h-9 rounded-xl bg-zinc-800 border border-zinc-700 text-xs font-semibold text-zinc-200 shrink-0">
                        {c.first_name?.[0] ?? "?"}
                        {c.last_name?.[0] ?? ""}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-zinc-100 truncate">
                            {c.full_name}
                          </span>
                          {c.is_primary && (
                            <Badge variant="indigo">primary</Badge>
                          )}
                          {c.email_verified && (
                            <span className="inline-flex items-center gap-0.5 text-[10px] text-emerald-400 font-medium">
                              <CheckCircle2 className="w-3 h-3" />
                              verified
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-zinc-500 truncate mt-0.5">
                          {c.title || "—"}
                          {c.primary_reason ? ` · ${c.primary_reason}` : ""}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {c.email && (
                          <a
                            href={`mailto:${c.email}`}
                            className="grid place-items-center w-7 h-7 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-white/5 transition-all duration-200 cursor-pointer"
                            title={c.email}
                          >
                            <Mail className="w-3.5 h-3.5" />
                          </a>
                        )}
                        {(c.mobile_phone || c.business_phone) && (
                          <a
                            href={`tel:${c.mobile_phone || c.business_phone}`}
                            className="grid place-items-center w-7 h-7 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-white/5 transition-all duration-200 cursor-pointer"
                            title={c.mobile_phone || c.business_phone || ""}
                          >
                            <Phone className="w-3.5 h-3.5" />
                          </a>
                        )}
                        {c.linkedin_url && (
                          <a
                            href={c.linkedin_url}
                            target="_blank"
                            rel="noreferrer"
                            className="grid place-items-center w-7 h-7 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-white/5 transition-all duration-200 cursor-pointer"
                          >
                            <Share2 className="w-3.5 h-3.5" />
                          </a>
                        )}
                        <span className="ml-2 text-xs tabular-nums text-zinc-500 w-10 text-right">
                          {c.primary_score ?? "—"}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card className="overflow-hidden">
              <div className="px-6 py-4 border-b border-zinc-800/80 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <History className="w-4 h-4 text-zinc-500" />
                  <h3 className="text-sm font-semibold uppercase tracking-wider text-zinc-300">
                    Recent calls
                  </h3>
                </div>
                <span className="text-xs text-zinc-500 tabular-nums">
                  {recent_calls.length} on record
                </span>
              </div>
              {recent_calls.length === 0 ? (
                <div className="px-6 py-10 text-center text-sm text-zinc-500">
                  No calls placed yet. The first outreach will land here with a
                  transcript and outcome.
                </div>
              ) : (
                <ul className="divide-y divide-zinc-800/80">
                  {recent_calls.slice(0, 5).map((cl) => {
                    const positive = cl.outcome === "meeting_booked";
                    const dot = positive
                      ? "bg-emerald-400"
                      : cl.answered
                        ? "bg-amber-400"
                        : "bg-zinc-600";
                    return (
                      <li
                        key={cl.call_id}
                        className="px-6 py-4 flex items-start gap-3"
                      >
                        <span
                          className={`mt-1.5 w-2 h-2 rounded-full ${dot}`}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm text-zinc-100 leading-relaxed">
                            {cl.transcript_summary ?? "No summary recorded."}
                          </div>
                          <div className="mt-1.5 flex items-center gap-2 text-xs text-zinc-500 flex-wrap">
                            <Badge variant={positive ? "emerald" : "zinc"}>
                              {cl.outcome.replace(/_/g, " ")}
                            </Badge>
                            <span className="tabular-nums">
                              {Math.max(
                                1,
                                Math.round(cl.duration_seconds / 60),
                              )}{" "}
                              min
                            </span>
                            <span className="text-zinc-700">·</span>
                            <span className="tabular-nums">
                              {relativeTime(cl.created_at)}
                            </span>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>
          </div>

          <aside className="space-y-4">
            <Card className="p-5">
              <div className="flex items-center justify-between mb-4">
                <span className="text-[11px] uppercase tracking-wider text-zinc-500">
                  Firmographics
                </span>
                {company.domain && (
                  <a
                    href={`https://${company.domain}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-indigo-400 hover:text-indigo-300 inline-flex items-center gap-1 transition-colors cursor-pointer"
                  >
                    {company.domain}
                    <ArrowUpRight className="w-3 h-3" />
                  </a>
                )}
              </div>
              <dl className="space-y-3 text-sm">
                <Row
                  icon={MapPin}
                  label="Headquarters"
                  value={
                    company.city
                      ? `${company.city}${
                          company.state ? `, ${company.state}` : ""
                        }`
                      : "—"
                  }
                />
                <Row
                  icon={Hash}
                  label="NAICS"
                  value={company.naics_code ?? "—"}
                />
                <Row
                  icon={TrendingUp}
                  label="Est. revenue"
                  value={formatCurrency(company.estimated_revenue, {
                    compact: true,
                  })}
                />
                <Row
                  icon={Users}
                  label="Headcount"
                  value={
                    company.estimated_headcount
                      ? formatNumber(company.estimated_headcount)
                      : "—"
                  }
                />
                <Row
                  icon={History}
                  label="Founded"
                  value={company.founded_year?.toString() ?? "—"}
                />
                {company.linkedin_url && (
                  <Row
                    icon={Share2}
                    label="LinkedIn"
                    value={
                      <a
                        href={company.linkedin_url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-indigo-400 hover:text-indigo-300 inline-flex items-center gap-1 cursor-pointer"
                      >
                        view
                        <ArrowUpRight className="w-3 h-3" />
                      </a>
                    }
                  />
                )}
              </dl>
            </Card>

            {thesis_company?.tier_reason && (
              <Card className="p-5 bg-gradient-to-br from-indigo-500/5 via-zinc-900 to-zinc-900 border-indigo-500/20">
                <div className="flex items-center gap-2 mb-2">
                  <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
                  <span className="text-[11px] uppercase tracking-wider text-indigo-300">
                    Tiering rationale
                  </span>
                </div>
                <p className="text-sm text-zinc-200 leading-relaxed">
                  {thesis_company.tier_reason}
                </p>
              </Card>
            )}

            <Card className="p-5">
              <div className="text-[11px] uppercase tracking-wider text-zinc-500 mb-3">
                Identifiers
              </div>
              <dl className="space-y-2 text-xs font-mono">
                <IdRow label="Togari" value={company.company_id} />
                <IdRow label="DealCloud" value={company.dealcloud_id} />
                <IdRow label="HubSpot" value={company.hubspot_id} />
              </dl>
            </Card>
          </aside>
        </div>
      </div>
    </div>
  );
}

function Row({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Globe;
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex items-center gap-2 text-zinc-500">
        <Icon className="w-3.5 h-3.5" />
        <span className="text-xs">{label}</span>
      </div>
      <div className="text-zinc-200 truncate text-right tabular-nums">
        {value}
      </div>
    </div>
  );
}

function IdRow({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-zinc-500">{label}</span>
      <span className="text-zinc-300 truncate text-right">{value ?? "—"}</span>
    </div>
  );
}
