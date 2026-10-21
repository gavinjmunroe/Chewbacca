import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  Text as RNText,
  TextInput as RNTextInput,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { useRouter } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { ChevronDown, Copy, RefreshCw, Send, Square } from 'lucide-react-native';
import { Card } from './Card';
import { EmptyState } from './EmptyState';
import { IconButton } from './IconButton';
import { Screen } from './Screen';
import { Text } from './Text';
import {
  askAgent,
  clearChatHistory,
  loadChatHistory,
  saveChatHistory,
  type AgentTarget,
  type AskMessage,
} from '../lib/agent';
import { signOut } from '../lib/auth';
import { toast } from '../lib/toast';
import { colors, fonts, radius, spacing, typography } from '../lib/tokens';

// Per-agent copy + starter prompts. Medha (S/E/P) and Togari (I/F/S) are
// distinct agents with separate backends; askAgent() routes to the right one.
// Each tab hosts a single agent (no toggle): Personal = Medha, Professional =
// Togari. Both calls go through the authed medha-platform backend: Medha
// streams from /api/v1/quick-call/stream and Togari is proxied through
// /api/v1/togari/message (the server holds the Togari key).
const AGENT_COPY: Record<
  AgentTarget,
  { name: string; prompt: string; placeholder: string; starters: string[] }
> = {
  medha: {
    name: 'Medha',
    prompt: 'Ask about your network, your week, or anything on your calendar and inbox.',
    placeholder: 'Ask Medha',
    starters: [
      'Who should I follow up with this week?',
      'What does my day look like?',
      'Who do I know in healthcare?',
    ],
  },
  togari: {
    name: 'Togari',
    prompt: 'Search a contact, check a deal, or ask about your professional network.',
    placeholder: 'Ask Togari',
    starters: ['Show my latest deals', 'Search a contact', 'Who closed recently?'],
  },
};

type ChatStatus = 'streaming' | 'done' | 'error';

type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: number;
  status: ChatStatus;
  error?: string;
  tools?: string[];
};

type ActiveTool = { name: string; label?: string };

// A non-recoverable gate that should take over the whole surface (vs. an inline
// error bubble): finish-onboarding (403/424) or entitlement upsell (402).
type Gate = { kind: 'identity' } | { kind: 'entitlement' };

// Collapse very long answers behind a "Show more" toggle so a wall of text
// never dominates the transcript.
const LONG_MESSAGE_CHARS = 640;

