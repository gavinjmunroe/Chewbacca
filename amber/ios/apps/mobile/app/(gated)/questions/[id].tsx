import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowUp, Check, X } from 'lucide-react-native';
import { Text } from '../../../components/Text';
import { GlassCard } from '../../../components/GlassCard';
import { errorCopy, medhaIdErrorCopy, unwrapOrThrow } from '../../../lib/medhaId';
import { toast } from '../../../lib/toast';
import {
  getThread,
  sendThreadMessage,
  submitAnswer,
  suggestAnswer,
  type AnswerType,
  type AnswerVisibility,
  type QuestionThread,
  type ThreadMessage,
} from '../../../lib/questions';
import { radius, spacing, typography } from '../../../lib/tokens';
import { LIGHT } from '../../../lib/theme';
import { HAIRLINE, cl } from '../../../lib/classical';

type ThreadData = { thread: QuestionThread; messages: ThreadMessage[] };

// The prefill payload from suggestAnswer that the answer sheet renders against.
type Suggestion = {
  suggestedAnswer: string | null;
  suggestedChoice: string | null;
  answerType: AnswerType;
  options: string[] | null;
};

export default function QuestionThreadScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();
  const threadId = typeof id === 'string' ? id : '';

  const queryKey = ['questions', 'thread', threadId] as const;

  const threadQuery = useQuery({
    queryKey,
    queryFn: async () => unwrapOrThrow(await getThread(threadId)),
    enabled: threadId.length > 0,
  });

  const messages = threadQuery.data?.messages ?? [];
  // The first Amber message is the original question; pin it up top as Amber's
  // ask and render the rest of the conversation below so it isn't duplicated.
  const questionPrompt = messages[0]?.role === 'amber' ? messages[0].content : null;
  const conversation = questionPrompt ? messages.slice(1) : messages;

  const [draft, setDraft] = useState('');
  const scrollRef = useRef<ScrollView>(null);
  const scrollToEnd = () => {
    requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
  };

  const sendMutation = useMutation({
    mutationFn: (content: string) => sendThreadMessage(threadId, content),
    onSuccess: (res) => {
      if (!res.ok) {
        toast.error('Could not send message.', medhaIdErrorCopy(res, 'Amber'));
        return;
      }
      qc.setQueryData<ThreadData>(queryKey, (prev) => {
        if (!prev) return prev;
        const appended = [res.data.userMessage];
        if (res.data.amberMessage) appended.push(res.data.amberMessage);
        return { ...prev, messages: [...prev.messages, ...appended] };
      });
    },
    onError: (e) => toast.error('Could not send message.', errorCopy(e)),
  });

  // Auto-scroll to the newest message whenever the conversation grows or the
  // typing indicator toggles.
  useEffect(() => {
    scrollToEnd();
  }, [conversation.length, sendMutation.isPending]);

  const canSend = draft.trim().length > 0 && !sendMutation.isPending;
  const onSend = () => {
    if (!canSend) return;
    const content = draft.trim();
    setDraft('');
    sendMutation.mutate(content);
  };

  // Answering is optional and user-initiated: tapping "Save answer" asks the
  // backend for a suggested prefill, then opens the sheet. suggestAnswer is
  // also the only source of answerType/options here (getThread doesn't carry
  // them), so if it fails we surface an error rather than open a blank sheet.
  const [answerSheetOpen, setAnswerSheetOpen] = useState(false);
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);

  const suggestMutation = useMutation({
    mutationFn: () => suggestAnswer(threadId),
    onSuccess: (res) => {
      if (!res.ok) {
        toast.error('Could not prepare your answer.', medhaIdErrorCopy(res, 'Amber'));
        return;
      }
      setSuggestion({
        suggestedAnswer: res.data.suggestedAnswer,
        suggestedChoice: res.data.suggestedChoice,
        answerType: res.data.answerType,
        options: res.data.options,
      });
      setAnswerSheetOpen(true);
    },
    onError: (e) => toast.error('Could not prepare your answer.', errorCopy(e)),
  });

  return (
    <View style={{ flex: 1, backgroundColor: LIGHT.canvas }}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: spacing.md,
            paddingHorizontal: spacing.lg,
            paddingTop: insets.top + spacing.base,
            paddingBottom: spacing.md,
          }}
        >
          <Pressable
            onPress={() => router.back()}
            accessibilityRole="button"
            accessibilityLabel="Back"
            hitSlop={10}
          >
            <View
              style={{
                width: 40,
                height: 40,
                borderRadius: radius.full,
                backgroundColor: LIGHT.surface,
                borderWidth: 1,
                borderColor: LIGHT.hairline,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <ArrowLeft color={LIGHT.textPrimary} size={20} />
            </View>
          </Pressable>
          <Text variant="titleMd" style={{ flex: 1, color: LIGHT.textPrimary }}>
            Amber
          </Text>
          <Pressable
            onPress={() => suggestMutation.mutate()}
            disabled={threadQuery.isLoading || suggestMutation.isPending}
            accessibilityRole="button"
            accessibilityLabel="Save answer"
            hitSlop={8}
          >
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: spacing.xs,
                height: 36,
                paddingHorizontal: spacing.base,
                borderRadius: radius.full,
                backgroundColor: LIGHT.surface,
                borderWidth: 1,
                borderColor: LIGHT.hairline,
                opacity: threadQuery.isLoading || suggestMutation.isPending ? 0.5 : 1,
              }}
            >
              {suggestMutation.isPending ? (
                <ActivityIndicator size="small" color={LIGHT.accent} />
              ) : (
                <Check size={16} color={LIGHT.accent} />
              )}
              <Text variant="buttonSm" style={{ color: LIGHT.accentText }}>
                Save answer
              </Text>
            </View>
          </Pressable>
        </View>

        {threadQuery.isLoading ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <ActivityIndicator color={LIGHT.textMuted} />
          </View>
        ) : threadQuery.isError ? (
          <View
            style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xl }}
          >
            <Text variant="bodyMd" centered style={{ color: LIGHT.textSecondary }}>
              Couldn&rsquo;t load this question.
            </Text>
          </View>
        ) : (
          <ScrollView
            ref={scrollRef}
            style={{ flex: 1 }}
            contentContainerStyle={{
              paddingHorizontal: spacing.lg,
              paddingBottom: spacing.lg,
              gap: spacing.sm,
            }}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            onContentSizeChange={scrollToEnd}
          >
            {questionPrompt ? (
              <View style={{ marginBottom: spacing.sm }}>
                <GlassCard>
                  <View style={{ gap: spacing.xs }}>
                    <Text variant="microLabel" uppercase>
                      Amber asks
                    </Text>
                    <Text variant="bodyMd" style={{ color: LIGHT.textPrimary }}>
                      {questionPrompt}
                    </Text>
                  </View>
                </GlassCard>
              </View>
            ) : null}

            {conversation.map((msg) => (
              <MessageBubble key={msg.id} message={msg} />
            ))}

            {sendMutation.isPending ? <TypingIndicator /> : null}
          </ScrollView>
        )}

        <View
          style={{
            flexDirection: 'row',
            alignItems: 'flex-end',
            gap: spacing.sm,
            paddingHorizontal: spacing.lg,
            paddingTop: spacing.sm,
            paddingBottom: insets.bottom + spacing.sm,
            borderTopWidth: 1,
            borderTopColor: LIGHT.hairline,
          }}
        >
          <View
            style={{
              flex: 1,
              backgroundColor: LIGHT.surface,
              borderRadius: radius.lg,
              borderWidth: 1,
              borderColor: LIGHT.hairline,
              paddingHorizontal: spacing.base,
              paddingVertical: spacing.sm,
            }}
          >
            <TextInput
              value={draft}
              onChangeText={setDraft}
              placeholder="Message Amber"
              placeholderTextColor={LIGHT.textMuted}
              multiline
              style={{
                color: LIGHT.textPrimary,
                fontFamily: typography.bodyMd.fontFamily,
                fontSize: typography.bodyMd.fontSize,
                maxHeight: 120,
                padding: 0,
              }}
            />
          </View>
          <Pressable
            onPress={onSend}
            disabled={!canSend}
            accessibilityRole="button"
            accessibilityLabel="Send"
            hitSlop={6}
          >
            <View
              style={{
                width: 40,
                height: 40,
                borderRadius: radius.full,
                backgroundColor: cl.tint100,
                borderWidth: HAIRLINE,
                borderColor: cl.gold55,
                alignItems: 'center',
                justifyContent: 'center',
                opacity: canSend ? 1 : 0.4,
              }}
            >
              <ArrowUp color={cl.goldDeep} size={20} />
            </View>
          </Pressable>
        </View>
      </KeyboardAvoidingView>

      <AnswerSheet
        visible={answerSheetOpen}
        threadId={threadId}
        prompt={questionPrompt}
        suggestion={suggestion}
        onClose={() => setAnswerSheetOpen(false)}
      />
    </View>
  );
}

