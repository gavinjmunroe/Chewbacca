"use client";
import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Skeleton } from "@/components/ui/skeleton";
import { HealthGauge } from "@/components/dashboard/HealthGauge";
import { DIMENSIONS, DIMENSION_META, scoreColor } from "@/lib/health";
import {
  Flame,
  AlertCircle,
  Calendar,
  CheckSquare,
  Mail,
  ArrowRight,
} from "lucide-react";
import Link from "next/link";

interface Profile {
  social: number;
  financial: number;
  intellectual: number;
  spiritual: number;
  physical: number;
  emotional: number;
  overall_score: number;
  lowest_dimension: string;
  checkin_streak: number;
  total_checkins: number;
  last_checkin_date: string;
}

interface CalendarEvent {
  title: string;
  start: string;
  end: string;
}

interface Task {
  id: string;
  content: string;
  due?: { date: string };
  priority: number;
}

interface EmailItem {
  from: string;
  subject: string;
  snippet: string;
  date: string;
  unread: boolean;
}

const DEFAULT_SCORES = {
  social: 5,
  financial: 5,
  intellectual: 5,
  spiritual: 5,
  physical: 5,
  emotional: 5,
};

export default function HomePage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [scores, setScores] = useState(DEFAULT_SCORES);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [emails, setEmails] = useState<EmailItem[]>([]);

  const now = new Date();
  const hour = now.getHours();
  const greeting =
    hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const today = now.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  useEffect(() => {
    // Load everything in parallel
    Promise.all([
      fetch("/api/health?days=30")
        .then((r) => r.json())
        .catch(() => ({ profile: null })),
      fetch("/api/calendar")
        .then((r) => r.json())
        .catch(() => ({ events: [] })),
      fetch("/api/tasks")
        .then((r) => r.json())
        .catch(() => ({ today: [], overdue: [] })),
      fetch("/api/email")
        .then((r) => r.json())
        .catch(() => ({ emails: [] })),
    ]).then(([healthData, calData, taskData, emailData]) => {
      setProfile(healthData.profile);
      setEvents((calData.events || []).slice(0, 5));
      setTasks(
        [...(taskData.overdue || []), ...(taskData.today || [])].slice(0, 5),
      );
      setEmails((emailData.emails || []).slice(0, 4));
      setLoading(false);
    });
  }, []);

  async function handleCheckin() {
    setSubmitting(true);
    const res = await fetch("/api/checkin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(scores),
    });
    const data = await res.json();
    setSubmitting(false);
    setSubmitted(true);
    if (data.profile) setProfile(data.profile);
  }

  const masc = ["social", "financial", "intellectual"] as const;
  const fem = ["spiritual", "physical", "emotional"] as const;
  const lowestMeta = profile
    ? DIMENSION_META[profile.lowest_dimension as keyof typeof DIMENSION_META]
    : null;

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 space-y-6">
      {/* Header */}
      <div>
        <p className="text-[11px] font-semibold text-zinc-600 uppercase tracking-widest mb-1">
          {today}
        </p>
        <h1 className="text-2xl font-bold text-zinc-50 tracking-tight">
          {greeting}, Caleb.
        </h1>
      </div>

      {/* Top row: Overall score + Quick glance */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Overall health */}
        {loading ? (
          <Skeleton className="h-28 rounded-2xl bg-zinc-900" />
        ) : profile ? (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-zinc-900 border rounded-2xl p-5"
            style={{
              borderColor: "rgba(99,102,241,0.25)",
              background:
                "linear-gradient(135deg,rgba(99,102,241,0.07) 0%,transparent 60%)",
            }}
          >
            <p className="text-[10px] font-semibold text-zinc-600 uppercase tracking-widest mb-1">
              Health
            </p>
            <div className="flex items-baseline gap-1.5">
              <span
                className="text-4xl font-bold"
                style={{ color: scoreColor(profile.overall_score) }}
              >
                {profile.overall_score.toFixed(1)}
              </span>
              <span className="text-zinc-600 text-lg">/10</span>
            </div>
            <div className="flex gap-3 mt-2 text-[11px] text-zinc-500">
              <span className="flex items-center gap-1">
                <Flame className="w-3 h-3 text-amber-400" />
                {profile.checkin_streak || 0} streak
              </span>
              <span>{profile.total_checkins || 0} total</span>
            </div>
          </motion.div>
        ) : (
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 flex items-center justify-center">
            <p className="text-zinc-600 text-sm">No health data yet</p>
          </div>
        )}

        {/* Today's calendar */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
          className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5"
        >
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Calendar className="w-3.5 h-3.5 text-indigo-400" />
              <p className="text-[10px] font-semibold text-zinc-600 uppercase tracking-widest">
                Calendar
              </p>
            </div>
            <Link
              href="/calendar"
              className="text-[10px] text-indigo-400 hover:text-indigo-300 flex items-center gap-0.5"
            >
              View all <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
          {loading ? (
            <div className="space-y-2">
              <Skeleton className="h-4 w-3/4 bg-zinc-800" />
              <Skeleton className="h-4 w-1/2 bg-zinc-800" />
            </div>
          ) : events.length > 0 ? (
            <ul className="space-y-1.5">
              {events.map((e, i) => (
                <li key={i} className="text-xs text-zinc-400 flex gap-2">
                  <span className="text-zinc-600 shrink-0 w-12">
                    {new Date(e.start).toLocaleTimeString("en-US", {
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </span>
                  <span className="text-zinc-300 truncate">{e.title}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-zinc-600">Nothing scheduled today</p>
          )}
        </motion.div>

        {/* Today's tasks */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5"
        >
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <CheckSquare className="w-3.5 h-3.5 text-emerald-400" />
              <p className="text-[10px] font-semibold text-zinc-600 uppercase tracking-widest">
                Tasks
              </p>
            </div>
            <Link
              href="/tasks"
              className="text-[10px] text-indigo-400 hover:text-indigo-300 flex items-center gap-0.5"
            >
              View all <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
          {loading ? (
            <div className="space-y-2">
              <Skeleton className="h-4 w-3/4 bg-zinc-800" />
              <Skeleton className="h-4 w-1/2 bg-zinc-800" />
            </div>
          ) : tasks.length > 0 ? (
            <ul className="space-y-1.5">
              {tasks.map((t) => (
                <li
                  key={t.id}
                  className="text-xs text-zinc-300 flex items-start gap-2"
                >
                  <div
                    className="w-1.5 h-1.5 rounded-full mt-1.5 shrink-0"
                    style={{
                      backgroundColor:
                        t.priority === 4
                          ? "#ef4444"
                          : t.priority === 3
                            ? "#f59e0b"
                            : t.priority === 2
                              ? "#3b82f6"
                              : "#52525b",
                    }}
                  />
                  <span className="truncate">{t.content}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-zinc-600">All clear</p>
          )}
        </motion.div>
      </div>

      {/* Low dimension nudge */}
      {profile && lowestMeta && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.15 }}
          className="flex items-start gap-2.5 bg-zinc-900/60 border border-amber-500/20 rounded-xl px-4 py-3"
        >
          <AlertCircle className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-medium text-zinc-200">
              {lowestMeta.label} needs attention.
            </p>
            <p className="text-xs text-zinc-500 mt-0.5">
              {profile.lowest_dimension === "social" &&
                "Who have you been meaning to reach out to?"}
              {profile.lowest_dimension === "financial" &&
                "Review your budget or check on income streams."}
              {profile.lowest_dimension === "intellectual" &&
                "Read something new today. Even 10 pages."}
              {profile.lowest_dimension === "spiritual" &&
                "When did you last spend time in the Word?"}
              {profile.lowest_dimension === "physical" &&
                "Get outside. Move your body today."}
              {profile.lowest_dimension === "emotional" &&
                "Check in with yourself. How are you actually doing?"}
            </p>
          </div>
        </motion.div>
      )}

      {/* 6 Gauges */}
      {loading ? (
        <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-2xl bg-zinc-900" />
          ))}
        </div>
      ) : profile ? (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5"
        >
          <div className="grid grid-cols-2 gap-6">
            <div>
              <p className="text-[10px] font-semibold text-zinc-600 uppercase tracking-widest mb-4">
                Masculine
              </p>
              <div className="flex justify-around">
                {masc.map((d, i) => (
                  <HealthGauge
                    key={d}
                    score={profile[d]}
                    label={DIMENSION_META[d].label}
                    gender="M"
                    delay={i * 0.1}
                  />
                ))}
              </div>
            </div>
            <div>
              <p className="text-[10px] font-semibold text-zinc-600 uppercase tracking-widest mb-4">
                Feminine
              </p>
              <div className="flex justify-around">
                {fem.map((d, i) => (
                  <HealthGauge
                    key={d}
                    score={profile[d]}
                    label={DIMENSION_META[d].label}
                    gender="F"
                    delay={(i + 3) * 0.1}
                  />
                ))}
              </div>
            </div>
          </div>
        </motion.div>
      ) : null}

      {/* Email preview */}
      {emails.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25 }}
          className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5"
        >
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Mail className="w-3.5 h-3.5 text-rose-400" />
              <p className="text-[10px] font-semibold text-zinc-600 uppercase tracking-widest">
                Inbox
              </p>
            </div>
            <Link
              href="/email"
              className="text-[10px] text-indigo-400 hover:text-indigo-300 flex items-center gap-0.5"
            >
              View all <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
          <div className="space-y-2">
            {emails.map((e, i) => (
              <div key={i} className="flex items-start gap-2 text-xs">
                {e.unread && (
                  <div className="w-1.5 h-1.5 rounded-full bg-indigo-400 mt-1.5 shrink-0" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex justify-between gap-2">
                    <span className="text-zinc-300 font-medium truncate">
                      {e.from}
                    </span>
                    <span className="text-zinc-600 shrink-0">{e.date}</span>
                  </div>
                  <p className="text-zinc-500 truncate">{e.subject}</p>
                </div>
              </div>
            ))}
          </div>
        </motion.div>
      )}

      {/* Daily Check-in */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
        className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5"
      >
        <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-widest mb-4">
          Daily Check-in
        </h2>
        {submitted ? (
          <div className="text-center py-6">
            <div className="w-10 h-10 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center mx-auto mb-2">
              <span className="text-emerald-400 text-lg font-bold">+</span>
            </div>
            <p className="text-zinc-200 font-medium text-sm">Logged.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {DIMENSIONS.map((dim) => {
              const meta = DIMENSION_META[dim];
              const val = scores[dim];
              return (
                <div key={dim} className="flex items-center gap-3">
                  <div className="w-24 shrink-0 flex items-center gap-1.5">
                    <div
                      className="w-1.5 h-1.5 rounded-full shrink-0"
                      style={{ backgroundColor: meta.hex }}
                    />
                    <span className="text-xs text-zinc-400">{meta.label}</span>
                    <span
                      className="text-[9px] font-bold ml-auto"
                      style={{ color: meta.hex }}
                    >
                      {meta.gender}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={10}
                    step={0.5}
                    value={val}
                    onChange={(e) =>
                      setScores((s) => ({
                        ...s,
                        [dim]: parseFloat(e.target.value),
                      }))
                    }
                    className="flex-1 accent-indigo-500 cursor-pointer"
                  />
                  <span
                    className="w-8 text-right text-sm font-semibold"
                    style={{ color: scoreColor(val) }}
                  >
                    {val}
                  </span>
                </div>
              );
            })}
            <button
              onClick={handleCheckin}
              disabled={submitting}
              className="mt-1 w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-semibold py-2.5 rounded-xl transition-all duration-200 cursor-pointer text-sm"
            >
              {submitting ? "Saving..." : "Log today"}
            </button>
          </div>
        )}
      </motion.div>
    </div>
  );
}
