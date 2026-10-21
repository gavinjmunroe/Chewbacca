import { callMedhaId } from './medhaId';
export type CommunityNode = { id: string; kind: string; strength: number; aliases?: string[]; lastChannel?: string | null };
export function communityNodes(value: unknown): CommunityNode[] {
  if (!value || typeof value !== 'object' || !Array.isArray((value as { nodes?: unknown }).nodes)) return [];
  return ((value as { nodes: unknown[] }).nodes).filter((row): row is CommunityNode => {
    if (!row || typeof row !== 'object') return false;
    const n = row as CommunityNode;
    return n.kind === 'contact' && typeof n.id === 'string' && Number.isFinite(n.strength) && n.strength >= 0 && n.strength <= 1;
  });
}
export const getCommunityGraph = () => callMedhaId<unknown>({ path: '/v1/me/network/edges', requireAuth: true });
