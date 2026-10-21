import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { Pause, Play } from 'lucide-react-native';
import { Text } from './Text';
import { getNoteAudio } from '../lib/noteMedia';
import { configurePlaybackAudio } from '../lib/voiceAudio';
import { LIGHT } from '../lib/theme';
import { fonts } from '../lib/tokens';
import { resamplePeaks } from '../lib/waveform';

// Playback for a voice note shared into a circle: the SENDER'S waveform, a
// progress fill, a play/pause button and a timer.
//
// The bars are the peaks captured on the sender's device while they recorded, not
// something this client invents — so the shape you see is the shape they saw, on
// every device, and two people looking at the same note are looking at the same
// picture.
//
// The signed URL is fetched on first play, NOT on mount. A feed of twenty notes
// would otherwise mint twenty signed URLs nobody asked for, and each one expires
// in five minutes, so most of them would be dead before anyone pressed play.

// Straight from `Circle Feed Light.dc.html`: a 30pt track, a 30pt outlined play
// button, played strokes at #B2622D and the remainder at rgba(178,98,45,0.3).
const BAR_W = 2.4;
const BAR_GAP = 2;
const HEIGHT = 30;
const BUTTON = 30;
// 0.14 -> 0.05. At 0.14 every silent bar stood a seventh tall, and combined
// with the 0.7 gamma below (since gone) room tone drew at half height -- so a
// clip rendered as a solid block with a slightly bumpy top. This leaves a
// hairline of dots across the middle where there is nothing, the way Voice
// Memos does. Not zero: a bar scaled to nothing disappears, and a waveform with
// gaps in it looks broken rather than quiet.
const MIN_FRACTION = 0.05;
const PLAYED = '#B2622D';
const REST = 'rgba(178,98,45,0.3)';
const REST_DIM = 'rgba(178,98,45,0.28)';
// The played run of an already-heard note: quieter than the accent, still clearly
// ahead of REST_DIM, so scrubbing a replay reads.
const DIM_PLAYED = 'rgba(178,98,45,0.62)';
const INK_20 = 'rgba(32,30,29,0.2)';
const INK_50 = 'rgba(32,30,29,0.5)';

