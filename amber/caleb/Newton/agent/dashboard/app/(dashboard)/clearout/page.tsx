"use client";
import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Mail,
  Send,
  Archive,
  Star,
  Clock,
  AlertCircle,
  ArrowRight,
  RefreshCw,
  Inbox,
} from "lucide-react";

interface Email {
  id: string;
  from: string;
  subject: string;
  snippet: string;
  date: string;
  labels: string[];
  isRead: boolean;
  priority: "high" | "medium" | "low";
  suggestedAction?: string;
}

export default function ClearOutPage() {
  const [emails, setEmails] = useState<Email[]>([]);
  const [loading, setLoading] = useState(true);
  const [command, setCommand] = useState("");
  const [commandResult, setCommandResult] = useState("");
  const [processing, setProcessing] = useState(false);
  const [filter, setFilter] = useState<
    "all" | "action" | "starred" | "waiting"
  >("all");

  useEffect(() => {
    fetchEmails();
  }, []);

  async function fetchEmails() {
    setLoading(true);
    try {
      const res = await fetch("/api/clearout");
      const data = await res.json();
      setEmails(data.emails || []);
    } catch {
      setEmails([]);
    }
    setLoading(false);
  }

  async function handleCommand() {
    if (!command.trim() || processing) return;
    setProcessing(true);
    setCommandResult("");
    try {
      const res = await fetch("/api/clearout/command", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: command.trim() }),
      });
      const data = await res.json();
      setCommandResult(data.result || "Done.");
      if (data.refreshInbox) await fetchEmails();
    } catch {
      setCommandResult("Something went wrong. Try again.");
    }
    setProcessing(false);
    setCommand("");
  }

  const actionNeeded = emails.filter((e) => e.priority === "high" && !e.isRead);
  const waiting = emails.filter((e) =>
    e.suggestedAction?.includes("follow up"),
  );

  const filtered =
    filter === "action"
      ? actionNeeded
      : filter === "starred"
        ? emails.filter((e) => e.labels.includes("STARRED"))
        : filter === "waiting"
          ? waiting
          : emails;

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8 space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <div className="w-6 h-6 rounded-md bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center">
            <Mail className="w-3.5 h-3.5 text-emerald-400" />
          </div>
          <h1 className="text-2xl font-bold text-zinc-50 tracking-tight">
            ClearOut
          </h1>
        </div>
        <p className="text-zinc-500 text-sm">
          Talk to your inbox. Respond, skip, search, and triage through
          conversation.
        </p>
      </div>

      {/* Command bar */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4"
      >
        <div className="flex items-center gap-3">
          <div className="flex-1 relative">
            <input
              type="text"
              placeholder='Try: "respond to Sagar saying thanks" or "show me emails from this week"'
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCommand()}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-sm text-white placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all duration-200"
            />
          </div>
          <button
            onClick={handleCommand}
            disabled={processing || !command.trim()}
            className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold px-5 py-3 rounded-xl transition-all duration-200 cursor-pointer flex items-center gap-2"
          >
            {processing ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
          </button>
        </div>
        <AnimatePresence>
          {commandResult && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="mt-3 p-3 bg-zinc-800/60 rounded-lg border border-zinc-700/50"
            >
              <p className="text-sm text-zinc-300">{commandResult}</p>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

      {/* Stats */}
      {!loading && (
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <Inbox className="w-4 h-4 text-zinc-500" />
              <span className="text-[10px] font-semibold text-zinc-600 uppercase tracking-widest">
                Inbox
              </span>
            </div>
            <span className="text-2xl font-bold text-zinc-100">
              {emails.length}
            </span>
          </div>
          <div className="bg-zinc-900 border border-amber-500/20 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <AlertCircle className="w-4 h-4 text-amber-400" />
              <span className="text-[10px] font-semibold text-zinc-600 uppercase tracking-widest">
                Action needed
              </span>
            </div>
            <span className="text-2xl font-bold text-amber-400">
              {actionNeeded.length}
            </span>
          </div>
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <Clock className="w-4 h-4 text-zinc-500" />
              <span className="text-[10px] font-semibold text-zinc-600 uppercase tracking-widest">
                Waiting on reply
              </span>
            </div>
            <span className="text-2xl font-bold text-zinc-100">
              {waiting.length}
            </span>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-1">
        {(
          [
            ["all", "All"],
            ["action", "Action needed"],
            ["starred", "Starred"],
            ["waiting", "Waiting"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            className={`px-3 py-2 rounded-lg text-xs font-medium transition-all duration-200 cursor-pointer ${
              filter === key
                ? "bg-emerald-500/10 text-emerald-300 border border-emerald-500/20"
                : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/60"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Email list */}
      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-20 rounded-xl bg-zinc-900" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16">
          <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center mx-auto mb-3">
            <Mail className="w-6 h-6 text-emerald-400" />
          </div>
          <p className="text-zinc-400 font-medium text-sm">Inbox zero.</p>
          <p className="text-zinc-600 text-xs mt-1">
            Nothing here needs your attention right now.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((email, i) => (
            <motion.div
              key={email.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.03 }}
              className={`bg-zinc-900 border rounded-xl p-4 hover:border-zinc-600 transition-all duration-200 cursor-pointer ${
                email.priority === "high"
                  ? "border-amber-500/30"
                  : "border-zinc-800"
              } ${!email.isRead ? "bg-zinc-900" : "bg-zinc-950/50"}`}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <p
                      className={`text-sm font-semibold truncate ${!email.isRead ? "text-zinc-100" : "text-zinc-400"}`}
                    >
                      {email.from}
                    </p>
                    {email.priority === "high" && (
                      <Badge className="text-[9px] bg-amber-500/10 text-amber-400 border-amber-500/20 py-0">
                        Urgent
                      </Badge>
                    )}
                    {email.labels.includes("STARRED") && (
                      <Star className="w-3 h-3 text-amber-400 fill-amber-400" />
                    )}
                  </div>
                  <p
                    className={`text-sm truncate ${!email.isRead ? "text-zinc-200" : "text-zinc-500"}`}
                  >
                    {email.subject}
                  </p>
                  <p className="text-xs text-zinc-600 truncate mt-0.5">
                    {email.snippet}
                  </p>
                </div>
                <div className="text-right ml-4 shrink-0">
                  <p className="text-[11px] text-zinc-600">{email.date}</p>
                  {email.suggestedAction && (
                    <div className="flex items-center gap-1 mt-1 justify-end">
                      <ArrowRight className="w-3 h-3 text-emerald-400" />
                      <span className="text-[10px] text-emerald-400">
                        {email.suggestedAction}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}
