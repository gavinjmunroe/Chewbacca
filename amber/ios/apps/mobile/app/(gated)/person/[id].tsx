import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  Linking,
  Pressable,
  ScrollView,
  TextInput,
  View,
  type ViewStyle,
} from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Image } from 'expo-image';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Svg, { Circle, Polyline } from 'react-native-svg';
import {
  ArrowLeft,
  Check,
  ExternalLink,
  Github,
  Globe,
  Linkedin,
  Mail,
  MessageCircle,
  Trash2,
  Pencil,
  BellOff,
  Bell,
  Share2,
  TrendingDown,
  TrendingUp,
  Twitter,
  X,
} from 'lucide-react-native';
import { Screen } from '../../../components/Screen';
import { Text } from '../../../components/Text';
import { GlassCard } from '../../../components/GlassCard';
import { ConnectButton } from '../../../components/ConnectButton';
import { EditContactModal } from '../../../components/EditContactModal';
import { HealthRadar } from '../../../components/HealthRadar';
import {
  resolveContactAmberUser,
  sendConnectRequest,
  type ConnectSearchUser,
} from '../../../lib/connect';
import {
  getCachedPerson,
  setCachedPerson,
  normalizeScore,
  type PersonLink,
  type RankComponents,
  type RankedPerson,
} from '../../../lib/peoplerank';
import {
  callMedhaId,
  errorCopy,
  medhaIdErrorCopy,
  unwrapOrThrow,
} from '../../../lib/medhaId';
import {
  deleteContact,
  getContact,
  getContactFacts,
  type ContactFact,
  updateContact,
  type MedhaContactFull,
} from '../../../lib/contacts';
import {
  enrichContacts,
  resolveEnrichment,
  type ContactEnrichment,
  type EnrichmentCandidate,
  type ResolveChoice,
} from '../../../lib/enrichment';
import { getCirclesForContact, type ContactCircle } from '../../../lib/circles';
import { useExperiences } from '../../../lib/experiences';
import { ShareSheet } from '../../../components/ShareSheet';
import { RecordingWaveform, barsForWidth } from '../../../components/RecordingWaveform';
import { useVoiceDictation } from '../../../lib/useVoiceDictation';
import { captureContactNote } from '../../../lib/contactNotes';
import { listFavorites } from '../../../lib/favorites';
import { NAMED_COLORS } from '../../../lib/circleColors';
import { toast } from '../../../lib/toast';
import { fonts, radius, spacing, typography } from '../../../lib/tokens';
import { LIGHT, TREND_DOWN, TREND_UP } from '../../../lib/theme';
import { HAIRLINE, cl } from '../../../lib/classical';
import { CCard, CListRow } from '../../../components/classical';
import {
  getNotificationPrefs,
  setPersonMuted,
  type NotificationPrefs,
} from '../../../lib/notificationSettings';
import { EditableField } from '../../../components/EditableField';

const COMPONENT_LABELS: { key: keyof RankComponents; label: string }[] = [
  { key: 'proximity', label: 'Proximity' },
  { key: 'centrality', label: 'Centrality' },
  { key: 'recency', label: 'Recency' },
  { key: 'relevance', label: 'Relevance' },
];

// ---------------------------------------------------------------------------
// Enrichment types. Mirrors GET /v1/me/people/:contactId/enrich's result shape
// (medha-id src/enrichment/enrich-person.js). Every field is optional so a
// flag-off ("disabled"/"no_key") or partial response degrades, never crashes.
// ---------------------------------------------------------------------------
type EnrichSource = { title?: string; url?: string; date?: string };

type EnrichSignals = {
  recency?: number;
  momentum?: number;
  social_links?: string[];
  top_sources?: EnrichSource[];
  queried?: boolean;
};

type EnrichResult = {
  status: string;
  contactId?: string;
  name?: string;
  whats_new?: string | null;
  sources?: EnrichSource[];
  signals?: EnrichSignals;
  mutuals?: { id?: string; name?: string }[];
  embedded?: boolean;
  enriched_at?: string;
};

type HistoryPoint = { t: number; score: number };
type RecentPerson = {
  id: string;
  name: string;
  title?: string;
  company?: string;
  avatarUrl?: string;
};

// ---------------------------------------------------------------------------
// On-device persistence. The in-memory peoplerank cache is lost on cold start,
// so we snapshot each opened person, track a local score history for the trend
// sparkline, keep per-contact private notes, and a recently-viewed list that
// powers the bottom carousel. All keyed by contactId, all best-effort.
// ---------------------------------------------------------------------------
const snapKey = (id: string) => `person:snapshot:${id}`;
const histKey = (id: string) => `person:history:${id}`;
const RECENTS_KEY = 'person:recents';
const HISTORY_CAP = 30;
const RECENTS_CAP = 12;

async function readSnapshot(id: string): Promise<RankedPerson | null> {
  try {
    const raw = await AsyncStorage.getItem(snapKey(id));
    return raw ? (JSON.parse(raw) as RankedPerson) : null;
  } catch {
    return null;
  }
}

async function writeSnapshot(person: RankedPerson): Promise<void> {
  try {
    await AsyncStorage.setItem(snapKey(person.id), JSON.stringify(person));
  } catch {
    /* non-fatal: snapshot is a nicety, not a requirement */
  }
}

function sameDay(a: number, b: number): boolean {
  const da = new Date(a);
  const db = new Date(b);
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  );
}

async function appendHistory(id: string, score: number, now: number): Promise<HistoryPoint[]> {
  try {
    const raw = await AsyncStorage.getItem(histKey(id));
    const points: HistoryPoint[] = raw ? (JSON.parse(raw) as HistoryPoint[]) : [];
    const last = points[points.length - 1];
    // One point per calendar day: refresh today's value rather than spamming.
    if (last && sameDay(last.t, now)) {
      last.score = score;
    } else {
      points.push({ t: now, score });
    }
    const trimmed = points.slice(-HISTORY_CAP);
    await AsyncStorage.setItem(histKey(id), JSON.stringify(trimmed));
    return trimmed;
  } catch {
    return [];
  }
}

async function addRecent(person: RecentPerson): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(RECENTS_KEY);
    const list: RecentPerson[] = raw ? (JSON.parse(raw) as RecentPerson[]) : [];
    const next = [person, ...list.filter((p) => p.id !== person.id)].slice(0, RECENTS_CAP);
    await AsyncStorage.setItem(RECENTS_KEY, JSON.stringify(next));
  } catch {
    /* non-fatal */
  }
}

async function readRecents(excludeId: string): Promise<RecentPerson[]> {
  try {
    const raw = await AsyncStorage.getItem(RECENTS_KEY);
    const list: RecentPerson[] = raw ? (JSON.parse(raw) as RecentPerson[]) : [];
    return list.filter((p) => p.id !== excludeId);
  } catch {
    return [];
  }
}

async function fetchEnrichment(id: string): Promise<EnrichResult> {
  const res = await callMedhaId<EnrichResult>({
    path: `/v1/me/people/${encodeURIComponent(id)}/enrich`,
    method: 'GET',
    requireAuth: true,
    timeoutMs: 25_000,
  });
  if (!res.ok) {
    // 404 means the contact is not in the caller's book yet: soft, no live data.
    if (res.status === 404) return { status: 'contact_not_found' };
    // Anything else is a real failure: surface it inside the enrichment card.
    throw new Error(res.error || 'enrich_failed');
  }
  return res.data ?? { status: 'error' };
}

// forceEnrichment USED TO BE HERE. It was the refresh button on the
// EnrichmentCard that this file no longer renders. Its route is untouched and
// still called by the enrichment surface above.

function mapContactToRankedPerson(contact: MedhaContactFull): RankedPerson {
  const nameParts = [contact.firstName, contact.lastName].filter((s): s is string => !!s);
  const name = contact.name ?? (nameParts.length > 0 ? nameParts.join(' ') : 'Unknown');
  return {
    id: contact.id,
    name,
    company: contact.company,
    title: contact.title,
    score: 0,
    links: [],
    profile: {
      email: contact.email ?? contact.emails?.[0],
      phone: contact.phone ?? contact.phoneNumbers?.[0],
      source: contact.source,
    },
  };
}

// THE CARDS NO LONGER SPRING IN ONE BY ONE.
//
// Six cards on this screen mount CONDITIONALLY, each as its own query lands, and each
// was wrapped in FadeInUp — a translate-and-fade that runs on mount. So for the first
// couple of seconds the page rearranged itself: a card springs in, everything below it
// is shoved down, the next query lands, it happens again. All of it on top of the
// navigation push still sliding the screen in from the right.
//
// Entrance animation is for content that is THERE when the screen opens. Applied to
// content that arrives late it does not soften the shift, it draws a line under it.
// The cards now simply appear when their data does, which is a smaller movement than
// appearing AND traveling.
//
// A local passthrough rather than deleting ~20 wrappers: the call sites keep their
// index/step props, the diff stays readable, and putting the animation back is one
// import line. lib/motion's FadeInUp is untouched and still used elsewhere.
function FadeInUp({ children }: { children: React.ReactNode; index?: number; step?: number }) {
  return <>{children}</>;
}

