import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatPay(
  minCents: number | null,
  maxCents: number | null,
  payType: string
): string {
  if (!minCents && !maxCents) return "Pay TBD";
  const fmt = (c: number) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    }).format(c / 100);
  const suffix =
    payType === "hourly" ? "/hr" : payType === "daily" ? "/day" : "";
  if (minCents && maxCents)
    return `${fmt(minCents)}–${fmt(maxCents)}${suffix}`;
  if (minCents) return `${fmt(minCents)}+${suffix}`;
  return `Up to ${fmt(maxCents!)}${suffix}`;
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function getInitials(name: string): string {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

export function slugify(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
