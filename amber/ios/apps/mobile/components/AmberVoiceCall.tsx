import { useEffect, useRef } from 'react';
import {
  Animated,
  Easing,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { GlassView } from 'expo-glass-effect';
import { X } from 'lucide-react-native';
import { liquidGlassEnabled } from './LiquidGlass';
import * as Haptics from 'expo-haptics';
import { Text } from './Text';
import { RecordingWaveform } from './RecordingWaveform';
import { haptics } from './haptics';
import { DARK } from '../lib/theme';
import { fonts, spacing, radius } from '../lib/tokens';
import { useChat } from '../lib/ChatContext';
import { useVoiceDictation } from '../lib/useVoiceDictation';
import { Transcript } from './ChatSurface';

// The soundboard. Press the waveform and the whole screen becomes this: the
// edges bloom amber, the composer and suggestions are gone, and you just talk.
// You record a thought, tap to send, and it's transcribed (Groq) and logged
// through the exact same brain the text chat uses — Amber writes back
// confirmations, answers, and tappable "which Maggie?" chips right in the
// transcript. She never speaks; the point is capturing what you say, accurately.
// (This is record→transcribe, not the old live-streaming session.)


const AMBER = 'rgba(247,183,51,0.55)';
const AMBER_CLEAR = 'rgba(247,183,51,0)';

type GlowMode = 'connecting' | 'listening' | 'speaking';

function EdgeGlow({ mode, reduceMotion }: { mode: GlowMode; reduceMotion: boolean }) {
  // A single eased level drives how hot the edges burn: bright while it
  // transcribes, a calm wash while it records, dim when idle. No loop restarts,
  // so the swell reads as breathing rather than blinking.
  const level = useRef(new Animated.Value(0.28)).current;
  useEffect(() => {
    const target = mode === 'speaking' ? 0.92 : mode === 'connecting' ? 0.28 : 0.55;
    if (reduceMotion) {
      level.setValue(target);
      return;
    }
    Animated.timing(level, {
      toValue: target,
      duration: 600,
      easing: Easing.inOut(Easing.quad),
      useNativeDriver: true,
    }).start();
  }, [level, mode, reduceMotion]);

  const breath = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduceMotion) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(breath, { toValue: 1, duration: 3000, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(breath, { toValue: 0, duration: 3000, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [breath, reduceMotion]);

  const opacity = Animated.add(
    level,
    breath.interpolate({ inputRange: [0, 1], outputRange: [-0.06, 0.06] }),
  );

  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity }]}>
      <LinearGradient colors={[AMBER, AMBER_CLEAR]} start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }} style={styles.glowTop} />
      <LinearGradient colors={[AMBER_CLEAR, AMBER]} start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }} style={styles.glowBottom} />
      <LinearGradient colors={[AMBER, AMBER_CLEAR]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.glowLeft} />
      <LinearGradient colors={[AMBER_CLEAR, AMBER]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.glowRight} />
    </Animated.View>
  );
}