// A dedicated single-agent chat surface. `agent` is fixed by the host tab.
export function AgentChat({ agent }: { agent: AgentTarget }) {
  const router = useRouter();
  const copy = AGENT_COPY[agent];
  const reduceMotion = useReducedMotion();

  const [input, setInput] = useState('');
  const [inputHeight, setInputHeight] = useState(0);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [activeTool, setActiveTool] = useState<ActiveTool | null>(null);
  const [slowWait, setSlowWait] = useState(false);
  const [gate, setGate] = useState<Gate | null>(null);
  const [showScrollDown, setShowScrollDown] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const scrollRef = useRef<ScrollView | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const slowTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isNearBottomRef = useRef(true);
  const hydratedRef = useRef(false);
  const idRef = useRef(0);
  const nextId = () => `m${Date.now()}-${idRef.current++}`;

  // Rehydrate the visible transcript on open so a session is not lost when the
  // app is backgrounded or killed. Server-side memory is the source of truth;
  // this is purely a UI convenience.
  useEffect(() => {
    let mounted = true;
    loadChatHistory(agent)
      .then((hist) => {
        if (!mounted || hist.length === 0) return;
        setMessages(
          hist.map((h) => ({
            id: h.id,
            role: h.role,
            content: h.content,
            createdAt: h.createdAt,
            status: 'done' as const,
            tools: h.tools,
          })),
        );
      })
      .finally(() => {
        if (mounted) hydratedRef.current = true;
      });
    return () => {
      mounted = false;
    };
  }, [agent]);

  // Persist a render-only snapshot (no transient streaming/error rows) shortly
  // after the transcript settles. Debounced so a fast token stream does not
  // thrash storage.
  useEffect(() => {
    if (!hydratedRef.current) return;
    const persistable = messages
      .filter((m) => m.status === 'done' && m.content.trim().length > 0)
      .map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        createdAt: m.createdAt,
        tools: m.tools,
      }));
    const t = setTimeout(() => {
      void saveChatHistory(agent, persistable);
    }, 400);
    return () => clearTimeout(t);
  }, [messages, agent]);

  // Abort any in-flight stream and clear timers when the screen unmounts so a
  // dangling reader and the request behind it are torn down cleanly.
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      if (slowTimerRef.current) clearTimeout(slowTimerRef.current);
    };
  }, []);

  const clearSlowTimer = () => {
    if (slowTimerRef.current) clearTimeout(slowTimerRef.current);
    slowTimerRef.current = null;
    setSlowWait(false);
  };

  const scrollToEnd = useCallback((animated = true) => {
    requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated }));
  }, []);

  const patchMessage = useCallback((id: string, patch: Partial<ChatMessage>) => {
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  }, []);

  // Drop an assistant message and the user turn immediately before it. Used by
  // the gate and the session-expired path so no dead bubble is left behind.
  const removeTurn = useCallback((assistantId: string) => {
    setMessages((prev) => {
      const idx = prev.findIndex((m) => m.id === assistantId);
      if (idx === -1) return prev;
      const start = idx > 0 && prev[idx - 1]!.role === 'user' ? idx - 1 : idx;
      return [...prev.slice(0, start), ...prev.slice(idx + 1)];
    });
  }, []);

  const runAssistant = useCallback(
    async (question: string, assistantId: string, history: AskMessage[]) => {
      setStreaming(true);
      setActiveTool(null);
      clearSlowTimer();
      // Show a "still working" state if the agent takes a beat before its first
      // token or tool event (tool turns routinely run 15-40s server-side).
      slowTimerRef.current = setTimeout(() => setSlowWait(true), 6000);

      const controller = new AbortController();
      abortRef.current = controller;

      let assistantText = '';
      const tools: string[] = [];

      // A dead session never recovers by retrying: revoke locally and bounce to
      // sign-in instead of showing a "try again" bubble that loops forever.
      const handleSessionExpired = () => {
        removeTurn(assistantId);
        void signOut().finally(() => router.replace('/(auth)/sign-in'));
      };

      try {
        await askAgent({
          agent,
          question,
          history,
          signal: controller.signal,
          onEvent: (e) => {
            if (e.kind === 'tool') {
              if (e.phase === 'start') {
                setActiveTool({ name: e.name, label: e.label });
                if (!tools.includes(e.name)) {
                  tools.push(e.name);
                  patchMessage(assistantId, { tools: [...tools] });
                }
              } else {
                setActiveTool((cur) => (cur && cur.name === e.name ? null : cur));
              }
            } else if (e.kind === 'token') {
              clearSlowTimer();
              setActiveTool(null);
              assistantText += e.delta;
              patchMessage(assistantId, { content: assistantText, status: 'streaming' });
              if (isNearBottomRef.current) scrollToEnd();
            } else if (e.kind === 'done') {
              if (e.answer) {
                assistantText = e.answer;
                patchMessage(assistantId, { content: assistantText });
              }
            } else if (e.kind === 'complete') {
              clearSlowTimer();
              setActiveTool(null);
              if (assistantText.trim().length === 0) {
                patchMessage(assistantId, { status: 'error', error: 'empty_response' });
              } else {
                patchMessage(assistantId, { status: 'done' });
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
              }
            } else if (e.kind === 'error') {
              clearSlowTimer();
              setActiveTool(null);
              if (isSessionExpired(e.error)) {
                handleSessionExpired();
                return;
              }
              const g = gateFor(e.error);
              if (g) {
                removeTurn(assistantId);
                setGate(g);
                return;
              }
              patchMessage(assistantId, { status: 'error', error: e.error });
            }
          },
        });
      } finally {
        clearSlowTimer();
        if (abortRef.current === controller) abortRef.current = null;
        setStreaming(false);
        setActiveTool(null);
        // A stream can end without a terminal frame (manual stop / abort, or
        // togari's done-without-complete). Settle any lingering streaming bubble
        // so the composer never wedges and the cursor never blinks forever.
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId && m.status === 'streaming'
              ? m.content.trim().length > 0
                ? { ...m, status: 'done' }
                : { ...m, status: 'error', error: 'empty_response' }
              : m,
          ),
        );
      }
    },
    [agent, patchMessage, removeTurn, router, scrollToEnd],
  );

  const buildHistory = (upto: ChatMessage[]): AskMessage[] =>
    upto
      .filter((m) => m.status !== 'error' && m.content.trim().length > 0)
      .map((m) => ({ role: m.role, content: m.content }));

  const send = useCallback(
    (raw?: string) => {
      const question = (raw ?? input).trim();
      if (!question || streaming) return;
      if (raw === undefined) setInput('');
      Haptics.selectionAsync().catch(() => {});

      const history = buildHistory(messages);
      const userId = nextId();
      const assistantId = nextId();
      const now = Date.now();
      setMessages((prev) => [
        ...prev,
        { id: userId, role: 'user', content: question, createdAt: now, status: 'done' },
        { id: assistantId, role: 'assistant', content: '', createdAt: now, status: 'streaming' },
      ]);
      isNearBottomRef.current = true;
      scrollToEnd();
      void runAssistant(question, assistantId, history);
    },
    [input, messages, runAssistant, scrollToEnd, streaming],
  );

  // Re-run the user turn that produced this assistant message, replacing it in
  // place. Backs both the error-bubble Retry and the done-bubble Regenerate.
  const regenerate = useCallback(
    (assistantId: string) => {
      if (streaming) return;
      const idx = messages.findIndex((m) => m.id === assistantId);
      if (idx < 1) return;
      const userMsg = messages[idx - 1]!;
      if (userMsg.role !== 'user') return;
      const history = buildHistory(messages.slice(0, idx - 1));
      patchMessage(assistantId, {
        content: '',
        status: 'streaming',
        error: undefined,
        tools: undefined,
        createdAt: Date.now(),
      });
      Haptics.selectionAsync().catch(() => {});
      void runAssistant(userMsg.content, assistantId, history);
    },
    [messages, patchMessage, runAssistant, streaming],
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
    setActiveTool(null);
    clearSlowTimer();
    setMessages((prev) =>
      prev.map((m) =>
        m.status === 'streaming'
          ? m.content.trim().length > 0
            ? { ...m, status: 'done' }
            : { ...m, status: 'error', error: 'empty_response' }
          : m,
      ),
    );
  }, []);

  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { layoutMeasurement, contentOffset, contentSize } = e.nativeEvent;
    const distanceFromBottom = contentSize.height - (contentOffset.y + layoutMeasurement.height);
    const nearBottom = distanceFromBottom < 80;
    isNearBottomRef.current = nearBottom;
    setShowScrollDown(!nearBottom);
  }, []);

  const toggleExpanded = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const copyMessage = useCallback(async (text: string) => {
    await Clipboard.setStringAsync(text);
    Haptics.selectionAsync().catch(() => {});
    toast.success('Copied');
  }, []);

  const onClear = useCallback(() => {
    if (streaming) return;
    setMessages([]);
    setExpanded(new Set());
    void clearChatHistory(agent);
    Haptics.selectionAsync().catch(() => {});
  }, [agent, streaming]);

  if (gate) {
    return (
      <GateState
        gate={gate}
        agentName={copy.name}
        onProfile={() => router.push('/(gated)/home?tab=profile')}
        onDismiss={() => setGate(null)}
      />
    );
  }

  const lastMessage = messages[messages.length - 1];
  const showFollowUps =
    !streaming && lastMessage?.role === 'assistant' && lastMessage.status === 'done';

  const minLine = 22;
  const maxLine = minLine * 6;
  const composerHeight = Math.min(Math.max(inputHeight || minLine, minLine), maxLine);

  return (
    <Screen padded={false}>
      <View style={{ flex: 1 }}>
        {messages.length > 0 ? (
          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'flex-end',
              paddingHorizontal: spacing.lg,
              paddingTop: spacing.sm,
            }}
          >
            <Pressable
              onPress={onClear}
              disabled={streaming}
              accessibilityRole="button"
              accessibilityLabel="Clear conversation"
              hitSlop={8}
              style={{ opacity: streaming ? 0.4 : 1, paddingVertical: spacing.xs }}
            >
              <Text variant="caption" color="muted">
                Clear
              </Text>
            </Pressable>
          </View>
        ) : null}

        <ScrollView
          ref={scrollRef}
          onScroll={onScroll}
          scrollEventThrottle={32}
          contentContainerStyle={{
            paddingHorizontal: spacing.lg,
            paddingTop: spacing.base,
            paddingBottom: spacing.base,
            gap: spacing.md,
            flexGrow: messages.length === 0 ? 1 : undefined,
          }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {messages.length === 0 ? (
            <Intro copy={copy} onPick={(p) => send(p)} />
          ) : (
            messages.map((m, i) => {
              const nextMsg = messages[i + 1];
              const delivered =
                m.role === 'user' && nextMsg?.role === 'assistant' && nextMsg.status === 'done';
              return (
                <MessageRow
                  key={m.id}
                  message={m}
                  delivered={delivered}
                  isStreamingBubble={m.status === 'streaming'}
                  activeTool={m.status === 'streaming' ? activeTool : null}
                  slowWait={m.status === 'streaming' ? slowWait : false}
                  reduceMotion={reduceMotion}
                  expanded={expanded.has(m.id)}
                  onToggleExpanded={() => toggleExpanded(m.id)}
                  onCopy={() => void copyMessage(m.content)}
                  onRegenerate={() => regenerate(m.id)}
                />
              );
            })
          )}

          {showFollowUps ? <FollowUps suggestions={copy.starters} onPick={(p) => send(p)} /> : null}
        </ScrollView>

        {showScrollDown ? (
          <View style={{ position: 'absolute', right: spacing.lg, bottom: spacing.base }}>
            <IconButton
              accessibilityLabel="Scroll to latest"
              size={40}
              variant="soft"
              onPress={() => {
                isNearBottomRef.current = true;
                setShowScrollDown(false);
                scrollToEnd();
              }}
            >
              <ChevronDown color={colors.ink} size={20} />
            </IconButton>
          </View>
        ) : null}

        <View
          style={{
            paddingHorizontal: spacing.lg,
            paddingVertical: spacing.md,
            borderTopWidth: 1,
            borderTopColor: colors.hairline,
            flexDirection: 'row',
            gap: spacing.sm,
            alignItems: 'flex-end',
          }}
        >
          <View
            style={{
              flex: 1,
              backgroundColor: colors.canvas,
              borderRadius: radius.md,
              borderWidth: 1,
              borderColor: colors.hairline,
              paddingHorizontal: 12,
              paddingVertical: 10,
              justifyContent: 'center',
              minHeight: 48,
            }}
          >
            <RNTextInput
              value={input}
              onChangeText={setInput}
              placeholder={copy.placeholder}
              placeholderTextColor={colors.mutedSoft}
              multiline
              onContentSizeChange={(e) => setInputHeight(e.nativeEvent.contentSize.height)}
              accessibilityLabel={`Message ${copy.name}`}
              style={{
                fontFamily: fonts.regular,
                fontSize: typography.bodyMd.fontSize,
                lineHeight: minLine,
                color: colors.ink,
                height: composerHeight,
                padding: 0,
                textAlignVertical: 'center',
              }}
            />
          </View>
          {streaming ? (
            <IconButton accessibilityLabel="Stop" size={48} variant="soft" onPress={stop}>
              <Square color={colors.ink} size={18} />
            </IconButton>
          ) : (
            <IconButton
              accessibilityLabel="Send"
              size={48}
              variant={input.trim() ? 'rausch' : 'soft'}
              onPress={() => send()}
            >
              <Send color={input.trim() ? colors.onPrimary : colors.mutedSoft} size={20} />
            </IconButton>
          )}
        </View>
      </View>
    </Screen>
  );
}

