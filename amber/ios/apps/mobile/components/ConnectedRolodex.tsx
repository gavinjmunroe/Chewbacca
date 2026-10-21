import { subscribeCardImport, takeCardImport } from '../lib/cardImportIntent';
import { Pressable } from './Pressable';
import { MemoHistory } from './MemoHistory';
import type { MemoContext } from '../lib/memoContext';
import { useMemoQueries } from '../lib/useMemoQueries';
import { MemoConversation } from './MemoConversation';
import { CircleMembersSheet } from './CircleMembersSheet';
import { NewContactModal, type NewContactDraft } from './NewContactModal';
import { createReviewedContact } from '../lib/createReviewedContact';
import { getContact } from '../lib/contacts';
import { loadProgressively } from '../lib/progressiveNetwork';
import { createGoogleMemoEvent } from '../lib/googleCalendarWrite';
import { getCommunityGraph, communityNodes, type CommunityNode } from '../lib/communityGraph';
import { runCaptureTask } from '../lib/runCaptureTask';
import { useCommunityCircles } from '../lib/useCommunityCircles';
import { orderByPeopleRank, type CommunityRank } from '../lib/communityFilters';
import { api, unwrapSingle, type Me } from '../lib/api';
import {
  usePendingVoiceCapture,
  consumeVoiceCapture,
  PENDING_RECORD_TTL_MS,
} from '../lib/pendingRecord';
import { useRouter } from 'expo-router';
import { CalendarActivityFeed } from './CalendarActivityFeed';
import { webSearchRequest } from '../lib/surfaceSearch';
import { useJournal } from '../lib/useJournal';
import { AmberProfileEditor } from './AmberProfileEditor';
import { useAmberSpace } from '../lib/useAmberSpace';
import {
  type NetworkCategory,
} from '../lib/amberSpace';
import { WebDiscoverySheet } from './WebDiscoverySheet';
import { listConversations } from '../lib/conversations';
import { dayBounds } from '../lib/agenda';
import { PersonalActivity } from './PersonalActivity';
import { NetworkCanvas } from './NetworkCanvas';
import { NetworkProfile, type ProfileSeed } from './NetworkProfile';
import { History } from 'lucide-react-native';
import { AmberAccountCard } from './AmberAccountCard';
import { CalendarSyncSheet } from './CalendarSyncSheet';
import { RequestReview, type MemoEntry, type ReviewRequest } from './RequestReview';
import { focusedMemoSorting } from '../lib/memoDetail';
import { CommunitySearch } from './CommunitySearch';
import { contactName } from '../lib/contactName';
import { RelationshipDock, type RelationshipTab } from './RelationshipDock';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Image, Modal, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { cl } from '../lib/classical';
import { callMedhaId } from '../lib/medhaId';
import type { MedhaContactFull } from '../lib/contacts';
import { addFavorite, listFavorites, type Favorite } from '../lib/favorites';
import { captureContactNote } from '../lib/contactNotes';
import { memoActionId } from '../lib/memoActionId';
import { MemoComposer } from './MemoComposer';

const name = contactName;

