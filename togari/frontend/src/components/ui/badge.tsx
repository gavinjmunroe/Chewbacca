import { cn } from "@/lib/utils";
import type { HTMLAttributes } from "react";

type Variant =
  | "default"
  | "indigo"
  | "emerald"
  | "amber"
  | "rose"
  | "zinc"
  | "violet";

const styles: Record<Variant, string> = {
  default: "bg-zinc-800/80 text-zinc-200 border-zinc-700",
  indigo: "bg-indigo-500/10 text-indigo-300 border-indigo-500/30",
  emerald: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30",
  amber: "bg-amber-500/10 text-amber-300 border-amber-500/30",
  rose: "bg-rose-500/10 text-rose-300 border-rose-500/30",
  zinc: "bg-zinc-500/10 text-zinc-300 border-zinc-500/30",
  violet: "bg-violet-500/10 text-violet-300 border-violet-500/30",
};

export function Badge({
  className,
  variant = "default",
  ...props
}: HTMLAttributes<HTMLSpanElement> & { variant?: Variant }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium border",
        styles[variant],
        className,
      )}
      {...props}
    />
  );
}
