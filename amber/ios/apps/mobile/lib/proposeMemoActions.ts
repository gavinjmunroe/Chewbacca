import { parseMemoObjects, type MemoSorting } from './memoObjects';
import { callMedhaId } from './medhaId';
import { captureContacts } from './captureInput';
import { parseMemoActions, type ReviewRequest } from './memoActions';
export async function sortMemo(
  text: string,
  contacts: { id: string; name: string }[],
  signal: AbortSignal,
): Promise<MemoSorting> {
  const now = new Date();
  const result = await callMedhaId<{ actions: unknown[]; objects: unknown }>({
    path: '/v1/me/capture/prepare',
    method: 'POST',
    requireAuth: true,
    signal,
    timeoutMs: 60000,
    retries: 0,
    body: {
      text,
      contacts: captureContacts(text, contacts),
      now: now.toISOString(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    },
  });
  if (!result.ok) throw Error('Could not prepare actions');
  return {
    text,
    objects: parseMemoObjects(
      result.data.objects,
      contacts.map((c) => c.id),
    ),
    actions: result.data.actions,
  };
}
export async function proposeMemoActions(
  text: string,
  contacts: { id: string; name: string }[],
  signal: AbortSignal,
): Promise<ReviewRequest[]> {
  const sorted = await sortMemo(text, contacts, signal);
  return parseMemoActions(
    JSON.stringify({ actions: sorted.actions }),
    contacts.map((c) => c.id),
  );
}
