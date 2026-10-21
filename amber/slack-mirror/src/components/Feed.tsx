"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronsDownUp,
  ChevronsUpDown,
  Copy,
  Hash,
  RefreshCw,
  Search,
  Check,
} from "lucide-react";
import type { SlackMessage } from "@/lib/slack";
import { MessageCard } from "@/components/MessageCard";
import { feedToText } from "@/lib/format";

const POLL_MS = 30_000;

export function Feed({
  initialMessages,
  channelName,
}: {
  initialMessages: SlackMessage[];
  channelName: string;
}) {
  const [messages, setMessages] = useState<SlackMessage[]>(initialMessages);
  const [query, setQuery] = useState("");
  const [openThreads, setOpenThreads] = useState<Set<string>>(new Set());
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<number>(Date.now());
  const [copiedAll, setCopiedAll] = useState(false);
  const [justUpdated, setJustUpdated] = useState(false);
  const prevCount = useRef(initialMessages.length);

  const refresh = useCallback(async (manual = false) => {
    if (manual) setRefreshing(true);
    try {
      const res = await fetch("/api/slack/messages", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data.messages)) {
        setMessages(data.messages);
        setLastUpdated(data.fetchedAt || Date.now());
        if (data.messages.length !== prevCount.current) {
          prevCount.current = data.messages.length;
          setJustUpdated(true);
          setTimeout(() => setJustUpdated(false), 2000);
        }
      }
    } finally {
      if (manual) setRefreshing(false);
    }
  }, []);

  // Poll for near-real-time updates on top of the hourly static refresh.
  useEffect(() => {
    const id = setInterval(() => refresh(false), POLL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  const threadTsList = useMemo(
    () => messages.filter((m) => m.replies.length > 0).map((m) => m.ts),
    [messages],
  );
  const allOpen =
    threadTsList.length > 0 && openThreads.size >= threadTsList.length;

  const toggleAll = () => {
    setOpenThreads(allOpen ? new Set() : new Set(threadTsList));
  };

  const toggleThread = (ts: string) => {
    setOpenThreads((prev) => {
      const next = new Set(prev);
      next.has(ts) ? next.delete(ts) : next.add(ts);
      return next;
    });
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return messages;
    return messages.filter((m) => {
      const inMsg =
        m.text.toLowerCase().includes(q) ||
        m.userName.toLowerCase().includes(q) ||
        m.files.some((f) => f.name.toLowerCase().includes(q));
      const inReplies = m.replies.some(
        (r) =>
          r.text.toLowerCase().includes(q) ||
          r.userName.toLowerCase().includes(q),
      );
      return inMsg || inReplies;
    });
  }, [messages, query]);

  const copyAll = async () => {
    await navigator.clipboard.writeText(feedToText(filtered));
    setCopiedAll(true);
    setTimeout(() => setCopiedAll(false), 1600);
  };

  const updatedLabel = new Date(lastUpdated).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });

  return (
    <main className="min-h-screen bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-indigo-900/20 via-zinc-950 to-zinc-950">
      {/* Sticky header / control bar */}
      <header className="sticky top-0 z-40 backdrop-blur-xl bg-zinc-950/80 border-b border-zinc-800/60">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-4">
          <div className="flex items-center justify-between gap-4 mb-4">
            <div className="flex items-center gap-3 min-w-0">
              <div className="p-2 bg-indigo-500/10 rounded-xl text-indigo-400 shrink-0">
                <Hash className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <h1 className="text-lg font-bold tracking-tight truncate">
                  {channelName}
                  <span className="text-zinc-500 font-normal"> mirror</span>
                </h1>
                <div className="flex items-center gap-1.5 text-xs text-zinc-500">
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${
                      justUpdated
                        ? "bg-emerald-400 animate-pulse"
                        : "bg-emerald-500/60"
                    }`}
                  />
                  <span>Updated {updatedLabel}</span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={() => refresh(true)}
                className="inline-flex items-center justify-center w-9 h-9 rounded-xl bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-300 hover:text-white transition-all duration-200 cursor-pointer"
                aria-label="Refresh now"
              >
                <RefreshCw
                  className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`}
                />
              </button>
              <button
                onClick={copyAll}
                className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all duration-200 cursor-pointer shadow-lg shadow-indigo-500/20 ${
                  copiedAll
                    ? "bg-emerald-600 text-white"
                    : "bg-indigo-600 hover:bg-indigo-500 text-white"
                }`}
              >
                {copiedAll ? (
                  <Check className="w-4 h-4" />
                ) : (
                  <Copy className="w-4 h-4" />
                )}
                <span className="hidden sm:inline">
                  {copiedAll ? "Copied" : "Copy all"}
                </span>
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search messages, people, files..."
                className="w-full bg-zinc-900 border border-zinc-700 rounded-xl pl-9 pr-4 py-2.5 text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all duration-200"
              />
            </div>
            {threadTsList.length > 0 && (
              <button
                onClick={toggleAll}
                className="inline-flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm font-medium bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-300 hover:text-white transition-all duration-200 cursor-pointer whitespace-nowrap"
              >
                {allOpen ? (
                  <ChevronsDownUp className="w-4 h-4" />
                ) : (
                  <ChevronsUpDown className="w-4 h-4" />
                )}
                <span className="hidden sm:inline">
                  {allOpen ? "Collapse all" : "Expand all"}
                </span>
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Feed */}
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6">
        <div className="flex items-center justify-between mb-4 px-1">
          <span className="text-xs text-zinc-500">
            {filtered.length} {filtered.length === 1 ? "message" : "messages"}
            {query && ` matching "${query}"`}
          </span>
        </div>

        {filtered.length === 0 ? (
          <div className="text-center py-24">
            <div className="inline-flex p-4 bg-zinc-900 border border-zinc-800 rounded-2xl text-zinc-600 mb-4">
              <Search className="w-7 h-7" />
            </div>
            <p className="text-zinc-400 font-medium">No messages found</p>
            <p className="text-zinc-600 text-sm mt-1">
              {query
                ? "Try a different search."
                : "Waiting for messages to appear."}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map((m) => (
              <MessageCard
                key={m.ts}
                msg={m}
                open={openThreads.has(m.ts)}
                onToggle={() => toggleThread(m.ts)}
              />
            ))}
          </div>
        )}

        <footer className="text-center text-xs text-zinc-600 py-10">
          Live mirror · refreshes every 30s · all glory to God
        </footer>
      </div>
    </main>
  );
}