export default function PersonScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();
  const cached = id ? getCachedPerson(id) : undefined;

  // Tier 1: in-memory chat SSE cache (has full rank context).
  // Tier 2: on-device AsyncStorage snapshot (rank context from a prior session).
  const personQuery = useQuery({
    queryKey: ['person', id],
    enabled: !!id,
    initialData: cached,
    queryFn: () => readSnapshot(id as string),
    staleTime: Infinity,
    gcTime: 1000 * 60 * 60 * 24,
  });
  const snapshot = personQuery.data ?? undefined;

  // Tier 3: live server fetch — only fires when cache + snapshot are both empty
  // (e.g. opening a contact directly from the contacts list, which has no chat
  // context). Disabled immediately when the cache has the person so we never
  // fire an extra network call from the warm path.
  const contactLiveQuery = useQuery({
    queryKey: ['contactLive', id],
    enabled: !!id && !cached && !personQuery.isLoading && !personQuery.data,
    queryFn: () => getContact(id as string),
    staleTime: 1000 * 60 * 5,
    retry: 1,
  });
  const livePerson: RankedPerson | undefined = (() => {
    const res = contactLiveQuery.data;
    if (!res || !res.ok) return undefined;
    return mapContactToRankedPerson(res.data.contact);
  })();

  // Explicit priority: chat cache (richest, must always win) > snapshot > live.
  // cached is also folded into personQuery as initialData, but we resolve it
  // directly here so the ordering is unambiguous even if the query cache is
  // mutated by another caller.
  const person = cached ?? snapshot ?? livePerson;

  // Write-through: persist the snapshot and register the recently-viewed entry.
  useEffect(() => {
    if (!cached) return;
    queryClient.setQueryData(['person', id], cached);
    writeSnapshot(cached);
  }, [cached, id, queryClient]);

  const personId = person?.id;

  if (!person || !personId) {
    // Show skeleton while any tier is actively fetching.
    // contactLiveQuery.isLoading is true even when disabled (never fetched);
    // use isFetching instead so a disabled query never triggers the skeleton.
    if (personQuery.isLoading || contactLiveQuery.isFetching) {
      return (
        <Screen padded={false} background={LIGHT.canvas}>
          <Stack.Screen options={{ gestureEnabled: true }} />
          <ScreenHeader onBack={() => router.back()} />
          <View style={{ paddingHorizontal: spacing.lg, gap: spacing.md }}>
            <DCard>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.base }}>
                <Block w={64} h={64} radius={radius.full} />
                <View style={{ flex: 1, gap: spacing.sm }}>
                  <Block w="70%" h={20} />
                  <Block w="45%" h={14} />
                </View>
              </View>
            </DCard>
            <DCard>
              <View style={{ gap: spacing.sm }}>
                <Block w="100%" h={14} />
                <Block w="90%" h={14} />
                <Block w="60%" h={14} />
              </View>
            </DCard>
          </View>
        </Screen>
      );
    }
    return (
      <Screen padded={false} background={LIGHT.canvas}>
        <Stack.Screen options={{ gestureEnabled: true }} />
        <ScreenHeader onBack={() => router.back()} />
        <View
          style={{
            flex: 1,
            alignItems: 'center',
            justifyContent: 'center',
            paddingHorizontal: spacing.xl,
            gap: spacing.base,
          }}
        >
          <Text variant="displaySm" centered style={{ color: LIGHT.textPrimary }}>
            We lost this person.
          </Text>
          <Text variant="bodyMd" centered style={{ color: LIGHT.textSecondary }}>
            Open them from an Amber result and the full card will load here.
          </Text>
          <Pressable
            onPress={() => router.back()}
            accessibilityRole="button"
            accessibilityLabel="Back to Amber"
            style={({ pressed }) => ({ marginTop: spacing.xs, opacity: pressed ? 0.6 : 1 })}
          >
            <View
              style={{
                paddingHorizontal: spacing.lg,
                paddingVertical: spacing.sm,
                borderRadius: radius.full,
                borderWidth: 1,
                borderColor: LIGHT.hairline,
                backgroundColor: LIGHT.surface,
              }}
            >
              <Text variant="buttonSm" style={{ color: LIGHT.accentText }}>
                Back to Amber
              </Text>
            </View>
          </Pressable>
        </View>
      </Screen>
    );
  }

  return <PersonDetail person={person} personId={personId} onBack={() => router.back()} />;
}

