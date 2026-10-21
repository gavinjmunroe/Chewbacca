import { useEffect, useRef, useState } from 'react';
import { Alert, View } from 'react-native';
import { RecordingPresets, requestRecordingPermissionsAsync, useAudioRecorder } from 'expo-audio';
import { Mic, Square, Trash2 } from 'lucide-react-native';
import { Pressable } from './Pressable';
import { CCard, CText } from './classical';
import { RecordingWaveform } from './RecordingWaveform';
import { VoiceNotePlayer } from './VoiceNotePlayer';
import { cl } from '../lib/classical';
import { configureVoiceAudio, releaseVoiceAudio } from '../lib/voiceAudio';
import { createMeter, downsamplePeaks, meterSample, toStoredLevel } from '../lib/waveform';
import { toast } from '../lib/toast';
import { deleteVoiceBio, getMyVoiceBio, uploadVoiceBio, type VoiceBio } from '../lib/voiceBio';

/**
 * YOUR PROFILE, IN YOUR OWN VOICE.
 *
 * Written text on a profile is a bio; a voice clip is the person. Sixty seconds,
 * recorded here, audible to the people you are connected to (the server resolves
 * that live from `connections` on every request, so unconnecting silences it).
 *
 * THE RECORDER IS A SEPARATE COMPONENT THAT ONLY EXISTS WHILE RECORDING, and
 * that is about the cost of cold launch rather than tidiness. ProfilePage is one
 * of the three pages in the pager, so it is MOUNTED at launch whether or not the
 * user ever swipes to it. `useAudioRecorder` allocates a native recorder on
 * mount and there are already three of those in this app; a fourth, allocated on
 * every launch for a card nobody has looked at, is pure waste. So the hook lives
 * in <BioRecorder>, which a tap mounts. For the same reason the "do I have a
 * bio" request waits for `active` -- the first time this page is really on
 * screen, and after the slide that brought it there has finished.
 *
 * The recorder is INLINE rather than the full-screen VoiceNoteRecorder modal,
 * also on purpose. That modal exists to capture a thought and hand it to the
 * capture pipeline: it transcribes, resolves names, files observations, owns the
 * floating egg. A bio IS transcribed now -- the words go under the mic, which is
 * what makes a clip worth playing -- but none of the rest applies: it resolves
 * no names and files nothing. Reusing that modal would have meant giving it a
 * mode in which it does almost nothing it exists to do, and every future change
 * to the capture flow would then have had to think about the profile. The
 * transcription happens in lib/voiceBio.ts, off the blob that was just
 * uploaded, so this recorder stays as simple as it looks.
 *
 * What IS shared is the part worth sharing: the metering-to-waveform maths
 * (lib/waveform.ts, one copy, so the shape a listener sees matches the bars the
 * recorder drew) and the player (VoiceNotePlayer, through its `fetchAudio` hook
 * -- the progress fill, the resampled bars and the fetch-on-first-play rule are
 * identical whether the audio is a note or a bio).
 */

// Fast enough to look like speech (~10Hz), and the same rate the note recorder
// uses -- the duration is derived from the sample COUNT, so the two must agree.
const SAMPLE_MS = 100;
const MAX_SECONDS = 60;

