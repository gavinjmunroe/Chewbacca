"use client";
import useSWR from "swr";
import { fetcher } from "@/lib/fetcher";
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  DollarSign,
  TrendingUp,
  TrendingDown,
  PiggyBank,
  AlertCircle,
  ChevronRight,
  Send,
  RefreshCw,
  Shield,
  Target,
  Wallet,
} from "lucide-react";

interface FinancialSnapshot {
  financial_health_score: number;
  income_sources: Array<{ name: string; amount: number; type: string }>;
  monthly_burn: number;
  runway_months: number;
  debt_total: number;
  savings_rate: number;
  risk_signals: Array<{ signal: string; severity: "low" | "medium" | "high" }>;
  opportunities: Array<{ opportunity: string; impact: string }>;
}

export default function FiduciaryPage() {
  const { data: snapshot, isLoading: loading } = useSWR<FinancialSnapshot>(
    "/api/fiduciary",
    fetcher,
  );
  const [question, setQuestion] = useState("");
  const [advice, setAdvice] = useState("");
  const [adviceLoading, setAdviceLoading] = useState(false);
  const [tab, setTab] = useState<"overview" | "advisor" | "goals">("overview");

  async function askAdvisor() {
    if (!question.trim() || adviceLoading) return;
    setAdviceLoading(true);
    setAdvice("");
    try {
      const res = await fetch("/api/fiduciary/advice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: question.trim() }),
      });
      const data = await res.json();
      setAdvice(data.advice || "I need more context to give good advice here.");
    } catch {
      setAdvice("Something went wrong. Try again.");
    }
    setAdviceLoading(false);
    setQuestion("");
  }

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8 space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <div className="w-6 h-6 rounded-md bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center">
            <Shield className="w-3.5 h-3.5 text-emerald-400" />
          </div>
          <h1 className="text-2xl font-bold text-zinc-50 tracking-tight">
            FiduciaryOS
          </h1>
        </div>
        <p className="text-zinc-500 text-sm">
          Financial intelligence that always acts in your interest. Powered by
          Amber's health graph.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1">
        {(
          [
            ["overview", "Overview"],
            ["advisor", "Ask advisor"],
            ["goals", "Goals"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 cursor-pointer ${
              tab === key
                ? "bg-emerald-500/10 text-emerald-300 border border-emerald-500/20"
                : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/60"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Overview tab */}
      {tab === "overview" && (
        <>
          {loading ? (
            <div className="space-y-4">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-32 rounded-2xl bg-zinc-900" />
              ))}
            </div>
          ) : snapshot ? (
            <>
              {/* Score card */}
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-zinc-900 border rounded-2xl p-5"
                style={{
                  borderColor: "rgba(16,185,129,0.25)",
                  background:
                    "linear-gradient(135deg,rgba(16,185,129,0.07) 0%,transparent 60%)",
                }}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[10px] font-semibold text-zinc-600 uppercase tracking-widest mb-0.5">
                      Financial health
                    </p>
                    <div className="flex items-baseline gap-1.5">
                      <span className="text-4xl font-bold text-emerald-400">
                        {snapshot.financial_health_score.toFixed(1)}
                      </span>
                      <span className="text-zinc-600 text-lg">/10</span>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4 text-right">
                    <div>
                      <span className="text-lg font-bold text-zinc-100">
                        {snapshot.runway_months}mo
                      </span>
                      <p className="text-[10px] text-zinc-600">runway</p>
                    </div>
                    <div>
                      <span className="text-lg font-bold text-zinc-100">
                        {snapshot.savings_rate}%
                      </span>
                      <p className="text-[10px] text-zinc-600">savings rate</p>
                    </div>
                  </div>
                </div>
              </motion.div>

              {/* Income + burn */}
              <div className="grid grid-cols-2 gap-3">
                <motion.div
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.05 }}
                  className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5"
                >
                  <div className="flex items-center gap-2 mb-3">
                    <TrendingUp className="w-4 h-4 text-emerald-400" />
                    <span className="text-[10px] font-semibold text-zinc-600 uppercase tracking-widest">
                      Income sources
                    </span>
                  </div>
                  <div className="space-y-2">
                    {snapshot.income_sources.map((src, i) => (
                      <div
                        key={i}
                        className="flex items-center justify-between"
                      >
                        <div className="flex items-center gap-2">
                          <Wallet className="w-3 h-3 text-zinc-600" />
                          <span className="text-sm text-zinc-300">
                            {src.name}
                          </span>
                          <Badge
                            variant="outline"
                            className="text-[9px] py-0 border-zinc-700 text-zinc-600"
                          >
                            {src.type}
                          </Badge>
                        </div>
                        <span className="text-sm font-semibold text-emerald-400">
                          ${src.amount.toLocaleString()}
                        </span>
                      </div>
                    ))}
                  </div>
                </motion.div>
                <motion.div
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.1 }}
                  className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5"
                >
                  <div className="flex items-center gap-2 mb-3">
                    <TrendingDown className="w-4 h-4 text-rose-400" />
                    <span className="text-[10px] font-semibold text-zinc-600 uppercase tracking-widest">
                      Monthly expenses
                    </span>
                  </div>
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-3xl font-bold text-zinc-100">
                      ${snapshot.monthly_burn.toLocaleString()}
                    </span>
                    <span className="text-zinc-600 text-sm">/month</span>
                  </div>
                  {snapshot.debt_total > 0 && (
                    <div className="mt-3 pt-3 border-t border-zinc-800/50">
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-zinc-600">
                          Total debt
                        </span>
                        <span className="text-sm font-semibold text-rose-400">
                          ${snapshot.debt_total.toLocaleString()}
                        </span>
                      </div>
                    </div>
                  )}
                </motion.div>
              </div>

              {/* Risk signals */}
              {snapshot.risk_signals.length > 0 && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.15 }}
                  className="bg-zinc-900/60 border border-amber-500/20 rounded-xl p-4"
                >
                  <div className="flex items-center gap-2 mb-3">
                    <AlertCircle className="w-4 h-4 text-amber-400" />
                    <h2 className="text-sm font-semibold text-zinc-200">
                      Risk signals
                    </h2>
                  </div>
                  <div className="space-y-2">
                    {snapshot.risk_signals.map((sig, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <div
                          className={`w-2 h-2 rounded-full ${
                            sig.severity === "high"
                              ? "bg-rose-400"
                              : sig.severity === "medium"
                                ? "bg-amber-400"
                                : "bg-zinc-500"
                          }`}
                        />
                        <span className="text-sm text-zinc-300">
                          {sig.signal}
                        </span>
                      </div>
                    ))}
                  </div>
                </motion.div>
              )}

              {/* Opportunities */}
              {snapshot.opportunities.length > 0 && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.2 }}
                  className="bg-zinc-900/60 border border-emerald-500/20 rounded-xl p-4"
                >
                  <div className="flex items-center gap-2 mb-3">
                    <Target className="w-4 h-4 text-emerald-400" />
                    <h2 className="text-sm font-semibold text-zinc-200">
                      Opportunities
                    </h2>
                  </div>
                  <div className="space-y-2">
                    {snapshot.opportunities.map((opp, i) => (
                      <div key={i} className="flex items-start gap-2">
                        <ChevronRight className="w-3.5 h-3.5 text-emerald-400 mt-0.5 shrink-0" />
                        <div>
                          <p className="text-sm text-zinc-300">
                            {opp.opportunity}
                          </p>
                          <p className="text-[11px] text-zinc-600">
                            {opp.impact}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </motion.div>
              )}
            </>
          ) : (
            <div className="text-center py-16">
              <PiggyBank className="w-8 h-8 text-zinc-700 mx-auto mb-3" />
              <p className="text-sm text-zinc-500">No financial data yet</p>
              <p className="text-xs text-zinc-600 mt-1">
                Tell Amber about your income and expenses to get started.
              </p>
            </div>
          )}
        </>
      )}

      {/* Advisor tab */}
      {tab === "advisor" && (
        <div className="space-y-4">
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5"
          >
            <div className="flex items-center gap-2 mb-4">
              <Shield className="w-4 h-4 text-emerald-400" />
              <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-widest">
                Fiduciary AI advisor
              </h2>
            </div>
            <p className="text-sm text-zinc-400 mb-4">
              Ask any financial question. FiduciaryOS is legally obligated to
              act in your interest, not sell you products.
            </p>
            <div className="flex items-center gap-3">
              <input
                type="text"
                placeholder="Should I invest in index funds or pay off student loans first?"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && askAdvisor()}
                className="flex-1 bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-sm text-white placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all duration-200"
              />
              <button
                onClick={askAdvisor}
                disabled={adviceLoading || !question.trim()}
                className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold px-5 py-3 rounded-xl transition-all duration-200 cursor-pointer"
              >
                {adviceLoading ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <Send className="w-4 h-4" />
                )}
              </button>
            </div>
            <AnimatePresence>
              {advice && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="mt-4 p-4 bg-zinc-800/60 rounded-xl border border-emerald-500/10"
                >
                  <div className="flex items-center gap-2 mb-2">
                    <Shield className="w-3.5 h-3.5 text-emerald-400" />
                    <span className="text-[10px] font-semibold text-emerald-400 uppercase tracking-widest">
                      Fiduciary advice
                    </span>
                  </div>
                  <p className="text-sm text-zinc-300 leading-relaxed whitespace-pre-wrap">
                    {advice}
                  </p>
                  <p className="text-[10px] text-zinc-600 mt-3">
                    This advice is generated by AI acting under fiduciary
                    principles. It is not a substitute for a licensed financial
                    advisor for major financial decisions.
                  </p>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>

          {/* Quick questions */}
          <div className="grid grid-cols-2 gap-2">
            {[
              "How should I budget as a college student?",
              "Is my savings rate good enough?",
              "Should I start investing now?",
              "How do I negotiate my consulting rate?",
              "Tax tips for freelance income",
              "Emergency fund: how much do I need?",
            ].map((q) => (
              <button
                key={q}
                onClick={() => {
                  setQuestion(q);
                }}
                className="text-left p-3 bg-zinc-900 border border-zinc-800 rounded-xl text-xs text-zinc-400 hover:text-zinc-200 hover:border-zinc-700 transition-all duration-200 cursor-pointer"
              >
                {q}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Goals tab */}
      {tab === "goals" && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5"
        >
          <div className="flex items-center gap-2 mb-4">
            <Target className="w-4 h-4 text-emerald-400" />
            <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-widest">
              Financial goals
            </h2>
          </div>
          <p className="text-sm text-zinc-500 mb-6">
            Tell Amber your financial goals through iMessage and they will
            appear here with progress tracking.
          </p>
          <div className="space-y-3">
            {[
              {
                goal: "Build 3-month emergency fund",
                progress: 40,
                target: "$5,000",
              },
              {
                goal: "Pay off any outstanding debt",
                progress: 100,
                target: "$0",
              },
              {
                goal: "Start investing $100/month",
                progress: 0,
                target: "$1,200/yr",
              },
            ].map((g, i) => (
              <div
                key={i}
                className="bg-zinc-800/50 rounded-xl p-4 border border-zinc-800"
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-zinc-200">
                    {g.goal}
                  </span>
                  <span className="text-xs text-zinc-500">{g.target}</span>
                </div>
                <div className="w-full h-2 bg-zinc-800 rounded-full overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${g.progress}%` }}
                    transition={{ duration: 0.8, delay: i * 0.1 }}
                    className="h-full rounded-full"
                    style={{
                      backgroundColor:
                        g.progress === 100
                          ? "#22c55e"
                          : g.progress > 0
                            ? "#6366f1"
                            : "#3f3f46",
                    }}
                  />
                </div>
                <p className="text-[10px] text-zinc-600 mt-1">
                  {g.progress}% complete
                </p>
              </div>
            ))}
          </div>
        </motion.div>
      )}
    </div>
  );
}