function PersonDetail({ person, personId, onBack }: { person: RankedPerson; personId: string; onBack: () => void }) {
  const router = useRouter();
  const [history, setHistory] = useState<HistoryPoint[]>([]);
  const [recents, setRecents] = useState<RecentPerson[]>([]);
  const [displayPerson, setDisplayPerson] = useState<RankedPerson>(person);
  const [editOpen, setEditOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const queryClient = useQueryClient();


  // TWO-STEP AND NAMED. The cascade is genuinely irreversible — facts, notes,
  // experiences, the embedding and the Pinecone vector all go — so the alert says
  // what will be lost and puts the person's name in it. An unnamed "Are you sure?"
  // on a screen you reached by tapping a row is how people delete the wrong person.
  const confirmDeleteContact = useCallback(() => {
    const label = person?.name || 'this contact';
    Alert.alert(
      `Delete ${label}?`,
      'This removes them and everything Amber remembers about them — notes, facts, experiences and shared items. It cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            setDeleting(true);
            void deleteContact(String(personId))
              .then((res) => {
                if (!res.ok) {
                  setDeleting(false);
                  toast.error(medhaIdErrorCopy(res, 'Amber'));
                  return;
                }
                // Leave FIRST, then invalidate. Invalidating while this screen is
                // still mounted refetches a contact the server has just deleted,
                // which paints a 404 error state for the length of the pop.
                onBack();
                void queryClient.invalidateQueries({ queryKey: ['contacts'] });
                void queryClient.invalidateQueries({ queryKey: ['person', personId] });
                void queryClient.invalidateQueries({ queryKey: ['contact', personId] });
                void queryClient.invalidateQueries({ queryKey: ['contactLive', personId] });
                toast.success(
                  `Deleted ${label}`,
                  res.data.rows > 1 ? `${res.data.rows} records removed` : undefined,
                );
              })
              .catch(() => {
                setDeleting(false);
                toast.error('Could not delete that contact.');
              });
          },
        },
      ],
    );
  }, [person?.name, personId, onBack, queryClient]);


  // Reflect a saved contact edit immediately, and push it into BOTH the
  // in-memory cache and the on-device snapshot so revisiting this contact
  // (a fresh mount) shows the edit. The cache must be updated too, not just
  // the snapshot: PersonScreen resolves `cached ?? snapshot ?? live`, and
  // `cached` (personCache, populated by ingestPeople) unconditionally wins
  // over the snapshot — a stale cache entry would otherwise keep shadowing
  // the correctly-updated snapshot forever. `city` has no home on
  // RankedPerson/PersonProfile (lib/peoplerank.ts), so it's saved to the server
  // via updateContact but not reflected here or in the cache/snapshot — see report.
  const handleContactSaved = useCallback((updated: MedhaContactFull) => {
    setDisplayPerson((prev) => {
      const next: RankedPerson = {
        ...prev,
        name: updated.name ?? prev.name,
        title: updated.title ?? prev.title,
        company: updated.company ?? prev.company,
        profile: {
          ...prev.profile,
          phone: updated.phone ?? prev.profile?.phone,
          email: updated.email ?? prev.profile?.email,
        },
      };
      setCachedPerson(next);
      void writeSnapshot(next);
      return next;
    });
  }, []);

  // Track score history (for the trend sparkline) and the recents carousel.
  useEffect(() => {
    let active = true;
    const now = Date.now();
    const pct = Math.round(normalizeScore(person.score) * 100);
    appendHistory(personId, pct, now).then((points) => {
      if (active) setHistory(points);
    });
    addRecent({
      id: personId,
      name: person.name,
      title: person.title,
      company: person.company,
      avatarUrl: person.profile?.avatarUrl,
    });
    readRecents(personId).then((list) => {
      if (active) setRecents(list);
    });
    return () => {
      active = false;
    };
  }, [
    personId,
    person.score,
    person.name,
    person.title,
    person.company,
    person.profile?.avatarUrl,
  ]);

  const enrich = useQuery({
    queryKey: ['enrich', personId],
    enabled: !!personId,
    queryFn: () => fetchEnrichment(personId),
    staleTime: 1000 * 60 * 30,
    gcTime: 1000 * 60 * 60 * 24,
    retry: 1,
  });

  const factsQuery = useQuery({
    queryKey: ['contactFacts', personId],
    enabled: !!personId,
    queryFn: () => getContactFacts(personId),
    staleTime: 1000 * 60,
  });
  const facts: ContactFact[] = factsQuery.data?.ok
    ? (factsQuery.data.data?.facts ?? [])
    : [];

  const qc = useQueryClient();

  // Full contact record, for its phone numbers. RankedPerson only carries a
  // single `profile.phone`; the "On Amber" resolution wants every number.
  const contactQuery = useQuery({
    queryKey: ['contact', personId],
    enabled: !!personId,
    queryFn: () => getContact(personId),
    staleTime: 1000 * 60 * 5,
  });
  const contact = contactQuery.data?.ok ? contactQuery.data.data.contact : undefined;

  // Deduped, non-empty phone numbers: the contact's numbers plus the ranked
  // person's known phone as a fallback when the full record isn't loaded.
  const phones = Array.from(
    new Set(
      [contact?.phone, ...(contact?.phoneNumbers ?? []), displayPerson.profile?.phone]
        .map((p) => (p ?? '').trim())
        .filter((p) => p.length > 0),
    ),
  );

  // ONE FIELD AT A TIME, straight to the contact. The modal PATCHes the whole record
  // on Save; this sends only what changed, so two inline edits in a row cannot have
  // the second overwrite the first with a stale copy of the rest.
  const saveField = useCallback(
    async (field: 'name' | 'title' | 'company', value: string): Promise<boolean> => {
      const next = value.trim();
      const res = await updateContact(String(personId), { [field]: next || null });
      if (!res.ok) {
        toast.error(medhaIdErrorCopy(res, 'Amber'));
        return false;
      }
      handleContactSaved(res.data.contact);
      // Everything that shows this person by name. Skipping these left the People row
      // and the Today card on the old spelling until something else happened to
      // refetch them, which reads as the edit not having saved.
      void queryClient.invalidateQueries({ queryKey: ['contacts'] });
      void queryClient.invalidateQueries({ queryKey: ['contact', personId] });
      return true;
    },
    [personId, queryClient, handleContactSaved],
  );

  /**
   * IS THIS PERSON ON AMBER? THE CARD ALREADY KNOWS.
   *
   * `contact.linkedAmberId` is the stored reconciliation -- written when the two
   * of you connect, and the same field circles, note sharing and the DM
   * candidate list read. The server has returned it on this payload for a while
   * and this screen ignored it, asking the question again over the network by
   * phone number.
   *
   * That cost two visible things. The card sat for a beat and THEN admitted it
   * knew somebody, which reads as the app being unsure whether you are
   * connected. And a card saved with only an email never resolved at all, since
   * the fallback matches on phones.
   *
   * So the stored link renders immediately, and the live lookup still runs --
   * it carries the username, the avatar and the request status, and it is what
   * makes the card light up on its own when somebody joins later. It refines;
   * it no longer gates.
   */
  const amberQuery = useQuery({
    queryKey: ['person', personId, 'amber'],
    enabled: phones.length > 0,
    queryFn: async () => unwrapOrThrow(await resolveContactAmberUser(phones)).amberUser,
  });
  const linkedAmberId = contact?.linkedAmberId ?? null;
  const amberUser = useMemo(() => {
    if (amberQuery.data) return amberQuery.data;
    if (!linkedAmberId) return null;
    // Enough for OnAmberCard to draw the connected state now. The live answer
    // replaces this the moment it lands.
    return {
      amberId: String(linkedAmberId),
      username: null,
      fullName: contact?.name ?? null,
      avatarUrl: null,
      occupation: null,
      currentCity: null,
      status: 'connected' as const,
    };
  }, [amberQuery.data, linkedAmberId, contact?.name]);

  // ── Muting this one person ───────────────────────────────────────────────
  //
  // The per-person half of "both: Settings and each person". Settings decides
  // which KINDS of notification are worth an interruption; this decides that
  // this particular person is not, whatever kind it is.
  //
  // MUTING IS NOT BLOCKING and the copy says so: blocking is in the DM surface,
  // it stops messages arriving at all, and it is visible in its effects. This is
  // one-directional, silent, and reversible by the same row.
  //
  // Only offered when they actually have an account, because a contact with no
  // Amber account has no way to notify anybody -- a switch there would be
  // decoration.
  const PREFS_KEY = ['notificationPrefs'] as const;
  const prefsQuery = useQuery({
    queryKey: PREFS_KEY,
    queryFn: () => getNotificationPrefs(),
    // Only asked for when there is somebody to mute.
    enabled: !!amberUser?.amberId,
  });
  const muted = !!(
    amberUser?.amberId && (prefsQuery.data?.muted ?? []).includes(String(amberUser.amberId).toLowerCase())
  );
  const muteMutation = useMutation({
    mutationFn: (next: boolean) =>
      setPersonMuted({ amberId: amberUser?.amberId, contactId: personId }, next),
    onSuccess: (list, next) => {
      const prev = qc.getQueryData<NotificationPrefs>(PREFS_KEY);
      if (prev) qc.setQueryData<NotificationPrefs>(PREFS_KEY, { ...prev, muted: list });
      else void prefsQuery.refetch();
      const first = (contact?.name ?? '').trim().split(/\s+/)[0] || 'them';
      toast.success(next ? `Muted ${first}.` : `Unmuted ${first}.`);
    },
    onError: () => toast.error('Could not change that just now.'),
  });

  const connectMutation = useMutation({
    mutationFn: (amberId: string) => sendConnectRequest(amberId),
    onSuccess: (res) => {
      if (!res.ok) {
        toast.error('Could not send request.', medhaIdErrorCopy(res, 'Amber'));
        return;
      }
      toast.success('Request sent.');
      qc.invalidateQueries({ queryKey: ['person', personId, 'amber'] });
      qc.invalidateQueries({ queryKey: ['connect', 'outgoing'] });
    },
    onError: (e) => toast.error('Could not send request.', errorCopy(e)),
  });

  // F6 enrichment surfaced from the full contact record. This is a distinct
  // surface from the Perplexity-backed EnrichmentCard ("what's new") below —
  // both coexist for now; reconciling them is later polish.
  const linkedinUrl = contact?.linkedinUrl ?? null;
  const enrichment = contact?.enrichment ?? null;
  const enrichmentStatus = contact?.enrichmentStatus ?? null;
  // FILTERED: a candidate with no name is not a choice, it is a button over blank space.
  //
  // This block rendered one card per stored candidate and read `candidate.name` inside it.
  // When enrichment resolved to ambiguous but persisted candidates with no usable fields,
  // the result was three identical "This is them" buttons above nothing — no name, no
  // title, no company — asking the user to pick between three blanks. Which is exactly
  // what a contact card looks like when it is broken.
  //
  // Requiring a name to render is the honest gate: if we cannot say WHO a candidate is, we
  // cannot ask whether it is them. When nothing survives the filter the whole section is
  // hidden rather than shown empty, and the card falls back to its normal un-enriched
  // state. The upstream question — why enrichment stored nameless candidates — is worth
  // chasing separately, but the UI should never have offered them either way.
  const enrichmentCandidates = (contact?.enrichmentCandidates ?? []).filter(
    (c) => (c?.name ?? '').trim().length > 0,
  );
  const isAmbiguous = enrichmentStatus === 'ambiguous' && enrichmentCandidates.length > 0;
  const hasProfessional =
    enrichmentStatus === 'resolved' || !!linkedinUrl || !!enrichment;

  const enrichMutation = useMutation({
    mutationFn: () => enrichContacts([personId]),
    onSuccess: (res) => {
      if (!res.ok) {
        toast.error('Could not enrich.', medhaIdErrorCopy(res, 'Amber'));
        return;
      }
      toast.success('Enrichment refreshed.');
      qc.invalidateQueries({ queryKey: ['contact', personId] });
    },
    onError: (e) => toast.error('Could not enrich.', errorCopy(e)),
  });

  const resolveMutation = useMutation({
    mutationFn: (choice: ResolveChoice) => resolveEnrichment(personId, choice),
    onSuccess: (res) => {
      if (!res.ok) {
        toast.error('Could not save.', medhaIdErrorCopy(res, 'Amber'));
        return;
      }
      // Card flips to resolved (or clears) once the fresh contact loads.
      qc.invalidateQueries({ queryKey: ['contact', personId] });
    },
    onError: (e) => toast.error('Could not save.', errorCopy(e)),
  });

  const trend = computeTrend(history);
  const enrichLinks = enrich.data?.signals?.social_links;
  const mergedLinks = mergeLinks(person.links, enrichLinks);
  const mutuals = enrich.data?.mutuals?.filter((m) => m?.name) ?? [];

  return (
    <Screen padded={false} background={LIGHT.canvas}>
      <Stack.Screen options={{ gestureEnabled: true }} />
      {/* NO EDIT BUTTON. Name, role and company are tapped directly now, and a
          header button that opens a nine-field form to change one word is exactly
          what that replaced. The form stays reachable from the row above Delete, so
          the fields the hero does not show are not stranded. */}
      <ScreenHeader onBack={onBack} />
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: spacing.lg,
          paddingTop: spacing.xs,
          paddingBottom: spacing.xxl,
          gap: spacing.lg,
        }}
        showsVerticalScrollIndicator={false}
        // The note input sits low on the page; auto-inset for the keyboard so it
        // scrolls into view instead of being covered, and let a drag dismiss it.
        automaticallyAdjustKeyboardInsets
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
      >
        <FadeInUp index={0} step={60}>
          <Header
            name={displayPerson.name}
            title={displayPerson.title}
            company={displayPerson.company}
            avatarUrl={person.profile?.avatarUrl}
            source={person.profile?.source}
            trend={trend}
            onSaveField={saveField}
          />
        </FadeInUp>

        {amberUser ? (
          <FadeInUp index={1} step={60}>
            <OnAmberCard
              amberUser={amberUser}
              busy={connectMutation.isPending}
              onConnect={() => connectMutation.mutate(amberUser.amberId)}
              onGoToInbox={() => router.push('/(gated)/home')}
            />
          </FadeInUp>
        ) : null}

        {isAmbiguous ? (
          <FadeInUp index={1} step={60}>
            <AmbiguityPicker
              candidates={enrichmentCandidates}
              busy={resolveMutation.isPending}
              onPick={(idx) => resolveMutation.mutate({ candidateIndex: idx })}
              onNone={() => resolveMutation.mutate({ none: true })}
            />
          </FadeInUp>
        ) : hasProfessional ? (
          <FadeInUp index={1} step={60}>
            <ProfessionalCard
              linkedinUrl={linkedinUrl}
              enrichment={enrichment}
              busy={enrichMutation.isPending}
              onEnrich={() => enrichMutation.mutate()}
            />
          </FadeInUp>
        ) : null}

        {/* WHY THIS PERSON IS PINNED. The tags you pick when adding a favorite were
            stored and then shown nowhere except as one word under their face in the
            grid. Rendered above the note field because "work" or "college" is the
            frame you read the rest of the card through. */}
        <FadeInUp index={1} step={60}>
          <FavoritePinCard contactId={personId} />
        </FadeInUp>

        {/* NOTE CAPTURE SITS ABOVE CALL/MESSAGE ON PURPOSE. Recording what you know about
            someone is the thing you do most often on this screen, and it used to be buried
            below the score, the radar and the facts list. Reaching them is one tap; the
            note is the reason you opened the card. */}
        <FadeInUp index={1} step={60}>
          <NotesCard contactId={personId} name={displayPerson.name} />
        </FadeInUp>

        <FadeInUp index={1} step={60}>
          <ActionBar
            phone={displayPerson.profile?.phone}
            email={displayPerson.profile?.email}
            name={displayPerson.name}
          />
        </FadeInUp>

        {/* A ZERO SCORE IS "NOT RANKED YET", NOT "THIS PERSON SCORES ZERO".
            Rendering it as a 48pt "0%" above the words PEOPLERANK SCORE is the single most
            broken-looking thing on this screen for anyone whose contacts have not been
            ranked — which is every new account, and is exactly what a teammate sees when
            they open their first contact. There is no useful reading of 0%: it is the
            absence of data wearing the costume of a measurement. So the card only appears
            once there is a real score, and its absence says nothing at all, which is
            honest. */}
        {person.score > 0 ? (
          <FadeInUp index={2} step={60}>
            <ScoreCard score={person.score} components={person.components} history={history} />
          </FadeInUp>
        ) : null}

        {/* Health profile radar. Shown as a frame in its "building your read"
            state — no invented numbers — until real per-dimension scoring lands. */}
        <FadeInUp index={2} step={60}>
          <DCard>
            <View style={{ gap: spacing.sm, alignItems: 'center' }}>
              <Text variant="microLabel" uppercase style={{ alignSelf: 'flex-start' }}>
                Health profile
              </Text>
              <HealthRadar size={260} />
              <Text variant="captionSm" style={{ color: LIGHT.textMuted, textAlign: 'center' }}>
                {`Building your read — Amber is still learning about ${(displayPerson.name || 'them').split(' ')[0]}.`}
              </Text>
            </View>
          </DCard>
        </FadeInUp>

        {/* Details, directly under the score — the contact's own info, like the
            Apple contact card. */}
        <FadeInUp index={3} step={60}>
          <FactsCard
            email={displayPerson.profile?.email}
            phone={displayPerson.profile?.phone}
            lastContactAt={person.profile?.lastContactAt}
          />
        </FadeInUp>

        <FadeInUp index={4} step={60}>
          <CirclesInTogetherCard personId={personId} />
        </FadeInUp>

        {/* TIMELINE REMOVED from the contact card on request. TimelineCard is still
            defined below and its props still exist on the data it read, so restoring it is
            putting this element back. It was showing derived-signal dates that repeated
            what the enrichment card already says. */}

        {mutuals.length > 0 ? (
          <FadeInUp index={7} step={60}>
            <MutualsCard mutuals={mutuals} />
          </FadeInUp>
        ) : null}


        <FadeInUp index={9} step={60}>
          <FactsSection facts={facts} isLoading={factsQuery.isLoading} />
        </FadeInUp>

        <FadeInUp index={9} step={60}>
          <ExperiencesSection contactId={personId} />
        </FadeInUp>

        {mergedLinks.length > 0 ? (
          <FadeInUp index={10} step={60}>
            <LinksCard links={mergedLinks} />
          </FadeInUp>
        ) : null}

        {recents.length > 0 ? (
          <FadeInUp index={12} step={60}>
            <RecentlyViewed people={recents} />
          </FadeInUp>
        ) : null}

        {/* LAST THING ON THE PAGE, on purpose. Destructive actions belong past
            everything a person might have come here to read, not next to Edit. */}
        <CCard flush>
          <CListRow
            first
            icon={<Pencil size={17} color={LIGHT.textSecondary} strokeWidth={1.7} />}
            title="Edit all details"
            sub="Email, phone, links and more"
            onPress={() => setEditOpen(true)}
          />
          {amberUser?.amberId ? (
            <CListRow
              icon={
                muted ? (
                  <BellOff size={17} color={LIGHT.textSecondary} strokeWidth={1.7} />
                ) : (
                  <Bell size={17} color={LIGHT.textSecondary} strokeWidth={1.7} />
                )
              }
              title={muted ? 'Unmute notifications' : 'Mute notifications'}
              sub={
                muted
                  ? 'Their messages and shares arrive quietly'
                  : 'No banners from them. They are never told.'
              }
              onPress={() => muteMutation.mutate(!muted)}
              right={
                muteMutation.isPending ? (
                  <ActivityIndicator size="small" color={LIGHT.textSecondary} />
                ) : undefined
              }
            />
          ) : null}
          <CListRow
            danger
            icon={<Trash2 size={17} color="#B3402C" strokeWidth={1.7} />}
            title="Delete contact"
            sub="Removes them and everything Amber remembers"
            onPress={confirmDeleteContact}
            right={deleting ? <ActivityIndicator size="small" color="#B3402C" /> : undefined}
          />
        </CCard>
      </ScrollView>

      <EditContactModal
        contactId={personId}
        visible={editOpen}
        onClose={() => setEditOpen(false)}
        onSaved={(updated) => {
          setEditOpen(false);
          handleContactSaved(updated);
        }}
      />
    </Screen>
  );
}

