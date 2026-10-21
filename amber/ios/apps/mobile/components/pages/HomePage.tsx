import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useChat } from '../../lib/ChatContext';
import { ActionSheetIOS, ActivityIndicator, Alert, InteractionManager, Modal, RefreshControl, ScrollView, Share, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import * as Clipboard from 'expo-clipboard';
import { Pressable } from '../Pressable';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Check, ChevronRight, MoreHorizontal, NotebookPen, X } from 'lucide-react-native';
import { Avatar } from '../Avatar';
import {
  deleteConversation,
  getConversation,
  listConversations,
  type ConversationSummary,
} from '../../lib/conversations';
import {
  acceptConnectRequest,
  declineConnectRequest,
  listIncomingRequests,
  networkFeed,
  type IncomingRequest,
  type NetworkPost,
} from '../../lib/connect';
import { getInbox } from '../../lib/questions';
import { errorCopy, medhaIdErrorCopy, unwrapOrThrow } from '../../lib/medhaId';
import { spacing } from '../../lib/tokens';
import { hFont, hc } from '../../lib/homeSurface';
import { HAIRLINE, cl, clLayout } from '../../lib/classical';
import { CCard, CFootnote, CSectionHeader, CText } from '../classical';
import { FeedHeader, type WeekDay } from '../SharedHeader';
import { PendingConfirmCard } from '../PendingConfirmCard';
import { NoteSharingModal } from '../NoteSharingModal';
import { ContactPickerModal } from '../ContactPickerModal';
import { listPendingTags, resolvePendingTag, retagNote } from '../../lib/noteTags';
import { NewContactModal } from '../NewContactModal';
import { ReminderSheet } from '../ReminderSheet';
import { LinkContactPrompt } from '../LinkContactPrompt';
import { clearPendingNote, usePendingNote, LOCAL_NOTE_PREFIX } from '../../lib/pendingNote';
import { collapseStrip, useStripExpanded } from '../../lib/monthStrip';
import { conversationsForDay, dayKey, getWeekDates } from '../../lib/calendarStrip';
import { getNetworkFeed, type FeedItem } from '../../lib/noteShares';
import { listReminders, setReminderDone, type Reminder } from '../../lib/reminders';
import { usePendingResolutions, resolvePending, declinePending } from '../../lib/pending';
import { api, unwrapSingle, type Me } from '../../lib/api';
import { toast } from '../../lib/toast';
import { Crossfade, FadeInUp } from '../../lib/motion';
import { HomeTabs, type HomeTab } from '../HomeTabs';
import { DayAgenda } from '../DayAgenda';
import { EventDetail } from '../EventDetail';
import { CalendarSyncSheet } from '../CalendarSyncSheet';
import { OpenReminders } from '../OpenReminders';
import {
  ScheduleEditor,
  subjectFromReminder,
  type EditorSubject,
} from '../ScheduleEditor';
import { agendaTargetOf, blankEventDraft } from '../../lib/scheduleEdits';
import { localDateKey } from '../../lib/openReminders';
import { JOURNAL_KIND, type JournalKind } from '../../lib/journalKinds';
import { dayBounds } from '../../lib/agenda';
import type { AgendaItem } from '../../lib/agenda';
import { PostCommentsSheet, ReactorsSheet } from '../PostSocial';
import { NO_SOCIAL } from '../../lib/postSocial';
import { FeedCard } from '../FeedCard';
import {
  narrowSummary,
  noteActions,
  postActions,
  type FeedActions,
  type FeedComment,
} from '../../lib/feedSocial';
import { NAMED_COLORS } from '../../lib/circleColors';
import { listCircles } from '../../lib/circles';

// How many of your own items Home shows before offering to show the rest. Five,
// and the cap is on the PERSONAL SECTION as a whole -- the notes you took today,
// however many of each kind -- because the point of the cap is that "From your
// network" stays reachable without scrolling. The remainder is visibly there
// behind a chip rather than silently hidden behind tapping today's date, which
// read as the notes having been lost.
const RECENT_NOTES_SHOWN = 5;

// One key, named once. The optimistic tick writes to it and pull-to-refresh
// invalidates it, and those two disagreeing is a tick that appears to save and
// then un-saves itself on the next refresh.
const REMINDERS_KEY = ['reminders', 'self'] as const;

/**
 * HOW LOUD A NOTE IS, and why the card decides it rather than the server.
 *
 * The three tiers, loudest first:
 *
 *   people   — the note is ABOUT SOMEONE. It named a person and that person
 *              resolved to a contact, so it went in their file. This is the
 *              whole product, so it gets the white card that lifts off the page
 *              and a people icon.
 *   journal  — a note to yourself: a thought, an idea, a voice journal. Real,
 *              worth keeping, not about anyone. Recessed card, journal icon.
 *   reminder — a thing to do at a time. The quietest, because its job is to
 *              come find you later; it does not need to hold the page now.
 *              Recessed card, clock icon.
 *
 * DERIVED, NOT STORED. `note.people` is the same list the "filed to" chips are
 * built from, and it only ever contains contacts the resolution pipeline
 * actually confirmed -- an unresolved name lives in the confirmation card until
 * you say who it is, and never becomes a chip. So "did this note land in
 * someone's file" is already answered by data we hold, and asking the server for
 * a `kind` column would be asking it to re-derive what the chips already know
 * (and would have meant touching the capture path, which is the one thing that
 * must not move).
 *
 * There is no mic icon in any tier, on purpose: how a note was ENTERED (spoken
 * or typed) is not what the reader wants to know at a glance, and it was the
 * only thing the old kicker said.
 */
type NoteTier = 'people' | 'journal' | 'reminder';

function tierOf(note: ConversationSummary): NoteTier {
  const filed = (note.people ?? []).some((p) => p && p.contactId != null);
  if (filed) return 'people';
  return 'journal';
}

/**
 * WHERE A CARD SITS IS DECIDED ONCE, AND THEN IT SITS THERE.
 *
 * "It showed up second in the order, then flashed up to first in the order, and
 * then went back down to second."
 *
 * All three positions were correct in turn, which is the problem. `tierOf` is
 * recomputed on every refetch and it reads `note.people`, which arrives late:
 *
 *   the note lands, nobody resolved yet  -> journal, rank 1 -> SECOND
 *   `freshIds` registers it              -> fresh wins     -> FIRST
 *   resolution finds nobody              -> journal again  -> SECOND
 *
 * Prominence ranking is the spec and it stays. What cannot stay is the sort key
 * CHANGING under a card that is already on screen: a list that reorders itself
 * while you read it is worse than a list ordered slightly wrong, because the
 * thing you were looking at is now somewhere else.
 *
 * So the tier is captured the first time a note is seen and then frozen for the
 * life of the screen. A note whose people arrive a second later gets its NOTE
 * label and its louder type -- the card changes, its position does not.
 *
 * A note seen for the first time with nobody filed yet is ranked `people`, not
 * `journal`. That is the optimistic choice on purpose: almost every note tags
 * someone, it matches what the card already does visually while it waits (the
 * `pending` row in TIER is the loud one), and being briefly one rank too high
 * is invisible while being one rank too low is the jump above.
 */
function useFrozenTiers(): (note: ConversationSummary) => NoteTier {
  const frozen = useRef(new Map<string, NoteTier>());
  return useCallback((note: ConversationSummary) => {
    const id = note.conversationId;
    const seen = frozen.current.get(id);
    if (seen) return seen;
    const settled = (note.messageCount ?? 0) > 1;
    // Unsettled means resolution has not run, so `tierOf` cannot know yet.
    const tier: NoteTier = settled ? tierOf(note) : 'people';
    frozen.current.set(id, tier);
    return tier;
  }, []);
}

/**
 * WHAT THE CARD IS ALLOWED TO CLAIM YET.
 *
 * `tierOf` answers "did this note land in someone's file", and for a note that
 * finished processing that is a complete answer. For one recorded four seconds
 * ago it is not: `note.people` is empty because RESOLUTION HAS NOT RUN, not
 * because the note is about nobody. So the card labeled itself JOURNAL, the
 * chips arrived a moment later, and it relabelled itself NOTE in front of the
 * user.
 *
 * A label that corrects itself is worse than a label that arrives late, because
 * the first one was a claim and it was wrong. So there is a fourth state, and it
 * is the one a note is in until the server has actually spoken.
 *
 * `messageCount` is the signal, and it is a real one rather than a timer: a note
 * starts as one message (the transcript) and becomes two the moment Amber
 * answers, which is the same round trip that files the observations and resolves
 * the names. So messageCount <= 1 means "Amber has not finished with this yet".
 *
 * Gated on `fresh` as well, because a note from last week with a single message
 * is not pending — nothing more is coming for it — and it should show its real
 * kind rather than sit unlabelled forever.
 */
type NoteKind = NoteTier | 'pending';

function kindOf(note: ConversationSummary, fresh: boolean): NoteKind {
  if (fresh && (note.messageCount ?? 0) <= 1) return 'pending';
  return tierOf(note);
}

/**
 * ONE PERSONAL SECTION, TWO KINDS OF THING IN IT.
 *
 * Notes come from /v1/conversations and reminders from /v1/me/reminders/self,
 * and they are genuinely different rows -- but on the page they are one list
 * ranked by prominence, so they have to be sorted together rather than stacked
 * as two sections. Two sections would mean the cap applied twice (ten items,
 * not five) and "From your network" back below the fold.
 */
type PersonalItem = { key: string; at: number; fresh: boolean } & (
  | { tier: NoteTier; note: ConversationSummary }
  | { tier: 'reminder'; reminder: Reminder }
);

const TIER_RANK: Record<NoteTier, number> = { people: 0, journal: 1, reminder: 2 };

// Prominence first, then most recent. Ranking by tier is the spec ("if it tags
// someone it should be more prominent, a note to self less, reminders after
// that, that is the order") and it only reads right because everything in this
// list is from the same day -- a week-old note sorted above this morning's
// reminder would be absurd, and the day filter is what stops that happening.
function byProminence(a: PersonalItem, b: PersonalItem): number {
  // Just-captured leads, newest first, whatever kind it is. See the note on
  // `freshIds` at the call site for why this rank has to exist at all.
  if (a.fresh !== b.fresh) return a.fresh ? -1 : 1;
  const t = TIER_RANK[a.tier] - TIER_RANK[b.tier];
  return t !== 0 ? t : b.at - a.at;
}

// Per-tier presentation. One table rather than conditionals scattered through
// the card, so "make reminders quieter" is a one-line change here.
//
// `kind` IS THE COLOR, and it comes from lib/journalKinds rather than being
// picked here: "reminders purple, journal entries green, network notes burnt
// orange". The same three colors have to be right on this card, on the day
// view, and anywhere else these ever appear, so the table of them lives in a
// .ts file a test can load -- and the contrast of all three is checked by
// scripts/palette-check.mts, because a 10pt letter-spaced kicker in a new hue
// is exactly the thing that looks fine in review and cannot be read on a phone.
//
// `pending` has NO color for the same reason it has no label: nothing is known
// about the note yet, and a card that arrives green and turns orange a second
// later has told the reader something and then taken it back.
const TIER: Record<
  NoteKind,
  {
    label: string | null;
    tone: 'plain' | 'recessed';
    lines: number;
    bodySize: number;
    kind: JournalKind | null;
  }
> = {
  // No word and no icon until the kind is known. The card is the LOUD one while
  // it waits: that is the majority case, it is the shape the note will almost
  // certainly settle into, and starting quiet and getting loud would be the same
  // flinch in the other direction.
  pending: { label: null, tone: 'plain', lines: 8, bodySize: 16, kind: null },
  people: { label: 'NETWORK NOTE', tone: 'plain', lines: 8, bodySize: 16, kind: 'network' },
  journal: { label: 'JOURNAL', tone: 'recessed', lines: 5, bodySize: 15, kind: 'journal' },
  reminder: { label: 'REMINDER', tone: 'recessed', lines: 3, bodySize: 15, kind: 'reminder' },
};
// How old a network item may be and still count as "what people are doing".
const FEED_MAX_AGE_MS = 2 * 24 * 60 * 60 * 1000;

