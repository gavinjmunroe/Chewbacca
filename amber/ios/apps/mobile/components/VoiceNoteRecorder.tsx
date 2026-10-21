import * as Haptics from 'expo-haptics';
import { ComputerMark } from './ComputerMark';
import { requestStyles as reviewStyle } from './MemoStyles';
import { cl } from '../lib/classical';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useReducedMotion } from './useReducedMotion';
import {
  ActivityIndicator,
  Animated,
  Modal,
  Pressable,
  ScrollView,
  Switch,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Check,
  ChevronDown,
  Lock,
  Share2,
  X,
  Pause,
  Mic,
  CalendarDays,
  Users,
} from 'lucide-react-native';
import { useAudioRecorder, RecordingPresets, requestRecordingPermissionsAsync } from 'expo-audio';
import { Text } from './Text';
import { RecordingWaveform, barsForWidth } from './RecordingWaveform';
import { ShareScopePicker } from './ShareScopePicker';
import { transcribeVoice } from '../lib/voiceTranscribe';
import { createRecordingSession, recordingDurationMs } from '../lib/recordingSession';
import { configureVoiceAudio, releaseVoiceAudio } from '../lib/voiceAudio';
import { toast } from '../lib/toast';
import { type NoteShareScope } from '../lib/noteShares';
import { LIGHT } from '../lib/theme';
import { RecorderEgg, forgetRecorderEggPosition } from './RecorderEgg';
import { elevation, radius, spacing } from '../lib/tokens';
import { createMeter, downsamplePeaks, meterSample, toStoredLevel } from '../lib/waveform';

// The recorder samples the mic every SAMPLE_MS while recording and keeps the
// levels, so the clip carries the SENDER'S waveform to everyone who plays it back
// later. Without this each listener would have to invent a shape, and two people
// looking at the same note would see different pictures.
const SAMPLE_MS = 100;

async function stopReleasedRecorder(recorder: { stop: () => Promise<void> }) {
  try {
    await recorder.stop();
  } catch {
    /* Expo may release its shared object before effect cleanup. */
  }
}

// levelFromDb / downsamplePeaks moved to lib/waveform.ts. Their old comment
// here said the normalization must match RecordingWaveform's EXACTLY, and the
// profile voice bio is now a second recorder that has to agree with both — the
// way "exactly" survives a second caller is one copy, not three places
// remembering the same constants.

