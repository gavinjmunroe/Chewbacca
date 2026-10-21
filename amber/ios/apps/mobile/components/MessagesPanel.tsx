import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  SectionList,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
  type ListRenderItemInfo,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { ChevronDown, Plus, Search, X } from 'lucide-react-native';
import { Pressable } from './Pressable';
import { DmThreadView } from './DmThreadView';
import { NewDmModal } from './NewDmModal';
import { useDmThreads, type DmThread } from '../lib/dms';
import { useContacts } from '../lib/useContacts';
import { useCircles, groupMembersByCircle, listAllCircleMembers } from '../lib/circles';
import { unwrapOrThrow } from '../lib/medhaId';
import { enterFullscreenLayer } from '../lib/fullscreenLayer';
import { useKeyboardClaim } from '../lib/barSuppression';
import { avatarInitial, avatarTone, hFont, hShadow, hc } from '../lib/homeSurface';
import type { NetworkIdentity } from '../lib/network';
import {
  alphaSections,
  circleLabels,
  filterPeople,
  messageStamp,
  recentThreads,
  threadPreview,
} from '../lib/messagesPanel';

/**
 * MESSAGES, AND EVERYONE YOU COULD MESSAGE, BEHIND THE BUTTON IN THE CORNER.
 *
 * Built to the rendering, element for element: a white sheet over about two
 * thirds of the screen with the page dimmed behind it, "Messages" in the serif
 * with an X beside it, a gray search field, DIRECT MESSAGES with a round + and
 * five conversations, "See N more", then ALL CONTACTS under gray letter bands.
 *
 * WHAT CHANGED FROM THE FIRST BUILD, and why it is worth writing down: that one
 * was full-screen, on the amber ground, with gold kickers and cream cards --
 * the old surface wearing the new structure, which is exactly what came back as
 * "it looks nothing like the UIs I sent you." The structure was right and every
 * pixel of the finish was wrong. It is on lib/homeSurface now, which holds the
 * rendering's palette and nothing else.
 *
 * ── NOTHING HERE IS NEW PLUMBING ────────────────────────────────────────────
 *
 * "Everything needs to pipe into storage properly... don't just make this code
 *  in a silo."
 *
 * Every wire already existed and is already used by something else:
 *
 *   the conversations   useDmThreads()            -- lib/dms, the same hook and
 *                                                    the same GET /v1/me/dms
 *   the address book    useContacts()             -- the same deduped identities
 *                                                    the contacts list draws
 *   the circle captions ['circles','members']     -- the SAME react-query key
 *                                                    ProfilePage uses, so the
 *                                                    two share one fetch
 *   the circle names    useCircles()              -- lib/circles' module cache
 *   opening a chat      DmThreadView              -- the same conversation view
 *   starting one        NewDmModal                -- the same picker, which is
 *                                                    the only thing that knows
 *                                                    who has an account
 *   adding someone      /(gated)/connect/search   -- the same route the People
 *                                                    header's + used
 *
 * What this file owns is arrangement. The four decisions inside that arrangement
 * -- which five, what the stamp says, which letter, which circle -- live in
 * lib/messagesPanel.ts where they are tested.
 *
 * ── WHY A LAYER AND NOT A ROUTE ─────────────────────────────────────────────
 *
 * Home is a page of a horizontal pager. Pushing a route from inside one and
 * coming back loses the pager's position. It claims the screen through
 * lib/fullscreenLayer so home.tsx fades the search bar and the tab pill out from
 * under it.
 */

// DECLARED ABOVE EVERYTHING THAT READS IT, and that is not a stylistic
// preference. Several components below reach `panel` from a render-path
// callback, and a `const` read before its declaration throws "Cannot access
// panel before initialization" at render time -- which the route error boundary
// catches and draws as "This screen hit a snag". TypeScript cannot see it;
// scripts/tdz-check.mts can, and did, twice in this file.
/** The hairline between two contacts. Inset past the avatar, as the rendering has it. */
function ItemDivider() {
  return <View style={panel.itemDivider} />;
}

