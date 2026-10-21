import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { ArrowUp, CalendarDays } from 'lucide-react-native';
import { generateBrief, type BriefAnswer, type BriefRecord } from '../lib/networkBrief';
import { requestStyles as s } from './MemoStyles';
import { cl } from '../lib/classical';
type Message = { question: string; answer?: BriefAnswer; error?: string };
export function GroundedConversation({
  query,
  records,
  sample = false,
  scope,
  onChoose,
}: {
  query: string;
  records: BriefRecord[];
  sample?: boolean;
  scope: 'network' | 'day';
  onChoose?: (id: string) => void;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const controller = useRef<AbortController | null>(null);
  async function ask(question: string) {
    if (!question.trim() || controller.current) return;
    const request = new AbortController();
    controller.current = request;
    setBusy(true);
    setDraft('');
    const history = messages.map((m) => `${m.question}: ${m.answer?.summary ?? ''}`).join('\n');
    setMessages((old) => [...old, { question }]);
    try {
      const answer = sample
        ? {
            summary:
              'Preview of your answer and cards. Sign in to ask AI about your own network and calendar.',
            ids: records.slice(0, 3).map((r) => r.id),
            followUps:
              scope === 'day'
                ? ['Who am I seeing today?', 'What should I prepare?']
                : ['Who should I reconnect with?', 'What do we have in common?'],
          }
        : await generateBrief(question, records, request.signal, history);
      if (!request.signal.aborted)
        setMessages((old) => old.map((m, i) => (i === old.length - 1 ? { ...m, answer } : m)));
    } catch {
      if (!request.signal.aborted)
        setMessages((old) =>
          old.map((m, i) =>
            i === old.length - 1
              ? { ...m, error: 'Amber could not finish this answer. Try again.' }
              : m,
          ),
        );
    } finally {
      if (controller.current === request) {
        controller.current = null;
        setBusy(false);
      }
    }
  }
  useEffect(() => {
    setMessages([]);
    void ask(query);
    return () => {
      controller.current?.abort();
      controller.current = null;
    };
    // The parent remounts this conversation for each new search.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <View style={{ flex: 1 }}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={s.content}>
        {messages.map((message, i) => (
          <View key={i} style={{ gap: 14 }}>
            <Text
              style={[
                s.body,
                {
                  alignSelf: 'flex-end',
                  backgroundColor: cl.groundGold,
                  padding: 14,
                  borderRadius: 18,
                },
              ]}
            >
              {message.question}
            </Text>
            {message.answer && (
              <>
                <Text style={[s.body, { fontSize: 18, lineHeight: 27 }]}>
                  {message.answer.summary}
                </Text>
                {message.answer.ids.map((id) => {
                  const record = records.find((r) => r.id === id);
                  return record ? (
                    <Pressable
                      key={id}
                      disabled={!onChoose}
                      accessibilityRole={onChoose ? 'button' : 'text'}
                      onPress={() => onChoose?.(id)}
                      style={s.notice}
                    >
                      {scope === 'day' && <CalendarDays color={cl.goldDeep} size={22} />}
                      <View style={{ flex: 1, gap: 6 }}>
                        <Text style={s.body}>{record.name}</Text>
                        <Text style={s.hint}>{record.detail}</Text>
                      </View>
                    </Pressable>
                  ) : null;
                })}
                {!busy &&
                  message.answer.followUps.map((q) => (
                    <Pressable
                      key={q}
                      accessibilityRole="button"
                      onPress={() => void ask(q)}
                      style={[s.row, { minHeight: 44 }]}
                    >
                      <Text style={[s.body, { color: cl.goldDeep }]}>{q}</Text>
                    </Pressable>
                  ))}
              </>
            )}
            {message.error && (
              <>
                <Text accessibilityRole="alert" style={s.body}>
                  {message.error}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => void ask(message.question)}
                  style={s.row}
                >
                  <Text style={s.body}>Try again</Text>
                </Pressable>
              </>
            )}
          </View>
        ))}
        {busy && <ActivityIndicator accessibilityLabel="Amber is thinking" color={cl.goldDeep} />}
      </ScrollView>
      <View style={{ flexDirection: 'row', alignItems: 'center', padding: 16, gap: 8 }}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          onSubmitEditing={() => void ask(draft)}
          placeholder="Ask a follow-up…"
          accessibilityLabel="Ask Amber a follow-up"
          style={[
            s.body,
            {
              flex: 1,
              minHeight: 48,
              padding: 12,
              borderWidth: 1,
              borderColor: cl.cardHairline,
              borderRadius: 24,
            },
          ]}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Send follow-up"
          disabled={busy || !draft.trim()}
          onPress={() => void ask(draft)}
          style={{ padding: 12, opacity: busy || !draft.trim() ? 0.4 : 1 }}
        >
          <ArrowUp color={cl.goldDeep} />
        </Pressable>
      </View>
    </View>
  );
}