function mmss(total: number): string {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

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

// The voice-note recorder: record the whole clip, then transcribe it with the
// batch model on tap (more accurate than live streaming, names included). Shows
// a waveform + timer while recording, and a transcribing state on confirm. Used
// for the home note, contact notes, and Ask notes; hands the transcript back via
// onDone so each caller runs its own capture.
export function VoiceNoteRecorder({
  visible,
  title,
  onCancel,
  onDone,
  onBeforeProcess,
  glow = false,
  embedded = false,
  preserveSurface = false,
  completed = false,
  processingActions = false,
  reviewBusy = false,
  reviewContent,
  onDestination,
  onProcessingChange,
  localOnly = false,
  shareControl = false,
  minimizable = false,
  onFloatingChange,
}: {
  glow?: boolean;
  embedded?: boolean;
  preserveSurface?: boolean;
  completed?: boolean;
  processingActions?: boolean;
  reviewBusy?: boolean;
  reviewContent?: ReactNode;
  onDestination?: (kind: 'contact' | 'calendar' | 'task') => void;
  onProcessingChange?: (processing: boolean) => void;
  localOnly?: boolean;
  visible: boolean;
  title?: string;
  onCancel: () => void;
  onBeforeProcess?: (media: {
    uri: string;
    durationMs: number;
    peaks: number[];
  }) => Promise<{ uri: string; durationMs: number; peaks: number[] }>;
  // The chosen share scope is passed alongside the transcript when the
  // share-control is enabled and turned on; undefined means keep the note
  // private (the default). Callers that don't opt into shareControl can ignore
  // the second argument entirely.
  // The third argument is the RECORDING ITSELF: where the file is, how long it
  // ran, and its waveform. Optional, so callers that only want the transcript are
  // unaffected. The caller uploads it once the note's id exists — which is only
  // after the capture stream resolves, so it cannot happen here.
  onDone: (
    transcript: string,
    scope?: NoteShareScope,
    media?: { uri: string; durationMs: number; peaks: number[] },
  ) => void | Promise<void>;
  // Opt in to the in-box "share when saved" control (toggle defaults to
  // private; flipping it on reveals a Network/Circle/Contact picker).
  shareControl?: boolean;
  /**
   * Allow the sheet to be tucked away WITHOUT stopping the recording, leaving a
   * floating pill you tap to come back and finish.
   *
   * Opt-in, because it draws that pill as an absolutely-positioned view in
   * whatever tree renders this component. That is only correct where the parent
   * is a full-screen root — home.tsx — and would land in the wrong place inside
   * a card or a scroll view, which is where the other callers mount it.
   */
  minimizable?: boolean;
  /**
   * Told when the recorder is minimized and floating, so the surface underneath
   * can react. The one bar above the tabs goes inert while this is true: it stays
   * on screen -- nothing jumps -- but it stops offering a text field and a second
   * record button while a recording is already in flight.
   */
  onFloatingChange?: (floating: boolean) => void;
}) {
  const insets = useSafeAreaInsets();
  // Share-control state. Defaults to PRIVATE (toggle off). When on, `scope`
  // holds the chosen audience; it starts at 'network' as the first reveal.
  const [shareOn, setShareOn] = useState(false);
  const [scope, setScope] = useState<NoteShareScope>({
    visibility: 'network',
    targetId: null,
    targetName: null,
  });
  const session = useRef(createRecordingSession()).current;
  const stoppedMedia = useRef<{ uri: string; durationMs: number; peaks: number[] } | null>(null);
  const finishRef = useRef<((nativeFinished?: boolean) => Promise<void>) | null>(null);
  const doneRef = useRef(false);
  const nativeReady = useRef(false);
  const durationRef = useRef(0);
  const resumedAt = useRef<number | null>(null);
  const beforeResume = useRef(0);
  const activeElapsed = () =>
    beforeResume.current + (resumedAt.current === null ? 0 : performance.now() - resumedAt.current);
  // Metering must be enabled at recorder-construction time so `getStatus()`
  // reports a live audio level (in dB) that drives the waveform.
  const recorder = useAudioRecorder(
    { ...RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true },
    (status) => {
      // Expo resets currentTime/duration when AVAudioRecorder stops itself. Observe
      // its completion event instead of hoping a JS poll catches exactly 5:00.
      if (
        !status.isFinished ||
        !session.isCurrent(session.current()) ||
        !nativeReady.current ||
        doneRef.current
      )
        return;
      if (recorder.isRecording) return; // Ignore a delayed completion from an earlier take.
      if (status.hasError) {
        nativeReady.current = false;
        setCaptureError(
          'The microphone stopped unexpectedly. Stop and save to preserve any recorded audio.',
        );
        void releaseVoiceAudio();
        return;
      }
      void finishRef.current?.(true);
    },
  );
  const [ready, setReady] = useState(false);
  const [paused, setPaused] = useState(false);
  const [captureError, setCaptureError] = useState('');
  const [seconds, setSeconds] = useState(0);
  const [transcribing, setTranscribing] = useState(false);
  useEffect(() => {
    onProcessingChange?.(transcribing);
    return () => onProcessingChange?.(false);
  }, [transcribing, onProcessingChange]);
  const reduceMotion = useReducedMotion();
  const processingOpacity = useRef(new Animated.Value(1)).current;
  const processing = transcribing || processingActions;
  useEffect(() => {
    if (!preserveSurface || !processing || reduceMotion) {
      processingOpacity.setValue(1);
      return;
    }
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(processingOpacity, { toValue: 0.35, duration: 650, useNativeDriver: true }),
        Animated.timing(processingOpacity, { toValue: 1, duration: 650, useNativeDriver: true }),
      ]),
    );
    pulse.start();
    return () => {
      pulse.stop();
      processingOpacity.setValue(1);
    };
  }, [preserveSurface, processing, reduceMotion, processingOpacity]);
  // The measured width of the waveform slot between the X and the timer. The bar
  // count is derived from it, because a hard-coded count is an intrinsic width:
  // `bars={44}` at barWidth 3 + gap 3 is 261pt of waveform in a slot that is about
  // 150pt wide on a 6.1" phone, and the overflow drew straight over the cancel
  // button. Measured means it fits on every screen, including an SE.
  const [waveWidth, setWaveWidth] = useState(0);
  // THE SHEET IS HIDDEN, THE RECORDER IS NOT. Everything that keeps the recording
  // alive — the expo-audio recorder, the 1Hz clock, the 10Hz peak sampler — lives
  // in THIS component's body, while the sheet is the Modal's children. RN's Modal
  // renders null when `visible` is false, so flipping this unmounts the UI and
  // leaves the recording completely untouched. The start effect keys on `visible`,
  // not on this, so it does not re-run and nothing restarts.
  const [minimized, setMinimized] = useState(false);
  // Published rather than derived by the parent, because "floating" is two facts
  // this component owns and nobody else can see: it is recording, AND it has been
  // put away. Fired from an effect so the parent's state write never lands during
  // this component's render.
  useEffect(() => {
    onFloatingChange?.(visible && minimized);
  }, [visible, minimized, onFloatingChange]);
  // A ref, not state: this is written ~10x a second and must not re-render the
  // sheet on every sample.
  const peaksRef = useRef<number[]>([]);
  // ONE METER PER RECORDING. It carries the running estimate of this room's
  // noise floor and this speaker's loudness, so it must outlive a sample and
  // must not outlive the clip. Reset alongside peaksRef when recording starts.
  const meterRef = useRef(createMeter());

  // Live mic level (dB) for the waveform. Stable identity so the waveform's
  // polling interval isn't torn down/recreated on re-renders (e.g. the timer).
  const getMetering = useCallback(() => {
    try {
      return recorder.getStatus().metering;
    } catch {
      return undefined;
    }
  }, [recorder]);

  useEffect(() => {
    if (!visible) return undefined;
    const take = session.begin();
    const current = () => session.isCurrent(take);
    nativeReady.current = false;
    durationRef.current = 0;
    resumedAt.current = null;
    beforeResume.current = 0;
    doneRef.current = false;
    stoppedMedia.current = null;
    setSeconds(0);
    setReady(false);
    setPaused(false);
    setCaptureError('');
    setTranscribing(false);
    setMinimized(false);
    // A NEW take starts from the resting corner. The egg remembers where it was
    // dragged across minimize/reopen within one recording — that is the point — but
    // carrying it into an unrelated recording days later would be surprising.
    forgetRecorderEggPosition();
    // Every recording starts private; the user re-opts-in per note.
    setShareOn(false);
    setScope({ visibility: 'network', targetId: null, targetName: null });
    (async () => {
      const perm = await requestRecordingPermissionsAsync().catch(() => ({ granted: false }));
      if (!current()) return;
      if (!perm.granted) {
        if (glow)
          setCaptureError(
            'Microphone access is needed. Enable it for Amber in Settings, then try again.',
          );
        else {
          toast.error('Microphone access is needed for voice notes.');
          onCancel();
        }
        return;
      }
      try {
        await configureVoiceAudio();
        if (!current()) {
          await releaseVoiceAudio();
          return;
        }
        await recorder.prepareToRecordAsync();
        if (!current()) {
          await stopReleasedRecorder(recorder);
          await releaseVoiceAudio();
          return;
        }
        recorder.record({ forDuration: 300 });
        resumedAt.current = performance.now();
        nativeReady.current = true;
        setReady(true);
        if (glow) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      } catch {
        await releaseVoiceAudio();
        if (!current()) return;
        if (glow) setCaptureError('Could not start recording. Close and try again.');
        else {
          toast.error('Could not start recording.');
          onCancel();
        }
      }
    })();
    const id = setInterval(() => {
      try {
        if (!doneRef.current && nativeReady.current) {
          if (recorder.isRecording)
            durationRef.current = recordingDurationMs(recorder.currentTime, durationRef.current);
          setSeconds(Math.floor(durationRef.current / 1000));
          if (durationRef.current >= 300_000) void finishRef.current?.();
        }
      } catch {}
    }, 250);
    // Sampled on its own faster interval than the timer, because the waveform
    // needs ~10Hz to look like speech while the clock only needs 1Hz.
    peaksRef.current = [];
    meterRef.current = createMeter();
    const peakId = setInterval(() => {
      try {
        if (!recorder.getStatus().isRecording) return;
        peaksRef.current.push(
          toStoredLevel(meterSample(meterRef.current, recorder.getStatus().metering)),
        );
      } catch {
        // Recorder torn down mid-sample; the next tick is cleared below.
      }
    }, SAMPLE_MS);
    return () => {
      session.end(take);
      nativeReady.current = false;
      resumedAt.current = null;
      clearInterval(id);
      clearInterval(peakId);
      void stopReleasedRecorder(recorder);
      void releaseVoiceAudio();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const finish = async (nativeFinished = false) => {
    const take = session.current();
    if (!session.isCurrent(take) || transcribing || (doneRef.current && !captureError)) return;
    const controller = session.processing(take);
    const current = () => session.isCurrent(take) && !controller.signal.aborted;
    doneRef.current = true;
    setCaptureError('');
    setTranscribing(true);
    try {
      if (!stoppedMedia.current) {
        const durationMs = recordingDurationMs(
          recorder.currentTime,
          durationRef.current,
          nativeFinished ? activeElapsed() : 0,
        );
        durationRef.current = durationMs;
        resumedAt.current = null;
        nativeReady.current = false;
        setSeconds(Math.floor(durationMs / 1000));
        await recorder.stop();
        await releaseVoiceAudio();
        if (!current()) return;
        if (!recorder.uri) throw new Error('missing_recording');
        stoppedMedia.current = {
          uri: recorder.uri,
          durationMs,
          peaks: downsamplePeaks(peaksRef.current),
        };
      }
      // The original audio and journal index are durable before the network request.
      const media = onBeforeProcess
        ? await onBeforeProcess(stoppedMedia.current)
        : stoppedMedia.current;
      if (!current()) return;
      stoppedMedia.current = media;
      let transcript = '';
      if (!localOnly) {
        const base64 = await fileToBase64(media.uri).catch(() => '');
        if (!current()) return;
        if (base64) {
          const response = await transcribeVoice(base64, 'audio/m4a', controller.signal);
          if (!current()) return;
          if (response.ok) transcript = response.data.transcript.trim();
        }
      }
      const targeted = scope.visibility === 'circle' || scope.visibility === 'contact';
      const effectiveScope =
        transcript &&
        shareControl &&
        shareOn &&
        scope.visibility !== 'private' &&
        !(targeted && !scope.targetId)
          ? scope
          : undefined;
      // Empty/failed transcripts still keep the recording. Review provides retry and text entry.
      if (!current()) return;
      await onDone(transcript, effectiveScope, media);
    } catch {
      await releaseVoiceAudio();
      if (!current()) return;
      setCaptureError(
        stoppedMedia.current
          ? 'Your recording is still here. Retry saving before closing this memo.'
          : 'Could not finish the recording. Please try again.',
      );
    } finally {
      if (current()) setTranscribing(false);
    }
  };
  finishRef.current = finish;

  const cancel = () => {
    if (transcribing) return;
    doneRef.current = true;
    session.end(session.current());
    nativeReady.current = false;
    resumedAt.current = null;
    void stopReleasedRecorder(recorder);
    void releaseVoiceAudio();
    onCancel();
  };

  // `mmss` is already a module-level formatter in this file; this is the value.
  const elapsed = mmss(seconds);

  if (glow) {
    const content = (
      <>
        <View style={reviewStyle.heading}>
          <View
            style={{
              width: 8,
              height: 8,
              borderRadius: 4,
              backgroundColor: ready && !paused && !processing && !completed ? '#B5442C' : cl.ink62,
            }}
          />
          <Text style={reviewStyle.title}>
            {preserveSurface
              ? 'Voice memo'
              : captureError
                ? 'Recording unavailable'
                : transcribing
                  ? 'Preparing your memo'
                  : paused
                    ? 'Recording paused'
                    : ready
                      ? 'Listening'
                      : 'Starting microphone…'}
          </Text>
          <Pressable
            disabled={transcribing || reviewBusy}
            accessibilityRole="button"
            accessibilityLabel={completed ? 'Close memo' : 'Cancel recording'}
            onPress={cancel}
            style={reviewStyle.close}
          >
            <X color={cl.ink} />
          </Pressable>
        </View>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: 24, gap: 20, flexGrow: 1 }}
        >
          {!completed && (
            <View
              style={{
                gap: 16,
                paddingVertical: 18,
                borderRadius: 22,
                backgroundColor: cl.groundGold,
                paddingHorizontal: 16,
              }}
              onLayout={(event) =>
                setWaveWidth(Math.max(0, Math.floor(event.nativeEvent.layout.width) - 32))
              }
            >
              <Text
                style={{
                  textAlign: 'center',
                  fontSize: 32,
                  lineHeight: 44,
                  minHeight: 48,
                  paddingVertical: 2,
                  flexShrink: 0,
                  color: cl.ink,
                  fontVariant: ['tabular-nums'],
                }}
              >
                {elapsed}
              </Text>
              <Animated.View style={{ opacity: processingOpacity }}>
                {waveWidth > 0 && (
                  <RecordingWaveform
                    getMetering={getMetering}
                    active={ready && !paused && !processing && !completed}
                    color={cl.goldDeep}
                    bars={barsForWidth(waveWidth, 2.5, 2.5)}
                    barWidth={2.5}
                    gap={2.5}
                    height={64}
                    style={{ width: waveWidth }}
                  />
                )}
              </Animated.View>
              <Text
                accessibilityLiveRegion="polite"
                style={[reviewStyle.hint, { textAlign: 'center', minHeight: 36 }]}
              >
                {preserveSurface && completed
                  ? processingActions
                    ? 'Finding contact, calendar, and computer actions…'
                    : 'Recording saved'
                  : preserveSurface && transcribing
                    ? 'Processing your recording…'
                    : localOnly
                      ? 'Private on this device · up to 5 minutes'
                      : 'Record your thought. Amber will find related people and plans.'}
              </Text>
            </View>
          )}
          {completed && onDestination && (
            <>
              <View style={reviewStyle.destinations}>
                {[
                  { key: 'contact' as const, label: 'Contact', Icon: Users },
                  { key: 'calendar' as const, label: 'Calendar', Icon: CalendarDays },
                  { key: 'task' as const, label: 'Computer', Icon: ComputerMark },
                ].map(({ key, label, Icon }) => (
                  <Pressable
                    key={key}
                    style={reviewStyle.destination}
                    accessibilityRole="button"
                    accessibilityLabel={`Add ${label.toLowerCase()} action`}
                    disabled={!completed || processing || reviewBusy || !onDestination}
                    onPress={() => onDestination?.(key)}
                  >
                    <Icon size={24} color={completed && !processing ? cl.goldDeep : cl.ink62} />
                    <Text style={reviewStyle.hint}>{label}</Text>
                  </Pressable>
                ))}
              </View>
              <Text style={[reviewStyle.hint, { minHeight: 36 }]}>
                {completed && !processingActions
                  ? 'Choose a destination above, then review its action below.'
                  : 'Your transcript and action drafts will appear here when you finish.'}
              </Text>
            </>
          )}
          {reviewContent}
          {captureError ? (
            <Text accessibilityRole="alert" style={reviewStyle.body}>
              {captureError}
            </Text>
          ) : null}
        </ScrollView>
        <View style={{ padding: 16, paddingTop: 8, flexDirection: 'row', gap: 12 }}>
          <Pressable
            disabled={!ready || processing || completed || reviewBusy || !!captureError}
            accessibilityRole="button"
            accessibilityLabel={paused ? 'Resume recording' : 'Pause recording'}
            style={[reviewStyle.close, { minWidth: 54 }]}
            onPress={() => {
              try {
                if (paused) {
                  recorder.record({
                    forDuration: Math.max(0.1, (300_000 - durationRef.current) / 1000),
                  });
                  beforeResume.current = durationRef.current;
                  resumedAt.current = performance.now();
                } else {
                  durationRef.current = recordingDurationMs(
                    recorder.currentTime,
                    durationRef.current,
                  );
                  beforeResume.current = durationRef.current;
                  resumedAt.current = null;
                  recorder.pause();
                }
                setPaused(!paused);
                void Haptics.selectionAsync().catch(() => {});
              } catch {
                setCaptureError('Could not change recording state.');
              }
            }}
          >
            {paused ? <Mic color={cl.ink} /> : <Pause color={cl.ink} />}
          </Pressable>
          <Pressable
            disabled={!ready || processing || reviewBusy}
            accessibilityRole="button"
            onPress={() => {
              void Haptics.selectionAsync().catch(() => {});
              if (completed) onCancel();
              else void finish();
            }}
            style={[
              reviewStyle.confirm,
              { flex: 1, opacity: ready && !processing && !reviewBusy ? 1 : 0.5 },
            ]}
          >
            {processing || reviewBusy ? (
              <ActivityIndicator color={cl.card} />
            ) : (
              <>
                <View
                  style={{ width: 12, height: 12, borderRadius: 3, backgroundColor: cl.card }}
                />
                <Text style={reviewStyle.confirmText}>
                  {completed ? 'Done' : captureError ? 'Retry saving' : 'Stop & save'}
                </Text>
              </>
            )}
          </Pressable>
        </View>
      </>
    );
    if (embedded) return content;
    return (
      <Modal
        visible={visible}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (!transcribing) cancel();
        }}
      >
        <View style={reviewStyle.backdrop}>
          <View style={reviewStyle.glow}>
            <View style={reviewStyle.sheet}>{content}</View>
          </View>
        </View>
      </Modal>
    );
  }

  return (
    <>
      {/* What you get back when the sheet is tucked away: a draggable egg that
          carries the running clock. It replaced a pill pinned above the tab bar —
          pinned to the bottom of a tall phone it is a reach, and it sat exactly where
          the tab bar and both bottom bars already compete for the thumb. */}
      {visible && minimized ? (
        <RecorderEgg elapsed={elapsed} onPress={() => setMinimized(false)} />
      ) : null}

      <Modal
        visible={visible && !minimized}
        transparent
        animationType="fade"
        onRequestClose={minimizable ? () => setMinimized(true) : cancel}
      >
        <View
          style={{ flex: 1, backgroundColor: 'rgba(32,31,29,0.35)', justifyContent: 'flex-end' }}
        >
          <View
            style={{
              backgroundColor: LIGHT.surface,
              borderTopLeftRadius: 24,
              borderTopRightRadius: 24,
              paddingHorizontal: spacing.lg,
              paddingTop: spacing.lg,
              paddingBottom: insets.bottom + spacing.lg,
              gap: spacing.lg,
              ...elevation.lg,
              ...(glow
                ? {
                    margin: 12,
                    marginBottom: 24,
                    borderRadius: 30,
                    borderWidth: 1.5,
                    borderColor: '#E8B77C',
                    shadowColor: '#DB8F45',
                    shadowOpacity: 0.55,
                    shadowRadius: 24,
                    shadowOffset: { width: 0, height: 0 },
                  }
                : {}),
            }}
          >
            {title || minimizable ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                <Text variant="microLabel" uppercase style={{ flex: 1 }}>
                  {title ?? ''}
                </Text>
                {minimizable && !transcribing ? (
                  <Pressable
                    onPress={() => setMinimized(true)}
                    accessibilityRole="button"
                    accessibilityLabel="Keep recording and use the rest of the app"
                    hitSlop={10}
                    style={{ opacity: 1 }}
                  >
                    {/* LABELED, not a bare chevron. A lone down-arrow on a recording
                      sheet reads as "cancel" or "collapse", and what it actually does
                      is let you keep recording while you go anywhere in the app —
                      which nobody discovers from an icon. */}
                    <View
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 6,
                        height: 30,
                        paddingLeft: 10,
                        paddingRight: 12,
                        borderRadius: 15,
                        borderWidth: 1,
                        borderColor: LIGHT.hairline,
                      }}
                    >
                      <ChevronDown color={LIGHT.textSecondary} size={16} strokeWidth={2.25} />
                      <Text variant="captionSm" style={{ color: LIGHT.textSecondary }}>
                        Keep recording
                      </Text>
                    </View>
                  </Pressable>
                ) : null}
              </View>
            ) : null}

            <Text variant="bodyMd" style={{ color: LIGHT.textSecondary, minHeight: 26 }}>
              {transcribing ? 'Transcribing…' : "Recording, tap the check when you're done."}
            </Text>

            {shareControl ? (
              <View
                style={{
                  borderWidth: 1,
                  borderColor: LIGHT.hairline,
                  borderRadius: radius.lg,
                  paddingHorizontal: spacing.base,
                  paddingVertical: spacing.sm,
                  gap: spacing.sm,
                }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                  {shareOn ? (
                    <Share2 color={LIGHT.accentText} size={16} strokeWidth={2.25} />
                  ) : (
                    <Lock color={LIGHT.textMuted} size={16} strokeWidth={2.25} />
                  )}
                  <View style={{ flex: 1 }}>
                    <Text variant="bodySm" style={{ color: LIGHT.textPrimary }}>
                      {shareOn ? 'Share this note' : 'Private'}
                    </Text>
                    <Text variant="captionSm" style={{ color: LIGHT.textMuted }}>
                      {shareOn ? 'Choose who can see it' : 'Only you can see this note'}
                    </Text>
                  </View>
                  <Switch
                    value={shareOn}
                    onValueChange={setShareOn}
                    disabled={transcribing}
                    trackColor={{ false: LIGHT.surfaceSoft, true: LIGHT.accent }}
                    thumbColor="#FFFFFF"
                    accessibilityLabel="Share this note"
                  />
                </View>
                {shareOn ? (
                  <ShareScopePicker value={scope} onChange={setScope} includePrivate={false} />
                ) : null}
              </View>
            ) : null}

            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.base }}>
              <Pressable
                onPress={cancel}
                disabled={transcribing}
                accessibilityRole="button"
                accessibilityLabel="Cancel voice note"
                hitSlop={8}
                style={{ opacity: transcribing ? 0.4 : 1 }}
              >
                <View
                  style={{
                    width: 52,
                    height: 52,
                    borderRadius: 26,
                    borderWidth: 1,
                    borderColor: LIGHT.hairline,
                    backgroundColor: LIGHT.surface,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <X color={LIGHT.textSecondary} size={22} strokeWidth={2.25} />
                </View>
              </Pressable>

              <View
                // minWidth 0 so this slot can actually shrink: a flex child defaults
                // to its content's intrinsic width as its minimum, which is what let
                // the old fixed-count waveform push the row wider than the sheet.
                style={{ flex: 1, minWidth: 0, alignItems: 'center' }}
                onLayout={(e) => {
                  const w = Math.floor(e.nativeEvent.layout.width);
                  setWaveWidth((prev) => (Math.abs(prev - w) > 1 ? w : prev));
                }}
              >
                {transcribing ? (
                  <ActivityIndicator color={LIGHT.accentText} />
                ) : waveWidth > 0 ? (
                  <RecordingWaveform
                    getMetering={getMetering}
                    active={!transcribing}
                    color={LIGHT.accent}
                    // 2.5/2.5, matching RecordingWaveform's defaults: a dense row
                    // of hairlines rather than a picket fence. Passed explicitly
                    // because barsForWidth must be given the SAME pair, or the
                    // count and the geometry disagree and the row either overflows
                    // or leaves a gap at the end.
                    bars={barsForWidth(waveWidth, 2.5, 2.5)}
                    barWidth={2.5}
                    gap={2.5}
                    height={44}
                    style={{ width: waveWidth }}
                  />
                ) : (
                  // One frame of reserved height before the measurement lands, so the
                  // row does not jump 44pt on the first layout pass.
                  <View style={{ height: 44 }} />
                )}
              </View>

              <Text
                variant="captionSm"
                style={{ color: LIGHT.accentText, width: 40, textAlign: 'center' }}
              >
                {mmss(seconds)}
              </Text>

              <Pressable
                onPress={() => void finish()}
                disabled={!ready || transcribing}
                accessibilityRole="button"
                accessibilityLabel="Save voice note"
                hitSlop={8}
                style={{ opacity: transcribing ? 0.6 : 1 }}
              >
                <View
                  style={{
                    width: 56,
                    height: 56,
                    borderRadius: 28,
                    backgroundColor: LIGHT.accentText,
                    alignItems: 'center',
                    justifyContent: 'center',
                    ...elevation.sm,
                  }}
                >
                  <Check color="#FFFFFF" size={24} strokeWidth={2.75} />
                </View>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}
