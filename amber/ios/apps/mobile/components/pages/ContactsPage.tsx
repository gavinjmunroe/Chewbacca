import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  RefreshControl,
  useWindowDimensions,
  View,
} from 'react-native';
import { Pressable } from '../Pressable';

// No timing constants here any more, and no pager either. Nothing in this file
// animates on a clock: the only motion during a page change is home's single native
// pager slide, and the one thing here that moves with it — the Find/Ask segment's ink
// — reads that pager's own live position (`pageCursor`) on the UI thread.
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as Contacts from 'expo-contacts';
import * as Haptics from 'expo-haptics';
import { Check, Users } from 'lucide-react-native';
import { Text } from '../Text';
import { bustContactsCache, type NetworkIdentity } from '../../lib/network';
import { seedCachedPerson } from '../../lib/peoplerank';
import { formatCount } from '../../lib/contactsSync';
import { startContactsSync } from '../../lib/contactsSyncEngine';
import { getContactsSummary, enrichContacts } from '../../lib/enrichment';
import {
  MAX_FAVORITES,
  addFavorite,
  listFavorites,
  removeFavorite,
  reorderFavorites,
  type Favorite,
} from '../../lib/favorites';
import { FavoritesGrid } from '../FavoritesGrid';
import { DirectMessagesSection } from '../DirectMessagesSection';
import { DmThreadView } from '../DmThreadView';
import { NewDmModal } from '../NewDmModal';
import { useDmThreads } from '../../lib/dms';
import { AddFavoriteModal } from '../AddFavoriteModal';
import { medhaIdErrorCopy, unwrapOrThrow } from '../../lib/medhaId';
// bandColor / bandForScore / RankBand are intentionally NOT imported: see the
// "PARKED" note in lib/classical.ts. This card no longer claims a strength.
import { HAIRLINE, cl, clLayout, clRadius } from '../../lib/classical';
import {
  CAvatar,
  CCard,
  CPressable,
  CSectionHeader,
  CText,
} from '../classical';
import { toast } from '../../lib/toast';
import { fonts, radius, spacing } from '../../lib/tokens';
import { LIGHT } from '../../lib/theme';
import { useContacts, firstLetter, type ContactsState } from '../../lib/useContacts';
import { useSyncState } from '../../lib/syncState';
import { saveContactsSummary } from '../../lib/contactsSummary';
import { filterPeople } from '../../lib/peopleSearch';

// The enrich endpoint caps a batch at 200 contact IDs.
const ENRICH_CHUNK = 200;

// What the strip needs to render its idle line. Satisfied both by the live
// ContactSummary and by the persisted cache, so the strip does not care which


// ONE CONTACT'S SLOT IN THE LIST, and why it is split in two.
//
// Contacts are discrete cards now rather than hairline-separated rows, so the
// visible card is shorter than the slot it occupies and the difference is the
// gap between cards. `getItemLayout` and `onScrollToIndexFailed` both compute
// offsets as `ROW_H * index`, which is what makes the A-Z rail land on the
// right letter instantly on a list of ~1,000 people — so ROW_H must stay the
// FULL slot height, card plus gap, or every jump lands short by 8pt per row.
const CARD_H = 56;
const CARD_GAP = 8;
const ROW_H = CARD_H + CARD_GAP;

// NO SHADOW ON THESE CARDS, and that is a decision rather than an omission.
//
// There are around a hundred of them mounted at windowSize 11, and they sit at
// the top of the page where a thumb starts the horizontal swipe between tabs.
// An iOS shadow forces an offscreen render pass per view unless the view is
// rasterized, and rasterizing a hundred views full of text is its own problem --
// so even the lightest shadow here is paid for a hundred times over in exactly
// the frames that have to be smooth.
//
// It is not what makes these read as cards anyway. lib/classical.ts says it
// outright: a white card on this ground "separates on tone alone". The fill and
// a firmer hairline do the work. CARD_EDGE is the single value to lift if it
// ever looks flat on device.
const CARD_EDGE = 'rgba(32,31,29,0.09)';

// Horizontal space the floating A-Z index occupies. Reserved as extra right
// margin on contact rows, because the rail is absolutely positioned and so
// reserves no layout width of its own.
const INDEX_RAIL_WIDTH = 18;

// The single source of truth for horizontal insets inside the People list.
//
// EVERY component in this column must use this — the enrich strip, the favorites
// cards, the pinned-face row, the section headers and the contact rows. The A-Z
// index floats above the list and reserves no layout width of its own, so any
// component that pads symmetrically slides under the letters. Fixing them
// one-at-a-time is what caused this to keep coming back; there is now one object
// to change and nothing to keep in sync.
//
// Screen-size independent: both values are token-derived, and the rail itself
// sizes from useWindowDimensions, so this holds on an SE and a Pro Max alike.
const LIST_INSET = {
  paddingLeft: clLayout.gutter,
  paddingRight: clLayout.gutter + INDEX_RAIL_WIDTH,
} as const;

// Margin flavor, for components that position with margin rather than padding.
const LIST_INSET_MARGIN = {
  marginLeft: clLayout.gutter,
  marginRight: clLayout.gutter + INDEX_RAIL_WIDTH,
} as const;

// How many people can be pinned as Network Favorites. Nine fits three rows of
// three on the narrowest supported device without the row scrolling, which is the
// point of a shortlist — if it scrolls, it is just the contact list again.
//
// Sixteen now, and the number lives in lib/favorites so the client and the server
// cannot disagree about it — the server rejects a 17th pin with a 409, and a client
// that thought the limit was 9 would be showing a different rule to the one being
// enforced. Four rows of four.



