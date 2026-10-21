export type Dimension =
  | "social"
  | "financial"
  | "intellectual"
  | "spiritual"
  | "physical"
  | "emotional";

export const DIMENSIONS: Dimension[] = [
  "social",
  "financial",
  "intellectual",
  "spiritual",
  "physical",
  "emotional",
];

export const DIMENSION_META: Record<
  Dimension,
  { label: string; color: string; hex: string; gender: "M" | "F" }
> = {
  social: { label: "Social", color: "indigo", hex: "#6366f1", gender: "M" },
  financial: {
    label: "Financial",
    color: "emerald",
    hex: "#10b981",
    gender: "M",
  },
  intellectual: {
    label: "Intellectual",
    color: "violet",
    hex: "#8b5cf6",
    gender: "M",
  },
  spiritual: {
    label: "Spiritual",
    color: "amber",
    hex: "#f59e0b",
    gender: "F",
  },
  physical: { label: "Physical", color: "rose", hex: "#f43f5e", gender: "F" },
  emotional: { label: "Emotional", color: "sky", hex: "#0ea5e9", gender: "F" },
};

export function scoreColor(score: number | null | undefined): string {
  if (score == null) return "#52525b"; // zinc-600 for no data
  if (score < 4) return "#ef4444";
  if (score < 7) return "#f59e0b";
  return "#22c55e";
}
