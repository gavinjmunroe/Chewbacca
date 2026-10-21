import { foldForSearch } from './peopleSearch';
export type CirclePerson = {
  id: string;
  name: string;
  subtitle?: string;
  context?: string;
  avatarUrl?: string | null;
};
const STOP = new Set(
  'a an the who can help me with my for to of in is are i looking someone want find and your'.split(
    ' ',
  ),
);
const ROOTS: Record<string, string> = {
  hiking: 'hike',
  hiker: 'hike',
  hikes: 'hike',
  walking: 'walk',
  running: 'run',
  runner: 'run',
  designer: 'design',
  designing: 'design',
  designs: 'design',
  friends: 'friend',
  meetings: 'meeting',
};
export function intentTerms(value: string): string[] {
  return [
    ...new Set(
      foldForSearch(value)
        .split(/[^\p{L}\p{N}]+/u)
        .filter((t) => t.length > 1 && !STOP.has(t))
        .map((t) => ROOTS[t] ?? t),
    ),
  ];
}
type SearchEntry = Pick<CirclePerson, 'name' | 'subtitle' | 'context'> & { fields: string };
// Keep indexing off subsequent keystrokes. Weak keys release removed contacts;
// field snapshots also invalidate when an imported contact is edited in place.
const searchIndex = new WeakMap<CirclePerson, SearchEntry>();
function indexedFields(person: CirclePerson): string {
  const cached = searchIndex.get(person);
  if (
    cached &&
    cached.name === person.name &&
    cached.subtitle === person.subtitle &&
    cached.context === person.context
  )
    return cached.fields;
  const fields = intentTerms(
    `${person.name} ${person.subtitle ?? ''} ${person.context ?? ''}`,
  ).join(' ');
  searchIndex.set(person, {
    name: person.name,
    subtitle: person.subtitle,
    context: person.context,
    fields,
  });
  return fields;
}
type IndexDeadline = { timeRemaining: () => number };
type IndexScheduler = (work: (deadline: IndexDeadline) => void) => () => void;
const scheduleIndexWork: IndexScheduler = (work) => {
  if (typeof requestIdleCallback === 'function' && typeof cancelIdleCallback === 'function') {
    const id = requestIdleCallback(work, { timeout: 250 });
    return () => cancelIdleCallback(id);
  }
  // Older clients and offline tests may not expose idle callbacks. Defer to a
  // later frame and give the same small time budget rather than doing a big task.
  const id = setTimeout(() => {
    const start = performance.now();
    work({ timeRemaining: () => Math.max(0, 2 - (performance.now() - start)) });
  }, 16);
  return () => clearTimeout(id);
};

/** Warm after rendering, without making first paint wait for every contact. */
export function warmCircleSearchIndex(
  people: CirclePerson[],
  schedule: IndexScheduler = scheduleIndexWork,
): () => void {
  let next = 0;
  let cancelled = false;
  let cancelPending = () => {};
  const run = (deadline: IndexDeadline) => {
    if (cancelled) return;
    const start = performance.now();
    let count = 0;
    while (
      !cancelled && next < people.length && count < 32 &&
      (count === 0 || (deadline.timeRemaining() > 1 && performance.now() - start < 2))
    ) {
      indexedFields(people[next++]);
      count += 1;
    }
    if (!cancelled && next < people.length) cancelPending = schedule(run);
  };
  if (people.length) cancelPending = schedule(run);
  return () => {
    cancelled = true;
    cancelPending();
  };
}
function relevanceForTerms(person: CirclePerson, terms: string[]): number {
  if (!terms.length) return 0;
  const fields = indexedFields(person);
  let matches = 0;
  for (const term of terms) if (fields.includes(term)) matches += 1;
  return matches / terms.length;
}
export function relevance(person: CirclePerson, intent: string): number {
  return relevanceForTerms(person, intentTerms(intent));
}
export function arrangeCircle(
  people: CirclePerson[],
  intent: string,
  width: number,
  height: number,
  compact = false,
) {
  const terms = intentTerms(intent);
  const focused = !!intent.trim();
  const ranked = people.map((person, index) => ({ ...person, score: relevanceForTerms(person, terms), index }));
  if (terms.length) ranked.sort((a, b) => b.score - a.score || a.index - b.index);
  const base = Math.max(82, Math.min(width * 0.25, height * 0.24));
  let ring = 0;
  let ringStart = 0;
  let capacity = Math.max(6, Math.floor((2 * Math.PI * base) / 84));
  return ranked.map((person, i) => {
    if (i - ringStart >= capacity) {
      ringStart += capacity;
      ring += 1;
      capacity = Math.max(6, Math.floor((2 * Math.PI * (base + ring * 84)) / 84));
    }
    const count = Math.min(capacity, ranked.length - ringStart);
    const angle = -Math.PI / 2 + ((i - ringStart) * Math.PI * 2) / Math.max(1, count) + ring * 0.24;
    const compactRadius = Math.max(58, Math.min(width / 2 - 42, height / 2 - 48));
    const radius = compact
      ? compactRadius * (person.score > 0 ? 0.78 : focused ? 1 : 0.9)
      : (person.score > 0 ? Math.max(76, base * 0.84) : base) +
        ring * 84 +
        (focused && person.score === 0 ? 28 : 0);
    return {
      ...person,
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius,
      relevant: person.score > 0,
    };
  });
}

/** Keep the complete graph navigable without mounting thousands of native views. */
export function visibleCircleNodes<T extends { x: number; y: number }>(
  nodes: T[],
  size: { width: number; height: number },
  camera: { x: number; y: number; zoom: number },
): T[] {
  const overscan = 140;
  return nodes.filter(
    (node) =>
      Math.abs(node.x * camera.zoom + camera.x) < size.width / 2 + overscan &&
      Math.abs(node.y * camera.zoom + camera.y) < size.height / 2 + overscan,
  );
}