// Every section card on this page routes through here, so swapping this one
// implementation to GlassCard gives the whole page the same glossy look as
// the Feed and Circles tabs.
function DCard({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return <GlassCard style={style}>{children}</GlassCard>;
}

// Dark, shimmer-less placeholder block for the loading skeletons.
function Block({
  w,
  h,
  radius: r = radius.sm,
}: {
  w: number | `${number}%`;
  h: number;
  radius?: number;
}) {
  return <View style={{ width: w, height: h, borderRadius: r, backgroundColor: LIGHT.surfaceSoft }} />;
}

function ScreenHeader({ onBack, onEdit }: { onBack: () => void; onEdit?: () => void }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: spacing.lg,
        paddingTop: spacing.sm,
        paddingBottom: spacing.md,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
        <Pressable
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel="Back"
          hitSlop={10}
          style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
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
        <Text variant="microLabel" uppercase>
          Person
        </Text>
      </View>
      {onEdit ? (
        <Pressable
          onPress={onEdit}
          accessibilityRole="button"
          accessibilityLabel="Edit contact"
          hitSlop={10}
          style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
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
            <Pencil color={LIGHT.textSecondary} size={18} />
          </View>
        </Pressable>
      ) : null}
    </View>
  );
}

function Header({
  name,
  title,
  company,
  avatarUrl,
  source,
  trend,
  onSaveField,
}: {
  name: string;
  title?: string;
  company?: string;
  avatarUrl?: string;
  source?: string;
  trend: Trend;
  /** Persist one field. Returns false to roll the field back. */
  onSaveField: (field: 'name' | 'title' | 'company', value: string) => Promise<boolean>;
}) {
  return (
    <DCard style={{ padding: spacing.lg }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.base }}>
        <AvatarImage name={name} url={avatarUrl} size={72} />
        <View style={{ flex: 1, gap: spacing.xs }}>
          <EditableField
            value={name}
            placeholder="Add a name"
            variant="displayMd"
            style={{ color: LIGHT.textPrimary, letterSpacing: -0.4 }}
            accessibilityLabel="Name"
            onSave={(v) => onSaveField('name', v)}
          />
          {/* THE CAPTION IS TWO FIELDS, NOT ONE STRING. It used to be
              [title, company].join(' · '), which reads fine and cannot be edited —
              there is no way to tap "the company half" of a joined string. Splitting
              it is the whole reason each part is now touchable. Both render even when
              empty, as muted prompts: a field you cannot see is a field you cannot
              tap, and a contact with no title is exactly the one you want to fix. */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <EditableField
              value={title}
              placeholder="Add a role"
              variant="bodySm"
              style={{ color: LIGHT.textSecondary, letterSpacing: -0.1 }}
              accessibilityLabel="Role"
              onSave={(v) => onSaveField('title', v)}
            />
            <Text variant="bodySm" style={{ color: LIGHT.textMuted }}>
              ·
            </Text>
            <EditableField
              value={company}
              placeholder="Add a company"
              variant="bodySm"
              style={{ color: LIGHT.textSecondary, letterSpacing: -0.1 }}
              accessibilityLabel="Company"
              onSave={(v) => onSaveField('company', v)}
            />
          </View>
          {source || trend.direction !== 'flat' ? (
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: spacing.sm,
                marginTop: spacing.xxs,
              }}
            >
              {source ? <SourceBadge label={source} /> : null}
              <TrendChip trend={trend} />
            </View>
          ) : null}
        </View>
      </View>
    </DCard>
  );
}

function SourceBadge({ label }: { label: string }) {
  return (
    <View
      style={{
        paddingHorizontal: spacing.sm,
        paddingVertical: 3,
        borderRadius: radius.full,
        backgroundColor: LIGHT.surfaceSoft,
        borderWidth: 1,
        borderColor: LIGHT.hairline,
      }}
    >
      <Text variant="badge" uppercase style={{ color: LIGHT.textSecondary }}>
        {label}
      </Text>
    </View>
  );
}

// Avatar with a placeholder behind it until the remote image lands. expo-image
// fades in over the Block via its transition prop.
function AvatarImage({ name, url, size }: { name?: string; url?: string; size: number }) {
  const [loaded, setLoaded] = useState(false);
  if (!url) {
    return (
      <View
        style={{
          width: size,
          height: size,
          borderRadius: radius.full,
          backgroundColor: LIGHT.surfaceSoft,
          borderWidth: 1,
          borderColor: LIGHT.hairline,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text variant={size >= 56 ? 'displaySm' : 'titleSm'} style={{ color: LIGHT.accentText }}>
          {initials(name)}
        </Text>
      </View>
    );
  }
  return (
    <View style={{ width: size, height: size }}>
      {!loaded ? (
        <Block w={size} h={size} radius={radius.full} />
      ) : null}
      <Image
        source={{ uri: url }}
        onLoad={() => setLoaded(true)}
        transition={220}
        contentFit="cover"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: size,
          height: size,
          borderRadius: radius.full,
        }}
      />
    </View>
  );
}

function initials(name?: string): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

