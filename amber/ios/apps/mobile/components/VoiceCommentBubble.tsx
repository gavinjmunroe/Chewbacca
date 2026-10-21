import { useCallback, useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { useAudioPlayer } from 'expo-audio';
import { Pause, Play } from 'lucide-react-native';
import { Pressable } from './Pressable';
import { CText } from './classical';
import { cl } from '../lib/classical';
import { commentAudioUrl } from '../lib/commentVoice';
import { toast } from '../lib/toast';

/**
 * A VOICE COMMENT, PLAYED.
 *
 * "There should be a little voice thing next to it, like a waveform, where I
 *  can leave a voice comment, which should be transcribed and shown with the
 *  voice."
 *
 * SHOWN WITH THE VOICE means both, and both are here: the bars are the
 * SPEAKER'S waveform -- sampled on their phone while they talked and stored
 * with the clip -- and the transcript sits underneath as ordinary text. Not a
 * decorative animation per listener: two people looking at the same comment see
 * the same shape, which is the difference between a waveform and a texture.
 *
 * THE URL IS FETCHED ON THE FIRST PLAY, never with the list. It is a signed URL
 * that dies in minutes, so one baked into a feed payload is a play button that
 * does nothing for anybody who left the app open. The peaks come with the
 * comment because they are just numbers; the capability does not.
 */
export function VoiceCommentBubble({
  commentId,
  durationMs,
  peaks,
  tint = cl.goldDeep,
}: {
  commentId: string;
  durationMs: number;
  peaks: number[];
  tint?: string;
}) {
  const player = useAudioPlayer();
  const [loading, setLoading] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const loadedFor = useRef<string | null>(null);
  const ticker = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopTicking = useCallback(() => {
    if (ticker.current) clearInterval(ticker.current);
    ticker.current = null;
  }, []);

  /**
   * RELEASED ON UNMOUNT. A player left running when a card scrolls out of the
   * feed keeps playing with nothing on screen to stop it -- and holds the audio
   * session, so the next thing the app tries to play is silent.
   */
  useEffect(
    () => () => {
      stopTicking();
      try {
        player.pause();
      } catch {
        // Already released; nothing to do and nothing worth saying.
      }
    },
    [player, stopTicking],
  );

  const toggle = useCallback(async () => {
    if (playing) {
      player.pause();
      setPlaying(false);
      stopTicking();
      return;
    }
    if (loadedFor.current !== commentId) {
      setLoading(true);
      const clip = await commentAudioUrl(commentId);
      setLoading(false);
      if (!clip) {
        toast.error('Could not play that.');
        return;
      }
      try {
        player.replace({ uri: clip.playbackUrl });
        loadedFor.current = commentId;
      } catch {
        toast.error('Could not play that.');
        return;
      }
    }
    try {
      player.seekTo(0);
      player.play();
    } catch {
      toast.error('Could not play that.');
      return;
    }
    setPlaying(true);
    setProgress(0);
    ticker.current = setInterval(() => {
      const status = player.currentTime;
      const total = durationMs / 1000;
      if (!Number.isFinite(status) || total <= 0) return;
      const next = Math.min(1, status / total);
      setProgress(next);
      // Ended. `playing` is what draws the pause glyph, so it has to be cleared
      // here rather than left for the next tap to discover.
      if (next >= 1) {
        setPlaying(false);
        setProgress(0);
        stopTicking();
      }
    }, 100);
  }, [playing, player, commentId, durationMs, stopTicking]);

  /**
   * THE BARS ARE THE SPEAKER'S, and a clip with none still draws.
   *
   * An older clip, or one whose metering the OS declined to report, arrives with
   * an empty peaks array. A flat row of minimum-height bars is honest -- there
   * is a recording and we do not know its shape -- and it keeps the play button
   * in the same place, which a collapsing row would not.
   */
  const bars = peaks.length > 0 ? peaks : Array.from({ length: 28 }, () => 18);
  const played = Math.round(bars.length * progress);

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
      <Pressable
        onPress={() => void toggle()}
        disabled={loading}
        accessibilityRole="button"
        accessibilityLabel={playing ? 'Pause' : 'Play this voice comment'}
        hitSlop={8}
        style={({ pressed }) => ({
          opacity: loading ? 0.5 : pressed ? 0.6 : 1,
          width: 26,
          height: 26,
          borderRadius: 13,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: tint,
        })}
      >
        {playing ? (
          <Pause size={12} color="#FFFFFF" strokeWidth={2.6} fill="#FFFFFF" />
        ) : (
          <Play size={12} color="#FFFFFF" strokeWidth={2.6} fill="#FFFFFF" />
        )}
      </Pressable>

      <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 2, height: 24 }}>
        {bars.map((p, i) => (
          <View
            key={i}
            style={{
              flex: 1,
              // A floor of three points: a silent moment is still part of the
              // clip, and a zero-height bar reads as a gap in the recording.
              height: Math.max(3, Math.round((Math.max(0, Math.min(100, p)) / 100) * 22)),
              borderRadius: 1.5,
              backgroundColor: i < played ? tint : cl.ink32,
            }}
          />
        ))}
      </View>

      <CText t="metaXs" color={cl.ink45}>
        {clock(durationMs)}
      </CText>
    </View>
  );
}

/** "0:42". Seconds, because a voice comment is never minutes long. */
function clock(ms: number): string {
  const total = Math.max(0, Math.round((Number(ms) || 0) / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
