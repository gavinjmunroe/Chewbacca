import { callMedhaId, type MedhaIdResult } from './medhaId';

// Send a recorded audio clip (base64) to the batch transcription model. More
// accurate than live streaming, especially for names, since it sees the whole
// clip at once. Returns the transcript only; the caller runs capture.
export function transcribeVoice(
  audioBase64: string,
  mimeType = 'audio/m4a',
  signal?: AbortSignal,
): Promise<MedhaIdResult<{ transcript: string }>> {
  return callMedhaId<{ transcript: string }>({
    path: '/v1/voice/transcribe',
    method: 'POST',
    body: { audio: audioBase64, mimeType },
    requireAuth: true,
    // One bounded user attempt covers the server's provider fallback path.
    timeoutMs: 180_000,
    retries: 0,
    signal,
  });
}
