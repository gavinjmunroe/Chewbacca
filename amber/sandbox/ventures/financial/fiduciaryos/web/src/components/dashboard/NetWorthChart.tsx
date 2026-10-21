"use client";

import {
  AreaChart, Area, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid,
} from "recharts";
import { ProjectionYear, MonteCarloResult } from "@/lib/types";
import { fmtCompact } from "@/lib/format";

interface Props {
  projection: ProjectionYear[];
  monteCarlo: MonteCarloResult | null;
  mode: "deterministic" | "monte_carlo";
  showReal: boolean;
  startAge?: number;
}

function CustomTooltip({ active, payload, label }: { active?: boolean; payload?: { value: number; name: string }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: "var(--surface-2)", border: "1px solid var(--separator)",
      borderRadius: 10, padding: "10px 14px", fontFamily: "var(--font)",
    }}>
      <p className="t-footnote" style={{ color: "var(--label-3)", marginBottom: 6 }}>Age {label}</p>
      {payload.map((p, i) => (
        <p key={i} className="t-subhead" style={{ color: p.name === "p10" || p.name === "p90" ? "var(--label-3)" : p.name === "p50" ? "var(--green)" : "var(--label-2)" }}>
          {p.name === "totalReal" || p.name === "totalNominal" ? "Net Worth" : p.name.toUpperCase()}: {fmtCompact(p.value)}
        </p>
      ))}
    </div>
  );
}

export default function NetWorthChart({ projection, monteCarlo, mode, showReal, startAge = 22 }: Props) {
  if (mode === "monte_carlo" && monteCarlo) {
    const currentYear = new Date().getFullYear();
    const data = monteCarlo.yearData.map((d) => ({ age: d.year - currentYear + startAge, ...d }));
    return (
      <ResponsiveContainer width="100%" height={220}>
        <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="mcGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#30d158" stopOpacity={0.3} />
              <stop offset="100%" stopColor="#30d158" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
          <XAxis dataKey="age" tick={{ fill: "var(--label-3)", fontSize: 11 }} axisLine={false} tickLine={false} />
          <YAxis tickFormatter={fmtCompact} tick={{ fill: "var(--label-3)", fontSize: 11 }} axisLine={false} tickLine={false} width={56} />
          <Tooltip content={<CustomTooltip />} />
          <Area type="monotone" dataKey="p90" stroke="rgba(48,209,88,0.3)" fill="none" strokeDasharray="4 2" dot={false} name="p90" />
          <Area type="monotone" dataKey="p50" stroke="#30d158" fill="url(#mcGrad)" strokeWidth={2} dot={false} name="p50" />
          <Area type="monotone" dataKey="p10" stroke="rgba(48,209,88,0.3)" fill="none" strokeDasharray="4 2" dot={false} name="p10" />
        </AreaChart>
      </ResponsiveContainer>
    );
  }

  const key = showReal ? "totalReal" : "totalNominal";
  const data = projection.map((d) => ({ age: d.age, [key]: d[key] }));

  return (
    <ResponsiveContainer width="100%" height={220}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="netGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#30d158" stopOpacity={0.25} />
            <stop offset="100%" stopColor="#30d158" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
        <XAxis dataKey="age" tick={{ fill: "var(--label-3)", fontSize: 11 }} axisLine={false} tickLine={false} />
        <YAxis tickFormatter={fmtCompact} tick={{ fill: "var(--label-3)", fontSize: 11 }} axisLine={false} tickLine={false} width={56} />
        <Tooltip content={<CustomTooltip />} />
        <Area type="monotone" dataKey={key} stroke="#30d158" fill="url(#netGrad)" strokeWidth={2} dot={false} name={key} />
      </AreaChart>
    </ResponsiveContainer>
  );
}
