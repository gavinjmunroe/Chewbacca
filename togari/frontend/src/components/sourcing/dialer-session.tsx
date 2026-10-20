"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Phone,
  Sparkles,
  PhoneOff,
  SkipForward,
  Pause,
  Mic,
  MessageSquare,
} from "lucide-react";
import { apiClient, API_BASE } from "@/lib/api-client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

interface TranscriptLine {
  speaker: "agent" | "contact";
  text: string;
  idx: number;
  ts: number;
}

interface AISuggestion {
  at: number;
  suggestion: string;
}

export function DialerSession({ sessionId }: { sessionId: string }) {
  const session = useQuery({
    queryKey: ["dialer-session", sessionId],
    queryFn: () => apiClient.getSession(sessionId),
    refetchInterval: 3000,
  });

  const [transcript, setTranscript] = useState<TranscriptLine[]>([]);
  const [suggestions, setSuggestions] = useState<AISuggestion[]>([]);
  const [streaming, setStreaming] = useState(false);
  const transcriptScroll = useRef<HTMLDivElement>(null);

  function startStream() {
    setTranscript([]);
    setSuggestions([]);
    setStreaming(true);
    const es = new EventSource(
      `${API_BASE}/api/v1/dialer/sessions/${sessionId}/stream`,
    );
    es.addEventListener("transcript", (ev: MessageEvent) => {
      try {
        const line: TranscriptLine = JSON.parse(ev.data);
        setTranscript((t) => [...t, line]);
      } catch {}
    });
    es.addEventListener("ai_suggestion", (ev: MessageEvent) => {
      try {
        const sug: AISuggestion = JSON.parse(ev.data);
        setSuggestions((s) => [...s, sug]);
      } catch {}
    });
    es.addEventListener("complete", () => {
      setStreaming(false);
      es.close();
    });
    es.onerror = () => {
      setStreaming(false);
      es.close();
    };
  }

  useEffect(() => {
    transcriptScroll.current?.scrollTo({
      top: transcriptScroll.current.scrollHeight,
      behavior: "smooth",
    });
  }, [transcript.length]);

  if (!session.data) {
    return <Skeleton className="h-96 rounded-2xl" />;
  }

  const queue = session.data.queue;
  const current = queue[0];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr_320px] gap-4">
      {/* Queue */}
      <Card className="overflow-hidden">
        <div className="px-4 py-3 border-b border-zinc-800/80 flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wide text-zinc-300">
            Queue
          </span>
          <Badge variant="indigo">{queue.length}</Badge>
        </div>
        <ul className="max-h-[640px] overflow-auto divide-y divide-zinc-800/80">
          {queue.length === 0 && (
            <li className="px-4 py-6 text-xs text-zinc-500">
              Queue empty. Adjust filters on the thesis page.
            </li>
          )}
          {queue.map((q, i) => (
            <li
              key={q?.task.task_id}
              className={`px-4 py-3 ${i === 0 ? "bg-indigo-500/5 border-l-2 border-indigo-500" : ""}`}
            >
              <div className="text-sm font-medium text-zinc-100 truncate">
                {q?.company.company_name}
              </div>
              <div className="text-xs text-zinc-500 mt-0.5 truncate">
                {q?.contact.full_name} · {q?.contact.title || "—"}
              </div>
              <div className="text-[10px] text-zinc-600 mt-1 tabular-nums">
                {q?.contact.mobile_phone ||
                  q?.contact.business_phone ||
                  "no phone"}
              </div>
            </li>
          ))}
        </ul>
      </Card>

      {/* Live transcript */}
      <Card className="overflow-hidden flex flex-col">
        <div className="px-5 py-3 border-b border-zinc-800/80 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="grid place-items-center w-9 h-9 rounded-xl bg-indigo-500/15 text-indigo-300 border border-indigo-500/30">
              <Mic className="w-4 h-4" />
            </div>
            <div>
              <div className="text-sm font-semibold text-zinc-100">
                {current?.company.company_name ?? "Idle"}
              </div>
              <div className="text-xs text-zinc-500">
                {current
                  ? `${current.contact.full_name} · ${current.contact.title || "—"}`
                  : "Press start to begin a call"}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {streaming ? (
              <Badge variant="emerald">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                live
              </Badge>
            ) : (
              <Badge variant="zinc">idle</Badge>
            )}
            {!streaming && (
              <Button
                size="sm"
                onClick={startStream}
                leftIcon={<Phone className="w-3.5 h-3.5" />}
              >
                Start call
              </Button>
            )}
            {streaming && (
              <>
                <Button
                  size="sm"
                  variant="secondary"
                  leftIcon={<Pause className="w-3.5 h-3.5" />}
                >
                  Hold
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  leftIcon={<PhoneOff className="w-3.5 h-3.5" />}
                >
                  End
                </Button>
              </>
            )}
          </div>
        </div>

        <div
          ref={transcriptScroll}
          className="flex-1 overflow-auto p-5 space-y-3 min-h-[400px] bg-gradient-to-b from-zinc-950/40 to-zinc-900/0"
        >
          {transcript.length === 0 && (
            <div className="text-center text-zinc-500 text-sm py-12">
              <MessageSquare className="w-6 h-6 mx-auto mb-2 text-zinc-700" />
              Transcript will stream live once the call connects.
            </div>
          )}
          {transcript.map((line) => (
            <div
              key={line.idx}
              className={`flex ${line.speaker === "agent" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[75%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed fade-in-up ${
                  line.speaker === "agent"
                    ? "bg-indigo-600 text-white"
                    : "bg-zinc-800 text-zinc-100"
                }`}
              >
                <div className="text-[10px] uppercase tracking-wide opacity-70 mb-0.5">
                  {line.speaker === "agent" ? "Kevin (48N)" : "Contact"}
                </div>
                {line.text}
              </div>
            </div>
          ))}
        </div>

        <div className="px-5 py-3 border-t border-zinc-800/80 flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs text-zinc-500">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            Retell · 16kHz · low-latency
          </div>
          <Button
            size="sm"
            variant="secondary"
            leftIcon={<SkipForward className="w-3.5 h-3.5" />}
          >
            Next contact
          </Button>
        </div>
      </Card>

      {/* AI co-pilot */}
      <Card className="overflow-hidden">
        <div className="px-4 py-3 border-b border-zinc-800/80 flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-indigo-400" />
          <span className="text-xs font-semibold uppercase tracking-wide text-zinc-300">
            AI co-pilot
          </span>
        </div>
        <div className="p-4 space-y-3 max-h-[560px] overflow-auto">
          {suggestions.length === 0 && (
            <div className="text-xs text-zinc-500 leading-relaxed">
              Suggestions appear here as the conversation progresses. The
              co-pilot listens for objections, owner intent, and ICP signals,
              and surfaces the next best move in real time.
            </div>
          )}
          {suggestions.map((s, i) => (
            <div
              key={`${s.at}-${i}`}
              className="bg-indigo-500/10 border border-indigo-500/30 rounded-xl p-3 fade-in-up"
            >
              <div className="text-[10px] font-semibold uppercase tracking-wide text-indigo-300 mb-1">
                Suggestion · turn {s.at + 1}
              </div>
              <div className="text-sm text-zinc-100 leading-relaxed">
                {s.suggestion}
              </div>
            </div>
          ))}

          <div className="border-t border-zinc-800/80 pt-3 mt-4">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500 mb-2">
              Session metrics
            </div>
            <dl className="space-y-1.5 text-xs">
              <div className="flex justify-between">
                <dt className="text-zinc-500">Calls</dt>
                <dd className="text-zinc-200 tabular-nums">
                  {session.data.session.total_calls}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-zinc-500">Answered</dt>
                <dd className="text-zinc-200 tabular-nums">
                  {session.data.session.answered_count}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-zinc-500">Meetings</dt>
                <dd className="text-emerald-400 tabular-nums">
                  {session.data.session.meetings_booked}
                </dd>
              </div>
            </dl>
          </div>
        </div>
      </Card>
    </div>
  );
}