// AuthGate owns authentication. Requests derive ownership from the session;
// neither this screen nor a model supplies a tenant/owner ID.
export function ConnectedRolodex() {
  const router = useRouter();
  const savedSpace = useAmberSpace(false);
  const [editProfile, setEditProfile] = useState(false);
  const [accountCard, setAccountCard] = useState(false);
  const [importIntent, setImportIntent] = useState<string | undefined>();
  useEffect(()=>{const take=()=>{const value=takeCardImport();if(value){setImportIntent(value);setAccountCard(true);}};take();return subscribeCardImport(take);},[]);
  const [accountCalendars, setAccountCalendars] = useState(false);
  const [selfMe, setSelfMe] = useState<Me | null>(null);
  const circles = useCommunityCircles();
  const [memberCategory, setMemberCategory] = useState<NetworkCategory | null>(null);
  const [memberDraft, setMemberDraft] = useState<string[] | null>(null);
  const [newContact, setNewContact] = useState(false);
  const [contactSaving, setContactSaving] = useState(false);
  const contactSaveLock = useRef(false);
  const [contactError, setContactError] = useState('');
  const [captureMode, setCaptureMode] = useState<'capture' | 'voice'>('capture');
  const [graphNodes, setGraphNodes] = useState<CommunityNode[]>([]);
  const [ranks, setRanks] = useState<CommunityRank[]>([]);
  const [rankError, setRankError] = useState('');
  const [contacts, setContacts] = useState<MedhaContactFull[]>([]);
  const [favorites, setFavorites] = useState<Favorite[]>([]);
  const [message, setMessage] = useState('Loading your network…');
  const [tab, setTab] = useState<RelationshipTab>('people');
  const [query, setQuery] = useState('');
  const [journalQuery, setJournalQuery] = useState('');
  const [search, setSearch] = useState<{
    query: string;
    web: boolean;
    scope: 'network' | 'day' | 'opportunities';
  } | null>(null);
  const [web, setWeb] = useState(false);
  const [plansWeb, setPlansWeb] = useState(false);
  const [panel, setPanel] = useState<'search' | 'card' | null>(null);
  const [person, setPerson] = useState<MedhaContactFull | null>(null);
  const [draft, setDraft] = useState('');
  const [memoContext, setMemoContext] = useState<MemoContext | undefined>();
  const [recording, setRecording] = useState(false);
  const pendingRecord = usePendingVoiceCapture();
  useEffect(() => {
    if (!pendingRecord) return;
    consumeVoiceCapture();
    if (Date.now() - pendingRecord.at > PENDING_RECORD_TTL_MS) return;
    setCalendarMounted(true);
    setTab('calendar');
    setMemoContext(undefined);
    setCaptureMode('voice');
    setRecording(true);
  }, [pendingRecord]);
  const capturedMemoId = useRef<string | null>(null);
  const { memos, setMemos, syncMemo, preserveMemo, error: journalError } = useJournal(false);
  const [reviewMemo, setReviewMemo] = useState<MemoEntry | null>(null);
  const [calendarRevision, setCalendarRevision] = useState(0);
  const [calendarMounted, setCalendarMounted] = useState(false);
  const changeTab = useCallback((value: 'people' | 'calendar') => {
    if (value === 'calendar') setCalendarMounted(true);
    setTab(value);
  }, []);
  const [busy, setBusy] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const [activity, setActivity] = useState('');
  const afterHistoryDismiss = useRef<(() => void) | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [profile, setProfile] = useState<ProfileSeed | null>(null);
  const [focusId, setFocusId] = useState<string | undefined>();
  const networkPeople = useMemo(() => {
    return orderByPeopleRank(
      contacts,
      ranks,
      new Map(graphNodes.map((n) => [n.id, n.strength])),
    ).map((contact) => ({
      id: contact.id,
      name: contactName(contact),
      subtitle: contact.company || contact.title,
      avatarUrl: contact.avatarUrl,
      context: [
        contact.notes,
        contact.city,
        contact.email,
        contact.phone,
        contact.enrichment?.title,
        contact.enrichment?.company,
      ]
        .filter(Boolean)
        .join(' '),
    }));
  }, [contacts, ranks, graphNodes]);
  const alive = useRef(true);
  const writing = useRef(false);
  const version = useRef(0);
  const refresh = useCallback(async (activityQuery?: string) => {
    const request = ++version.current;
    setMessage('Loading your network…');
    try {
      const book = await loadProgressively(
        () =>
          callMedhaId<MedhaContactFull[] | { contacts: MedhaContactFull[] }>({
            path: '/v1/me/contacts',
            method: 'GET',
            requireAuth: true,
          }),
        [
          () =>
            getCommunityGraph().then((result) => {
              if (alive.current && request === version.current && result.ok)
                setGraphNodes(communityNodes(result.data));
            }),
          () =>
            listFavorites().then((circle) => {
              if (
                alive.current &&
                request === version.current &&
                circle.ok &&
                Array.isArray(circle.data.favorites)
              )
                setFavorites(circle.data.favorites);
            }),
          () =>
            callMedhaId<{ ranks: CommunityRank[] }>({
              path: '/v1/me/contact-ranks',
              requireAuth: true,
            })
              .then((ranking) => {
                if (!alive.current || request !== version.current) return;
                if (ranking.ok && Array.isArray(ranking.data.ranks)) {
                  setRanks(ranking.data.ranks);
                  setRankError('');
                } else
                  setRankError(
                    'People Rank could not load. Showing saved relationships. Tap to retry.',
                  );
              })
              .catch(() => {
                if (alive.current && request === version.current)
                  setRankError(
                    'People Rank could not load. Showing saved relationships. Tap to retry.',
                  );
              }),
        ],
      );
      if (!alive.current || request !== version.current) return;
      if (!book.ok) {
        setMessage('Could not load your network. Check your connection or sign in again.');
        return;
      }
      const rows = Array.isArray(book.data) ? book.data : book.data.contacts;
      if (!Array.isArray(rows) || !rows.every((row) => row && typeof row.id === 'string')) {
        setMessage('Unexpected server response. Please refresh.');
        return;
      }
      setContacts(rows);
      setMessage(
        rows.length
          ? `${rows.length} saved contacts`
          : 'Connect contacts through Amber’s existing setup, then refresh.',
      );
    } catch {
      if (alive.current && request === version.current)
        setMessage('Could not load your network. Please refresh.');
    }
  }, []);
  useEffect(() => {
    alive.current = true;
    void refresh();
    void api
      .me()
      .then((result) => {
        if (alive.current && result.ok) {
          const value = unwrapSingle<Me>(result);
          setSelfMe(value);
        }
      })
      .catch(() => {});
    const { start, end } = dayBounds(new Date());
    void listConversations({ from: new Date(start), to: new Date(end) })
      .then((result) => {
        if (!alive.current || !result.ok) return;
        const recent = result.data.conversations.find((c) =>
          c.preview?.startsWith('My personal activity — '),
        );
        if (recent?.preview) setActivity(recent.preview.replace('My personal activity — ', ''));
      })
      .catch(() => {});
    return () => {
      alive.current = false;
      version.current += 1;
    };
  }, [refresh]);
  const results = useMemo(
    () =>
      panel !== 'search'
        ? []
        : contacts.filter((value) =>
            [
              name(value),
              value.company,
              value.title,
              value.city,
              value.email,
              value.phone,
              ...(value.emails ?? []),
              ...(value.phoneNumbers ?? []),
            ]
              .filter(Boolean)
              .join(' ')
              .toLocaleLowerCase()
              .includes(query.trim().toLocaleLowerCase()),
          ),
    [contacts, query, panel],
  );
  async function write(kind: 'note' | 'pin') {
    if (!person || writing.current || (kind === 'note' && !draft.trim())) return;
    writing.current = true;
    setBusy(true);
    try {
      const result =
        kind === 'note'
          ? await captureContactNote(person.id, draft.trim())
          : await addFavorite(person.id);
      if (!alive.current) return;
      if (!result.ok) {
        setMessage('Save was not confirmed. Your draft remains; check the card before retrying.');
        return;
      }
      if (kind === 'note') {
        setDraft('');
        setMessage('Note saved to this contact.');
      } else {
        await refresh();
        setMessage('Added to your circle.');
      }
    } catch {
      if (alive.current)
        setMessage('Save was not confirmed. Your draft remains; check the card before retrying.');
    } finally {
      writing.current = false;
      if (alive.current) setBusy(false);
    }
  }
  const choose = useCallback((value: MedhaContactFull) => {
    setPerson(value);
    setPanel(null);
    setFocusId(undefined);
    setProfile({ id: value.id, name: name(value), contact: value });
  }, []);
  const contactOptions = useMemo(
    () =>
      contacts.map((value) => ({
        id: value.id,
        name: name(value),
        detail: [
          value.company,
          value.email || value.emails?.[0],
          value.phone || value.phoneNumbers?.[0],
        ]
          .filter(Boolean)
          .join(' · '),
      })),
    [contacts],
  );
  const memoQueries = useMemoQueries(memos, setMemos, contactOptions);
  const openPerson = useCallback(
    (id: string) => {
      if (id === 'self') {
        setFocusId(undefined);
        setProfile({
          id: 'self',
          name: selfMe?.displayName || savedSpace.space.profile.displayName || 'You',
          notes: selfMe?.bio || savedSpace.space.profile.bio,
        });
      } else {
        const value = contacts.find((contact) => contact.id === id);
        if (value) choose(value);
      }
    },
    [contacts, choose, selfMe, savedSpace.space.profile],
  );
  async function saveNewContact(draft: NewContactDraft) {
    if (contactSaveLock.current) return;
    contactSaveLock.current = true;
    setContactSaving(true);
    setContactError('');
    try {
      const id = await createReviewedContact(draft);
      // The server may match an existing person; do not replace their recorded name with the draft.
      const detail = await getContact(id).catch(() => null);
      if (detail?.ok)
        setContacts((old) => [detail.data.contact, ...old.filter((c) => c.id !== id)]);
      else void refresh();
      if (memberCategory)
        setMemberDraft((old) => [
          ...new Set([...(old ?? circles.memberships[memberCategory] ?? []), id]),
        ]);
      setNewContact(false);
      setMessage('Contact saved.');
    } catch (e) {
      setContactError(e instanceof Error ? e.message : 'Could not save this contact.');
    } finally {
      contactSaveLock.current = false;
      setContactSaving(false);
    }
  }
  async function confirmMemo(memo: MemoEntry, request: ReviewRequest): Promise<string> {
    let destination = 'Amber response';
    let taskResult = '';
    const savedMemo = memos.find((entry) => entry.id === memo.id) ?? memo;
    const audioSaved = !!savedMemo.cloud?.audioSaved;
    const requestId = await memoActionId(memo.id, request);
    if (request.kind === 'contact') {
      const contactId = request.newPerson
        ? await createReviewedContact({
            fullName: request.personName || '',
            email: request.personEmail,
            phone: request.personPhone,
          })
        : request.contactId;
      const note = request.place?.trim()
        ? `${request.text}\nPlace context: ${request.place.trim()}`
        : request.text;
      const result = await captureContactNote(contactId, note, requestId);
      if (!result.ok) throw new Error('unconfirmed');
      setCalendarRevision((value) => value + 1);
      void refresh();
      destination = `Saved to ${contacts.find((value) => value.id === contactId)?.name || request.personName || 'person'}`;
    } else if (request.kind === 'calendar') {
      const result = request.planId
        ? await callMedhaId<{ ok: boolean; destination: string; accountEmail?: string }>({
            path: `/v1/me/memo-plans/${encodeURIComponent(request.planId)}`,
            method: 'PATCH',
            requireAuth: true,
            retries: 0,
            timeoutMs: 65000,
            body: {
              version: request.planVersion,
              title: request.title,
              description: request.text.slice(0, 2000),
              place: request.place || '',
              startsAt: request.startsAt.toISOString(),
              endsAt: request.endsAt.toISOString(),
            },
          })
        : await createGoogleMemoEvent(request, requestId);
      if (!result.ok)
        throw Object.assign(new Error(result.message || 'Plan update was not confirmed.'), {
          name: 'CalendarWriteError',
        });
      if (!result.data.ok || !['google', 'amber'].includes(result.data.destination))
        throw new Error('unconfirmed');
      const eventId = request.planId || ('id' in result.data ? String(result.data.id) : '');
      if (!eventId || !memo.cloud?.conversationId)
        throw new Error('The plan was saved, but its memo link needs a retry.');
      const linked = await callMedhaId<{ ok: boolean }>({
        path: `/v1/me/memo-plans/${encodeURIComponent(eventId)}/memos`,
        method: 'POST',
        requireAuth: true,
        retries: 0,
        body: {
          requestId,
          conversationId: memo.cloud.conversationId,
          text: memo.text.slice(0, 4000),
          contactIds: request.participantIds || [],
        },
      });
      if (!linked.ok || !linked.data.ok)
        throw Object.assign(
          new Error(
            'The plan was saved. Its memo and people link was not confirmed; retry this unchanged action safely.',
          ),
          { name: 'CalendarWriteError' },
        );
      destination =
        result.data.destination === 'google'
          ? `Saved to Google Calendar${result.data.accountEmail ? ` · ${result.data.accountEmail}` : ''}`
          : 'Updated in Plans';
      setCalendarRevision((value) => value + 1);
    } else {
      taskResult = await runCaptureTask(request.text);
      destination = 'Amber response';
      setCalendarRevision((value) => value + 1);
    }
    const resultMessage =
      request.kind === 'task'
        ? taskResult
        : `${destination}.${memo.media ? (audioSaved ? ' Recording uploaded.' : ' Audio remains saved on this device; the transcript was saved.') : ''}`;
    setMemos((previous) =>
      previous.map((entry) =>
        entry.id === memo.id
          ? {
              ...entry,
              text: memo.text,
              destination,
              reviews: [
                ...(entry.reviews ?? (entry.review ? [entry.review] : [])),
                {
                  ...request,
                  startsAt: request.startsAt.toISOString(),
                  endsAt: request.endsAt.toISOString(),
                  confirmedAt: new Date().toISOString(),
                  result: resultMessage,
                },
              ],
              review: {
                ...request,
                startsAt: request.startsAt.toISOString(),
                endsAt: request.endsAt.toISOString(),
                confirmedAt: new Date().toISOString(),
                result: resultMessage,
              },
            }
          : entry,
      ),
    );
    return resultMessage;
  }
  function recordFor(context: MemoContext) {
    const begin = () => {
      setProfile(null);
      setReviewMemo(null);
      setMemoContext(context);
      setCaptureMode('voice');
      setRecording(true);
    };
    if (historyOpen) {
      afterHistoryDismiss.current = begin;
      setHistoryOpen(false);
    } else begin();
  }
  function renderMemoDiscussion(entry: MemoEntry) {
    const latest = memos.find((m) => m.id === entry.id) ?? entry;
    return (
      <MemoConversation
        key={entry.id}
        entry={latest}
        state={memoQueries.queries[entry.id] ?? latest.query}
        running={memoQueries.isRunning(entry.id)}
        contacts={contactOptions}
        onSaveTranscript={
          memos.some((m) => m.id === entry.id)
            ? async (text) => {
                if (text === latest.text) return;
                const updated: MemoEntry = {
                  ...latest,
                  text,
                  query: { status: 'queued', turns: [] },
                };
                setMemos((old) => old.map((m) => (m.id === entry.id ? updated : m)));
                await syncMemo(updated);
              }
            : undefined
        }
        onAsk={memoQueries.ask}
        renderChoice={(focus) => (
          <RequestReview
            key={`${entry.id}-${focus.kind}-${focus.index}`}
            visible
            embedded
            inline
            autoPrepare={false}
            prepared={focusedMemoSorting(
              latest,
              (memoQueries.queries[entry.id] ?? latest.query)?.sorting,
              focus,
            )}
            initialText={latest.text}
            contacts={contactOptions}
            receipts={(latest.reviews ?? (latest.review ? [latest.review] : []))
              .filter(
                (r) =>
                  r.kind === focus.kind &&
                  (r.kind === 'contact' ? r.personName === focus.label : r.title === focus.label),
              )
              .map((r) => ({ ...r, text: r.text ?? latest.text }))}
            onClose={() => {}}
            onConfirm={(request) => confirmMemo(latest, request)}
          />
        )}
        onAddMemo={recordFor}
        onContact={(id) => {
          const contact = contacts.find((c) => c.id === id);
          if (contact) {
            setRecording(false);
            setReviewMemo(null);
            if (historyOpen) {
              afterHistoryDismiss.current = () => choose(contact);
              setHistoryOpen(false);
            } else choose(contact);
          }
        }}
      />
    );
  }
  return (
    <SafeAreaView style={s.screen}>
      <View style={s.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Your shareable Amber card and integrations"
          onPress={() => setAccountCard(true)}
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            minHeight: 44,
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <Image source={require('../assets/amber-logo.png')} style={{ width: 37, height: 40 }} />
          <Text style={s.brand}>amber</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Voice memo history"
          onPress={() => setHistoryOpen(true)}
          style={({ pressed }) => [s.profileButton, { opacity: pressed ? 0.6 : 1 }]}
        >
          <History color={cl.ink} size={23} />
        </Pressable>
      </View>
      <View style={s.search}>
        <CommunitySearch
          web={tab === 'people' ? web : plansWeb}
          onWebChange={process.env.EXPO_PUBLIC_WEB_SEARCH_ENABLED !== 'false' ? tab === 'people' ? setWeb : setPlansWeb : undefined}
          calendar={tab === 'calendar'}
          value={tab === 'people' ? query : journalQuery}
          onChange={tab === 'people' ? setQuery : setJournalQuery}
          onSubmit={() => {
            const value = (tab === 'people' ? query : journalQuery).trim();
            const request = webSearchRequest(tab, tab === 'people' ? web : plansWeb, value);
            if (request) setSearch(request);
          }}
        />
      </View>
      {!!journalError && (
        <Text accessibilityRole="alert" style={{ color: cl.ink, paddingHorizontal: 24 }}>
          {journalError}
        </Text>
      )}
      <View style={{ flex: 1, display: tab === 'people' ? 'flex' : 'none' }}>
        {!message.endsWith('saved contacts') && (
          <Text style={[s.caption, s.search]} accessibilityLiveRegion="polite">
            {message}
          </Text>
        )}

        {!!rankError && (
          <Pressable accessibilityRole="button" onPress={() => void refresh()} style={s.search}>
            <Text style={s.caption}>{rankError}</Text>
          </Pressable>
        )}
        <NetworkCanvas
          people={networkPeople}
          activeNetwork="All"
          query={web ? '' : query}
          focusId={focusId}
          onOpen={openPerson}
        />
      </View>
      {calendarMounted && (
        <View style={{ flex: 1, display: tab === 'calendar' ? 'flex' : 'none' }}>
          <CalendarActivityFeed
            onOpenPerson={(id) => setProfile({ id, name: 'Person' })}
            sample={false}
            entries={memos}
            query={plansWeb ? '' : journalQuery}
            onAddMemo={recordFor}
            onReview={setReviewMemo}
            onSync={syncMemo}
            revision={calendarRevision}
            renderDiscussion={renderMemoDiscussion}
          />
        </View>
      )}
      <View style={s.footer}>
        <RelationshipDock
          tab={tab}
          onTab={changeTab}
          onSpeak={() => {
            setMemoContext(undefined);
            setCaptureMode('voice');
            setRecording(true);
          }}
          onVoice={() => {
            setMemoContext(undefined);
            setCaptureMode('voice');
            setRecording(true);
          }}
        />
      </View>
      <Modal
        visible={panel !== null}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (!busy) setPanel(null);
        }}
      >
        <SafeAreaView style={s.backdrop}>
          <View style={s.sheet}>
            <View style={s.header}>
              <Text style={s.sheetTitle}>
                {panel === 'search'
                  ? 'Find your people'
                  : person
                    ? name(person)
                    : 'Review your note'}
              </Text>
              <Pressable
                disabled={busy}
                accessibilityRole="button"
                onPress={() => setPanel(null)}
                style={s.button}
              >
                <Text>Close</Text>
              </Pressable>
            </View>
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={s.content}>
              {panel === 'search' ? (
                <>
                  <TextInput
                    value={query}
                    onChangeText={setQuery}
                    placeholder="Name, company, phone, or email"
                    accessibilityLabel="Search saved contacts"
                    style={s.input}
                  />
                  <Text style={s.caption}>
                    Searches saved contact details. Web research is not connected here.
                  </Text>
                  {results.map((value) => (
                    <Pressable
                      key={value.id}
                      accessibilityRole="button"
                      onPress={() => {
                        setPerson(value);
                        setPanel('card');
                      }}
                      style={s.row}
                    >
                      <Text style={s.body}>{name(value)}</Text>
                      <Text style={s.caption}>
                        {value.company ||
                          value.email ||
                          value.emails?.[0] ||
                          value.source ||
                          'Saved contact'}
                      </Text>
                    </Pressable>
                  ))}
                  {!results.length && <Text style={s.body}>No matching contacts.</Text>}
                </>
              ) : (
                <>
                  <Text style={s.body}>
                    {person
                      ? [
                          person.company,
                          person.email || person.emails?.[0],
                          person.phone || person.phoneNumbers?.[0],
                        ]
                          .filter(Boolean)
                          .join(' · ')
                      : 'Choose the person this note belongs to.'}
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    disabled={busy}
                    onPress={() => {
                      setQuery('');
                      setPanel('search');
                    }}
                    style={s.row}
                  >
                    <Text style={s.body}>
                      {person ? 'Choose a different contact' : 'Choose a contact'}
                    </Text>
                  </Pressable>
                  <TextInput
                    value={draft}
                    onChangeText={setDraft}
                    editable={!busy}
                    multiline
                    maxLength={4000}
                    placeholder="What would you like to remember?"
                    accessibilityLabel="Review contact note"
                    style={[s.input, { minHeight: 120 }]}
                  />
                  <Text style={s.caption}>
                    Review the words and recipient. Saving also runs Amber’s existing structured
                    fact extraction.
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    disabled={busy || !person || !draft.trim()}
                    onPress={() => void write('note')}
                    style={[
                      s.button,
                      s.dark,
                      (busy || !person || !draft.trim()) && { opacity: 0.4 },
                    ]}
                  >
                    <Text style={s.light}>{busy ? 'Working…' : 'Save note to this card'}</Text>
                  </Pressable>
                  {person && !favorites.some((value) => value.id === person.id) && (
                    <Pressable
                      disabled={busy}
                      accessibilityRole="button"
                      onPress={() => void write('pin')}
                      style={s.row}
                    >
                      <Text style={s.body}>Add to my circle</Text>
                    </Pressable>
                  )}
                  <Text accessibilityLiveRegion="polite" style={s.body}>
                    {message}
                  </Text>
                </>
              )}
            </ScrollView>
          </View>
        </SafeAreaView>
      </Modal>
      {!!savedSpace.error && (
        <Text accessibilityRole="alert" style={s.caption}>
          {savedSpace.error}
        </Text>
      )}
      {memberCategory && !newContact && (
        <CircleMembersSheet
          key={memberCategory}
          category={memberCategory}
          people={contactOptions}
          members={memberDraft ?? circles.memberships[memberCategory] ?? []}
          onClose={() => setMemberCategory(null)}
          onNew={(ids) => {
            setMemberDraft(ids);
            setContactError('');
            setNewContact(true);
          }}
          onSave={(ids) => circles.save({ ...circles.memberships, [memberCategory]: ids })}
        />
      )}
      {newContact && (
        <NewContactModal
          visible
          spokenName=""
          manual
          saving={contactSaving}
          error={contactError}
          onCancel={() => setNewContact(false)}
          onSave={(draft) => void saveNewContact(draft)}
        />
      )}
      {editProfile && (
        <AmberProfileEditor
          space={{ ...savedSpace.space, memberships: circles.memberships }}
          people={networkPeople}
          sample={false}
          onClose={() => setEditProfile(false)}
          onSave={async (patch) => {
            if (patch.memberships) await circles.save(patch.memberships);
            const { memberships: _, ...local } = patch;
            await savedSpace.save(local);
            if (local.profile)
              setSelfMe((old) =>
                old
                  ? {
                      ...old,
                      displayName: local.profile!.displayName,
                      bio: local.profile!.bio,
                      currentCity: local.profile!.city,
                    }
                  : old,
              );
          }}
          onAccountSettings={() => {
            setEditProfile(false);
            router.push('/(gated)/settings');
          }}
        />
      )}
      {activityOpen && (
        <PersonalActivity
          latest={activity}
          onClose={() => setActivityOpen(false)}
          onSaved={(text) => {
            setActivity(text);
            setCalendarRevision((v) => v + 1);
            void refresh(text);
          }}
        />
      )}
      {accountCard && (
        <AmberAccountCard
          importIntent={importIntent}
          initialMe={selfMe}
          fallbackName={savedSpace.space.profile.displayName || 'You'}
          onClose={() => {setAccountCard(false);setImportIntent(undefined);}}
          onLoaded={setSelfMe}
          onCalendars={() => setAccountCalendars(true)}
        />
      )}
      <CalendarSyncSheet
        googleOnly
        visible={accountCalendars}
        onClose={() => setAccountCalendars(false)}
        onConnected={() => setCalendarRevision((v) => v + 1)}
      />
      {profile && (
        <NetworkProfile
          key={profile.id}
          seed={profile}
          onClose={() => setProfile(null)}
          initialMe={selfMe}
          onEdit={profile.id === 'self' ? () => setEditProfile(true) : undefined}
          onNetwork={(id) => {
            setProfile(null);
            setQuery('');
            setTab('people');
            setFocusId(id);
          }}
          onRecordMemo={
            profile.id !== 'self'
              ? () => recordFor({ kind: 'person', id: profile.id, label: profile.name })
              : undefined
          }
          onAddNote={
            profile.id !== 'self'
              ? () => {
                  setProfile(null);
                  setPanel('card');
                }
              : undefined
          }
        />
      )}
      <MemoHistory
        visible={historyOpen}
        entries={memos}
        onDismiss={() => {
          const action = afterHistoryDismiss.current;
          afterHistoryDismiss.current = null;
          action?.();
        }}
        onClose={() => setHistoryOpen(false)}
        onReview={(entry) => {
          afterHistoryDismiss.current = () => setReviewMemo(entry);
          setHistoryOpen(false);
        }}
        onSync={syncMemo}
        renderDiscussion={renderMemoDiscussion}
      />
      {search && (
        <WebDiscoverySheet
          query={search.query}
          scope={search.scope}
          location={selfMe?.currentCity || savedSpace.space.profile.city || ''}
          onPlanSaved={() => setCalendarRevision(v => v + 1)}
          onClose={() => setSearch(null)}
          onChoose={(id) => {
            const contact = contacts.find((c) => c.id === id);
            if (contact) {
              setSearch(null);
              choose(contact);
            }
          }}
        />
      )}
      {(recording || reviewMemo) && (
        <MemoComposer
          key={
            reviewMemo?.id ??
            `${memoContext?.kind}:${memoContext?.id ?? memoContext?.label ?? 'general'}`
          }
          context={reviewMemo?.context ?? memoContext}
          sortingFor={(id) =>
            memoQueries.queries[id]?.sorting ?? memos.find((m) => m.id === id)?.query?.sorting
          }
          initialEntry={reviewMemo}
          renderDiscussion={renderMemoDiscussion}
          initialMode={reviewMemo ? 'capture' : captureMode}
          contacts={contactOptions}
          onClose={() => {
            const latest = memos.find((m) => m.id === (reviewMemo?.id ?? capturedMemoId.current));
            if (latest?.cloud) void syncMemo(latest);
            capturedMemoId.current = null;
            setRecording(false);
            setReviewMemo(null);
            setMemoContext(undefined);
          }}
          onPreserve={preserveMemo}
          onCaptured={(entry) => {
            capturedMemoId.current = entry.id;
            if (entry.media && entry.text.trim())
              entry = { ...entry, query: { status: 'queued', turns: [] } };
            setMemos((previous) => [entry, ...previous.filter((memo) => memo.id !== entry.id)]);
            setCalendarMounted(true);
            void syncMemo(entry).then(() => setCalendarRevision((value) => value + 1));
          }}
          onUpdated={(entry) =>
            setMemos((previous) =>
              previous.map((old) =>
                old.id === entry.id
                  ? {
                      ...old,
                      text: entry.text,
                      ...(old.text !== entry.text && entry.media && entry.text.trim()
                        ? { query: { status: 'queued' as const, turns: [] } }
                        : {}),
                    }
                  : old,
              ),
            )
          }
          onConfirm={confirmMemo}
        />
      )}
    </SafeAreaView>
  );
}
const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: cl.ground },
  search: { paddingHorizontal: 16 },
  footer: { paddingHorizontal: 16, paddingTop: 6 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    height: 48,
  },
  brand: { fontFamily: 'Newsreader_500Medium', fontSize: 32, color: cl.ink },
  title: { fontFamily: 'Newsreader_400Regular', fontSize: 32, color: cl.ink, marginVertical: 12 },
  eyebrow: { fontFamily: 'Outfit_500Medium', fontSize: 10, letterSpacing: 2, color: cl.goldDeep },
  body: { fontFamily: 'Outfit_400Regular', fontSize: 15, lineHeight: 23, color: cl.ink70 },
  caption: {
    fontFamily: 'Outfit_400Regular',
    fontSize: 11,
    lineHeight: 17,
    color: cl.ink62,
    paddingVertical: 10,
  },
  graph: { flex: 1, minHeight: 240 },
  node: {
    position: 'absolute',
    width: 64,
    height: 64,
    borderRadius: 32,
    borderWidth: 1,
    borderColor: cl.warmHairline,
    backgroundColor: cl.groundGold,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 4,
  },
  name: { fontFamily: 'Outfit_500Medium', fontSize: 12, color: cl.ink, textAlign: 'center' },
  dock: { flexDirection: 'row', padding: 7, gap: 8, borderRadius: 36, backgroundColor: cl.card },
  action: {
    flex: 1,
    minHeight: 62,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 30,
  },
  actionText: { fontFamily: 'Outfit_500Medium', fontSize: 18, color: cl.ink },
  dark: { backgroundColor: cl.ink },
  light: { color: cl.card },
  profileButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  button: {
    minHeight: 48,
    padding: 16,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: cl.ink32 },
  sheet: {
    maxHeight: '90%',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 24,
    backgroundColor: cl.card,
  },
  sheetTitle: { flex: 1, fontFamily: 'Newsreader_500Medium', fontSize: 25, color: cl.ink },
  content: { paddingBottom: 28, gap: 14 },
  input: {
    padding: 16,
    borderWidth: 1,
    borderColor: cl.cardHairline,
    borderRadius: 18,
    color: cl.ink,
    fontFamily: 'Outfit_400Regular',
    fontSize: 16,
  },
  row: {
    minHeight: 48,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: cl.cardHairline,
  },
});
