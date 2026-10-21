import { NETWORK_CATEGORIES, type NetworkCategory } from './amberSpace';
import type { CirclePreview, CircleMember } from './circles';
export function membershipsFromCircles(
  circles: CirclePreview[],
  members: (CircleMember & { circleId: string })[],
) {
  const categoryById = new Map<string, NetworkCategory>();
  for (const circle of circles) {
    if (circle.origin === 'inbound') continue;
    const label = (circle.kindTag || circle.name).trim().toLowerCase();
    const category = NETWORK_CATEGORIES.find((value) => value.toLowerCase() === label);
    if (category) categoryById.set(circle.id, category);
  }
  const result: Partial<Record<NetworkCategory, string[]>> = {};
  for (const member of members) {
    const category = categoryById.get(member.circleId);
    if (category) result[category] = [...new Set([...(result[category] ?? []), member.contactId])];
  }
  return result;
}
export function sameCity(a: string | undefined | null, b: string | undefined | null): boolean {
  const normalize = (v: string | undefined | null) =>
    (v ?? '')
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .split(',')[0]
      .trim()
      .toLowerCase();
  return !!normalize(a) && normalize(a) === normalize(b);
}
export type CommunityRank = { contactId: string; score: number; computedAt: string | null };
export function orderByPeopleRank<T extends { id: string; name?: string }>(
  people: T[],
  ranks: CommunityRank[],
  interactionStrength: ReadonlyMap<string, number> = new Map(),
): T[] {
  const scores = new Map(
    ranks
      .filter((r) => r.computedAt && Number.isFinite(r.score))
      .map((r) => [r.contactId, r.score]),
  );
  return [...people].sort(
    (a, b) =>
      (scores.get(b.id) ?? -1) - (scores.get(a.id) ?? -1) ||
      ((!scores.has(a.id) && !scores.has(b.id)) ? (interactionStrength.get(b.id) ?? 0) - (interactionStrength.get(a.id) ?? 0) : 0) ||
      (a.name ?? '').localeCompare(b.name ?? '') ||
      a.id.localeCompare(b.id),
  );
}
