export type BriefRecord = {
  id: string;
  name: string;
  detail: string;
  source?: string;
  createdAt?: string;
  contactId?: string;
  strength?: number;
};
export type BriefAnswer = { summary: string; ids: string[]; followUps: string[] };

/** Only known record IDs can become cards. Source text is data, never instructions. */
export function parseBrief(raw: string, records: BriefRecord[]): BriefAnswer {
  const clean = raw
    .trim()
    .replace(/^```(?:json)?\s*/, '')
    .replace(/\s*```$/, '');
  const value: unknown = JSON.parse(clean);
  if (!value || typeof value !== 'object') throw new Error('Invalid answer');
  const v = value as Record<string, unknown>;
  if (typeof v.summary !== 'string' || !v.summary.trim() || !Array.isArray(v.ids))
    throw new Error('Invalid answer');
  const allowed = new Set(records.map((record) => record.id));
  return {
    summary: v.summary.slice(0, 1600),
    ids: [
      ...new Set(v.ids.filter((id): id is string => typeof id === 'string' && allowed.has(id))),
    ].slice(0, 12),
    followUps: Array.isArray(v.followUps)
      ? v.followUps
          .filter((q): q is string => typeof q === 'string' && !!q.trim())
          .slice(0, 3)
          .map((q) => q.slice(0, 160))
      : [],
  };
}
export function rankUpdates(records: BriefRecord[], now: number): BriefRecord[] {
  const score = (r: BriefRecord) => {
    const time = r.createdAt ? Date.parse(r.createdAt) : NaN;
    const recency = Number.isFinite(time)
      ? Math.max(0, 1 - Math.max(0, now - time) / (7 * 86400000))
      : 0;
    return Math.max(0, Math.min(1, r.strength ?? 0)) * 0.65 + recency * 0.35;
  };
  return [...new Map(records.map((r) => [r.id, r])).values()].sort(
    (a, b) => score(b) - score(a) || a.id.localeCompare(b.id),
  );
}
