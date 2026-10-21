import type { DiscoveryPerson } from './WebDiscoverySheet';
import { DailyFocus } from './DailyFocus';
import { useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { digestStringAsync, CryptoDigestAlgorithm } from 'expo-crypto';
import { loadSession } from '../lib/secureStorage';
import { filterBy } from '../lib/peopleSearch';
import { cl } from '../lib/classical';

type Answer = { value: number; label: string; theme: string; date: string };
type Prompt = { id: string; title: string; theme: string; reason: string; options: string[] };
const THEMES = [
  {
    name: 'Curiosity',
    question: 'How much novelty would feel good today?',
    options: ['Keep it familiar', 'A little discovery', 'Try something new'],
  },
  {
    name: 'Social energy',
    question: 'What kind of connection fits your energy?',
    options: ['Quiet time', 'One close friend', 'A lively group'],
  },
  {
    name: 'Structure',
    question: 'How would you like to approach today?',
    options: ['Leave room to wander', 'A loose plan', 'A clear checklist'],
  },
  {
    name: 'Cooperation',
    question: 'What would help a relationship today?',
    options: ['Listen with care', 'Offer practical help', 'Say what I need'],
  },
  {
    name: 'Balance',
    question: 'What pace would serve you best?',
    options: ['Slow and spacious', 'Steady momentum', 'A focused challenge'],
  },
];
const TOPICS = [
  'friendship',
  'learning',
  'work',
  'creativity',
  'community',
  'technology',
  'time outdoors',
  'family',
  'culture',
  'attention',
  'conversation',
  'local life',
];
const ANGLES = [
  'What deserves more attention',
  'What would you like to understand',
  'Where could you make a little room',
  'What conversation are you avoiding',
  'What surprised you recently',
  'What would you like to try',
  'What might someone else see differently',
  'What is worth revisiting',
];
function dateKey(day: Date) {
  return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
}
export function DailyReflectionFeed({
  day,
  events,
  query = '',
  activity = '',
  intent = '',
  onAddSample,
  onIntentChange,
  sample = false,
}: {
  day: Date;
  events: { id: string; name: string; detail: string }[];
  query?: string;
  activity?: string;
  intent?: string;
  onAddSample?: (person: DiscoveryPerson) => void;
  onIntentChange?: (value: string) => Promise<void>;
  sample?: boolean;
}) {
  const date = dateKey(day);
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const [page, setPage] = useState(1);
  const [storageKey, setStorageKey] = useState('');
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const latest = useRef(answers);
  const writes = useRef(Promise.resolve());
  useEffect(() => {
    let active = true;
    setReady(false);
    void (async () => {
      const session = sample ? null : await loadSession();
      if (!sample && !session) throw new Error('Sign in to save your daily answers.');
      const owner = sample
        ? 'design-preview'
        : await digestStringAsync(CryptoDigestAlgorithm.SHA256, session!.phone);
      const key = `amber_daily_reflections_v1:${owner}`;
      const raw = await AsyncStorage.getItem(key);
      let data: Record<string, Answer> = {};
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
          data = Object.fromEntries(
            Object.entries(parsed).filter(
              ([, a]) =>
                !!a &&
                typeof a === 'object' &&
                typeof (a as Answer).label === 'string' &&
                typeof (a as Answer).date === 'string' &&
                typeof (a as Answer).theme === 'string' &&
                Number.isInteger((a as Answer).value) &&
                (a as Answer).value >= 0 &&
                (a as Answer).value <= 2,
            ),
          ) as Record<string, Answer>;
      }
      if (active) {
        latest.current = data;
        setAnswers(data);
        setStorageKey(key);
        setReady(true);
      }
    })().catch(() => {
      if (active) setError('Could not load saved answers. Reopen this tab to retry.');
    });
    return () => {
      active = false;
    };
  }, [sample]);
  useEffect(() => {
    setPage(1);
  }, [date, query]);
  const todayAnswers = Object.values(answers).filter((a) => a.date === date);
  const prompts = useMemo(() => {
    const daily: Prompt[] = THEMES.map((theme, index) => ({
      id: `${date}:daily:${index}`,
      title: theme.question,
      theme: theme.name,
      reason: 'Daily check-in · inspired by personality research',
      options: theme.options,
    }));
    const calendar: Prompt[] = events.map((event) => ({
      id: `${date}:event:${event.id}`,
      title: `Before ${event.name}, what would make it meaningful?`,
      theme: 'Your calendar',
      reason: event.detail,
      options: ['Be fully present', 'Learn something', 'Make a connection'],
    }));
    const social = answers[`${date}:daily:1`]?.value;
    const ongoing: Prompt[] = Array.from({ length: page * 8 }, (_, index) => {
      const topic = TOPICS[(index + day.getDay()) % TOPICS.length];
      const angle = ANGLES[Math.floor(index / TOPICS.length) % ANGLES.length];
      return {
        id: `${date}:topic:${index}`,
        title: `${angle} in ${topic}?`,
        theme: topic,
        reason:
          social === 0
            ? 'A quiet reflection for your day'
            : social === 2
              ? 'A conversation to bring to your next gathering'
              : activity
                ? `A reflection alongside your status: ${activity}`
                : 'A question for today · no right answer',
        options: ['Think about it', 'Talk with someone', 'Try a small action'],
      };
    });
    return filterBy([...daily, ...calendar, ...ongoing], query, (p) => [
      p.title,
      p.theme,
      p.reason,
    ]) as Prompt[];
  }, [date, day, events, page, query, activity, answers]);
  const answer = (prompt: Prompt, value: number) => {
    if (!ready) return;
    const entry = { value, label: prompt.options[value], theme: prompt.theme, date };
    const next = { ...latest.current, [prompt.id]: entry };
    latest.current = next;
    setAnswers(next);
    setError('');
    // Serialize writes so a slower old write cannot replace a newer answer.
    writes.current = writes.current
      .catch(() => {})
      .then(() => AsyncStorage.setItem(storageKey, JSON.stringify(next)))
      .catch(() =>
        setError('Your answer is visible, but could not be saved on this device. Tap it to retry.'),
      );
  };
  return (
    <FlatList
      data={prompts}
      keyExtractor={(item) => item.id}
      extraData={answers}
      contentContainerStyle={s.list}
      keyboardShouldPersistTaps="handled"
      onEndReached={() => {
        if (!query.trim()) setPage((p) => Math.min(12, p + 1));
      }}
      onEndReachedThreshold={0.5}
      ListHeaderComponent={
        <View style={s.intro}>
          <DailyFocus
            onAddSample={onAddSample}
            intent={intent}
            onSave={onIntentChange}
            sample={sample}
            calendarContext={`${day.toLocaleDateString()}: ${events.map((e) => `${e.name} (${e.detail})`).join('; ')}`}
          />
          <Text style={s.eyebrow}>YOUR DAILY PERSPECTIVE</Text>
          <Text style={s.title}>A little more aware.</Text>
          <Text style={s.body}>
            Your day, your people, and a few good questions. Your answers shape the prompts you see.
          </Text>
          <View style={s.chart}>
            <Text style={s.small}>{todayAnswers.length} answers today · saved on this device</Text>
            {THEMES.map((theme, i) => {
              const a = answers[`${date}:daily:${i}`];
              return (
                <View key={theme.name} style={s.chartRow}>
                  <Text style={s.chartLabel}>{theme.name}</Text>
                  <View style={s.track}>
                    {a && <View style={[s.fill, { width: `${((a.value + 1) / 3) * 100}%` }]} />}
                  </View>
                  <Text style={s.value}>{a ? a.value + 1 : '—'}</Text>
                </View>
              );
            })}
            <Text style={s.small}>
              Your selected positions, not personality scores or a diagnosis.
            </Text>
          </View>
          {!!error && (
            <Text accessibilityRole="alert" style={s.body}>
              {error}
            </Text>
          )}
        </View>
      }
      renderItem={({ item }) => {
        const selected = answers[item.id];
        return (
          <View style={s.card}>
            <Text style={s.eyebrow}>{item.theme.toUpperCase()}</Text>
            <Text style={s.question}>{item.title}</Text>
            <Text style={s.small}>{item.reason}</Text>
            <View style={s.options}>
              {item.options.map((option, i) => (
                <Pressable
                  key={option}
                  disabled={!ready}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: selected?.value === i }}
                  onPress={() => answer(item, i)}
                  style={[s.option, selected?.value === i && s.chosen]}
                >
                  <View
                    style={[s.dot, selected?.value === i && { backgroundColor: cl.goldDeep }]}
                  />
                  <Text style={s.optionText}>{option}</Text>
                </Pressable>
              ))}
            </View>
            {selected && (
              <Text style={s.small}>Your answer: {selected.label} · tap another to change</Text>
            )}
          </View>
        );
      }}
      ListEmptyComponent={
        <Text style={s.body}>
          No questions match this search. Clear it to return to your daily feed.
        </Text>
      }
      ListFooterComponent={
        <View style={s.intro}>
          <Text style={s.small}>
            Personal reflections and private polls. Community vote totals are not available yet.
            These custom prompts are not a validated personality assessment.
          </Text>
          <Pressable
            accessibilityRole="link"
            onPress={() => void Linking.openURL('https://ipip.ori.org/newMultipleconstructs.htm')}
            style={s.source}
          >
            <Text style={s.small}>Explore the personality research: IPIP ↗</Text>
          </Pressable>
          {page >= 12 && (
            <Text style={s.body}>
              You’ve explored today’s question bank. New daily check-ins arrive tomorrow.
            </Text>
          )}
        </View>
      }
    />
  );
}
const s = StyleSheet.create({
  list: { paddingBottom: 36, gap: 16 },
  intro: { gap: 12, paddingVertical: 15 },
  eyebrow: { fontFamily: 'Outfit_500Medium', fontSize: 10, letterSpacing: 1.4, color: cl.goldDeep },
  title: { fontFamily: 'Newsreader_400Regular', fontSize: 34, color: cl.ink },
  body: { fontFamily: 'Outfit_400Regular', fontSize: 15, lineHeight: 22, color: cl.ink70 },
  small: { fontFamily: 'Outfit_400Regular', fontSize: 11, lineHeight: 17, color: cl.ink62 },
  card: {
    borderRadius: 26,
    borderWidth: 1,
    borderColor: '#E8DCCB',
    padding: 20,
    backgroundColor: '#FCFAF7',
    gap: 11,
  },
  question: { fontFamily: 'Newsreader_400Regular', fontSize: 27, lineHeight: 31, color: cl.ink },
  options: { gap: 8, marginTop: 6 },
  option: {
    minHeight: 46,
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: cl.cardHairline,
    padding: 12,
    backgroundColor: cl.card,
  },
  chosen: { borderColor: cl.goldDeep, backgroundColor: '#F5E6CF' },
  dot: { width: 12, height: 12, borderRadius: 6, borderWidth: 1, borderColor: cl.goldDeep },
  optionText: { fontFamily: 'Outfit_400Regular', fontSize: 14, color: cl.ink, flex: 1 },
  chart: { borderRadius: 22, backgroundColor: '#F6F1E8', padding: 16, gap: 10 },
  chartRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  chartLabel: { width: 86, fontFamily: 'Outfit_400Regular', fontSize: 12, color: cl.ink70 },
  track: { flex: 1, height: 6, borderRadius: 3, backgroundColor: '#E8DFD0', overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3, backgroundColor: cl.goldDeep },
  value: { width: 14, fontSize: 11, color: cl.ink70 },
  source: { minHeight: 44, justifyContent: 'center' },
});