function mmss(total: number): string {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

export function VoiceBioCard({
  /**
   * Has the profile been on screen yet? Gates the one request this card makes,
   * so a user who never opens their profile never pays for it.
   */
  active,
}: {
  active: boolean;
}) {
  const [bio, setBio] = useState<VoiceBio | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [armed, setArmed] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!active || loaded) return;
    let alive = true;
    void getMyVoiceBio().then((b) => {
      if (!alive) return;
      setBio(b);
      setLoaded(true);
    });
    return () => {
      alive = false;
    };
  }, [active, loaded]);

  const finish = async (clip: { uri: string; durationMs: number; peaks: number[] } | null) => {
    setArmed(false);
    if (!clip) return;
    setSaving(true);
    try {
      const ok = await uploadVoiceBio(clip.uri, {
        durationMs: clip.durationMs,
        peaks: clip.peaks,
      });
      if (!ok) {
        // The three legs either all landed or the row stays 'pending' and is
        // never served, so there is nothing half-saved on the profile. Say so
        // rather than leaving the card looking like it worked.
        toast.error('Could not save that. Try again.');
        return;
      }
      // Re-read rather than building the bio locally: the URL is signed and
      // short-lived, and only the server can mint one.
      setBio(await getMyVoiceBio());
      toast.success('Your voice bio is set.');
    } finally {
      setSaving(false);
    }
  };

  const confirmRemove = () => {
    Alert.alert('Remove your voice bio?', 'Your connections will no longer hear it.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => {
          const previous = bio;
          setBio(null);
          void deleteVoiceBio().then((res) => {
            if (!res.ok) {
              toast.error('Could not remove that.');
              setBio(previous);
            }
          });
        },
      },
    ]);
  };

  return (
    <CCard>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <CText t="kicker" color={cl.goldKicker}>
          VOICE BIO
        </CText>
        {bio && !armed && !saving ? (
          <Pressable
            onPress={confirmRemove}
            accessibilityRole="button"
            accessibilityLabel="Remove your voice bio"
            hitSlop={10}
            style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}
          >
            <Trash2 size={15} color={cl.ink38} strokeWidth={1.9} />
          </Pressable>
        ) : null}
      </View>

      {armed ? (
        <BioRecorder onDone={(clip) => void finish(clip)} />
      ) : saving ? (
        <CText t="metaSm" color={cl.ink48} style={{ marginTop: 12 }}>
          Saving…
        </CText>
      ) : !loaded ? (
        // Before the page has ever been opened there is nothing to say yet, and
        // a spinner on a card that is off-screen is a spinner nobody sees.
        <CText t="metaSm" color={cl.ink48} style={{ marginTop: 12 }}>
          {active ? 'Loading…' : ' '}
        </CText>
      ) : bio ? (
        <View style={{ marginTop: 12, gap: 10 }}>
          <VoiceNotePlayer
            // The signed URL is minted per play and never cached: it expires in
            // minutes by design, which is the whole point of signing it.
            fetchAudio={async () => {
              const fresh = await getMyVoiceBio();
              return fresh
                ? { playbackUrl: fresh.url, durationMs: fresh.durationMs, peaks: fresh.peaks }
                : null;
            }}
            durationMs={bio.durationMs}
            peaks={bio.peaks}
          />
          {/* WHAT IT SAYS, UNDERNEATH. The recording is the bio and the text is
              what makes it skimmable -- the same pairing a voice message in a
              DM already uses. Absent on a clip recorded before transcripts
              existed, which is why this renders nothing rather than an empty
              line. */}
          {bio.transcript?.trim() ? (
            <CText t="body" color={cl.ink55} style={{ fontSize: 14.5, lineHeight: 23 }}>
              {bio.transcript.trim()}
            </CText>
          ) : null}
          <MicButton onPress={() => setArmed(true)} label="Record a new voice bio" />
        </View>
      ) : (
        <View style={{ marginTop: 10, gap: 12 }}>
          <CText t="body" color={cl.ink55} style={{ fontSize: 15 }}>
            A minute in your own voice. Your connections hear it when they open your profile.
          </CText>
          <MicButton onPress={() => setArmed(true)} label="Record your voice bio" />
        </View>
      )}
    </CCard>
  );
}

/**
 * The mic, and nothing else. Mounted by a tap and unmounted when it hands the
 * clip back, so the native recorder exists only while it is being used.
 *
 * It starts recording in its own mount effect, which is what makes "tap Record"
 * one tap rather than two. It calls `onDone(null)` for every way this can end
 * without a clip -- permission refused, a failed prepare, an empty recording --
 * so the parent can never sit in a state with no way out.
 */
/**
 * ONE ROUND MIC BUTTON, and both states use it.
 *
 * There were two labeled pills — "Record" on an empty card and "Re-record" on
 * a recorded one — and the label was doing no work. A mic glyph already says
 * "speak"; the card is titled VOICE BIO; and whether it records or replaces is
 * answered by whether there is a waveform sitting above it. What the words
 * bought was two differently-sized objects for one action, in a card that is
 * otherwise a title, a waveform and nothing else.
 *
 * Round rather than a pill, because it is an instrument and not a sentence:
 * the same shape as the mic in the search bar, so the gesture reads the same
 * everywhere in the app.
 */
function MicButton({ onPress, label }: { onPress: () => void; label: string }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={10}
      style={({ pressed }) => ({ opacity: pressed ? 0.75 : 1, alignSelf: 'flex-start' })}
    >
      <View
        style={{
          width: 44,
          height: 44,
          borderRadius: 22,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: cl.tint100,
          borderWidth: 1,
          borderColor: cl.gold55,
        }}
      >
        <Mic size={19} color={cl.goldDeep} strokeWidth={2.1} />
      </View>
    </Pressable>
  );
}

