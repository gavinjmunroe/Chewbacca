import { useCallback, useRef, useState } from 'react';
import { useAudioRecorder, RecordingPresets, requestRecordingPermissionsAsync } from 'expo-audio';
import { callMedhaId } from './medhaId';
import { configureVoiceAudio, releaseVoiceAudio } from './voiceAudio';
import { uploadAudioSequence } from './noteMedia';
import { toast } from './toast';
import { levelToPeak, thinPeaks } from './voicePeaks';

/**
 * LEAVING A VOICE COMMENT.
 *
 * "There should be a little voice thing next to it, like a waveform, where I
 *  can leave a voice comment, which should be transcribed and shown with the
 *  voice."
 *
 * THREE PIECES, AND TWO OF THEM ALREADY EXISTED. The recorder is expo-audio
 * with metering on, exactly as useVoiceDictation and VoiceNoteRecorder
 * construct it -- metering has to be asked for at CONSTRUCTION or getStatus()
 * returns undefined forever and the waveform draws flat. The upload is
 * uploadAudioSequence in lib/noteMedia, which is the same three legs note audio
 * has used since it shipped: ask for a signed PUT, send the bytes, let the
 * SERVER verify what actually landed in the bucket.
 *
 * WHAT IS NEW is only that the finalize step comes back with a transcript. That
 * is produced server-side rather than on the phone, because the transcript is
 * what makes a voice comment searchable, readable in a notification, and
 * countable like a typed one -- and a phone-side transcript would be whatever
 * that particular OS produced, or nothing at all for anybody whose OS declined.
 *
 * A FAILED TRANSCRIPTION IS NOT A FAILED COMMENT. "" is a real answer: the clip
 * still posts, the waveform still plays, and the comment has no words under it
 * -- which is also exactly what two seconds of somebody laughing produces.
 */

// The waveform arithmetic lives in lib/voicePeaks so a test can reach it
// without loading expo-audio. Re-exported so callers have one import.
export { levelToPeak, thinPeaks } from './voicePeaks';

const BASE = '/v1/me/connect/feed/comments/audio';

/** What a finished recording knows about itself before it is uploaded. */
export type RecordedClip = { uri: string; durationMs: number; peaks: number[] };

/** What the server gives back once it has the bytes. */
export type UploadedClip = { mediaId: string; transcript: string };

/** How often the level is sampled while recording. */
const SAMPLE_MS = 80;
/** The longest a voice comment may be. The server enforces the same. */
export const MAX_CLIP_MS = 3 * 60 * 1000;

/**
 * Record one clip. Returns null if it was cancelled, refused or empty.
 *
 * THE MIC IS RELEASED ON EVERY PATH, including the failures. A recorder left
 * live holds the audio session, which on iOS means the next sound the app tries
 * to play is silent and nothing says why.
 */
export function useCommentRecorder() {
  const recorder = useAudioRecorder({
    ...RecordingPresets.HIGH_QUALITY,
    isMeteringEnabled: true,
  });
  const [recording, setRecording] = useState(false);
  const [uploading, setUploading] = useState(false);
  const liveRef = useRef(false);
  const peaksRef = useRef<number[]>([]);
  const startedAtRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopSampling = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
  }, []);

  const start = useCallback(async (): Promise<boolean> => {
    if (liveRef.current) return false;
    const granted = await requestRecordingPermissionsAsync().catch(() => null);
    if (!granted?.granted) {
      toast.error('Amber needs the microphone to record that.');
      return false;
    }
    liveRef.current = true;
    peaksRef.current = [];
    startedAtRef.current = Date.now();
    try {
      await configureVoiceAudio();
      await recorder.prepareToRecordAsync();
      recorder.record();
      setRecording(true);
      timerRef.current = setInterval(() => {
        const level = recorder.getStatus?.()?.metering;
        peaksRef.current.push(levelToPeak(level));
        // A clip that runs past the limit is stopped rather than truncated
        // server-side, so what the person heard themselves record is what posts.
        if (Date.now() - startedAtRef.current >= MAX_CLIP_MS) void stop();
      }, SAMPLE_MS);
      return true;
    } catch {
      liveRef.current = false;
      setRecording(false);
      stopSampling();
      await releaseVoiceAudio().catch(() => {});
      toast.error('Could not start recording.');
      return false;
    }
    // `stop` is stable and defined below; referencing it here would need it in
    // the dep list and create a cycle. The interval closes over the latest one
    // through the ref-backed implementation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recorder, stopSampling]);

  const finish = useCallback(
    async (keep: boolean): Promise<RecordedClip | null> => {
      if (!liveRef.current) return null;
      liveRef.current = false;
      stopSampling();
      setRecording(false);
      let uri: string | null = null;
      try {
        await recorder.stop();
        uri = recorder.uri ?? null;
      } catch {
        uri = null;
      }
      await releaseVoiceAudio().catch(() => {});
      if (!keep || !uri) return null;
      const durationMs = Date.now() - startedAtRef.current;
      // Under a third of a second is a mis-tap, not a message.
      if (durationMs < 350) return null;
      return { uri, durationMs, peaks: thinPeaks(peaksRef.current) };
    },
    [recorder, stopSampling],
  );

  const stop = useCallback(() => finish(true), [finish]);
  const cancel = useCallback(() => finish(false), [finish]);

  /**
   * Record → upload → transcribe, as one call for the composer.
   *
   * Returns null on every failure, having already said so. The caller's job is
   * to put the mic button back, not to work out what went wrong.
   */
  const upload = useCallback(async (clip: RecordedClip): Promise<UploadedClip | null> => {
    setUploading(true);
    const res = await uploadAudioSequence<{ mediaId: string; transcript?: string }>(
      BASE,
      clip.uri,
      { durationMs: clip.durationMs, peaks: clip.peaks },
    );
    setUploading(false);
    if (!res?.mediaId) {
      toast.error('Could not send that recording.');
      return null;
    }
    return { mediaId: res.mediaId, transcript: (res.transcript ?? '').trim() };
  }, []);

  const getMetering = useCallback(() => recorder.getStatus?.()?.metering, [recorder]);

  return { recording, uploading, start, stop, cancel, upload, getMetering };
}

/**
 * A short-lived URL to play one comment's clip, plus the speaker's waveform.
 *
 * MINTED PER PLAY. The URL is the capability and it dies in minutes, so it is
 * not carried in the comment list -- a list can sit in a cache for an hour, and
 * a dead URL in it is a play button that does nothing.
 */
export async function commentAudioUrl(
  commentId: string,
): Promise<{ playbackUrl: string; durationMs: number; peaks: number[] } | null> {
  const res = await callMedhaId<{ playbackUrl: string; durationMs: number; peaks: number[] }>({
    path: `/v1/me/connect/feed/comments/${encodeURIComponent(commentId)}/audio`,
    method: 'GET',
    requireAuth: true,
  });
  return res.ok && res.data?.playbackUrl ? res.data : null;
}
