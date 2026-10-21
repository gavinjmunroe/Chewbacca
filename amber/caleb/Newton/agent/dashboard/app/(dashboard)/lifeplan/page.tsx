"use client";
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Badge } from "@/components/ui/badge";
import {
  Compass,
  Target,
  Zap,
  ChevronRight,
  RefreshCw,
  Sparkles,
  BookOpen,
  Briefcase,
  Heart,
  Users,
} from "lucide-react";

interface LifePlanResult {
  personality: {
    traits: string[];
    strengths: string[];
    growth_areas: string[];
    mbti_estimate?: string;
  };
  career: {
    current_path: string;
    alignment_score: number;
    suggestions: string[];
    skills_to_develop: string[];
  };
  life_plan: {
    short_term: string[];
    medium_term: string[];
    long_term: string[];
    theme: string;
  };
  coaching_insight: string;
}

const QUIZ_QUESTIONS = [
  {
    q: "What activity makes you lose track of time?",
    icon: Zap,
    placeholder: "Building things, reading, sports, deep conversation...",
  },
  {
    q: "What matters more to you: impact or security?",
    icon: Target,
    placeholder: "Be honest. There's no wrong answer.",
  },
  {
    q: "Describe your ideal Tuesday in 5 years.",
    icon: Compass,
    placeholder: "Where are you? What are you doing? Who's with you?",
  },
  {
    q: "What's one thing you'd regret not trying?",
    icon: Sparkles,
    placeholder: "The thing that scares you and excites you at the same time.",
  },
  {
    q: "How do you recharge: alone or with people?",
    icon: Users,
    placeholder: "Introvert, extrovert, or depends on the day?",
  },
];