// Intro / empty state

function Intro({
  copy,
  onPick,
}: {
  copy: { name: string; prompt: string; starters: string[] };
  onPick: (prompt: string) => void;
}) {
  return (
    <View style={{ gap: spacing.lg, justifyContent: 'center', flex: 1 }}>
      <Card>
        <View style={{ gap: spacing.sm }}>
          <Text variant="microLabel" color="primary" uppercase>
            {copy.name}
          </Text>
          <Text variant="displaySm">Ask {copy.name}.</Text>
          <Text variant="bodyMd" color="muted">
            {copy.prompt}
          </Text>
        </View>
      </Card>
      <View style={{ gap: spacing.sm }}>
        <Text variant="caption" color="mutedSoft" uppercase>
          Try asking
        </Text>
        <View style={{ gap: spacing.sm }}>
          {copy.starters.map((s) => (
            <Pressable key={s} onPress={() => onPick(s)} accessibilityRole="button" accessibilityLabel={s}>
              {({ pressed }) => (
                <View
                  style={{
                    backgroundColor: pressed ? colors.surfaceStrong : colors.surfaceSoft,
                    borderRadius: radius.md,
                    borderWidth: 1,
                    borderColor: colors.hairline,
                    paddingHorizontal: spacing.base,
                    paddingVertical: spacing.md,
                  }}
                >
                  <Text variant="bodyMd">{s}</Text>
                </View>
              )}
            </Pressable>
          ))}
        </View>
      </View>
    </View>
  );
}