function HomePageBase({
  goToPage,
  openPerson,
  onOpenNote,
  openReminderId = null,
  onReminderConsumed,
  onAsk,
  onMessages,
  messagesUnread = 0,
  onSettings,
}: {
  goToPage: (index: number) => void;
  openPerson: (id: string) => void;
  /**
   * Open the Messages panel -- the conversations and the address book, behind
   * the button in the top-left corner of this page's header.
   *
   * OWNED BY home.tsx, NOT BY THIS PAGE. The panel has to cover the app's one
   * bottom bar and the tab pill, and both of those are rendered above the pager
   * that this page is a page of. A layer mounted in here would open underneath
   * them. Same arrangement as the Ask overlay directly below.
   */
  onMessages?: () => void;
  /**
   * THE GEAR IN THE TOP-RIGHT, WHICH IS NO LONGER A MOCK.
   *
   * Owned by the route rather than by this page, the same way onMessages is: a
   * page inside a pager should not be pushing routes, and app/(gated)/home.tsx
   * already holds the router for exactly this reason.
   */
  onSettings?: () => void;
  /** Conversations with anything unread, for the dot on that button. */
  messagesUnread?: number;
  /**
   * A reminder to open on arrival, from a tapped notification. The id is the
   * server row's; the sheet renders whatever the reminders query holds for it.
   */
  openReminderId?: string | null;
  /** Called once the sheet has taken the id, so a re-render cannot re-open it. */
  onReminderConsumed?: () => void;
  /**
   * Open the Ask surface on a question. The shared bar lives above the pager
   * (home.tsx owns it), so anything on this page that wants to hand something
   * to Amber asks for it rather than mounting a second bar.
   */
  onAsk?: (question: string) => void;
  /**
   * Expand a voice note into the Ask surface.
   *
   * THE OVERLAY IS NOT OWNED HERE ANY MORE. It used to be mounted by this page,
   * which was fine while Today was the only place that opened it -- but the
   * shared bar can now open Ask from Profile too, and two mounts would mean two
   * chat heads with two histories, each thinking it was the Ask surface. It
   * lives once in home.tsx and this asks it to open.
   */
  onOpenNote: (conversationId: string) => void;
}) {
  const qc = useQueryClient();

  const { homeNoteVersion, notifyHomeNote } = useChat();
  const tierFor = useFrozenTiers();

  // Persistent "who did you mean" confirmations, fetched from the server and
  // shown on the feed — so a note recorded then abandoned still gets resolved.
  const {
    items: pendingItems,
    remove: removePending,
    restore: restorePending,
  } = usePendingResolutions(homeNoteVersion);
  // "Add <name>" opens the form first. Creating a bare name-only contact and
  // hoping the user goes back to fill it in later is what this replaces.
  const [addingFor, setAddingFor] = useState<{ pendingId: number; rawName: string } | null>(null);
  const [savingNew, setSavingNew] = useState(false);

  // Returns whether the card is SETTLED. The card uses this to decide whether to
  // stay lit and locked or re-enable itself, so a failed resolve — or a form the
  // user backs out of — leaves a card you can actually tap again.
  const handleResolvePending = useCallback(
    async (pendingId: number, contactId: string): Promise<boolean> => {
      const rawName = pendingItems.find((p) => p.pendingId === pendingId)?.rawName ?? '';
      if (contactId === '__new__') {
        // Do NOT optimistically remove the card here: the form can be cancelled,
        // and a card that vanished on the way to a form the user backed out of is
        // a confirmation silently lost. Not settled, for the same reason.
        setAddingFor({ pendingId, rawName });
        return false;
      }
      removePending(pendingId);
      const res = await resolvePending(pendingId, contactId);
      if (!res.ok) {
        // SAY SO. This branch used to do nothing at all, which is why a server
        // error here was invisible: the card vanished on tap and came back on the
        // next launch, over and over, with no indication anything had failed.
        toast.error('Could not save that. Try again.');
        if (rawName) restorePending(rawName);
        return false;
      }
      // Refresh the feed tags once the server has applied the resolution.
      setTimeout(() => notifyHomeNote(), 500);
      // Adding someone from a spoken name creates a contact with nothing on it
      // but the name, so open them — that is the moment the user still remembers
      // who they are and what to write down.
      const created = res.data?.createdContactId;
      if (created) setTimeout(() => openPerson(String(created)), 220);
      return true;
    },
    [pendingItems, removePending, restorePending, notifyHomeNote, openPerson],
  );

  // Expand a Today voice note: open the full-screen Ask overlay right here on
  // Home ("Ask two"), which is its own chat head, so it never drags the People
  // tab's Ask ("Ask one") onto the same note. Closing returns to Today.
  const openInAsk = onOpenNote;

  /**
   * THE `me` QUERY IS GONE FROM HERE, and that is the whole of it: this page
   * fetched it only to build "Good evening, Karthik", which is gone -- "get rid
   * of that Good Evening Karthik and everything else entirely". A page that
   * opens by telling you your own name spends the top of the screen on the one
   * thing you already know.
   *
   * The feed section still needs it, for the reader's own face beside "Add a
   * comment...", and fetches it there under the same ['me'] key -- so it is one
   * request either way, asked for by the part that actually uses it.
   */

  const today = useMemo(() => new Date(), []);
  const weekDates = useMemo(() => getWeekDates(today), [today]);

  // A SELECTED DAY REPLACES THE PAGE. It used to open a modal over it, which meant
  // the day's notes lived in a different-looking container than the same notes on
  // Today, and getting back out meant finding a close button. Tapping July 6 should
  // just BE July 6 — same header, same cards, same everything, with today's date as
  // the way home. null means today.
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);
  /**
   * YOU / FEED. Two halves of what was one very long page.
   *
   * "It should just be a reorganization of this stuff into two separate tabs...
   *  None of the functionality changes."
   *
   * So nothing below was deleted or rewritten -- every section is the component
   * it already was, and this only decides which of them are on screen. Your own
   * day and your own notes are You; what your connections have shared is Feed.
   */
  const [tab, setTab] = useState<HomeTab>('you');
  /** The thing on your day that is open as a full page. null is closed. */
  const [openEvent, setOpenEvent] = useState<AgendaItem | null>(null);
  /**
   * THE ROW SOMEBODY IS EDITING.
   *
   *   "If I click on that event, then I should be able to edit that event."
   *
   * Amber's own events and the untimed reminders open the editor. A row read off
   * the phone's calendar opens the read-only page instead: deviceCalendar.ts
   * asks for read permission and never write, so Save on one of those would mean
   * asking for a permission the app has never asked for, to change a row that
   * belongs to iCloud. See isEditable.
   */
  const [editing, setEditing] = useState<EditorSubject | null>(null);
  /**
   * The calendar-connecting sheet. Offered from the empty day ONLY while nothing
   * is connected -- once one calendar is in, the day fills up, the offer stops
   * being drawn, and Settings is where somebody goes to change it.
   */
  const [syncOpen, setSyncOpen] = useState(false);
  const [serverConversations, setServerConversations] = useState<ConversationSummary[]>([]);
  const [convStatus, setConvStatus] = useState<'loading' | 'done' | 'error'>('loading');

  // THE NOTE YOU JUST RECORDED, merged in ahead of the server's copy.
  //
  // Derived rather than pushed into state so every consumer below — the day
  // counts, today's threads, the selected-day list — sees it without knowing it
  // exists. See lib/pendingNote for why the card cannot wait for the round trip.
  //
  // Matched on the first 60 characters of the preview because the server's preview
  // IS the transcript we already hold; this is a string equality check, not a
  // similarity guess. When it matches, the real row has landed and the stand-in
  // disappears in the same render the real one appears in.
  /**
   * THE DAY BEING LOOKED AT, FETCHED AS A DAY.
   *
   * "My notes and journals from yesterday are not showing up either. In some
   *  cases, that needs to show up all the time."
   *
   * The list above asks for the newest thirty threads and nothing else, and this
   * page then sorted them into days itself -- so a day was visible only if it
   * happened to fall inside those thirty. Every Ask conversation is a thread in
   * the same table, so thirty is one busy day; after that, yesterday's notes are
   * still on the server, perfectly intact, and unreachable. Which looks exactly
   * like a note that never saved, and is the one thing this app cannot look like.
   *
   * SO THE DAY IS ASKED FOR DIRECTLY, and UNIONED with the recent list rather
   * than replacing it -- because the recent list has a second job. The week
   * strip's underbars are per-day COUNTS built from it (see daysWithNotes
   * below), and a fetch narrowed to one day would empty every other day's bar.
   * Two questions, two answers, merged: "what happened lately" for the strip,
   * "what happened on this day" for the list.
   *
   * Keyed on the day's own key rather than the Date, since `today` is a fresh
   * object on every render and would refetch forever.
   *
   * dayBounds COMES FROM lib/agenda, which already had it -- local midnight to
   * local midnight, half-open, and built by asking for the next CALENDAR day
   * rather than adding 86,400,000, so the two days a year that are not 24 hours
   * long still have every hour in exactly one day. Writing a second one next to
   * dayKey was the first attempt here and it was the same mistake this session
   * has now fixed twice elsewhere: two functions with one name and slightly
   * different shapes, drifting quietly apart.
   */
  const [dayConversations, setDayConversations] = useState<ConversationSummary[]>([]);
  const viewDayKey = dayKey(selectedDay ?? today);
  useEffect(() => {
    let alive = true;
    const { start, end } = dayBounds(selectedDay ?? new Date());
    listConversations({ from: new Date(start), to: new Date(end) }).then((res) => {
      if (!alive) return;
      if (res.ok) setDayConversations(res.data?.conversations ?? []);
      // A FAILURE LEAVES THE RECENT LIST IN CHARGE rather than blanking the day.
      // This fetch adds completeness; it is not the only source, so losing it
      // degrades to the old behavior instead of to an empty page.
    });
    return () => {
      alive = false;
    };
  }, [viewDayKey, homeNoteVersion, selectedDay]);

  /**
   * The two lists as one, newest first, each thread once.
   *
   * DEDUPED BY conversationId, because the day being viewed is usually today and
   * today's rows are in both answers -- without this, every note on the current
   * day would be drawn twice.
   */
  const allConversations = useMemo<ConversationSummary[]>(() => {
    const byId = new Map<string, ConversationSummary>();
    for (const c of serverConversations) byId.set(c.conversationId, c);
    // The windowed answer wins on a tie: it is the more complete read of that
    // day, and the newer one.
    for (const c of dayConversations) byId.set(c.conversationId, c);
    return [...byId.values()].sort((a, b) => {
      const ta = a.lastAt ? Date.parse(a.lastAt) : 0;
      const tb = b.lastAt ? Date.parse(b.lastAt) : 0;
      return tb - ta;
    });
  }, [serverConversations, dayConversations]);

  const pendingNote = usePendingNote();
  const pendingLanded =
    !!pendingNote &&
    allConversations.some(
      (c) => (c.preview ?? c.title ?? '').slice(0, 60) === pendingNote.text.slice(0, 60),
    );
  const conversations = useMemo<ConversationSummary[]>(() => {
    if (!pendingNote || pendingLanded) return allConversations;
    return [
      {
        conversationId: pendingNote.conversationId,
        title: pendingNote.text.slice(0, 80),
        preview: pendingNote.text,
        lastAt: new Date(pendingNote.at).toISOString(),
        messageCount: 1,
        voice: true,
        // Normally empty — the server owns the chips. The scripted demo path fills
        // this so the tag is on the card the instant recording stops.
        people: pendingNote.people ?? [],
      },
      ...allConversations,
    ];
  }, [allConversations, pendingNote, pendingLanded]);

  useEffect(() => {
    if (pendingLanded) clearPendingNote();
  }, [pendingLanded]);

  // WHICH NOTES APPEARED WHILE THE USER WAS LOOKING AT THIS PAGE.
  //
  // Ranking strictly by prominence meant a note recorded ten seconds ago sorted
  // BELOW every tagged note from earlier today -- so you finish speaking, look
  // at Home, and your note is somewhere in the middle of the list or under the
  // "show all" fold. The optimistic card exists precisely so the thing you just
  // said is on the page before the server has answered; sorting it into the
  // middle throws that away and reads exactly like a capture that did not work,
  // which is the failure this app can least afford.
  //
  // So this is a SNAPSHOT of the ids present at the first successful load;
  // anything not in it arrived since, i.e. the user made it just now. Two
  // properties matter:
  //
  //   * it survives the local stand-in being replaced by the real server row --
  //     NEITHER id is in the baseline, so the card does not drop down the list
  //     the moment the round trip completes;
  //   * it is stable for the life of the mount, so the list never re-sorts
  //     itself under the reader's eyes. Next launch the baseline is the new
  //     list and strict prominence order applies again.
  //
  // A "recorded in the last N minutes" rule would have re-sorted the page when
  // the window expired, which is the same jump wearing a timer.
  const baselineIds = useRef<Set<string> | null>(null);
  if (baselineIds.current === null && convStatus === 'done') {
    baselineIds.current = new Set(serverConversations.map((c) => c.conversationId));
  }
  const freshIds = useMemo(() => {
    const base = baselineIds.current;
    const out = new Set<string>();
    if (!base) return out;
    for (const c of conversations) {
      if (!base.has(c.conversationId)) out.add(c.conversationId);
    }
    return out;
  }, [conversations]);

  useEffect(() => {
    let alive = true;
    // Do NOT blank the feed on a refetch: only the very first load shows a
    // loading state. Once we have notes, a refresh (after capturing a note or
    // resolving a tag) updates them in place, so the feed never flashes empty
    // and then repopulates.
    listConversations().then((res) => {
      if (!alive) return;
      if (res.ok) {
        setServerConversations(res.data?.conversations ?? []);
        setConvStatus('done');
      } else {
        setConvStatus((s) => (s === 'loading' ? 'error' : s));
      }
    });
    return () => {
      alive = false;
    };
    // Refetch when a home voice note is captured, so it appears in Today.
  }, [homeNoteVersion]);

  // Delete a voice note. Optimistically drop it from state so it leaves both the
  // Today feed and the calendar underbars at once; on failure, refetch to
  // restore the true list.
  const removeConversation = useCallback((id: string) => {
    setServerConversations((prev) => prev.filter((c) => c.conversationId !== id));
    void deleteConversation(id).then((res) => {
      if (!res.ok) {
        toast.error('Could not delete that note.');
        void listConversations().then((r) => {
          if (r.ok) setServerConversations(r.data?.conversations ?? []);
        });
      }
    });
  }, []);

  // How many conversations landed on each day. The reference's day strip sizes
  // its gold underbar by how much happened, so this is a count, not a boolean.
  const chatCounts = useMemo((): Map<string, number> => {
    const m = new Map<string, number>();
    for (const c of conversations) {
      if (!c.lastAt) continue;
      const d = new Date(c.lastAt);
      if (Number.isNaN(d.getTime())) continue;
      const k = dayKey(d);
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return m;
  }, [conversations]);

  const todayKey = dayKey(today);
  // What you journaled / asked today — the open threads that replace the old
  // "Amber's read" card.
  const todaysThreads = useMemo(
    () => conversationsForDay(conversations, today),
    [conversations, today],
  );

  // Which day the page IS. null means today, and today is the full page — the notes
  // plus the inbox plus what your network shared. Any other day is just that day's
  // notes: there is no "pending confirmation" or "shared with you" that belongs to
  // last Tuesday, and showing empty sections for them would make the day look broken
  // rather than quiet.
  const viewDate = selectedDay ?? today;
  const isDayView = selectedDay !== null;
  // Expanded in place, so seeing everything you said today never requires
  // knowing that the date strip is tappable.
  const [showAllToday, setShowAllToday] = useState(false);
  // ── Reminders ──────────────────────────────────────────────────────────
  //
  // Server-side now (see medha-id routes/self-reminders-me.js), so this is the
  // same list on a new phone. Refetched on `homeNoteVersion` because a voice
  // note is one of the two ways a reminder gets created -- say "remind me to
  // call Sagar at five" and the parse step writes the row, so the card has to
  // appear without a pull-to-refresh.
  // A STABLE KEY, AND A REFETCH WHEN A NOTE LANDS.
  //
  // This key used to carry `homeNoteVersion`, which bumps on every captured
  // note. Putting it in the key made every capture a cache MISS: the data went
  // undefined and every reminder card vanished from Home the instant you
  // stopped recording, then reappeared when the fetch came back. Refetching a
  // stable key keeps the previous list on screen while the new one is in
  // flight, which is the whole difference between "it updated" and "it
  // flickered".
  const remindersQuery = useQuery({
    queryKey: REMINDERS_KEY,
    queryFn: listReminders,
    staleTime: 30_000,
  });

  // Say "remind me to call Sagar at five" and the parse step writes the row, so
  // the card has to appear without a pull-to-refresh. Skips the first run --
  // useQuery has already fetched on mount.
  //
  // AFTER THE INTERACTIONS, because this fires the instant a capture finishes:
  // the recorder is dismissing, the optimistic card is animating in and
  // listConversations() is already in flight. A second response re-rendering
  // Home in that same window is how a smooth capture starts to stutter.
  const seenNoteVersion = useRef(homeNoteVersion);
  useEffect(() => {
    if (seenNoteVersion.current === homeNoteVersion) return;
    seenNoteVersion.current = homeNoteVersion;
    const handle = InteractionManager.runAfterInteractions(() => {
      void remindersQuery.refetch();
    });
    return () => handle.cancel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [homeNoteVersion]);

  // WHICH REMINDERS BELONG UNDER THE WORD "TODAY". Due today, or overdue, or
  // ticked off today. A reminder due next Thursday is real and set and will
  // arrive -- it is just not what today looks like, and putting it here would
  // make Today a to-do list of everything you have ever scheduled.
  const todaysReminders = useMemo(() => {
    const all = remindersQuery.data ?? [];
    const endOfToday = new Date(today);
    endOfToday.setHours(23, 59, 59, 999);
    return all.filter((r) => {
      if (r.done) return r.doneAt ? dayKey(new Date(r.doneAt)) === todayKey : false;
      if (!r.dueAt) return false;
      const d = new Date(r.dueAt);
      return !Number.isNaN(d.getTime()) && d.getTime() <= endOfToday.getTime();
    });
  }, [remindersQuery.data, today, todayKey]);

  const toggleReminder = useCallback(
    (reminderId: string, done: boolean) => {
      const key = REMINDERS_KEY;
      const before = qc.getQueryData<Reminder[]>(key);
      // Flip first. A checkbox that waits for a round trip reads as broken.
      qc.setQueryData<Reminder[]>(key, (prev) =>
        (prev ?? []).map((r) =>
          r.reminderId === reminderId
            ? { ...r, done, doneAt: done ? new Date().toISOString() : null }
            : r,
        ),
      );
      void setReminderDone(reminderId, done).then((ok) => {
        if (ok) return;
        // SAY SO AND PUT IT BACK. A tick that silently did not save is a
        // reminder the user believes they have dealt with.
        toast.error('Could not save that. Try again.');
        if (before) qc.setQueryData<Reminder[]>(key, before);
        else void remindersQuery.refetch();
      });
    },
    [qc, remindersQuery],
  );

  // ── The reminder a notification asked us to open ────────────────────────
  //
  // "When I clicked on the notification, it didn't do anything." It routed to
  // /(gated)/home?tab=today and stopped: no reminder, no person, just the day.
  // The payload now carries the reminder id (see lib/reminders.ts) and home.tsx
  // hands it down here.
  //
  // Copied into local state and CONSUMED, rather than read from the prop
  // directly, for the same reason the notification bridge dedupes taps: the prop
  // survives re-renders, so rendering off it would re-open the sheet every time
  // the user dismissed it.
  const [sheetReminderId, setSheetReminderId] = useState<string | null>(null);
  // WHO WE JUST CONNECTED WITH, so Amber can ask once which card in the address
  // book is them. Owned here rather than in the requests section, which returns
  // null as soon as its list empties.
  const [askLinkFor, setAskLinkFor] = useState<{ amberId: string; name: string } | null>(null);
  useEffect(() => {
    if (!openReminderId) return;
    setSheetReminderId(openReminderId);
    onReminderConsumed?.();
    // The banner fired because the reminder came due, which is exactly when the
    // cached list is a minute stale and may not contain it at all.
    void remindersQuery.refetch();
    // remindersQuery is intentionally not a dep: it changes identity on every
    // fetch, and this must run once per arriving id.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openReminderId]);

  const sheetReminder = useMemo(
    () =>
      sheetReminderId
        ? ((remindersQuery.data ?? []).find((r) => r.reminderId === sheetReminderId) ?? null)
        : null,
    [sheetReminderId, remindersQuery.data],
  );

  // SAY SO WHEN IT IS GONE. A reminder ticked off on another device, or fired
  // and aged out, would otherwise leave the sheet sitting on "Opening that
  // reminder..." forever -- which is the same silence this whole change is
  // about. Only once the list has actually loaded.
  useEffect(() => {
    if (!sheetReminderId || sheetReminder) return;
    if (remindersQuery.isFetching || !remindersQuery.isFetched) return;
    setSheetReminderId(null);
    toast.info('That reminder is no longer on your list.');
  }, [sheetReminderId, sheetReminder, remindersQuery.isFetching, remindersQuery.isFetched]);

  const dayThreads = useMemo(
    () => (selectedDay ? conversationsForDay(conversations, selectedDay) : todaysThreads),
    [conversations, selectedDay, todaysThreads],
  );
  // Notes and reminders, one list, ranked by prominence. Reminders only on
  // Today: a day view is what you journaled that day, and a reminder is not a
  // thing that happened, it is a thing that is going to.
  const personalItems = useMemo<PersonalItem[]>(() => {
    const items: PersonalItem[] = dayThreads.map((n) => ({
      key: `n:${n.conversationId}`,
      // Frozen on first sight — see useFrozenTiers. The card's LABEL still comes
      // from kindOf() below and still updates; only its slot is fixed.
      tier: tierFor(n),
      at: n.lastAt ? Date.parse(n.lastAt) || 0 : 0,
      fresh: freshIds.has(n.conversationId),
      note: n,
    }));
    if (!isDayView) {
      for (const r of todaysReminders) {
        items.push({
          key: `r:${r.reminderId}`,
          tier: 'reminder',
          at: r.dueAt ? Date.parse(r.dueAt) || 0 : 0,
          // A reminder is never "just captured" in this sense: the NOTE that
          // created it is, and that note is the card the user is looking for.
          fresh: false,
          reminder: r,
        });
      }
    }
    return items.sort(byProminence);
  }, [dayThreads, todaysReminders, isDayView, freshIds, tierFor]);

  // WHAT THE SEE-MORE CHIP SAYS. Reminders sort last by design, so a busy day of
  // notes can push every one of them under the fold -- and a reminder you cannot
  // see is a reminder that does not work. Naming them in the chip turns a silent
  // truncation into an offer.
  const hiddenLabel = useMemo(() => {
    const hidden = personalItems.slice(RECENT_NOTES_SHOWN);
    const reminders = hidden.filter((i) => i.tier === 'reminder').length;
    if (reminders === 0) return `Show all ${personalItems.length} from today`;
    if (reminders === hidden.length) {
      return `Show ${reminders} more reminder${reminders === 1 ? '' : 's'}`;
    }
    return `Show ${hidden.length} more \u00b7 ${reminders} reminder${reminders === 1 ? '' : 's'}`;
  }, [personalItems]);

  const week: WeekDay[] = useMemo(
    () =>
      weekDates.map((d) => {
        const k = dayKey(d);
        return {
          key: k,
          date: d,
          dow: d.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase(),
          n: d.getDate(),
          today: k === todayKey,
          ahead: d.getTime() > today.getTime() && k !== todayKey,
          marks: chatCounts.get(k) ?? 0,
        };
      }),
    [weekDates, todayKey, today, chatCounts],
  );

  // The month strip lives in the header and can be closed from here; see
  // lib/monthStrip for why this is a module store and not a prop.
  const stripOpen = useStripExpanded();
  const [headerH, setHeaderH] = useState(0);

  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['connect', 'incoming'] }),
      qc.invalidateQueries({ queryKey: ['connect', 'feed'] }),
      // The reminders on the same page. Pulling down on Today and having the
      // notes refresh while the reminders above them did not is the kind of
      // half-refresh that reads as a stale app.
      qc.invalidateQueries({ queryKey: ['reminders', 'self'] }),
      // THE NOTES THEMSELVES. Pull-to-refresh reloaded the network feed and the
      // incoming list and pointedly not the one thing the user is looking at when
      // they pull down on Today. The notes are plain state rather than a query, so
      // they need their own reload rather than an invalidation.
      listConversations().then((res) => {
        if (res.ok) setServerConversations(res.data?.conversations ?? []);
      }),
    ]);
    setRefreshing(false);
  };

  return (
    /**
     * NO KeyboardAvoidingView. THERE IS NOTHING ON THIS SCREEN TO AVOID IT FOR.
     *
     * "There's just a little bit of lagginess in the direct messages area and
     *  everywhere in general, a bit of a lag."
     *
     * This was `<KeyboardAvoidingView behavior="padding">` wrapping the entire
     * page, and HomePage contains no TextInput -- not one. Every field you can
     * type into on this screen is somewhere else: the search bar is rendered by
     * app/(gated)/home.tsx OUTSIDE this component (so this never moved it), the
     * Messages panel is its own sheet, and each modal brings its own.
     *
     * So it avoided nothing and cost plenty. On every keyboard show and hide it
     * animated the padding of the largest subtree in the app -- header, week
     * strip, month strip, agenda, notes list, feed -- which is a full layout
     * pass per frame of its own animation. AskChat had already found the same
     * thing and written it down: "it runs its OWN animation on its own curve, so
     * the composer visibly chased the keyboard up instead of riding it."
     *
     * It also fought the ScrollView below, which sets
     * keyboardDismissMode="interactive": dragging the keyboard down changes the
     * container's height mid-gesture, under the finger doing the dragging.
     *
     * If a text field is ever added to this page, it does NOT come back -- see
     * AskChat for the pattern, which drives the same padding from the keyboard's
     * own curve so the two are one motion instead of two.
     */
    <View style={{ flex: 1, backgroundColor: 'transparent' }}>
      <View style={{ flex: 1 }}>
        {/* mockup-1's header: gold day kicker, big serif date, Month pill, the
            seven-day strip. The strip's gold underbars are sized by how many
            conversations that day actually holds. */}
        {/* Measured so the tap-to-close layer below starts exactly where the
            calendar ends — the header's height changes as the month opens. */}
        <View onLayout={(e) => setHeaderH(e.nativeEvent.layout.height)}>
        <FeedHeader
          // The header shows the day you are LOOKING AT, not always today. It is the
          // same component with a different date, which is the point: nothing about
          // the page should announce that you are somewhere special.
          week={week}
          monthAnchor={viewDate}
          selectedKey={selectedDay ? dayKey(selectedDay) : null}
          todayKey={todayKey}
          keyFor={dayKey}
          countFor={(k) => chatCounts.get(k) ?? 0}
          // Tapping TODAY'S date is how you get back. Selecting it explicitly would
          // technically work too, but then "today" would be a day-view of today —
          // same notes, minus the network feed and the inbox — which is not what the
          // date under your thumb means.
          // AND IT TAKES YOU TO THAT DAY. The strip stays visible on Feed --
          // it is the page's header, not You's -- so tapping a date there has
          // to go somewhere, and "what I had on Tuesday" is the only thing it
          // can mean. Selecting a day while reading the feed and having nothing
          // happen is the version of this that reads as broken.
          onSelectDay={(d) => {
            setSelectedDay(dayKey(d) === todayKey ? null : d);
            setTab('you');
          }}
          onMessages={onMessages}
          unread={messagesUnread}
          onSettings={onSettings}
        />
        </View>
        {/* The pill. Pressed, never swiped -- see HomeTabs for why a second
            horizontal gesture inside the app's pager is one that works only
            sometimes. */}
        <HomeTabs active={tab} onChange={setTab} />

        <View style={{ flex: 1 }}>
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{
            paddingTop: clLayout.headerGap,
            paddingBottom: clLayout.fabClearance,
            gap: clLayout.sectionGap,
          }}
          // directionalLockEnabled: this list lives inside a horizontal pager. Without the
          // lock, iOS lets this scroll view claim a slightly-diagonal drag, so the swipe
          // between People / Today / You worked sometimes and did nothing other times
          // depending on the exact angle of the finger. The lock makes a mostly-horizontal
          // drag stay unclaimed here so the pager gets it, every time.
          directionalLockEnabled
          // keyboardDismissMode: a downward drag puts the keyboard away, tracking
          // the finger on iOS rather than snapping. The one bar is above this
          // page too, so the gesture has to work here for the same reason it has
          // to work on People.
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void onRefresh()}
              tintColor={cl.ink38}
            />
          }
        >
          {/* ONE SCROLL VIEW, TWO CONTENTS, CROSSFADED.
              Not two mounted pages with one hidden: the feed would keep its
              queries warm and its scroll position, which sounds like a feature
              until a post you reacted to on a page you cannot see refetches
              underneath you. The fade is Crossfade from lib/motion, which is
              what the whole app uses and which respects reduce-motion. */}
          <Crossfade activeKey={tab} style={{ gap: clLayout.sectionGap }}>
          {tab === 'you' ? (
          <>
          {/* mockup-1's "Today ——— SAT 1 AUG" day rule. The reference's map card
              ("WHERE YOU HAVE BEEN") sits above this; omitted — the app holds no
              location data, and inventing places would be fabrication. */}
          <View>
            <DayRule
              label={isDayView ? viewDate.toLocaleDateString('en-US', { weekday: 'long' }) : 'Today'}
              date={viewDate
                .toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short' })
                .toUpperCase()}
            />
            {/* WHAT IS ACTUALLY ON THE DAY, above what you wrote about it.
                Your calendar, the plans Amber heard you make, and the reminders
                that have a time -- merged in lib/agenda.ts. This follows
                `viewDate`, so tapping a date in the strip shows that day's
                meetings above that day's notes and there is no second date
                anywhere to fall out of step. */}
            <View style={{ paddingHorizontal: clLayout.textGutter, paddingBottom: 6 }}>
              <DayAgenda
                day={viewDate}
                noteVersion={homeNoteVersion}
                // A BLANK EVENT ON THE DAY BEING LOOKED AT, not on today. The
                // whole point of the strip is that you are looking at Thursday;
                // adding from there and landing on Tuesday would be its own bug.
                onAddEvent={() =>
                  setEditing({
                    kind: 'event',
                    id: null,
                    personName: null,
                    draft: blankEventDraft(viewDate),
                  })
                }
                onOpenItem={(item) => {
                  const target = agendaTargetOf(item);
                  if (target?.kind === 'event' && item.detail) {
                    setEditing({
                      kind: 'event',
                      id: target.id,
                      personName: item.withPerson?.name ?? null,
                      draft: {
                        title: item.title,
                        description: item.detail.description ?? '',
                        place: item.detail.place ?? '',
                        startsAt: new Date(item.startsAt).toISOString(),
                        endsAt: item.endsAt ? new Date(item.endsAt).toISOString() : null,
                        allDay: item.allDay,
                        repeat: item.detail.repeat,
                        repeatUntil: item.detail.repeatUntil,
                        notifyMinutesBefore: item.detail.notifyMinutesBefore,
                      },
                    });
                    return;
                  }
                  setOpenEvent(item);
                }}
                onConnectCalendars={() => setSyncOpen(true)}
              />
            </View>

            {/* NOTES & JOURNAL. Everything you said, whoever it was about,
                colored by which of the three it is. An unscheduled reminder is
                here rather than on the day above -- "remind me to eventually
                start studying for the LSAT" is a note to self, and the split is
                the reminder's own due time. See lib/journalKinds. */}
            <CSectionHeader title="Notes & Journal" />
            {/*
              WHAT YOU STILL OWE, ABOVE WHAT YOU SAID.

              "There should be a reminder at the top of their notes and journals
               that says, 'Reminder: drink water.' If they check it off, it goes
               away for the day, but it's still on the next day."

              Reminders with no stated time are not calendar entries -- anything
              with a time is an event and is on the day above. These are open
              items, and they belong where you look for what is going on with
              you. Renders nothing at all when there are none.
            */}
            <View style={{ paddingHorizontal: clLayout.gutter }}>
              <OpenReminders
                onDate={localDateKey(viewDate)}
                version={homeNoteVersion}
                onOpen={(r) => setEditing(subjectFromReminder(r))}
              />
            </View>
            {/* No FadeInUp wrappers around the two inbox sections: they render
                null most of the time, and an empty wrapper still claimed a `gap`
                each — ~32pt of dead air under the read card. */}
            <View style={{ paddingHorizontal: clLayout.gutter, gap: clLayout.cardGap }}>
              {!isDayView && pendingItems.length > 0 ? (
                <View style={{ gap: clLayout.cardGap }}>
                  {pendingItems.map((p) => (
                    <PendingConfirmCard
                      key={p.pendingId}
                      item={p}
                      onResolve={handleResolvePending}
                      onDecline={(pendingId) => {
                        // Refusing a guess is not choosing a person: the server
                        // downgrades the row to a full clarify and re-issues it,
                        // so the candidate list is what comes back.
                        removePending(pendingId);
                        void declinePending(pendingId);
                        setTimeout(() => notifyHomeNote(), 600);
                      }}
                    />
                  ))}
                </View>
              ) : null}
              <FadeInUp index={0} step={60}>
                <TodayThreads
                  onDelete={removeConversation}
                  onOpenPerson={openPerson}
                  // FIVE on Today. The strip is the lid on the page, so the cap
                  // exists to keep "From your network" reachable without scrolling
                  // — and five fits now that the quiet tiers are shorter cards
                  // (three lines of a reminder, five of a journal note) rather than
                  // eight lines of transcript each. On a DAY view the notes are the
                  // entire page, so there is nothing to push down and no reason to
                  // truncate — that is precisely what you tapped the date to see.
                  items={
                    isDayView || showAllToday
                      ? personalItems
                      : personalItems.slice(0, RECENT_NOTES_SHOWN)
                  }
                  status={convStatus}
                  onOpen={openInAsk}
                  onToggleReminder={toggleReminder}
                  onOpenReminder={setSheetReminderId}
                />
              </FadeInUp>
              {!isDayView && !showAllToday && personalItems.length > RECENT_NOTES_SHOWN ? (
                <Pressable
                  onPress={() => setShowAllToday(true)}
                  hitSlop={8}
                  style={{ alignSelf: 'flex-start', paddingVertical: 6 }}
                >
                  <CText t="metaSm" color={cl.goldDeep}>
                    {hiddenLabel}
                  </CText>
                </Pressable>
              ) : null}
              {!isDayView ? <QuestionsInboxSection /> : null}
              {!isDayView ? <IncomingRequestsSection onConnected={setAskLinkFor} /> : null}
            </View>
          </View>

          <CFootnote>
            {isDayView
              ? 'Tap today’s date to come back.'
              : 'Amber keeps what you tell it on this phone.'}
          </CFootnote>
          </>
          ) : (
          <>
            {/* THE FEED IS NOT DAY-SCOPED and never was. What your connections
                posted is not a thing that happened on the Tuesday you tapped,
                so this ignores `selectedDay` entirely rather than filtering a
                network by your own calendar. */}
            <View>
              <CSectionHeader title="From your network" right="Shared with you" />
              <View style={{ paddingHorizontal: clLayout.gutter }}>
                <NetworkFeedSection />
              </View>
            </View>
            <CFootnote>What the people you are connected to have shared.</CFootnote>
          </>
          )}
          </Crossfade>
        </ScrollView>

        {/*
          THE CONTENT DISSIPATES UNDER THE TABS RATHER THAN BEING GUILLOTINED.

          "The feed and the You page scroll up with a hard cutoff against the
           You and Feed tabs above it. Let that be a nice dissipating fade
           there."

          A ScrollView clips at its own edge, so a card scrolling past the pill
          was cut off mid-pixel against it. This is a short gradient from the
          page's own color to transparent, laid over the top of the list and
          inert to touch -- so the text thins out into the band above it instead
          of ending at a line.

          THE PAGE'S OWN COLOR, not white. cl.groundMid is what the wash is at
          this height; a white fade would put a pale bar across a warm page,
          which is the seam this palette has a whole check script about.
        */}
        <LinearGradient
          pointerEvents="none"
          colors={[cl.groundMid, `${cl.groundMid}00`]}
          style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 22 }}
        />
        </View>

        {/* TAP ANYWHERE BELOW THE CALENDAR TO PUT IT AWAY.
            An open month covers most of the screen, and until now the only way
            out was a drag — so if the drag would not take, the app was unusable
            until it did. This sits over the content, never over the calendar
            itself (it starts at the measured header bottom), and it only exists
            while the month is open, so it can never swallow an ordinary tap. */}
        {stripOpen ? (
          <Pressable
            onPress={() => collapseStrip()}
            accessibilityRole="button"
            accessibilityLabel="Close the calendar"
            style={{
              position: 'absolute',
              top: headerH,
              left: 0,
              right: 0,
              bottom: 0,
            }}
          />
        ) : null}
      </View>


      {/* The expanded voice note = a full-screen Ask (its own head). Contact
          resolution is now handled by the persistent confirmation cards on the
          feed above, not a flaky live modal. */}
      {/* Adding someone Amber has never heard of. Asked for at the moment you are
          told the name is new, which is the moment you still remember who they
          are — not left as a bare name to be filled in later. */}
      <NewContactModal
        visible={!!addingFor}
        spokenName={addingFor?.rawName ?? ''}
        saving={savingNew}
        onCancel={() => setAddingFor(null)}
        onSave={(draft) => {
          const target = addingFor;
          if (!target) return;
          setSavingNew(true);
          void resolvePending(target.pendingId, '__new__', draft).then((res) => {
            setSavingNew(false);
            setAddingFor(null);
            if (!res.ok) {
              toast.error('Could not add them. Try again.');
              return;
            }
            removePending(target.pendingId);
            setTimeout(() => notifyHomeNote(), 500);
            const created = res.data?.createdContactId;
            if (created) setTimeout(() => openPerson(String(created)), 220);
          });
        }}
      />

      {/* The reminder itself, opened from a tapped banner or from its own card
          on Today. One sheet for both, so a reminder does not read differently
          depending on how you got to it. */}
      <ReminderSheet
        visible={!!sheetReminderId}
        reminder={sheetReminder}
        onClose={() => setSheetReminderId(null)}
        onOpenPerson={(id) => {
          setSheetReminderId(null);
          setTimeout(() => openPerson(id), 180);
        }}
        onToggleDone={toggleReminder}
        onAsk={onAsk}
      />

      {/* ONE THING ON YOUR DAY, OPENED AS A FULL PAGE.
          Mounted here rather than inside DayAgenda so it survives the section
          re-rendering under it -- a refetch while somebody is reading a meeting
          must not close the meeting. */}
      <EventDetail
        item={openEvent}
        onClose={() => setOpenEvent(null)}
        onOpenPerson={openPerson}
      />

      {/* THE EDITOR, mounted beside the detail page and for the same reason:
          a refetch under it must not close what somebody is editing. Saving
          bumps the same version the capture flow bumps, so the day and the
          strip both reload with the change. */}
      <ScheduleEditor
        subject={editing}
        onClose={() => setEditing(null)}
        onSaved={notifyHomeNote}
      />

      {/* Bringing in the phone's calendars, which is every account the person
          has added in iOS Settings at once. See CalendarSyncSheet for why that
          is the whole feature rather than a row of provider logos. */}
      <CalendarSyncSheet
        visible={syncOpen}
        onClose={() => setSyncOpen(false)}
        onConnected={() => {
          // Every cached day was assembled without a calendar, so the whole
          // prefix goes rather than just today's.
          void qc.invalidateQueries({ queryKey: ['agenda'] });
        }}
      />

      {/* "I found another Sagar Tiwari in your contacts. Is that this one?" —
          asked once, at the moment of connecting, and silent when there is
          nothing in the book that plausibly is them. */}
      <LinkContactPrompt
        visible={!!askLinkFor}
        amberId={askLinkFor?.amberId ?? null}
        personName={askLinkFor?.name ?? null}
        onClose={() => setAskLinkFor(null)}
        onLinked={() => {
          // Their card is now an Amber account, which changes how it renders
          // everywhere: the People list, the circle rows, the DM candidates.
          qc.invalidateQueries({ queryKey: ['contacts'] });
        }}
      />

    </View>
  );
}