const panel = StyleSheet.create({
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingBottom: 14,
  },
  title: {
    fontFamily: hFont.serif,
    fontSize: 29,
    lineHeight: 34,
    letterSpacing: -0.3,
    color: hc.ink,
  },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    height: 40,
    paddingHorizontal: 13,
    borderRadius: 20,
    backgroundColor: hc.fieldBg,
  },
  fieldInput: {
    flex: 1,
    padding: 0,
    fontFamily: hFont.regular,
    fontSize: 14.5,
    color: hc.ink,
  },

  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingBottom: 10,
  },
  sectionLabel: {
    fontFamily: hFont.semibold,
    fontSize: 11,
    letterSpacing: 1.1,
    color: hc.inkMuted,
  },
  plus: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: hc.fieldBg,
  },

  dmRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 18,
    paddingVertical: 9,
  },
  contactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 18,
    paddingVertical: 9,
  },
  rowName: {
    fontFamily: hFont.semibold,
    fontSize: 15.5,
    lineHeight: 20,
    color: hc.ink,
  },
  rowSub: {
    fontFamily: hFont.regular,
    fontSize: 13,
    lineHeight: 17,
    color: hc.inkMuted,
  },
  stamp: {
    fontFamily: hFont.regular,
    fontSize: 12,
    color: hc.inkMuted,
  },
  preview: {
    fontFamily: hFont.regular,
    fontSize: 13.5,
    lineHeight: 18,
    color: hc.inkMuted,
  },
  previewUnread: {
    fontFamily: hFont.medium,
    fontSize: 13.5,
    lineHeight: 18,
    color: hc.inkBody,
  },
  badge: {
    position: 'absolute',
    top: -1,
    right: -2,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: hc.tan,
    borderWidth: 1.5,
    borderColor: hc.bg,
  },
  badgeText: {
    fontFamily: hFont.bold,
    fontSize: 10,
    lineHeight: 13,
    color: '#FFFFFF',
  },

  seeMore: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 18,
    paddingTop: 8,
    paddingBottom: 14,
  },
  seeMoreText: {
    fontFamily: hFont.semibold,
    fontSize: 14,
    color: hc.amber,
  },
  divider: { height: 1, backgroundColor: hc.rule },
  itemDivider: { height: 1, marginLeft: 70, backgroundColor: hc.rule },
  letterBand: {
    backgroundColor: hc.bandBg,
    paddingHorizontal: 18,
    paddingVertical: 5,
  },
  letter: {
    fontFamily: hFont.medium,
    fontSize: 12,
    color: hc.inkMuted,
  },

  notice: {
    marginHorizontal: 18,
    marginBottom: 10,
    padding: 14,
    borderRadius: 14,
    backgroundColor: hc.fieldBg,
  },
  noticeTitle: {
    fontFamily: hFont.semibold,
    fontSize: 14.5,
    color: hc.ink,
  },
  noticeBody: {
    marginTop: 3,
    fontFamily: hFont.regular,
    fontSize: 13,
    lineHeight: 18,
    color: hc.inkMuted,
  },
  footerRow: {
    alignItems: 'center',
    paddingTop: 24,
    paddingBottom: 10,
  },
});

const OPEN_MS = 240;
const CLOSE_MS = 180;
const PANEL_EASING = Easing.bezier(0.32, 0, 0.16, 1);
/** How much of the screen the sheet takes. Measured off the rendering: 0.673. */
const PANEL_FRACTION = 0.67;
const DM_AVATAR = 44;
const CONTACT_AVATAR = 40;