function LiveDot() {
  const v = useRef(new Animated.Value(0.4)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(v, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(v, { toValue: 0.4, duration: 900, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [v]);
  return <Animated.View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: DARK.accent, opacity: v }} />;
}

export function AmberVoiceCall({
  visible,
  openPerson,
  reduceMotion,
  onClose,
}: {
  visible: boolean;
  openPerson: (id: string) => void;
  reduceMotion: boolean;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const {
    turns,
    scrollRequest,
    runSearch,
    onSuggestion,
    onClarify,
    onSoftConfirmYes,
    onSoftConfirmNo,
  } = useChat();
  const scrollRef = useRef<ScrollView>(null);

  // Record→transcribe: you speak, tap to send, and the finished transcript goes
  // straight into the normal text pipeline — same capture, same disambiguation,
  // same responses. No live streaming; the clip is batch-transcribed on stop.
  const { active, transcribing, start, stop, cancel, getMetering } = useVoiceDictation({
    onUtterance: (t) => {
      // source: 'soundboard' → the backend keeps the reply short and action-first.
      void runSearch(t, undefined, undefined, 'soundboard');
    },
  });

  // Start recording when the surface opens; discard any in-progress recording
  // when it closes (closing must never fire off a stray transcription).
  useEffect(() => {
    if (visible) start();
    else cancel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // A firm press-and-hold anywhere on the surface exits, on top of the X. iPhones
  // no longer carry a pressure sensor, so a deliberate hold — not a light tap — is
  // what separates an intended exit from a stray touch. A heavy tap confirms it.
  const handleForceExit = () => {
    haptics.impact(Haptics.ImpactFeedbackStyle.Medium);
    onClose();
  };

  // The wave box is the primary control: while recording it sends (stop →
  // transcribe → runSearch), and once a clip has been sent it starts the next one.
  const onWavePress = () => {
    if (transcribing) return;
    if (active) stop();
    else start();
  };

  const glowMode: GlowMode = transcribing ? 'speaking' : active ? 'listening' : 'connecting';

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={styles.root}>
        <EdgeGlow mode={glowMode} reduceMotion={reduceMotion} />

        <Pressable
          onPress={handleForceExit}
          onLongPress={handleForceExit}
          accessibilityRole="button"
          accessibilityLabel="Tap to exit voice"
          style={{ flex: 1, paddingTop: insets.top + spacing.sm }}
        >
          <View style={styles.topRow}>
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="End voice"
              hitSlop={12}
              style={({ pressed }) => [styles.close, { opacity: pressed ? 0.6 : 1 }]}
            >
              <X color={DARK.textSecondary} size={22} strokeWidth={2.25} />
            </Pressable>
          </View>

          {turns.length === 0 ? (
            <View style={{ flex: 1 }} />
          ) : (
            <Transcript
              scrollRef={scrollRef}
              scrollRequest={scrollRequest}
              turns={turns}
              reduceMotion={reduceMotion}
              onRetry={(q) => void runSearch(q)}
              onOpenPerson={openPerson}
              onSuggestion={onSuggestion}
              onClarify={onClarify}
              onSoftConfirmYes={onSoftConfirmYes}
              onSoftConfirmNo={onSoftConfirmNo}
            />
          )}

          {/* Bottom: your spoken words on an opaque board, over a pretty box that
              holds the waveform. */}
          <View
            style={{
              paddingHorizontal: spacing.lg,
              paddingBottom: insets.bottom + spacing.lg,
              gap: spacing.md,
            }}
          >
            <View style={[styles.wordsBoard, liquidGlassEnabled && { backgroundColor: 'transparent' }]}>
              {liquidGlassEnabled ? (
                <GlassView
                  glassEffectStyle="regular"
                  style={[StyleSheet.absoluteFill, { borderRadius: 20 }]}
                  pointerEvents="none"
                />
              ) : null}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                <LiveDot />
                <Text variant="bodySm" style={{ color: DARK.textMuted }}>
                  {transcribing
                    ? 'Transcribing…'
                    : active
                      ? 'Recording, tap the wave to send'
                      : 'Tap the wave to talk to Amber'}
                </Text>
              </View>
            </View>

            <Pressable
              onPress={onWavePress}
              disabled={transcribing}
              accessibilityRole="button"
              accessibilityLabel={active ? 'Send what you said' : 'Start recording'}
              style={({ pressed }) => [
                styles.waveBox,
                liquidGlassEnabled && { backgroundColor: 'transparent' },
                { opacity: pressed ? 0.85 : 1 },
              ]}
            >
              {liquidGlassEnabled ? (
                <GlassView
                  glassEffectStyle="regular"
                  style={[StyleSheet.absoluteFill, { borderRadius: 20 }]}
                  pointerEvents="none"
                />
              ) : null}
              {/* Real microphone levels, not a canned animation. This is the
                  largest waveform in the app — 15 bars at 52pt — so a synthetic
                  one is also the most obviously fake. `getMetering` comes from the
                  same dictation hook that is already recording this call. */}
              <RecordingWaveform
                getMetering={getMetering}
                active={active}
                color="#F7B733"
                bars={15}
                barWidth={5}
                gap={6}
                height={52}
              />
            </Pressable>
          </View>
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    // A near-opaque dark scrim (not fully solid) so the voice journal reads as
    // glowing up over whatever page you were on, rather than a hard screen swap.
    backgroundColor: 'rgba(14,11,8,0.93)',
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: spacing.base,
    height: 44,
  },
  close: {
    width: 40,
    height: 40,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  wordsBoard: {
    backgroundColor: 'rgba(28,24,20,0.92)',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: DARK.hairline,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.base,
    minHeight: 76,
    justifyContent: 'center',
  },
  waveBox: {
    backgroundColor: 'rgba(28,24,20,0.55)',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: DARK.hairline,
    paddingVertical: spacing.base,
    alignItems: 'center',
    justifyContent: 'center',
  },
  liveLine: {
    minHeight: 64,
    paddingHorizontal: spacing.xl,
    justifyContent: 'center',
    alignItems: 'flex-start',
  },
  partial: {
    color: DARK.textPrimary,
    fontFamily: fonts.serifItalic,
    fontSize: 20,
    lineHeight: 28,
  },
  glowTop: { position: 'absolute', top: 0, left: 0, right: 0, height: 150 },
  glowBottom: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 170 },
  glowLeft: { position: 'absolute', top: 0, bottom: 0, left: 0, width: 100 },
  glowRight: { position: 'absolute', top: 0, bottom: 0, right: 0, width: 100 },
});
