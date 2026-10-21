import { DIMENSIONS, DIMENSION_META, scoreColor } from "@/lib/health";

type Profile = Partial<Record<string, number | null>>;

export function DimensionDots({ profile }: { profile: Profile }) {
  return (
    <div className="flex gap-1 items-center">
      {DIMENSIONS.map((dim) => {
        const score = profile[dim];
        const meta = DIMENSION_META[dim];
        const hasScore = score !== null && score !== undefined;
        return (
          <div
            key={dim}
            className="w-2.5 h-2.5 rounded-full"
            style={{
              backgroundColor: hasScore
                ? scoreColor(score)
                : "rgba(63,63,70,0.5)",
            }}
            title={`${meta.label}: ${hasScore ? score.toFixed(1) : "no data"}`}
          />
        );
      })}
    </div>
  );
}
