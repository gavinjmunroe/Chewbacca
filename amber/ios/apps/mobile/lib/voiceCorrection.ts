import { callMedhaId } from './medhaId';

// Teach the transcription dictionary from an edit the user made.
//
// The loop this closes: /v1/voice/transcribe already biases Whisper with the user's
// contact names AND with previously-learned spellings, so once a correction is stored,
// future transcripts adopt it. This is what stores it — you say "AJ", it transcribes
// "AJ", you fix it to "Ajay", and the next note spells it your way.
//
// FIRE AND FORGET, ALWAYS. Never await this in a save path and never surface an error
// from it. A dropped correction costs one repeated mistake; a save that failed because
// the learning call failed costs the user their words. The server is equally forgiving:
// it returns 200 with `learned: []` whenever it is not confident, which is most of the
// time by design.
export function learnFromCorrection(
  original: string,
  corrected: string,
  contactId?: string,
): void {
  const a = (original ?? '').trim();
  const b = (corrected ?? '').trim();
  // Nothing changed, or there is nothing to compare against.
  if (!a || !b || a === b) return;
  void callMedhaId<{ ok: boolean; learned: string[] }>({
    path: '/v1/voice/correction',
    method: 'POST',
    requireAuth: true,
    body: { original: a, corrected: b, ...(contactId ? { contactId } : {}) },
    tag: 'POST voice correction',
  }).catch(() => {
    /* deliberately silent — see above */
  });
}