// ── Feed ─────────────────────────────────────────────────────────

// A one-off BURNT_ORANGE (#C2410C) used to live here for the "Amber's read ·
// today" kicker, because no token was that saturated an orange. The Classical
// foundation makes that unnecessary: the microLabel variant now carries the gold.

// mockup-1's day rule: a big light serif day name, the date in tracked
// small-caps, then a hairline eating the rest of the width.
function DayRule({ label, date }: { label: string; date: string }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'baseline',
        gap: 10,
        paddingHorizontal: clLayout.textGutter,
        paddingBottom: 11,
      }}
    >
      <CText t="daySection">{label}</CText>
      <CText t="label" color={cl.ink36}>
        {date}
      </CText>
      <View style={{ flex: 1, height: HAIRLINE, backgroundColor: cl.ruleFaint }} />
    </View>
  );
}

// The reference's first feed card is a captured moment (avatar, name, quote,
// chips). This app has no captured moments — no voice notes, no transcripts — so
// the same slot carries the real thing we do have: Amber's read on the day.
// Replaces the old "Amber's read" card. This slot now shows the day's OWN
// threads — the voice notes and asks you added today — so the home surface is a
// journal you can look back on, not a generated summary.
function TodayThreads({
  items,
  status,
  onOpen,
  onDelete,
  onOpenPerson,
  onToggleReminder,
  onOpenReminder,
}: {
  items: PersonalItem[];
  status: 'loading' | 'done' | 'error';
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  onOpenPerson: (id: string) => void;
  onToggleReminder: (reminderId: string, done: boolean) => void;
  /** Expand one into the sheet. Tapping a card has to open the thing. */
  onOpenReminder: (reminderId: string) => void;
}) {
  return (
    <View style={{ gap: 12 }}>
      {status === 'loading' ? (
        <CText t="metaSm" color={cl.ink38} style={{ paddingVertical: 14 }}>
          Loading your notes…
        </CText>
      ) : items.length > 0 ? (
        <View style={{ gap: 12 }}>
          {items.map((item) =>
            'reminder' in item ? (
              <ReminderCard
                key={item.key}
                reminder={item.reminder}
                onToggle={() => onToggleReminder(item.reminder.reminderId, !item.reminder.done)}
                onOpenPerson={onOpenPerson}
                onOpen={() => onOpenReminder(item.reminder.reminderId)}
              />
            ) : (
              <VoiceNoteCard
                key={item.key}
                note={item.note}
                fresh={item.fresh}
                // A card that is still the local stand-in has no thread yet — the
                // `meta` event upgrades it within a few hundred milliseconds, and
                // until then a tap would open an empty overlay on an id the server
                // has never heard of.
                onPress={() => {
                  if (item.note.conversationId.startsWith(LOCAL_NOTE_PREFIX)) return;
                  onOpen(item.note.conversationId);
                }}
                onDelete={() => onDelete(item.note.conversationId)}
                onOpenPerson={onOpenPerson}
              />
            ),
          )}
        </View>
      ) : (
        /*
         * NOTHING SAID TODAY.
         *
         * This was a card with the Amber logo in it, which said nothing and
         * took up a card's worth of the page to say it -- "I don't want the
         * little egg card any more". A quiet line is the honest version: the
         * day is empty, and the bar at the bottom of the screen is already the
         * answer to what to do about that.
         */
        <View style={{ alignItems: 'center', paddingVertical: 26, gap: 8 }}>
          <NotebookPen size={20} color={cl.ink32} strokeWidth={1.7} />
          <CText t="metaSm" color={cl.ink38}>
            Nothing written down yet.
          </CText>
        </View>
      )}
    </View>
  );
}

