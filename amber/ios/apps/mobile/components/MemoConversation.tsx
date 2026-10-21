import { useState, type ReactNode } from 'react';
import { ActivityIndicator, Text, TextInput, View } from 'react-native';
import { ArrowUp, Users, CalendarDays } from 'lucide-react-native';
import { Pressable } from './Pressable';
import { MemoTranscript } from './MemoTranscript';
import { RichAnswer } from './RichAnswer';
import { tokenizeInline } from '../lib/answerMarkdown';
import { cl } from '../lib/classical';
import type { MemoEntry } from '../lib/memoActions';
import { canExploreMemo, type MemoQueryState } from '../lib/memoQuery';
import { type MemoFocus } from '../lib/memoDetail';
import { requestStyles as s } from './MemoStyles';

function Answer({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <View style={{ gap: 8 }}>
      {expanded ? (
        <RichAnswer text={text} />
      ) : (
        <Text selectable numberOfLines={5} style={s.body}>
          {tokenizeInline(text.replace(/^#{1,6}\s+/gm, '').replace(/^\s*[*-]\s+/gm, '• ')).map(
            (t, i) => (
              <Text
                key={i}
                style={
                  t.kind === 'bold'
                    ? { fontFamily: 'Outfit_600SemiBold' }
                    : t.kind === 'italic'
                      ? { fontStyle: 'italic' }
                      : undefined
                }
              >
                {t.kind === 'cite' ? `[${t.n}]` : t.text}
              </Text>
            ),
          )}
        </Text>
      )}
      {(text.length > 200 || text.split('\n').length > 4) && (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          onPress={() => setExpanded((v) => !v)}
          style={{ minHeight: 36, justifyContent: 'center' }}
        >
          <Text style={[s.hint, { color: cl.goldDeep }]}>
            {expanded ? 'Show less' : 'Read full response'}
          </Text>
        </Pressable>
      )}
    </View>
  );
}
export function MemoConversation({
  entry,
  state,
  running,
  contacts,
  onAsk,
  onContact,
  renderChoice,
  onSaveTranscript,
}: {
  entry: MemoEntry;
  state?: MemoQueryState;
  running: boolean;
  contacts: { id: string; name: string; detail?: string }[];
  onAsk: (entry: MemoEntry, question?: string) => Promise<void>;
  onAddMemo?: (context: import('../lib/memoContext').MemoContext) => void;
  onContact: (id: string) => void;
  renderChoice?: (focus: MemoFocus) => ReactNode;
  onSaveTranscript?: (text: string) => Promise<void>;
}) {
  const [question, setQuestion] = useState('');
  const [focus, setFocus] = useState<MemoFocus | null>(null);
  const objects = state?.sorting?.text === entry.text ? state.sorting.objects : undefined;
  const ready = canExploreMemo(entry);
  const turns = state?.turns ?? [];
  const receipts = entry.reviews ?? (entry.review ? [entry.review] : []);
  const send = () => {
    if (!running && ready && question.trim()) {
      void onAsk(entry, question);
      setQuestion('');
    }
  };
  const choose = (next: MemoFocus) =>
    setFocus((old) => (old?.kind === next.kind && old.index === next.index ? null : next));
  return (
    <View style={{ gap: 20 }}>
      <View style={{ gap: 8 }}>
        <Text style={s.label}>PEOPLE & PLANS</Text>
        {objects?.people.map((person, index) => {
          const receipt = [...receipts]
            .reverse()
            .find(
              (r) =>
                r.kind === 'contact' &&
                r.personName?.toLocaleLowerCase() === person.name.toLocaleLowerCase(),
            );
          const id = receipt?.contactId || person.contactId;
          const contact = contacts.find((c) => c.id === id);
          const selected = focus?.kind === 'contact' && focus.index === index;
          return (
            <View key={`person-${index}`} style={{ gap: 8 }}>
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 10,
                  paddingVertical: 10,
                  borderBottomWidth: 1,
                  borderBottomColor: cl.cardHairline,
                }}
              >
                <Users size={18} color={cl.goldDeep} />
                <Pressable
                  accessibilityRole="button"
                  disabled={!id}
                  onPress={() => onContact(id)}
                  style={{ flex: 1, gap: 3 }}
                >
                  <Text style={s.body}>{contact?.name || person.name}</Text>
                  <Text style={s.hint}>
                    {receipt
                      ? 'Saved to person'
                      : id
                        ? 'Suggested match · review to save'
                        : 'Choose a person'}
                  </Text>
                </Pressable>
                {!!renderChoice && (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Choose person for ${person.name}`}
                    accessibilityState={{ expanded: selected }}
                    onPress={() => choose({ kind: 'contact', label: person.name, index })}
                    style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: 8 }}
                  >
                    <Text style={{ ...s.body, color: cl.goldDeep }}>
                      {selected ? 'Close' : receipt ? 'View' : id ? 'Review' : 'Choose'}
                    </Text>
                  </Pressable>
                )}
              </View>
              {selected && renderChoice?.(focus!)}
            </View>
          );
        })}
        {objects?.plans.map((plan, index) => {
          const selected = focus?.kind === 'calendar' && focus.index === index;
          const saved = receipts.find((r) => r.kind === 'calendar' && r.title === plan.title);
          return (
            <View key={`plan-${index}`} style={{ gap: 8 }}>
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 10,
                  paddingVertical: 10,
                  borderBottomWidth: 1,
                  borderBottomColor: cl.cardHairline,
                }}
              >
                <CalendarDays size={18} color={cl.goldDeep} />
                <View style={{ flex: 1, gap: 3 }}>
                  <Text style={s.body}>{plan.title}</Text>
                  <Text style={s.hint}>
                    {saved ? 'Saved to plan' : 'Choose an existing plan or create one'}
                  </Text>
                </View>
                {!!renderChoice && (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Choose plan for ${plan.title}`}
                    accessibilityState={{ expanded: selected }}
                    onPress={() => choose({ kind: 'calendar', label: plan.title, index })}
                    style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: 8 }}
                  >
                    <Text style={{ ...s.body, color: cl.goldDeep }}>
                      {selected ? 'Close' : saved ? 'View' : 'Choose'}
                    </Text>
                  </Pressable>
                )}
              </View>
              {selected && renderChoice?.(focus!)}
            </View>
          );
        })}
        {running && !objects && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <ActivityIndicator color={cl.goldDeep} />
            <Text style={s.hint}>Identifying people and plans…</Text>
          </View>
        )}
        {!running && !objects && (
          <Text style={s.hint}>People and plans have not been identified yet.</Text>
        )}
        {objects && !objects.people.length && !objects.plans.length && (
          <Text style={s.hint}>No people or plans identified in this memo.</Text>
        )}
        {!ready && <Text style={s.hint}>Save the transcript to identify people and plans.</Text>}
        {!!state?.sortingError && (
          <Text accessibilityRole="alert" style={s.hint}>
            {state.sortingError}
          </Text>
        )}
        {ready && !running && (!objects || state?.sortingError) && (
          <Pressable
            accessibilityRole="button"
            onPress={() => void onAsk(entry)}
            style={{ minHeight: 44, justifyContent: 'center' }}
          >
            <Text style={{ ...s.body, color: cl.goldDeep }}>Identify people & plans</Text>
          </Pressable>
        )}
      </View>
      <MemoTranscript entry={entry} onSave={onSaveTranscript} />
      <View style={{ gap: 10 }}>
        <Text style={s.label}>AI SUMMARY</Text>
        {turns[0]?.answer || (running && !turns.length && state?.draft) ? (
          <Answer text={turns[0]?.answer || state?.draft || ''} />
        ) : (
          <Text style={s.hint}>
            {running ? 'Preparing a summary…' : 'A summary will appear after processing.'}
          </Text>
        )}
      </View>
      <View style={{ gap: 14 }}>
        <Text style={s.label}>CHAT WITH THIS NOTE</Text>
        {turns.slice(1).map((turn, i) => (
          <View key={i} style={{ gap: 8 }}>
            <Text style={{ ...s.body, fontFamily: 'Outfit_500Medium' }}>{turn.question}</Text>
            <Answer text={turn.answer} />
            {!turn.saved && (
              <Text style={s.hint}>Reply available here; cloud save not confirmed.</Text>
            )}
          </View>
        ))}
        {running && !!turns.length && !!state?.draft && <Answer text={state.draft} />}
        {!!state?.error && (
          <Text accessibilityRole="alert" style={s.hint}>
            {state.error}
          </Text>
        )}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <TextInput
            accessibilityLabel="Continue this memo conversation"
            placeholder="Ask about this note…"
            placeholderTextColor={cl.ink38}
            value={question}
            onChangeText={setQuestion}
            maxLength={1000}
            multiline
            style={[
              s.body,
              {
                flex: 1,
                borderWidth: 1,
                borderColor: cl.cardHairline,
                borderRadius: 20,
                padding: 14,
                maxHeight: 120,
              },
            ]}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Send memo question"
            disabled={running || !ready || !question.trim()}
            onPress={send}
            style={{ padding: 12, opacity: running || !ready || !question.trim() ? 0.4 : 1 }}
          >
            <ArrowUp color={cl.goldDeep} />
          </Pressable>
        </View>
      </View>
    </View>
  );
}
