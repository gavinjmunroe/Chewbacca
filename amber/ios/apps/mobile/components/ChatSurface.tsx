import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useChat, type ScrollRequest, type Turn } from '../lib/ChatContext';
import {
  ActivityIndicator,
  Animated,
  Easing,
  Image,
  Keyboard,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  Share,
  TextInput as RNTextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import {
  ArrowUp,
  AudioLines,
  Camera,
  Check,
  ChevronRight,
  Copy,
  Mic,
  Paperclip,
  Plus,
  Share2,
  Sparkles,
  Square,
  Zap,
} from 'lucide-react-native';
import { Text } from './Text';
import {
  findPerson,
  normalizeScore,
  resolveAnswerText,
  type PeopleRankResult,
  type RankedPerson,
} from '../lib/peoplerank';
import {
  type ClarifyCandidate,
  type Suggestion,
} from '../lib/chat';
import { api, unwrapSingle, type Me } from '../lib/api';
import { getContact } from '../lib/contacts';
import { toast } from '../lib/toast';
import { elevation, fonts, radius, spacing, typography } from '../lib/tokens';
import { DARK } from '../lib/theme';
import { useSyncState } from '../lib/syncState';
import { AmberVoiceCall } from './AmberVoiceCall';
import { GlassSurface } from './LiquidGlass';
import { useReducedMotion } from './useReducedMotion';

// Turn type and newId live in lib/ChatContext.tsx

const INPUT_MIN_H = 22;
const INPUT_MAX_H = 120;

const LOGO = require('../assets/amber-logo.png');

// `T[]` rather than `Array<T>`: the codebase's one array style, which the linter
// enforces and nothing else here breaks.
const PLUS_MENU_ITEMS: {
  label: string;
  Icon: React.FC<{ color?: string; size?: number; strokeWidth?: number }>;
}[] = [
  { label: 'Add files', Icon: Paperclip },
  { label: 'Add photos', Icon: Camera },
  { label: 'Connectors', Icon: Zap },
];

export function ChatSurface({ openPerson }: { openPerson: (id: string) => void }) {
  const reduceMotion = useReducedMotion();
  const syncState = useSyncState();

  const {
    query,
    setQuery,
    turns,
    streaming,
    scrollRequest,
    runSearch,
    onStop,
    onSuggestion,
    onClarify,
    onSoftConfirmYes,
    onSoftConfirmNo,
  } = useChat();

  const scrollRef = useRef<ScrollView>(null);

  // The waveform button opens the soundboard (a full-screen glow surface that
  // owns its own dictation session). The surface closes itself.
  const [callVisible, setCallVisible] = useState(false);

  // Sending dismisses the keyboard. Two reasons: the answer is about to arrive
  // and the keyboard was covering most of where it lands, and the question can
  // only be anchored near the top of a viewport that isn't half-occluded.
  const submitQuery = useCallback(
    (override?: string) => {
      Keyboard.dismiss();
      void runSearch(override);
    },
    [runSearch],
  );

  // Same ['me'] query key SharedHeader.tsx uses — react-query dedupes it
  // against whatever else has it in flight.
  const meQuery = useQuery({
    queryKey: ['me'],
    queryFn: async () => unwrapSingle<Me>(await api.me()),
    staleTime: 1000 * 60 * 5,
  });
  const firstName = (meQuery.data?.displayName ?? '').trim().split(/\s+/)[0] || 'there';

  // The empty state (logo/heading/pills) makes room for the keyboard by
  // disappearing entirely rather than shrinking — there isn't enough vertical
  // space to keep it legible once the keyboard is up.
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  useEffect(() => {
    const showSub = Keyboard.addListener('keyboardWillShow', () => setKeyboardVisible(true));
    const hideSub = Keyboard.addListener('keyboardWillHide', () => setKeyboardVisible(false));
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  return (
    <>
      <View style={{ flex: 1, overflow: 'hidden' }}>
        {turns.length === 0 ? (
          keyboardVisible ? null : (
            <Pressable
              style={{ flex: 1 }}
              onPress={() => Keyboard.dismiss()}
              accessible={false}
            >
              <EmptyState
                reduceMotion={reduceMotion}
                syncing={syncState.status === 'syncing'}
                firstName={firstName}
                runSearch={(q) => {
                  submitQuery(q);
                  return Promise.resolve();
                }}
              />
            </Pressable>
          )
        ) : (
          <Transcript
            scrollRef={scrollRef}
            scrollRequest={scrollRequest}
            turns={turns}
            reduceMotion={reduceMotion}
            onRetry={(q) => submitQuery(q)}
            onOpenPerson={openPerson}
            onSuggestion={onSuggestion}
            onClarify={onClarify}
            onSoftConfirmYes={onSoftConfirmYes}
            onSoftConfirmNo={onSoftConfirmNo}
          />
        )}
      </View>

      <SearchBar
        value={query}
        onChangeText={setQuery}
        onSubmit={() => submitQuery()}
        streaming={streaming}
        onStop={onStop}
        voiceActive={callVisible}
        onVoicePress={() => setCallVisible(true)}
      />

      <AmberVoiceCall
        visible={callVisible}
        openPerson={openPerson}
        reduceMotion={reduceMotion}
        onClose={() => setCallVisible(false)}
      />
    </>
  );
}

// ── Idle empty state: logo, heading, subtitle, suggestion pills ──

const SUGGESTIONS = [
  'I want to go through my day',
  'Search my network',
  "Let's talk about how I'm feeling",
];

// The flame + radiating rings live in a fixed-height, clipped block so the
// rings can never bleed into the "amber voice" banner above or the heading
// below, regardless of how big a given screen width makes them.
const LOGO_BLOCK_HEIGHT = 240;

function EmptyState({
  reduceMotion,
  syncing,
  firstName,
  runSearch,
}: {
  reduceMotion: boolean;
  syncing: boolean;
  firstName: string;
  runSearch: (override?: string) => Promise<void>;
}) {
  const { width } = useWindowDimensions();
  const eggSize = Math.round(width * 0.22);
  return (
    <View style={{ flex: 1 }}>
      <View
        style={{
          height: LOGO_BLOCK_HEIGHT,
          marginTop: spacing.xl,
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
        }}
      >
        <AmberAura size={eggSize} reduceMotion={reduceMotion} />
        <Image
          source={LOGO}
          style={{ width: eggSize, height: eggSize, resizeMode: 'contain' }}
          accessibilityLabel="Amber"
        />
        {syncing ? (
          <ActivityIndicator
            size="small"
            color={DARK.textMuted}
            style={{ marginTop: spacing.xl }}
          />
        ) : null}
      </View>

      <View style={{ marginTop: spacing.lg }}>
        <Text
          variant="displaySm"
          style={{ color: DARK.textPrimary, textAlign: 'center', paddingHorizontal: spacing.xl }}
        >
          Ask about anyone in your network
        </Text>
        <Text
          style={{
            color: DARK.textSecondary,
            textAlign: 'center',
            marginTop: spacing.sm,
            paddingHorizontal: spacing.xl,
          }}
        >
          {`Hey ${firstName}. What can I help you find?`}
        </Text>

        <View style={{ gap: spacing.md, paddingHorizontal: spacing.lg, marginTop: spacing.xl }}>
          {SUGGESTIONS.map((label) => (
            <SuggestionPill key={label} label={label} onPress={() => void runSearch(label)} />
          ))}
        </View>
      </View>

      <View style={{ flex: 1 }} />
    </View>
  );
}

function SuggestionPill({ label, onPress }: { label: string; onPress: () => void }) {
  const scale = useRef(new Animated.Value(1)).current;
  const pressIn = useCallback(() => {
    Animated.timing(scale, { toValue: 0.97, duration: 100, useNativeDriver: true }).start();
  }, [scale]);
  const pressOut = useCallback(() => {
    Animated.timing(scale, { toValue: 1, duration: 120, useNativeDriver: true }).start();
  }, [scale]);

  return (
    <Pressable onPress={onPress} onPressIn={pressIn} onPressOut={pressOut}>
      {({ pressed }) => (
        <Animated.View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            backgroundColor: 'rgba(255,255,255,0.05)',
            borderWidth: 1,
            borderColor: DARK.hairlineStrong,
            borderRadius: radius.lg,
            paddingVertical: 16,
            paddingHorizontal: spacing.lg,
            opacity: pressed ? 0.75 : 1,
            transform: [{ scale }],
            ...elevation.sm,
          }}
        >
          <Text
            variant="titleMd"
            style={{ color: DARK.textPrimary, flex: 1, fontFamily: fonts.serifSemibold }}
          >
            {label}
          </Text>
          <ChevronRight color={DARK.textMuted} size={18} strokeWidth={2} />
        </Animated.View>
      )}
    </Pressable>
  );
}

const RING_COLOR = '#FCCA4C';
const RING_FACTORS = [1.6, 2.1, 2.6];
const RING_STAGGER_MS = 900;
const RING_DURATION_MS = 1800;
// Max scale a ring reaches mid-radiation — used to size the ring so its
// expanded (not just resting) diameter still fits inside LOGO_BLOCK_HEIGHT.
const RING_MAX_SCALE = 1.35;

function useRadiatingRing(delayMs: number, reduceMotion: boolean) {
  const value = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduceMotion) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(delayMs),
        Animated.timing(value, {
          toValue: 1,
          duration: RING_DURATION_MS,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(value, { toValue: 0, duration: 0, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [value, reduceMotion, delayMs]);
  return value;
}

function AmberAura({ size, reduceMotion }: { size: number; reduceMotion: boolean }) {
  // Rings radiate outward from the flame like sound waves. Sized relative to
  // the flame, then scaled down proportionally (keeping them distinct) if the
  // outer ring's expanded diameter would exceed the clipped logo block.
  const cap = LOGO_BLOCK_HEIGHT / RING_MAX_SCALE;
  const rawOuter = RING_FACTORS[RING_FACTORS.length - 1]! * size;
  const shrink = rawOuter > cap ? cap / rawOuter : 1;
  const diameters = RING_FACTORS.map((f) => Math.round(f * size * shrink));

  const ring0 = useRadiatingRing(0, reduceMotion);
  const ring1 = useRadiatingRing(RING_STAGGER_MS, reduceMotion);
  const ring2 = useRadiatingRing(RING_STAGGER_MS * 2, reduceMotion);
  const rings = [ring0, ring1, ring2];

  return (
    <View
      pointerEvents="none"
      style={{ position: 'absolute', alignItems: 'center', justifyContent: 'center' }}
    >
      {diameters.map((diameter, i) => {
        const value = rings[i]!;
        const scale = reduceMotion
          ? 1
          : value.interpolate({ inputRange: [0, 1], outputRange: [0.7, RING_MAX_SCALE] });
        const opacity = reduceMotion
          ? 0.25
          : value.interpolate({ inputRange: [0, 1], outputRange: [0.6, 0] });
        return (
          <Animated.View
            key={i}
            style={{
              position: 'absolute',
              width: diameter,
              height: diameter,
              borderRadius: diameter / 2,
              borderWidth: 1.4,
              borderColor: RING_COLOR,
              opacity,
              transform: [{ scale }],
            }}
          />
        );
      })}
    </View>
  );
}

// ── Search bar ───────────────────────────────────────────────────

function SearchBar({
  value,
  onChangeText,
  onSubmit,
  streaming,
  onStop,
  voiceActive,
  onVoicePress,
}: {
  value: string;
  onChangeText: (v: string) => void;
  onSubmit: () => void;
  streaming: boolean;
  onStop: () => void;
  voiceActive: boolean;
  onVoicePress: () => void;
}) {
  const [plusMenuOpen, setPlusMenuOpen] = useState(false);
  const insets = useSafeAreaInsets();
  const canSubmit = value.trim().length > 0;

  return (
    <View style={{ paddingHorizontal: spacing.base, paddingTop: spacing.sm, paddingBottom: insets.bottom + spacing.sm }}>
      <Modal
        visible={plusMenuOpen}
        transparent
        animationType="none"
        onRequestClose={() => setPlusMenuOpen(false)}
      >
        <Pressable
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
          onPress={() => setPlusMenuOpen(false)}
        />
        <GlassSurface
          fallbackStyle={{ backgroundColor: DARK.surface }}
          style={{
            position: 'absolute',
            bottom: insets.bottom + 120,
            left: spacing.lg + spacing.sm,
            borderRadius: radius.md,
            borderWidth: 1,
            borderColor: DARK.hairline,
            overflow: 'hidden',
            minWidth: 260,
            paddingVertical: 12,
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 4 },
            shadowOpacity: 0.10,
            shadowRadius: 8,
            elevation: 4,
          }}
        >
          {PLUS_MENU_ITEMS.map((item) => (
            <Pressable
              key={item.label}
              onPress={() => {
                setPlusMenuOpen(false);
                toast.info(`${item.label} — coming soon`);
              }}
            >
              {({ pressed }) => (
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: spacing.xl,
                    paddingHorizontal: spacing.xl,
                    paddingVertical: 18,
                    backgroundColor: pressed ? DARK.surfaceSoft : 'transparent',
                  }}
                >
                  <item.Icon color={DARK.textSecondary} size={20} />
                  <Text variant="buttonSm" style={{ color: DARK.textPrimary }}>{item.label}</Text>
                </View>
              )}
            </Pressable>
          ))}
        </GlassSurface>
      </Modal>

      <GlassSurface
        fallbackStyle={{ backgroundColor: DARK.surface }}
        style={{
          borderRadius: radius.lg,
          borderWidth: 1,
          borderColor: DARK.hairlineStrong,
          overflow: 'hidden',
        }}
      >
        <RNTextInput
          value={value}
          onChangeText={onChangeText}
          placeholder="Ask about your network"
          placeholderTextColor={DARK.textMuted}
          multiline
          autoCapitalize="none"
          autoCorrect={false}
          allowFontScaling
          maxFontSizeMultiplier={1.4}
          style={{
            minHeight: INPUT_MIN_H,
            maxHeight: INPUT_MAX_H,
            color: DARK.textPrimary,
            fontFamily: typography.bodyMd.fontFamily,
            fontSize: typography.bodyMd.fontSize,
            lineHeight: 20,
            letterSpacing: -0.2,
            paddingTop: spacing.base,
            paddingBottom: spacing.sm,
            paddingHorizontal: spacing.lg,
            textAlignVertical: 'top',
          }}
        />

        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            paddingHorizontal: spacing.base,
            paddingBottom: spacing.base,
          }}
        >
          <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.lg }}>
            <Pressable
              onPress={() => setPlusMenuOpen((v) => !v)}
              accessibilityRole="button"
              accessibilityLabel="Attach"
              hitSlop={6}
              style={({ pressed }) => ({
                width: 36,
                height: 36,
                borderRadius: radius.full,
                alignItems: 'center',
                justifyContent: 'center',
                opacity: pressed ? 0.5 : 1,
              })}
            >
              <Plus color={DARK.textMuted} size={18} strokeWidth={2.25} />
            </Pressable>
            <Pressable
              onPress={() => toast.info('Voice input coming soon')}
              accessibilityRole="button"
              accessibilityLabel="Voice input"
              hitSlop={6}
              style={({ pressed }) => ({
                width: 36,
                height: 36,
                borderRadius: radius.full,
                alignItems: 'center',
                justifyContent: 'center',
                opacity: pressed ? 0.5 : 1,
              })}
            >
              <Mic color={DARK.textMuted} size={18} strokeWidth={2.25} />
            </Pressable>
            {/* The voice surface. Opens the full-screen call surface (egg +
                glow) where you record a thought and it's transcribed (Groq) and
                run through the normal pipeline. Distinct from the Mic button
                above, which stays a placeholder. */}
            <Pressable
              onPress={onVoicePress}
              accessibilityRole="button"
              accessibilityLabel={voiceActive ? 'Stop talking to Amber' : 'Talk to Amber'}
              hitSlop={6}
              style={({ pressed }) => ({
                width: 36,
                height: 36,
                borderRadius: radius.full,
                alignItems: 'center',
                justifyContent: 'center',
                opacity: pressed ? 0.5 : 1,
              })}
            >
              <AudioLines
                color={voiceActive ? DARK.accent : DARK.textMuted}
                size={18}
                strokeWidth={2.25}
              />
            </Pressable>
          </View>

          {streaming ? (
            <Pressable
              onPress={onStop}
              accessibilityRole="button"
              accessibilityLabel="Stop"
              style={{
                width: 36,
                height: 36,
                borderRadius: radius.full,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: DARK.accent,
              }}
            >
              <Square color="#FFFFFF" fill="#FFFFFF" size={15} />
            </Pressable>
          ) : (
            <Pressable
              onPress={onSubmit}
              disabled={!canSubmit}
              accessibilityRole="button"
              accessibilityLabel="Ask Amber"
              style={{
                width: 36,
                height: 36,
                borderRadius: radius.full,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: canSubmit ? DARK.accent : DARK.surfaceSoft,
              }}
            >
              <ArrowUp color={canSubmit ? '#FFFFFF' : DARK.textMuted} size={18} />
            </Pressable>
          )}
        </View>
      </GlassSurface>

      <Text
        variant="captionSm"
        style={{ color: DARK.textMuted, textAlign: 'center', marginTop: spacing.sm }}
      >
        Amber · private by default
      </Text>
    </View>
  );
}