// Resolved professional enrichment (F6). Distinct from the Perplexity
// "what's new" EnrichmentCard below — both intentionally coexist for now.
function ProfessionalCard({
  linkedinUrl,
  enrichment,
  busy,
  onEnrich,
}: {
  linkedinUrl: string | null;
  enrichment: ContactEnrichment | null;
  busy: boolean;
  onEnrich: () => void;
}) {
  const li = linkedinUrl ?? enrichment?.linkedinUrl ?? null;
  const title = enrichment?.title ?? null;
  const company = enrichment?.company ?? null;
  const industry = enrichment?.industry ?? null;
  const tags = enrichment?.tags ?? [];
  const headline = [title, company].filter(Boolean).join(' · ');

  const openLinkedin = () => {
    if (!li) return;
    Haptics.selectionAsync().catch(() => {});
    Linking.openURL(li).catch(() => toast.error('Could not open LinkedIn.'));
  };

  return (
    <DCard>
      <View style={{ gap: spacing.sm }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text variant="microLabel" uppercase>
            Professional
          </Text>
          <Pressable
            onPress={onEnrich}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel="Refresh enrichment"
            hitSlop={8}
            style={({ pressed }) => ({ opacity: busy ? 0.5 : pressed ? 0.6 : 1 })}
          >
            {busy ? (
              <ActivityIndicator size="small" color={LIGHT.textSecondary} />
            ) : (
              <Text variant="buttonSm" style={{ color: LIGHT.accentText }}>
                Refresh
              </Text>
            )}
          </Pressable>
        </View>

        {headline ? (
          <Text variant="bodyMd" style={{ color: LIGHT.textPrimary }}>
            {headline}
          </Text>
        ) : null}
        {industry ? (
          <Text variant="bodySm" style={{ color: LIGHT.textSecondary }}>
            {industry}
          </Text>
        ) : null}

        {li ? (
          <Pressable
            onPress={openLinkedin}
            accessibilityRole="link"
            accessibilityHint="Opens LinkedIn"
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              gap: spacing.xs,
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <Linkedin color={LIGHT.accent} size={16} />
            <Text variant="bodySm" numberOfLines={1} style={{ flex: 1, color: LIGHT.accentText }}>
              LinkedIn profile
            </Text>
            <ExternalLink color={LIGHT.textMuted} size={14} />
          </Pressable>
        ) : null}

        {tags.length > 0 ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.xxs }}>
            {tags.map((t, i) => (
              <View
                key={`${t}-${i}`}
                style={{
                  paddingHorizontal: spacing.sm,
                  paddingVertical: 4,
                  borderRadius: radius.full,
                  backgroundColor: LIGHT.chipBg,
                }}
              >
                <Text variant="captionSm" style={{ color: LIGHT.chipText }}>
                  {t}
                </Text>
              </View>
            ))}
          </View>
        ) : null}
      </View>
    </DCard>
  );
}

// Ranked disambiguation candidates (F6), shown while enrichment is ambiguous.
// Honest framing: these are possible matches, not confirmed.
function AmbiguityPicker({
  candidates,
  busy,
  onPick,
  onNone,
}: {
  candidates: EnrichmentCandidate[];
  busy: boolean;
  onPick: (index: number) => void;
  onNone: () => void;
}) {
  return (
    <DCard>
      <View style={{ gap: spacing.sm }}>
        <Text variant="microLabel" uppercase>
          Possible matches
        </Text>
        <Text variant="bodyMd" style={{ color: LIGHT.textPrimary }}>
          A few possible matches — which is them?
        </Text>
        <Text variant="captionSm" style={{ color: LIGHT.textMuted }}>
          These are possible matches, not confirmed.
        </Text>
        {/* TODO(F6c): a "type a detail you remember to refine" input needs a
            backend hint-filter we haven't built yet — deferred. */}

        <View style={{ gap: spacing.sm, marginTop: spacing.xs }}>
          {candidates.map((c, i) => (
            <CandidateRow
              key={`${c.linkedinUrl || c.name}-${i}`}
              candidate={c}
              busy={busy}
              onPick={() => onPick(i)}
            />
          ))}
        </View>

        <Pressable
          onPress={onNone}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel="None of these"
          hitSlop={8}
          style={({ pressed }) => ({
            alignSelf: 'flex-start',
            marginTop: spacing.xs,
            opacity: busy ? 0.5 : pressed ? 0.6 : 1,
          })}
        >
          <Text variant="buttonSm" style={{ color: LIGHT.textSecondary }}>
            None of these
          </Text>
        </Pressable>
      </View>
    </DCard>
  );
}

function CandidateRow({
  candidate,
  busy,
  onPick,
}: {
  candidate: EnrichmentCandidate;
  busy: boolean;
  onPick: () => void;
}) {
  const meta = [candidate.title, candidate.company, candidate.city].filter(Boolean).join(' · ');
  const openLinkedin = () => {
    if (!candidate.linkedinUrl) return;
    Haptics.selectionAsync().catch(() => {});
    Linking.openURL(candidate.linkedinUrl).catch(() => toast.error('Could not open LinkedIn.'));
  };
  return (
    <View
      style={{
        gap: spacing.sm,
        padding: spacing.base,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: LIGHT.hairline,
        backgroundColor: LIGHT.surfaceSoft,
      }}
    >
      <View style={{ gap: 2 }}>
        <Text variant="titleSm" numberOfLines={1} style={{ color: LIGHT.textPrimary }}>
          {candidate.name}
        </Text>
        {meta ? (
          <Text variant="captionSm" numberOfLines={2} style={{ color: LIGHT.textSecondary }}>
            {meta}
          </Text>
        ) : null}
      </View>

      {candidate.linkedinUrl ? (
        <Pressable
          onPress={openLinkedin}
          accessibilityRole="link"
          accessibilityHint="Opens LinkedIn"
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            gap: spacing.xs,
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <Linkedin color={LIGHT.accent} size={14} />
          <Text variant="captionSm" style={{ color: LIGHT.accentText }}>
            View LinkedIn
          </Text>
        </Pressable>
      ) : null}

      <Pressable
        onPress={onPick}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel={`This is ${candidate.name}`}
        style={({ pressed }) => ({ opacity: busy ? 0.6 : pressed ? 0.85 : 1 })}
      >
        <View
          style={{
            height: 36,
            borderRadius: radius.full,
            backgroundColor: cl.tint100,
            borderWidth: HAIRLINE,
            borderColor: cl.gold55,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text variant="buttonSm" style={{ color: cl.goldDeep }}>
            This is them
          </Text>
        </View>
      </Pressable>
    </View>
  );
}

// Shown near the top of the card only when this contact resolves to an Amber
// account. The Connect button reuses the shared four-state ConnectButton so it
// stays identical to the search screen.
function OnAmberCard({
  amberUser,
  busy,
  onConnect,
  onGoToInbox,
}: {
  amberUser: ConnectSearchUser;
  busy: boolean;
  onConnect: () => void;
  onGoToInbox: () => void;
}) {
  const copyAmberId = () => {
    void Clipboard.setStringAsync(amberUser.amberId);
    Haptics.selectionAsync().catch(() => {});
    toast.success('Amber ID copied.');
  };

  return (
    <GlassCard>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
        <View style={{ flex: 1, gap: spacing.xs }}>
          <Text variant="microLabel" uppercase>
            On Amber
          </Text>
          <Text variant="titleMd" numberOfLines={1} style={{ color: LIGHT.textPrimary }}>
            {amberUser.username ? `@${amberUser.username}` : 'Amber user'}
          </Text>
          <Pressable
            onPress={copyAmberId}
            accessibilityRole="button"
            accessibilityLabel="Copy Amber ID"
            hitSlop={6}
          >
            <Text
              variant="captionSm"
              numberOfLines={1}
              style={{ color: LIGHT.textMuted, fontFamily: 'Menlo' }}
            >
              {amberUser.amberId}
            </Text>
          </Pressable>
        </View>
        <ConnectButton
          status={amberUser.status}
          busy={busy}
          onConnect={onConnect}
          onGoToInbox={onGoToInbox}
        />
      </View>
    </GlassCard>
  );
}

// One-tap reach actions wired to the contact's resolved handles. Each action is
// gated on the handle existing, so we never render a dead button.
function ActionBar({ phone, email, name }: { phone?: string; email?: string; name?: string }) {
  const open = (url: string, label: string) => {
    Haptics.selectionAsync().catch(() => {});
    Linking.openURL(url).catch(() => toast.error(`Could not open ${label}.`));
  };
  const actions: { key: string; label: string; icon: React.ReactNode; onPress: () => void }[] = [];
  if (phone) {
    actions.push({
      key: 'message',
      label: 'Message',
      icon: <MessageCircle color={LIGHT.accent} size={18} />,
      onPress: () => open(`sms:${phone}`, 'Messages'),
    });
  }
  if (email) {
    actions.push({
      key: 'email',
      label: 'Email',
      icon: <Mail color={LIGHT.accent} size={18} />,
      onPress: () => open(`mailto:${email}`, 'Mail'),
    });
  }
  if (actions.length === 0) return null;
  return (
    <View style={{ flexDirection: 'row', gap: spacing.sm }}>
      {actions.map((a) => (
        <Pressable
          key={a.key}
          onPress={a.onPress}
          accessibilityRole="button"
          accessibilityLabel={`${a.label} ${name ?? 'contact'}`}
          style={{ flex: 1 }}
        >
          {({ pressed }) => (
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: spacing.sm,
                paddingVertical: spacing.md,
                borderRadius: radius.md,
                borderWidth: 1,
                borderColor: LIGHT.hairline,
                backgroundColor: pressed ? LIGHT.surface : LIGHT.surfaceSoft,
              }}
            >
              {a.icon}
              <Text variant="buttonSm" style={{ color: LIGHT.textPrimary }}>
                {a.label}
              </Text>
            </View>
          )}
        </Pressable>
      ))}
    </View>
  );
}

