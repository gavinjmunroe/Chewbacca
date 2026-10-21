export const NETWORK_CATEGORIES = [
  'Family',
  'Friends',
  'Romance',
  'Work',
  'School',
  'Exercise',
] as const;
export type NetworkCategory = (typeof NETWORK_CATEGORIES)[number];
export type SavedNetwork = NetworkCategory | 'Nearby' | 'All';
export function toggleNetwork(active: SavedNetwork, next: SavedNetwork): SavedNetwork {
  return active === next ? 'All' : next;
}
export type AmberProfile = {
  displayName: string;
  bio: string;
  city: string;
  website: string;
  accent: string;
};
export type AmberSpace = {
  active: SavedNetwork;
  memberships: Partial<Record<SavedNetwork, string[]>>;
  profile: AmberProfile;
  intent: string;
};
export const defaultSpace = (name = '', sample = false): AmberSpace => ({
  active: 'All',
  memberships: {},
  profile: { displayName: name, bio: '', city: '', website: '', accent: '#A9641D' },
  intent: '',
});
export function membersFor(space: AmberSpace, network: SavedNetwork, allIds: string[]): string[] {
  if (network === 'All') return allIds;
  const saved = new Set(space.memberships[network] ?? []);
  return allIds.filter((id) => saved.has(id));
}
export function parseSpace(value: unknown, fallback: AmberSpace): AmberSpace {
  if (!value || typeof value !== 'object') return fallback;
  const v = value as Record<string, unknown>,
    m = v.memberships as Record<string, unknown> | undefined,
    p = v.profile as Record<string, unknown> | undefined;
  const memberships: AmberSpace['memberships'] = {};
  for (const key of NETWORK_CATEGORIES)
    if (Array.isArray(m?.[key]))
      memberships[key] = [
        ...new Set((m[key] as unknown[]).filter((id): id is string => typeof id === 'string')),
      ];
  const str = (key: keyof AmberProfile, max: number) =>
    typeof p?.[key] === 'string' ? (p[key] as string).slice(0, max) : fallback.profile[key];
  return {
    active: [...NETWORK_CATEGORIES, 'Nearby', 'All'].includes(String(v.active))
      ? (v.active as SavedNetwork)
      : 'All',
    memberships,
    intent: typeof v.intent === 'string' ? v.intent.slice(0, 500) : '',
    profile: {
      displayName: str('displayName', 80),
      bio: str('bio', 500),
      city: str('city', 120),
      website: str('website', 500),
      accent: /^#[0-9a-f]{6}$/i.test(str('accent', 7)) ? str('accent', 7) : fallback.profile.accent,
    },
  };
}
export type RockAction = NetworkCategory | 'Nearby' | 'Amber Alert';
export const ROCK_TARGETS: { action: RockAction; x: number; y: number }[] = [
  { action: 'Amber Alert', x: 0, y: -126 },
  { action: 'Family', x: -88, y: -89 },
  { action: 'Friends', x: -126, y: 0 },
  { action: 'Romance', x: -88, y: 89 },
  { action: 'Work', x: 88, y: -89 },
  { action: 'School', x: 126, y: 0 },
  { action: 'Exercise', x: 88, y: 89 },
  { action: 'Nearby', x: 0, y: 126 },
];
export function rockTarget(x: number, y: number): RockAction | null {
  'worklet';
  let closest: RockAction | null = null,
    distance = 34;
  for (const target of ROCK_TARGETS) {
    const d = Math.hypot(x - target.x, y - target.y);
    if (d < distance) {
      closest = target.action;
      distance = d;
    }
  }
  return closest;
}
