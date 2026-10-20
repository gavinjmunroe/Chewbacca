/**
 * Every Zeutara lead name the Clay feeder sent from 10/6 to 10/9 had one stray
 * "e" on the end: "Gary Zimmermane" for gary.zimmerman@, "Eric Chine" for
 * echin@, "B. P.e", 25 of 25 rows. The cards put those names in front of the
 * client. The source is a column in the feeder; until it's fixed there, strip
 * the "e" only where the evidence says it was added: the name without it
 * matches the email, the name ends ".e", or (since the bug is on every row)
 * the last word without it is a plain surname the email doesn't contradict.
 */
export function cleanLeadName(name: string | null | undefined, email?: string | null, feederAddsE = false): string | null {
  if (!name) return name ?? null;
  const s = name.trim();
  if (!/e$/.test(s)) return s;
  if (/\.e$/.test(s)) return s.slice(0, -1);
  const words = s.split(/\s+/);
  const last = words[words.length - 1];
  const trimmed = last.slice(0, -1);
  const local = (email || "").toLowerCase().split("@")[0].replace(/[^a-z]/g, "");
  // The email names them without the "e": strip it.
  if (trimmed.length >= 3 && local.includes(trimmed.toLowerCase()) && !local.includes(last.toLowerCase())) {
    return [...words.slice(0, -1), trimmed].join(" ");
  }
  // The client's feeder is known to add it (client-config leadNameTrailingE),
  // unless the email shows the "e" is really theirs (philipp.rose@).
  if (feederAddsE && !local.includes(last.toLowerCase())) {
    return [...words.slice(0, -1), trimmed].join(" ");
  }
  return s;
}

/**
 * Whole-batch rule for a feeder that appends "e" to every name: when nearly
 * every recent name ends in "e" (real surnames do about a fifth of the time),
 * the "e" is the feeder's, not the person's.
 */
export function feederAppendsE(recentNames: string[]): boolean {
  const named = recentNames.filter(Boolean);
  if (named.length < 8) return false;
  const withE = named.filter((n) => /e$/.test(n.trim())).length;
  return withE / named.length >= 0.9;
}
