import type { MemoEntry } from './memoActions';
import type { MemoSorting } from './memoObjects';
export type MemoFocus = { kind: 'contact' | 'calendar'; label: string; index: number };
const key = (v: unknown) => (typeof v === 'string' ? v.trim().toLocaleLowerCase() : '');
/** Keep matching scoped to the selected extracted object, never the first unrelated draft. */
export function focusedMemoSorting(
  entry: MemoEntry,
  sorting: MemoSorting | undefined,
  focus: MemoFocus,
): MemoSorting {
  const current = sorting?.text === entry.text ? sorting : undefined;
  const person = current?.objects.people[focus.index];
  const plan = current?.objects.plans[focus.index];
  const action = current?.actions.find((raw) => {
    if (!raw || typeof raw !== 'object') return false;
    const a = raw as Record<string, unknown>;
    return (
      a.kind === focus.kind &&
      key(focus.kind === 'contact' ? a.personName : a.title) === key(focus.label)
    );
  });
  const fallback =
    focus.kind === 'contact'
      ? {
          kind: 'contact',
          text: person?.detail || entry.text,
          personName: focus.label,
          contactId: person?.contactId || '',
          place: person?.places.join(' · ') || '',
        }
      : {
          kind: 'calendar',
          text: plan?.detail || entry.text,
          title: focus.label,
          needsTiming: true,
          place: plan?.places.join(' · ') || '',
        };
  return {
    text: entry.text,
    objects: current?.objects ?? { people: [], plans: [], places: [] },
    actions: [action || fallback],
  };
}
/** Context is displayed on its object; only spoken words belong in the transcript disclosure. */
export function memoTranscript(text: string): string {
  if (!/^Attached to (person|plan):[^\n]+\n/.test(text)) return text;
  const marker = '\n\nVoice memo:\n';
  const at = text.indexOf(marker);
  return at >= 0 ? text.slice(at + marker.length) : text;
}