function MessageBubble({ message }: { message: ThreadMessage }) {
  const isUser = message.role === 'user';
  return (
    <View style={{ alignItems: isUser ? 'flex-end' : 'flex-start' }}>
      <View
        style={{
          maxWidth: '82%',
          backgroundColor: isUser ? LIGHT.accent : LIGHT.surface,
          borderWidth: isUser ? 0 : 1,
          borderColor: LIGHT.hairline,
          borderRadius: 20,
          borderBottomRightRadius: isUser ? 6 : 20,
          borderBottomLeftRadius: isUser ? 20 : 6,
          paddingHorizontal: spacing.base,
          paddingVertical: 10,
        }}
      >
        <Text
          variant="bodyMd"
          style={{ color: isUser ? '#FFFFFF' : LIGHT.textPrimary, letterSpacing: -0.2 }}
        >
          {message.content}
        </Text>
      </View>
    </View>
  );
}

function TypingIndicator() {
  return (
    <View style={{ alignItems: 'flex-start' }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.sm,
          backgroundColor: LIGHT.surface,
          borderWidth: 1,
          borderColor: LIGHT.hairline,
          borderRadius: 20,
          borderBottomLeftRadius: 6,
          paddingHorizontal: spacing.base,
          paddingVertical: 10,
        }}
      >
        <ActivityIndicator size="small" color={LIGHT.textMuted} />
        <Text variant="captionSm" style={{ color: LIGHT.textSecondary }}>
          Amber is typing…
        </Text>
      </View>
    </View>
  );
}

