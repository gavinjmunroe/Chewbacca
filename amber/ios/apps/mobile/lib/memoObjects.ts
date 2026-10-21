export type MemoObjects = {
  people: { name: string; contactId: string; detail: string; places: string[] }[];
  places: string[];
  plans: { title: string; detail: string; places: string[] }[];
};
export type MemoSorting = { text: string; objects: MemoObjects; actions: unknown[] };
export function parseMemoObjects(raw: unknown, contactIds: string[]): MemoObjects {
  if (!raw || typeof raw !== 'object') throw Error('Memo sorting is unavailable.');
  const value = raw as Record<string, unknown>;
  if (![value.people, value.places, value.plans].every(Array.isArray))
    throw Error('Invalid memo objects');
  const str = (v: unknown) => (typeof v === 'string' ? v.slice(0, 1000) : '');
  const places = [...new Set((value.places as unknown[]).map(str).filter(Boolean))].slice(0, 12);
  const tags = (v: unknown) =>
    Array.isArray(v) ? v.map(str).filter((p) => places.includes(p)) : [];
  const people = (value.people as Record<string, unknown>[])
    .filter((p) => p && str(p.name))
    .slice(0, 12)
    .map((p) => ({
      name: str(p.name),
      contactId: contactIds.includes(str(p.contactId)) ? str(p.contactId) : '',
      detail: str(p.detail),
      places: tags(p.places),
    }));
  const plans = (value.plans as Record<string, unknown>[])
    .filter((p) => p && str(p.title))
    .slice(0, 12)
    .map((p) => ({ title: str(p.title), detail: str(p.detail), places: tags(p.places) }));
  return { people, places, plans };
}
