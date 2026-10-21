import { useCallback, useEffect, useRef, useState } from 'react';
import {
  useAudioRecorder,
  RecordingPresets,
  requestRecordingPermissionsAsync,
} from 'expo-audio';
import { configureVoiceAudio, releaseVoiceAudio } from './voiceAudio';
import { transcribeVoice } from './voiceTranscribe';
import { toast } from './toast';

// Shared voice-to-text dictation hook for the soundboard-style surfaces (contacts
// search, add-favorite note, the full-screen voice surface). It is the SAME
// record→transcribe pattern VoiceNoteRecorder / AskChat already use, factored out
// so those surfaces don't reinvent it: record the whole clip with expo-audio, then
// batch-transcribe it via /v1/voice/transcribe (Groq Whisper, with an OpenAI
// fallback) and hand the finished transcript back through onUtterance.
//
// This replaced the old live-streaming OpenAI Realtime "soundboard": there is no
// partial/live transcript any more — the transcript arrives once, on stop. Batch
// transcription is far more accurate on names than live streaming was.

// Read a recorded file URI into base64 without an extra dependency.
async function fileToBase64(uri: string): Promise<string> {
  const res = await fetch(uri);
  const blob = await res.blob();
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('read_failed'));
    reader.onloadend = () => resolve(String(reader.result ?? '').split(',')[1] ?? '');
    reader.readAsDataURL(blob);
  });
}

export type UseVoiceDictation = {
  /** True while the mic is live (recording). */
  active: boolean;
  /** True after stop, while the clip is being transcribed. */
  transcribing: boolean;
  /** Begin recording. No-op if already recording. */
  start: () => void;
  /** Stop recording, transcribe the clip, and emit the transcript via onUtterance. */
  stop: () => void;
  /** Stop recording and discard it — no transcription, no onUtterance. */
  cancel: () => void;
  /**
   * The live mic level in dB (roughly -160..0), or undefined when not recording.
   * Feed it to `RecordingWaveform` to draw the peaks-and-valleys while talking.
   * Stable identity, so the waveform's polling interval is not torn down and
   * rebuilt on every parent re-render.
   */
  getMetering: () => number | undefined | null;
};

/**
 * Drive one record→transcribe dictation surface. Tap to start recording; on stop
 * the whole clip is transcribed and the finished text is handed to onUtterance.
 * The mic is released on unmount if still live.
 */
export function useVoiceDictation(opts: { onUtterance: (text: string) => void }): UseVoiceDictation {
  // Metering has to be requested at CONSTRUCTION time — flipping it on later does
  // nothing, and `getStatus().metering` stays undefined, which silently renders a
  // flat waveform. Same construction VoiceNoteRecorder uses.
  const recorder = useAudioRecorder({
    ...RecordingPresets.HIGH_QUALITY,
    isMeteringEnabled: true,
  });
  const [active, setActive] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  // Source of truth for "is the mic live", so start/stop never fight a stale
  // closure over the `active` state.
  const recordingRef = useRef(false);

  // Held in a ref so start()/stop() never need onUtterance in their dep lists.
  const onUtteranceRef = useRef(opts.onUtterance);
  onUtteranceRef.current = opts.onUtterance;

  const start = useCallback(() => {
    if (recordingRef.current) return;
    recordingRef.current = true;
    void (async () => {
      const perm = await requestRecordingPermissionsAsync().catch(() => ({ granted: false }));
      if (!perm.granted) {
        recordingRef.current = false;
        toast.error('Microphone access is needed for voice.');
        return;
      }
      await configureVoiceAudio();
      try {
        await recorder.prepareToRecordAsync();
        recorder.record();
        setActive(true);
      } catch {
        recordingRef.current = false;
        toast.error('Could not start recording.');
        void releaseVoiceAudio();
      }
    })();
  }, [recorder]);

  const stop = useCallback(() => {
    if (!recordingRef.current) return;
    recordingRef.current = false;
    setActive(false);
    setTranscribing(true);
    void (async () => {
      try {
        await recorder.stop().catch(() => {});
        const uri = recorder.uri;
        void releaseVoiceAudio();
        if (!uri) return;
        const base64 = await fileToBase64(uri).catch(() => '');
        if (!base64) return;
        const res = await transcribeVoice(base64, 'audio/m4a');
        const t = res.ok ? res.data.transcript.trim() : '';
        if (t) onUtteranceRef.current(t);
      } finally {
        setTranscribing(false);
      }
    })();
  }, [recorder]);

  const cancel = useCallback(() => {
    if (!recordingRef.current) return;
    recordingRef.current = false;
    setActive(false);
    recorder.stop().catch(() => {});
    void releaseVoiceAudio();
  }, [recorder]);

  // Release the mic if the surface unmounts mid-recording.
  useEffect(
    () => () => {
      if (recordingRef.current) {
        recordingRef.current = false;
        recorder.stop().catch(() => {});
        void releaseVoiceAudio();
      }
    },
    [recorder],
  );

  const getMetering = useCallback(() => {
    try {
      return recorder.getStatus().metering;
    } catch {
      return undefined;
    }
  }, [recorder]);

  return { active, transcribing, start, stop, cancel, getMetering };
}
