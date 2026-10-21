import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merge class names, last writer wins on conflicts.
 *
 * The twMerge half is the part that matters: without it, a component's own
 * `px-3` and a caller's `px-6` both end up in the class list and which one
 * applies is decided by stylesheet order, which is to say by accident. With
 * it, a variant can be overridden at the call site, which is the only reason a
 * component takes a className at all.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * A stable colour for a name, from the five identity hues.
 *
 * Deterministic so the same person is the same colour on every screen, in
 * every session, without a colour ever being stored. Identity hues only --
 * never the accent, which means "selected" and would make a person look picked.
 */
const HUES = ["--ds-indigo", "--ds-emerald", "--ds-rose", "--ds-cyan", "--ds-violet"] as const;

export function hueFor(seed: string | null | undefined): string {
  const s = String(seed ?? "");
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return `var(${HUES[h % HUES.length]})`;
}