const VISIBILITY_OPTIONS: {
  value: AnswerVisibility;
  label: string;
  helper: string;
}[] = [
  { value: 'private', label: 'Private (only you)', helper: 'Only you can see this' },
  {
    value: 'network',
    label: 'Share with your connections',
    helper: "This appears in your connections' feed",
  },
];

// Bottom sheet for capturing an answer, mirroring EditProfileSheet's modal
// style. Reset + prefill happens on open from the suggestion payload.
function AnswerSheet({
  visible,
  threadId,
  prompt,
  suggestion,
  onClose,
}: {
  visible: boolean;
  threadId: string;
  prompt: string | null;
  suggestion: Suggestion | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const insets = useSafeAreaInsets();

  const [answerText, setAnswerText] = useState('');
  const [selectedChoice, setSelectedChoice] = useState<string | null>(null);
  const [visibility, setVisibility] = useState<AnswerVisibility>('private');

  // Prefill from the suggestion each time the sheet opens (default visibility
  // is always Private). Mirrors EditProfileSheet's visible-gated reset.
  useEffect(() => {
    if (visible && suggestion) {
      setAnswerText(suggestion.suggestedAnswer ?? '');
      setSelectedChoice(suggestion.suggestedChoice ?? null);
      setVisibility('private');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const submitMutation = useMutation({
    mutationFn: () => {
      if (!suggestion) throw new Error('missing_suggestion');
      return submitAnswer(threadId, {
        answerType: suggestion.answerType,
        answerText: suggestion.answerType === 'text' ? answerText.trim() : undefined,
        answerChoice:
          suggestion.answerType === 'multiple_choice' ? selectedChoice ?? undefined : undefined,
        visibility,
      });
    },
    onSuccess: (res) => {
      if (!res.ok) {
        toast.error('Could not save your answer.', medhaIdErrorCopy(res, 'Amber'));
        return;
      }
      toast.success(
        visibility === 'network' ? 'Shared with your connections' : 'Answer saved',
      );
      // The question leaves "Questions for you", the thread refreshes, and a
      // shared answer can surface in the network feed.
      qc.invalidateQueries({ queryKey: ['questions', 'inbox'] });
      qc.invalidateQueries({ queryKey: ['questions', 'thread', threadId] });
      qc.invalidateQueries({ queryKey: ['connect', 'feed'] });
      onClose();
    },
    onError: (e) => toast.error('Could not save your answer.', errorCopy(e)),
  });

  const isChoice = suggestion?.answerType === 'multiple_choice';
  const canSubmit =
    !submitMutation.isPending &&
    (isChoice ? selectedChoice !== null : answerText.trim().length > 0);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Pressable
          onPress={onClose}
          accessibilityLabel="Close"
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)' }}
        />
        <View
          style={{
            backgroundColor: LIGHT.canvas,
            borderTopLeftRadius: radius.xl,
            borderTopRightRadius: radius.xl,
            borderTopWidth: 1,
            borderColor: LIGHT.hairline,
            flexDirection: 'column',
            maxHeight: '88%',
          }}
        >
          <View style={{ alignItems: 'center', paddingTop: spacing.sm }}>
            <View
              style={{ width: 36, height: 4, borderRadius: radius.full, backgroundColor: LIGHT.hairline }}
            />
          </View>
          <ScrollView
            style={{ flexGrow: 1, flexShrink: 1 }}
            contentContainerStyle={{ padding: spacing.lg, gap: spacing.base }}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <View
              style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.md }}
            >
              <View style={{ flex: 1, gap: spacing.xs }}>
                <Text variant="displaySm" style={{ color: LIGHT.textPrimary, letterSpacing: -0.3 }}>
                  Your answer
                </Text>
                {prompt ? (
                  <Text variant="captionSm" style={{ color: LIGHT.textMuted }}>
                    {prompt}
                  </Text>
                ) : null}
              </View>
              <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" hitSlop={10}>
                <View
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: radius.full,
                    backgroundColor: LIGHT.surface,
                    borderWidth: 1,
                    borderColor: LIGHT.hairline,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <X size={18} color={LIGHT.textSecondary} />
                </View>
              </Pressable>
            </View>

            {isChoice ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
                {(suggestion?.options ?? []).map((option) => {
                  const selected = option === selectedChoice;
                  return (
                    <Pressable
                      key={option}
                      onPress={() => setSelectedChoice(option)}
                      accessibilityRole="button"
                      accessibilityLabel={option}
                      accessibilityState={{ selected }}
                    >
                      <View
                        style={{
                          paddingHorizontal: spacing.base,
                          paddingVertical: spacing.sm,
                          borderRadius: radius.full,
                          borderWidth: 1,
                          borderColor: selected ? LIGHT.accent : LIGHT.hairlineStrong,
                          backgroundColor: selected ? LIGHT.accent : LIGHT.surface,
                        }}
                      >
                        <Text
                          variant="bodySm"
                          style={{ color: selected ? '#FFFFFF' : LIGHT.textPrimary }}
                        >
                          {option}
                        </Text>
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            ) : (
              <View
                style={{
                  borderRadius: radius.md,
                  borderWidth: 1,
                  borderColor: LIGHT.hairlineStrong,
                  backgroundColor: LIGHT.surface,
                  paddingHorizontal: spacing.base,
                  paddingVertical: spacing.sm,
                  minHeight: 100,
                }}
              >
                <TextInput
                  value={answerText}
                  onChangeText={setAnswerText}
                  placeholder="Type your answer"
                  placeholderTextColor={LIGHT.textMuted}
                  multiline
                  style={{
                    color: LIGHT.textPrimary,
                    fontFamily: typography.bodyMd.fontFamily,
                    fontSize: typography.bodyMd.fontSize,
                    padding: 0,
                    textAlignVertical: 'top',
                  }}
                />
              </View>
            )}

            <View style={{ gap: spacing.sm }}>
              <Text variant="microLabel" uppercase>
                Visibility
              </Text>
              {VISIBILITY_OPTIONS.map((opt) => {
                const selected = visibility === opt.value;
                return (
                  <Pressable
                    key={opt.value}
                    onPress={() => setVisibility(opt.value)}
                    accessibilityRole="button"
                    accessibilityLabel={opt.label}
                    accessibilityState={{ selected }}
                  >
                    <View
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: spacing.md,
                        padding: spacing.base,
                        borderRadius: radius.md,
                        borderWidth: 1,
                        borderColor: selected ? LIGHT.accent : LIGHT.hairline,
                        backgroundColor: selected ? LIGHT.chipBg : LIGHT.surface,
                      }}
                    >
                      <View
                        style={{
                          width: 22,
                          height: 22,
                          borderRadius: radius.full,
                          borderWidth: selected ? 0 : 1.5,
                          borderColor: LIGHT.hairlineStrong,
                          backgroundColor: selected ? LIGHT.accent : 'transparent',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        {selected ? <Check size={13} color="#FFFFFF" /> : null}
                      </View>
                      <View style={{ flex: 1, gap: 2 }}>
                        <Text variant="titleSm" style={{ color: LIGHT.textPrimary }}>
                          {opt.label}
                        </Text>
                        <Text variant="captionSm" style={{ color: LIGHT.textSecondary }}>
                          {opt.helper}
                        </Text>
                      </View>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          </ScrollView>

          <View
            style={{
              flexShrink: 0,
              paddingHorizontal: spacing.lg,
              paddingTop: spacing.md,
              paddingBottom: insets.bottom + spacing.md,
              borderTopWidth: 1,
              borderColor: LIGHT.hairline,
              backgroundColor: LIGHT.surface,
            }}
          >
            <Pressable
              onPress={() => submitMutation.mutate()}
              disabled={!canSubmit}
              accessibilityRole="button"
              accessibilityLabel="Submit answer"
            >
              <View
                style={{
                  height: 44,
                  borderRadius: radius.full,
                  backgroundColor: cl.tint100,
                  borderWidth: HAIRLINE,
                  borderColor: cl.gold55,
                  alignItems: 'center',
                  justifyContent: 'center',
                  opacity: canSubmit ? 1 : 0.4,
                }}
              >
                {submitMutation.isPending ? (
                  <ActivityIndicator color={cl.goldDeep} size="small" />
                ) : (
                  <Text variant="buttonMd" style={{ color: cl.goldDeep }}>
                    Submit
                  </Text>
                )}
              </View>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
