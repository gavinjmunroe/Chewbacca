"use client";

/**
 * THE SIX DIMENSIONS, AS A SHAPE.
 *
 * The same ontology the iOS card draws (src/lib/dimensions.js: spiritual,
 * emotional, physical, intellectual, social, financial) in the same canonical
 * order, because a wheel whose axes move between two surfaces is not a wheel,
 * it is two different pictures with the same six words on them.
 *
 * AN UNCOMPUTED SHAPE IS NOT A FLAT SHAPE. Six zeros drawn as a collapsed
 * hexagon reads as "this relationship scores nothing on every dimension",
 * which is a strong claim about somebody. It is almost always the other thing:
 * the rollup has not produced a row yet. So a card with no computed state says
 * so in words and draws nothing.
 */

import { DIMENSIONS, type DimensionName } from "@/lib/amber";

/** Matches DIMENSION_META on the server, translated to this palette. */
const COLOR: Record<DimensionName, string> = {
  spiritual: "#b79ae0",
  emotional: "#e0798f",
  physical: "#8fcf9a",
  intellectual: "#e0a05a",
  social: "#7fb2d9",
  financial: "#6fc7c1",
};

const SIZE = 168;
const R = 62;
const CX = SIZE / 2;
const CY = SIZE / 2 + 4;

/** Axis n, starting at the top and going clockwise. */
function point(i: number, radius: number) {
  const a = -Math.PI / 2 + (i * 2 * Math.PI) / DIMENSIONS.length;
  return [CX + Math.cos(a) * radius, CY + Math.sin(a) * radius] as const;
}

export default function DimensionWheel({
  scores,
  computed,
}: {
  scores: Partial<Record<DimensionName, number>>;
  computed: boolean;
}) {
  const values = DIMENSIONS.map((d) => Math.max(0, Math.min(10, Number(scores?.[d] ?? 0))));
  const any = values.some((v) => v > 0);

  if (!computed || !any) {
    return (
      <p className="text-sm" style={{ color: "var(--muted)", lineHeight: 1.5 }}>
        Not scored yet. The six dimensions fill in once Amber has facts about
        this person to read them from.
      </p>
    );
  }

  const shape = values
    .map((v, i) => point(i, (v / 10) * R))
    .map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`)
    .join(" ");

  return (
    <div className="flex flex-col items-center">
      <svg width={SIZE} height={SIZE} role="img" aria-label="Six dimensions of health">
        {/* Rings at 1/3, 2/3 and full, so a value can be read off the shape
            rather than only compared with the other five. */}
        {[1 / 3, 2 / 3, 1].map((f) => (
          <polygon
            key={f}
            points={DIMENSIONS.map((_, i) => point(i, R * f))
              .map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`)
              .join(" ")}
            fill="none"
            stroke="rgba(233,188,110,0.16)"
            strokeWidth={1}
          />
        ))}
        {DIMENSIONS.map((d, i) => {
          const [x, y] = point(i, R);
          return (
            <line
              key={d}
              x1={CX}
              y1={CY}
              x2={x}
              y2={y}
              stroke="rgba(233,188,110,0.16)"
              strokeWidth={1}
            />
          );
        })}

        <polygon points={shape} fill="rgba(226,161,60,0.22)" stroke="#e2a13c" strokeWidth={1.5} />

        {values.map((v, i) => {
          if (v <= 0) return null;
          const [x, y] = point(i, (v / 10) * R);
          return <circle key={DIMENSIONS[i]} cx={x} cy={y} r={3} fill={COLOR[DIMENSIONS[i]]} />;
        })}
      </svg>

      <div className="mt-1 flex flex-wrap justify-center gap-x-3 gap-y-1">
        {DIMENSIONS.map((d, i) => (
          <span key={d} className="flex items-center gap-1" style={{ fontSize: 11 }}>
            <span
              aria-hidden
              style={{ width: 6, height: 6, borderRadius: 999, background: COLOR[d] }}
            />
            <span style={{ color: "var(--muted)" }}>{d}</span>
            <span style={{ color: "var(--ink)" }}>{values[i].toFixed(1)}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