function mmss(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r < 10 ? '0' : ''}${r}`;
}

// Resampling moved to lib/waveform as resamplePeaks, and it takes the PEAK of
// each bucket rather than the average. Averaging was the local version's stated
// design -- "keeps a loud transient from vanishing" -- and it does the opposite:
// a bucket holding one loud syllable and five gaps averages to something quiet,
// so the syllable and the gaps both disappear and what is left is the mean
// loudness of the clip drawn as a rectangle. That is the blob.

export function VoiceNotePlayer({
  ownerId,
  noteId,
  fetchAudio,
  durationMs = 0,
  peaks,
  accent = PLAYED,
  rest,
  timerColor,
  showTimer = true,
  dimmed = false,
  onFirstPlay,
}: {
  /** The sharer's amber id — whose note this is. Omit when `fetchAudio` is given. */
  ownerId?: string;
  noteId?: string;
  /**
   * Where to get the signed URL from, for callers whose audio is not a circle
   * note. Direct messages live at a different endpoint with different
   * authorization, and forking this component to change one function call would
   * have duplicated the waveform, the progress fill, the timer and the
   * fetch-on-first-play rule — every one of which is the part worth sharing.
   *
   * Same contract either way: resolve to the URL plus what we need to draw
   * before the audio loads, or null when it is not available.
   */
  fetchAudio?: () => Promise<{
    playbackUrl: string;
    durationMs?: number;
    peaks?: number[];
  } | null>;
  /** Known duration from the feed, so the timer reads right before first play. */
  durationMs?: number;
  /** The sender's waveform from the feed. Fetched with the URL if absent. */
  peaks?: number[];
  accent?: string;
  /**
   * The UNPLAYED bars, and the timer.
   *
   * Both were literals tuned for the accent on a pale page. On a filled bubble
   * -- a spoken follow-up sits in the gold one -- a 0.3-alpha terracotta bar is
   * invisible and the muted timer is unreadable, so the two colors that have to
   * survive a different ground are the two that can be passed in. Defaulted, so
   * every existing caller is untouched.
   */
  rest?: string;
  timerColor?: string;
  /** The mm:ss readout. Off in the feed, where the row header already shows it. */
  showTimer?: boolean;
  /**
   * Already-heard styling: gray button, flatter waveform. The mockup's second row
   * is drawn this way, and the distinction only means something if playing a note
   * actually changes it.
   */
  dimmed?: boolean;
  /** Fired the first time this note is played, so the row can drop its "new" look. */
  onFirstPlay?: () => void;
}) {
  const [width, setWidth] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fetchedPeaks, setFetchedPeaks] = useState<number[] | null>(null);
  const [knownDurationMs, setKnownDurationMs] = useState(durationMs);
  // Whether we have handed a URL to the player yet. A ref as well as state
  // because the press handler must not act on a stale value.
  const loadedRef = useRef(false);

  const player = useAudioPlayer(undefined);
  const status = useAudioPlayerStatus(player);

  // Release the native player when the row scrolls away. Without this a long
  // feed leaks one audio session per note it ever rendered.
  useEffect(
    () => () => {
      try {
        player.remove();
      } catch {
        // Already gone; nothing to do.
      }
    },
    [player],
  );

  const bars = Math.max(1, Math.floor((width + BAR_GAP) / (BAR_W + BAR_GAP)));
  const shape = useMemo(
    () => resamplePeaks(fetchedPeaks ?? peaks ?? [], bars),
    [fetchedPeaks, peaks, bars],
  );

  const durationSeconds = status.duration || knownDurationMs / 1000 || 0;
  const progress = durationSeconds > 0 ? Math.min(1, status.currentTime / durationSeconds) : 0;
  const playedBars = Math.round(progress * bars);

  const load = useCallback(async () => {
    if (loadedRef.current) return true;
    setLoading(true);
    setError(null);
    const audio = fetchAudio
      ? await fetchAudio().catch(() => null)
      : ownerId && noteId
        ? await getNoteAudio(ownerId, noteId).then((r) => (r.ok ? r.data : null))
        : null;
    setLoading(false);
    if (!audio?.playbackUrl) {
      // A 404 here is the authorization answer, not a missing file: the server
      // returns 404 rather than 403 so this endpoint cannot be used to prove a
      // note exists to someone outside the circle.
      setError('Not available');
      return false;
    }
    setKnownDurationMs(audio.durationMs || knownDurationMs);
    if (audio.peaks?.length) setFetchedPeaks(audio.peaks);
    player.replace({ uri: audio.playbackUrl });
    // Explicit rather than assumed: a player that was reused after a previous clip
    // faded out could otherwise start at whatever volume it was left at.
    try {
      player.volume = 1;
    } catch {
      // Older native builds may not expose the setter; the default is 1 anyway.
    }
    loadedRef.current = true;
    return true;
  }, [ownerId, noteId, fetchAudio, knownDurationMs, player]);

  const toggle = useCallback(async () => {
    if (loading) return;
    if (status.playing) {
      player.pause();
      return;
    }
    if (!loadedRef.current) {
      const ready = await load();
      if (!ready) return;
    }
    // PLAYBACK, not the recorder's mode, and re-asserted on EVERY play rather than
    // once at load. See lib/voiceAudio.ts: the record mode puts iOS into
    // .playAndRecord, which routes audio out of the EARPIECE, and no amount of turning
    // the volume up fixes a wrong route. This selects .playback, which goes to the main
    // speaker at media volume.
    //
    // It sat inside load() at first, which returns early once the URL is cached -- so
    // the fix only applied to a note's FIRST play. Anything that left the session in
    // .playAndRecord afterwards (a recorder killed by backgrounding, a record() that
    // threw after the mode was already set) would put every replay of an
    // already-loaded note back on the earpiece with no way to recover but scrolling
    // the row out of the list. Setting the mode is idempotent and costs nothing.
    await configurePlaybackAudio().catch(() => {});
    onFirstPlay?.();
    // Finished clips restart instead of sitting at the end doing nothing on tap.
    if (status.didJustFinish || (durationSeconds > 0 && progress >= 0.999)) {
      await player.seekTo(0).catch(() => {});
    }
    player.play();
  }, [
    loading,
    status.playing,
    status.didJustFinish,
    durationSeconds,
    progress,
    load,
    player,
    onFirstPlay,
  ]);

  // Tap anywhere on the waveform to scrub there. Only once loaded — seeking a
  // player with no source throws.
  const seekToFraction = useCallback(
    async (fraction: number) => {
      if (!loadedRef.current || durationSeconds <= 0) return;
      await player.seekTo(Math.max(0, Math.min(1, fraction)) * durationSeconds).catch(() => {});
    },
    [durationSeconds, player],
  );

  const elapsed = status.playing || status.currentTime > 0 ? status.currentTime : durationSeconds;

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <Pressable
        onPress={() => void toggle()}
        accessibilityRole="button"
        accessibilityLabel={status.playing ? 'Pause voice note' : 'Play voice note'}
        hitSlop={10}
        style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
      >
        <View
          style={{
            width: BUTTON,
            height: BUTTON,
            borderRadius: BUTTON / 2,
            alignItems: 'center',
            justifyContent: 'center',
            borderWidth: 1,
            borderColor: dimmed ? INK_20 : accent,
            backgroundColor: 'transparent',
          }}
        >
          {loading ? (
            <ActivityIndicator size="small" color={dimmed ? INK_50 : accent} />
          ) : status.playing ? (
            <Pause
              size={13}
              color={dimmed ? INK_50 : accent}
              strokeWidth={2.2}
              fill={dimmed ? INK_50 : accent}
            />
          ) : (
            // Nudged right by 1pt: a triangle's optical center sits left of its
            // bounding box, so a mathematically centerd play glyph reads off.
            <Play
              size={13}
              color={dimmed ? INK_50 : accent}
              strokeWidth={2.2}
              fill={dimmed ? INK_50 : accent}
              style={{ marginLeft: 1.5 }}
            />
          )}
        </View>
      </Pressable>

      <Pressable
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
        onPress={(e) => {
          const x = e.nativeEvent.locationX;
          if (width > 0) void seekToFraction(x / width);
        }}
        accessibilityRole="adjustable"
        accessibilityLabel="Voice note position"
        style={{ flex: 1, height: HEIGHT, justifyContent: 'center' }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: BAR_GAP, height: HEIGHT }}>
          {shape.map((level, i) => {
            // No gamma. 0.7 pulled the quiet end UP -- room tone at 33 became
            // 0.46 of full height -- while the live recorder pushed it DOWN with
            // 1.35, so the same sound was three different shapes depending on
            // where you looked at it. The stored level is already gated and
            // shaped once, in lib/waveform.
            const h =
              (MIN_FRACTION +
                (1 - MIN_FRACTION) * (Math.max(0, Math.min(100, level)) / 100)) *
              HEIGHT;
            const played = i < playedBars;
            return (
              <View
                key={i}
                style={{
                  width: BAR_W,
                  height: h,
                  borderRadius: BAR_W / 2,
                  // Two literal colors, not one at two alphas: the progress IS
                  // the waveform, so there is no second progress bar to read.
                  // The heard state still keeps that contrast — flattening every
                  // bar to one color after a single play made replaying a note
                  // look broken, because the position was no longer legible.
                  backgroundColor: played
                    ? dimmed
                      ? DIM_PLAYED
                      : accent
                    : dimmed
                      ? REST_DIM
                      : (rest ?? REST),
                }}
              />
            );
          })}
        </View>
      </Pressable>

      {showTimer || error ? (
        <Text
          style={{
            fontFamily: fonts.body,
            fontSize: 11.5,
            letterSpacing: 0.3,
            color: error ? LIGHT.danger : (timerColor ?? LIGHT.textMuted),
            minWidth: 34,
            textAlign: 'right',
          }}
        >
          {error ?? mmss(elapsed)}
        </Text>
      ) : null}
    </View>
  );
}