function FollowUps({
  suggestions,
  onPick,
}: {
  suggestions: string[];
  onPick: (prompt: string) => void;
}) {
  return (
    <View
      style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.xs }}
    >
      {suggestions.map((s) => (
        <Pressable key={s} onPress={() => onPick(s)} accessibilityRole="button" accessibilityLabel={s}>
          {({ pressed }) => (
            <View
              style={{
                backgroundColor: pressed ? colors.surfaceStrong : colors.surfaceSoft,
                borderRadius: radius.full,
                borderWidth: 1,
                borderColor: colors.hairline,
                paddingHorizontal: spacing.base,
                paddingVertical: spacing.sm,
              }}
            >
              <Text variant="bodySm" color="body">
                {s}
              </Text>
            </View>
          )}
        </Pressable>
      ))}
    </View>
  );
}

// Message row

function MessageRow({
  message,
  delivered,
  isStreamingBubble,
  activeTool,
  slowWait,
  reduceMotion,
  expanded,
  onToggleExpanded,
  onCopy,
  onRegenerate,
}: {
  message: ChatMessage;
  delivered: boolean;
  isStreamingBubble: boolean;
  activeTool: ActiveTool | null;
  slowWait: boolean;
  reduceMotion: boolean;
  expanded: boolean;
  onToggleExpanded: () => void;
  onCopy: () => void;
  onRegenerate: () => void;
}) {
  if (message.role === 'user') {
    return (
      <View style={{ alignSelf: 'flex-end', maxWidth: '85%', gap: spacing.xxs }}>
        <View
          style={{
            backgroundColor: colors.primary,
            borderRadius: radius.lg,
            paddingHorizontal: spacing.base,
            paddingVertical: spacing.md,
          }}
        >
          <Text variant="bodyMd" style={{ color: colors.onPrimary }}>
            {message.content}
          </Text>
        </View>
        <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.xs }}>
          <Text variant="captionSm" color="mutedSoft">
            {formatTime(message.createdAt)}
          </Text>
          {delivered ? (
            <Text variant="captionSm" color="mutedSoft">
              Delivered
            </Text>
          ) : null}
        </View>
      </View>
    );
  }

  const isError = message.status === 'error';
  const isThinking = isStreamingBubble && message.content.trim().length === 0;

  return (
    // Full-width block (not a shrink-wrapped bubble): the assistant content renders
    // Markdown with flexDirection:'row' list rows, and a shrink-wrapped parent makes
    // Yoga collapse those rows to one-word-per-line. alignSelf:'stretch' gives the
    // content a definite width so text wraps at the edge, like Perplexity answers.
    <View style={{ alignSelf: 'stretch', gap: spacing.xxs }}>
      <View
        style={{
          backgroundColor: colors.surfaceSoft,
          borderRadius: radius.lg,
          paddingHorizontal: spacing.base,
          paddingVertical: spacing.md,
          gap: spacing.sm,
        }}
      >
        {isError ? (
          <ErrorBubble code={message.error} onRetry={onRegenerate} />
        ) : isThinking ? (
          <ThinkingState activeTool={activeTool} slowWait={slowWait} reduceMotion={reduceMotion} />
        ) : isStreamingBubble ? (
          <StreamingText content={message.content} reduceMotion={reduceMotion} />
        ) : (
          <AssistantAnswer
            content={message.content}
            tools={message.tools}
            expanded={expanded}
            onToggleExpanded={onToggleExpanded}
          />
        )}
      </View>

      {!isError ? (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: spacing.md,
            paddingLeft: spacing.xs,
          }}
        >
          <Text variant="captionSm" color="mutedSoft">
            {formatTime(message.createdAt)}
          </Text>
          {message.status === 'done' ? (
            <>
              <Pressable
                onPress={onCopy}
                accessibilityRole="button"
                accessibilityLabel="Copy reply"
                hitSlop={8}
              >
                <Copy color={colors.mutedSoft} size={15} />
              </Pressable>
              <Pressable
                onPress={onRegenerate}
                accessibilityRole="button"
                accessibilityLabel="Regenerate reply"
                hitSlop={8}
              >
                <RefreshCw color={colors.mutedSoft} size={15} />
              </Pressable>
            </>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function ErrorBubble({ code, onRetry }: { code?: string; onRetry: () => void }) {
  return (
    <View style={{ gap: spacing.sm }}>
      <Text variant="bodyMd" color="body">
        {errorCopy(code ?? 'unknown')}
      </Text>
      <Pressable
        onPress={onRetry}
        accessibilityRole="button"
        accessibilityLabel="Try again"
        style={{ alignSelf: 'flex-start' }}
      >
        {({ pressed }) => (
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: spacing.xs,
              backgroundColor: pressed ? colors.surfaceStrong : colors.canvas,
              borderRadius: radius.sm,
              borderWidth: 1,
              borderColor: colors.hairline,
              paddingHorizontal: spacing.md,
              paddingVertical: spacing.sm,
            }}
          >
            <RefreshCw color={colors.ink} size={14} />
            <Text variant="buttonSm">Try again</Text>
          </View>
        )}
      </Pressable>
    </View>
  );
}

function ThinkingState({
  activeTool,
  slowWait,
  reduceMotion,
}: {
  activeTool: ActiveTool | null;
  slowWait: boolean;
  reduceMotion: boolean;
}) {
  if (activeTool) {
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
        <PulseDot reduceMotion={reduceMotion} />
        <Text variant="bodySm" color="muted">
          {toolStatusLabel(activeTool)}
        </Text>
      </View>
    );
  }
  if (slowWait) {
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
        <TypingDots reduceMotion={reduceMotion} />
        <Text variant="bodySm" color="muted">
          Still working on it
        </Text>
      </View>
    );
  }
  return <TypingDots reduceMotion={reduceMotion} />;
}

