import { CalendarActivityFeed } from '../components/CalendarActivityFeed';
import { webSearchRequest } from '../lib/surfaceSearch';
import { useJournal } from '../lib/useJournal';
import { AmberProfileEditor } from '../components/AmberProfileEditor';
import { useAmberSpace } from '../lib/useAmberSpace';
import { membersFor, toggleNetwork } from '../lib/amberSpace';
import { WebDiscoverySheet, type DiscoveryPerson } from '../components/WebDiscoverySheet';
import { PersonalActivity } from '../components/PersonalActivity';
import { NetworkCanvas } from '../components/NetworkCanvas';
import { NetworkProfile, type ProfileSeed } from '../components/NetworkProfile';
import { MemoComposer } from '../components/MemoComposer';
import { type MemoEntry, type ReviewRequest } from '../components/RequestReview';
import { CommunitySearch } from '../components/CommunitySearch';
import { IntegrationStories } from '../components/IntegrationStories';
import { RelationshipDock, type RelationshipTab } from '../components/RelationshipDock';
import { useMemo, useState } from 'react';
import {
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowUpRight, Check, UserRound, Sparkles, X } from 'lucide-react-native';
import { cl } from '../lib/classical';

type Person = {
  details?: { emails?: string[]; phone?: string };
  name: string;
  role: string;
  initials: string;
  x: number;
  y: number;
};
const PEOPLE: Person[] = [
  { name: 'Maya', role: 'Sister', initials: 'ML', x: 0.26, y: 0.19 },
  { name: 'Alex', role: 'Closest friend', initials: 'AC', x: 0.76, y: 0.28 },
  { name: 'Sam', role: 'Partner', initials: 'SR', x: 0.2, y: 0.57 },
  { name: 'Nina', role: 'Running partner', initials: 'NP', x: 0.77, y: 0.69 },
  { name: 'Dr. Lee', role: 'Care team', initials: 'JL', x: 0.43, y: 0.86 },
];
type Panel = 'sources' | 'search' | 'speak' | 'person' | null;

