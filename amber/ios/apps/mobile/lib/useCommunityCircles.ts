import { useCallback, useEffect, useState } from 'react';
import {
  createCircle,
  listCircles,
  listAllCircleMembers,
  setCircleMembers,
  type CirclePreview,
} from './circles';
import { NETWORK_CATEGORIES, type AmberSpace } from './amberSpace';
import { membershipsFromCircles } from './communityFilters';
/** No guessed membership or auto-created circles. Only an explicit Save writes. */
export function useCommunityCircles() {
  const [circles, setCircles] = useState<CirclePreview[]>([]);
  const [memberships, setMemberships] = useState<AmberSpace['memberships']>({});
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const reload = useCallback(async () => {
    const [groups, rows] = await Promise.all([listCircles(), listAllCircleMembers()]);
    if (!groups.ok || !rows.ok) {
      setError('Could not load saved circles. Tap to retry.');
      return;
    }
    setCircles(groups.data.circles);
    setMemberships(membershipsFromCircles(groups.data.circles, rows.data.members));
    setReady(true);
    setError('');
  }, []);
  useEffect(() => {
    void reload().catch(() => setError('Could not load saved circles. Tap to retry.'));
  }, [reload]);
  async function save(next: AmberSpace['memberships']) {
    if (!ready) throw Error('Load your circles before changing membership.');
    const known = [...circles];
    for (const category of NETWORK_CATEGORIES) {
      const previous = [...(memberships[category] ?? [])].sort();
      const selected = [...new Set(next[category] ?? [])].sort();
      if (JSON.stringify(previous) === JSON.stringify(selected)) continue;
      const matches = known.filter(
        (c) =>
          c.origin !== 'inbound' &&
          (c.kindTag || c.name).trim().toLowerCase() === category.toLowerCase(),
      );
      // Several existing circles may share a kind. Never collapse them into one implicitly.
      if (matches.length > 1)
        throw Error(
          `Edit your ${category} circles individually in Account settings; this view combines ${matches.length} saved circles.`,
        );
      let group = matches[0];
      if (!group) {
        const created = await createCircle(category, '#A9641D', '', category);
        if (!created.ok) throw Error(`Could not create ${category}.`);
        group = created.data.circle;
        known.push(group);
        setCircles([...known]);
      }
      const saved = await setCircleMembers(group.id, selected);
      if (!saved.ok || saved.data.unknown) {
        await reload();
        throw Error(`Could not save every ${category} member. Reopen to review.`);
      }
      setMemberships((old) => ({ ...old, [category]: selected }));
    }
    await reload();
  }
  return { memberships, ready, error, reload, save };
}
