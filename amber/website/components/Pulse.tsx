"use client";

/**
 * TWO WEEKS OF THE COMPANY TALKING.
 *
 * One bar a day, fourteen of them. The job is magnitude over time, and the
 * only question worth answering at a glance is whether this place is alive:
 * a solid block means a team using it, a long tail of nothing means a
 * workspace somebody set up in March.
 *
 * ONE SERIES, SO NO LEGEND AND NO PALETTE TO VALIDATE. There is nothing to
 * tell apart -- the title names what the bars are -- so a legend box would be
 * a label on the only thing present. The hue is the accent, used as magnitude
 * rather than identity.
 *
 * NOT A NUMBER ON EVERY BAR. Fourteen numbers across 300 pixels is a wall of
 * digits that hides the shape, which is the only thing the chart is for. The
 * busiest day is labelled, the hover gives any of them exactly, and the total
 * is in the heading where somebody who wants one number will look.
 *
 * NO Y AXIS. The absolute count of messages on a Tuesday is not a decision
 * anybody makes; the comparison between Tuesdays is. An axis here would be
 * three grid lines of chartjunk around a strip two centimetres tall.
 */

import { useMemo, useState } from "react";

const DAYS = 14;

export default function Pulse({
  buckets,
  label = "messages",
}: {
  /**
   * One {day, n} per day, counted server-side.
   *
   * It takes counts rather than timestamps on purpose. Counting a list of
   * timestamps in the browser means counting whatever page the API happened
   * to return — sixty rows — so the busier the company, the more of its
   * history falls off the left of the chart and the quieter it appears.
   */
  buckets: { day: string; n: number }[];
  label?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);

  const days = useMemo(() => {
    const parse = (iso: string) => {
      // "2026-10-17" as a LOCAL date. `new Date("2026-10-17")` is parsed as
      // UTC midnight, which is the previous day for anybody west of London —
      // the whole strip would be labelled a day early.
      const [y, m, d] = iso.split("-").map(Number);
      return new Date(y, (m ?? 1) - 1, d ?? 1);
    };
    return buckets.slice(-DAYS).map((b) => ({
      day: parse(b.day),
      key: b.day,
      n: b.n,
    }));
  }, [buckets]);

  if (days.length === 0) return null;

  const total = days.reduce((a, b) => a + b.n, 0);
  const peak = Math.max(1, ...days.map((d) => d.n));
  const busiest = days.reduce((a, b) => (b.n > a.n ? b : a), days[0]);

  const shown = hover === null ? null : days[hover];

  return (
    <div onMouseLeave={() => setHover(null)}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[13px] text-[var(--ds-muted)]">
          <span className="tnum font-semibold text-[var(--ds-ink)]">{total}</span>{" "}
          {label} in the last two weeks
        </span>
        <span className="text-[11px] text-[var(--ds-faint)]">
          {shown
            ? `${shown.day.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })} · ${shown.n} ${shown.n === 1 ? label.replace(/s$/, "") : label}`
            : busiest.n > 0
              ? `busiest ${busiest.day.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })} · ${busiest.n}`
              : "nothing yet"}
        </span>
      </div>

      <div className="mt-2 flex items-end gap-1">
        {days.map((d, i) => {
          // A day with nothing still gets a visible sliver, so the strip
          // reads as fourteen days rather than as however many were busy.
          const h = d.n === 0 ? 3 : Math.max(6, Math.round((d.n / peak) * 44));
          const on = hover === i;
          const weekend = d.day.getDay() === 0 || d.day.getDay() === 6;
          return (
            <button
              key={d.key}
              type="button"
              onMouseEnter={() => setHover(i)}
              onFocus={() => setHover(i)}
              /* The whole column is the hit target: a 3px bar is not
                 something anybody can point at. */
              className="group/day flex flex-1 flex-col items-center gap-1.5"
              aria-label={`${d.day.toDateString()}: ${d.n} ${label}`}
            >
              <span className="flex h-[48px] w-full items-end justify-center">
                <span
                  className="w-full rounded-t-[4px] transition-colors"
                  style={{
                    height: h,
                    background:
                      d.n === 0
                        ? "var(--ds-line)"
                        : on
                          ? "var(--ds-accent)"
                          : "var(--ds-accent-ring)",
                  }}
                />
              </span>
              {/*
                EVERY DAY IS LABELLED, which is what makes this a chart rather
                than a decoration -- "busiest Thursday" is useless if you
                cannot see which column Thursday is. Weekends are dimmed, so
                the week's rhythm is readable without a legend explaining it.
              */}
              <span
                className={`text-[9.5px] leading-none ${
                  on
                    ? "font-semibold text-[var(--ds-ink)]"
                    : weekend
                      ? "text-[var(--ds-faint)] opacity-50"
                      : "text-[var(--ds-faint)]"
                }`}
              >
                {d.day.getDate()}
              </span>
              <span
                className={`text-[9px] uppercase leading-none tracking-wide ${
                  on ? "text-[var(--ds-muted)]" : "text-[var(--ds-faint)] opacity-60"
                }`}
              >
                {d.day.toLocaleDateString(undefined, { weekday: "narrow" })}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
