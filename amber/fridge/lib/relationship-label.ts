/**
 * SAY WHAT ACTUALLY HAPPENED.
 *
 * This said "spoke" for every contact, and the number behind it was the last
 * time anything at all touched that person -- a calendar invite, a thread they
 * were CC'd on, an email they sent that was never answered. "I have not spoken
 * to some of these people that recently" was a correct reading of a label that
 * was claiming more than the data said.
 *
 * The server now gates an email correspondence on the owner having written
 * back, and reports which surface the last contact was on, so the verb can be
 * the true one. A null channel gets the neutral wording rather than a guess.
 */
export const VERBS: Record<string, [string, string, string]> = {
  email: ["emailed today", "emailed yesterday", "emailed"],
  calendar: ["met today", "met yesterday", "met"],
  message: ["messaged today", "messaged yesterday", "messaged"],
  note: ["noted today", "noted yesterday", "noted"],
};

export function sinceLabel(
  iso?: string | null,
  channel?: string | null,
  now: number = Date.now(),
): string | null {
  if (!iso) return null;
  const days = Math.floor((now - Date.parse(iso)) / 86_400_000);
  if (!Number.isFinite(days)) return null;
  const [today, yesterday, past] = VERBS[String(channel ?? "")] ?? [
    "last contact today",
    "last contact yesterday",
    "last contact",
  ];
  if (days <= 0) return today;
  if (days === 1) return yesterday;
  const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"}`;
  if (days < 30) return `${past} ${plural(days, "day")} ago`;
  if (days < 365) return `${past} ${plural(Math.round(days / 30), "month")} ago`;
  return `${past} ${plural(Math.round(days / 365), "year")} ago`;
}