function Avatar({
  name,
  size,
  badge,
}: {
  name: string;
  size: number;
  /** Unread count, drawn as a tan disc on the shoulder. 0 draws nothing. */
  badge?: number;
}) {
  const tone = avatarTone(name);
  return (
    <View style={{ width: size, height: size }}>
      <View
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: tone.bg,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text
          allowFontScaling={false}
          style={{
            fontFamily: hFont.semibold,
            fontSize: Math.round(size * 0.4),
            color: tone.ink,
          }}
        >
          {avatarInitial(name)}
        </Text>
      </View>
      {badge && badge > 0 ? (
        // ON THE AVATAR, NOT IN THE ROW. The rendering puts it on the shoulder of
        // the disc, which keeps the name and the timestamp on one clean baseline
        // -- a badge in the row would push the timestamp left on unread rows only,
        // so the column of times would not be a column.
        <View style={panel.badge}>
          <Text allowFontScaling={false} style={panel.badgeText}>
            {badge > 9 ? '9+' : String(badge)}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const ThreadRow = memo(function ThreadRow({
  thread,
  onOpen,
}: {
  thread: DmThread;
  onOpen: (thread: DmThread) => void;
}) {
  const name = thread.other?.name || thread.other?.username || 'Amber user';
  const unread = thread.unread > 0;
  return (
    <Pressable
      onPress={() => onOpen(thread)}
      accessibilityRole="button"
      accessibilityLabel={`Open chat with ${name}${unread ? `, ${thread.unread} unread` : ''}`}
      style={({ pressed }) => ({ backgroundColor: pressed ? hc.bandBg : 'transparent' })}
    >
      <View style={panel.dmRow}>
        <Avatar name={name} size={DM_AVATAR} badge={thread.unread} />
        <View style={{ flex: 1, gap: 3 }}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
            <Text numberOfLines={1} style={[panel.rowName, { flex: 1 }]}>
              {name}
            </Text>
            <Text allowFontScaling={false} style={panel.stamp}>
              {messageStamp(thread.last?.createdAt)}
            </Text>
          </View>
          <Text numberOfLines={1} style={unread ? panel.previewUnread : panel.preview}>
            {threadPreview(thread)}
          </Text>
        </View>
      </View>
    </Pressable>
  );
});

const ContactRow = memo(function ContactRow({
  person,
  circle,
  onOpen,
}: {
  person: NetworkIdentity;
  /** The circle they are in, as the caption. Absent when they are in none. */
  circle?: string;
  onOpen: (contactId: string) => void;
}) {
  const name = person.name || person.username || 'Contact';
  return (
    <Pressable
      onPress={() => onOpen(person.id)}
      accessibilityRole="button"
      accessibilityLabel={`Open ${name}`}
      style={({ pressed }) => ({ backgroundColor: pressed ? hc.bandBg : 'transparent' })}
    >
      <View style={panel.contactRow}>
        <Avatar name={name} size={CONTACT_AVATAR} />
        <View style={{ flex: 1, gap: 1 }}>
          <Text numberOfLines={1} style={panel.rowName}>
            {name}
          </Text>
          {/* THE CAPTION IS THE CIRCLE, and it is left out rather than faked when
              there isn't one. "No circle" under two thirds of a thousand-row
              address book is noise on every screenful. */}
          {circle ? (
            <Text numberOfLines={1} style={panel.rowSub}>
              {circle}
            </Text>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
});

function MessagesPanelBase({
  visible,
  dms,
  onClose,
  onOpenPerson,
  openThreadId,
  onThreadConsumed,
}: {
  visible: boolean;
  /**
   * THE CONVERSATIONS, PASSED IN RATHER THAN FETCHED HERE.
   *
   * The button that opens the panel wears an unread dot, so the thread list is
   * needed whether or not the panel has ever been opened. Calling useDmThreads()
   * in both places would mean two twenty-second polls of one endpoint and two
   * answers that can disagree for up to twenty seconds -- which is how a badge
   * ends up saying 3 over an inbox showing nothing new.
   */
  dms: ReturnType<typeof useDmThreads>;
  onClose: () => void;
  onOpenPerson: (contactId: string) => void;
  /** A thread to open on arrival, from a tapped message notification. */
  openThreadId?: string | null;
  onThreadConsumed?: () => void;
}) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { width } = useWindowDimensions();

  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [newDmOpen, setNewDmOpen] = useState(false);
  const [openDm, setOpenDm] = useState<{ threadId: string; name: string } | null>(null);

  // The search field claims the keyboard so the app's own bar does not come up
  // with it. See lib/barSuppression for why that is a count and not a boolean.
  const keyboard = useKeyboardClaim();

  const contacts = useContacts();

  // Broken out because both hooks return a fresh object every render, so a memo
  // naming `dms` or `contacts` is a memo that never holds.
  const dmsError = dms.error;
  const dmsLoading = dms.loading;
  const dmsCount = dms.threads.length;
  const dmsReload = dms.reload;
  const contactsStatus = contacts.status;
  const contactsError = contacts.errorMsg;
  const contactsReload = contacts.reload;

  const circles = useCircles();

  // THE SAME QUERY KEY PROFILE USES. react-query dedupes by key, so opening this
  // on a profile that has already loaded costs nothing, and a membership edit
  // invalidating ['circles','members'] fixes the captions here too.
  const membersQuery = useQuery({
    queryKey: ['circles', 'members'],
    queryFn: async () => unwrapOrThrow(await listAllCircleMembers()).members,
    enabled: visible,
    staleTime: 60_000,
  });

  const labels = useMemo(() => {
    const names = new Map<string, string>();
    for (const c of circles.items) names.set(c.id, c.name);
    return circleLabels(groupMembersByCircle(membersQuery.data), names);
  }, [circles.items, membersQuery.data]);

  const { shown: threadsShown, hiddenCount } = useMemo(
    () => recentThreads(dms.threads, expanded),
    [dms.threads, expanded],
  );

  const sections = useMemo(
    () => alphaSections(filterPeople(contacts.items, query)),
    [contacts.items, query],
  );
  const hasSections = sections.length > 0;

  // A TAPPED MESSAGE NOTIFICATION. The push carries the thread id but not the
  // name, and a conversation headed "Someone" is worse than a beat of waiting --
  // so this holds until the thread list has the row, and drops the id if the
  // list has loaded without it (cleared, or an old notification).
  useEffect(() => {
    if (!visible || !openThreadId) return;
    const hit = dms.threads.find((t) => t.threadId === openThreadId);
    if (hit) {
      setOpenDm({ threadId: hit.threadId, name: hit.other?.name || 'Message' });
      onThreadConsumed?.();
      return;
    }
    if (!dms.loading) onThreadConsumed?.();
  }, [visible, openThreadId, dms.threads, dms.loading, onThreadConsumed]);

  // THE PANEL IS THE SCREEN WHILE IT IS OPEN, so the app's bar and the tab pill
  // step aside. Released on close AND on unmount -- a claim that outlives its
  // owner leaves the chrome hidden with nothing on top of it, which looks like
  // the app has lost its navigation.
  useEffect(() => {
    if (!visible) return;
    return enterFullscreenLayer();
  }, [visible]);

  const [mounted, setMounted] = useState(visible);
  const progress = useSharedValue(visible ? 1 : 0);
  useEffect(() => {
    if (visible) setMounted(true);
    progress.value = withTiming(visible ? 1 : 0, {
      duration: visible ? OPEN_MS : CLOSE_MS,
      easing: PANEL_EASING,
    });
  }, [visible, progress]);
  // THE UNMOUNT IS A JS TIMER, NOT THE ANIMATION'S COMPLETION CALLBACK. A runOnJS
  // out of a withTiming callback races a second open: the close fires, the user
  // taps again before it lands, and the stale callback unmounts the panel that is
  // now on screen. A timer that the next run of this effect clears cannot.
  useEffect(() => {
    if (visible) return;
    const t = setTimeout(() => setMounted(false), CLOSE_MS + 40);
    return () => clearTimeout(t);
  }, [visible]);

  const panelWidth = Math.round(width * PANEL_FRACTION);
  const sheet = useAnimatedStyle(() => ({
    transform: [{ translateX: (progress.value - 1) * panelWidth }],
  }));
  const scrim = useAnimatedStyle(() => ({ opacity: progress.value }));

  const openThread = useCallback((t: DmThread) => {
    setOpenDm({ threadId: t.threadId, name: t.other?.name || t.other?.username || 'Amber user' });
  }, []);

  const closeThread = useCallback(() => {
    setOpenDm(null);
    // The unread badge and the preview line are both stale the moment you read
    // or send anything, so the list refetches on the way out.
    void dmsReload();
  }, [dmsReload]);

  const openPerson = useCallback(
    (contactId: string) => {
      onClose();
      // After the panel is out of the way, not under it: a push that lands while
      // a full-screen layer is still on top puts the card behind the panel.
      setTimeout(() => onOpenPerson(contactId), CLOSE_MS);
    },
    [onClose, onOpenPerson],
  );

  // THE FULLER CONTACTS SCREEN, AT THE FOOT OF THE LIST. The favorites grid, the
  // address-book sync and the duplicate merge did not fit in a sheet and were not
  // asked to go away -- see app/(gated)/contacts.tsx. The way in is one quiet row
  // after the last letter, which is where somebody who has scrolled the whole
  // address book already is.
  const manageContacts = useCallback(() => {
    onClose();
    setTimeout(() => router.push('/(gated)/contacts'), CLOSE_MS);
  }, [onClose, router]);

  const renderContact = useCallback(
    ({ item }: ListRenderItemInfo<NetworkIdentity>) => (
      <ContactRow person={item} circle={labels.get(item.id)} onOpen={openPerson} />
    ),
    [labels, openPerson],
  );

  const header = useMemo(
    () => (
      <View>
        <View style={panel.sectionRow}>
          <Text allowFontScaling={false} style={panel.sectionLabel}>
            DIRECT MESSAGES
          </Text>
          <Pressable
            onPress={() => setNewDmOpen(true)}
            accessibilityRole="button"
            accessibilityLabel="Start a direct message"
            hitSlop={12}
            style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
          >
            <View style={panel.plus}>
              <Plus size={15} color={hc.ink} strokeWidth={2.2} />
            </View>
          </Pressable>
        </View>

        {dmsError && dmsCount === 0 ? (
          // A FAILED LOAD IS NOT AN EMPTY INBOX. "No conversations yet" over a
          // 500 makes a real thread look deleted.
          <Pressable
            onPress={() => void dmsReload()}
            accessibilityRole="button"
            accessibilityLabel="Retry loading messages"
            style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
          >
            <View style={panel.notice}>
              <Text style={panel.noticeTitle}>Couldn&apos;t load your messages</Text>
              <Text style={panel.noticeBody}>
                Your conversations are safe — this is a loading problem. Tap to try again.
              </Text>
            </View>
          </Pressable>
        ) : dmsLoading && dmsCount === 0 ? (
          <View style={{ paddingVertical: 20, alignItems: 'center' }}>
            <ActivityIndicator size="small" color={hc.inkFaint} />
          </View>
        ) : threadsShown.length === 0 ? (
          <View style={{ paddingHorizontal: 18, paddingBottom: 10 }}>
            <Text style={panel.rowSub}>No conversations yet. The + starts one.</Text>
          </View>
        ) : (
          threadsShown.map((t) => <ThreadRow key={t.threadId} thread={t} onOpen={openThread} />)
        )}

        {hiddenCount > 0 ? (
          <Pressable
            onPress={() => setExpanded(true)}
            accessibilityRole="button"
            accessibilityLabel={`See ${hiddenCount} more conversations`}
            hitSlop={8}
            style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
          >
            <View style={panel.seeMore}>
              <ChevronDown size={16} color={hc.amber} strokeWidth={2.4} />
              <Text allowFontScaling={false} style={panel.seeMoreText}>
                {`See ${hiddenCount} more`}
              </Text>
            </View>
          </Pressable>
        ) : (
          <View style={{ height: 10 }} />
        )}

        <View style={panel.divider} />

        <View style={[panel.sectionRow, { paddingTop: 14 }]}>
          <Text allowFontScaling={false} style={panel.sectionLabel}>
            ALL CONTACTS
          </Text>
          {/*
            NO + HERE, AND THAT IS THE ONE PLACE THE PICTURE AND THE WORDS
            DISAGREE.

            "There should be a plus button next to All Contacts that you can use
             to add a user on Amber" -- and the rendering of this panel has
            nothing to the right of ALL CONTACTS. The picture is the later and
            more emphatic instruction ("look exactly like this, no differences"),
            so the picture wins here and the capability is not lost: the row at
            the foot of this list opens the full contacts screen, whose header
            carries the add-person button and the same
            /(gated)/connect/search route this used to push. One word and it
            comes back up here.
          */}
        </View>

        {contactsStatus === 'error' ? (
          <Pressable
            onPress={() => void contactsReload()}
            accessibilityRole="button"
            accessibilityLabel="Retry loading contacts"
            style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
          >
            <View style={panel.notice}>
              <Text style={panel.noticeTitle}>Couldn&apos;t load your contacts</Text>
              <Text style={panel.noticeBody}>{contactsError ?? 'Tap to try again.'}</Text>
            </View>
          </Pressable>
        ) : contactsStatus === 'loading' ? (
          <View style={{ paddingVertical: 20, alignItems: 'center' }}>
            <ActivityIndicator size="small" color={hc.inkFaint} />
          </View>
        ) : !hasSections ? (
          <View style={{ paddingHorizontal: 18, paddingVertical: 8 }}>
            <Text style={panel.rowSub}>
              {query.trim() ? 'Nobody here by that name.' : 'No contacts yet.'}
            </Text>
          </View>
        ) : null}
      </View>
    ),
    [
      dmsError,
      dmsLoading,
      dmsCount,
      dmsReload,
      threadsShown,
      hiddenCount,
      contactsStatus,
      contactsError,
      contactsReload,
      hasSections,
      query,
      openThread,
    ],
  );

  if (!mounted) return null;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {/* THE PAGE BEHIND, DIMMED AND TAPPABLE. The rendering shows Home still
          there and washed out to the right of the sheet, which is what says the
          sheet is temporary. Tapping it closes, because a visible page you
          cannot reach is the most reliable way to make a panel feel stuck. */}
      <Animated.View style={[StyleSheet.absoluteFill, scrim]}>
        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close messages"
          style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(250,249,248,0.72)' }]}
        />
      </Animated.View>

      <Animated.View
        style={[
          {
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            width: panelWidth,
            backgroundColor: hc.bg,
          },
          hShadow.panel,
          sheet,
        ]}
      >
        <View style={[panel.titleRow, { paddingTop: insets.top + 10 }]}>
          <Text allowFontScaling={false} style={panel.title}>
            Messages
          </Text>
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close messages"
            hitSlop={14}
            style={({ pressed }) => ({ opacity: pressed ? 0.55 : 1 })}
          >
            <X size={22} color={hc.ink} strokeWidth={1.9} />
          </Pressable>
        </View>

        <View style={{ paddingHorizontal: 18, paddingBottom: 16 }}>
          <View style={panel.field}>
            <Search size={16} color={hc.inkMuted} strokeWidth={2} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              onFocus={keyboard.onFocus}
              onBlur={keyboard.onBlur}
              placeholder="Search contacts..."
              placeholderTextColor={hc.inkMuted}
              autoCorrect={false}
              autoCapitalize="none"
              returnKeyType="search"
              accessibilityLabel="Search your contacts"
              style={panel.fieldInput}
            />
            {query ? (
              <Pressable
                onPress={() => setQuery('')}
                accessibilityRole="button"
                accessibilityLabel="Clear search"
                hitSlop={10}
                style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
              >
                <X size={15} color={hc.inkMuted} strokeWidth={2.2} />
              </Pressable>
            ) : null}
          </View>
        </View>

        {/* ONE LIST, NOT TWO STACKED SCROLL VIEWS. The conversations ride in the
            header so the whole sheet scrolls as one surface -- a short scroller
            of five threads above a long scroller of a thousand contacts is two
            competing gestures in one column, and on iOS the outer one wins,
            which makes the contact list unscrollable until you have already
            reached its end. */}
        <SectionList
          sections={sections}
          keyExtractor={(item) => item.id}
          renderItem={renderContact}
          ListHeaderComponent={header}
          ItemSeparatorComponent={ItemDivider}
          renderSectionHeader={({ section }) => (
            <View style={panel.letterBand}>
              <Text allowFontScaling={false} style={panel.letter}>
                {section.letter}
              </Text>
            </View>
          )}
          ListFooterComponent={
            contactsStatus === 'done' ? (
              <Pressable
                onPress={manageContacts}
                accessibilityRole="button"
                accessibilityLabel="Manage contacts, favorites and sync"
                style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
              >
                <View style={panel.footerRow}>
                  <Text allowFontScaling={false} style={panel.seeMoreText}>
                    Favorites, sync &amp; duplicates
                  </Text>
                </View>
              </Pressable>
            ) : null
          }
          stickySectionHeadersEnabled={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}
          initialNumToRender={14}
          windowSize={9}
          removeClippedSubviews
        />
      </Animated.View>

      <NewDmModal
        visible={newDmOpen}
        onClose={() => setNewDmOpen(false)}
        onOpenThread={(threadId, name) => setOpenDm({ threadId, name })}
      />

      {openDm ? (
        <View style={StyleSheet.absoluteFill}>
          <DmThreadView
            threadId={openDm.threadId}
            name={openDm.name}
            other={dms.threads.find((t) => t.threadId === openDm.threadId)?.other ?? null}
            blocked={dms.threads.find((t) => t.threadId === openDm.threadId)?.blocked ?? false}
            onOpenPerson={(id) => {
              setOpenDm(null);
              setTimeout(() => openPerson(id), 180);
            }}
            onBack={closeThread}
            onDeleted={() => void dmsReload()}
          />
        </View>
      ) : null}
    </View>
  );
}

export const MessagesPanel = memo(MessagesPanelBase);