/**
 * A reminder on Today: the quietest tier. A clock, what it is, when it is due,
 * and a circle you tap when you have done it.
 *
 * The tick is OPTIMISTIC and the caller owns the rollback. A checkbox that waits
 * for a round trip before it fills in feels broken -- you tap it, nothing
 * happens, you tap it again -- so the list state flips first and the PATCH
 * follows; a rejection puts it back and says so. See onToggleReminder.
 *
 * A done reminder stays on the page rather than vanishing, struck through and
 * dimmed, because an undo has to have something to undo. The server keeps it in
 * the list for a day and then it goes.
 */
function ReminderCard({
  reminder,
  onToggle,
  onOpenPerson,
  onOpen,
}: {
  reminder: Reminder;
  onToggle: () => void;
  onOpenPerson?: (id: string) => void;
  /**
   * Expand the reminder. "If I click on anything -- a reminder, a voice note, a
   * journal entry -- it should expand": every other tier on this feed opens
   * into something and this one did nothing but its checkbox.
   */
  onOpen?: () => void;
}) {
  const look = TIER.reminder;
  // Purple, the same purple the note list uses, and the same one on the day.
  const paint = JOURNAL_KIND.reminder;
  const due = reminder.dueAt ? new Date(reminder.dueAt) : null;
  const dueValid = due && !Number.isNaN(due.getTime());
  const overdue = !!dueValid && !reminder.done && due.getTime() < Date.now();
  // "6:00 PM" for today, "Wed 6:00 PM" for anything else. A bare time on a
  // reminder due Thursday reads as one due in twenty minutes.
  const whenLabel = !dueValid
    ? null
    : dayKey(due) === dayKey(new Date())
      ? due.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
      : `${due.toLocaleDateString('en-US', { weekday: 'short' })} ${due.toLocaleTimeString([], {
          hour: 'numeric',
          minute: '2-digit',
        })}`;

  return (
    // Same shape as a note card: the dot, the sentence, then the kind and the
    // time underneath. A reminder and a journal entry sit in one list and must
    // read as two colors of the same thing, not as two different components.
    <CCard
      tone={look.tone}
      style={{ backgroundColor: paint.tint, paddingHorizontal: 16, paddingVertical: 15 }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
        {/* The text column opens the sheet; the checkbox beside it is its own
            Pressable and stays a tick rather than an expand. */}
        <Pressable
          onPress={onOpen}
          disabled={!onOpen}
          accessibilityRole="button"
          accessibilityLabel={`Open reminder: ${reminder.title}`}
          style={({ pressed }) => ({ flex: 1, opacity: pressed ? 0.7 : 1 })}
        >
          <View style={{ flexDirection: 'row', gap: 11 }}>
            <View
              style={{
                width: 7,
                height: 7,
                borderRadius: 4,
                marginTop: 7,
                backgroundColor: overdue ? cl.goldDeep : paint.dot,
              }}
            />
            <CText
              t="body"
              numberOfLines={look.lines}
              color={reminder.done ? cl.ink38 : undefined}
              style={{
                flex: 1,
                fontSize: look.bodySize,
                textDecorationLine: reminder.done ? 'line-through' : 'none',
              }}
            >
              {reminder.title}
            </CText>
          </View>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 7,
              marginTop: 9,
              paddingLeft: 18,
            }}
          >
            {/* OVERDUE STILL WINS THE COLOR. The kind color says what a card
                is; gold says it needed you an hour ago, and that is the more
                urgent of the two things a glance can carry. */}
            <CText t="kicker" color={overdue ? cl.goldKicker : paint.ink}>
              {look.label}
            </CText>
            {whenLabel ? (
              <CText t="metaXs" color={overdue ? cl.goldDeep : cl.ink45}>
                {`· ${whenLabel}`}
              </CText>
            ) : null}
          </View>
          {/* Only when the reminder actually names someone. Most do not. */}
          {reminder.contact?.id ? (
            <Pressable
              onPress={() => onOpenPerson?.(reminder.contact!.id)}
              accessibilityRole="button"
              accessibilityLabel={`Open ${reminder.contact.name ?? 'contact'}`}
              hitSlop={6}
              style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, alignSelf: 'flex-start' })}
            >
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 6,
                  marginTop: 10,
                  paddingLeft: 3,
                  paddingRight: 11,
                  paddingVertical: 3,
                  borderRadius: 999,
                  borderWidth: HAIRLINE,
                  borderColor: cl.gold40,
                }}
              >
                <Avatar name={reminder.contact.name ?? undefined} size={22} />
                <CText t="metaSm" color={cl.ink}>
                  {(reminder.contact.name ?? '').trim().split(/\s+/)[0] || 'Contact'}
                </CText>
              </View>
            </Pressable>
          ) : null}
        </Pressable>

        <Pressable
          onPress={onToggle}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: reminder.done }}
          accessibilityLabel={reminder.done ? 'Mark not done' : 'Mark done'}
          hitSlop={12}
          style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, paddingTop: 1 })}
        >
          <View
            style={{
              width: 26,
              height: 26,
              borderRadius: 13,
              borderWidth: 1.5,
              borderColor: reminder.done ? cl.gold55 : cl.ruleFaint,
              backgroundColor: reminder.done ? cl.tint100 : 'transparent',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {reminder.done ? <Check color={cl.goldDeep} size={15} strokeWidth={2.4} /> : null}
          </View>
        </Pressable>
      </View>
    </CCard>
  );
}