function ContactsPageBase({
  openPerson,
  onGoToPage,
  searchQuery,
  openDmThreadId = null,
  onDmConsumed,
  headerClearance = 0,
}: {
  openPerson: (id: string) => void;
  /**
   * THE KEYWORD FILTER, OWNED BY THE SCREEN.
   *
   * This page used to render its own search bar and hold the text. That bar is now
   * one instance living above the pager (see PeopleSearchDock) so it is literally
   * the same bar on Contacts and Circles rather than two that have to be kept
   * looking alike. The text has to come from wherever the bar lives, or the list
   * and the bar can disagree about what was typed.
   */
  searchQuery: string;
  /** Move the one pager. 0 Contacts, 1 Circles, 2 Today, 3 You. */
  onGoToPage: (index: number) => void;
  /**
   * A thread to open on arrival, from a tapped message notification. The chat is
   * a layer over this page rather than a route (see the note at its mount), so
   * the deep link has to land here and be opened from the inside.
   */
  openDmThreadId?: string | null;
  /** Called once the thread has been opened, so a re-render cannot re-open it. */
  onDmConsumed?: () => void;
  /**
   * Room for the floating People header at the top of the list. Passed down
   * rather than applied to the page wrapper -- see the note on ContactsList's
   * copy of this prop for why that mattered to direct messages.
   */
  headerClearance?: number;
}) {
  const insets = useSafeAreaInsets();
  const contacts = useContacts();
  const qc = useQueryClient();
  const [syncing, setSyncing] = useState(false);
  const [syncNote, setSyncNote] = useState<string | null>(null);
  const syncState = useSyncState();
  const prevSyncStatus = useRef(syncState.status);

  // Reload contacts when a background sync completes.
  useEffect(() => {
    const prev = prevSyncStatus.current;
    prevSyncStatus.current = syncState.status;
    if (prev === 'syncing' && syncState.status === 'done') {
      bustContactsCache();
      void contacts.reload();
    }
  }, [syncState.status, contacts]);

  async function handleShareContacts() {
    setSyncNote(null);
    setSyncing(true);
    try {
      const perm = await Contacts.requestPermissionsAsync();
      if (perm.status !== 'granted') {
        setSyncNote('No problem, you can share contacts anytime.');
        return;
      }
      // ONE ENGINE, SHARED. This screen and the Profile button used to run their
      // own copy of the sync, each reporting into the shared store from its own
      // scope -- so starting one from each place uploaded the address book twice
      // and the counter jumped between the two. startContactsSync joins a run
      // already in progress, keeps its progress in lib/syncState, and
      // checkpoints so an interrupted sync resumes on the next foreground.
      const res = await startContactsSync();
      bustContactsCache();
      await contacts.reload();
      if (!res.ok) {
        setSyncNote(
          res.sent > 0
            ? 'Saved what we could. It will pick up where it left off.'
            : 'Something interrupted the sync, try again.',
        );
        return;
      }
      setSyncNote(
        res.inserted > 0
          ? `${formatCount(res.inserted)} new contact${res.inserted === 1 ? '' : 's'} added.`
          : 'Already up to date.',
      );
      await qc.invalidateQueries({ queryKey: ['contacts', 'summary'] });
    } catch {
      setSyncNote('Something interrupted the sync, try again.');
    } finally {
      setSyncing(false);
    }
  }

  const isEmpty = contacts.status === 'done' && contacts.items.length === 0;

  return (
    <View style={{ flex: 1, backgroundColor: 'transparent' }}>
      {isEmpty ? (
        <View
          style={{
            flex: 1,
            alignItems: 'center',
            justifyContent: 'center',
            paddingHorizontal: spacing.xl,
            gap: spacing.lg,
            // Centered in the space BELOW the floating header, now that the page
            // itself runs the full height of the screen.
            paddingTop: headerClearance,
            paddingBottom: insets.bottom,
          }}
        >
          <Users color={cl.gold} size={38} strokeWidth={1.6} />
          <View style={{ gap: 6, alignItems: 'center' }}>
            <CText t="heroName" style={{ textAlign: 'center', fontSize: 26, lineHeight: 30 }}>
              See your people here
            </CText>
            <CText t="quote" color={cl.ink55} style={{ textAlign: 'center' }}>
              Share your contacts so Amber can help you stay close to the people who matter.
            </CText>
          </View>
          {syncNote ? (
            <CText t="body" color={cl.ink48} style={{ textAlign: 'center' }}>
              {syncNote}
            </CText>
          ) : null}
          <Pressable
            onPress={() => void handleShareContacts()}
            disabled={syncing}
            accessibilityRole="button"
            accessibilityLabel="Share Your Apple Contacts"
            style={({ pressed }) => ({ opacity: pressed || syncing ? 0.7 : 1 })}
          >
            <View
              style={{
                borderRadius: clRadius.chip,
                borderWidth: HAIRLINE,
                borderColor: cl.gold55,
                backgroundColor: 'rgba(255,255,255,0.6)',
                paddingVertical: 13,
                paddingHorizontal: 22,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 8,
              }}
            >
              {syncing ? <ActivityIndicator size="small" color={cl.goldDeep} /> : null}
              <CText t="listTitle" color={cl.goldDeep}>
                {syncing ? 'Syncing your contacts…' : 'Share your Apple contacts'}
              </CText>
            </View>
          </Pressable>
        </View>
      ) : (
        <View style={{ flex: 1, paddingBottom: insets.bottom }}>
          <ContactsList
            contacts={contacts}
            onOpenPerson={openPerson}
            onGoToPage={onGoToPage}
            searchQuery={searchQuery}
            openDmThreadId={openDmThreadId}
            onDmConsumed={onDmConsumed}
            headerClearance={headerClearance}
          />
        </View>
      )}
    </View>
  );
}