export default function LifePlanPage() {
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<string[]>(() =>
    Array(QUIZ_QUESTIONS.length).fill(""),
  );
  const [result, setResult] = useState<LifePlanResult | null>(null);
  const [loading, setLoading] = useState(false);

  async function generatePlan() {
    setLoading(true);
    try {
      const res = await fetch("/api/lifeplan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers }),
      });
      const data = await res.json();
      setResult(data);
    } catch {
      // Handle error
    }
    setLoading(false);
  }

  const isQuiz = !result && !loading;
  const currentQ = QUIZ_QUESTIONS[step];

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <div className="w-6 h-6 rounded-md bg-violet-500/20 border border-violet-500/30 flex items-center justify-center">
            <Compass className="w-3.5 h-3.5 text-violet-400" />
          </div>
          <h1 className="text-2xl font-bold text-zinc-50 tracking-tight">
            LifePlan
          </h1>
        </div>
        <p className="text-zinc-500 text-sm">
          Map your personality, values, and goals into a structured path
          forward.
        </p>
      </div>

      {/* Quiz */}
      {isQuiz && (
        <div className="space-y-6">
          {/* Progress */}
          <div className="flex items-center gap-2">
            {QUIZ_QUESTIONS.map((_, i) => (
              <div
                key={i}
                className={`h-1 flex-1 rounded-full transition-all duration-300 ${
                  i < step
                    ? "bg-violet-500"
                    : i === step
                      ? "bg-violet-400/50"
                      : "bg-zinc-800"
                }`}
              />
            ))}
          </div>

          {/* Question */}
          <AnimatePresence mode="wait">
            <motion.div
              key={step}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6"
            >
              <div className="flex items-center gap-2 mb-4">
                <div className="w-8 h-8 rounded-lg bg-violet-500/10 border border-violet-500/20 flex items-center justify-center">
                  <currentQ.icon className="w-4 h-4 text-violet-400" />
                </div>
                <span className="text-[10px] font-semibold text-zinc-600 uppercase tracking-widest">
                  Question {step + 1} of {QUIZ_QUESTIONS.length}
                </span>
              </div>
              <h2 className="text-lg font-semibold text-zinc-100 mb-4">
                {currentQ.q}
              </h2>
              <textarea
                value={answers[step]}
                onChange={(e) => {
                  const next = [...answers];
                  next[step] = e.target.value;
                  setAnswers(next);
                }}
                placeholder={currentQ.placeholder}
                rows={3}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-sm text-white placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent transition-all duration-200 resize-none"
              />
              <div className="flex justify-between mt-4">
                <button
                  onClick={() => setStep(Math.max(0, step - 1))}
                  disabled={step === 0}
                  className="px-4 py-2 rounded-lg text-sm font-medium text-zinc-500 hover:text-zinc-300 disabled:opacity-30 transition-all duration-200 cursor-pointer"
                >
                  Back
                </button>
                {step < QUIZ_QUESTIONS.length - 1 ? (
                  <button
                    onClick={() => setStep((prev) => prev + 1)}
                    disabled={!answers[step].trim()}
                    className="bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white font-semibold px-5 py-2 rounded-xl transition-all duration-200 cursor-pointer flex items-center gap-1.5"
                  >
                    Next
                    <ChevronRight className="w-4 h-4" />
                  </button>
                ) : (
                  <button
                    onClick={generatePlan}
                    disabled={!answers[step].trim()}
                    className="bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white font-semibold px-5 py-2 rounded-xl transition-all duration-200 cursor-pointer flex items-center gap-1.5"
                  >
                    Generate my plan
                    <Sparkles className="w-4 h-4" />
                  </button>
                )}
              </div>
            </motion.div>
          </AnimatePresence>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="text-center py-20"
        >
          <RefreshCw className="w-8 h-8 text-violet-400 animate-spin mx-auto mb-4" />
          <p className="text-sm text-zinc-400">
            Analyzing your personality and mapping your path...
          </p>
        </motion.div>
      )}

      {/* Results */}
      {result && (
        <div className="space-y-4">
          {/* Personality */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5"
          >
            <div className="flex items-center gap-2 mb-4">
              <Heart className="w-4 h-4 text-rose-400" />
              <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-widest">
                Your personality
              </h2>
              {result.personality.mbti_estimate && (
                <Badge className="text-[10px] bg-violet-500/10 text-violet-400 border-violet-500/20 py-0">
                  {result.personality.mbti_estimate}
                </Badge>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5 mb-3">
              {result.personality.traits.map((t) => (
                <Badge
                  key={t}
                  variant="outline"
                  className="text-xs border-zinc-700 text-zinc-300"
                >
                  {t}
                </Badge>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-4 mt-4">
              <div>
                <p className="text-[10px] font-semibold text-emerald-400 uppercase tracking-widest mb-2">
                  Strengths
                </p>
                {result.personality.strengths.map((s) => (
                  <p key={s} className="text-sm text-zinc-400 py-0.5">
                    {s}
                  </p>
                ))}
              </div>
              <div>
                <p className="text-[10px] font-semibold text-amber-400 uppercase tracking-widest mb-2">
                  Growth areas
                </p>
                {result.personality.growth_areas.map((g) => (
                  <p key={g} className="text-sm text-zinc-400 py-0.5">
                    {g}
                  </p>
                ))}
              </div>
            </div>
          </motion.div>

          {/* Career alignment */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5"
          >
            <div className="flex items-center gap-2 mb-4">
              <Briefcase className="w-4 h-4 text-emerald-400" />
              <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-widest">
                Career alignment
              </h2>
              <span className="ml-auto text-lg font-bold text-emerald-400">
                {result.career.alignment_score}%
              </span>
            </div>
            <p className="text-sm text-zinc-300 mb-3">
              {result.career.current_path}
            </p>
            <div className="space-y-1.5">
              {result.career.suggestions.map((s, i) => (
                <div key={i} className="flex items-start gap-2">
                  <ChevronRight className="w-3.5 h-3.5 text-emerald-400 mt-0.5 shrink-0" />
                  <p className="text-sm text-zinc-400">{s}</p>
                </div>
              ))}
            </div>
          </motion.div>

          {/* Life plan */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5"
          >
            <div className="flex items-center gap-2 mb-1">
              <BookOpen className="w-4 h-4 text-violet-400" />
              <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-widest">
                Your path forward
              </h2>
            </div>
            <p className="text-sm text-violet-300 italic mb-4">
              Theme: {result.life_plan.theme}
            </p>
            <div className="space-y-4">
              {[
                ["Next 3 months", result.life_plan.short_term, "indigo"],
                ["6-12 months", result.life_plan.medium_term, "violet"],
                ["2-5 years", result.life_plan.long_term, "rose"],
              ].map(([label, items, color]) => (
                <div key={label as string}>
                  <p
                    className="text-[10px] font-semibold uppercase tracking-widest mb-2"
                    style={{
                      color:
                        color === "indigo"
                          ? "#818cf8"
                          : color === "violet"
                            ? "#a78bfa"
                            : "#fb7185",
                    }}
                  >
                    {label as string}
                  </p>
                  {(items as string[]).map((item, i) => (
                    <p key={i} className="text-sm text-zinc-400 py-0.5 pl-3">
                      {item}
                    </p>
                  ))}
                </div>
              ))}
            </div>
          </motion.div>

          {/* Coaching insight */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="bg-gradient-to-r from-violet-500/10 to-indigo-500/10 border border-violet-500/20 rounded-2xl p-5"
          >
            <p className="text-sm text-zinc-300 leading-relaxed italic">
              &ldquo;{result.coaching_insight}&rdquo;
            </p>
          </motion.div>

          {/* Reset */}
          <button
            onClick={() => {
              setResult(null);
              setStep(0);
              setAnswers(Array(QUIZ_QUESTIONS.length).fill(""));
            }}
            className="text-sm text-zinc-600 hover:text-zinc-400 transition-all duration-200 cursor-pointer"
          >
            Start over
          </button>
        </div>
      )}
    </div>
  );
}