function SectionLabel({ children }: { children: string }) {
  return (
    <CText t="kicker" color={cl.goldKicker}>
      {children}
    </CText>
  );
}

// A failed fetch has to say so. Rendering nothing (or the empty copy) states
// "you have none of these", which is a different claim from "we couldn't ask".
function SectionRetry({ label, onRetry }: { label: string; onRetry?: () => void }) {
  return (
    <View style={{ gap: 6, alignItems: 'flex-start' }}>
      <CText t="body" color={cl.ink55}>
        {label}
      </CText>
      {onRetry ? (
        <Pressable
          onPress={onRetry}
          accessibilityRole="button"
          accessibilityLabel="Try again"
          hitSlop={8}
          style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
        >
          <CText t="listTitle" color={cl.goldDeep}>
            Try again
          </CText>
        </Pressable>
      ) : null}
    </View>
  );
}

// Section label + content, with the three states kept distinct: loading shows a
// spinner, a fetch failure shows user-safe copy plus a retry, and only a
// genuinely-empty result falls back to `emptyText`. Pass `children` once a
// section has real items to show (each item rendered as its own card).
function FeedSection({
  label,
  emptyText,
  loading = false,
  error,
  onRetry,
  children,
}: {
  label?: string;
  emptyText: string;
  loading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  children?: React.ReactNode;
}) {
  return (
    <CCard>
      <View style={{ gap: 9 }}>
        {label ? <SectionLabel>{label}</SectionLabel> : null}
        {loading ? (
          <ActivityIndicator color={cl.gold} size="small" />
        ) : error !== undefined && error !== null ? (
          <SectionRetry label={errorCopy(error)} onRetry={onRetry} />
        ) : (
          (children ?? (
            <CText t="body" color={cl.ink48}>
              {emptyText}
            </CText>
          ))
        )}
      </View>
    </CCard>
  );
}

// ── Questions for you ────────────────────────────────────────────

// Pending questions Amber wants the user to answer. Renders nothing when the
// inbox is genuinely empty (same convention as IncomingRequestsSection), but a
// failed fetch surfaces a retry instead of vanishing. Tapping a row opens the
// conversation thread.
function QuestionsInboxSection() {
  const router = useRouter();

  const inboxQuery = useQuery({
    queryKey: ['questions', 'inbox'],
    queryFn: async () => unwrapOrThrow(await getInbox()).questions,
  });
  const questions = inboxQuery.data ?? [];

  // Loading renders nothing on purpose: this section is empty most of the time,
  // so a skeleton that flashes and then disappears on every Home mount reads
  // worse than the section simply appearing when there is something in it.
  if (inboxQuery.isLoading) return null;
  // Only surface the error when there is nothing to show. A failed *background*
  // refetch leaves the last good data in place, and stale questions the user can
  // still act on beat replacing them with an error card.
  if (inboxQuery.isError && questions.length === 0) {
    return (
      <FeedSection
        label="Questions for you"
        emptyText="No questions right now."
        error={inboxQuery.error}
        onRetry={() => inboxQuery.refetch()}
      />
    );
  }
  if (questions.length === 0) return null;

  return (
    <CCard>
      <View style={{ gap: 9 }}>
        <SectionLabel>Questions for you</SectionLabel>
        <View style={{ gap: spacing.sm }}>
          {questions.map((item) => (
            <Pressable
              key={item.threadId}
              onPress={() => router.push(`/(gated)/questions/${item.threadId}`)}
              accessibilityRole="button"
              accessibilityLabel={item.prompt}
            >
              {({ pressed }) => (
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: spacing.sm,
                    opacity: pressed ? 0.6 : 1,
                  }}
                >
                  <CText t="quote" numberOfLines={2} style={{ flex: 1 }}>
                    {item.prompt}
                  </CText>
                  <ChevronRight size={16} color={cl.ink30} strokeWidth={2} />
                </View>
              )}
            </Pressable>
          ))}
        </View>
      </View>
    </CCard>
  );
}