function ContactsList({
  contacts,
  onOpenPerson,
  onGoToPage,
  searchQuery,
  openDmThreadId = null,
  onDmConsumed,
  headerClearance = 0,
}: {
  contacts: ContactsState & { reload: () => void };
  onOpenPerson: (id: string) => void;
  /** The keyword filter, typed into the one bar that lives above the pager. */
  searchQuery: string;
  /** Move the one pager. 0 Contacts, 1 Circles, 2 Today, 3 You. */
  onGoToPage: (index: number) => void;
  /** A thread to open on arrival, from a tapped message notification. */
  openDmThreadId?: string | null;
  /** Called once it has been opened, so a re-render cannot re-open it. */
  onDmConsumed?: () => void;
  /**
   * How much room the floating People header needs at the top of the list.
   *
   * It used to be paddingTop on the PAGE WRAPPER in home.tsx, which meant this
   * whole component -- including the full-screen direct-message layer it mounts
   * at the bottom -- started below the header. That is why a conversation opened
   * with a "People" banner above its own header: the DM could not physically
   * reach the top of the screen. The page is full-height now and the clearance
   * lives inside the list header, where it belongs and where getItemLayout's
   * measured offset picks it up for free.
   */
  headerClearance?: number;
}) {
  const listRef = useRef<FlatList<NetworkIdentity>>(null);
  const [refreshing, setRefreshing] = useState(false);
  // The list header embeds the Circles grid, whose height changes as circles
  // load / are created (empty state -> card rows). getItemLayout must offset
  // every row by the header's REAL height, so we measure it via onLayout
  // instead of assuming a fixed constant. Assuming a constant is what caused
  // rows to slide under the header (top "invisible") and left phantom space at
  // the bottom once a circle was created.
  const [headerHeight, setHeaderHeight] = useState(0);

  // NO `mode` STATE LIVES HERE ANY MORE, and that absence is the fix.
  //
  // It used to be `useState<'find'|'ask'>`, written in onPageSelected. It fed
  // exactly one thing — PeopleHeader's placeholder / border / pointerEvents — but
  // setting it re-rendered THIS component, which owns a 968-row FlatList with a live
  // header and AskChat's whole subtree. Landing that burst at the end of every tab
  // slide is the hitch. PeopleHeader now derives the same boolean from the pager
  // cursor on the UI thread and re-renders only itself, so a tab tap costs this
  // component zero renders. See the note in SharedHeader.tsx.

  // Tapping a Today voice note loads its conversation and asks this tab to show
  // Ask, so the thread appears where you can keep talking about it.

  // Dictation moved to the bar itself, which now lives above the pager and owns its
  // own mic for both modes. One mic on one bar rather than a recognizer per page.

  // ONE MATCHER FOR EVERY PEOPLE LIST -- see lib/peopleSearch.ts. This filter was
  // written out four times across the app and had already drifted; it also could
  // not find "Sirin" for "Şirin", or "odell marcus" for "Marcus O'Dell".
  const filteredContacts = useMemo(
    () => filterPeople(contacts.items, searchQuery) as typeof contacts.items,
    [contacts, searchQuery],
  );

  const letters = useMemo(() => {
    const seen = new Set<string>();
    for (const p of contacts.items) seen.add(firstLetter(p.name));
    return Array.from(seen);
  }, [contacts.items]);

  const letterIndex = useMemo(() => {
    const map = new Map<string, number>();
    contacts.items.forEach((p, i) => {
      const l = firstLetter(p.name);
      if (!map.has(l)) map.set(l, i);
    });
    return map;
  }, [contacts.items]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await contacts.reload();
    setRefreshing(false);
  }, [contacts]);

  const jumpTo = useCallback(
    (letter: string) => {
      const index = letterIndex.get(letter);
      if (index == null) return;
      void Haptics.selectionAsync().catch(() => {});
      listRef.current?.scrollToIndex({ index, animated: false, viewOffset: 0 });
    },
    [letterIndex],
  );

  // --- Enrichment (F6c) ------------------------------------------------------
  const qc = useQueryClient();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [enriching, setEnriching] = useState(false);
  const [addFavOpen, setAddFavOpen] = useState(false);

  // NO PAGER IN HERE ANY MORE.
  //
  // This file used to own a second horizontal PagerView (Contacts <-> Ask)
  // nested inside home.tsx's. Two nested horizontal pagers make "swipe left" mean
  // two different things at once, and iOS hands the gesture to the inner scroll
  // view unconditionally -- so the inner one had to be gesture-disabled, and the
  // outer one still felt like it was guessing. There is now ONE pager, in
  // home.tsx, with one page per tab: People, Today, You. A single pager cannot
  // disagree with itself, so every horizontal swipe is unambiguous.
  //
  // Ask is no longer a page at all -- it is an overlay opened by the shared bar
  // from Today or Profile -- so the Find/Ask segment, its cursor and the
  // "which half of People am I on" bookkeeping are gone with it.

  // The dictation mic that used to live in this tab's bar is gone: the one bar
  // leads with a RECORD button (the voice-note modal), not a dictate-into-the-box
  // mic, so there is no recognizer here to stop on leave.

  // Network Favorites — up to MAX_FAVORITES hand-pinned people, shown above the
  // full contact list. Distinct from the address book: everything is already IN
  // Amber, this is the shortlist you actually care about.
  const favoritesQuery = useQuery({
    queryKey: ['favorites'],
    queryFn: async () => unwrapOrThrow(await listFavorites()).favorites,
    staleTime: 60_000,
  });

  // Stable reference for the cap checks + memo deps below. useMemo, not a bare
  // `?? []`, because a fresh [] literal every render would defeat the memo on
  // onAddFavorite and recreate the callback continuously.
  const favoritesData = useMemo(() => favoritesQuery.data ?? [], [favoritesQuery.data]);

  // Direct messages — the section between Network favorites and All contacts.
  //
  // The thread view is rendered as a full-screen layer OVER this page rather than
  // as a route: the People tab lives inside a horizontal pager, and pushing a
  // route from inside one loses the pager's position on the way back.
  const dms = useDmThreads();
  const [openDm, setOpenDm] = useState<{ threadId: string; name: string } | null>(null);
  // THE TAPPED MESSAGE. The push carries the thread id but not the other
  // person's name, and the header needs the name -- so this waits for the thread
  // list rather than opening a chat titled "Someone". The id is consumed as soon
  // as it is acted on; if the list has loaded and does not contain it (deleted,
  // or the notification is old) it is dropped rather than left pending forever.
  useEffect(() => {
    if (!openDmThreadId) return;
    const hit = dms.threads.find((t) => t.threadId === openDmThreadId);
    if (hit) {
      setOpenDm({ threadId: hit.threadId, name: hit.other?.name || 'Message' });
      onDmConsumed?.();
      return;
    }
    if (!dms.loading) onDmConsumed?.();
  }, [openDmThreadId, dms.threads, dms.loading, onDmConsumed]);
  const [newDmOpen, setNewDmOpen] = useState(false);
  const onAddFavorite = useCallback(
    async (contactId: string, note?: string, tags?: string[]) => {
      // Re-check at write time. The button guard covers the common path, but two
      // quick taps (or a stale render) could otherwise slip past it.
      if (favoritesData.length >= MAX_FAVORITES) {
        toast.error(`You can pin ${MAX_FAVORITES} favorites.`);
        return;
      }
      const r = await addFavorite(contactId, note, tags);
      if (r.ok) {
        await qc.invalidateQueries({ queryKey: ['favorites'] });
        toast.success('Pinned to favorites.');
      } else {
        // Show the server's actual reason. This used to be a flat "could not
        // pin", which hid the one failure that actually happens: the contact
        // isn't in the synced address book, so the pin can never join back to a
        // contact row and would silently never appear.
        toast.error('Could not pin to favorites.', medhaIdErrorCopy(r, 'Amber'));
      }
    },
    // favoritesData (the resolved array), NOT favoritesQuery — the query object is
    // a fresh identity on every render and would make this memo pointless.
    [qc, favoritesData],
  );

  // A transcript that finished AFTER the sheet closed. The favorite already
  // exists, so this goes straight to addFavorite (an upsert) rather than through
  // onAddFavorite — whose MAX_FAVORITES guard would reject a person who is
  // already pinned and silently drop their words. Tags are resent because the
  // upsert overwrites them.
  const onFavoriteLateNote = useCallback(
    (contactId: string, note: string, tags?: string[]) => {
      void (async () => {
        const r = await addFavorite(contactId, note, tags);
        if (r.ok) {
          await qc.invalidateQueries({ queryKey: ['favorites'] });
          toast.success('Saved to their card.', 'Your voice note finished after you tapped add.');
        } else {
          toast.error("Couldn't save that voice note.", medhaIdErrorCopy(r, 'Amber'));
        }
      })();
    },
    [qc],
  );

  // SAVE THE ARRANGEMENT, and do not refetch afterwards on purpose. FavoritesGrid
  // already shows the new order — it is the thing the finger just did — so
  // invalidating the query here would round-trip and repaint the grid for no visible
  // benefit, with a real chance of briefly flashing the old order. Only a FAILURE
  // refetches, to put the grid back to whatever the server actually holds rather
  // than leaving the user looking at an arrangement that was not saved.
  const onReorderFavorites = useCallback(
    (ids: string[]) => {
      void reorderFavorites(ids).then((r) => {
        if (!r.ok) {
          toast.error('Could not save that order.');
          void qc.invalidateQueries({ queryKey: ['favorites'] });
        }
      });
    },
    [qc],
  );

  const onRemoveFavorite = useCallback(
    (fav: Favorite) => {
      Alert.alert('Unpin from favorites?', fav.name, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            await removeFavorite(fav.id);
            await qc.invalidateQueries({ queryKey: ['favorites'] });
          },
        },
      ]);
    },
    [qc],
  );

  const summaryQuery = useQuery({
    queryKey: ['contacts', 'summary'],
    queryFn: async () => unwrapOrThrow(await getContactsSummary()),
  });

  // Last-known summary off disk. Paints the strip immediately on a cold launch,
  // before summaryQuery has answered.

  // Persist every fresh answer so the next launch has something to show.
  useEffect(() => {
    const live = summaryQuery.data;
    if (!live) return;
    void saveContactsSummary({
      total: live.total,
      bySource: live.bySource ?? {},
      merged: live.merged,
    });
  }, [summaryQuery.data]);

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const exitSelectMode = useCallback(() => {
    setSelectMode(false);
    setSelectedIds(new Set());
  }, []);

  // A STABLE renderItem, and the ref that makes it possible.
  //
  // renderItem must never change identity (CellRenderer is a PureComponent that
  // compares it), but it needs to call handlers that DO change. The ref is the
  // indirection: the callback reads the latest handlers at press time without being
  // rebuilt when they change. `rowExtra` is what actually tells the list something
  // visible changed — that is what extraData is for.
  // 968 OBJECTS PER RENDER, FOR A MODAL THAT IS CLOSED. This was mapped inline into
  // AddFavoriteModal's props, so every render of this component — including the ones
  // that used to land mid-slide — allocated a fresh array of ~968 objects AND gave the
  // modal a new `contacts` identity, invalidating its own useMemo over the search
  // filter. RN's Modal renders null while hidden, so all of that was pure waste.
  const favoritePickList = useMemo(
    () => contacts.items.map((c) => ({ id: c.id, name: c.name })),
    [contacts.items],
  );

  const rowHandlersRef = useRef({ selectMode, selectedIds, toggleSelect, onOpenPerson });
  rowHandlersRef.current = { selectMode, selectedIds, toggleSelect, onOpenPerson };
  const rowExtra = useMemo(
    () => ({ selectMode, size: selectedIds.size }),
    [selectMode, selectedIds],
  );
  const renderContactRow = useCallback(
    ({ item }: { item: NetworkIdentity }) => (
      <ContactRow
        person={item}
        selectMode={rowHandlersRef.current.selectMode}
        selected={rowHandlersRef.current.selectedIds.has(item.id)}
        onPress={() => {
          const h = rowHandlersRef.current;
          if (h.selectMode) h.toggleSelect(item.id);
          else {
            // Hand the detail screen a name BEFORE it mounts. Opening a contact from
            // chat was already instant because askPeopleRank had cached the person on
            // the way past; opening the same contact from here mounted with nothing,
            // so the push animation slid a gray skeleton in that snapped to the real
            // name a beat later. Seeding never overwrites a richer ranked entry.
            // A list row genuinely only knows the name; NetworkIdentity carries no
            // title or company. A name on the first frame is the whole point.
            seedCachedPerson({ id: item.id, name: item.name ?? '' });
            h.onOpenPerson(item.id);
          }
        }}
      />
    ),
    [],
  );

  // Enrich a set of contact ids in chunks of <=200 (the endpoint's cap). List
  // rows carry no per-contact status, so bulk sends every id and relies on the
  // server to skip already-enriched ones (reflected in the tally). Ambiguous
  // results are not handled here — they surface as the per-card picker (F6b).
  const runEnrich = useCallback(
    async (ids: string[]) => {
      if (enriching || ids.length === 0) return;
      setEnriching(true);
      toast.info(`Enriching ${formatCount(ids.length)}…`, 'This runs in the background.');
      let failed = 0;
      for (let i = 0; i < ids.length; i += ENRICH_CHUNK) {
        const slice = ids.slice(i, i + ENRICH_CHUNK);
        const r = await enrichContacts(slice);
        if (!r.ok) failed += slice.length;
      }
      bustContactsCache();
      await qc.invalidateQueries({ queryKey: ['contacts', 'summary'] });
      await contacts.reload();
      setEnriching(false);
      if (failed > 0) {
        toast.error('Some contacts could not be enriched.', `${formatCount(failed)} failed.`);
      } else {
        toast.success('Enrichment complete.');
      }
    },
    [enriching, qc, contacts],
  );

  const onEnrichAll = useCallback(() => {
    setSheetOpen(false);
    void runEnrich(contacts.items.map((c) => c.id));
  }, [runEnrich, contacts.items]);

  const onChooseContacts = useCallback(() => {
    setSheetOpen(false);
    setSelectedIds(new Set());
    setSelectMode(true);
  }, []);

  const onEnrichSelected = useCallback(() => {
    const ids = [...selectedIds];
    exitSelectMode();
    void runEnrich(ids);
  }, [selectedIds, exitSelectMode, runEnrich]);

  const summary = summaryQuery.data;
  const enrichedCount = summary
    ? Number(summary.byStatus?.enriched ?? summary.byStatus?.resolved ?? 0)
    : 0;
  const unenrichedCount = summary ? Math.max(0, summary.total - enrichedCount) : 0;


  if (contacts.status === 'loading') {
    return (
      <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.lg }}>
        {[0, 1, 2, 3, 4, 5, 6].map((i) => (
          <View
            key={i}
            style={{
              height: CARD_H,
              marginBottom: CARD_GAP,
              flexDirection: 'row',
              alignItems: 'center',
              gap: spacing.md,
              paddingHorizontal: 12,
              borderRadius: 18,
              backgroundColor: cl.card,
              borderWidth: HAIRLINE,
              borderColor: CARD_EDGE,
            }}
          >
            <Block w={40} h={40} r={radius.full} />
            <View style={{ flex: 1, gap: spacing.sm }}>
              <Block w="55%" h={14} />
            </View>
          </View>
        ))}
      </View>
    );
  }

  if (contacts.status === 'error') {
    return (
      <DarkState
        title="Couldn't load your network."
        description={contacts.errorMsg}
        onRetry={contacts.reload}
      />
    );
  }

  // UNREACHABLE IN PRACTICE, kept as a backstop. ContactsPageBase decides the empty case
  // before this component mounts and renders its own "Share your Apple contacts" flow
  // (with the permission request), so a zero-contact user never gets here. Left in place
  // because `contacts.items` can also empty out mid-session — a failed reload, a signed-out
  // account — and a bare screen would be worse than this.
  if (contacts.items.length === 0) {
    return (
      <DarkState
        icon={<Users color={LIGHT.textSecondary} size={26} />}
        title="No contacts yet."
        description="Sync your contacts to build your network, then ask Amber to rank anyone for anything."
      />
    );
  }

  return (
    <View style={{ flex: 1 }}>
      {/* NO HEADER HERE. The title, the add button and the Find/Ask segment are
          rendered ONCE in home.tsx, floating above both this page and Circles, so the
          header holds still and only the page bodies slide. This page's top padding
          comes from the pager. */}

      {/* Both pages stay mounted; the pager slides between them natively.
          Mount/unmount plus a fade can never be smooth here, because mounting
          AskChat (ChatProvider + circles fetch + emblems) takes longer than a
          frame and no animation hides that.

          scrollEnabled={false}, and it STAYS false. This pager is nested inside
          home.tsx's People/Today/You pager and both are horizontal, so there is no
          arbitration to write: "swipe left" from Contacts would have to mean both
          "go to Circles" and "go to Today", and iOS gives the gesture to the inner
          scroll view unconditionally. Enabling it does not split the gesture, it
          just takes People -> Today away entirely. So Find/Ask is tap-driven (the
          segmented control is the affordance) and every horizontal SWIPE belongs to
          the outer pager.

          That outer swipe being unreliable was a different bug, fixed separately:
          the vertical lists on each page had no `directionalLockEnabled`, so iOS
          handed a slightly-diagonal drag to the list instead of the pager. Hence
          "it works sometimes". Every scrollable inside a pager page now sets it. */}
      {/* THE SUMMARY / ENRICH STRIP IS DELIBERATELY NOT RENDERED.
          Removed from the UI on request so People opens straight onto Network
          favorites. Nothing was deleted: SummaryStrip and EnrichSheet are both still
          defined below, the enrichment code paths are untouched, and enrichment is still
          reachable from multi-select ("Enrich N selected"). Re-adding it is putting this
          element back.

          KNOWN TRADE-OFF, accepted: this strip was also the only place a contacts sync
          reported progress ("Syncing… 400 of 969"), so a sync is now silent. If that
          becomes confusing, the fix is a progress line somewhere else rather than
          bringing the Enrich button back. */}

      {selectMode ? (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingHorizontal: spacing.lg,
            paddingBottom: spacing.sm,
          }}
        >
          <Text variant="titleSm" style={{ color: LIGHT.textPrimary }}>
            {`${selectedIds.size} selected`}
          </Text>
          <Pressable
            onPress={exitSelectMode}
            accessibilityRole="button"
            accessibilityLabel="Cancel selection"
            hitSlop={8}
            style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
          >
            <Text variant="buttonSm" style={{ color: LIGHT.accentText }}>
              Cancel
            </Text>
          </Pressable>
        </View>
      ) : null}

      <FlatList
        ref={listRef}
        data={filteredContacts}
        keyExtractor={(p) => p.id}
        // No horizontal padding here: the header's section blocks each carry
        // their own gutter, and adding the list's on top double-inset everything.
        // Contact rows get theirs via ContactRow's own margin.
        contentContainerStyle={{ paddingBottom: clLayout.fabClearance }}
        // directionalLockEnabled: this list lives inside a horizontal pager. Without the
        // lock, iOS lets this scroll view claim a slightly-diagonal drag, so the swipe
        // between People / Today / You worked sometimes and did nothing other times
        // depending on the exact angle of the finger. The lock makes a mostly-horizontal
        // drag stay unclaimed here so the pager gets it, every time.
        directionalLockEnabled
        keyboardShouldPersistTaps="handled"
        // keyboardDismissMode: a downward drag puts the keyboard away, and on iOS
        // "interactive" means it tracks the finger rather than snapping -- so the
        // gesture is reversible mid-drag and the search bar (welded to the
        // keyboard's top edge, see useKeyboardBarLift) comes down with it under
        // the finger. Without this the search keyboard could not be dismissed by
        // any gesture on this screen at all.
        keyboardDismissMode="interactive"
        showsVerticalScrollIndicator={false}
        initialNumToRender={14}
        maxToRenderPerBatch={16}
        windowSize={11}
        removeClippedSubviews
        getItemLayout={(_data, index) => ({
          length: ROW_H,
          offset: headerHeight + ROW_H * index,
          index,
        })}
        onScrollToIndexFailed={({ index }) => {
          listRef.current?.scrollToOffset({
            offset: headerHeight + ROW_H * index,
            animated: false,
          });
        }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={LIGHT.textMuted} />
        }
        ListHeaderComponent={
          <View
            // The header clearance is INSIDE the measured header, so
            // getItemLayout's `headerHeight + ROW_H * index` stays correct with no
            // second constant to keep in step.
            style={{ paddingTop: headerClearance }}
            onLayout={(e) => {
              const h = e.nativeEvent.layout.height;
              setHeaderHeight((prev) => (Math.abs(prev - h) > 0.5 ? h : prev));
            }}
          >
            {searchQuery ? null : (
              <FavoritesSection
                favorites={favoritesData}
                loadError={favoritesQuery.isError}
                onRetry={() => void favoritesQuery.refetch()}
                onOpenPerson={onOpenPerson}
                onAdd={() => {
                  if (favoritesData.length >= MAX_FAVORITES) {
                    toast.error(
                      `You can pin ${MAX_FAVORITES} favorites.`,
                      'Unpin someone first — tap and hold a face to remove it.',
                    );
                    return;
                  }
                  setAddFavOpen(true);
                }}
                onRemove={onRemoveFavorite}
                onReorder={onReorderFavorites}
              />
            )}

            {/* DIRECT MESSAGES — under Network favorites, above All contacts.
                Hidden while searching, same as the favorites above: a name
                filter is about the address book, and leaving a conversation list
                on screen while it runs makes the results look incomplete. */}
            {searchQuery ? null : (
              <DirectMessagesSection
                threads={dms.threads}
                loadError={dms.error}
                onRetry={() => void dms.reload()}
                onOpenThread={(threadId, name) => setOpenDm({ threadId, name })}
                onNewMessage={() => setNewDmOpen(true)}
                inset={LIST_INSET}
              />
            )}

            <View style={{ paddingTop: searchQuery ? 14 : clLayout.sectionGap }}>
              <CSectionHeader
                tone="neutral"
                rule="ink"
                insetRight={INDEX_RAIL_WIDTH}
                title={searchQuery ? 'Matches' : 'All contacts'}
                right={
                  searchQuery
                    ? `${filteredContacts.length}`
                    : `${contacts.items.length}`
                }
              />
            </View>
          </View>
        }
        ListEmptyComponent={
          searchQuery ? (
            // KEYWORD MATCH, AND ONLY THAT. This briefly offered "Ask Amber" and
            // "Search the web" here; both are gone on purpose. This field filters
            // the address book you already have — nothing it does should reach the
            // network or the internet. Asking anything lives on the Circles page.
            <View style={{ paddingTop: 22, ...LIST_INSET, alignItems: 'center' }}>
              <CText t="aside" color={cl.ink45}>
                Nobody here by that name.
              </CText>
            </View>
          ) : null
        }
        renderItem={renderContactRow}
        // extraData is what tells the list to re-render cells when selection state
        // changes, now that renderItem itself never changes identity.
        extraData={rowExtra}
      />
      {letters.length > 2 && !searchQuery && !selectMode ? (
        <AlphabetRail letters={letters} onJump={jumpTo} />
      ) : null}

      {selectMode ? (
        <View
          style={{
            paddingHorizontal: spacing.lg,
            paddingTop: spacing.sm,
            paddingBottom: spacing.base,
            borderTopWidth: 1,
            borderTopColor: LIGHT.hairline,
            backgroundColor: LIGHT.canvas,
          }}
        >
          <Pressable
            onPress={onEnrichSelected}
            disabled={selectedIds.size === 0 || enriching}
            accessibilityRole="button"
            accessibilityLabel="Enrich selected contacts"
            style={({ pressed }) => ({
              opacity: selectedIds.size === 0 || enriching ? 0.5 : pressed ? 0.85 : 1,
            })}
          >
            <View
              style={{
                height: 48,
                borderRadius: radius.full,
                backgroundColor: cl.tint100,
                borderWidth: HAIRLINE,
                borderColor: cl.gold55,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Text variant="titleSm" style={{ color: cl.goldDeep }}>
                {`Enrich ${selectedIds.size} selected`}
              </Text>
            </View>
          </Pressable>
        </View>
      ) : null}

      <EnrichSheet
        visible={sheetOpen}
        unenrichedCount={unenrichedCount}
        onEnrichAll={onEnrichAll}
        onChoose={onChooseContacts}
        onClose={() => setSheetOpen(false)}
      />

      <AddFavoriteModal
        visible={addFavOpen}
        contacts={favoritePickList}
        onClose={() => setAddFavOpen(false)}
        onAdd={onAddFavorite}
        onLateNote={onFavoriteLateNote}
      />

      <NewDmModal
        visible={newDmOpen}
        onClose={() => setNewDmOpen(false)}
        onOpenThread={(threadId, name) => setOpenDm({ threadId, name })}
      />

      {/* AN ABSOLUTE LAYER, NOT A ROUTE. This page sits inside a horizontal
          pager; pushing a route from within one and coming back loses the pager's
          position, so the chat covers the tab instead and closing it puts you
          back exactly where you were. Mounted only while open, so a closed chat
          costs nothing and its poll is genuinely stopped rather than idling. */}
      {openDm ? (
        <View style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }}>
          <DmThreadView
            threadId={openDm.threadId}
            name={openDm.name}
            // The account and the viewer's own card for them, which is what the
            // Info tab needs to show a rank and a way through to their card.
            other={dms.threads.find((t) => t.threadId === openDm.threadId)?.other ?? null}
            onOpenPerson={(id) => {
              setOpenDm(null);
              setTimeout(() => onOpenPerson(id), 180);
            }}
            blocked={
              dms.threads.find((t) => t.threadId === openDm.threadId)?.blocked ?? false
            }
            onBack={() => {
              setOpenDm(null);
              // The unread badge and the preview line are both stale the moment
              // you read or send anything, so the list refetches on the way out.
              void dms.reload();
            }}
            onDeleted={() => void dms.reload()}
          />
        </View>
      ) : null}
    </View>
  );
}

