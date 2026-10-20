import { cn } from "@/lib/utils";

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "animate-pulse bg-zinc-800/80 rounded-md shimmer",
        className,
      )}
    />
  );
}