// ── Connection requests ──────────────────────────────────────────

// Renders nothing at all (not even an empty card) when there are genuinely no
// pending requests — unlike the other FeedSections, which always show a shell.
// A failed fetch still shows a card, so "no requests" is never a guess.
function IncomingRequestsSection({
  onConnected,
}: {
  /**
   * Fired with the person just accepted, so the LINK PROMPT can be mounted
   * somewhere that outlives this section. It returns null the moment the list
   * is empty — which, after accepting the only request, is immediately — so a
   * modal owned here would unmount before it could be seen.
   */
  onConnected?: (person: { amberId: string; name: string }) => void;
}) {
  const qc = useQueryClient();

  const incomingQuery = useQuery({
    queryKey: ['connect', 'incoming'],
    queryFn: async () => unwrapOrThrow(await listIncomingRequests()).requests,
  });
  const requests = incomingQuery.data ?? [];

  const invalidateAfterDecision = () => {
    qc.invalidateQueries({ queryKey: ['connect', 'incoming'] });
    qc.invalidateQueries({ queryKey: ['connect', 'list'] });
    qc.invalidateQueries({ queryKey: ['connect', 'feed'] });
  };

  // Optimistic removal for both actions: the row drops immediately, and rolls
  // back if the mutation actually fails.
  const removeOptimistically = async (requestId: string) => {
    await qc.cancelQueries({ queryKey: ['connect', 'incoming'] });
    const previous = qc.getQueryData<IncomingRequest[]>(['connect', 'incoming']);
    qc.setQueryData<IncomingRequest[]>(['connect', 'incoming'], (prev) =>
      prev?.filter((r) => r.requestId !== requestId),
    );
    return { previous };
  };

  const acceptMutation = useMutation({
    mutationFn: ({ requestId }: { requestId: string; amberId?: string; name?: string }) =>
      acceptConnectRequest(requestId),
    onMutate: ({ requestId }) => removeOptimistically(requestId),
    onSuccess: (res, vars) => {
      if (!res.ok) {
        toast.error('Could not accept request.', medhaIdErrorCopy(res, 'Amber'));
        return;
      }
      // ASK ONCE, ON CONNECT. If nothing in the book plausibly is them the
      // prompt closes before it is ever seen — see LinkContactPrompt.
      if (vars.amberId) {
        onConnected?.({ amberId: vars.amberId, name: vars.name ?? '' });
      }
    },
    onError: (e, _vars, context) => {
      if (context?.previous) qc.setQueryData(['connect', 'incoming'], context.previous);
      toast.error('Could not accept request.', errorCopy(e));
    },
    onSettled: invalidateAfterDecision,
  });

  const declineMutation = useMutation({
    mutationFn: (requestId: string) => declineConnectRequest(requestId),
    onMutate: removeOptimistically,
    onSuccess: (res) => {
      if (!res.ok) toast.error('Could not decline request.', medhaIdErrorCopy(res, 'Amber'));
    },
    onError: (e, _requestId, context) => {
      if (context?.previous) qc.setQueryData(['connect', 'incoming'], context.previous);
      toast.error('Could not decline request.', errorCopy(e));
    },
    onSettled: invalidateAfterDecision,
  });

  // Same three-state split as QuestionsInboxSection, including keeping stale
  // requests visible when only a background refetch failed.
  if (incomingQuery.isLoading) return null;
  if (incomingQuery.isError && requests.length === 0) {
    return (
      <FeedSection
        label="Connection requests"
        emptyText="No pending requests."
        error={incomingQuery.error}
        onRetry={() => incomingQuery.refetch()}
      />
    );
  }
  if (requests.length === 0) return null;

  return (
    <CCard>
      <View style={{ gap: 9 }}>
        <SectionLabel>Connection requests</SectionLabel>
        <View style={{ gap: spacing.sm }}>
          {requests.map((req) => (
            <IncomingRequestRow
              key={req.requestId}
              request={req}
              onAccept={() =>
                acceptMutation.mutate({
                  requestId: req.requestId,
                  amberId: req.requester?.amberId,
                  name: req.requester?.fullName ?? req.requester?.username ?? '',
                })
              }
              onDecline={() => declineMutation.mutate(req.requestId)}
            />
          ))}
        </View>
      </View>
    </CCard>
  );
}