export default function HealthNetworkPreview({
  onRestartOnboarding,
  selfName = '',
}: { selfName?: string; onRestartOnboarding?: () => void } = {}) {
  const [people, setPeople] = useState(PEOPLE);
  const savedSpace = useAmberSpace(true, selfName);
  const [editProfile, setEditProfile] = useState(false);
  const [panel, setPanel] = useState<Panel>(null);
  const [person, setPerson] = useState(PEOPLE[0]);
  const [query, setQuery] = useState('');
  const [journalQuery, setJournalQuery] = useState('');
  const [search, setSearch] = useState<{
    query: string;
    web: boolean;
    scope: 'network' | 'day' | 'opportunities';
  } | null>(null);
  const [web, setWeb] = useState(false);
  const [recording, setRecording] = useState(false);
  const [reviewMemo, setReviewMemo] = useState<MemoEntry | null>(null);
  const { memos, setMemos, error: journalError } = useJournal(true);
  const [sampleEvents, setSampleEvents] = useState<
    { title: string; startsAt: string; endsAt: string }[]
  >([]);
  const [notes, setNotes] = useState<Record<string, string>>({});

  const [enriched, setEnriched] = useState(false);
  const [research, setResearch] = useState(false);
  const [tab, setTab] = useState<RelationshipTab>('people');
  const [activityOpen, setActivityOpen] = useState(false);
  const [activity, setActivity] = useState('');
  const [profile, setProfile] = useState<ProfileSeed | null>(null);
  const [focusId, setFocusId] = useState<string | undefined>();
  const feedContacts = useMemo(
    () => people.map((p) => ({ id: p.name, name: p.name, title: p.role, notes: notes[p.name] })),
    [people, notes],
  );
  const networkPeople = useMemo(
    () =>
      people.map((value) => ({
        id: value.name,
        name: value.name,
        subtitle: value.role,
        context: [
          notes[value.name],
          (
            {
              Maya: 'hiking outdoors family',
              Alex: 'product design creative',
              Sam: 'hiking new role work',
              Nina: 'running product design',
            } as Record<string, string>
          )[value.name],
        ]
          .filter(Boolean)
          .join(' '),
      })),
    [people, notes],
  );
  const visiblePeople = useMemo(() => {
    const ids = new Set(
      membersFor(
        savedSpace.space,
        savedSpace.space.active,
        networkPeople.map((person) => person.id),
      ),
    );
    return networkPeople.filter((person) => ids.has(person.id));
  }, [savedSpace.space, networkPeople]);
  const close = () => {
    setPanel(null);
    setResearch(false);
  };
  const openPerson = (value: Person) => {
    setPerson(value);
    setPanel(null);
    setFocusId(undefined);
    setProfile({
      id: value.name,
      name: value.name,
      subtitle: value.role,
      notes: notes[value.name],
      source: 'Sample contact',
      contact: { id: value.name, name: value.name, ...value.details },
    });
  };
  const results = people.filter((value) =>
    `${value.name} ${value.role}`.toLowerCase().includes(query.toLowerCase()),
  );
  const title =
    panel === 'sources'
      ? 'Bring your people together'
      : panel === 'search'
        ? 'Ask your network'
        : panel === 'speak'
          ? 'Say what matters'
          : person.name;
  async function confirmMemo(memo: MemoEntry, request: ReviewRequest): Promise<string> {
    const destination =
      request.kind === 'contact'
        ? request.contactId
        : request.kind === 'calendar'
          ? 'Amber calendar'
          : 'Computer draft';
    const result = `Kept in this preview: ${destination}. Nothing was sent to a service.`;
    setMemos((previous) =>
      previous.map((entry) =>
        entry.id === memo.id
          ? {
              ...entry,
              text: memo.text,
              destination: `Preview · ${destination}`,
              reviews: [
                ...(entry.reviews ?? (entry.review ? [entry.review] : [])),
                {
                  ...request,
                  startsAt: request.startsAt.toISOString(),
                  endsAt: request.endsAt.toISOString(),
                  confirmedAt: new Date().toISOString(),
                  result: result,
                },
              ],
              review: {
                ...request,
                startsAt: request.startsAt.toISOString(),
                endsAt: request.endsAt.toISOString(),
                confirmedAt: new Date().toISOString(),
                result,
              },
            }
          : entry,
      ),
    );
    if (request.kind === 'contact') {
      setNotes((previous) => ({ ...previous, [request.contactId]: request.text }));
      setPeople((previous) => [
        ...previous.filter((p) => p.name === request.contactId),
        ...previous.filter((p) => p.name !== request.contactId),
      ]);
    }
    if (request.kind === 'calendar')
      setSampleEvents((previous) => [
        ...previous,
        {
          title: request.title,
          startsAt: request.startsAt.toISOString(),
          endsAt: request.endsAt.toISOString(),
        },
      ]);
    return result;
  }
  const addDiscoveredPerson = (candidate: DiscoveryPerson) => {
    setPeople((old) =>
      old.some((p) => p.name === candidate.name)
        ? old
        : [
            ...old,
            {
              name: candidate.name,
              role: candidate.title || 'New contact',
              initials: candidate.name.slice(0, 2),
              details: {
                emails: [candidate.workEmail, candidate.personalEmail].filter(
                  (v): v is string => !!v,
                ),
                phone: candidate.phone || undefined,
              },
              x: 0.5,
              y: 0.5,
            },
          ],
    );
    setNotes((old) => ({
      ...old,
      [candidate.name]: candidate.snippet || savedSpace.space.intent || 'Web discovery',
    }));
    const active = savedSpace.space.active;
    const ids = membersFor(
      savedSpace.space,
      active,
      networkPeople.map((p) => p.id),
    );
    void savedSpace
      .save({
        memberships: {
          ...savedSpace.space.memberships,
          [active]: [...new Set([...ids, candidate.name])],
        },
      })
      .catch(() => {});
    setFocusId(candidate.name);
  };
  return (
    <SafeAreaView style={s.screen}>
      <View style={s.header}>
        <View style={s.brand}>
          <Image source={require('../assets/amber-logo.png')} style={s.logo} />
          <Text style={s.wordmark}>amber</Text>
        </View>
        {onRestartOnboarding && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Restart onboarding preview"
            onPress={onRestartOnboarding}
            style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: 8 }}
          >
            <Text style={s.caption}>Walkthrough</Text>
          </Pressable>
        )}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Your profile and shareable contact card"
          onPress={() =>
            setProfile({
              id: 'self',
              name: savedSpace.space.profile.displayName || 'You',
              notes: savedSpace.space.profile.bio,
            })
          }
          style={s.round}
        >
          <UserRound size={22} color={cl.ink} />
        </Pressable>
      </View>
      <View style={{ paddingHorizontal: 16 }}>
        <CommunitySearch
          web={web}
          onWebChange={setWeb}
          placeholder={tab === 'calendar' ? 'Search this journal' : undefined}
          value={tab === 'people' ? query : journalQuery}
          onChange={tab === 'people' ? setQuery : setJournalQuery}
          onSubmit={() => {
            const value = (tab === 'people' ? query : journalQuery).trim();
            const request = webSearchRequest(tab, web, value);
            if (request) setSearch(request);
          }}
        />
      </View>
      {!!journalError && (
        <Text accessibilityRole="alert" style={{ color: cl.ink, paddingHorizontal: 16 }}>
          {journalError}
        </Text>
      )}
      {tab === 'people' ? (
        <>
          <View style={{ paddingHorizontal: 16 }}>
            <IntegrationStories sample />
          </View>
          <NetworkCanvas
            people={visiblePeople}
            activeNetwork={savedSpace.space.active}
            onRockAction={(action) => {
              if (action === 'Amber Alert') setActivityOpen(true);
              else {
                setFocusId(undefined);
                void savedSpace
                  .save({ active: toggleNetwork(savedSpace.space.active, action) })
                  .catch(() => {});
              }
            }}
            query={web ? '' : query}
            focusId={focusId}
            onOpen={(id) => {
              if (id === 'self') {
                setFocusId(undefined);
                setEditProfile(true);
              } else {
                const value = people.find((p) => p.name === id);
                if (value) openPerson(value);
              }
            }}
          />
        </>
      ) : (
        <CalendarActivityFeed
          sample={true}
          entries={memos}
          query={web ? '' : journalQuery}
          onReview={setReviewMemo}
          sampleEvents={sampleEvents}
        />
      )}
      <View style={s.footer}>
        <RelationshipDock tab={tab} onTab={setTab} onSpeak={() => setRecording(true)} />
      </View>
      {!!savedSpace.error && (
        <Text accessibilityRole="alert" style={s.caption}>
          {savedSpace.error}
        </Text>
      )}
      {editProfile && (
        <AmberProfileEditor
          space={savedSpace.space}
          people={networkPeople}
          sample={true}
          onClose={() => setEditProfile(false)}
          onSave={savedSpace.save}
        />
      )}
      {activityOpen && (
        <PersonalActivity
          latest={activity}
          sample
          onClose={() => setActivityOpen(false)}
          onSaved={(text) => {
            setActivity(text);
            setPeople((old) => [...old]);
          }}
        />
      )}
      {profile && (
        <NetworkProfile
          key={profile.id}
          seed={profile}
          sample
          onClose={() => setProfile(null)}
          onNetwork={(id) => {
            setProfile(null);
            setQuery('');
            setTab('people');
            setFocusId(id);
          }}
        />
      )}
      {search && (
        <WebDiscoverySheet
          query={search.query}
          scope={search.scope}
          sample
          onClose={() => setSearch(null)}
          onAddSample={addDiscoveredPerson}
        />
      )}
      {(recording || reviewMemo) && (
        <MemoComposer
          initialEntry={reviewMemo}
          initialMode={reviewMemo ? 'capture' : 'voice'}
          sample
          contacts={people.map((p) => ({ id: p.name, name: p.name }))}
          onClose={() => {
            setRecording(false);
            setReviewMemo(null);
          }}
          onCaptured={(entry) => {
            setMemos((previous) => [entry, ...previous]);
            setTab('calendar');
          }}
          onUpdated={(entry) =>
            setMemos((previous) =>
              previous.map((old) => (old.id === entry.id ? { ...old, text: entry.text } : old)),
            )
          }
          onConfirm={confirmMemo}
        />
      )}

      <Modal
        visible={panel !== null && panel !== 'speak'}
        transparent
        animationType="fade"
        onRequestClose={close}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={s.modal}
        >
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={close}
            accessibilityLabel="Dismiss panel"
            accessibilityRole="button"
          />
          <View style={s.sheet} accessibilityViewIsModal>
            <View style={s.handle} />
            <View style={s.sheetHeader}>
              <Text style={s.sheetTitle}>{title}</Text>
              <Pressable
                onPress={close}
                accessibilityLabel="Close"
                accessibilityRole="button"
                style={s.round}
              >
                <X size={20} color={cl.ink} />
              </Pressable>
            </View>
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={s.sheetContent}>
              <Text style={s.caption}>Interactive prototype · no connected services</Text>
              {panel === 'sources' && (
                <>
                  <Text style={s.body}>
                    Bring contacts into one place. Review possible duplicates, then choose who
                    belongs in your circle.
                  </Text>
                  {['Phone contacts', 'Google contacts'].map((label) => (
                    <View key={label} style={s.row}>
                      <Text style={s.rowTitle}>{label}</Text>
                      <Text style={s.caption}>Not connected</Text>
                    </View>
                  ))}
                  <Text style={s.body}>
                    Try the sample: six source records become five people after you confirm Maya’s
                    two records belong together.
                  </Text>
                  <Pressable
                    style={s.primary}
                    accessibilityRole="button"
                    onPress={() => {
                      setPeople(PEOPLE);
                      close();
                    }}
                  >
                    <Check color={cl.card} size={18} />
                    <Text style={s.primaryText}>Confirm sample merge & build circle</Text>
                  </Pressable>
                </>
              )}
              {panel === 'search' && (
                <>
                  <TextInput
                    accessibilityLabel="Search people or ask a question"
                    placeholder="A person, a question, a possibility…"
                    placeholderTextColor={cl.ink55}
                    value={query}
                    onChangeText={setQuery}
                    style={s.input}
                  />
                  {results.map((value) => (
                    <Pressable
                      key={value.name}
                      onPress={() => openPerson(value)}
                      style={s.row}
                      accessibilityRole="button"
                    >
                      <Text style={s.rowTitle}>{value.name}</Text>
                      <Text style={s.caption}>{value.role}</Text>
                    </Pressable>
                  ))}
                  {results.length === 0 && (
                    <Text style={s.body}>No matching people in this sample circle.</Text>
                  )}
                  <Pressable
                    style={s.row}
                    accessibilityRole="button"
                    onPress={() => setResearch(true)}
                  >
                    <View>
                      <Text style={s.rowTitle}>Research with Perplexity</Text>
                      <Text style={s.caption}>Preview a research request</Text>
                    </View>
                    <ArrowUpRight size={20} color={cl.goldDeep} />
                  </Pressable>
                  {research && (
                    <Text style={s.body}>
                      Request prepared: “{query || 'How can I better support my circle?'}”{'\n\n'}A
                      connected version would show cited findings here. Nothing has been sent to
                      Perplexity.
                    </Text>
                  )}
                </>
              )}

              {panel === 'person' && (
                <>
                  <Text style={s.subtitle}>{person.role} · Your circle</Text>
                  <View style={s.row}>
                    <Text style={s.rowTitle}>Contact sources</Text>
                    <Text style={s.caption}>
                      {person.name === 'Maya' ? 'Phone + Google · sample merge' : 'Sample contact'}
                    </Text>
                  </View>
                  {notes[person.name] ? (
                    <View style={s.note}>
                      <Text style={s.eyebrow}>WHAT MATTERS</Text>
                      <Text style={s.body}>{notes[person.name]}</Text>
                    </View>
                  ) : (
                    <Text style={s.body}>
                      A place for the details that make this relationship yours.
                    </Text>
                  )}
                  <Pressable
                    accessibilityRole="button"
                    style={s.row}
                    onPress={() => setEnriched(true)}
                  >
                    <View>
                      <Text style={s.rowTitle}>Find more with Clay</Text>
                      <Text style={s.caption}>Review new details before adding them</Text>
                    </View>
                    <Sparkles size={20} color={cl.goldDeep} />
                  </Pressable>
                  {enriched && (
                    <Text style={s.body}>
                      Clay enrichment preview: additional contact details would appear with their
                      sources for your review. No lookup has been performed.
                    </Text>
                  )}
                  <Text style={s.caption}>
                    WhatsApp and iMessage entry points are planned. This prototype does not send
                    messages.
                  </Text>
                </>
              )}
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}
const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: cl.ground },
  header: {
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 48,
  },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  logo: { width: 37, height: 40 },
  wordmark: { fontFamily: 'Newsreader_500Medium', fontSize: 29, color: cl.ink, letterSpacing: -1 },
  round: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: cl.groundGold,
    alignItems: 'center',
    justifyContent: 'center',
  },
  intro: { paddingHorizontal: 28, paddingTop: 24 },
  eyebrow: { fontFamily: 'Outfit_500Medium', fontSize: 10, letterSpacing: 2, color: cl.goldDeep },
  headline: {
    fontFamily: 'Newsreader_400Regular',
    fontSize: 32,
    letterSpacing: -0.8,
    color: cl.ink,
    marginTop: 12,
  },
  subtitle: { fontFamily: 'Outfit_400Regular', fontSize: 15, color: cl.ink62, marginTop: 8 },
  graph: { flex: 1, minHeight: 300, marginHorizontal: 16 },
  center: {
    position: 'absolute',
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: cl.card,
    borderColor: cl.warmHairline,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: cl.goldDeep,
    shadowOpacity: 0.12,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 5 },
  },
  centerMark: { width: 65, height: 65 },
  you: {
    position: 'absolute',
    bottom: -23,
    fontFamily: 'Outfit_500Medium',
    fontSize: 12,
    color: cl.ink62,
  },
  person: { position: 'absolute', width: 86, alignItems: 'center', minHeight: 90 },
  avatar: {
    width: 60,
    height: 60,
    borderRadius: 30,
    borderWidth: 2,
    borderColor: cl.card,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: cl.ink,
    shadowOpacity: 0.08,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 5 },
  },
  initials: { fontFamily: 'Newsreader_500Medium', fontSize: 22, color: cl.ink70 },
  dot: {
    position: 'absolute',
    right: 0,
    bottom: 1,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: cl.goldDeep,
    borderWidth: 2,
    borderColor: cl.card,
  },
  personName: { fontFamily: 'Outfit_500Medium', color: cl.ink, fontSize: 13, marginTop: 7 },
  role: { fontFamily: 'Outfit_400Regular', color: cl.ink62, fontSize: 10, marginTop: 2 },
  empty: { position: 'absolute', bottom: 15, alignSelf: 'center', alignItems: 'center' },
  footer: { paddingHorizontal: 16, paddingTop: 6 },
  connection: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minHeight: 44,
    marginBottom: 12,
  },
  connectionText: { fontFamily: 'Outfit_400Regular', fontSize: 12, color: cl.ink62 },
  statusDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: cl.goldDeep },
  dockShadow: {
    shadowColor: cl.ink,
    shadowRadius: 24,
    shadowOpacity: 0.1,
    shadowOffset: { width: 0, height: 8 },
  },
  dock: {
    flexDirection: 'row',
    padding: 7,
    gap: 7,
    borderRadius: 36,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: cl.cardHairline,
    backgroundColor: cl.groundWashCenter,
  },
  action: {
    flex: 1,
    minHeight: 62,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 12,
  },
  speak: { backgroundColor: cl.ink },
  actionText: { fontFamily: 'Outfit_500Medium', fontSize: 18, color: cl.ink },
  pressed: { opacity: 0.7, transform: [{ scale: 0.97 }] },
  preview: { alignItems: 'center', paddingVertical: 15, minHeight: 44 },
  previewText: { fontFamily: 'Outfit_400Regular', fontSize: 8, letterSpacing: 1, color: cl.ink62 },
  modal: { flex: 1, justifyContent: 'flex-end', backgroundColor: cl.ink32 },
  sheet: {
    maxHeight: '82%',
    backgroundColor: cl.card,
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    paddingBottom: 36,
  },
  handle: {
    width: 32,
    height: 4,
    borderRadius: 2,
    backgroundColor: cl.cardHairline,
    alignSelf: 'center',
    marginTop: 12,
  },
  sheetHeader: {
    padding: 24,
    paddingBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  sheetTitle: { fontFamily: 'Newsreader_500Medium', fontSize: 25, color: cl.ink, flex: 1 },
  sheetContent: { paddingHorizontal: 16, gap: 18, paddingBottom: 20 },
  caption: { fontFamily: 'Outfit_400Regular', fontSize: 11, lineHeight: 17, color: cl.ink62 },
  body: { fontFamily: 'Outfit_400Regular', fontSize: 15, lineHeight: 23, color: cl.ink70 },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
    minHeight: 58,
    paddingVertical: 12,
    borderBottomColor: cl.cardHairline,
    borderBottomWidth: 1,
  },
  rowTitle: { fontFamily: 'Outfit_500Medium', fontSize: 15, color: cl.ink },
  primary: {
    backgroundColor: cl.ink,
    minHeight: 54,
    padding: 16,
    borderRadius: 27,
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryText: { fontFamily: 'Outfit_500Medium', fontSize: 14, color: cl.card },
  input: {
    borderWidth: 1,
    borderColor: cl.cardHairline,
    borderRadius: 18,
    padding: 16,
    minHeight: 56,
    fontFamily: 'Outfit_400Regular',
    fontSize: 16,
    color: cl.ink,
  },
  inline: { flexDirection: 'row', gap: 8, alignItems: 'center', minHeight: 44 },
  link: { fontFamily: 'Outfit_500Medium', fontSize: 14, color: cl.goldDeep },
  voiceOrb: {
    alignSelf: 'center',
    width: 86,
    height: 86,
    borderRadius: 43,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: cl.warm[0],
  },
  note: { padding: 18, gap: 10, backgroundColor: cl.groundGold, borderRadius: 20 },
});