function AlphabetRail({
  letters,
  onJump,
}: {
  letters: string[];
  onJump: (letter: string) => void;
}) {
  // Responsive, not hardcoded. The rail occupies the lower ~70% of the screen, so
  // each letter gets an equal share of THAT, clamped to a legible minimum and a
  // sane maximum. On a 932pt Pro Max the letters breathe; on a 568pt SE they
  // tighten instead of overflowing the column and colliding.
  const { height } = useWindowDimensions();
  const available = height * 0.68;
  const letterBox = Math.max(11, Math.min(22, available / Math.max(1, letters.length)));
  return (
    // Floats over the list in the right margin, like Contacts.app's index. It used
    // to render in the uppercaseTag variant, which is gold — a column of gold
    // letters fighting the cards underneath. Now it is faint and fully
    // transparent, so it reads as an overlay rather than a band covering the
    // cards' right edge.
    <View
      pointerEvents="box-none"
      // Starts below the header block rather than at the very top: at top:0 the
      // column's first letters sat on top of the Circles header's "Edit" action.
      //
      // WIDTH IS RESERVED, NOT OVERLAID. The rail floats above the list, so the
      // list's own contentContainerStyle adds INDEX_RAIL_WIDTH of right padding
      // (see the FlatList below). Without that, long names and the source label
      // ran underneath the letters.
      style={{
        position: 'absolute',
        right: 3,
        top: '30%',
        bottom: 0,
        justifyContent: 'center',
        width: INDEX_RAIL_WIDTH,
      }}
    >
      <View
        style={{
          alignItems: 'center',
          // No gap and no vertical padding: on a small device (SE-class, ~568pt)
          // 26 letters plus per-item padding overflows the available column and
          // the letters collide. Spacing comes from each item's own computed
          // height below, which is derived from the space actually available.
          paddingHorizontal: 1,
        }}
      >
        {letters.map((l) => (
          <Pressable
            key={l}
            onPress={() => onJump(l)}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel={`Jump to ${l}`}
            style={{
              width: INDEX_RAIL_WIDTH,
              height: letterBox,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <CText t="labelXs" color={cl.ink38} style={{ lineHeight: letterBox }}>
              {l}
            </CText>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

/**
 * One contact row. MEMOIZED, and it only pays off because `renderItem` is hoisted and
 * `onPress` is dispatched through a ref (see renderContactRow below).
 *
 * VirtualizedList's CellRenderer is a PureComponent that receives `renderItem` as a
 * prop, so an inline arrow there fails its shallow compare and re-renders EVERY mounted
 * cell — around 100 of them at windowSize 11 — on any parent render. That was firing
 * twice per tab change, in the same frames as the pager slide.
 */
const ContactRow = memo(function ContactRow({
  person,
  onPress,
  selectMode = false,
  selected = false,
}: {
  person: NetworkIdentity;
  onPress: () => void;
  selectMode?: boolean;
  selected?: boolean;
}) {
  return (
    <CPressable
      onPress={onPress}
      accessibilityLabel={person.name}
      accessibilityState={selectMode ? { checked: selected } : undefined}
      // Extra right inset for the floating A-Z index. The rail is absolutely
      // positioned over the list, so nothing reserves space for it — without this
      // the source label ("Apple"/"Google") and long names ran under the letters.
      outer={{ alignSelf: 'stretch', ...LIST_INSET_MARGIN, marginBottom: CARD_GAP }}
      inner={{
        height: CARD_H,
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.md,
        paddingHorizontal: 12,
        borderRadius: 18,
        backgroundColor: cl.card,
        borderWidth: HAIRLINE,
        borderColor: CARD_EDGE,
      }}
    >
      <CAvatar name={person.name} size={40} tone="neutral" />
      <CText t="rowName" numberOfLines={1} style={{ flex: 1, fontSize: 17.5, lineHeight: 21 }}>
        {person.name}
      </CText>
      {selectMode ? (
        <View
          style={{
            width: 24,
            height: 24,
            borderRadius: radius.full,
            borderWidth: 1.5,
            borderColor: selected ? cl.gold55 : cl.ruleFaint,
            backgroundColor: selected ? cl.tint100 : 'transparent',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {selected ? <Check color={cl.goldDeep} size={14} strokeWidth={2.4} /> : null}
        </View>
      ) : null}
    </CPressable>
  );
})


// Bottom sheet with the two enrichment choices. Mirrors the app's modal/sheet
// pattern (dim backdrop + slide-up card).
function EnrichSheet({
  visible,
  unenrichedCount,
  onEnrichAll,
  onChoose,
  onClose,
}: {
  visible: boolean;
  unenrichedCount: number;
  onEnrichAll: () => void;
  onChoose: () => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
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
          paddingHorizontal: spacing.lg,
          paddingTop: spacing.sm,
          paddingBottom: insets.bottom + spacing.lg,
          gap: spacing.base,
        }}
      >
        <View style={{ alignItems: 'center' }}>
          <View
            style={{ width: 36, height: 4, borderRadius: radius.full, backgroundColor: LIGHT.hairline }}
          />
        </View>
        <Text variant="displaySm" style={{ color: LIGHT.textPrimary, letterSpacing: -0.3 }}>
          Enrich contacts
        </Text>
        <EnrichOption
          label={`Enrich un-enriched (${formatCount(unenrichedCount)})`}
          sublabel="Fill in LinkedIn, title, and company across your network."
          onPress={onEnrichAll}
        />
        <EnrichOption
          label="Choose contacts"
          sublabel="Pick specific people to enrich."
          onPress={onChoose}
        />
      </View>
    </Modal>
  );
}

function EnrichOption({
  label,
  sublabel,
  onPress,
}: {
  label: string;
  sublabel: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
    >
      <View
        style={{
          gap: 2,
          padding: spacing.base,
          borderRadius: radius.lg,
          borderWidth: 1,
          borderColor: LIGHT.hairline,
          backgroundColor: LIGHT.surface,
        }}
      >
        <Text variant="titleMd" style={{ color: LIGHT.textPrimary }}>
          {label}
        </Text>
        <Text variant="captionSm" style={{ color: LIGHT.textSecondary }}>
          {sublabel}
        </Text>
      </View>
    </Pressable>
  );
}

function Block({ w, h, r = radius.sm }: { w: number | `${number}%`; h: number; r?: number }) {
  return <View style={{ width: w, height: h, borderRadius: r, backgroundColor: LIGHT.surface }} />;
}

function DarkState({
  icon,
  title,
  description,
  onRetry,
  actionLabel,
  onAction,
  actionBusy = false,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  onRetry?: () => void;
  /**
   * An optional primary action, for empty states that should offer a way out rather than
   * just describing one. No current caller passes it — the zero-contacts case is handled
   * earlier by ContactsPageBase, which has its own sync button — so this is capability,
   * not a fix. Use it rather than adding another bespoke empty state.
   */
  actionLabel?: string;
  onAction?: () => void;
  actionBusy?: boolean;
}) {
  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: spacing.xl,
        gap: spacing.base,
      }}
    >
      {icon ? (
        <View
          style={{
            width: 56,
            height: 56,
            borderRadius: radius.full,
            backgroundColor: LIGHT.surface,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {icon}
        </View>
      ) : null}
      <View style={{ gap: spacing.xs, alignItems: 'center' }}>
        <Text variant="displaySm" centered style={{ color: LIGHT.textPrimary }}>
          {title}
        </Text>
        {description ? (
          <Text variant="bodyMd" centered style={{ color: LIGHT.textSecondary }}>
            {description}
          </Text>
        ) : null}
      </View>
      {actionLabel && onAction ? (
        <Pressable
          onPress={onAction}
          disabled={actionBusy}
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
          style={({ pressed }) => ({
            marginTop: spacing.sm,
            opacity: actionBusy ? 0.6 : pressed ? 0.9 : 1,
          })}
        >
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 10,
              paddingHorizontal: spacing.xl,
              height: 50,
              borderRadius: radius.full,
              backgroundColor: '#201E1D',
            }}
          >
            {actionBusy ? <ActivityIndicator size="small" color="#FFF8F0" /> : null}
            <Text
              style={{
                fontFamily: fonts.body,
                fontSize: 12.5,
                letterSpacing: 1.6,
                color: '#FFF8F0',
              }}
            >
              {actionLabel.toUpperCase()}
            </Text>
          </View>
        </Pressable>
      ) : null}
      {onRetry ? (
        <Pressable
          onPress={onRetry}
          accessibilityRole="button"
          accessibilityLabel="Try again"
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
            <Text variant="buttonSm" style={{ color: LIGHT.textPrimary }}>
              Try again
            </Text>
          </View>
        </Pressable>
      ) : null}
    </View>
  );
}

// ── People screen: Network Favorites (pinned, max 9) ────────────────────
// The hand-picked people, above the full contact list. Tap a row to open the
// person; long-press to remove. Empty state invites the first add.
function FavoritesSection({
  favorites,
  loadError = false,
  onRetry,
  onOpenPerson,
  onAdd,
  onRemove,
  onReorder,
}: {
  favorites: Favorite[];
  /** True when GET /v1/me/favorites failed. Rendered distinctly from "none yet". */
  loadError?: boolean;
  onRetry?: () => void;
  onOpenPerson: (id: string) => void;
  onAdd: () => void;
  onRemove: (fav: Favorite) => void;
  onReorder: (ids: string[]) => void;
}) {
  return (
    // 16, not headerGap's 24. headerGap is sized for "a card below a screen header",
    // and this is a kicker below a segmented control that now sits directly above it
    // — with the header's own 12pt bottom padding, 24 more made the favorites read
    // as detached from the page rather than as its first section.
    <View style={{ paddingTop: 16 }}>
      {/* Label and rule only. The Add pill that used to sit here is gone: the
          dashed add circle below sits in the row of faces, which is where the
          gesture already lives — two controls for one action just crowded the
          header. */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
          paddingHorizontal: clLayout.textGutter,
          paddingBottom: clLayout.kickerGap,
        }}
      >
        <CText t="kicker" color={cl.goldKicker} numberOfLines={1}>
          Network favorites
        </CText>
        <View style={{ flex: 1, height: HAIRLINE, backgroundColor: cl.ruleGold }} />
      </View>
      {/* A FAILED LOAD MUST NOT LOOK LIKE AN EMPTY LIST. This section used to
          receive `favoritesQuery.data ?? []`, so a 401/500 on GET /v1/me/favorites
          rendered the exact same "Add the people who matter" card as having no
          favorites — which made a successful pin look like it did nothing. */}
      {loadError ? (
        <View style={LIST_INSET}>
          <CCard style={{ borderWidth: 1, borderColor: 'rgba(32,30,29,0.12)' }}>
            <CText t="cardTitle">Couldn&apos;t load your favorites</CText>
            <CText t="metaSm" color={cl.ink55} style={{ marginTop: 3 }}>
              Your pinned people are saved — this is a loading problem, not a lost
              pin.
            </CText>
            <Pressable
              onPress={onRetry ?? (() => {})}
              accessibilityRole="button"
              accessibilityLabel="Retry loading favorites"
              hitSlop={8}
              style={({ pressed }) => ({ marginTop: 10, opacity: pressed ? 0.6 : 1 })}
            >
              <CText t="listTitle" color={cl.goldDeep}>
                Try again
              </CText>
            </Pressable>
          </CCard>
        </View>
      ) : favorites.length === 0 ? (
        <View style={LIST_INSET}>
          <CCard
            onPress={onAdd}
            accessibilityLabel="Pin a favorite"
            style={{ borderWidth: 1, borderColor: 'rgba(32,30,29,0.12)' }}
          >
            <CText t="cardTitle">Add the people who matter</CText>
            <CText t="metaSm" color={cl.ink55} style={{ marginTop: 3 }}>
              The people you actually help and stay close to.
            </CText>
          </CCard>
        </View>
      ) : (
        // A FOUR-COLUMN GRID YOU ARRANGE BY HAND — see components/FavoritesGrid.tsx.
        //
        // It used to be a plain flex-wrap of Pressables. That laid out correctly but
        // fixed the order to "most recently pinned first", which is not an order
        // anybody chose: the person you check every day could sit in the last slot
        // because you pinned them first. The grid now owns tap / drag / hold and
        // persists the arrangement.
        <View style={LIST_INSET}>
          <FavoritesGrid
            favorites={favorites}
            onOpenPerson={onOpenPerson}
            onAdd={onAdd}
            onRemove={onRemove}
            onReorder={onReorder}
          />
        </View>
      )}
    </View>
  );
}

export const ContactsPage = memo(ContactsPageBase);