function ScoreCard({
  score,
  components,
  history,
}: {
  score: number;
  components?: RankComponents;
  history: HistoryPoint[];
}) {
  const pct = Math.round(normalizeScore(score) * 100);
  const display = useCountUp(pct);
  return (
    <DCard style={{ padding: spacing.lg }}>
      <View style={{ gap: spacing.lg }}>
        <View
          style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' }}
        >
          <View style={{ gap: spacing.xxs }}>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 2 }}>
              <Text
                variant="ratingDisplay"
                style={{
                  color: LIGHT.textPrimary,
                  fontSize: 48,
                  lineHeight: 52,
                  letterSpacing: -1.5,
                  fontVariant: ['tabular-nums'],
                }}
              >
                {display}
              </Text>
              <Text variant="displaySm" style={{ color: LIGHT.accentText, letterSpacing: -0.5 }}>
                %
              </Text>
            </View>
            <Text
              variant="microLabel"
              uppercase
              style={{ marginTop: 2 }}
            >
              PeopleRank score
            </Text>
          </View>
          {history.length >= 2 ? (
            <Sparkline points={history.map((h) => h.score)} width={92} height={32} />
          ) : null}
        </View>
        {components ? (
          <View style={{ gap: spacing.md }}>
            {COMPONENT_LABELS.map(({ key, label }, i) => (
              <ComponentBar key={key} label={label} value={components[key] ?? 0} delay={i * 90} />
            ))}
          </View>
        ) : null}
      </View>
    </DCard>
  );
}

// Animated fill: each bar springs from 0 to its width on mount, staggered by
// `delay`. Thin, elegant amber bars over a warm track.
function ComponentBar({ label, value, delay }: { label: string; value: number; delay: number }) {
  const pct = Math.round(normalizeScore(value) * 100);
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const anim = Animated.spring(progress, {
      toValue: 1,
      delay,
      friction: 9,
      tension: 60,
      useNativeDriver: false,
    });
    anim.start();
    return () => anim.stop();
  }, [progress, delay, pct]);

  const widthInterpolate = progress.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', `${pct}%`],
  });

  return (
    <View style={{ gap: spacing.xs }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text variant="captionSm" style={{ color: LIGHT.textSecondary, letterSpacing: -0.1 }}>
          {label}
        </Text>
        <Text
          variant="captionSm"
          style={{ color: LIGHT.textMuted, fontVariant: ['tabular-nums'] }}
        >
          {pct}%
        </Text>
      </View>
      <View
        style={{
          height: 4,
          borderRadius: radius.full,
          backgroundColor: LIGHT.surfaceSoft,
          overflow: 'hidden',
        }}
      >
        <Animated.View
          style={{
            width: widthInterpolate,
            height: '100%',
            borderRadius: radius.full,
            backgroundColor: cl.tint100,
            borderWidth: HAIRLINE,
            borderColor: cl.gold55,
          }}
        />
      </View>
    </View>
  );
}

// Circles this contact and the signed-in user both belong to. Renders nothing
// (not even an empty card) when there are none.
function CirclesInTogetherCard({ personId }: { personId: string }) {
  const router = useRouter();
  const circlesQuery = useQuery({
    queryKey: ['contact-circles', personId],
    queryFn: async () => unwrapOrThrow(await getCirclesForContact(personId)).circles,
  });
  const circles = circlesQuery.data ?? [];

  if (circles.length === 0) return null;

  return (
    <GlassCard>
      <View style={{ gap: spacing.sm }}>
        <Text variant="microLabel" uppercase>
          Circles in together
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
          {circles.map((circle) => (
            <CircleChip key={circle.id} circle={circle} onPress={() => router.push(`/(gated)/circle/${circle.id}`)} />
          ))}
        </View>
      </View>
    </GlassCard>
  );
}

function CircleChip({ circle, onPress }: { circle: ContactCircle; onPress: () => void }) {
  const dotColor = NAMED_COLORS[circle.color ?? ''] ?? circle.color ?? LIGHT.accent;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={circle.name}>
      <View
        style={{
          backgroundColor: LIGHT.surfaceSoft,
          borderRadius: radius.full,
          paddingHorizontal: spacing.md,
          paddingVertical: 6,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
        }}
      >
        <View
          style={{
            width: 8,
            height: 8,
            borderRadius: radius.full,
            backgroundColor: dotColor,
          }}
        />
        <Text variant="captionSm" style={{ color: LIGHT.textPrimary }}>
          {circle.name}
        </Text>
      </View>
    </Pressable>
  );
}

// EnrichmentCard, Sources and TimelineCard USED TO BE DEFINED HERE, and nothing
// rendered any of them.
//
// TimelineCard was taken off the contact card on request; EnrichmentCard was the
// old "what's new" panel, superseded by the enrichment surface above. Both were
// left in the file "for now", which is how the app ended up with a second search
// bar nobody could see (see components/AskChat) -- dead UI kept in case is not
// kept, it is just dead, and it is what eslint had been quietly reporting on
// every run that never actually ran.
//
// Deleted rather than commented out. git has them if either is ever wanted back.

// A light interaction timeline from whatever signals are present. Degrades to
// nothing rather than inventing events.
function MutualsCard({ mutuals }: { mutuals: { id?: string; name?: string }[] }) {
  return (
    <DCard>
      <View style={{ gap: spacing.sm }}>
        <Text variant="microLabel" uppercase>
          People you both know
        </Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={{ flexDirection: 'row', gap: spacing.base }}>
            {mutuals.slice(0, 12).map((m, i) => (
              <View
                key={`${m.id ?? m.name}-${i}`}
                style={{ alignItems: 'center', width: 64, gap: spacing.xs }}
              >
                <View
                  style={{
                    width: 48,
                    height: 48,
                    borderRadius: radius.full,
                    backgroundColor: LIGHT.surfaceSoft,
                    borderWidth: 1,
                    borderColor: LIGHT.hairline,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Text variant="titleSm" style={{ color: LIGHT.accentText }}>
                    {initials(m.name)}
                  </Text>
                </View>
                <Text
                  variant="captionSm"
                  numberOfLines={1}
                  centered
                  style={{ color: LIGHT.textSecondary }}
                >
                  {m.name}
                </Text>
              </View>
            ))}
          </View>
        </ScrollView>
      </View>
    </DCard>
  );
}

/**
 * Capture a note about this person — by voice first, typing second.
 *
 * Saved SERVER-SIDE through the capture pipeline (nothing on-device), so it becomes a fact
 * under "What Amber Knows" and feeds PeopleRank.
 *
 * REBUILT AS A VOICE SURFACE. It used to be a bordered multiline text box with a small
 * "Voice note" chip beside a Save link — a form, with voice as an afterthought. But the
 * whole product is "talk and Amber remembers", and on a contact card the thing you want is
 * to say a sentence about someone and move on. So the record ring is the primary control at
 * the natural size for a thumb, the live waveform is the same Apple-Voice-Memos metering
 * used everywhere else in the app, and typing is still there underneath for when you would
 * rather not talk.
 *
 * TAP to start, tap the check to keep it, tap the X to throw it away — matching the
 * favorites sheet exactly, so the gesture is learned once.
 */
function NotesCard({ contactId, name }: { contactId: string; name: string }) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [waveWidth, setWaveWidth] = useState(0);
  const queryClient = useQueryClient();
  const firstName = name.split(' ')[0] || 'them';

  const commit = useCallback(
    async (raw: string) => {
      const text = raw.trim();
      if (!text || busy) return;
      setBusy(true);
      const res = await captureContactNote(contactId, text);
      setBusy(false);
      if (res.ok) {
        setValue('');
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        toast.success('Noted.');
        // Capture is eventual (a beat of extraction); refresh shortly so the new note lands
        // in "What Amber Knows".
        setTimeout(() => {
          queryClient.invalidateQueries({ queryKey: ['contactFacts', contactId] });
        }, 1400);
      } else {
        toast.error('Could not save the note.');
      }
    },
    [contactId, busy, queryClient],
  );

  // The transcript lands straight in the field rather than saving itself, so you can fix a
  // name before it becomes a permanent fact — and the edit teaches the dictionary.
  const dictation = useVoiceDictation({
    onUtterance: (t: string) => setValue((v) => (v.trim() ? `${v.trim()} ${t}` : t)),
  });

  useEffect(() => {
    if (!dictation.active) return undefined;
    setSeconds(0);
    const id = setInterval(() => setSeconds((x) => x + 1), 1000);
    return () => clearInterval(id);
  }, [dictation.active]);

  const mmss = (total: number) => {
    const m = Math.floor(total / 60);
    const sec = total % 60;
    return `${m}:${sec < 10 ? '0' : ''}${sec}`;
  };

  return (
    <DCard>
      <View style={{ gap: spacing.md }}>
        <Text variant="microLabel" uppercase>
          {dictation.active
            ? 'Listening'
            : dictation.transcribing
              ? 'Writing it down'
              : 'Add a note'}
        </Text>

        {dictation.active ? (
          // RECORDING: cancel on the left, live waveform, timer, keep on the right. The same
          // row shape as the favorites sheet and the full recorder sheet.
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56 }}>
            <Pressable
              onPress={dictation.cancel}
              accessibilityRole="button"
              accessibilityLabel="Discard this recording"
              hitSlop={10}
              style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
            >
              <View
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 22,
                  borderWidth: 1,
                  borderColor: 'rgba(32,30,29,0.28)',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <X size={19} color="rgba(32,30,29,0.6)" strokeWidth={2.2} />
              </View>
            </Pressable>

            <View
              style={{ flex: 1, minWidth: 0 }}
              onLayout={(e) => {
                const w = Math.floor(e.nativeEvent.layout.width);
                setWaveWidth((prev) => (Math.abs(prev - w) > 1 ? w : prev));
              }}
            >
              {waveWidth > 0 ? (
                <RecordingWaveform
                  getMetering={dictation.getMetering}
                  active
                  bars={barsForWidth(waveWidth, 3, 3)}
                  barWidth={3}
                  gap={3}
                  height={36}
                  color="#C4703C"
                  style={{ width: waveWidth }}
                />
              ) : (
                <View style={{ height: 36 }} />
              )}
            </View>

            <Text
              style={{
                fontFamily: typography.bodyMd.fontFamily,
                fontSize: 12,
                letterSpacing: 0.4,
                color: '#8C491A',
                width: 34,
                textAlign: 'right',
                fontVariant: ['tabular-nums'],
              }}
            >
              {mmss(seconds)}
            </Text>

            <Pressable
              onPress={dictation.stop}
              accessibilityRole="button"
              accessibilityLabel="Keep this recording"
              hitSlop={10}
              style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
            >
              <View
                style={{
                  width: 52,
                  height: 52,
                  borderRadius: 26,
                  backgroundColor: '#201E1D',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Check size={22} color="#FFF8F0" strokeWidth={2.6} />
              </View>
            </Pressable>
          </View>
        ) : (
          // IDLE: the record ring is the primary control.
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.base, minHeight: 56 }}>
            <Pressable
              onPress={dictation.start}
              disabled={dictation.transcribing || busy}
              accessibilityRole="button"
              accessibilityLabel={`Record a note about ${firstName}`}
              hitSlop={12}
              style={({ pressed }) => ({
                opacity: dictation.transcribing || busy ? 0.5 : pressed ? 0.85 : 1,
              })}
            >
              <View
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: 28,
                  borderWidth: 1.4,
                  borderColor: 'rgba(32,30,29,0.42)',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <View
                  style={{
                    width: 15,
                    height: 15,
                    borderRadius: 8,
                    backgroundColor: 'rgba(32,30,29,0.66)',
                  }}
                />
              </View>
            </Pressable>
            <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
              <Text
                style={{
                  fontFamily: fonts.serifItalic,
                  fontSize: 16,
                  lineHeight: 23,
                  color: dictation.transcribing ? '#8C491A' : 'rgba(32,30,29,0.75)',
                }}
              >
                {dictation.transcribing ? 'Writing it down…' : `Tap to record a note about ${firstName}`}
              </Text>
              {dictation.transcribing ? null : (
                <Text
                  style={{
                    fontFamily: typography.bodyMd.fontFamily,
                    fontSize: 11.5,
                    lineHeight: 17,
                    color: 'rgba(32,30,29,0.42)',
                  }}
                >
                  Amber remembers it and files it under what it knows.
                </Text>
              )}
            </View>
            {dictation.transcribing ? <ActivityIndicator size="small" color="#B2622D" /> : null}
          </View>
        )}

        {/* Typing, for when talking is not an option. Also where a transcript lands, so a
            misheard name can be fixed before it becomes a permanent fact. */}
        <View
          style={{
            borderRadius: radius.sm,
            borderWidth: 1,
            borderColor: LIGHT.hairline,
            backgroundColor: LIGHT.surfaceSoft,
            paddingHorizontal: spacing.md,
            paddingVertical: spacing.sm,
          }}
        >
          <TextInput
            value={value}
            onChangeText={setValue}
            placeholder={`Or type what Amber should remember about ${firstName}`}
            placeholderTextColor={LIGHT.textMuted}
            editable={!busy && !dictation.active && !dictation.transcribing}
            multiline
            style={{
              minHeight: 52,
              fontFamily: typography.bodyMd.fontFamily,
              fontSize: 14,
              lineHeight: 20,
              color: LIGHT.textPrimary,
              textAlignVertical: 'top',
            }}
          />
        </View>

        {value.trim() ? (
          <Pressable
            onPress={() => void commit(value)}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel="Save note"
            style={({ pressed }) => ({ opacity: busy ? 0.5 : pressed ? 0.9 : 1 })}
          >
            <View
              style={{
                height: 46,
                borderRadius: radius.full,
                backgroundColor: '#201E1D',
                alignItems: 'center',
                justifyContent: 'center',
                flexDirection: 'row',
                gap: 10,
              }}
            >
              {busy ? <ActivityIndicator size="small" color="#FFF8F0" /> : null}
              <Text
                style={{
                  fontFamily: typography.bodyMd.fontFamily,
                  fontSize: 12.5,
                  letterSpacing: 1.6,
                  color: '#FFF8F0',
                }}
              >
                {busy ? 'SAVING…' : 'SAVE NOTE'}
              </Text>
            </View>
          </Pressable>
        ) : null}
      </View>
    </DCard>
  );
}

