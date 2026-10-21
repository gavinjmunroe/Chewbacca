"use client";
import { motion } from "framer-motion";
import { scoreColor } from "@/lib/health";

interface Props {
  score: number;
  label: string;
  gender: "M" | "F";
  size?: number;
  delay?: number;
}

export function HealthGauge({
  score,
  label,
  gender,
  size = 96,
  delay = 0,
}: Props) {
  const r = (size / 2) * 0.78;
  const cx = size / 2;
  const cy = size / 2;
  const circumference = 2 * Math.PI * r;
  const pct = Math.min(Math.max(score / 10, 0), 1);
  const hex = scoreColor(score);

  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle
            cx={cx}
            cy={cy}
            r={r}
            fill="none"
            stroke="#27272a"
            strokeWidth={7}
          />
          <motion.circle
            cx={cx}
            cy={cy}
            r={r}
            fill="none"
            stroke={hex}
            strokeWidth={7}
            strokeLinecap="round"
            strokeDasharray={circumference}
            initial={{ strokeDashoffset: circumference }}
            animate={{ strokeDashoffset: circumference - circumference * pct }}
            transition={{ duration: 1, delay, ease: [0.34, 1.56, 0.64, 1] }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <motion.span
            className="font-bold text-zinc-100 leading-none"
            style={{ fontSize: size * 0.22 }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: delay + 0.4 }}
          >
            {score.toFixed(1)}
          </motion.span>
        </div>
      </div>
      <div className="text-center">
        <p className="text-[11px] font-medium text-zinc-400 leading-tight">
          {label}
        </p>
        <span
          className="text-[9px] font-bold px-1 py-0.5 rounded-full"
          style={{ color: hex, background: `${hex}18` }}
        >
          {gender}
        </span>
      </div>
    </div>
  );
}
