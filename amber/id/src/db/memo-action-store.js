import { createHash } from 'node:crypto';
import { insertObservation } from './observations-store.js';

// Scope a client request to its authenticated owner and destination. No new table
// or migration: the existing primary keys are the atomic uniqueness boundary.
export function memoActionResourceId(ownerId, kind, requestId) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId || ''))
    throw Error('invalid_request_id');
  const hash = createHash('sha256').update(JSON.stringify([ownerId, kind, requestId.toLowerCase()])).digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

export async function saveMemoContactNote({ ownerId, contactId, text, requestId }) {
  const result = await insertObservation({
    ownerId, contactId, kind: 'note', body: text, source: 'contact_note',
    observationId: memoActionResourceId(ownerId, 'contact', requestId),
    participants: [{ contactId, role: 'participant' }],
  });
  return { noteId: result.observationId, replayed: !!result.replayed };
}