function FactsSection({ facts, isLoading }: { facts: ContactFact[]; isLoading: boolean }) {
  const reversed = [...facts].reverse();
  return (
    <DCard>
      <View style={{ gap: spacing.sm }}>
        <Text variant="microLabel" uppercase>
          What Amber Knows
        </Text>
        {isLoading ? (
          <View style={{ gap: spacing.sm }}>
            <Block w="100%" h={14} />
            <Block w="85%" h={14} />
            <Block w="65%" h={14} />
          </View>
        ) : reversed.length === 0 ? (
          <Text variant="bodySm" style={{ color: LIGHT.textMuted }}>
            Nothing captured yet.
          </Text>
        ) : (
          <View style={{ gap: spacing.md }}>
            {reversed.map((fact) => (
              <View key={String(fact.id)} style={{ gap: spacing.xs }}>
                <Text variant="bodyMd" style={{ color: LIGHT.textPrimary }}>
                  {fact.factText}
                </Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                  <View
                    style={{
                      paddingHorizontal: spacing.sm,
                      paddingVertical: 3,
                      borderRadius: radius.full,
                      backgroundColor: LIGHT.chipBg,
                    }}
                  >
                    <Text variant="badge" style={{ color: LIGHT.chipText }}>
                      {fact.category}
                    </Text>
                  </View>
                  <Text variant="captionSm" style={{ color: LIGHT.textMuted }}>
                    {formatRelative(fact.createdAt)}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        )}
      </View>
    </DCard>
  );
}

// Experiences involving this person, each shareable. Hidden when there are none,
// so the profile stays quiet until there's something to show. The Share button
// opens the sheet where you pick the audience (a person, circle(s), or network).
function ExperiencesSection({ contactId }: { contactId: string }) {
  const { items, status } = useExperiences(contactId);
  const [shareFor, setShareFor] = useState<{ id: string; label: string } | null>(null);
  if (status === 'done' && items.length === 0) return null;
  return (
    <DCard>
      <View style={{ gap: spacing.sm }}>
        <Text variant="microLabel" uppercase>
          Experiences
        </Text>
        {status === 'loading' ? (
          <View style={{ gap: spacing.sm }}>
            <Block w="100%" h={14} />
            <Block w="70%" h={14} />
          </View>
        ) : (
          <View style={{ gap: spacing.md }}>
            {items.map((e) => (
              <View key={e.id} style={{ gap: spacing.xs }}>
                <Text variant="bodyMd" style={{ color: LIGHT.textPrimary }}>
                  {e.text}
                </Text>
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: spacing.sm,
                  }}
                >
                  <Text
                    variant="captionSm"
                    numberOfLines={1}
                    style={{ flex: 1, color: LIGHT.textMuted }}
                  >
                    {e.participantNames.length > 0
                      ? e.participantNames.join(', ')
                      : e.createdAt
                        ? formatRelative(e.createdAt)
                        : ''}
                  </Text>
                  <Pressable
                    onPress={() => setShareFor({ id: e.id, label: e.text })}
                    accessibilityRole="button"
                    accessibilityLabel="Share experience"
                    hitSlop={8}
                    style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
                  >
                    <View
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 4,
                        paddingHorizontal: spacing.sm,
                        paddingVertical: 4,
                        borderRadius: radius.full,
                        borderWidth: 1,
                        borderColor: LIGHT.hairline,
                        backgroundColor: LIGHT.surface,
                      }}
                    >
                      <Share2 size={13} color={LIGHT.accentText} strokeWidth={2.25} />
                      <Text variant="buttonSm" style={{ color: LIGHT.accentText }}>
                        Share
                      </Text>
                    </View>
                  </Pressable>
                </View>
              </View>
            ))}
          </View>
        )}
      </View>
      <ShareSheet
        visible={!!shareFor}
        itemType="experience"
        itemId={shareFor?.id ?? ''}
        itemLabel={shareFor?.label}
        onClose={() => setShareFor(null)}
      />
    </DCard>
  );
}

function LinksCard({ links }: { links: PersonLink[] }) {
  return (
    <DCard>
      <View style={{ gap: spacing.sm }}>
        <Text variant="microLabel" uppercase>
          Links
        </Text>
        {links.map((link, i) => (
          <LinkRow key={`${link.type}-${i}`} link={link} />
        ))}
      </View>
    </DCard>
  );
}

function LinkRow({ link }: { link: PersonLink }) {
  const open = () => {
    Haptics.selectionAsync().catch(() => {});
    Linking.openURL(link.url).catch(() => toast.error('Could not open that link.'));
  };
  const copy = async () => {
    await Clipboard.setStringAsync(link.url);
    Haptics.selectionAsync().catch(() => {});
    toast.success('Link copied.');
  };
  return (
    <Pressable
      onPress={open}
      onLongPress={copy}
      accessibilityRole="link"
      accessibilityHint="Long press to copy"
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.md,
        paddingVertical: spacing.sm,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <LinkIcon type={link.type} />
      <View style={{ flex: 1 }}>
        <Text variant="titleSm" style={{ color: LIGHT.textPrimary }}>
          {linkLabel(link.type)}
        </Text>
        <Text variant="captionSm" numberOfLines={1} style={{ color: LIGHT.textSecondary }}>
          {link.url}
        </Text>
      </View>
      <ExternalLink color={LIGHT.textMuted} size={16} />
    </Pressable>
  );
}

