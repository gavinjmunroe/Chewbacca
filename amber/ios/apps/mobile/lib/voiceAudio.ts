import { Platform } from 'react-native';
import { setAudioModeAsync } from 'expo-audio';

// The app-level audio modes for Amber's voice features. TWO of them, and the
// difference matters more than it looks.
//
// Voice input is record→transcribe only (Groq Whisper via /v1/voice/transcribe);
// there is no live/streaming session and no spoken response. configureVoiceAudio
// puts the app into the right category around an expo-audio RECORDING.
// configurePlaybackAudio does the same for PLAYING a clip back — and it is not
// the same category, which is the whole point of the second function existing.

const IS_IOS = Platform.OS === 'ios';

/**
 * Put the app into record + playback before an expo-audio recording starts, so
 * capture begins against the right category.
 *
 * Best-effort by design: a failure here is not fatal — recording can still
 * proceed. Throwing would abort a capture that would otherwise have worked.
 */
export async function configureVoiceAudio(): Promise<void> {
  try {
    await setAudioModeAsync({
      allowsRecording: true,
      // Amber is useless if the ringer switch silences it — the user is dictating
      // a note or question out loud and expects it to be captured.
      playsInSilentMode: true,
      // MIX, DO NOT DUCK — and this is what lets you screen-record and dictate at
      // the same time.
      //
      // expo-audio maps interruptionMode onto AVAudioSession options, and
      // 'duckOthers' produces `.duckOthers` WITHOUT `.mixWithOthers`. A session
      // activated without `.mixWithOthers` is exclusive: activating it interrupts
      // every other audio session on the device, and every other session that
      // activates interrupts IT. iOS Screen Recording with the microphone on is one
      // of those sessions (ReplayKit captures the mic through its own session), so
      // the two fought and one of them lost — usually the note, silently, which is
      // the worst possible way for it to fail.
      //
      // `.mixWithOthers` is the option that says "we can coexist", and it is what
      // every camera app that records over background audio uses. The cost is real
      // and small: music no longer ducks while you dictate, so it bleeds into the
      // note. That is a trade worth making — a note recorded over your own music is
      // a choice the user made, whereas a note that silently failed to record while
      // the screen was being captured is a bug.
      interruptionMode: 'mixWithOthers',
      // Recording is foreground-only; declaring background playback here would be
      // a promise the app does not keep.
      shouldPlayInBackground: false,
      allowsBackgroundRecording: false,
    });
  } catch {
    /* non-fatal: recording can still proceed */
  }
}

/**
 * Put the app into PLAYBACK before an expo-audio player starts.
 *
 * THIS IS WHY VOICE NOTES USED TO PLAY BACK ALMOST INAUDIBLY. The feed's player
 * called configureVoiceAudio() above, on the reasoning that it was "the audio
 * mode the recorder uses". But `allowsRecording: true` makes expo-audio select
 * AVAudioSession's `.playAndRecord` category, and iOS routes `.playAndRecord`
 * output to the RECEIVER — the earpiece you hold to your ear on a call — unless
 * `.defaultToSpeaker` is also set, which expo-audio does not set. So the clip was
 * playing correctly, at earpiece volume, out of a 3mm speaker at the top of the
 * phone. Turning the volume up does nothing about that, because the ringer/media
 * volume is not the problem: the ROUTE is.
 *
 * `allowsRecording: false` selects `.playback` instead, which routes to the main
 * speaker at media volume — the same path Apple's own Voice Memos uses on
 * playback. Verified against node_modules/expo-audio/ios/AudioModule.swift:
 *
 *     category = mode.allowsRecording ? .playAndRecord : .playback
 *
 * `playsInSilentMode` stays true so a note still plays with the ringer switch
 * flipped, and `duckOthers` lowers music rather than stopping it, so a five
 * second note does not kill someone's album.
 */
export async function configurePlaybackAudio(): Promise<void> {
  try {
    await setAudioModeAsync({
      // The one line that fixes the volume. Do not set this to true here.
      allowsRecording: false,
      playsInSilentMode: true,
      interruptionMode: 'duckOthers',
      shouldPlayInBackground: false,
      allowsBackgroundRecording: false,
    });
  } catch {
    /* non-fatal: playback can still proceed on whatever category is active */
  }
}

/**
 * Hand the audio session back after a session ends, so the app stops holding a
 * record-capable category (which keeps the orange mic indicator lit on iOS and
 * keeps other apps ducked).
 */
export async function releaseVoiceAudio(): Promise<void> {
  try {
    await setAudioModeAsync({
      allowsRecording: false,
      // Leave silent-mode playback alone on iOS: dropping it here would also
      // silence any other audio the app plays later.
      playsInSilentMode: IS_IOS,
      interruptionMode: 'mixWithOthers',
      shouldPlayInBackground: false,
      allowsBackgroundRecording: false,
    });
  } catch {
    /* best-effort; the session is going away regardless */
  }
}
