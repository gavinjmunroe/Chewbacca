"use client";

import { useQuery } from "@tanstack/react-query";
import { Phone, Radio } from "lucide-react";
import { apiClient } from "@/lib/api-client";
import { DialerSession } from "@/components/sourcing/dialer-session";
import { Skeleton } from "@/components/ui/skeleton";

export default function DialerPage() {
  const { data: sessionId, isLoading: idLoading } = useQuery({
    queryKey: ["dialer-default"],
    queryFn: async () => {
      const id = "ds_kevin_2026_05_11_am";
      try {
        await apiClient.getSession(id);
        return id;
      } catch {
        const fresh = await apiClient.startSession({
          user_id: "u_kevin",
          thesis_id: "thesis_landscaping_se",
          task_filter: { tier: 1, milestone: "not_yet_approached" },
        });
        return fresh.session_id;
      }
    },
  });

  const sessionDetail = useQuery({
    queryKey: ["dialer-session-header", sessionId],
    queryFn: () => apiClient.getSession(sessionId!),
    enabled: Boolean(sessionId),
  });

  const current = sessionDetail.data?.queue?.[0];
  const thesisName = current?.company.industry ?? "Tier 1 outreach";

  return (
    <div className="relative">
      <div className="absolute inset-0 -z-10 bg-mesh" />
      <div className="absolute inset-x-0 top-0 -z-10 h-[280px] bg-grid opacity-25 [mask-image:linear-gradient(to_bottom,black,transparent)]" />

      <div className="max-w-[1500px] mx-auto px-4 sm:px-6 lg:px-8 pt-12 md:pt-16 fade-in-up">
        <header className="flex flex-col md:flex-row md:items-end md:justify-between gap-6 mb-8">
          <div className="min-w-0">
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-300 border border-emerald-500/30">
              <span className="relative flex w-1.5 h-1.5">
                <span className="absolute inset-0 rounded-full bg-emerald-400 animate-ping opacity-60" />
                <span className="relative rounded-full w-1.5 h-1.5 bg-emerald-400" />
              </span>
              Session live
              {sessionDetail.data?.session && (
                <>
                  <span className="text-emerald-500/50 mx-1">·</span>
                  <span className="tabular-nums">
                    {sessionDetail.data.queue.length} in queue
                  </span>
                </>
              )}
            </div>
            <h1 className="mt-3 text-4xl md:text-5xl font-bold tracking-tight bg-gradient-to-r from-white via-white to-zinc-400 bg-clip-text text-transparent">
              Dialer
            </h1>
            <p className="mt-3 max-w-2xl text-zinc-400 leading-relaxed">
              {thesisName} queue. Every call is transcribed live, outcome-tagged
              by Claude, and written back to the deal row the moment you hang
              up.
            </p>
          </div>

          {sessionDetail.data?.session && (
            <div className="flex items-center gap-3 shrink-0">
              <SessionMetric
                label="Calls"
                value={sessionDetail.data.session.total_calls}
              />
              <SessionMetric
                label="Answered"
                value={sessionDetail.data.session.answered_count}
                accent="indigo"
              />
              <SessionMetric
                label="Meetings"
                value={sessionDetail.data.session.meetings_booked}
                accent="emerald"
              />
            </div>
          )}
        </header>

        {idLoading || !sessionId ? (
          <Skeleton className="h-[640px] rounded-2xl" />
        ) : (
          <DialerSession sessionId={sessionId} />
        )}

        <div className="mt-6 mb-20 flex items-center justify-center gap-2 text-xs text-zinc-500">
          <Radio className="w-3 h-3" />
          <span>Retell · 16kHz · low-latency · transcripts stored to BQ</span>
          <Phone className="w-3 h-3 ml-2" />
        </div>
      </div>
    </div>
  );
}

function SessionMetric({
  label,
  value,
  accent = "zinc",
}: {
  label: string;
  value: number;
  accent?: "zinc" | "indigo" | "emerald";
}) {
  const accentClass =
    accent === "emerald"
      ? "text-emerald-300"
      : accent === "indigo"
        ? "text-indigo-300"
        : "text-zinc-100";
  return (
    <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl px-4 py-2.5">
      <div
        className={`text-xl font-bold tracking-tight tabular-nums ${accentClass}`}
      >
        {value}
      </div>
      <div className="text-[10px] uppercase tracking-wider text-zinc-500 mt-0.5">
        {label}
      </div>
    </div>
  );
}
