"use client";
import { useState } from "react";
import useSWR from "swr";
import { motion } from "framer-motion";
import { fetcher } from "@/lib/fetcher";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { DIMENSION_META, scoreColor } from "@/lib/health";
import type { Dimension } from "@/lib/health";
import {
  Users,
  Clock,
  AlertCircle,
  TrendingDown,
  Heart,
  Search,
  MessageSquare,
} from "lucide-react";

interface RelContact {
  handle: string;
  displayName?: string;
  relationship?: string;
  trustScore?: number;
  messageCount?: number;
  lastSeen?: string;
  daysSince?: number;
  current_mood?: string;
  personality_summary?: string;
  interests?: string[];
  social?: number;
  financial?: number;
  intellectual?: number;
  spiritual?: number;
  physical?: number;
  emotional?: number;
  overall_score?: number;
}

export default function WebPage() {
  const { data, isLoading: loading } = useSWR<{ contacts: RelContact[] }>(
    "/api/contacts?enriched=true",
    fetcher,
  );
  const contacts = data?.contacts || [];
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "reconnect" | "close" | "new">(
    "all",
  );

  const now = Date.now();
  const enriched = contacts.map((c) => ({
    ...c,
    daysSince: c.lastSeen
      ? Math.floor((now - new Date(c.lastSeen).getTime()) / 86400000)
      : 999,
  }));

  const reconnect = enriched
    .filter((c) => c.daysSince >= 7 && c.trustScore && c.trustScore > 0.3)
    .sort((a, b) => b.daysSince - a.daysSince);

  const close = enriched
    .filter((c) => (c.trustScore || 0) >= 0.7)
    .sort((a, b) => (b.trustScore || 0) - (a.trustScore || 0));

  const recent = enriched
    .filter((c) => c.daysSince < 3)
    .sort((a, b) => a.daysSince - b.daysSince);

  const filtered = search
    ? enriched.filter(
        (c) =>
          (c.displayName || "").toLowerCase().includes(search.toLowerCase()) ||
          c.handle.toLowerCase().includes(search.toLowerCase()),
      )
    : filter === "reconnect"
      ? reconnect
      : filter === "close"
        ? close
        : filter === "new"
          ? enriched.filter((c) => (c.messageCount || 0) <= 3)
          : enriched.sort((a, b) => a.daysSince - b.daysSince);

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8 space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <div className="w-6 h-6 rounded-md bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center">
            <Users className="w-3.5 h-3.5 text-indigo-400" />
          </div>
          <h1 className="text-2xl font-bold text-zinc-50 tracking-tight">
            WEB
          </h1>
        </div>
        <p className="text-zinc-500 text-sm">
          Your relationship intelligence layer. Every person who matters,
          organized and searchable.
        </p>
      </div>

      {/* Stats */}
      {!loading && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="grid grid-cols-4 gap-3"
        >
          {[
            {
              label: "Total contacts",
              value: contacts.length,
              icon: Users,
            },
            {
              label: "Need reconnecting",
              value: reconnect.length,
              icon: Clock,
              color: reconnect.length > 5 ? "#f59e0b" : "#22c55e",
            },
            {
              label: "Inner circle",
              value: close.length,
              icon: Heart,
            },
            {
              label: "Active this week",
              value: recent.length,
              icon: MessageSquare,
            },
          ].map((stat) => (
            <div
              key={stat.label}
              className="bg-zinc-900 border border-zinc-800 rounded-xl p-4"
            >
              <div className="flex items-center gap-2 mb-2">
                <stat.icon className="w-4 h-4 text-zinc-500" />
                <span className="text-[10px] font-semibold text-zinc-600 uppercase tracking-widest">
                  {stat.label}
                </span>
              </div>
              <span
                className="text-2xl font-bold"
                style={{ color: stat.color || "#e4e4e7" }}
              >
                {stat.value}
              </span>
            </div>
          ))}
        </motion.div>
      )}

      {/* Reconnect nudges */}
      {reconnect.length > 0 && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.1 }}
          className="bg-zinc-900/60 border border-amber-500/20 rounded-xl p-4"
        >
          <div className="flex items-center gap-2 mb-3">
            <AlertCircle className="w-4 h-4 text-amber-400" />
            <h2 className="text-sm font-semibold text-zinc-200">
              People to reconnect with
            </h2>
          </div>
          <div className="space-y-2">
            {reconnect.slice(0, 5).map((c) => (
              <div
                key={c.handle}
                className="flex items-center justify-between py-1.5"
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center text-xs font-bold text-zinc-400">
                    {(c.displayName || "?")[0].toUpperCase()}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-zinc-200">
                      {c.displayName || c.handle}
                    </p>
                    <p className="text-[11px] text-zinc-600">
                      {c.relationship || "Contact"}{" "}
                      {c.current_mood && `| ${c.current_mood}`}
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold text-amber-400">
                    {c.daysSince}d ago
                  </p>
                  {c.overall_score && (
                    <p className="text-[10px] text-zinc-600">
                      Health: {c.overall_score.toFixed(1)}/10
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </motion.div>
      )}

      {/* Search and filter */}
      <div className="flex items-center gap-3">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-600" />
          <input
            type="text"
            placeholder="Search contacts..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-zinc-900 border border-zinc-700 rounded-xl pl-10 pr-4 py-2.5 text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all duration-200"
          />
        </div>
        <div className="flex gap-1">
          {(
            [
              ["all", "All"],
              ["reconnect", "Reconnect"],
              ["close", "Inner circle"],
              ["new", "New"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setFilter(key)}
              className={`px-3 py-2 rounded-lg text-xs font-medium transition-all duration-200 cursor-pointer ${
                filter === key
                  ? "bg-indigo-500/10 text-indigo-300 border border-indigo-500/20"
                  : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/60"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Contact list */}
      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-20 rounded-xl bg-zinc-900" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12">
          <Users className="w-8 h-8 text-zinc-700 mx-auto mb-3" />
          <p className="text-sm text-zinc-500">No contacts found</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.slice(0, 30).map((c, i) => (
            <motion.div
              key={c.handle}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.03 }}
              className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 hover:border-zinc-700 transition-all duration-200 cursor-pointer"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center text-sm font-bold text-zinc-400">
                    {(c.displayName || "?")[0].toUpperCase()}
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-zinc-100">
                      {c.displayName || c.handle}
                    </p>
                    <div className="flex items-center gap-2 mt-0.5">
                      {c.relationship && (
                        <Badge
                          variant="outline"
                          className="text-[10px] py-0 border-zinc-700 text-zinc-500"
                        >
                          {c.relationship}
                        </Badge>
                      )}
                      {c.personality_summary && (
                        <span className="text-[11px] text-zinc-600 truncate max-w-[200px]">
                          {c.personality_summary}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="text-right space-y-1">
                  <div className="flex items-center gap-2 justify-end">
                    {c.trustScore !== undefined && (
                      <div className="flex items-center gap-1">
                        <Heart
                          className="w-3 h-3"
                          style={{
                            color: scoreColor(c.trustScore * 10),
                          }}
                        />
                        <span
                          className="text-xs font-semibold"
                          style={{
                            color: scoreColor(c.trustScore * 10),
                          }}
                        >
                          {(c.trustScore * 100).toFixed(0)}%
                        </span>
                      </div>
                    )}
                    <span className="text-xs text-zinc-600">
                      {c.daysSince === 0
                        ? "Today"
                        : c.daysSince === 1
                          ? "Yesterday"
                          : `${c.daysSince}d`}
                    </span>
                  </div>
                  {c.current_mood && (
                    <p className="text-[10px] text-zinc-600">
                      {c.current_mood}
                    </p>
                  )}
                </div>
              </div>
              {/* Health mini-bar */}
              {c.overall_score && (
                <div className="flex items-center gap-1.5 mt-3 pt-3 border-t border-zinc-800/50">
                  {(
                    [
                      "social",
                      "financial",
                      "intellectual",
                      "spiritual",
                      "physical",
                      "emotional",
                    ] as Dimension[]
                  ).map((dim) => {
                    const val = c[dim];
                    if (val === undefined || val === null) return null;
                    const meta = DIMENSION_META[dim];
                    return (
                      <div key={dim} className="flex items-center gap-0.5">
                        <div
                          className="w-1.5 h-1.5 rounded-full"
                          style={{ backgroundColor: meta.hex }}
                        />
                        <span className="text-[9px] text-zinc-600">
                          {val.toFixed(0)}
                        </span>
                      </div>
                    );
                  })}
                  <span className="text-[9px] text-zinc-600 ml-auto">
                    Overall: {c.overall_score.toFixed(1)}
                  </span>
                </div>
              )}
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}
