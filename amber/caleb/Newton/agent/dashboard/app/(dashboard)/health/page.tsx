"use client";
import useSWR from "swr";
import { fetcher } from "@/lib/fetcher";
import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { DIMENSIONS, DIMENSION_META, scoreColor } from "@/lib/health";
import { HealthGauge } from "@/components/dashboard/HealthGauge";
import { Flame, TrendingUp } from "lucide-react";

const DIM_COLORS: Record<string, string> = {
  social: "#6366f1",
  financial: "#10b981",
  intellectual: "#8b5cf6",
  spiritual: "#f59e0b",
  physical: "#f43f5e",
  emotional: "#0ea5e9",
};

type Range = "7d" | "30d" | "90d" | "all";

export default function HealthPage() {
  const [profile, setProfile] = useState<Record<string, number> | null>(null);
  const [checkins, setCheckins] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState<Range>("30d");
  const [view, setView] = useState<"all" | "mf">("all");
  const dayMap: Record<Range, number> = {
    "7d": 7,
    "30d": 30,
    "90d": 90,
    all: 365,
  };

  useEffect(() => {
    setLoading(true);
    fetch(`/api/health?days=${dayMap[range]}`)
      .then((r) => r.json())
      .then((d) => {
        setProfile(d.profile);
        setCheckins(d.checkins || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [range]);

  const chartData = checkins.map((c) => ({
    date: new Date(c.date as string).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    }),
    ...DIMENSIONS.reduce((acc, d) => ({ ...acc, [d]: c[d] }), {}),
    masc: (
      ((c.social as number) +
        (c.financial as number) +
        (c.intellectual as number)) /
      3
    ).toFixed(2),
    fem: (
      ((c.spiritual as number) +
        (c.physical as number) +
        (c.emotional as number)) /
      3
    ).toFixed(2),
  }));

  const masc = ["social", "financial", "intellectual"] as const;
  const fem = ["spiritual", "physical", "emotional"] as const;

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-zinc-50 tracking-tight">
          Health
        </h1>
        <p className="text-zinc-500 text-xs mt-0.5">
          6 dimensions tracked over time.
        </p>
      </div>

      {/* Profile card */}
      {loading ? (
        <Skeleton className="h-44 rounded-2xl bg-zinc-900" />
      ) : profile ? (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5"
        >
          <div className="flex items-center justify-between mb-5">
            <div>
              <p className="text-[10px] text-zinc-600 uppercase tracking-widest font-medium mb-0.5">
                Current
              </p>
              <div className="flex items-baseline gap-1.5">
                <span
                  className="text-3xl font-bold"
                  style={{ color: scoreColor(profile.overall_score) }}
                >
                  {profile.overall_score?.toFixed(1)}
                </span>
                <span className="text-zinc-600">/10</span>
              </div>
            </div>
            <div className="flex gap-4 text-right">
              <div>
                <div className="flex items-center gap-1 justify-end">
                  <Flame className="w-3.5 h-3.5 text-amber-400" />
                  <span className="text-lg font-bold text-zinc-100">
                    {profile.checkin_streak || 0}
                  </span>
                </div>
                <p className="text-[10px] text-zinc-600">streak</p>
              </div>
              <div>
                <span className="text-lg font-bold text-zinc-100">
                  {profile.total_checkins || 0}
                </span>
                <p className="text-[10px] text-zinc-600">total</p>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-5">
            <div>
              <p className="text-[10px] font-semibold text-zinc-600 uppercase tracking-widest mb-3">
                Masculine
              </p>
              <div className="flex justify-around">
                {masc.map((d, i) => (
                  <HealthGauge
                    key={d}
                    score={profile[d] || 0}
                    label={DIMENSION_META[d].label}
                    gender="M"
                    size={76}
                    delay={i * 0.08}
                  />
                ))}
              </div>
            </div>
            <div>
              <p className="text-[10px] font-semibold text-zinc-600 uppercase tracking-widest mb-3">
                Feminine
              </p>
              <div className="flex justify-around">
                {fem.map((d, i) => (
                  <HealthGauge
                    key={d}
                    score={profile[d] || 0}
                    label={DIMENSION_META[d].label}
                    gender="F"
                    size={76}
                    delay={(i + 3) * 0.08}
                  />
                ))}
              </div>
            </div>
          </div>
        </motion.div>
      ) : (
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-8 text-center">
          <p className="text-zinc-500 text-sm">
            No check-ins yet. Log your first from Home.
          </p>
        </div>
      )}

      {/* Chart */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-zinc-500" />
            <h2 className="text-xs font-semibold text-zinc-400 uppercase tracking-widest">
              Trend
            </h2>
          </div>
          <div className="flex gap-2 flex-wrap">
            <div className="flex rounded-lg overflow-hidden border border-zinc-800 text-xs">
              {(["all", "mf"] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => setView(v)}
                  className={`px-3 py-1.5 font-medium transition-colors cursor-pointer ${view === v ? "bg-zinc-700 text-zinc-100" : "text-zinc-500 hover:text-zinc-300"}`}
                >
                  {v === "all" ? "All 6" : "M vs F"}
                </button>
              ))}
            </div>
            <div className="flex rounded-lg overflow-hidden border border-zinc-800 text-xs">
              {(["7d", "30d", "90d", "all"] as Range[]).map((r) => (
                <button
                  key={r}
                  onClick={() => setRange(r)}
                  className={`px-3 py-1.5 font-medium transition-colors cursor-pointer ${range === r ? "bg-zinc-700 text-zinc-100" : "text-zinc-500 hover:text-zinc-300"}`}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>
        </div>
        {loading ? (
          <Skeleton className="h-48 rounded-xl bg-zinc-800" />
        ) : chartData.length === 0 ? (
          <div className="h-48 flex items-center justify-center text-zinc-600 text-sm">
            No data for this range.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <LineChart
              data={chartData}
              margin={{ top: 4, right: 4, left: -24, bottom: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
              <XAxis
                dataKey="date"
                tick={{ fill: "#71717a", fontSize: 10 }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                domain={[0, 10]}
                tick={{ fill: "#71717a", fontSize: 10 }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                contentStyle={{
                  background: "#18181b",
                  border: "1px solid #27272a",
                  borderRadius: 10,
                  fontSize: 11,
                }}
              />
              <Legend
                wrapperStyle={{ fontSize: 10, color: "#71717a" }}
                iconType="circle"
                iconSize={6}
              />
              {view === "all"
                ? DIMENSIONS.map((d) => (
                    <Line
                      key={d}
                      type="monotone"
                      dataKey={d}
                      stroke={DIM_COLORS[d]}
                      strokeWidth={2}
                      dot={false}
                      activeDot={{ r: 3 }}
                    />
                  ))
                : [
                    <Line
                      key="masc"
                      type="monotone"
                      dataKey="masc"
                      name="Masculine"
                      stroke="#6366f1"
                      strokeWidth={2.5}
                      dot={false}
                    />,
                    <Line
                      key="fem"
                      type="monotone"
                      dataKey="fem"
                      name="Feminine"
                      stroke="#f43f5e"
                      strokeWidth={2.5}
                      dot={false}
                    />,
                  ]}
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* History table */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-zinc-800">
          <h2 className="text-xs font-semibold text-zinc-400 uppercase tracking-widest">
            History
          </h2>
        </div>
        {loading ? (
          <div className="p-4 space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-9 rounded-lg bg-zinc-800" />
            ))}
          </div>
        ) : checkins.length === 0 ? (
          <div className="px-5 py-10 text-center text-zinc-600 text-sm">
            No check-ins yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-800">
                  <th className="text-left px-5 py-2.5 text-xs font-medium text-zinc-500">
                    Date
                  </th>
                  {DIMENSIONS.map((d) => (
                    <th
                      key={d}
                      className="text-center px-2 py-2.5 text-xs font-medium"
                      style={{ color: DIM_COLORS[d] }}
                    >
                      {DIMENSION_META[d].label.slice(0, 3)}
                    </th>
                  ))}
                  <th className="text-left px-3 py-2.5 text-xs font-medium text-zinc-500">
                    Src
                  </th>
                </tr>
              </thead>
              <tbody>
                {[...checkins].reverse().map((c, i) => (
                  <tr
                    key={i}
                    className="border-b border-zinc-800/40 hover:bg-zinc-800/30 transition-colors"
                  >
                    <td className="px-5 py-2.5 text-zinc-500 text-xs whitespace-nowrap">
                      {new Date(c.date as string).toLocaleDateString()}
                    </td>
                    {DIMENSIONS.map((d) => (
                      <td key={d} className="text-center px-2 py-2.5">
                        <span
                          className="font-semibold text-xs"
                          style={{ color: scoreColor(c[d] as number) }}
                        >
                          {(c[d] as number)?.toFixed(1) || "—"}
                        </span>
                      </td>
                    ))}
                    <td className="px-3 py-2.5">
                      {c.source === "inferred" ? (
                        <Badge
                          variant="outline"
                          className="text-[9px] border-amber-500/30 text-amber-400 px-1.5"
                        >
                          inf
                        </Badge>
                      ) : (
                        <Badge
                          variant="outline"
                          className="text-[9px] border-zinc-700 text-zinc-600 px-1.5"
                        >
                          self
                        </Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
