/** Count civil dates, not 24-hour periods: daylight-saving time cannot shift the count. */
export function yearProgress(date: Date) {
  const year = date.getFullYear();
  const start = Date.UTC(year, 0, 1);
  const next = Date.UTC(year + 1, 0, 1);
  const today = Date.UTC(year, date.getMonth(), date.getDate());
  const total = (next - start) / 86400000;
  const elapsed = (today - start) / 86400000 + 1;
  return { year, total, elapsed, remaining: total - elapsed, fraction: elapsed / total };
}
