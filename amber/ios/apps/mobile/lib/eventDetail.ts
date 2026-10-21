import type { AgendaItem } from './agenda';
export function eventPeople(item: AgendaItem | null) {
  const seen = new Set<string>();
  return [item?.withPerson, ...(item?.people || [])].flatMap(person => {
    if (!person?.name) return [];
    const key = person.contactId || person.name.toLowerCase();
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ contactId:person.contactId, name:person.name }];
  });
}
export function mapsLinks(place: string) {
  const query = encodeURIComponent(place.trim());
  return { map:`https://maps.apple.com/?q=${query}`, directions:`https://maps.apple.com/?daddr=${query}` };
}