// ── Chat transcript ──────────────────────────────────────────────

export function Transcript({
  scrollRef,
  scrollRequest,
  turns,
  reduceMotion,
  onRetry,
  onOpenPerson,
  onSuggestion,
  onClarify,
  onSoftConfirmYes,
  onSoftConfirmNo,
}: {
  scrollRef: React.RefObject<ScrollView | null>;
  scrollRequest: ScrollRequest;
  turns: Turn[];
  reduceMotion: boolean;
  onRetry: (query: string) => void;
  onOpenPerson: (id: string) => void;
  onSuggestion: (s: Suggestion) => void;
  onClarify: (turnId: string, candidate: ClarifyCandidate, pendingId?: string) => void;
  onSoftConfirmYes: (turnId: string, contact: { id: string; name: string }, pendingId?: string) => void;
  onSoftConfirmNo: (turnId: string, pendingId?: string) => void;
}) {
  // Each turn's y offset within the content, captured on layout. Anchoring needs
  // a real measurement: the turns above vary in height with answer length, so
  // there is no offset to compute analytically.
  const turnTops = useRef<Map<string, number>>(new Map());

  // The turn currently held at the top of the viewport, or null when nothing is
  // anchored. This has to persist rather than fire once and clear, for two
  // reasons: a just-appended turn has no measured offset yet, and the target is
  // only reachable once enough answer exists below it to scroll that far — so
  // the anchor is re-asserted as the answer grows until it actually lands.
  const anchorTarget = useRef<string | null>(null);

  const anchorTo = useCallback(
    (turnId: string) => {
      const top = turnTops.current.get(turnId);
      if (top == null) return;
      // Leave the content's own top padding above the question rather than
      // jamming it against the edge. scrollTo clamps to the scrollable range, so
      // while the answer is still short this settles as high as it can and the
      // re-assertions below close the gap as more content arrives.
      const y = Math.max(0, top - spacing.lg);
      requestAnimationFrame(() => scrollRef.current?.scrollTo({ y, animated: true }));
    },
    [scrollRef],
  );

  const lastTurnId = turns.length > 0 ? turns[turns.length - 1].id : null;

  useEffect(() => {
    if (scrollRequest.tick === 0) return;
    if (scrollRequest.intent === 'end') {
      anchorTarget.current = null;
      requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
      return;
    }
    if (!lastTurnId) return;
    anchorTarget.current = lastTurnId;
    anchorTo(lastTurnId);
  }, [scrollRequest, lastTurnId, anchorTo, scrollRef]);

  // Sending dismisses the keyboard, and the hide animation changes the scroll
  // view's usable height and insets — which moves the resting offset out from
  // under an anchor computed while the keyboard was still up. Re-assert once the
  // keyboard is actually down.
  useEffect(() => {
    const sub = Keyboard.addListener('keyboardDidHide', () => {
      if (anchorTarget.current) anchorTo(anchorTarget.current);
    });
    return () => sub.remove();
  }, [anchorTo]);

  return (
    <ScrollView
      ref={scrollRef}
      style={{ flex: 1 }}
      contentContainerStyle={{
        paddingHorizontal: spacing.lg,
        paddingTop: spacing.lg,
        paddingBottom: spacing.lg,
        gap: spacing.xl,
      }}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      onScrollBeginDrag={() => {
        Keyboard.dismiss();
        // The user is driving now. Drop the anchor so re-assertions stop pulling
        // the view back while they are reading.
        anchorTarget.current = null;
      }}
    >
      {turns.map((turn) => (
        <View
          key={turn.id}
          onLayout={(e) => {
            turnTops.current.set(turn.id, e.nativeEvent.layout.y);
            // Re-assert while this turn is the anchor: its answer growing is
            // exactly what makes the target reachable.
            if (anchorTarget.current === turn.id) anchorTo(turn.id);
          }}
        >
          <TurnView
            turn={turn}
            reduceMotion={reduceMotion}
            onRetry={onRetry}
            onOpenPerson={onOpenPerson}
            onSuggestion={onSuggestion}
            onClarify={(c, pendingId) => onClarify(turn.id, c, pendingId)}
            onSoftConfirmYes={(contact, pendingId) => onSoftConfirmYes(turn.id, contact, pendingId)}
            onSoftConfirmNo={(pendingId) => onSoftConfirmNo(turn.id, pendingId)}
          />
        </View>
      ))}
    </ScrollView>
  );
}

