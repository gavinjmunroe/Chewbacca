"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Mail,
  AlertCircle,
  Inbox,
  RefreshCw,
  X,
  PenSquare,
  ChevronRight,
} from "lucide-react";

interface Email {
  id: string;
  threadId: string;
  from: string;
  to: string;
  subject: string;
  snippet: string;
  date: string;
  isUnread: boolean;
  url?: string;
}

function extractName(from: string): string {
  // "John Doe <john@example.com>" -> "John Doe"
  const match = from.match(/^(.+?)\s*<.*>$/);
  if (match) return match[1].replace(/"/g, "").trim();
  // "john@example.com" -> "john"
  const atIdx = from.indexOf("@");
  if (atIdx > 0) return from.slice(0, atIdx);
  return from;
}

function getInitial(from: string): string {
  const name = extractName(from);
  return name.charAt(0).toUpperCase();
}

function formatEmailDate(date: string): string {
  if (!date) return "";
  const d = new Date(date);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffHours = diffMs / (1000 * 60 * 60);

  if (diffHours < 1) {
    const mins = Math.round(diffMs / (1000 * 60));
    return `${mins}m ago`;
  }
  if (diffHours < 24) {
    return `${Math.round(diffHours)}h ago`;
  }
  if (diffHours < 168) {
    return d.toLocaleDateString("en-US", { weekday: "short" });
  }
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function EmailPage() {
  const [emails, setEmails] = useState<Email[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Email | null>(null);
  const [nextPageToken, setNextPageToken] = useState<string | null>(null);
  const [totalEstimate, setTotalEstimate] = useState(0);

  async function fetchEmails(pageToken?: string) {
    if (pageToken) {
      setLoadingMore(true);
    } else {
      setLoading(true);
    }
    setError(null);
    try {
      const params = new URLSearchParams({ limit: "15" });
      if (pageToken) params.set("pageToken", pageToken);
      const res = await fetch(`/api/email?${params}`);
      if (!res.ok) throw new Error("Failed to load emails");
      const json = await res.json();
      if (pageToken) {
        setEmails((prev) => [...prev, ...(json.emails || [])]);
      } else {
        setEmails(json.emails || []);
      }
      setNextPageToken(json.nextPageToken || null);
      if (json.totalEstimate) setTotalEstimate(json.totalEstimate);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }

  useEffect(() => {
    fetchEmails();
  }, []);

  const unreadCount = totalEstimate || emails.filter((e) => e.isUnread).length;

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-indigo-500/10 rounded-xl">
            <Mail className="w-5 h-5 text-indigo-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-zinc-50 tracking-tight">
              Email
            </h1>
            <p className="text-xs text-zinc-500">
              {unreadCount > 0 ? `${unreadCount} unread` : "Inbox"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() =>
              window.open("https://mail.google.com/mail/?view=cm", "_blank")
            }
            className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold px-3 py-2 rounded-xl transition-all duration-200 cursor-pointer text-xs"
          >
            <PenSquare className="w-3.5 h-3.5" />
            Compose
          </button>
          <button
            onClick={() => fetchEmails()}
            disabled={loading}
            className="p-2 rounded-lg hover:bg-zinc-800/60 text-zinc-500 hover:text-zinc-300 transition-all duration-200 cursor-pointer disabled:opacity-50"
            aria-label="Refresh emails"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 flex items-center gap-3">
          <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
          <p className="text-sm text-red-300">{error}</p>
          <button
            onClick={() => fetchEmails()}
            className="ml-auto text-xs text-red-400 hover:text-red-300 font-medium cursor-pointer"
          >
            Retry
          </button>
        </div>
      )}

      {/* Loading */}
      {loading && emails.length === 0 && (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-16 rounded-xl bg-zinc-900" />
          ))}
        </div>
      )}

      {/* Email List */}
      {!loading && emails.length === 0 && !error && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-10 flex flex-col items-center justify-center text-center">
          <div className="p-4 bg-zinc-800/50 rounded-2xl mb-4">
            <Inbox className="w-8 h-8 text-zinc-500" />
          </div>
          <h3 className="text-lg font-semibold text-zinc-200 mb-1">
            Inbox zero
          </h3>
          <p className="text-sm text-zinc-500 max-w-sm">
            No emails to show. Either the inbox is empty or Gmail is not
            connected through Composio.
          </p>
        </div>
      )}

      {emails.length > 0 && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden divide-y divide-zinc-800/50">
          {emails.map((email, i) => (
            <motion.button
              key={email.id}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: i * 0.02 }}
              onClick={() => setSelected(email)}
              className={`w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-zinc-800/40 transition-all duration-200 cursor-pointer ${
                email.isUnread ? "bg-zinc-800/20" : ""
              }`}
            >
              {/* Unread dot */}
              <div className="w-2 shrink-0">
                {email.isUnread && (
                  <div className="w-2 h-2 rounded-full bg-blue-500" />
                )}
              </div>

              {/* Avatar */}
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-xs font-bold ${
                  email.isUnread
                    ? "bg-indigo-500/20 text-indigo-300"
                    : "bg-zinc-800 text-zinc-400"
                }`}
              >
                {getInitial(email.from)}
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span
                    className={`text-sm truncate ${
                      email.isUnread
                        ? "font-semibold text-zinc-100"
                        : "font-medium text-zinc-300"
                    }`}
                  >
                    {extractName(email.from)}
                  </span>
                  <span className="text-[10px] text-zinc-600 shrink-0">
                    {formatEmailDate(email.date)}
                  </span>
                </div>
                <p
                  className={`text-xs truncate ${
                    email.isUnread ? "text-zinc-300" : "text-zinc-500"
                  }`}
                >
                  {email.subject}
                </p>
                <p className="text-[10px] text-zinc-600 truncate mt-0.5">
                  {email.snippet}
                </p>
              </div>

              <ChevronRight className="w-4 h-4 text-zinc-700 shrink-0" />
            </motion.button>
          ))}

          {/* Load more button */}
          {nextPageToken && (
            <button
              onClick={() => fetchEmails(nextPageToken)}
              disabled={loadingMore}
              className="w-full py-3 text-xs font-medium text-indigo-400 hover:text-indigo-300 hover:bg-zinc-800/50 transition-all cursor-pointer disabled:opacity-50"
            >
              {loadingMore
                ? "Loading..."
                : `Load more (${totalEstimate - emails.length}+ remaining)`}
            </button>
          )}
        </div>
      )}

      {/* Detail Side Panel */}
      <AnimatePresence>
        {selected && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex justify-end"
            onClick={() => setSelected(null)}
          >
            {/* Overlay */}
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

            {/* Panel */}
            <motion.div
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", damping: 30, stiffness: 300 }}
              onClick={(e) => e.stopPropagation()}
              className="relative w-full max-w-lg bg-zinc-950 border-l border-zinc-800 h-full overflow-y-auto"
            >
              <div className="p-6 space-y-4">
                {/* Close */}
                <div className="flex items-center justify-between">
                  <button
                    onClick={() => setSelected(null)}
                    className="p-2 rounded-lg hover:bg-zinc-800/60 text-zinc-500 hover:text-zinc-300 transition-all duration-200 cursor-pointer"
                    aria-label="Close email"
                  >
                    <X className="w-4 h-4" />
                  </button>
                  {selected.isUnread && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-blue-500/10 text-blue-400 border border-blue-500/20">
                      Unread
                    </span>
                  )}
                </div>

                {/* Subject */}
                <h2 className="text-lg font-bold text-zinc-100">
                  {selected.subject}
                </h2>

                {/* From / To */}
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-full bg-indigo-500/20 flex items-center justify-center text-xs font-bold text-indigo-300">
                      {getInitial(selected.from)}
                    </div>
                    <div>
                      <p className="text-sm font-medium text-zinc-200">
                        {extractName(selected.from)}
                      </p>
                      <p className="text-[10px] text-zinc-600">
                        {selected.from}
                      </p>
                    </div>
                    <span className="ml-auto text-[10px] text-zinc-600">
                      {selected.date
                        ? new Date(selected.date).toLocaleString("en-US", {
                            month: "short",
                            day: "numeric",
                            hour: "numeric",
                            minute: "2-digit",
                          })
                        : ""}
                    </span>
                  </div>
                </div>

                {/* Body / Snippet */}
                <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
                  <p className="text-sm text-zinc-300 leading-relaxed whitespace-pre-wrap">
                    {selected.snippet || "No preview available."}
                  </p>
                </div>

                {/* Open in Gmail */}
                <a
                  href={`https://mail.google.com/mail/u/0/#inbox/${selected.threadId || selected.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-100 font-medium px-4 py-2 rounded-xl transition-all duration-200 text-sm cursor-pointer"
                >
                  Open in Gmail
                  <ChevronRight className="w-3.5 h-3.5" />
                </a>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
