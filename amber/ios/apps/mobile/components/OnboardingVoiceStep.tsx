import { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { randomUUID } from 'expo-crypto';
import { Mic, Check, LockKeyhole, Users, MapPin, Sparkles, ArrowRight } from 'lucide-react-native';
import { GlassSurface } from './LiquidGlass';
import { Pressable } from './Pressable';
import { VoiceNoteRecorder } from './VoiceNoteRecorder';
import { VoiceNotePlayer } from './VoiceNotePlayer';
import { useJournal } from '../lib/useJournal';
import { syncJournalMemo } from '../lib/journalSync';
import { callMedhaId, unwrapOrThrow } from '../lib/medhaId';
import { sortMemo } from '../lib/proposeMemoActions';
import {
  onboardingPrompts,
  connectionPriorities,
  promptMemoTitle,
  type OnboardingPrompt,
} from '../lib/onboardingPrompts';
import type { MemoEntry } from '../lib/memoActions';
import { cl } from '../lib/classical';

type Contact = { id: string; name: string };
export function OnboardingVoiceStep({
  prompt,
  sample,
  onNext,
  onBusy,
}: {
  prompt: OnboardingPrompt;
  sample: boolean;
  onNext: () => void;
  onBusy: (busy: boolean) => void;
}) {
  const { setMemos, preserveMemo, ready, error: storageError } = useJournal(sample);
  const [recording, setRecording] = useState(false);
  const [entry, setEntry] = useState<MemoEntry | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [priorities, setPriorities] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [suggested, setSuggested] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const lock = useRef(false);
  const draft = useRef<MemoEntry | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    if (!sample) {
      void callMedhaId<Contact[] | { contacts: Contact[] }>({
        path: '/v1/me/contacts',
        requireAuth: true,
      }).then((r) => {
        if (r.ok && alive.current)
          setContacts(
            (Array.isArray(r.data) ? r.data : (r.data.contacts ?? [])).filter((c) => c.name),
          );
      });
      void callMedhaId<{ context: Record<string, unknown> }>({
        path: '/v1/me/onboarding-context',
        requireAuth: true,
      }).then((r) => {
        if (r.ok && alive.current) setSaved(!!r.data.context[prompt]);
      });
    }
    return () => {
      alive.current = false;
    };
  }, [prompt, sample]);
  useEffect(() => {
    onBusy(recording || busy);
    return () => onBusy(false);
  }, [recording, busy, onBusy]);
  async function preserve(media: NonNullable<MemoEntry['media']>) {
    const memo = draft.current ?? {
      id: randomUUID(),
      text: '',
      createdAt: new Date().toISOString(),
      destination: promptMemoTitle(prompt),
    };
    draft.current = await preserveMemo({ ...memo, media });
    return draft.current.media!;
  }
  async function recorded(text: string, _scope: unknown, media?: MemoEntry['media']) {
    const memo = draft.current!;
    const next = await preserveMemo({
      ...memo,
      text,
      media,
      cloud: { conversationId: memo.id, originalText: text, transcriptSaved: false },
    });
    setMemos((old) => [next, ...old.filter((m) => m.id !== next.id)]);
    setEntry(next);
    setRecording(false);
    setSaved(false);
    if (!text.trim()) {
      setError('Audio saved. Type your words below to finish your answer.');
      return;
    }
    if (!sample) {
      const controller = new AbortController();
      try {
        const sorted = await sortMemo(text, contacts, controller.signal);
        if (alive.current)
          setSuggested(
            sorted.objects.people.map((p) => p.contactId).filter((id): id is string => !!id),
          );
      } catch {
        if (alive.current)
          setError('Choose any people mentioned below. Matching suggestions are unavailable.');
      }
    }
  }
  async function save() {
    if (lock.current || !entry?.text.trim()) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      let next = await preserveMemo(entry);
      if (!sample) {
        const cloud = await syncJournalMemo(next);
        next = { ...next, cloud };
        setMemos((old) => [next, ...old.filter((m) => m.id !== next.id)]);
        if (cloud.error || !cloud.transcriptSaved || (next.media && !cloud.audioSaved))
          throw Error(
            cloud.error || 'Your recording is safe on this device. Retry its cloud save.',
          );
        unwrapOrThrow(
          await callMedhaId({
            path: '/v1/me/onboarding-context/' + prompt,
            method: 'PUT',
            requireAuth: true,
            body: {
              memoId: next.id,
              contactIds: selected,
              priorities: prompt === 'priorities' ? priorities : [],
            },
          }),
        );
      }
      onNext();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save. Please retry.');
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  const chapter = prompt === 'family' ? 1 : prompt === 'nearby' ? 2 : 3;
  const PromptIcon = prompt === 'family' ? Users : prompt === 'nearby' ? MapPin : Sparkles;
  const visible = contacts
    .filter((c) =>
      search.trim()
        ? c.name.toLowerCase().includes(search.trim().toLowerCase())
        : suggested.includes(c.id) || selected.includes(c.id),
    )
    .slice(0, 12);
  return (
    <ScrollView
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={s.content}
    >
      <View style={s.chapter}>
        <View style={s.promptIcon}>
          <PromptIcon size={22} strokeWidth={1.6} color={cl.goldDeep} />
        </View>
        <Text style={s.kicker}>YOUR WORLD · {chapter} / 3</Text>
      </View>
      <View style={s.heading}>
        <Text style={s.title}>{onboardingPrompts[prompt].title}</Text>
        <Text style={s.body}>{onboardingPrompts[prompt].detail}</Text>
      </View>
      {saved && !entry && (
        <View style={s.saved}>
          <Check size={16} color={cl.goldDeep} />
          <Text style={s.caption}>Your answer is saved.</Text>
        </View>
      )}
      {!entry && (
        <GlassSurface
          style={s.recordCard}
          fallbackStyle={s.recordFallback}
          tintColor="rgba(255,255,255,0.65)"
        >
          {recording ? (
            <VoiceNoteRecorder
              visible
              embedded
              localOnly={sample}
              title="Your answer"
              onBeforeProcess={preserve}
              onCancel={() => setRecording(false)}
              onDone={recorded}
            />
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Record your answer"
              disabled={!ready}
              style={({ pressed }) => [s.recordAction, { opacity: pressed ? 0.75 : 1 }]}
              onPress={() => {
                draft.current = null;
                setRecording(true);
              }}
            >
              <View style={s.wave} accessible={false}>
                {[8, 15, 23, 34, 21, 13, 27, 40, 29, 18, 10, 23, 32, 18, 8].map((height, i) => (
                  <View key={i} style={[s.bar, { height }]} />
                ))}
              </View>
              <View style={s.mic}>
                <Mic size={28} strokeWidth={1.7} color={cl.card} />
              </View>
              <Text style={s.recordTitle}>
                {ready ? 'Tell Amber in your own words' : 'Preparing recorder…'}
              </Text>
              <Text style={s.caption}>Tap to record · take your time</Text>
            </Pressable>
          )}
        </GlassSurface>
      )}
      <View style={s.privacy}>
        <LockKeyhole size={14} color={cl.ink62} />
        <Text style={[s.caption, { flex: 1 }]}>
          Only for you. Choose who you mean before anything is linked.
        </Text>
      </View>
      {!recording && (
        <>
          {entry && (
            <>
              {entry.media && (
                <VoiceNotePlayer
                  durationMs={entry.media.durationMs}
                  peaks={entry.media.peaks}
                  fetchAudio={async () => ({ playbackUrl: entry.media!.uri })}
                />
              )}
              <TextInput
                accessibilityLabel="Review your answer"
                multiline
                value={entry.text}
                onChangeText={(text) => setEntry({ ...entry, text })}
                style={s.input}
                placeholder="Your answer…"
              />
              <Text style={s.sectionTitle}>Who did you mention?</Text>
              <TextInput
                accessibilityLabel="Find a contact for your answer"
                value={search}
                onChangeText={setSearch}
                placeholder="Search your contacts"
                style={s.input}
              />
              {visible.map((person) => (
                <Pressable
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: selected.includes(person.id) }}
                  key={person.id}
                  style={s.choice}
                  onPress={() =>
                    setSelected((old) =>
                      old.includes(person.id)
                        ? old.filter((id) => id !== person.id)
                        : [...old, person.id],
                    )
                  }
                >
                  <Text style={[s.body, { flex: 1 }]}>{person.name}</Text>
                  {selected.includes(person.id) && <Check size={20} color={cl.goldDeep} />}
                </Pressable>
              ))}
              {!visible.length && (
                <Text style={s.caption}>
                  Search by name, or save the context now and link people later. We will not guess.
                </Text>
              )}
              {prompt === 'priorities' && (
                <View style={s.options}>
                  {connectionPriorities.map((kind) => (
                    <Pressable
                      key={kind}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: priorities.includes(kind) }}
                      style={[s.chip, priorities.includes(kind) && s.chosen]}
                      onPress={() =>
                        setPriorities((old) =>
                          old.includes(kind) ? old.filter((v) => v !== kind) : [...old, kind],
                        )
                      }
                    >
                      <Text style={s.body}>{kind.charAt(0).toUpperCase() + kind.slice(1)}</Text>
                    </Pressable>
                  ))}
                </View>
              )}
              <Pressable
                accessibilityRole="button"
                disabled={busy || !entry.text.trim()}
                onPress={() => void save()}
                style={s.primary}
              >
                <Text style={s.primaryText}>{busy ? 'Saving…' : 'Save and continue'}</Text>
                <ArrowRight size={19} color={cl.card} />
              </Pressable>
            </>
          )}
          <Pressable accessibilityRole="button" disabled={busy} onPress={onNext} style={s.skip}>
            <Text style={s.body}>{saved ? 'Continue' : 'Skip for now'}</Text>
          </Pressable>
        </>
      )}
      {!!(error || storageError) && (
        <Text accessibilityRole="alert" style={s.caption}>
          {error || storageError}
        </Text>
      )}
    </ScrollView>
  );
}
const s = StyleSheet.create({
  chapter: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  promptIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: cl.groundGold,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heading: { gap: 12 },
  saved: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  recordCard: {
    borderRadius: 32,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: cl.ruleFaint,
    minHeight: 240,
  },
  recordFallback: { backgroundColor: cl.groundGold },
  recordAction: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    padding: 24,
    minHeight: 240,
  },
  wave: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 42,
    gap: 5,
  },
  bar: { width: 3, borderRadius: 2, backgroundColor: cl.gold, opacity: 0.35 },
  mic: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: cl.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recordTitle: { fontFamily: 'Outfit_500Medium', fontSize: 17, color: cl.ink, textAlign: 'center' },
  privacy: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', paddingHorizontal: 6 },
  sectionTitle: { fontFamily: 'Outfit_500Medium', fontSize: 18, color: cl.ink },
  content: { gap: 22, paddingTop: 4, paddingBottom: 12 },
  kicker: { fontFamily: 'Outfit_500Medium', fontSize: 11, color: cl.ink62, letterSpacing: 1.5 },
  title: {
    fontFamily: 'Outfit_500Medium',
    fontSize: 34,
    lineHeight: 39,
    letterSpacing: -0.9,
    color: cl.ink,
  },
  body: { fontFamily: 'Outfit_400Regular', fontSize: 16, lineHeight: 24, color: cl.ink62 },
  caption: { fontFamily: 'Outfit_400Regular', fontSize: 13, lineHeight: 20, color: cl.ink55 },
  primary: {
    minHeight: 54,
    backgroundColor: cl.ink,
    borderRadius: 28,
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryText: { fontFamily: 'Outfit_500Medium', fontSize: 16, color: cl.card },
  input: {
    fontFamily: 'Outfit_400Regular',
    fontSize: 16,
    lineHeight: 23,
    color: cl.ink,
    backgroundColor: cl.card,
    borderColor: cl.ruleFaint,
    borderWidth: 1,
    borderRadius: 18,
    padding: 16,
    minHeight: 52,
  },
  choice: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 48,
    paddingHorizontal: 14,
    backgroundColor: cl.card,
    borderRadius: 16,
  },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { padding: 12, borderRadius: 22, borderColor: cl.ruleFaint, borderWidth: 1 },
  chosen: { borderColor: cl.goldDeep, backgroundColor: cl.card },
  skip: { minHeight: 44, justifyContent: 'center', alignItems: 'center' },
});