function TurnView({
  turn,
  reduceMotion,
  onRetry,
  onOpenPerson,
  onSuggestion,
  onClarify,
  onSoftConfirmYes,
  onSoftConfirmNo,
}: {
  turn: Turn;
  reduceMotion: boolean;
  onRetry: (query: string) => void;
  onOpenPerson: (id: string) => void;
  onSuggestion: (s: Suggestion) => void;
  onClarify: (candidate: ClarifyCandidate, pendingId?: string) => void;
  onSoftConfirmYes: (contact: { id: string; name: string }, pendingId?: string) => void;
  onSoftConfirmNo: (pendingId?: string) => void;
}) {
  const result = turn.result;
  const done = turn.status === 'done';
  // SHOW WHAT HAS ARRIVED, DON'T WAIT FOR `done`.
  //
  // These were all gated on turn.status === 'done', which meant two things went
  // wrong. A stream that ended without its terminal event — dropped connection,
  // app backgrounded, the 40s deadline — left the turn stuck on 'streaming' and
  // hid the sources and chips it had ALREADY received, permanently. And even on a
  // clean turn the people cards and the sources all snapped in at once at the
  // very end instead of appearing as they landed.
  //
  // 'loading' is still empty because nothing has arrived yet; from the first
  // token onward, anything received is rendered.
  const arrived = turn.status !== 'loading';
  const people = arrived ? (result?.people ?? []) : [];
  // Still gated on `done`: this is a NEGATIVE claim ("nobody matched"), and it is
  // only true once there is nothing left to arrive.
  const noMatches = done && people.length === 0 && !result?.answer?.trim() && !(turn.clarify?.length) && !(turn.softConfirm?.length);

  const sources = arrived ? (turn.sources ?? []) : [];
  const citations = arrived ? dedupeCitations(result?.citations ?? []) : [];
  const suggestions = arrived ? (turn.suggestions ?? []) : [];
  // Sections arrive after the flat list (they are derived from the finished
  // answer), so this is a gate, not just a presence check.
  const sections = arrived && turn.groups && turn.groups.length > 0 ? turn.groups : null;
  const rankedById = new Map(people.map((p) => [String(p.id), p]));

  return (
    <View>
      <SentBubble text={turn.query} />
      {turn.status === 'loading' ? (
        <LoadingReply />
      ) : turn.status === 'error' ? (
        <View style={{ gap: spacing.sm }}>
          <Text variant="bodyMd" style={{ color: DARK.textSecondary }}>
            {turn.errorMsg ?? 'Amber hit a snag.'}
          </Text>
          <Pressable
            onPress={() => onRetry(turn.query)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Try again"
          >
            <Text variant="buttonSm" style={{ color: DARK.accent }}>
              Try again
            </Text>
          </Pressable>
        </View>
      ) : result ? (
        <AnswerBlock
          result={result}
          reduceMotion={reduceMotion}
          // A live turn renders verbatim: its reveal is already paced by the
          // drain-buffer typewriter in ChatContext, so `result.answer` only ever
          // holds text that should be visible. useProgressiveReveal must not also
          // run, for two reasons — its effect is keyed on `total`, so it would
          // reset to 0 on every token while streaming, and it would reset AGAIN at
          // the streaming→done flip, blanking the finished answer and retyping it.
          // Only history replays (stable `total`, never streamed) animate in.
          instant={!turn.replayed}
          onOpenPerson={onOpenPerson}
        />
      ) : null}

      {turn.clarify?.map((g, i) => (
        <ClarifySection key={g.pendingId ?? `c${i}`} clarify={g} onClarify={onClarify} />
      ))}

      {turn.softConfirm?.map((g, i) => (
        <SoftConfirmSection key={g.pendingId ?? `s${i}`} softConfirm={g} onYes={onSoftConfirmYes} onNo={onSoftConfirmNo} />
      ))}

      {sources.length > 0 ? (
        <SourceSection label="Sources">
          {sources.map((s, i) => (
            <Chip
              key={`${s.url}-${i}`}
              label={`${i + 1} · ${hostname(s.url)}`}
              onPress={() => void Linking.openURL(s.url).catch(() => {})}
            />
          ))}
        </SourceSection>
      ) : null}

      {noMatches ? (
        <Text variant="bodySm" style={{ color: DARK.textSecondary }}>
          No one in your synced network ranked for that. Try different wording, or sync more
          contacts.
        </Text>
      ) : null}

      {/* LABELED SECTIONS, in place of the flat list. Both surfaces render the
          same turn, so both have to honor the sections or the same answer looks
          grouped in the thread and flat here. The server sends the ranked people
          first and the sections afterwards, so the flat list is gated rather than
          simply absent. */}
      {sections ? (
        <View style={{ marginTop: spacing.sm }}>
          {sections.map((g, gi) => {
            // Cards are keyed by their position in the WHOLE list so the stagger
            // stays monotonic across sections instead of restarting at each one.
            const offset = sections
              .slice(0, gi)
              .reduce((n, prev) => n + prev.people.length, 0);
            return (
              <View key={`grp-${gi}`} style={{ marginTop: gi === 0 ? 0 : spacing.lg }}>
                <Text
                  variant="bodySm"
                  style={{
                    color: DARK.textSecondary,
                    fontFamily: fonts.bold,
                    letterSpacing: 1.1,
                    marginBottom: g.note ? spacing.xs : spacing.sm,
                  }}
                >
                  {g.label.toUpperCase()}
                </Text>
                {g.note ? (
                  <Text
                    variant="bodyMd"
                    style={{
                      color: DARK.textPrimary,
                      lineHeight: 25,
                      marginBottom: spacing.sm,
                    }}
                  >
                    {g.note}
                  </Text>
                ) : null}
                {g.people.map((p, i) => {
                  // Sections are built FROM the ranked list, so the full card is
                  // always there. If one is somehow missing we skip it rather
                  // than render a card with no score, company or links.
                  const person = rankedById.get(p.id);
                  if (!person) return null;
                  return (
                    <View key={p.id}>
                      {i > 0 ? (
                        <View style={{ height: 1, backgroundColor: DARK.hairline }} />
                      ) : null}
                      <Stagger index={offset + i} reduceMotion={reduceMotion}>
                        <RankRow
                          person={person}
                          rank={offset + i + 1}
                          onPress={() => onOpenPerson(p.id)}
                        />
                      </Stagger>
                    </View>
                  );
                })}
              </View>
            );
          })}
        </View>
      ) : people.length > 0 ? (
        <View style={{ marginTop: spacing.sm }}>
          {people.map((person, index) => (
            <View key={person.id}>
              {index > 0 ? <View style={{ height: 1, backgroundColor: DARK.hairline }} /> : null}
              <Stagger index={index} reduceMotion={reduceMotion}>
                <RankRow person={person} rank={index + 1} onPress={() => onOpenPerson(person.id)} />
              </Stagger>
            </View>
          ))}
        </View>
      ) : null}

      {citations.length > 0 ? (
        <SourceSection label="From your contacts">
          {citations.map((c) => (
            <Chip
              key={c.contactId}
              label={`${c.name} →`}
              onPress={() => onOpenPerson(c.contactId)}
            />
          ))}
        </SourceSection>
      ) : null}

      {suggestions.length > 0 ? (
        <View
          style={{
            marginTop: spacing.lg,
            flexDirection: 'row',
            flexWrap: 'wrap',
            gap: spacing.sm,
          }}
        >
          {suggestions.map((s, i) => (
            <Chip
              key={`${s.type}-${i}`}
              label={s.label}
              accent
              onPress={() => onSuggestion(s)}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

function SoftConfirmSection({
  softConfirm,
  onYes,
  onNo,
}: {
  softConfirm: { question: string; contact: { id: string; name: string }; pendingId?: string };
  onYes: (contact: { id: string; name: string }, pendingId?: string) => void;
  onNo: (pendingId?: string) => void;
}) {
  return (
    <View style={{ marginTop: spacing.sm, gap: spacing.md }}>
      <Text variant="bodyMd" style={{ color: DARK.textPrimary }}>
        {softConfirm.question}
      </Text>
      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
        <Pressable
          onPress={() => onYes(softConfirm.contact, softConfirm.pendingId)}
          accessibilityRole="button"
          accessibilityLabel="Yes"
          hitSlop={8}
          style={({ pressed }) => ({ opacity: pressed ? 0.72 : 1 })}
        >
          <View
            style={{
              paddingHorizontal: spacing.lg,
              paddingVertical: spacing.md,
              borderRadius: radius.md,
              backgroundColor: DARK.accent,
            }}
          >
            <Text variant="titleMd" style={{ color: '#FFFFFF' }}>
              Yes
            </Text>
          </View>
        </Pressable>
        <Pressable
          onPress={() => onNo(softConfirm.pendingId)}
          accessibilityRole="button"
          accessibilityLabel="No"
          hitSlop={8}
        >
          {({ pressed }) => (
            <View
              style={{
                paddingHorizontal: spacing.lg,
                paddingVertical: spacing.md,
                borderRadius: radius.md,
                borderWidth: 1.5,
                borderColor: DARK.accent,
                backgroundColor: pressed ? DARK.chipBg : 'transparent',
              }}
            >
              <Text variant="titleMd" style={{ color: DARK.accent }}>
                No
              </Text>
            </View>
          )}
        </Pressable>
      </View>
    </View>
  );
}

function ClarifySection({
  clarify,
  onClarify,
}: {
  clarify: { question: string; candidates: ClarifyCandidate[]; pendingId?: string };
  onClarify: (candidate: ClarifyCandidate, pendingId?: string) => void;
}) {
  return (
    <View style={{ marginTop: spacing.md, gap: spacing.sm }}>
      <Text variant="bodyMd" style={{ color: DARK.textPrimary }}>
        {clarify.question}
      </Text>
      <View style={{ gap: spacing.xs }}>
        {clarify.candidates.map((c) => (
          <ClarifyCard key={c.id} candidate={c} onPress={() => onClarify(c, clarify.pendingId)} />
        ))}
      </View>
    </View>
  );
}

function ClarifyCard({
  candidate,
  onPress,
}: {
  candidate: ClarifyCandidate;
  onPress: () => void;
}) {
  const [displayName, setDisplayName] = useState(candidate.name);
  const [subtitle, setSubtitle] = useState<string | undefined>(undefined);
  const [fetching, setFetching] = useState(true);
  const [fetchFailed, setFetchFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    getContact(candidate.id).then((res) => {
      if (!alive) return;
      setFetching(false);
      if (!res.ok) {
        setFetchFailed(true);
        return;
      }
      const c = res.data.contact;

      const nameParts = [c.firstName, c.lastName].filter((s): s is string => !!s);
      const fetched = c.name ?? (nameParts.length > 0 ? nameParts.join(' ') : undefined);
      if (fetched && fetched.trim()) setDisplayName(fetched.trim());

      const contextParts = [c.company, c.title, c.city].filter((s): s is string => !!s && !!s.trim());
      const phone = c.phone ?? c.phoneNumbers?.[0];
      const email = c.email ?? c.emails?.[0];

      if (contextParts.length > 0) {
        setSubtitle(contextParts.join(' · '));
      } else if (phone) {
        setSubtitle(phone);
      } else if (email) {
        setSubtitle(email);
      }
    });
    return () => {
      alive = false;
    };
  }, [candidate.id]);

  const initials = (() => {
    const parts = displayName.trim().split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      return ((parts[0] ?? '').charAt(0) + (parts[parts.length - 1] ?? '').charAt(0)).toUpperCase();
    }
    return ((parts[0] ?? '?').charAt(0)).toUpperCase();
  })();

  const subtitleText = subtitle ?? (fetchFailed ? `id: ${candidate.id}` : undefined);

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={displayName}
      style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.md,
          paddingHorizontal: spacing.base,
          paddingVertical: spacing.base,
          borderRadius: radius.md,
          backgroundColor: DARK.surface,
          borderWidth: 1.5,
          borderColor: 'rgba(245,124,0,0.30)',
        }}
      >
        <View
          style={{
            width: 36,
            height: 36,
            borderRadius: radius.full,
            backgroundColor: DARK.chipBg,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text variant="captionSm" style={{ color: DARK.accent, letterSpacing: 0.5 }}>
            {initials}
          </Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text variant="titleMd" numberOfLines={1} style={{ color: DARK.textPrimary, fontSize: 17, lineHeight: 22 }}>
            {displayName}
          </Text>
          {fetching ? (
            <Text variant="captionSm" style={{ color: DARK.textMuted, marginTop: 2 }}>
              Loading…
            </Text>
          ) : subtitleText ? (
            <Text variant="captionSm" numberOfLines={1} style={{ color: DARK.textSecondary, marginTop: 2 }}>
              {subtitleText}
            </Text>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

function SourceSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={{ marginTop: spacing.md, gap: spacing.xs }}>
      <Text variant="microLabel" uppercase style={{ color: DARK.textMuted, letterSpacing: 0.6 }}>
        {label}
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>{children}</View>
    </View>
  );
}

// Citation / source / suggestion chip.
//
// Also used to spring its opacity 0→1 on mount. These all appear at the end of an
// answer, so the fade read as the citations lagging behind the text that
// referenced them. They now appear at full opacity the moment they mount.
function Chip({
  label,
  accent,
  onPress,
}: {
  label: string;
  accent?: boolean;
  onPress: () => void;
}) {
  return (
    <View>
      <Pressable
        onPress={onPress}
        hitSlop={6}
        accessibilityRole="button"
        accessibilityLabel={label}
        style={{
          backgroundColor: DARK.chipBg,
          borderRadius: radius.sm,
          paddingHorizontal: spacing.sm + 2,
          paddingVertical: 7,
          borderWidth: accent ? 1 : 0,
          borderColor: accent ? DARK.accent : 'transparent',
        }}
      >
        <Text
          variant="captionSm"
          style={{ color: accent ? DARK.accentBright : DARK.chipText }}
        >
          {label}
        </Text>
      </Pressable>
    </View>
  );
}

function hostname(url: string): string {
  const m = url.match(/^https?:\/\/([^/?#]+)/i);
  const host = (m?.[1] ?? url).replace(/^www\./i, '');
  return host || url;
}

function dedupeCitations(citations: PeopleRankResult['citations']): PeopleRankResult['citations'] {
  const seen = new Set<string>();
  const out: PeopleRankResult['citations'] = [];
  for (const c of citations) {
    if (seen.has(c.contactId)) continue;
    seen.add(c.contactId);
    out.push(c);
  }
  return out;
}

function LoadingReply() {
  return (
    <View style={{ gap: spacing.md }}>
      <View style={{ gap: spacing.sm }}>
        <Block w="22%" h={11} />
        <Block w="100%" h={13} />
        <Block w="92%" h={13} />
        <Block w="60%" h={13} />
      </View>
      <View style={{ height: 1, backgroundColor: DARK.hairline, marginVertical: spacing.sm }} />
      {[0, 1, 2].map((i) => (
        <View key={i} style={{ flexDirection: 'row', gap: spacing.md, paddingVertical: spacing.sm }}>
          <Block w={22} h={14} />
          <View style={{ flex: 1, gap: spacing.sm }}>
            <Block w="50%" h={15} />
            <Block w="70%" h={11} />
          </View>
        </View>
      ))}
    </View>
  );
}

function SentBubble({ text }: { text: string }) {
  return (
    <View style={{ alignItems: 'flex-end', marginBottom: spacing.xl }}>
      <View
        style={{
          maxWidth: '82%',
          backgroundColor: DARK.accent,
          borderRadius: 20,
          borderBottomRightRadius: 6,
          paddingHorizontal: spacing.base,
          paddingVertical: 10,
        }}
      >
        <Text variant="bodyMd" style={{ color: '#FFFFFF', letterSpacing: -0.2 }}>
          {text}
        </Text>
      </View>
    </View>
  );
}

function AnswerBlock({
  result,
  reduceMotion,
  instant,
  onOpenPerson,
}: {
  result: PeopleRankResult;
  reduceMotion: boolean;
  instant?: boolean;
  onOpenPerson: (id: string) => void;
}) {
  const answer = result.answer?.trim();
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
    },
    [],
  );

  if (!answer) return null;

  const onCopy = async () => {
    await Clipboard.setStringAsync(resolveAnswerText(result));
    void Haptics.selectionAsync().catch(() => {});
    setCopied(true);
    toast.success('Copied', 'Answer copied to your clipboard.');
    if (copiedTimer.current) clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setCopied(false), 1600);
  };

  const onShare = async () => {
    const message = resolveAnswerText(result);
    if (!message) return;
    try {
      await Share.share({ message });
    } catch {
      // user dismissed share sheet
    }
  };

  return (
    <View style={{ marginBottom: spacing.lg }}>
      <FadeIn reduceMotion={reduceMotion}>
        <View style={{ gap: spacing.sm }}>
          <View
            style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Sparkles color={DARK.accent} size={12} strokeWidth={2.25} />
              <Text variant="microLabel" uppercase style={{ color: DARK.accent, letterSpacing: 0.8 }}>
                Amber
              </Text>
            </View>
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              <AnswerAction accessibilityLabel="Copy answer" onPress={onCopy}>
                {copied ? (
                  <Check color={DARK.accent} size={16} />
                ) : (
                  <Copy color={DARK.textSecondary} size={16} />
                )}
              </AnswerAction>
              <AnswerAction accessibilityLabel="Share answer" onPress={onShare}>
                <Share2 color={DARK.textSecondary} size={16} />
              </AnswerAction>
            </View>
          </View>
          <View
            style={{
              backgroundColor: DARK.surface,
              borderRadius: radius.md,
              borderWidth: 1,
              borderColor: DARK.hairline,
              padding: spacing.base,
            }}
          >
            <AnswerText
              answer={answer}
              result={result}
              reduceMotion={reduceMotion}
              instant={instant}
              onOpenPerson={onOpenPerson}
            />
          </View>
        </View>
      </FadeIn>
      <View style={{ height: 1, backgroundColor: DARK.hairline, marginTop: spacing.lg }} />
    </View>
  );
}

function AnswerAction({
  children,
  accessibilityLabel,
  onPress,
}: {
  children: React.ReactNode;
  accessibilityLabel: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      hitSlop={8}
      style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
    >
      <View
        style={{
          width: 32,
          height: 32,
          borderRadius: radius.full,
          backgroundColor: DARK.surface,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {children}
      </View>
    </Pressable>
  );
}

type Inline =
  | { kind: 'text'; value: string; bold: boolean; start: number }
  | { kind: 'chip'; id: string; label: string; start: number };

type MarkdownBlock =
  | { kind: 'para'; inlines: Inline[]; start: number }
  | { kind: 'bullet'; inlines: Inline[]; start: number }
  // A numbered step keeps its OWN number. Re-deriving it from array position
  // renumbers a list that the answer deliberately started at 3.
  | { kind: 'num'; index: number; inlines: Inline[]; start: number }
  | { kind: 'h'; level: number; inlines: Inline[]; start: number }
  | { kind: 'table'; header: string[]; rows: string[][]; start: number }
  | { kind: 'divider'; start: number };

const MARKER_RE = /\[\[p:([^\]]+)\]\]/g;
const BOLD_RE = /\*\*([^*]+)\*\*/g;
const DIVIDER_RE = /^([-*_])\1{2,}$/;

function cleanInline(s: string): string {
  return s.replace(/\*/g, '');
}

function parseBold(s: string): { value: string; bold: boolean }[] {
  const out: { value: string; bold: boolean }[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  BOLD_RE.lastIndex = 0;
  while ((m = BOLD_RE.exec(s)) !== null) {
    if (m.index > last) out.push({ value: cleanInline(s.slice(last, m.index)), bold: false });
    out.push({ value: m[1]!, bold: true });
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push({ value: cleanInline(s.slice(last)), bold: false });
  return out;
}

function tokenizeInline(
  s: string,
  result: PeopleRankResult,
  startPlain: number,
): { inlines: Inline[]; next: number } {
  const segments: ({ text: string } | { chipId: string; label: string })[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  MARKER_RE.lastIndex = 0;
  while ((match = MARKER_RE.exec(s)) !== null) {
    const id = match[1]!.trim();
    const person = findPerson(result, id);
    const label = person?.name ?? 'Unknown';

    if (match.index > lastIndex) {
      let value = s.slice(lastIndex, match.index);
      const trimmedEnd = value.replace(/\s+$/, '');
      const cut = trimmedEnd.length - label.length;
      const boundaryOk = cut === 0 || /\s/.test(trimmedEnd[cut - 1] ?? '');
      if (
        label &&
        cut >= 0 &&
        boundaryOk &&
        trimmedEnd.slice(cut).toLowerCase() === label.toLowerCase()
      ) {
        value = trimmedEnd.slice(0, cut);
      }
      if (value) segments.push({ text: value });
    }
    segments.push({ chipId: id, label });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < s.length) segments.push({ text: s.slice(lastIndex) });

  const inlines: Inline[] = [];
  let plain = startPlain;
  for (const seg of segments) {
    if ('chipId' in seg) {
      inlines.push({ kind: 'chip', id: seg.chipId, label: seg.label, start: plain });
      plain += seg.label.length;
    } else {
      for (const part of parseBold(seg.text)) {
        if (!part.value) continue;
        inlines.push({ kind: 'text', value: part.value, bold: part.bold, start: plain });
        plain += part.value.length;
      }
    }
  }
  return { inlines, next: plain };
}

function parseMarkdown(answer: string, result: PeopleRankResult): { blocks: MarkdownBlock[]; total: number } {
  const blocks: MarkdownBlock[] = [];
  let plain = 0;
  let para: string[] = [];

  const flushPara = () => {
    if (para.length === 0) return;
    const text = para.join(' ').trim();
    para = [];
    if (!text) return;
    const start = plain;
    const { inlines, next } = tokenizeInline(text, result, plain);
    plain = next;
    if (inlines.length) blocks.push({ kind: 'para', inlines, start });
  };

  // AN INDEXED LOOP, BECAUSE A TABLE NEEDS LOOKAHEAD.
  //
  // This renderer used to know three things — paragraph, bullet, divider — so a
  // heading arrived as literal "## Where things stand", a numbered list lost its
  // numbers to paragraph flow, and a table came out as rows of pipe characters.
  // The main thread's renderer already handled all of it; the voice overlay had
  // its own copy that did not, so the same answer looked broken in one surface
  // and right in the other.
  const lines = answer.split('\n');
  const isTableRow = (t: string) => t.startsWith('|') && t.endsWith('|') && t.length > 2;
  const splitRow = (t: string) =>
    t
      .slice(1, -1)
      .split('|')
      .map((c) => cleanInline(c.replace(MARKER_RE, '')).trim());
  const isSeparator = (t: string) =>
    isTableRow(t) && splitRow(t).every((c) => /^:?-{2,}:?$/.test(c));

  for (let li = 0; li < lines.length; li += 1) {
    const trimmed = (lines[li] ?? '').trim();

    if (DIVIDER_RE.test(trimmed)) {
      flushPara();
      blocks.push({ kind: 'divider', start: plain });
      continue;
    }

    // Table: a header row, a |---|---| separator, then rows until the block ends.
    if (isTableRow(trimmed) && isSeparator((lines[li + 1] ?? '').trim())) {
      flushPara();
      const header = splitRow(trimmed);
      const rows: string[][] = [];
      let j = li + 2;
      while (j < lines.length) {
        const t = (lines[j] ?? '').trim();
        if (!isTableRow(t)) break;
        if (!isSeparator(t)) rows.push(splitRow(t));
        j += 1;
      }
      const start = plain;
      // Advance the reveal cursor by the table's own text length, so a table in
      // the middle of an answer does not make everything after it appear early.
      plain += [...header, ...rows.flat()].join(' ').length;
      blocks.push({ kind: 'table', header, rows, start });
      li = j - 1;
      continue;
    }

    const heading = trimmed.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      flushPara();
      const start = plain;
      const { inlines, next } = tokenizeInline(heading[2]!, result, plain);
      plain = next;
      if (inlines.length) blocks.push({ kind: 'h', level: heading[1]!.length, inlines, start });
      continue;
    }

    const bullet = trimmed.match(/^[-*]\s+(.*)$/);
    if (bullet) {
      flushPara();
      const start = plain;
      const { inlines, next } = tokenizeInline(bullet[1]!, result, plain);
      plain = next;
      if (inlines.length) blocks.push({ kind: 'bullet', inlines, start });
      continue;
    }

    const numbered = trimmed.match(/^(\d{1,3})[.)]\s+(.*)$/);
    if (numbered) {
      flushPara();
      const start = plain;
      const { inlines, next } = tokenizeInline(numbered[2]!, result, plain);
      plain = next;
      if (inlines.length)
        blocks.push({ kind: 'num', index: Number(numbered[1]), inlines, start });
      continue;
    }

    if (trimmed === '') {
      flushPara();
      continue;
    }
    para.push(trimmed);
  }
  flushPara();

  return { blocks, total: plain };
}

function AnswerText({
  answer,
  result,
  reduceMotion,
  instant,
  onOpenPerson,
}: {
  answer: string;
  result: PeopleRankResult;
  reduceMotion: boolean;
  instant?: boolean;
  onOpenPerson: (id: string) => void;
}) {
  const { blocks, total } = useMemo(() => parseMarkdown(answer, result), [answer, result]);
  const revealed = useProgressiveReveal(total, reduceMotion || !!instant);

  const renderInline = (inl: Inline, key: string) => {
    if (inl.kind === 'chip') {
      if (revealed <= inl.start) return null;
      return (
        <CitationChip key={key} label={inl.label} onPress={() => onOpenPerson(inl.id)} />
      );
    }
    const shown =
      revealed >= inl.start + inl.value.length
        ? inl.value
        : revealed <= inl.start
          ? ''
          : inl.value.slice(0, revealed - inl.start);
    if (!shown) return null;
    return (
      <Text key={key} style={{ color: DARK.textPrimary, ...(inl.bold ? { fontFamily: fonts.bold } : {}) }}>
        {shown}
      </Text>
    );
  };

  return (
    <View>
      {blocks.map((block, bi) => {
        if (block.kind === 'divider') {
          if (revealed <= block.start) return null;
          return (
            <View
              key={bi}
              style={{ height: 1, backgroundColor: DARK.hairline, marginVertical: spacing.md }}
            />
          );
        }

        if (block.kind === 'table') {
          if (revealed <= block.start) return null;
          const cols = Math.max(block.header.length, ...block.rows.map((r) => r.length), 1);
          const cell = (text: string, header: boolean, ci: number) => (
            <View
              key={ci}
              style={{
                minWidth: 92,
                maxWidth: 220,
                flexGrow: 1,
                paddingVertical: spacing.xs,
                paddingRight: spacing.md,
              }}
            >
              <Text
                variant="bodySm"
                style={{
                  color: header ? DARK.textSecondary : DARK.textPrimary,
                  lineHeight: 21,
                  ...(header ? { fontFamily: fonts.bold } : {}),
                }}
              >
                {text}
              </Text>
            </View>
          );
          const pad = (r: string[]) => Array.from({ length: cols }, (_, i) => r[i] ?? '');
          return (
            <View key={bi} style={{ marginTop: bi === 0 ? 0 : spacing.md }}>
              {/* A table is the one block that can be wider than the screen, so it
                  scrolls INSIDE its own row rather than making the page scroll
                  sideways. */}
              <ScrollView horizontal showsHorizontalScrollIndicator={cols > 3}>
                <View>
                  <View style={{ flexDirection: 'row' }}>
                    {pad(block.header).map((c, ci) => cell(c, true, ci))}
                  </View>
                  <View style={{ height: 1, backgroundColor: DARK.hairline }} />
                  {block.rows.map((r, ri) => (
                    <View key={ri}>
                      {ri > 0 ? (
                        <View style={{ height: 1, backgroundColor: DARK.hairline, opacity: 0.5 }} />
                      ) : null}
                      <View style={{ flexDirection: 'row' }}>
                        {pad(r).map((c, ci) => cell(c, false, ci))}
                      </View>
                    </View>
                  ))}
                </View>
              </ScrollView>
            </View>
          );
        }

        const children = block.inlines
          .map((inl, ii) => renderInline(inl, `${bi}-${ii}`))
          .filter(Boolean);
        if (children.length === 0) return null;

        // Space is what makes an answer readable, and it is not uniform: a heading
        // needs room above it and almost none below, and list items sit tighter to
        // each other than paragraphs do.
        const prev = bi > 0 ? blocks[bi - 1] : undefined;
        const marginTop =
          bi === 0
            ? 0
            : block.kind === 'h'
              ? spacing.lg
              : prev?.kind === 'h'
                ? spacing.xs
                : block.kind === 'bullet' || block.kind === 'num'
                  ? spacing.xs
                  : spacing.sm;

        if (block.kind === 'h') {
          return (
            <Text
              key={bi}
              variant="bodyMd"
              style={{
                marginTop,
                color: DARK.textPrimary,
                fontFamily: fonts.bold,
                lineHeight: 24,
                letterSpacing: block.level <= 2 ? -0.2 : -0.1,
              }}
            >
              {children}
            </Text>
          );
        }

        if (block.kind === 'bullet' || block.kind === 'num') {
          const marker = block.kind === 'num' ? `${block.index}.` : '\u2022';
          return (
            <View key={bi} style={{ flexDirection: 'row', marginTop }}>
              <Text
                variant="bodyMd"
                style={{
                  color: DARK.textSecondary,
                  lineHeight: 25,
                  marginRight: spacing.sm,
                  // Numbers need a fixed gutter or "9." and "10." push their text
                  // to different left edges.
                  ...(block.kind === 'num' ? { minWidth: 22 } : {}),
                }}
              >
                {marker}
              </Text>
              <Text
                variant="bodyMd"
                style={{ flex: 1, color: DARK.textPrimary, lineHeight: 25, letterSpacing: -0.1 }}
              >
                {children}
              </Text>
            </View>
          );
        }

        return (
          <Text
            key={bi}
            variant="bodyMd"
            style={{ marginTop, color: DARK.textPrimary, lineHeight: 25, letterSpacing: -0.1 }}
          >
            {children}
          </Text>
        );
      })}
    </View>
  );
}

function useProgressiveReveal(total: number, reduceMotion: boolean) {
  const [count, setCount] = useState(reduceMotion ? total : 0);

  useEffect(() => {
    if (reduceMotion || total === 0) {
      setCount(total);
      return;
    }
    setCount(0);
    let current = 0;
    // Was total/70 every 20ms — a fixed ~1.4s to reveal any answer, which felt
    // slow. total/40 every 10ms lands around ~0.4s: quick and clean, and still
    // a reveal rather than a pop. The floor of 4 keeps very short answers from
    // crawling one character at a time.
    const step = Math.max(4, Math.round(total / 40));
    const timer = setInterval(() => {
      current = Math.min(total, current + step);
      setCount(current);
      if (current >= total) clearInterval(timer);
    }, 10);
    return () => clearInterval(timer);
  }, [total, reduceMotion]);

  return count;
}

// A highlighted name inside the answer.
//
// This used to spring its opacity 0→1 on mount, so each name faded in well after
// the text around it had already arrived — the "citations fill in slowly" feel.
// The chip is now fully opaque the instant the reveal reaches it, which is the
// right moment anyway: the reveal itself is the animation, and the highlight is
// part of the text, not a separate thing arriving late.
function CitationChip({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Text
      onPress={onPress}
      suppressHighlighting
      style={{
        color: DARK.chipText,
        backgroundColor: DARK.chipBg,
        borderRadius: radius.sm,
        fontFamily: fonts.semibold,
      }}
    >
      {` ${label} `}
    </Text>
  );
}

function RankRow({
  person,
  rank,
  onPress,
}: {
  person: RankedPerson;
  rank: number;
  onPress: () => void;
}) {
  const subtitle = [person.company, person.title].filter(Boolean).join(' · ');
  const isTop = rank <= 3;
  const pct = Math.round(normalizeScore(person.score) * 100);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={person.name}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.base,
        paddingVertical: spacing.base,
        opacity: pressed ? 0.55 : 1,
      })}
    >
      <Text
        variant="captionSm"
        style={{
          color: DARK.textMuted,
          width: 20,
          textAlign: 'right',
          fontVariant: ['tabular-nums'],
          alignSelf: isTop ? 'flex-start' : 'center',
        }}
      >
        {rank}
      </Text>
      <View style={{ flex: 1 }}>
        <Text
          variant="titleMd"
          numberOfLines={1}
          style={{ color: DARK.textPrimary, letterSpacing: -0.2 }}
        >
          {person.name}
        </Text>
        {subtitle ? (
          <Text
            variant="captionSm"
            numberOfLines={1}
            style={{ color: DARK.textSecondary, letterSpacing: -0.1, marginTop: 3 }}
          >
            {subtitle}
          </Text>
        ) : null}
        {isTop && person.reason ? (
          <Text
            variant="captionSm"
            numberOfLines={1}
            style={{ color: DARK.textSecondary, letterSpacing: -0.1, marginTop: 3 }}
          >
            {person.reason}
          </Text>
        ) : null}
      </View>
      {isTop && pct > 0 ? (
        <Text
          variant="captionSm"
          style={{
            color: DARK.chipText,
            fontVariant: ['tabular-nums'],
            alignSelf: 'flex-start',
            marginLeft: spacing.sm,
          }}
        >
          {pct}%
        </Text>
      ) : null}
    </Pressable>
  );
}

// ── Shared primitives ────────────────────────────────────────────

// Duplicated from HomePage.tsx (also used there by DayChatsModal's loading
// skeleton) — trivial enough that a shared export isn't worth a new file.
function Block({
  w,
  h,
  radius: r = radius.sm,
}: {
  w: number | `${number}%`;
  h: number;
  radius?: number;
}) {
  return <View style={{ width: w, height: h, borderRadius: r, backgroundColor: DARK.surface }} />;
}

function FadeIn({ children, reduceMotion }: { children: React.ReactNode; reduceMotion: boolean }) {
  const progress = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;
  useEffect(() => {
    if (reduceMotion) {
      progress.setValue(1);
      return;
    }
    Animated.timing(progress, {
      toValue: 1,
      duration: 320,
      useNativeDriver: true,
    }).start();
  }, [progress, reduceMotion]);
  return (
    <Animated.View
      style={{
        opacity: progress,
        transform: [
          { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) },
        ],
      }}
    >
      {children}
    </Animated.View>
  );
}

function Stagger({
  index,
  reduceMotion,
  children,
}: {
  index: number;
  reduceMotion: boolean;
  children: React.ReactNode;
}) {
  const progress = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;
  useEffect(() => {
    if (reduceMotion) {
      progress.setValue(1);
      return;
    }
    const delay = Math.min(index, 14) * 40;
    const timer = setTimeout(() => {
      if (index < 6) void Haptics.selectionAsync().catch(() => {});
      Animated.spring(progress, {
        toValue: 1,
        useNativeDriver: true,
        friction: 8,
        tension: 80,
      }).start();
    }, delay);
    return () => clearTimeout(timer);
  }, [progress, index, reduceMotion]);
  return (
    <Animated.View
      style={{
        opacity: progress,
        transform: [
          { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) },
        ],
      }}
    >
      {children}
    </Animated.View>
  );
}
