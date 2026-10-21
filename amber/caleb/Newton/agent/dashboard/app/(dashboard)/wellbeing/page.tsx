"use client";
import { motion } from "framer-motion";
import useSWR from "swr";
import { fetcher } from "@/lib/fetcher";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import dynamic from "next/dynamic";

const EmotionalChart = dynamic(
  () => import("@/components/dashboard/EmotionalChart"),
  {
    ssr: false,
    loading: () => <Skeleton className="h-[200px] rounded-2xl bg-zinc-900" />,
  },
);
import {
  Brain,
  Heart,
  TrendingDown,
  TrendingUp,
  AlertTriangle,
  Smile,
  Frown,
  Activity,
} from "lucide-react";

interface WellbeingData {
  emotional_trend: Array<{ date: string; score: number }>;
  spiritual_trend: Array<{ date: string; score: number }>;
  current_emotional: number;
  current_spiritual: number;
  mood_patterns: Array<{ mood: string; count: number; dimension: string }>;
  risk_signals: Array<{
    signal: string;
    severity: "low" | "medium" | "high";
    dimension: string;
  }>;
  positive_signals: Array<{ signal: string; dimension: string }>;
  sleep_pattern?: string;
  social_withdrawal_risk: boolean;
  cognitive_notes: string[];
}

export default function WellbeingPage() {
  const { data, isLoading: loading } = useSWR<WellbeingData>(
    "/api/wellbeing",
    fetcher,
  );

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8 space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <div className="w-6 h-6 rounded-md bg-rose-500/20 border border-rose-500/30 flex items-center justify-center">
            <Brain className="w-3.5 h-3.5 text-rose-400" />
          </div>
          <h1 className="text-2xl font-bold text-zinc-50 tracking-tight">
            Wellbeing
          </h1>
        </div>
        <p className="text-zinc-500 text-sm">
          Mental and emotional health tracking. Patterns your physical sensors
          can't see.
        </p>
      </div>

      {loading ? (
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-40 rounded-2xl bg-zinc-900" />
          ))}
        </div>
      ) : data ? (
        <>
          {/* Current state */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className="grid grid-cols-2 gap-3"
          >
            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5">
              <div className="flex items-center gap-2 mb-3">
                <Heart className="w-4 h-4 text-sky-400" />
                <span className="text-[10px] font-semibold text-zinc-600 uppercase tracking-widest">
                  Emotional
                </span>
              </div>
              <div className="flex items-baseline gap-1.5">
                <span className="text-3xl font-bold text-sky-400">
                  {data.current_emotional.toFixed(1)}
                </span>
                <span className="text-zinc-600 text-lg">/10</span>
              </div>
              {data.emotional_trend.length > 1 && (
                <div className="flex items-center gap-1 mt-2">
                  {data.emotional_trend[data.emotional_trend.length - 1].score >
                  data.emotional_trend[data.emotional_trend.length - 2]
                    .score ? (
                    <>
                      <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
                      <span className="text-[11px] text-emerald-400">
                        Trending up
                      </span>
                    </>
                  ) : (
                    <>
                      <TrendingDown className="w-3.5 h-3.5 text-amber-400" />
                      <span className="text-[11px] text-amber-400">
                        Watch this
                      </span>
                    </>
                  )}
                </div>
              )}
            </div>
            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5">
              <div className="flex items-center gap-2 mb-3">
                <Activity className="w-4 h-4 text-amber-400" />
                <span className="text-[10px] font-semibold text-zinc-600 uppercase tracking-widest">
                  Spiritual
                </span>
              </div>
              <div className="flex items-baseline gap-1.5">
                <span className="text-3xl font-bold text-amber-400">
                  {data.current_spiritual.toFixed(1)}
                </span>
                <span className="text-zinc-600 text-lg">/10</span>
              </div>
            </div>
          </motion.div>

          {/* Risk signals */}
          {data.risk_signals.length > 0 && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.1 }}
              className="bg-zinc-900/60 border border-rose-500/20 rounded-xl p-4"
            >
              <div className="flex items-center gap-2 mb-3">
                <AlertTriangle className="w-4 h-4 text-rose-400" />
                <h2 className="text-sm font-semibold text-zinc-200">
                  Signals to watch
                </h2>
              </div>
              <div className="space-y-2">
                {data.risk_signals.map((signal, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between py-1.5"
                  >
                    <div className="flex items-center gap-2">
                      <div
                        className={`w-2 h-2 rounded-full ${
                          signal.severity === "high"
                            ? "bg-rose-400"
                            : signal.severity === "medium"
                              ? "bg-amber-400"
                              : "bg-zinc-500"
                        }`}
                      />
                      <span className="text-sm text-zinc-300">
                        {signal.signal}
                      </span>
                    </div>
                    <Badge
                      variant="outline"
                      className="text-[9px] py-0 border-zinc-700 text-zinc-500"
                    >
                      {signal.dimension}
                    </Badge>
                  </div>
                ))}
              </div>
            </motion.div>
          )}

          {/* Positive signals */}
          {data.positive_signals.length > 0 && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.15 }}
              className="bg-zinc-900/60 border border-emerald-500/20 rounded-xl p-4"
            >
              <div className="flex items-center gap-2 mb-3">
                <Smile className="w-4 h-4 text-emerald-400" />
                <h2 className="text-sm font-semibold text-zinc-200">
                  Bright spots
                </h2>
              </div>
              <div className="space-y-2">
                {data.positive_signals.map((signal, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between py-1.5"
                  >
                    <span className="text-sm text-zinc-300">
                      {signal.signal}
                    </span>
                    <Badge
                      variant="outline"
                      className="text-[9px] py-0 border-emerald-500/20 text-emerald-400"
                    >
                      {signal.dimension}
                    </Badge>
                  </div>
                ))}
              </div>
            </motion.div>
          )}

          {/* Emotional trend chart */}
          {data.emotional_trend.length > 2 && (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5"
            >
              <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-widest mb-4">
                Emotional trend (30d)
              </h2>
              <EmotionalChart data={data.emotional_trend} />
            </motion.div>
          )}

          {/* Cognitive notes */}
          {data.cognitive_notes.length > 0 && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.25 }}
              className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5"
            >
              <div className="flex items-center gap-2 mb-3">
                <Brain className="w-4 h-4 text-violet-400" />
                <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-widest">
                  Cognitive patterns
                </h2>
              </div>
              <div className="space-y-2">
                {data.cognitive_notes.map((note, i) => (
                  <p key={i} className="text-sm text-zinc-400">
                    {note}
                  </p>
                ))}
              </div>
            </motion.div>
          )}

          {/* Social withdrawal warning */}
          {data.social_withdrawal_risk && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.3 }}
              className="flex items-start gap-2.5 bg-zinc-900/60 border border-rose-500/30 rounded-xl px-4 py-3"
            >
              <Frown className="w-4 h-4 text-rose-400 mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-medium text-zinc-200">
                  Social withdrawal detected
                </p>
                <p className="text-xs text-zinc-500 mt-0.5">
                  Your social interaction frequency has dropped. Consider
                  reaching out to someone in your inner circle.
                </p>
              </div>
            </motion.div>
          )}
        </>
      ) : (
        <div className="text-center py-16">
          <Brain className="w-8 h-8 text-zinc-700 mx-auto mb-3" />
          <p className="text-sm text-zinc-500">No wellbeing data yet</p>
          <p className="text-xs text-zinc-600 mt-1">
            Complete a few health check-ins to see patterns.
          </p>
        </div>
      )}
    </div>
  );
}
