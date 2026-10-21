import { callMedhaId } from './medhaId';
import { uploadNoteAudio } from './noteMedia';
import type { MemoEntry } from './memoActions';

/** A private memo uses Main's conversation/audio storage; contact-note IDs are a different table. */
export async function syncJournalMemo(entry: MemoEntry, onTranscriptSaved?: (cloud: NonNullable<MemoEntry['cloud']>) => void): Promise<NonNullable<MemoEntry['cloud']>> {
  let cloud = entry.cloud;
  if (!cloud) throw Error('Missing journal identity');
  try {
    if (!cloud.transcriptSaved) {
      const saved = await callMedhaId<{ ok: boolean; conversationId: string; text?: string }>({
        path: `/v1/me/journal/${encodeURIComponent(cloud.conversationId)}`,
        method: 'PUT',
        requireAuth: true,
        body: { text: cloud.originalText, createdAt: entry.createdAt, voice: !!entry.media },
      });
      if (!saved.ok || !saved.data.ok || saved.data.conversationId !== cloud.conversationId)
        return { ...cloud, error: 'Cloud save unavailable. Your memo is still on this device.' };
      if (typeof saved.data.text === 'string' && saved.data.text !== cloud.originalText) {
        if (saved.data.text !== entry.text)
          return { ...cloud, error: 'This memo has a newer cloud transcript. Your local words are safe; reopen the cloud memo before changing it.' };
        cloud = { ...cloud, syncedText: saved.data.text };
      }
    }
    cloud = { ...cloud, transcriptSaved: true };
    const previousText = cloud.syncedText ?? cloud.originalText;
    if (entry.text !== previousText) {
      const corrected = await callMedhaId<{ ok: boolean; conversationId: string; text: string }>({
        path: `/v1/me/journal/${encodeURIComponent(cloud.conversationId)}`,
        method: 'PATCH', requireAuth: true, retries: 0,
        body: { previousText, text: entry.text },
      });
      if (!corrected.ok || !corrected.data.ok || corrected.data.conversationId !== cloud.conversationId || corrected.data.text !== entry.text)
        return { ...cloud, error: 'Your edited transcript is saved on this device. Cloud update was not confirmed; tap to retry.' };
      cloud = { ...cloud, syncedText: entry.text };
    }
    const transcriptSaved = true;
    onTranscriptSaved?.({ ...cloud, error: undefined });
    if (entry.media && !cloud.audioSaved) {
      const audioSaved = await uploadNoteAudio(cloud.conversationId, entry.media.uri, entry.media).catch(() => false);
      return { ...cloud, transcriptSaved, audioSaved, error: audioSaved ? undefined : 'Transcript saved. Audio is still on this device; tap to retry.' };
    }
    return { ...cloud, transcriptSaved, error: undefined };
  } catch {
    return { ...cloud, error: 'Cloud save unavailable. Your memo is still on this device.' };
  }
}
export function journalSyncLabel(entry: MemoEntry, sample = false): string {
  if (sample) return 'Saved on this device';
  if (entry.cloud?.error) return entry.cloud.error;
  if (!entry.cloud?.transcriptSaved) return 'Saved on this device';
  if (entry.text !== (entry.cloud.syncedText ?? entry.cloud.originalText))
    return 'Transcript edits saved on this device';
  if (entry.media && !entry.cloud.audioSaved) return 'Transcript saved · audio on this device';
  return 'Saved privately to Amber';
}
