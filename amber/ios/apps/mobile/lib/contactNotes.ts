import { callMedhaId, type MedhaIdResult } from './medhaId';

// Capture a note about a contact SERVER-SIDE, through the same pipeline as chat
// and voice. Nothing is stored on-device: the note becomes contact facts that
// feed PeopleRank and can be shared, privacy-gated like everything else.

export type CaptureOutcome = {
  route: string;
  status: string;
  contactId?: string;
  resolvedName?: string;
};

export function captureContactNote(
  contactId: string,
  text: string,
  requestId?: string,
): Promise<MedhaIdResult<{ noteId: string; contactId: string; status: string; outcomes: CaptureOutcome[] }>> {
  return callMedhaId<{ noteId: string; contactId: string; status: string; outcomes: CaptureOutcome[] }>({
    path: `/v1/me/contacts/${encodeURIComponent(contactId)}/note`,
    method: 'POST',
    body: { text, ...(requestId ? { requestId } : {}) },
    requireAuth: true,
    timeoutMs: 90_000,
    retries: 0,
  });
}
