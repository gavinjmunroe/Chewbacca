export function fmt$(n: number, decimals = 0): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(n);
}

export function fmtPct(n: number, decimals = 1): string {
  return `${(n * 100).toFixed(decimals)}%`;
}

export function fmtAge(n: number): string {
  return n % 1 === 0.5 ? `${Math.floor(n)}.5` : String(Math.floor(n));
}

export function fmtCompact(n: number): string {
  if (n >= 999_500) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return fmt$(n);
}