function IncomingRequestRow({
  request,
  onAccept,
  onDecline,
}: {
  request: IncomingRequest;
  onAccept: () => void;
  onDecline: () => void;
}) {
  const fullName = request.requester.fullName ?? request.requester.username ?? 'Amber user';
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 11 }}>
      <Avatar name={fullName} url={request.requester.avatarUrl ?? undefined} size={40} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <CText t="rowName" numberOfLines={1} style={{ fontSize: 17, lineHeight: 20 }}>
          {fullName}
        </CText>
        {request.requester.username ? (
          <CText t="metaSm" color={cl.ink48} style={{ marginTop: 1 }}>
            {`@${request.requester.username}`}
          </CText>
        ) : null}
      </View>
      <Pressable onPress={onDecline} accessibilityRole="button" accessibilityLabel="Decline" hitSlop={8}>
        {({ pressed }) => (
          <View
            style={{
              width: 32,
              height: 32,
              borderRadius: 16,
              borderWidth: HAIRLINE,
              borderColor: cl.ruleFaint,
              backgroundColor: pressed ? 'rgba(32,31,29,0.06)' : 'transparent',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <X size={15} color={cl.ink50} strokeWidth={2} />
          </View>
        )}
      </Pressable>
      <Pressable onPress={onAccept} accessibilityRole="button" accessibilityLabel="Accept" hitSlop={8}>
        {({ pressed }) => (
          <View
            style={{
              width: 32,
              height: 32,
              borderRadius: 16,
              borderWidth: HAIRLINE,
              borderColor: cl.gold55,
              backgroundColor: pressed ? cl.gold22 : cl.tint100,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Check size={15} color={cl.goldDeep} strokeWidth={2.2} />
          </View>
        )}
      </Pressable>
    </View>
  );
}

// ── Network feed ─────────────────────────────────────────────────

function NetworkFeedSection() {
  const feedQuery = useQuery({
    queryKey: ['connect', 'feed'],
    queryFn: async () => unwrapOrThrow(await networkFeed()).posts,
  });
  const posts = feedQuery.data ?? [];

  // Shared voice notes: notes other people shared with the whole network or with
  // a circle the user is in. Rendered above the existing connect posts, each with
  // a clear network-vs-circle label.
  const sharedQuery = useQuery({
    queryKey: ['notes', 'feed'],
    queryFn: async () => unwrapOrThrow(await getNetworkFeed()).items,
  });
  const shared = sharedQuery.data ?? [];

  // TWO DAYS, AND THEN IT IS GONE.
  //
  // This feed is "what people are doing", which is a present-tense claim. A shared note
  // from last week is not news, it is clutter, and it pushes today's actual activity
  // down the screen. Filtering on the client rather than the server on purpose: the
  // items are still there if we ever want a "see everything" view, and a cutoff that
  // lives next to the thing it affects is one nobody has to go looking for.
  //
  // An item with an unparseable or missing date is KEPT. Dropping a post because its
  // timestamp confused us would be the worse failure — a silent disappearance with no
  // way to notice.
  const cutoff = Date.now() - FEED_MAX_AGE_MS;
  const fresh = <T,>(items: T[], at: (x: T) => string | null | undefined) =>
    items.filter((x) => {
      const t = Date.parse(at(x) ?? '');
      return Number.isNaN(t) ? true : t >= cutoff;
    });
  const recentShared = fresh(shared, (i) => i.sharedAt);
  const recentPosts = fresh(posts, (p) => p.createdAt);

  /**
   * THE TWO SHEETS AND THE PER-ROW OVERRIDES, OWNED HERE.
   *
   * One comments sheet and one reactors sheet for the whole section rather than
   * a pair per card -- a Modal per row is forty native views on a busy feed. The
   * open row is identified by a key and its `actions`, so neither sheet knows
   * whether it is looking at a shared note or a post.
   *
   * `edits` is what the sheets have changed. It lives here rather than in a card
   * because a card's state resets every time the feed query settles, which is
   * how a comment you just left appears to un-post itself.
   */
  const [commentsFor, setCommentsFor] = useState<FeedActions | null>(null);
  const [reactorsFor, setReactorsFor] = useState<FeedActions | null>(null);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, { count: number; comments: FeedComment[] }>>({});
  const meQuery = useQuery({
    queryKey: ['me'],
    queryFn: async () => unwrapSingle<Me>(await api.me()),
    staleTime: 1000 * 60 * 5,
  });
  const me = meQuery.data ?? null;
  const circleAccent = useCircleAccent();

  const anyItems = recentShared.length > 0 || recentPosts.length > 0;
  const loading = feedQuery.isLoading && sharedQuery.isLoading;
  // Only show the failure when BOTH sources are empty and errored; a stale cache
  // on either side outranks an error card.
  const error =
    !anyItems && feedQuery.isError && sharedQuery.isError ? feedQuery.error : undefined;

  return (
    <>
    <FeedSection
      emptyText="Nothing from your network yet."
      loading={loading}
      error={error}
      onRetry={() => {
        void feedQuery.refetch();
        void sharedQuery.refetch();
      }}
    >
      {anyItems ? (
        <View style={{ gap: 16 }}>
          {recentShared.map((item) => {
            const key = `note-${item.noteId}`;
            const actions = noteActions(item.sharedBy.amberId, item.noteId, me?.id ?? null);
            return (
              <SharedNoteRow
                key={key}
                item={item}
                actions={actions}
                edit={edits[key]}
                me={me}
                accent={circleAccent(item.circleId ?? null, item.circleName ?? null)}
                onOpenComments={() => {
                  setOpenKey(key);
                  setCommentsFor(actions);
                }}
                onShowReactors={() => {
                  setOpenKey(key);
                  setReactorsFor(actions);
                }}
                onCountChange={(n, cs) =>
                  setEdits((prev) => ({ ...prev, [key]: { count: n, comments: cs } }))
                }
              />
            );
          })}
          {/* recentPosts, not posts. `fresh()` was applied to both lists and then
              only recentShared was actually rendered — so the recency cutoff worked
              for shared notes and silently did nothing for network posts, and stale
              posts kept appearing in Today. The `anyItems` check above already used
              the filtered list, which is why the section could also claim to have
              content and then render older items than it promised. */}
          {recentPosts.map((post) => {
            const key = `post-${post.postId}`;
            const actions = postActions(post.postId);
            return (
              <NetworkPostRow
                key={key}
                post={post}
                actions={actions}
                edit={edits[key]}
                me={me}
                onOpenComments={() => {
                  setOpenKey(key);
                  setCommentsFor(actions);
                }}
                onShowReactors={() => {
                  setOpenKey(key);
                  setReactorsFor(actions);
                }}
                onCountChange={(n, cs) =>
                  setEdits((prev) => ({ ...prev, [key]: { count: n, comments: cs } }))
                }
              />
            );
          })}
        </View>
      ) : undefined}
    </FeedSection>
    {/* OUTSIDE THE SECTION, not inside it. FeedSection renders `children ??
        emptyText`, so a second child would make `children` a truthy array even
        on an empty feed -- and "Nothing from your network yet." would never
        appear again. */}
    <PostCommentsSheet
      open={!!commentsFor}
      actions={commentsFor}
      onClose={() => setCommentsFor(null)}
      onCountChange={(n, cs) => {
        if (openKey) setEdits((prev) => ({ ...prev, [openKey]: { count: n, comments: cs } }));
      }}
    />
    <ReactorsSheet
      open={!!reactorsFor}
      actions={reactorsFor}
      onClose={() => setReactorsFor(null)}
    />
    </>
  );
}

/**
 * THE CARD'S COLOR IS THE CIRCLE'S OWN COLOR.
 *
 * Circles already have one -- picked in the circle editor, stored by key name,
 * drawn on every circle row and avatar in the app -- so a note shared to Work
 * has to be the color Work already is. Amber assigning a second color here
 * would mean the same circle is terracotta on one screen and sage on another.
 *
 * LOOKED UP, NOT DERIVED. Hashing the circle's NAME into the palette would give
 * a stable color and the wrong one, which is worse than no color at all: it
 * looks deliberate. The circles list is already cached on this page's client for
 * the pinned row, so this is a map read rather than a fetch.
 *
 * A share with no circle -- a post to the whole network -- takes the page's
 * gold, which is the one color that does not claim to be a circle.
 */
function useCircleAccent(): (circleId: string | null, name: string | null) => string {
  const circlesQuery = useQuery({
    queryKey: ['circles', 'list'],
    queryFn: async () => unwrapOrThrow(await listCircles()).circles,
    staleTime: 5 * 60_000,
  });
  const byId = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of circlesQuery.data ?? []) {
      const key = (c.color ?? '').trim();
      const hex = key ? (NAMED_COLORS[key] ?? (/^#[0-9a-f]{6}$/i.test(key) ? key : null)) : null;
      if (hex) m.set(String(c.id), hex);
    }
    return m;
  }, [circlesQuery.data]);
  return useCallback(
    (circleId: string | null) => (circleId ? (byId.get(String(circleId)) ?? cl.gold) : cl.gold),
    [byId],
  );
}

/**
 * A shared voice note in the feed.
 *
 * SAME CARD AS A POST, which is the point of FeedCard: to the person reading
 * this page a shared note and a wall post are both "something somebody said",
 * and two components would drift into looking like two features. What differs
 * is the store behind them, and that is `actions`.
 */
function SharedNoteRow({
  item,
  actions,
  edit,
  me,
  accent,
  onOpenComments,
  onShowReactors,
  onCountChange,
}: {
  item: FeedItem;
  actions: FeedActions;
  edit?: { count: number; comments: FeedComment[] };
  me: Me | null;
  accent: string;
  onOpenComments: () => void;
  onShowReactors: () => void;
  onCountChange: (count: number, comments: FeedComment[]) => void;
}) {
  const name = item.sharedBy.name || item.sharedBy.username || 'Amber user';
  const audience = item.shareType === 'circle' ? (item.circleName ?? 'A circle') : 'Network';
  return (
    <FeedCard
      authorName={name}
      authorAvatarUrl={item.sharedBy.avatarUrl}
      meta={`${audience} · ${formatAgo(item.sharedAt)}`}
      chipLabel={item.shareType === 'circle' ? (item.circleName ?? 'Circle') : null}
      accent={accent}
      social={{
        reactions: narrowSummary(item.reactions),
        commentCount: edit?.count ?? item.commentCount ?? 0,
        comments: edit?.comments ?? [],
      }}
      actions={actions}
      myName={me?.displayName ?? null}
      myAvatarUrl={me?.avatarUrl ?? null}
      onCountChange={(n) => onCountChange(n, edit?.comments ?? [])}
      onOpenComments={onOpenComments}
      onShowReactors={onShowReactors}
    >
      <CText t="quote">{item.transcript}</CText>
    </FeedCard>
  );
}

// The reference's captured-moment card, read-only: tan avatar, serif name, a
// tabular timestamp behind a 3px dot, and the body set behind a gold left rule.
// Was a heavy terracotta-filled inset with a 1.5px border — the Classical system
// draws with rules, not fills ("keep large fills off the page").
function NetworkPostRow({
  post,
  actions,
  edit,
  me,
  onOpenComments,
  onShowReactors,
  onCountChange,
}: {
  post: NetworkPost;
  actions: FeedActions;
  /**
   * What the sheets have changed, if anything. Held by the section rather than
   * read off the post, so a comment you just left is not un-posted by the next
   * feed refetch -- and so the count under the card matches the thread behind
   * it without the whole page reloading.
   */
  edit?: { count: number; comments: FeedComment[] };
  me: Me | null;
  onOpenComments: () => void;
  onShowReactors: () => void;
  onCountChange: (count: number, comments: FeedComment[]) => void;
}) {
  const fullName = post.author.fullName ?? post.author.username ?? 'Amber user';
  const fromPage: FeedComment[] = (post.comments ?? []).map((c) => ({
    id: c.commentId,
    text: c.text,
    createdAt: c.createdAt,
    mine: c.mine,
    author: {
      name: c.author.fullName ?? c.author.username ?? null,
      avatarUrl: c.author.avatarUrl ?? null,
    },
    // The clip, when this comment is a recording. The feed page carries the
    // peaks with the last two comments so a card can draw the waveform without
    // a round trip; the playback URL is fetched on the first play.
    audio: c.audio ?? null,
  }));
  return (
    <FeedCard
      authorName={fullName}
      authorAvatarUrl={post.author.avatarUrl}
      meta={`Network · ${formatAgo(post.createdAt)}`}
      // A wall post goes to everybody you are connected to, so there is no
      // circle to name. The chip is left off rather than filled with the word
      // "Network", which the line above already says.
      chipLabel={null}
      accent={cl.gold}
      social={{
        reactions: post.reactions ?? NO_SOCIAL.reactions,
        commentCount: edit?.count ?? post.commentCount ?? 0,
        comments: edit?.comments ?? fromPage,
      }}
      actions={actions}
      myName={me?.displayName ?? null}
      myAvatarUrl={me?.avatarUrl ?? null}
      onCountChange={(n) => onCountChange(n, edit?.comments ?? fromPage)}
      onOpenComments={onOpenComments}
      onShowReactors={onShowReactors}
    >
      <CText t="quote">{post.text}</CText>
    </FeedCard>
  );
}

// ── Dates ────────────────────────────────────────────────────────
//
// dayKey, getWeekDates and conversationsForDay MOVED TO lib/calendarStrip.ts.
//
// They were private helpers at the bottom of this file, which made the day strip
// -- which seven days it shows, which day a note lands on, what tapping a date
// opens -- reachable by nothing and tested by nothing. A redesign of this screen
// rewrites this file, and a private helper in a file being rewritten is one that
// gets dropped or quietly re-implemented with a different answer at the month
// end. They are imported at the top now and covered by lib/calendarStrip.test.mts.


// ── Shared primitives ────────────────────────────────────────────

// Also duplicated in ChatSurface.tsx (used there by the chat loading
// skeleton) — trivial enough that a shared export isn't worth a new file.
// A Today voice note: the transcript with a mic + time header and the "filed
// to" chips for the people it landed on. Tapping opens it in Ask.
function VoiceNoteCard({
  note,
  fresh = false,
  onPress,
  onDelete,
  onOpenPerson,
}: {
  note: ConversationSummary;
  /** Recorded in this session — see kindOf, which needs it to tell "still
   *  processing" apart from "genuinely about nobody". */
  fresh?: boolean;
  onPress: () => void;
  onDelete?: () => void;
  onOpenPerson?: (id: string) => void;
}) {
  // Only confirmed contacts (real contactId) show as "filed to" chips. An
  // unconfirmed name is never a chip — it lives in the confirmation card until
  // you say who it is. Belt-and-suspenders with the backend, which already
  // filters these out.
  const people = (note.people ?? []).filter((p) => p && p.contactId != null);
  // Typed notes were showing "VOICE NOTE" with a mic, because this card was
  // built when Today held nothing else. Only an explicit false flips it: a
  // thread from before the server recorded entry method is unknown, and
  // guessing "typed" would relabel every old voice note on the feed.
  const typed = note.voice === false;
  // Kept for the menu and the accessibility label -- "Delete voice note?" should
  // still say voice note. It no longer decides anything visual.
  const kindLabel = typed ? 'Note' : 'Voice note';
  const tier = kindOf(note, fresh);
  const look = TIER[tier];
  // The kind's three colors, or nothing at all while the kind is unknown.
  const paint = look.kind ? JOURNAL_KIND[look.kind] : null;
  const [sharingOpen, setSharingOpen] = useState(false);
  const confirmDelete = () => {
    if (!onDelete) return;
    Alert.alert(`Delete ${kindLabel.toLowerCase()}?`, 'It will be removed from Today and your calendar.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: onDelete },
    ]);
  };
  // CORRECTING A CHIP, from either of the two places that ask about tags.
  //
  // The chip menu and the three-dot "Tagged in this note" sheet lead to the
  // same three actions, because they are the same question — one is reached
  // from the person and the other from the note. Two menus offering different
  // subsets is how "I could fix it from one screen but not the other" happens.
  const qcTags = useQueryClient();
  const [picking, setPicking] = useState<{ contactId: string; name: string } | null>(null);
  const [taggedOpen, setTaggedOpen] = useState(false);
  // A NAME AMBER HEARD AND COULD NOT PLACE. "Mee" — asked once in the chat,
  // answered "no", and then nothing: the question was written to the database
  // (observations with status 'pending' and a raw_name) and surfaced NOWHERE, so
  // it scrolled away and the note stayed unattributed forever.
  //
  // Asked here instead, on the note itself, which is where the user has the
  // context to answer it. Long staleTime because the answer changes only when
  // somebody answers it, and this runs once per card on the feed.
  const PENDING_KEY = ['notePendingTags', note.conversationId] as const;
  const pendingTagsQuery = useQuery({
    queryKey: PENDING_KEY,
    queryFn: async () => {
      const res = await listPendingTags(note.conversationId);
      return res.ok ? (res.data?.pending ?? []) : [];
    },
    enabled: !note.conversationId.startsWith(LOCAL_NOTE_PREFIX),
    staleTime: 5 * 60_000,
  });
  const pendingNames = pendingTagsQuery.data ?? [];
  const [resolving, setResolving] = useState<{ rawName: string; body: string | null } | null>(
    null,
  );

  const refreshTags = () => {
    // The chips are derived server-side from observation_participants, so the
    // card cannot be patched locally — the feed has to be asked again.
    void qcTags.invalidateQueries({ queryKey: ['conversations'] });
    void qcTags.invalidateQueries({ queryKey: ['contactFacts'] });
    void qcTags.invalidateQueries({ queryKey: PENDING_KEY });
  };

  const removeTag = (person: { contactId: string; name: string }) => {
    Alert.alert(
      `Remove ${person.name || 'this person'}?`,
      'The note keeps its text. It just stops being filed under them.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            void retagNote(note.conversationId, person.contactId).then((r) => {
              if (r.ok) {
                toast.success('Tag removed.');
                refreshTags();
              } else {
                toast.error('Could not remove that tag.');
              }
            });
          },
        },
      ],
    );
  };

  const tagActions = (person: { contactId: string; name: string }) => {
    Alert.alert(person.name || 'Tagged person', undefined, [
      {
        text: 'Expand contact card',
        onPress: () => onOpenPerson?.(person.contactId),
      },
      { text: 'Change tag', onPress: () => setPicking(person) },
      { text: 'Remove tag', style: 'destructive', onPress: () => removeTag(person) },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  // WAS AN ALERT LISTING NAMES AS A COMMA-SEPARATED STRING with an OK button,
  // which is a dead end: it told you who was tagged and gave you no way to open
  // any of them or fix a wrong one. It is a sheet of real rows now.
  const showTags = () => setTaggedOpen(true);
  // The card only holds `preview`, which the server truncates to 240 chars (it
  // ends with an ellipsis when clipped). For copy/share we want the FULL
  // transcript, so if the preview looks truncated we rehydrate the note's first
  // user message (the spoken text) from the conversation and use that. Falls
  // back to the preview/title if the fetch fails so the action never no-ops.
  const resolveTranscript = async (): Promise<string> => {
    const preview = (note.preview ?? '').trim();
    if (preview && !preview.endsWith('…')) return preview;
    const res = await getConversation(note.conversationId).catch(() => null);
    if (res && res.ok) {
      const msgs = res.data.messages ?? [];
      const firstUser = msgs.find((m) => m.role === 'user') ?? msgs[0];
      const full = (firstUser?.content ?? '').trim();
      if (full) return full;
    }
    return preview || (note.title ?? '').trim();
  };
  const copyTranscription = async () => {
    const text = await resolveTranscript();
    if (!text) return;
    await Clipboard.setStringAsync(text);
    toast.success('Copied');
  };
  const shareTranscription = async () => {
    const text = await resolveTranscript();
    if (!text) return;
    // React Native's Share resolves on both share and dismiss; we don't need the
    // result, and a thrown error (rare) is swallowed so the menu closes cleanly.
    await Share.share({ message: text }).catch(() => {});
  };
  // The three-dot menu: open in Ask, view the people tagged, copy the transcript,
  // share it OUT of Amber, choose who inside Amber can see it, or delete. Delete is
  // also on a press-and-hold, which stays.
  //
  // "Share" and "Sharing" sat next to each other and were impossible to tell apart —
  // they read as the same word twice. They are two genuinely different actions:
  //   Share   → leaves Amber. The iOS share sheet: Messages, Instagram, Notes,
  //             anywhere. Nothing about who can see it inside Amber changes.
  //   Network → stays inside Amber. Picks the audience — your network, a circle, one
  //             person — which is what actually puts the note in a feed.
  // Naming the second one after the thing it controls is the whole fix.
  const openMenu = () => {
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title: kindLabel,
        options: ['Open in Ask', 'View tags', 'Copy transcription', 'Share', 'Network', 'Delete', 'Cancel'],
        destructiveButtonIndex: 5,
        cancelButtonIndex: 6,
      },
      (i) => {
        if (i === 0) onPress();
        else if (i === 1) showTags();
        else if (i === 2) void copyTranscription();
        else if (i === 3) void shareTranscription();
        else if (i === 4) setSharingOpen(true);
        else if (i === 5) confirmDelete();
      },
    );
  };
  return (
    <>
    <NoteSharingModal
      visible={sharingOpen}
      noteId={note.conversationId}
      onClose={() => setSharingOpen(false)}
    />
    {/* CHANGING A TAG. One picker component, the same one the reconciliation
        card and the circle editor use, so "choose one of your contacts" looks
        and behaves identically wherever it is asked. */}
    <ContactPickerModal
      visible={!!picking}
      title={picking ? `Who is this note about?` : ''}
      subtitle={
        picking
          ? `It is filed under ${picking.name || 'someone'} right now. Choose the right person.`
          : null
      }
      onClose={() => setPicking(null)}
      onPick={(c) => {
        const from = picking;
        setPicking(null);
        if (!from) return;
        void retagNote(note.conversationId, from.contactId, c.id).then((r) => {
          if (r.ok) {
            toast.success(`Filed under ${c.name || 'them'}.`);
            refreshTags();
          } else {
            toast.error('Could not change that tag.');
          }
        });
      }}
    />
    {/* ANSWERING "WHICH MEE?" — the same picker, a different question, so the
        two cannot look like two different features. */}
    <ContactPickerModal
      visible={!!resolving}
      title={resolving ? `Who is "${resolving.rawName}"?` : ''}
      subtitle={resolving?.body ? resolving.body : 'Amber heard this name and could not place it.'}
      onClose={() => setResolving(null)}
      onPick={(c) => {
        const ask = resolving;
        setResolving(null);
        if (!ask) return;
        void resolvePendingTag(note.conversationId, ask.rawName, c.id).then((r) => {
          if (r.ok) {
            // One answer settles every mention of that name in the note, which
            // is why the copy says "filed" rather than "tagged".
            toast.success(`Filed under ${c.name || 'them'}.`);
            refreshTags();
          } else {
            toast.error('Could not file that.');
          }
        });
      }}
    />
    <TaggedInNoteSheet
      visible={taggedOpen}
      people={people.map((pp) => ({
        contactId: pp.contactId as string,
        name: (pp.name ?? '').trim(),
      }))}
      onClose={() => setTaggedOpen(false)}
      onOpen={(id) => {
        setTaggedOpen(false);
        onOpenPerson?.(id);
      }}
      onActions={(person) => {
        setTaggedOpen(false);
        tagActions(person);
      }}
    />
    <Pressable
      onPress={onPress}
      onLongPress={confirmDelete}
      delayLongPress={320}
      accessibilityRole="button"
      accessibilityLabel={note.title || kindLabel}
      accessibilityHint="Press and hold to delete"
    >
      {({ pressed }) => (
        /*
         * THE SHAPE IS THE MOCKUP'S, and it is upside down from what was here.
         *
         * Before: a kicker row at the top (icon, NOTE, timestamp, a three-dot
         * menu), then the transcript indented behind a rule. So the loudest
         * thing on every card was the word NOTE, and what the note actually
         * SAID started a third of the way down.
         *
         * Now: a colored dot, the sentence, a chevron -- then the kind and the
         * time underneath in the kind's own color. What you wrote is the card;
         * what sort of thing it is is the caption.
         *
         * NOTHING WAS DROPPED TO GET THERE. The three-dot menu moved into the
         * caption row rather than going away, and the chips, the unresolved
         * names, the sharing sheet, the tag pickers and press-and-hold-to-delete
         * are all untouched below. scripts/screen-contract.mts is what proves
         * that rather than my saying so.
         */
        <CCard
          tone={look.tone}
          style={{
            backgroundColor: paint ? paint.tint : undefined,
            paddingHorizontal: 16,
            paddingVertical: 15,
            /**
             * FLAT: NO BORDER, NO SHADOW, AND A SMALLER RADIUS.
             *
             * CCard is built for a card that has to lift off a warm ground -- a
             * white rim, a wide low shadow, a 26pt corner. On white paper, with
             * a tint of its own doing the separating, all three of those read as
             * damage: a rim round a colored rectangle on white is an outline, and
             * a shadow under it is a sticker. The rendering's note card is a flat
             * tinted rectangle with a 14pt corner and nothing else.
             *
             * Overridden here rather than by a new CCard tone because it is this
             * screen's finish, not a new kind of card -- see lib/homeSurface for
             * why Home's surface is its own thing.
             */
            borderRadius: 14,
            borderWidth: 0,
            shadowOpacity: 0,
            elevation: 0,
          }}
        >
          <View style={{ opacity: pressed ? 0.7 : 1 }}>
            <View style={{ flexDirection: 'row', gap: 11 }}>
              {/* The dot. Six points of the kind's color, aligned to the first
                  line of the sentence rather than to the card, so it reads as a
                  bullet on the text and not as a badge in a corner. */}
              <View
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: 4,
                  marginTop: 7,
                  backgroundColor: paint?.dot ?? cl.gold55,
                }}
              />
              {/* THE SENTENCE IS SET IN THE SANS, not the serif.
                  `t="body"` is Newsreader at 13/20 -- an editorial face at
                  caption size. The renderings set what you wrote in Outfit at
                  15.5/21, which is what makes a note read as something you said
                  rather than as a pull quote. */}
              <Text
                style={{
                  flex: 1,
                  fontFamily: hFont.regular,
                  fontSize: look.bodySize,
                  lineHeight: Math.round(look.bodySize * 1.36),
                  color: hc.inkBody,
                }}
                numberOfLines={look.lines}
              >
                {note.preview || note.title || `New ${kindLabel.toLowerCase()}`}
              </Text>
              <ChevronRight
                size={17}
                color={cl.ink32}
                strokeWidth={2}
                style={{ marginTop: 3 }}
              />
            </View>

            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 7,
                marginTop: 9,
                paddingLeft: 18,
              }}
            >
              {look.label ? (
                <CText t="kicker" color={paint?.ink ?? cl.ink45}>
                  {look.label}
                </CText>
              ) : null}
              {note.lastAt ? (
                <CText t="metaXs" color={cl.ink45}>
                  {look.label ? `· ${formatAgo(note.lastAt)}` : formatAgo(note.lastAt)}
                </CText>
              ) : null}
              <View style={{ flex: 1 }} />
              <Pressable
                onPress={openMenu}
                accessibilityRole="button"
                accessibilityLabel={`${kindLabel} options`}
                hitSlop={12}
                style={({ pressed: p }) => ({ opacity: p ? 0.5 : 1, padding: 2, marginRight: -2 })}
              >
                <MoreHorizontal size={18} color={cl.ink38} strokeWidth={2} />
              </Pressable>
            </View>

            {people.length > 0 ? (
              <View
                style={{
                  marginTop: 14,
                  paddingTop: 12,
                  borderTopWidth: HAIRLINE,
                  borderTopColor: cl.rule,
                  flexDirection: 'row',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: 8,
                }}
              >
                <CText t="metaSm" color={cl.ink48} style={{ letterSpacing: 1 }}>
                  FILED TO
                </CText>
                {people.map((p, i) => {
                  const chip = (
                    <View
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 6,
                        paddingLeft: 3,
                        paddingRight: 11,
                        paddingVertical: 3,
                        borderRadius: 999,
                        borderWidth: HAIRLINE,
                        borderColor: cl.gold40,
                      }}
                    >
                      <Avatar name={p.name ?? undefined} size={22} />
                      <CText t="metaSm" color={cl.ink}>
                        {(p.name ?? '').trim().split(/\s+/)[0] || 'Unknown'}
                      </CText>
                    </View>
                  );
                  // Resolved contacts open their card so you can verify or dig in;
                  // a name-only mention (not linked yet) is not tappable.
                  // Tap opens the card; LONG-PRESS is how a wrong one gets
                  // fixed. Discoverability is the honest cost -- a long press is
                  // invisible -- but the alternative is a visible affordance on
                  // every chip for something that is wrong maybe one time in
                  // twenty, and the three-dot menu carries the same actions
                  // where they can be seen.
                  return p.contactId ? (
                    <Pressable
                      key={p.contactId}
                      onPress={() => onOpenPerson?.(p.contactId as string)}
                      onLongPress={() =>
                        tagActions({
                          contactId: p.contactId as string,
                          name: (p.name ?? '').trim(),
                        })
                      }
                      delayLongPress={320}
                      accessibilityRole="button"
                      accessibilityLabel={`${p.name ?? 'Contact'} — tap to open, hold to change`}
                      style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
                    >
                      {chip}
                    </Pressable>
                  ) : (
                    <View key={`p-${i}`}>{chip}</View>
                  );
                })}
              </View>
            ) : null}

            {/* THE UNANSWERED QUESTION, ON THE NOTE.
                Amber heard a name it could not place. It used to ask once in
                the chat, take "no" for an answer and record nothing you could
                act on -- so the note stayed about nobody. Here it is a row you
                can answer whenever you next see the note. */}
            {pendingNames.length > 0 ? (
              <View
                style={{
                  marginTop: 12,
                  paddingTop: 12,
                  borderTopWidth: HAIRLINE,
                  borderTopColor: cl.rule,
                  gap: 8,
                }}
              >
                {pendingNames.map((pt) => (
                  <Pressable
                    key={pt.observationId}
                    onPress={() => setResolving({ rawName: pt.rawName, body: pt.body })}
                    accessibilityRole="button"
                    accessibilityLabel={`Say who ${pt.rawName} is`}
                    hitSlop={6}
                    style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
                  >
                    <View
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 8,
                        flexWrap: 'wrap',
                      }}
                    >
                      <CText t="metaSm" color={cl.ink48} style={{ letterSpacing: 1 }}>
                        WHO IS
                      </CText>
                      <View
                        style={{
                          paddingHorizontal: 10,
                          paddingVertical: 3,
                          borderRadius: 999,
                          borderWidth: HAIRLINE,
                          borderStyle: 'dashed',
                          borderColor: cl.gold40,
                        }}
                      >
                        <CText t="metaSm" color={cl.ink}>
                          {pt.rawName}
                        </CText>
                      </View>
                      <CText t="metaSm" color={cl.goldDeep}>
                        Say who
                      </CText>
                    </View>
                  </Pressable>
                ))}
              </View>
            ) : null}
          </View>
        </CCard>
      )}
    </Pressable>
    </>
  );
}