function LinkIcon({ type }: { type: string }) {
  const size = 18;
  switch (type) {
    case 'linkedin':
      return <Linkedin color={LIGHT.accent} size={size} />;
    case 'twitter':
      return <Twitter color={LIGHT.accent} size={size} />;
    case 'github':
      return <Github color={LIGHT.accent} size={size} />;
    default:
      return <Globe color={LIGHT.accent} size={size} />;
  }
}

function linkLabel(type: string): string {
  switch (type) {
    case 'linkedin':
      return 'LinkedIn';
    case 'twitter':
      return 'X / Twitter';
    case 'github':
      return 'GitHub';
    case 'website':
      return 'Website';
    default:
      return type.charAt(0).toUpperCase() + type.slice(1);
  }
}

function FactsCard({
  email,
  phone,
  lastContactAt,
}: {
  email?: string;
  phone?: string;
  lastContactAt?: string;
}) {
  const rows: { label: string; value: string; copy?: string }[] = [];
  if (email) rows.push({ label: 'Email', value: email, copy: email });
  if (phone) rows.push({ label: 'Phone', value: phone, copy: phone });
  if (lastContactAt) rows.push({ label: 'Last contact', value: formatDate(lastContactAt) });
  if (rows.length === 0) return null;

  const copy = async (text: string, label: string) => {
    await Clipboard.setStringAsync(text);
    Haptics.selectionAsync().catch(() => {});
    toast.success(`${label} copied.`);
  };

  return (
    <DCard>
      <View style={{ gap: spacing.sm }}>
        <Text variant="microLabel" uppercase>
          Details
        </Text>
        {rows.map((r) => (
          <Pressable
            key={r.label}
            onLongPress={r.copy ? () => copy(r.copy as string, r.label) : undefined}
            accessibilityHint={r.copy ? 'Long press to copy' : undefined}
            style={({ pressed }) => ({
              flexDirection: 'row',
              justifyContent: 'space-between',
              gap: spacing.md,
              opacity: pressed && r.copy ? 0.6 : 1,
            })}
          >
            <Text variant="bodySm" style={{ color: LIGHT.textSecondary }}>
              {r.label}
            </Text>
            <Text
              variant="bodySm"
              style={{ flexShrink: 1, textAlign: 'right', color: LIGHT.textPrimary }}
            >
              {r.value}
            </Text>
          </Pressable>
        ))}
      </View>
    </DCard>
  );
}

// Keeps the rabbit hole going: tap any recently-viewed person to jump to their
// card. Sourced from the on-device recents list, so it is real, not a stub.
function RecentlyViewed({ people }: { people: RecentPerson[] }) {
  const router = useRouter();
  const open = (id: string) => {
    Haptics.selectionAsync().catch(() => {});
    router.push(`/(gated)/person/${id}`);
  };
  return (
    <View style={{ gap: spacing.sm }}>
      <Text variant="microLabel" uppercase>
        Recently viewed
      </Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          {people.map((p) => (
            <Pressable
              key={p.id}
              onPress={() => open(p.id)}
              accessibilityRole="button"
              accessibilityLabel={`Open ${p.name}`}
              style={{ width: 132 }}
            >
              {({ pressed }) => (
                <View
                  style={{
                    gap: spacing.sm,
                    padding: spacing.md,
                    borderRadius: radius.md,
                    borderWidth: 1,
                    borderColor: LIGHT.hairline,
                    backgroundColor: pressed ? LIGHT.surface : LIGHT.surfaceSoft,
                  }}
                >
                  <AvatarImage name={p.name} url={p.avatarUrl} size={40} />
                  <Text variant="titleSm" numberOfLines={1} style={{ color: LIGHT.textPrimary }}>
                    {p.name}
                  </Text>
                  {p.title || p.company ? (
                    <Text variant="captionSm" numberOfLines={1} style={{ color: LIGHT.textSecondary }}>
                      {[p.title, p.company].filter(Boolean).join(' · ')}
                    </Text>
                  ) : null}
                </View>
              )}
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Small presentational helpers
// ---------------------------------------------------------------------------
type Trend = { direction: 'up' | 'down' | 'flat'; delta: number };

function TrendChip({ trend }: { trend: Trend }) {
  if (trend.direction === 'flat') return null;
  const up = trend.direction === 'up';
  const fg = up ? TREND_UP : TREND_DOWN;
  const style: ViewStyle = {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.full,
    backgroundColor: up ? 'rgba(91,208,138,0.15)' : 'rgba(232,118,90,0.15)',
  };
  return (
    <View style={style}>
      {up ? <TrendingUp color={fg} size={12} /> : <TrendingDown color={fg} size={12} />}
      <Text variant="badge" style={{ color: fg }}>
        {up ? '+' : ''}
        {trend.delta}
      </Text>
    </View>
  );
}

// Trend sparkline from the locally tracked score history.
function Sparkline({ points, width, height }: { points: number[]; width: number; height: number }) {
  if (points.length < 2) return null;
  const max = Math.max(...points);
  const min = Math.min(...points);
  const range = max - min || 1;
  const stepX = width / (points.length - 1);
  const coords = points.map((p, i) => {
    const x = i * stepX;
    const y = height - ((p - min) / range) * (height - 4) - 2;
    return { x, y };
  });
  const polyline = coords.map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ');
  const last = coords[coords.length - 1]!;
  const rising = points[points.length - 1]! >= points[0]!;
  const stroke = rising ? TREND_UP : TREND_DOWN;
  return (
    <Svg width={width} height={height}>
      <Polyline
        points={polyline}
        fill="none"
        stroke={stroke}
        strokeWidth={2}
        strokeLinejoin="round"
      />
      <Circle cx={last.x} cy={last.y} r={2.5} fill={stroke} />
    </Svg>
  );
}

// Count a number up to its target over ~600ms for the headline score.
function useCountUp(target: number): number {
  const [value, setValue] = useState(0);
  useEffect(() => {
    const driver = new Animated.Value(0);
    const id = driver.addListener(({ value: v }) => setValue(Math.round(v)));
    const anim = Animated.timing(driver, {
      toValue: target,
      duration: 600,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    });
    anim.start();
    return () => {
      anim.stop();
      driver.removeListener(id);
    };
  }, [target]);
  return value;
}

function computeTrend(history: HistoryPoint[]): Trend {
  if (history.length < 2) return { direction: 'flat', delta: 0 };
  const delta = history[history.length - 1]!.score - history[0]!.score;
  if (delta > 0) return { direction: 'up', delta };
  if (delta < 0) return { direction: 'down', delta };
  return { direction: 'flat', delta: 0 };
}

// Merge the person's known links with any social links the enrichment surfaced,
// deduped by normalized URL, then typed by host so each gets a provider icon.
function mergeLinks(base: PersonLink[], extra?: string[]): PersonLink[] {
  const seen = new Set<string>();
  const out: PersonLink[] = [];
  const push = (link: PersonLink) => {
    const key = link.url.replace(/\/+$/, '').toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(link);
  };
  for (const l of base) push(l);
  for (const url of Array.isArray(extra) ? extra : []) {
    if (typeof url === 'string' && url) push({ type: linkTypeFromUrl(url), url });
  }
  return out;
}

function linkTypeFromUrl(url: string): PersonLink['type'] {
  const host = hostname(url)?.toLowerCase() ?? '';
  if (host.includes('linkedin')) return 'linkedin';
  if (host.includes('twitter') || host === 'x.com' || host.endsWith('.x.com')) return 'twitter';
  if (host.includes('github')) return 'github';
  return 'website';
}

// freshestFirst and formatShortDate USED TO BE HERE. Both existed only for the
// TimelineCard and the EnrichmentCard's source list, neither of which anything
// rendered.

function hostname(url?: string): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return undefined;
  }
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}



function formatRelative(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const diff = Date.now() - d.getTime();
  const day = 24 * 60 * 60 * 1000;
  if (diff < day) return 'Today';
  if (diff < 2 * day) return 'Yesterday';
  if (diff < 7 * day) return `${Math.round(diff / day)} days ago`;
  if (diff < 30 * day) return `${Math.round(diff / (7 * day))} weeks ago`;
  return formatDate(iso);
}

/**
 * The "pinned, and here's why" strip. Renders NOTHING unless this contact is
 * actually a favorite with tags, so it costs an unpinned person no space at all.
 *
 * Shares the ['favorites'] query key with the People tab, so opening a person after
 * scrolling the grid reads it straight out of the cache with no second request, and
 * unpinning someone updates both places at once.
 *
 * The favorite's NOTE is not rendered here: it is written to the contact as a real
 * note (POST /v1/me/favorites → insertContactNote), so it belongs in "What Amber
 * Knows" with everything else you have said about them rather than in a second,
 * competing place. It only started appearing there once getFactsForContact was taught
 * to read contact_notes as well as contact_facts.
 */
function FavoritePinCard({ contactId }: { contactId: string }) {
  const favQuery = useQuery({
    queryKey: ['favorites'],
    queryFn: async () => unwrapOrThrow(await listFavorites()).favorites,
    staleTime: 60_000,
  });
  const fav = (favQuery.data ?? []).find((f) => String(f.id) === String(contactId));
  const tags = fav?.tags ?? [];
  if (!fav || tags.length === 0) return null;
  return (
    <DCard>
      <View style={{ gap: spacing.sm }}>
        <Text variant="microLabel" uppercase>
          Pinned
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
          {tags.map((t, i) => (
            <View
              key={`${t}-${i}`}
              style={{
                paddingHorizontal: spacing.sm,
                paddingVertical: 4,
                borderRadius: radius.full,
                borderWidth: 1,
                borderColor: 'rgba(140,73,26,0.35)',
                backgroundColor: 'rgba(178,98,45,0.08)',
              }}
            >
              <Text variant="captionSm" style={{ color: '#8C491A' }}>
                {t.toUpperCase()}
              </Text>
            </View>
          ))}
        </View>
      </View>
    </DCard>
  );
}