function BioRecorder({
  onDone,
}: {
  onDone: (clip: { uri: string; durationMs: number; peaks: number[] } | null) => void;
}) {
  const recorder = useAudioRecorder({
    // Metering has to be requested at CONSTRUCTION time -- turning it on later
    // does nothing, getStatus().metering stays undefined, and the waveform
    // silently draws flat. The same construction the note recorder uses.
    ...RecordingPresets.HIGH_QUALITY,
    isMeteringEnabled: true,
  });
  const [live, setLive] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const peaksRef = useRef<number[]>([]);
  /** See VoiceNoteRecorder: one adaptive meter per clip, never per sample. */
  const meterRef = useRef(createMeter());
  // One-shot guard. Stop is reachable from the button, from the sixty-second cap
  // and from unmount, and the second caller must not stop a recorder that is
  // already gone or hand back a second clip.
  const doneRef = useRef(false);

  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  const stop = async () => {
    if (doneRef.current) return;
    doneRef.current = true;
    setLive(false);
    try {
      await recorder.stop().catch(() => {});
      const uri = recorder.uri;
      void releaseVoiceAudio();
      if (!uri) {
        toast.error('Could not read the recording.');
        onDoneRef.current(null);
        return;
      }
      // Duration from the SAMPLE COUNT rather than the clock: the clock is a 1Hz
      // counter starting at 0, so a nine-second clip would read as eight.
      onDoneRef.current({
        uri,
        durationMs: peaksRef.current.length * SAMPLE_MS,
        peaks: downsamplePeaks(peaksRef.current),
      });
    } catch {
      onDoneRef.current(null);
    }
  };

  // Start on mount, and never leave the mic open on unmount.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const perm = await requestRecordingPermissionsAsync().catch(() => ({ granted: false }));
      if (cancelled) return;
      if (!perm.granted) {
        toast.error('Microphone access is needed to record.');
        doneRef.current = true;
        onDoneRef.current(null);
        return;
      }
      await configureVoiceAudio();
      if (cancelled) return;
      try {
        await recorder.prepareToRecordAsync();
        if (cancelled) return;
        recorder.record();
        setLive(true);
      } catch {
        toast.error('Could not start recording.');
        void releaseVoiceAudio();
        doneRef.current = true;
        onDoneRef.current(null);
      }
    })();
    return () => {
      cancelled = true;
      if (!doneRef.current) {
        doneRef.current = true;
        recorder.stop().catch(() => {});
        void releaseVoiceAudio();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The clock and the level sampler. Two intervals rather than one because the
  // waveform needs ~10Hz to look like speech and the clock only needs 1Hz.
  useEffect(() => {
    if (!live) return;
    const clock = setInterval(() => setSeconds((s) => s + 1), 1000);
    const sampler = setInterval(() => {
      try {
        peaksRef.current.push(
          toStoredLevel(meterSample(meterRef.current, recorder.getStatus().metering)),
        );
      } catch {
        // Recorder torn down mid-sample; the interval is cleared below.
      }
    }, SAMPLE_MS);
    return () => {
      clearInterval(clock);
      clearInterval(sampler);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live]);

  // A HARD STOP AT SIXTY SECONDS, on the client as well as the server. The
  // server would reject the finished clip for being too long, which is the worst
  // possible moment to find out -- the user has already said the thing.
  useEffect(() => {
    if (live && seconds >= MAX_SECONDS) void stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, seconds]);

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 12 }}>
      <Pressable
        onPress={() => void stop()}
        accessibilityRole="button"
        accessibilityLabel="Stop recording"
        hitSlop={10}
        style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
      >
        <View
          style={{
            width: 40,
            height: 40,
            borderRadius: 20,
            backgroundColor: cl.gold,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Square size={14} color="#FFF8F0" strokeWidth={2.5} fill="#FFF8F0" />
        </View>
      </Pressable>
      {/* Live bars from the same metering the stored waveform is built from, so
          what you watch while recording is what your connections will see. */}
      {/* NO COUNT: it fills the row between the stop button and the timer.
          `bars={18}` was 99pt of waveform in a card about 300pt wide, and the
          rest of it was the white space he reported. */}
      <RecordingWaveform
        getMetering={() => {
          try {
            return recorder.getStatus().metering;
          } catch {
            return undefined;
          }
        }}
        active={live}
        color={cl.goldDeep}
        barWidth={2.5}
        gap={3}
        height={26}
      />
      <CText t="metaSm" color={cl.ink55}>
        {`${mmss(seconds)} / ${mmss(MAX_SECONDS)}`}
      </CText>
    </View>
  );
}