function StreamingText({ content, reduceMotion }: { content: string; reduceMotion: boolean }) {
  return (
    <Text variant="bodyMd" color="body">
      {content}
      <Cursor reduceMotion={reduceMotion} />
    </Text>
  );
}

function AssistantAnswer({
  content,
  tools,
  expanded,
  onToggleExpanded,
}: {
  content: string;
  tools?: string[];
  expanded: boolean;
  onToggleExpanded: () => void;
}) {
  const isLong = content.length > LONG_MESSAGE_CHARS;
  const shown =
    isLong && !expanded ? `${content.slice(0, LONG_MESSAGE_CHARS).trimEnd()}…` : content;
  return (
    <View style={{ gap: spacing.sm }}>
      <Markdown content={shown} />
      {isLong ? (
        <Pressable onPress={onToggleExpanded} accessibilityRole="button" hitSlop={6}>
          <Text variant="buttonSm" color="primary">
            {expanded ? 'Show less' : 'Show more'}
          </Text>
        </Pressable>
      ) : null}
      {tools && tools.length > 0 ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
          {tools.map((t) => (
            <View
              key={t}
              style={{
                backgroundColor: colors.surfaceStrong,
                borderRadius: radius.full,
                paddingHorizontal: spacing.sm,
                paddingVertical: spacing.xxs,
              }}
            >
              <Text variant="captionSm" color="muted">
                {toolChipLabel(t)}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

// Markdown (lightweight, render-time, no dependency)

type Span = { text: string; bold?: boolean; italic?: boolean; code?: boolean; href?: string };

function parseInline(input: string): Span[] {
  const spans: Span[] = [];
  const matchers: { re: RegExp; make: (m: RegExpExecArray) => Span }[] = [
    { re: /^\[([^\]]+)\]\(([^)\s]+)\)/, make: (m) => ({ text: m[1]!, href: m[2]! }) },
    { re: /^\*\*([^*]+)\*\*/, make: (m) => ({ text: m[1]!, bold: true }) },
    { re: /^__([^_]+)__/, make: (m) => ({ text: m[1]!, bold: true }) },
    { re: /^`([^`]+)`/, make: (m) => ({ text: m[1]!, code: true }) },
    { re: /^\*([^*]+)\*/, make: (m) => ({ text: m[1]!, italic: true }) },
    { re: /^_([^_]+)_/, make: (m) => ({ text: m[1]!, italic: true }) },
  ];
  let buffer = '';
  let i = 0;
  while (i < input.length) {
    const rest = input.slice(i);
    let matched = false;
    for (const matcher of matchers) {
      const m = matcher.re.exec(rest);
      if (m) {
        if (buffer) {
          spans.push({ text: buffer });
          buffer = '';
        }
        spans.push(matcher.make(m));
        i += m[0].length;
        matched = true;
        break;
      }
    }
    if (!matched) {
      buffer += input[i];
      i += 1;
    }
  }
  if (buffer) spans.push({ text: buffer });
  return spans;
}

function openLink(url: string) {
  Linking.openURL(url).catch(() => toast.error('Could not open link'));
}

function InlineSpans({ text }: { text: string }) {
  const spans = useMemo(() => parseInline(text), [text]);
  return (
    <Text variant="bodyMd" color="body">
      {spans.map((s, idx) => {
        if (s.href) {
          return (
            <RNText
              key={idx}
              onPress={() => openLink(s.href!)}
              style={{ color: colors.primary, textDecorationLine: 'underline' }}
            >
              {s.text}
            </RNText>
          );
        }
        return (
          <RNText
            key={idx}
            style={{
              fontFamily: s.bold ? fonts.semibold : fonts.regular,
              fontStyle: s.italic ? 'italic' : 'normal',
              ...(s.code
                ? {
                    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
                    backgroundColor: colors.surfaceStrong,
                  }
                : null),
            }}
          >
            {s.text}
          </RNText>
        );
      })}
    </Text>
  );
}

function Markdown({ content }: { content: string }) {
  const lines = useMemo(() => content.replace(/\r\n/g, '\n').split('\n'), [content]);
  return (
    <View style={{ gap: spacing.xs }}>
      {lines.map((line, idx) => (
        <MarkdownLine key={idx} line={line} />
      ))}
    </View>
  );
}

function MarkdownLine({ line }: { line: string }) {
  if (line.trim().length === 0) {
    return <View style={{ height: spacing.xs }} />;
  }
  const heading = /^(#{1,3})\s+(.*)$/.exec(line);
  if (heading) {
    return (
      <Text variant="titleMd" color="ink" style={{ marginTop: spacing.xs }}>
        {heading[2]}
      </Text>
    );
  }
  const ordered = /^(\d+)\.\s+(.*)$/.exec(line);
  if (ordered) {
    return (
      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
        <Text variant="bodyMd" color="muted">
          {ordered[1]}.
        </Text>
        <View style={{ flex: 1 }}>
          <InlineSpans text={ordered[2]!} />
        </View>
      </View>
    );
  }
  const unordered = /^[-*]\s+(.*)$/.exec(line);
  if (unordered) {
    return (
      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
        <Text variant="bodyMd" color="muted">
          •
        </Text>
        <View style={{ flex: 1 }}>
          <InlineSpans text={unordered[1]!} />
        </View>
      </View>
    );
  }
  return <InlineSpans text={line} />;
}

// Animated bits (reduced-motion aware)

function Cursor({ reduceMotion }: { reduceMotion: boolean }) {
  const opacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (reduceMotion) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0, duration: 500, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 500, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity, reduceMotion]);
  return (
    <Animated.Text
      style={{
        opacity: reduceMotion ? 1 : opacity,
        color: colors.ink,
        fontFamily: fonts.regular,
        fontSize: typography.bodyMd.fontSize,
      }}
    >
      {' ▍'}
    </Animated.Text>
  );
}

function TypingDots({ reduceMotion }: { reduceMotion: boolean }) {
  const d0 = useRef(new Animated.Value(0.3)).current;
  const d1 = useRef(new Animated.Value(0.3)).current;
  const d2 = useRef(new Animated.Value(0.3)).current;
  const dots = useMemo(() => [d0, d1, d2], [d0, d1, d2]);
  useEffect(() => {
    if (reduceMotion) return;
    const loops = dots.map((d, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 150),
          Animated.timing(d, { toValue: 1, duration: 400, useNativeDriver: true }),
          Animated.timing(d, { toValue: 0.3, duration: 400, useNativeDriver: true }),
        ]),
      ),
    );
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
  }, [dots, reduceMotion]);
  return (
    <View style={{ flexDirection: 'row', gap: spacing.xs, alignItems: 'center', height: 20 }}>
      {dots.map((d, i) => (
        <Animated.View
          key={i}
          style={{
            width: 7,
            height: 7,
            borderRadius: radius.full,
            backgroundColor: colors.mutedSoft,
            opacity: reduceMotion ? 0.6 : d,
          }}
        />
      ))}
    </View>
  );
}

function PulseDot({ reduceMotion }: { reduceMotion: boolean }) {
  const opacity = useRef(new Animated.Value(0.4)).current;
  useEffect(() => {
    if (reduceMotion) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 600, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.4, duration: 600, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity, reduceMotion]);
  return (
    <Animated.View
      style={{
        width: 8,
        height: 8,
        borderRadius: radius.full,
        backgroundColor: colors.primary,
        opacity: reduceMotion ? 0.8 : opacity,
      }}
    />
  );
}

// Gate state

function GateState({
  gate,
  agentName,
  onProfile,
  onDismiss,
}: {
  gate: Gate;
  agentName: string;
  onProfile: () => void;
  onDismiss: () => void;
}) {
  if (gate.kind === 'identity') {
    return (
      <Screen centered>
        <EmptyState
          title={`Finish setting up ${agentName}.`}
          description={`Your Amber identity isn’t minted yet. Complete onboarding so ${agentName} can speak for your network.`}
          primaryLabel="Open profile"
          onPrimaryPress={onProfile}
          secondaryLabel="Not now"
          onSecondaryPress={onDismiss}
        />
      </Screen>
    );
  }
  return (
    <Screen centered>
      <EmptyState
        title={`Unlock ${agentName} chat.`}
        description={`${agentName} conversations are part of a plan you don’t have yet. Add it from your profile to start chatting.`}
        primaryLabel="See options"
        onPrimaryPress={onProfile}
        secondaryLabel="Not now"
        onSecondaryPress={onDismiss}
      />
    </Screen>
  );
}

// Helpers

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((v) => {
        if (mounted) setReduced(v);
      })
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', (v) => setReduced(v));
    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);
  return reduced;
}

function formatTime(ts: number): string {
  try {
    return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  } catch {
    return '';
  }
}

// Map a raw tool name to a live status line shown while it runs. An explicit
// label from the backend wins; otherwise we infer from the tool name and fall
// back to a neutral phrase so the chip is never empty.
function toolStatusLabel(tool: ActiveTool): string {
  if (tool.label && tool.label.trim().length > 0) return tool.label;
  const n = tool.name.toLowerCase();
  if (n.includes('calendar')) return 'Checking your calendar';
  if (n.includes('mail') || n.includes('gmail') || n.includes('email')) return 'Reading your email';
  if (n.includes('drive') || n.includes('doc')) return 'Searching your Drive';
  if (n.includes('contact') || n.includes('people') || n.includes('network') || n.includes('rank'))
    return 'Searching your network';
  if (n.includes('search') || n.includes('web')) return 'Searching the web';
  if (n.includes('memory') || n.includes('recall')) return 'Recalling context';
  return 'Working on it';
}

function toolChipLabel(name: string): string {
  const n = name.toLowerCase();
  if (n.includes('calendar')) return 'Calendar';
  if (n.includes('mail') || n.includes('gmail') || n.includes('email')) return 'Email';
  if (n.includes('drive') || n.includes('doc')) return 'Drive';
  if (n.includes('contact') || n.includes('people') || n.includes('network') || n.includes('rank'))
    return 'Network';
  if (n.includes('search') || n.includes('web')) return 'Web search';
  if (n.includes('memory') || n.includes('recall')) return 'Memory';
  // Title-case the raw name as a last resort.
  return name.charAt(0).toUpperCase() + name.slice(1);
}

// A dead/expired session: retrying with the same token loops forever, so the
// caller signs out and redirects rather than showing a retry bubble. The
// /quick-call/stream contract returns http_401 (or 'unauthorized'); 'no_session'
// is the local no-token case from askMedha/askTogari.
function isSessionExpired(code: string): boolean {
  return (
    code === 'http_401' ||
    code === 'unauthorized' ||
    code === 'no_session' ||
    code === 'invalid_privy_token' ||
    code === 'missing_privy_token' ||
    code === 'missing_bearer' ||
    code === 'amber_id_rejected_token'
  );
}

// Map an agent error code (or http_* status) to a full-screen gate, if any. The
// /quick-call/stream endpoint returns http_424 when the caller's Amber identity
// is not minted yet (alias of the older 'identity_not_minted').
function gateFor(code: string): Gate | null {
  if (
    code === 'identity_not_minted' ||
    code === 'caller_not_provisioned' ||
    code === 'http_403' ||
    code === 'http_424'
  )
    return { kind: 'identity' };
  if (code === 'entitlement_required' || code === 'http_402') return { kind: 'entitlement' };
  return null;
}

function errorCopy(code: string): string {
  if (code === 'togari_not_configured') return 'Togari is not available yet.';
  if (code === 'network_error') return 'Could not reach the agent. Check your connection.';
  if (code === 'empty_response') return 'No reply came back. Tap try again or rephrase.';
  if (code === 'stream_overflow') return 'That response came back malformed. Try again.';
  if (
    code === 'agent_failed' ||
    code === 'amber_id_unreachable' ||
    code === 'amber_id_error' ||
    code === 'amber_id_bad_json' ||
    code === 'too_many_concurrent_streams'
  )
    return 'The agent is having a moment. Try again shortly.';
  if (code.startsWith('http_')) return 'The agent is having a moment. Try again shortly.';
  return 'Something went wrong. Try again.';
}