/**
 * TAGGED IN THIS NOTE — the three-dot entry, and it used to be an Alert.
 *
 * `Alert.alert('Tagged in this note', names.join(', '))` with an OK button: it
 * told you who was tagged and offered nothing to do about it. You could not open
 * any of them and you could not fix a wrong one, which is the only reason
 * anybody opens that menu item.
 *
 * Rows now. Tap opens the card, the three dots carry the same actions as a
 * long-press on the chip, and the count is in the title because "Tagged in this
 * note" with one row and "Tagged in this note" with four read differently.
 */
function TaggedInNoteSheet({
  visible,
  people,
  onClose,
  onOpen,
  onActions,
}: {
  visible: boolean;
  people: { contactId: string; name: string }[];
  onClose: () => void;
  onOpen: (contactId: string) => void;
  onActions: (person: { contactId: string; name: string }) => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <Pressable
        onPress={onClose}
        accessibilityLabel="Close"
        style={{ flex: 1, backgroundColor: 'rgba(32,31,29,0.28)', justifyContent: 'flex-end' }}
      >
        {/* A nested Pressable that swallows the tap, so pressing the sheet does
            not dismiss it through the backdrop underneath. */}
        <Pressable
          onPress={() => {}}
          style={{
            backgroundColor: cl.groundCream,
            borderTopLeftRadius: 22,
            borderTopRightRadius: 22,
            paddingHorizontal: 18,
            paddingTop: 18,
            paddingBottom: Math.max(insets.bottom, 12) + 12,
            gap: 4,
          }}
        >
          <CText t="kicker" color={cl.goldKicker}>
            {people.length === 1 ? 'TAGGED IN THIS NOTE' : `TAGGED IN THIS NOTE · ${people.length}`}
          </CText>
          {people.length === 0 ? (
            <CText t="body" color={cl.ink55} style={{ paddingVertical: 14 }}>
              No one is tagged in this note yet.
            </CText>
          ) : (
            people.map((p) => (
              <View
                key={p.contactId}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 12,
                  paddingVertical: 12,
                  borderBottomWidth: HAIRLINE,
                  borderBottomColor: cl.gold12,
                }}
              >
                <Pressable
                  onPress={() => onOpen(p.contactId)}
                  accessibilityRole="button"
                  accessibilityLabel={`Open ${p.name || 'contact'}`}
                  style={({ pressed }) => ({
                    flex: 1,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 12,
                    opacity: pressed ? 0.6 : 1,
                  })}
                >
                  <Avatar name={p.name || undefined} size={34} />
                  <CText t="body" color={cl.ink} numberOfLines={1} style={{ flex: 1 }}>
                    {p.name || 'Unknown'}
                  </CText>
                </Pressable>
                <Pressable
                  onPress={() => onActions(p)}
                  accessibilityRole="button"
                  accessibilityLabel={`Change or remove ${p.name || 'this tag'}`}
                  hitSlop={12}
                  style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}
                >
                  <MoreHorizontal size={18} color={cl.ink48} strokeWidth={2} />
                </Pressable>
              </View>
            ))
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function formatAgo(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const mins = Math.floor((Date.now() - t) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

// Memoized: HomeScreen re-renders on each pager-position change during a swipe.
// This page's props (goToPage / openPerson) are stable useCallbacks, so memo
// stops the whole Today feed tree from re-reconciling while People or You is the
// page actually moving under the gesture.
export const HomePage = memo(HomePageBase);
