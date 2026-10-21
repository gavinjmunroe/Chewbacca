"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Calendar as CalendarIcon,
  Clock,
  MapPin,
  AlertCircle,
  Inbox,
  RefreshCw,
} from "lucide-react";

interface CalendarEvent {
  id: string;
  summary: string;
  start: string;
  end: string;
  location?: string;
  dimension: string;
  dimensionColor: string;
}

interface CalendarData {
  today: CalendarEvent[];
  week: CalendarEvent[];
  date: string;
}

function formatTime(iso: string): string {
  if (!iso || !iso.includes("T")) return "All day";
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function formatDayLabel(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function isCurrentEvent(start: string, end: string): boolean {
  const now = new Date();
  return new Date(start) <= now && now <= new Date(end);
}

export default function CalendarPage() {
  const [data, setData] = useState<CalendarData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingWeek, setLoadingWeek] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load today fast, then lazy-load the week
  async function fetchToday() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/calendar?range=today");
      if (!res.ok) throw new Error("Failed to load calendar");
      const json = await res.json();
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  async function fetchWeek() {
    setLoadingWeek(true);
    try {
      const res = await fetch("/api/calendar?range=week");
      if (!res.ok) return;
      const json = await res.json();
      setData((prev) => (prev ? { ...prev, week: json.week } : json));
    } catch {
      // Non-fatal, today is already loaded
    } finally {
      setLoadingWeek(false);
    }
  }

  useEffect(() => {
    fetchToday().then(() => fetchWeek());
  }, []);

  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-indigo-500/10 rounded-xl">
            <CalendarIcon className="w-5 h-5 text-indigo-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-zinc-50 tracking-tight">
              Calendar
            </h1>
            <p className="text-xs text-zinc-500">{today}</p>
          </div>
        </div>
        <button
          onClick={() => {
            fetchToday().then(() => fetchWeek());
          }}
          disabled={loading}
          className="p-2 rounded-lg hover:bg-zinc-800/60 text-zinc-500 hover:text-zinc-300 transition-all duration-200 cursor-pointer disabled:opacity-50"
          aria-label="Refresh calendar"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 flex items-center gap-3">
          <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
          <p className="text-sm text-red-300">{error}</p>
          <button
            onClick={() => {
              fetchToday().then(() => fetchWeek());
            }}
            className="ml-auto text-xs text-red-400 hover:text-red-300 font-medium cursor-pointer"
          >
            Retry
          </button>
        </div>
      )}

      {/* Loading */}
      {loading && !data && (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-16 rounded-2xl bg-zinc-900" />
          ))}
        </div>
      )}

      {/* Today's Events */}
      {!loading && data && (
        <>
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-3"
          >
            <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-widest">
              Today
            </h2>
            {data.today.length === 0 ? (
              <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-8 flex flex-col items-center justify-center text-center">
                <div className="p-3 bg-zinc-800/50 rounded-2xl mb-3">
                  <Inbox className="w-6 h-6 text-zinc-500" />
                </div>
                <p className="text-sm font-medium text-zinc-300">
                  Nothing on the calendar today
                </p>
                <p className="text-xs text-zinc-600 mt-1">
                  Clear day. Use it well.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {data.today.map((event, i) => {
                  const isCurrent = isCurrentEvent(event.start, event.end);
                  return (
                    <motion.div
                      key={event.id}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.05 }}
                      className={`bg-zinc-900 border rounded-2xl p-4 transition-all duration-200 hover:border-zinc-700 ${
                        isCurrent
                          ? "border-indigo-500/40 bg-indigo-500/5"
                          : "border-zinc-800"
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        {/* Time column */}
                        <div className="w-16 shrink-0 pt-0.5">
                          <p className="text-xs font-semibold text-zinc-300">
                            {formatTime(event.start)}
                          </p>
                          {event.end && event.start.includes("T") && (
                            <p className="text-[10px] text-zinc-600">
                              {formatTime(event.end)}
                            </p>
                          )}
                        </div>

                        {/* Divider */}
                        <div className="flex flex-col items-center gap-1 pt-1">
                          <div
                            className="w-2 h-2 rounded-full shrink-0"
                            style={{ backgroundColor: event.dimensionColor }}
                          />
                          <div className="w-px flex-1 bg-zinc-800" />
                        </div>

                        {/* Content */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-medium text-zinc-100 truncate">
                              {event.summary}
                            </p>
                            {isCurrent && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                                Now
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-3 mt-1">
                            <span
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border"
                              style={{
                                backgroundColor: `${event.dimensionColor}10`,
                                color: event.dimensionColor,
                                borderColor: `${event.dimensionColor}30`,
                              }}
                            >
                              {event.dimension}
                            </span>
                            {event.location && (
                              <span className="flex items-center gap-1 text-[10px] text-zinc-600">
                                <MapPin className="w-3 h-3" />
                                <span className="truncate max-w-[120px]">
                                  {event.location}
                                </span>
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Duration */}
                        {event.start.includes("T") &&
                          event.end.includes("T") && (
                            <div className="flex items-center gap-1 text-[10px] text-zinc-600 shrink-0">
                              <Clock className="w-3 h-3" />
                              {Math.round(
                                (new Date(event.end).getTime() -
                                  new Date(event.start).getTime()) /
                                  60000,
                              )}
                              m
                            </div>
                          )}
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            )}
          </motion.div>

          {/* Week Ahead */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
            className="space-y-3"
          >
            <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-widest">
              This Week
            </h2>
            {data.week.length === 0 ? (
              <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 text-center">
                <p className="text-sm text-zinc-500">
                  No upcoming events this week.
                </p>
              </div>
            ) : (
              <div className="bg-zinc-900 border border-zinc-800 rounded-2xl divide-y divide-zinc-800/50">
                {data.week.map((event, i) => (
                  <motion.div
                    key={event.id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.2 + i * 0.03 }}
                    className="px-4 py-3 flex items-center gap-3 hover:bg-zinc-800/30 transition-all duration-200"
                  >
                    <div
                      className="w-1.5 h-1.5 rounded-full shrink-0"
                      style={{ backgroundColor: event.dimensionColor }}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-zinc-200 truncate">
                        {event.summary}
                      </p>
                    </div>
                    <span className="text-[10px] text-zinc-600 shrink-0">
                      {formatDayLabel(event.start)}
                    </span>
                    <span className="text-[10px] text-zinc-600 shrink-0">
                      {formatTime(event.start)}
                    </span>
                  </motion.div>
                ))}
              </div>
            )}
          </motion.div>

          {/* Dimension Legend */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.3 }}
            className="flex flex-wrap gap-3 justify-center py-2"
          >
            {[
              { label: "Physical", color: "#f97316" },
              { label: "Spiritual", color: "#a855f7" },
              { label: "Financial", color: "#22c55e" },
              { label: "Intellectual", color: "#3b82f6" },
              { label: "Social", color: "#ec4899" },
              { label: "Emotional", color: "#eab308" },
            ].map(({ label, color }) => (
              <span
                key={label}
                className="flex items-center gap-1.5 text-[10px] text-zinc-500"
              >
                <span
                  className="w-1.5 h-1.5 rounded-full"
                  style={{ backgroundColor: color }}
                />
                {label}
              </span>
            ))}
          </motion.div>
        </>
      )}
    </div>
  );
}
