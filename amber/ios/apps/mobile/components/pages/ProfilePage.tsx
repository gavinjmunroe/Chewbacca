import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, InteractionManager, KeyboardAvoidingView, Modal, Platform, ScrollView, Share, StyleSheet, TextInput as RNTextInput, View } from 'react-native';
import { Pressable } from '../Pressable';
import { config } from '../../lib/config';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import * as Clipboard from 'expo-clipboard';
import Svg, { Defs, Ellipse, RadialGradient, Stop } from 'react-native-svg';
import { Check, KeyRound, Settings, X } from 'lucide-react-native';
import { Screen } from '../Screen';
import { Text } from '../Text';
import { FadeInUp } from '../../lib/motion';
import { ConnectionsWebCard } from '../ConnectionsWeb';
import { SelfDimensionsCard } from '../SelfDimensionsCard';
import { ConnectionsSheet } from '../ConnectionsSheet';
import { ProfileMark } from '../marks';
import { PinnedCirclesGrid } from '../PinnedCirclesGrid';
import { ContactEmblem } from '../ContactEmblem';
import { NAMED_COLORS } from '../../lib/circleColors';
import { VoiceBioCard } from '../VoiceBioCard';
import {
  listPinnedCircles,
  pinCircle,
  unpinCircle,
  reorderPinnedCircles,
  MAX_PINNED_CIRCLES,
  type PinnedCircle,
} from '../../lib/circleFavorites';
import { api, unwrapSingle, type Me } from '../../lib/api';
import {
  callMedhaId,
  errorCopy,
  MedhaIdRequestError,
  unwrapOrThrow,
} from '../../lib/medhaId';
import {
  groupMembersByCircle,
  listAllCircleMembers,
  useCircles,
  type CirclePreview,
} from '../../lib/circles';
import { listConnections, usernameAvailable } from '../../lib/connect';
import { listRecentlyMentioned } from '../../lib/contacts';
import { timeAgo } from '../../lib/togari';
import {
} from '../../lib/wall';
import { useContactsSummaryCache } from '../../lib/contactsSummary';
import { toast } from '../../lib/toast';
import { buildWeb } from '../../lib/connectionsWeb';
import {
  clearClayDestination,
  getClayDestination,
  pushContactsToClay,
  setClayDestination,
  type ClayPushResult,
} from '../../lib/clay';
import { fonts, radius, spacing, typography } from '../../lib/tokens';
import { LIGHT, TREND_UP } from '../../lib/theme';
import { HAIRLINE, cl, clLayout, clRadius } from '../../lib/classical';
import { peopleBarClearance } from '../../lib/peopleBar';
import { CIconSquare, CText } from '../classical';
/**
 * THE SECOND HALF OF THIS PAGE IS NOW components/pages/SettingsPage.tsx.
 *
 *   "The profile page ends after the 'What Amber Knows' section. Move the rest
 *    to the settings."
 *
 * Gone from here, intact over there: the Network section (Apple Contacts sync),
 * the Connections section (OAuth), both notification sections, the account list
 * (iOS notifications, possible duplicates, which-person-is-this, contact
 * support, delete account), sign out, and the build stamp -- along with every
 * query, mutation and handler behind them, and the two sheets they opened.
 *
 * The primitives both screens draw with were at the bottom of this file and are
 * now in components/profileParts.tsx, imported rather than copied, so the
 * profile and settings cannot drift into looking like two different apps.
 */
import {
  Block,
  DCard,
  RetryRow,
  Section,
  SecondaryButton,
} from '../profileParts';

// One frozen empty array, so "no circles yet" is the same identity every time.
const EMPTY_CIRCLES: CirclePreview[] = [];

function ProfilePageBase({
  isActive,
}: {
  isActive: boolean;
}) {
  const router = useRouter();
  const qc = useQueryClient();
  // For the foot of the scroll: how much room the floating search dock needs.
  // See peopleBarClearance -- it depends on this device's home-indicator inset,
  // so it cannot be a constant.
  const insets = useSafeAreaInsets();
  // The connections list, opened from the hero's Connections count.
  const [connectionsOpen, setConnectionsOpen] = useState(false);
  /**
   * HOW MANY CONTACTS, for the hero's stat and nothing else.
   *
   * The address-book SYNC -- its progress, its stopped state, the limited-access
   * copy, the Refresh button -- moved to components/pages/SettingsPage.tsx with
   * the rest of the Network section. What is left here is the count, read from
   * the on-device summary cache rather than a fresh request: this stat renders on
   * the first frame of a cold launch, and a count that starts at 0 and snaps to
   * 900 a beat later is worse than no count.
   */
  const contactsSummaryCache = useContactsSummaryCache();
  const syncedTotal = contactsSummaryCache?.total ?? 0;
  const [editing, setEditing] = useState(false);

  const circles = useCircles();
  // ONE STABLE ARRAY. `circles.status === 'loading' ? [] : circles.items` built a
  // fresh [] on every render while loading, which changed the identity of the
  // prop the web memoizes its ENTIRE layout on -- so the SVG tree was rebuilt on
  // every parent render, including the ones that fire while a pinned tile is
  // mid-drag directly above it.
  const circleItems = useMemo(
    () => (circles.status === 'loading' ? EMPTY_CIRCLES : circles.items),
    [circles.status, circles.items],
  );

  const meQuery = useQuery({
    queryKey: ['me'],
    queryFn: async () => unwrapSingle<Me>(await api.me()),
  });
  // Amber-network connections (lib/connect.ts) — distinct from the OAuth
  // `connectionsQuery` above (Google/Slack/etc.) and from synced phone
  // contacts. Powers the hero's "Connections" stat and the "Your connections"
  // section, which previews the same list /(gated)/connect renders in full.
  const myConnectionsQuery = useQuery({
    queryKey: ['connect', 'list'],
    queryFn: async () => unwrapOrThrow(await listConnections()).connections,
  });

  // ── Pinned circles ─────────────────────────────────────────────────────
  //
  // The nine on the profile, in the order the user dragged them. Server-side
  // (circle_favorites), so the arrangement follows them to a new phone -- which
  // is the only reason an arrangement is worth making.
  // Has this page ever been looked at? See the note on pinnedQuery: this gates
  // the work only worth doing for someone who actually opens their profile, and
  // it is set after the interactions rather than on the isActive edge so none of
  // that work lands during the slide.
  const [everActive, setEverActive] = useState(false);

  // BELOW `everActive`, NOT ABOVE IT. The first version of this block sat with
  // the other queries thirty lines up and read `everActive` before the useState
  // that declares it -- a render-time temporal dead zone, which is a crash on
  // first paint rather than a subtle bug. scripts/tdz-check.mts is what catches
  // this class; it is worth knowing that the trigger is putting a query beside
  // its siblings instead of beside the flag that gates it.
  /**
   * EVERY PERSON IN EVERY CIRCLE, for the ring and for the pill counts.
   *
   * "Every single person represented in every single circle should be shown on
   *  the web. Obviously, no duplicates if people are in multiple circles."
   *
   * ONE REQUEST, NOT ONE PER CIRCLE. The circle previews already on this screen
   * carry the first thirty members each, which is right for the pinned grid and
   * wrong for the ring: a circle of forty would be drawn thirty deep while its
   * pill said forty. This is the whole membership in a single query.
   *
   * NOT FETCHED UNTIL THE PAGE HAS BEEN LOOKED AT, for the same reason the
   * pinned query is not -- ProfilePage is mounted at cold launch as one of the
   * three pages in the pager, so an unconditional query here is a request every
   * user pays for on every launch whether or not they swipe to this tab.
   */
  const membersQuery = useQuery({
    queryKey: ['circles', 'members'],
    queryFn: async () => unwrapOrThrow(await listAllCircleMembers()).members,
    enabled: everActive,
    staleTime: 60_000,
  });
  const circleMembers = useMemo(
    () => groupMembersByCircle(membersQuery.data),
    [membersQuery.data],
  );

  /**
   * WHO THE WEB DRAWS. Your Amber connections, and everybody in your circles --
   * solid if they are on Amber, dotted if they are not. All the arithmetic is
   * in lib/connectionsWeb.ts and tested there; this is the wiring.
   */
  const webPeople = useMemo(
    () =>
      buildWeb({
        connections: myConnectionsQuery.data ?? [],
        circles: circleItems,
        members: circleMembers,
      }),
    [myConnectionsQuery.data, circleItems, circleMembers],
  );


  // NOT FETCHED UNTIL THIS PAGE HAS ACTUALLY BEEN LOOKED AT, and not until the
  // slide that brought you here is over. Two separate reasons:
  //
  //   * ProfilePage is MOUNTED at cold launch -- it is one of the three pages in
  //     the pager -- so an unconditional query here is a request every user pays
  //     for on every launch whether or not they ever swipe to this tab.
  //   * `isActive` flips from the SYNCHRONOUS setCurrentPage in home.tsx's
  //     goToPage, i.e. in the same tick the slide starts. Enabling a fetch on
  //     that edge lands its response, and the re-render it causes, inside the
  //     250ms the pager is animating on the main thread -- the exact hitch the
  //     meQuery/connectionsQuery refetches below were already moved out of.
  //
  // So the latch is set from inside that same InteractionManager callback, and
  // it is "has this page EVER been active" rather than `isActive`, so the data
  // stays put when you swipe away instead of being torn down and refetched every
  // time you come back.
  const pinnedQuery = useQuery({
    queryKey: ['circleFavorites'],
    queryFn: async () => unwrapOrThrow(await listPinnedCircles()).circles,
    enabled: everActive,
  });

  /**
   * The pinned grid's order, which the web's filter pills follow.
   *
   * DECLARED AFTER pinnedQuery, not beside the other web memos. A useMemo body
   * runs during render, so reading pinnedQuery from above its own declaration is
   * a use-before-declaration that throws on the first paint -- the exact crash
   * scripts/tdz-check.mts exists for, and the one that made the app unopenable
   * on 2026-09-08.
   */
  const pinnedIds = useMemo(
    () => (pinnedQuery.data ?? []).map((c) => String(c.id)),
    [pinnedQuery.data],
  );
  const [pinPickerOpen, setPinPickerOpen] = useState(false);

  const commitPinOrder = useCallback(
    (ids: string[]) => {
      // The grid already moved. This just tells the server, and says so if it
      // could not -- an arrangement that silently failed to save is one the user
      // will make again tomorrow.
      void reorderPinnedCircles(ids).then((res) => {
        if (!res.ok) {
          toast.error('Could not save that order.');
          void pinnedQuery.refetch();
        }
      });
    },
    [pinnedQuery],
  );

  const confirmUnpin = useCallback(
    (circle: PinnedCircle) => {
      Alert.alert(circle.name, 'Unpin this circle from your profile?', [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Unpin',
          style: 'destructive',
          onPress: () => {
            // Optimistic: the tile goes now. The circle itself is untouched --
            // unpinning is about this grid, not about the circle, and the list
            // below still has it.
            qc.setQueryData<PinnedCircle[]>(['circleFavorites'], (prev) =>
              (prev ?? []).filter((c) => c.id !== circle.id),
            );
            void unpinCircle(circle.id).then((res) => {
              if (!res.ok) {
                toast.error('Could not unpin that.');
                void pinnedQuery.refetch();
              }
            });
          },
        },
      ]);
    },
    [qc, pinnedQuery],
  );

  const doPin = useCallback(
    async (circleId: string) => {
      const res = await pinCircle(circleId);
      if (!res.ok) {
        // The 409 is the cap, and it deserves its own sentence rather than
        // "something went wrong".
        toast.error(
          res.status === 409
            ? `You can pin ${MAX_PINNED_CIRCLES}. Unpin one first.`
            : 'Could not pin that circle.',
        );
        return;
      }
      await pinnedQuery.refetch();
      setPinPickerOpen(false);
    },
    [pinnedQuery],
  );

  // Refetch when the pager lands on this page (replaces useFocusEffect).
  //
  // DEFERRED UNTIL THE SLIDE IS OVER. `isActive` flips from the SYNCHRONOUS
  // setCurrentPage in home.tsx's goToPage — i.e. in the same tick as setPage() — so
  // firing two refetches here landed their responses, and the re-renders they trigger,
  // inside the 250ms window where the pager is animating on the main thread. That is a
  // hitch at exactly the moment the page is arriving. InteractionManager holds the work
  // until the UI thread is actually idle; nobody can read a profile in the 250ms it
  // costs to wait.
  const prevActive = useRef(false);
  useEffect(() => {
    if (isActive && !prevActive.current) {
      const handle = InteractionManager.runAfterInteractions(() => {
        setEverActive(true);
        meQuery.refetch();
      });
      prevActive.current = isActive;
      return () => handle.cancel();
    }
    prevActive.current = isActive;
    return undefined;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive]);

  const onShareProfile = () => {
    // A per-user "connect with me" link, built from this user's own username, so
    // it is never a hard-coded personal site. Any user sharing gets their own
    // name and their own link.
    const name = (meQuery.data?.displayName ?? '').trim();
    const firstName = name.split(/\s+/)[0] || name;
    const username = (meQuery.data?.username ?? '').trim();
    const base = config.amberConnectBaseUrl.replace(/\/+$/, '');
    // `/u/@name`, matching medha-id's GET /u/:username. The `/u/` prefix is not
    // decoration: it is the ONLY path the app is allowed to claim as a universal link
    // (see the association file in src/routes/connect-link.js), because claiming `/*`
    // on the API host would turn every API call made from a webview into an app launch.
    // WITHOUT A USERNAME THERE IS NO LINK. This used to fall back to `base`, so a
    // user who had not set a username shared "Connect with Sagar on Amber:
    // https://<api-host>" — a link to the bare API root, which does nothing for the
    // recipient and tells them the internal hostname. Better to say so than to send
    // something broken.
    if (!username) {
      toast.error('Set a username first', 'Your link is amber.app/u/@yourname — add one in Edit profile.');
      return;
    }
    const url = `${base}/u/@${username}`;
    const who = firstName || 'me';
    // ONE LINK, NOT TWO. Passing `message` AND `url` to iOS's share sheet sends
    // them as two separate items, so Messages showed the link inside the sentence
    // and then the same link again as its own attachment. The URL lives in the
    // message text, iOS linkifies it and still renders one rich preview.
    Share.share({
      message: `Connect with ${who} on Amber: ${url}`,
    }).catch(() => {});
  };

  // One owner for key creation; the hero button triggers it and the copy-once
  // modal renders at page level so it overlays whatever is scrolled into view.
  const apiKey = useApiKeyManager();

  return (
    <Screen padded={false} background="transparent" edges={[]}>
      {/*
        mockup-2's header is just the wordmark, centered and tracked -- AND A GEAR
        IN THE CORNER, which it did not used to need.

          "I also don't see the merge duplicates thing in the settings anymore,
           and I don't see calendar syncing in the settings. I'm not really sure
           where that stuff is at now."

        Half of this page moved to /(gated)/settings, and a page that loses half
        its rows owes the reader a door to where they went. There is a gear on
        Home's header too and it opens the same route; this one exists because
        this is the page the rows left from, and looking for them here is the
        first thing anybody will do.

        Positioned absolutely rather than laid out in a row, so the wordmark stays
        centered on the screen rather than on the space left over beside a button.
      */}
      <View style={{ paddingTop: spacing.sm, paddingBottom: spacing.md, alignItems: 'center' }}>
        <CText t="kicker" color={cl.ink45} style={{ letterSpacing: 2.16 }}>
          Amber
        </CText>
        <Pressable
          onPress={() => router.push('/(gated)/settings')}
          accessibilityRole="button"
          accessibilityLabel="Settings"
          hitSlop={14}
          style={({ pressed }) => ({
            position: 'absolute',
            right: clLayout.gutter,
            top: spacing.xs,
            opacity: pressed ? 0.55 : 1,
          })}
        >
          <Settings size={20} color={cl.ink45} strokeWidth={1.9} />
        </Pressable>
      </View>
      <ScrollView
        contentContainerStyle={{
          paddingTop: spacing.sm,
          /**
           * THE SEARCH DOCK, NOT THE TAB PILL. clLayout.tabBarClearance is 132
           * and is named for the pill; the dock floats above it and its top edge
           * is around 166 on a phone with a home indicator, so the last card sat
           * behind the bar with its final line unreadable. See peopleBarClearance
           * -- the number has to come from the device's own inset, so it cannot
           * be a bigger constant.
           */
          paddingBottom: peopleBarClearance(insets.bottom),
          gap: clLayout.sectionGap,
        }}
        // directionalLockEnabled: this list lives inside a horizontal pager. Without the
        // lock, iOS lets this scroll view claim a slightly-diagonal drag, so the swipe
        // between People / Today / You worked sometimes and did nothing other times
        // depending on the exact angle of the finger. The lock makes a mostly-horizontal
        // drag stay unclaimed here so the pager gets it, every time.
        directionalLockEnabled
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        // keyboardDismissMode: a downward drag puts the keyboard away, and on iOS
        // "interactive" means it tracks the finger rather than snapping -- so the
        // gesture is reversible mid-drag and the search bar (welded to the
        // keyboard's top edge, see useKeyboardBarLift) comes down with it under
        // the finger. Without this the search keyboard could not be dismissed by
        // any gesture on this screen at all.
        keyboardDismissMode="interactive"
      >
        {meQuery.isLoading ? (
          <DCard style={{ marginHorizontal: clLayout.gutter }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.base }}>
              <Block w={64} h={64} radius={radius.full} />
              <View style={{ flex: 1, gap: spacing.sm }}>
                <Block w="60%" h={20} />
                <Block w="40%" h={13} />
              </View>
            </View>
          </DCard>
        ) : meQuery.isError ? (
          <DCard style={{ marginHorizontal: clLayout.gutter }}>
            <RetryRow label="Couldn't load your profile." onRetry={() => meQuery.refetch()} />
          </DCard>
        ) : (
          <FadeInUp index={0} step={60}>
            <ProfileHero
              me={meQuery.data ?? null}
              connectionsCount={myConnectionsQuery.data?.length ?? 0}
              circlesCount={circles.status === 'loading' ? 0 : circles.items.length}
              // From the on-device summary cache, the same number the Network
              // row below reads. Not a fresh request: this stat renders on the
              // first frame of a cold launch, and a count that starts at 0 and
              // snaps to 900 a beat later is worse than no count.
              contactsCount={syncedTotal}
              onEdit={() => setEditing(true)}
              onShare={onShareProfile}
              onGenerateApiKey={apiKey.show}
              onOpenConnections={() => setConnectionsOpen(true)}
            />
          </FadeInUp>
        )}

        {/* THE VOICE BIO IS THE SECOND THING ON THE PAGE NOW.
            An About section stood between it and the hero: three chips
            (occupation, MBTI, school, hometown, horoscope) restating fields the
            edit sheet already owns, in the one position on the profile that
            should belong to the introduction. Removed on request, and the voice
            bio takes its place in the stagger rather than a gap being left --
            text on a profile is a bio; a clip is the person, and this app is
            built on people saying more than they type. */}
        <FadeInUp index={1} step={60} style={{ paddingHorizontal: clLayout.gutter }}>
          <VoiceBioCard active={everActive} />
        </FadeInUp>

        {/* CIRCLES LIVE HERE NOW, not in the People tab, and there are TWO views
            rather than three.
            The gradient card grid used to sit under the web, which meant the
            same circles were drawn twice, ten points apart, in two different
            visual languages -- and the second drawing was the weaker one. The web
            IS the view: tap it and you get the whole thing full-screen, tap a
            node and you are in that circle. Pinned, below, is the shortlist.
            Making a new one is the header action, which is where it belongs. */}
        <Section
          title="Circles"
          subtitle="Your people, grouped — and the shape of it."
          right="+ New"
          onPressRight={() => router.push('/(gated)/circle/new')}
          // "+ New" is the only route to making a circle and it was 10.5pt of
          // 42%-opacity gray. This is the same header, larger, with the action
          // in gold.
          prominent
        >
          {/* THE WEB DRAWS PEOPLE, NOT CIRCLES.
              Your connections on Amber, with the circles below it as filters.
              Opening a circle is the pinned grid's job, directly underneath, and
              it does it better than a node on a ring ever did. The overlay is
              rendered by home.tsx; see lib/webOverlay.ts for why. */}
          <ConnectionsWebCard
            people={webPeople}
            circles={circleItems}
            // The pill row follows the pinned grid directly below it. Those two
            // are the same circles in the same screen; disagreeing about their
            // order makes the row look like somebody else's list.
            pinnedIds={pinnedIds}
            monogram={((meQuery.data?.displayName ?? meQuery.data?.username ?? '?').trim().charAt(0) || '?').toUpperCase()}
          />
        </Section>

        <Section
          title="Pinned"
          subtitle="The circles you want at hand. Hold one to unpin, drag to arrange."
          // Matched to Circles above it: two adjacent sections at two different
          // header weights reads as a mistake rather than a hierarchy.
          prominent
        >
          <PinnedCirclesGrid
            circles={pinnedQuery.data ?? []}
            onOpenCircle={(id) => router.push(`/(gated)/circle/${id}`)}
            onAdd={() => setPinPickerOpen((v) => !v)}
            onUnpin={confirmUnpin}
            onReorder={commitPinOrder}
          />
          {/* PICKING ONE HAPPENS IN PLACE.
              This was a Modal: a dark scrim over the whole page with a sheet
              sliding up from the bottom, for a decision that takes one tap and
              changes something three inches above it. Dimming the page you are
              arranging, to arrange it, is the wrong gesture at the wrong weight.
              It is a row that opens under the grid now -- same surface, no
              backdrop, nothing to dismiss. */}
          {pinPickerOpen ? (
            <PinCircleRow
              circles={circleItems}
              pinnedIds={(pinnedQuery.data ?? []).map((c) => c.id)}
              onPick={(id) => void doPin(id)}
              onClose={() => setPinPickerOpen(false)}
            />
          ) : null}
        </Section>

        {/* Who you've been talking about. Sits above Memories because it answers
            "who is on my mind right now", which is the more useful question when
            you open this page. */}
        <Section
          title="Recently mentioned"
          subtitle="The people who've come up in your voice notes."
        >
          <RecentlyMentionedSection />
        </Section>

        {/* YOUR OWN READ, and it is deliberately a statement about Amber rather
            than about you. The radar plots how much Amber has learned of each of
            the six dimensions from what you have said and what you have asked
            about -- not an assessment of your life, which is not a thing
            note-taking can measure and not a thing this app has standing to hand
            somebody. See the note atop components/SelfDimensionsCard.tsx. */}
        <Section
          title="What Amber knows"
          subtitle="The six dimensions, as much as you have told it."
        >
          <SelfDimensionsCard />
        </Section>

      </ScrollView>

      {/* THE CONNECTIONS LIST, from the count in the hero. Its own component
          because it owns a search field, a safe-area-derived layout and a
          full-screen claim, none of which belong in this file. */}
      <ConnectionsSheet
        visible={connectionsOpen}
        connections={myConnectionsQuery.data ?? []}
        loading={myConnectionsQuery.isLoading}
        onClose={() => setConnectionsOpen(false)}
      />

      {/* The one and only API-key surface. Opened by the hero button; owns
          minting, the copy-once reveal, the endpoint, the example body, and
          revoke. */}
      <ApiKeyModal mgr={apiKey} />

      <EditProfileSheet
        visible={editing}
        me={meQuery.data ?? null}
        onClose={() => setEditing(false)}
        onSaved={(patch) => {
          setEditing(false);
          qc.setQueryData<Me>(['me'], (prev) => (prev ? { ...prev, ...patch } : prev));
          qc.invalidateQueries({ queryKey: ['me'] });
        }}
      />
    </Screen>
  );
}

// ── Shared dark primitives ─────────────────────────────────────

function CornerButton({
  children,
  accessibilityLabel,
  onPress,
}: {
  children: React.ReactNode;
  accessibilityLabel: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
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
        {children}
      </View>
    </Pressable>
  );
}

// ── API keys (import contacts from Clay / elsewhere) ─────────────────
// A personal API key lets an external tool (Clay, a script) POST contacts into
// Amber over the same JWT-authed medha-id backend the app uses. The raw secret
// is returned by the server exactly once, on create; after that only metadata
// (prefix, last4, name, dates) is ever visible. We NEVER persist the raw key —
// it lives in component state only, is shown in a copy-once modal, and is gone
// the moment the user dismisses it.
type ApiKey = {
  id: string;
  prefix: string;
  last4: string;
  name?: string | null;
  createdAt: string;
  lastUsedAt?: string | null;
};

type CreatedApiKey = {
  ok: boolean;
  id: string;
  key: string;
  prefix: string;
  last4: string;
  name?: string | null;
  createdAt: string;
};

// The endpoint an external tool (Clay) POSTs contacts to, shown for reference so
// the user can paste it alongside the key. Not called from the app.
const CONTACTS_INGEST_URL = 'https://amber-id-production.up.railway.app/v1/ingest/contacts';


// ── API keys ────────────────────────────────────────────────────────────────
//
// ONE button in the profile hero opens ONE sheet that does everything: mint a
// key, reveal it once, copy the endpoint and a ready-to-paste body, and revoke
// old keys. There is deliberately no second surface elsewhere on the page — a
// personal API key is a credential, and splitting its lifecycle across two
// screens is how people end up with keys they can neither find nor kill.
export function useApiKeyManager() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  // The raw secret, held ONLY in memory for the copy-once reveal. Never written
  // to storage, a query cache, or a log line.
  const [createdKey, setCreatedKey] = useState<CreatedApiKey | null>(null);
  const [copied, setCopied] = useState(false);

  const keysQuery = useQuery({
    queryKey: ['apiKeys'],
    enabled: open, // no request until the sheet is actually opened
    queryFn: async () =>
      unwrapOrThrow(
        await callMedhaId<{ keys: ApiKey[] }>({
          path: '/v1/me/api-keys',
          method: 'GET',
          requireAuth: true,
        }),
      ).keys ?? [],
  });

  const createKey = useMutation({
    mutationFn: async (name: string) =>
      unwrapOrThrow(
        await callMedhaId<CreatedApiKey>({
          path: '/v1/me/api-keys',
          method: 'POST',
          body: { name },
          requireAuth: true,
        }),
      ),
    onSuccess: (data) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setCopied(false);
      setCreatedKey(data);
      qc.invalidateQueries({ queryKey: ['apiKeys'] });
    },
    onError: (e) => toast.error('Could not create key', errorCopy(e)),
  });

  const revokeKey = useMutation({
    mutationFn: async (id: string) => {
      unwrapOrThrow(
        await callMedhaId<{ ok: boolean; revoked: boolean; id: string }>({
          path: `/v1/me/api-keys/${id}`,
          method: 'DELETE',
          requireAuth: true,
        }),
      );
      return id;
    },
    onSuccess: () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      toast.success('API key revoked.');
      qc.invalidateQueries({ queryKey: ['apiKeys'] });
    },
    onError: (e) => toast.error('Could not revoke key', errorCopy(e)),
  });

  const generate = () => {
    if (createKey.isPending) return;
    if (Platform.OS === 'ios' && typeof Alert.prompt === 'function') {
      Alert.prompt(
        'Name this key',
        'A label so you can tell your keys apart (e.g. Clay, Happenstance).',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Generate',
            onPress: (value?: string) => createKey.mutate((value ?? '').trim() || 'Clay'),
          },
        ],
        'plain-text',
        'Clay',
      );
    } else {
      createKey.mutate('Clay');
    }
  };

  const revoke = (key: ApiKey) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
    const label = key.name?.trim() || `amberk_…${key.last4}`;
    Alert.alert(
      'Revoke this key?',
      `Any tool using "${label}" will immediately lose access. This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Revoke', style: 'destructive', onPress: () => revokeKey.mutate(key.id) },
      ],
    );
  };

  const copySecret = async () => {
    if (!createdKey) return;
    try {
      await Clipboard.setStringAsync(createdKey.key);
      Haptics.selectionAsync().catch(() => {});
      setCopied(true);
      toast.success('Copied.', 'Paste it into Clay now — it will not be shown again.');
    } catch {
      toast.error('Could not copy', 'Long-press the key to select and copy it.');
    }
  };

  return {
    open,
    show: () => setOpen(true),
    hide: () => {
      setOpen(false);
      setCreatedKey(null);
    },
    keys: keysQuery.data ?? [],
    keysLoading: keysQuery.isLoading,
    keysError: keysQuery.isError,
    refetchKeys: () => keysQuery.refetch(),
    generate,
    generating: createKey.isPending,
    createdKey,
    copied,
    copySecret,
    revoke,
    revokingId: revokeKey.isPending ? (revokeKey.variables as string | undefined) : undefined,
  };
}

// A ready-to-paste request body. This is what actually unblocks a Clay or
// Happenstance HTTP step: the endpoint alone does not tell you the field names,
// and every field here maps onto the contact card the push creates.
const INGEST_EXAMPLE = [
  '{',
  '  "source": "clay",',
  '  "contacts": [',
  '    {',
  '      "name": "Ada Lovelace",',
  '      "email": "ada@example.com",',
  '      "phone": "+15555550123",',
  '      "company": "Analytical Engines",',
  '      "title": "Mathematician",',
  '      "linkedinUrl": "https://linkedin.com/in/ada",',
  '      "location": "London",',
  '      "notes": "Met at the Difference Engine demo"',
  '    }',
  '  ]',
  '}',
].join('\n');

function CopyRow({
  label,
  value,
  quiet = false,
}: {
  label: string;
  value: string;
  /** Muted value text. For the JSON example, which is reference not instruction. */
  quiet?: boolean;
}) {
  return (
    <View style={{ gap: 6 }}>
      <CText t="metaXs" color={cl.ink}>
        {label}
      </CText>
      <Pressable
        onPress={() => {
          void Clipboard.setStringAsync(value);
          Haptics.selectionAsync().catch(() => {});
          toast.success('Copied.');
        }}
        accessibilityRole="button"
        accessibilityLabel={`Copy ${label}`}
        style={{
          paddingHorizontal: 12,
          paddingVertical: 10,
          borderRadius: radius.md,
          backgroundColor: '#F4F2EF',
          borderWidth: HAIRLINE,
          borderColor: cl.ruleFaint,
        }}
      >
        <CText t="metaXs" color={quiet ? cl.ink55 : cl.ink} selectable>
          {value}
        </CText>
      </Pressable>
    </View>
  );
}

// ── Amber → Clay ───────────────────────────────────────────────────────────────
/**
 * The other direction.
 *
 * The API key above lets Clay push contacts INTO Amber. This pushes them back OUT,
 * into a Clay table, so the two systems are actually bidirectional rather than a
 * one-way import. It lives in the same sheet on purpose: from the user's point of
 * view there is one Clay integration, not two features that happen to share a vendor.
 *
 * The webhook URL is a CREDENTIAL — anyone holding it can write rows into that table —
 * so it is write-only from the client's perspective: the server stores it, validates
 * it against an allowlist (it is a URL the server then makes requests to, which is an
 * SSRF sink if left open), and only ever returns a masked form.
 */
function ClayPushSection() {
  const qc = useQueryClient();
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState(false);

  const destQuery = useQuery({
    queryKey: ['clayDestination'],
    queryFn: async () => unwrapOrThrow(await getClayDestination()),
  });
  const dest = destQuery.data;

  const save = useMutation({
    mutationFn: async (url: string) => unwrapOrThrow(await setClayDestination(url)),
    onSuccess: () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setDraft('');
      setEditing(false);
      toast.success('Clay destination saved.');
      qc.invalidateQueries({ queryKey: ['clayDestination'] });
    },
    // The server's rejection message names the actual problem ("that URL points at
    // example.com, not Clay"), which is far more useful than "could not save".
    onError: (e) => toast.error('Could not save that URL', errorCopy(e)),
  });

  const clear = useMutation({
    mutationFn: async () => unwrapOrThrow(await clearClayDestination()),
    onSuccess: () => {
      toast.success('Clay destination removed.');
      qc.invalidateQueries({ queryKey: ['clayDestination'] });
    },
    onError: (e) => toast.error('Could not remove it', errorCopy(e)),
  });

  const push = useMutation({
    mutationFn: async (dryRun: boolean) => unwrapOrThrow(await pushContactsToClay({ dryRun })),
    onSuccess: (data) => {
      if ('dryRun' in data && data.dryRun) {
        toast.info(`${data.wouldPush} contacts ready to send.`, 'Nothing was written to Clay.');
        return;
      }
      const r = data as ClayPushResult;
      if (r.ok) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        toast.success(`Sent ${r.pushed} contacts to Clay.`);
      } else {
        // A partial push is safe to retry: Clay dedupes on amber_contact_id, so the
        // rows that already landed are updated rather than duplicated.
        toast.error(
          `Sent ${r.pushed} of ${r.total} before Clay stopped accepting them.`,
          'Safe to run again — Clay dedupes on the Amber contact id.',
        );
      }
      qc.invalidateQueries({ queryKey: ['clayDestination'] });
    },
    onError: (e) => toast.error('Could not push to Clay', errorCopy(e)),
  });

  const busy = save.isPending || clear.isPending || push.isPending;
  const configured = !!dest?.configured;

  return (
    <View style={{ gap: spacing.sm, marginTop: spacing.md }}>
      <CText t="kicker" color={cl.goldKicker}>
        Send contacts to Clay
      </CText>
      <CText t="metaSm" color={cl.ink48}>
        In Clay, add an “Import from Webhook” source to a table and paste its URL here.
        Amber sends name, email, phone, company, title and location as columns.
      </CText>

      {destQuery.isLoading ? (
        <CText t="metaSm" color={cl.ink48}>
          Loading…
        </CText>
      ) : configured && !editing ? (
        <View style={{ gap: 6 }}>
          <CText t="metaSm" color={cl.ink} numberOfLines={1}>
            {dest?.webhookUrl ?? 'Configured'}
          </CText>
          {dest?.lastPushAt ? (
            <CText t="metaSm" color={cl.ink48}>
              {`Last sent ${dest.lastPushCount ?? 0} contacts`}
            </CText>
          ) : null}
          <View style={{ flexDirection: 'row', gap: spacing.md, marginTop: 4 }}>
            <Pressable
              onPress={() => push.mutate(true)}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel="Preview what would be sent to Clay"
              hitSlop={8}
              style={({ pressed }) => ({ opacity: busy ? 0.4 : pressed ? 0.6 : 1 })}
            >
              <CText t="listTitle" color={cl.goldDeep}>
                Preview
              </CText>
            </Pressable>
            <Pressable
              onPress={() => push.mutate(false)}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel="Send contacts to Clay now"
              hitSlop={8}
              style={({ pressed }) => ({ opacity: busy ? 0.4 : pressed ? 0.6 : 1 })}
            >
              <CText t="listTitle" color={cl.goldDeep}>
                {push.isPending ? 'Sending…' : 'Send now'}
              </CText>
            </Pressable>
            <View style={{ flex: 1 }} />
            <Pressable
              onPress={() => setEditing(true)}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel="Replace the Clay webhook URL"
              hitSlop={8}
              style={({ pressed }) => ({ opacity: busy ? 0.4 : pressed ? 0.6 : 1 })}
            >
              <CText t="listTitle" color={cl.ink48}>
                Replace
              </CText>
            </Pressable>
            <Pressable
              onPress={() => clear.mutate()}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel="Remove the Clay webhook URL"
              hitSlop={8}
              style={({ pressed }) => ({ opacity: busy ? 0.4 : pressed ? 0.6 : 1 })}
            >
              <CText t="listTitle" color={cl.ink48}>
                Remove
              </CText>
            </Pressable>
          </View>
        </View>
      ) : (
        <View style={{ gap: spacing.sm }}>
          <RNTextInput
            value={draft}
            onChangeText={setDraft}
            placeholder="https://api.clay.com/v3/sources/webhook/…"
            placeholderTextColor={cl.ink38}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            style={{
              borderWidth: HAIRLINE,
              borderColor: cl.cardHairline,
              borderRadius: clRadius.card,
              paddingHorizontal: spacing.md,
              paddingVertical: spacing.sm,
              fontFamily: fonts.body,
              fontSize: 13,
              color: cl.ink,
            }}
          />
          <View style={{ flexDirection: 'row', gap: spacing.md }}>
            <Pressable
              onPress={() => save.mutate(draft.trim())}
              disabled={busy || !draft.trim()}
              accessibilityRole="button"
              accessibilityLabel="Save the Clay webhook URL"
              hitSlop={8}
              style={({ pressed }) => ({
                opacity: busy || !draft.trim() ? 0.4 : pressed ? 0.6 : 1,
              })}
            >
              <CText t="listTitle" color={cl.goldDeep}>
                {save.isPending ? 'Saving…' : 'Save'}
              </CText>
            </Pressable>
            {configured ? (
              <Pressable
                onPress={() => {
                  setEditing(false);
                  setDraft('');
                }}
                accessibilityRole="button"
                accessibilityLabel="Cancel"
                hitSlop={8}
                style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
              >
                <CText t="listTitle" color={cl.ink48}>
                  Cancel
                </CText>
              </Pressable>
            ) : null}
          </View>
        </View>
      )}
    </View>
  );
}

// The single API-key surface. Scrollable, because with the secret reveal, the
// endpoint, the example body and the key list it is taller than a phone.
function ApiKeyModal({ mgr }: { mgr: ReturnType<typeof useApiKeyManager> }) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={mgr.open} transparent animationType="fade" onRequestClose={mgr.hide}>
      <View style={{ flex: 1, backgroundColor: 'rgba(20,18,16,0.45)', justifyContent: 'flex-end' }}>
        <View
          style={{
            // Nearly full height: the sheet has to hold the reveal, three copy
            // rows, the field reference AND the key list. At 88% the last section
            // was permanently below the fold.
            maxHeight: '94%',
            backgroundColor: cl.card,
            borderTopLeftRadius: clRadius.card,
            borderTopRightRadius: clRadius.card,
            borderWidth: HAIRLINE,
            borderColor: cl.cardHairline,
            paddingTop: spacing.lg,
            // No trailing pad here — the ScrollView owns its own bottom inset
            // below, so the last row can scroll clear of the home indicator
            // instead of being pinned under it.
            paddingBottom: 0,
          }}
        >
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 10,
              paddingHorizontal: spacing.lg,
              paddingBottom: spacing.md,
            }}
          >
            {/* Decoration, not a control — it has no onPress and is marked
                accessibility-hidden so VoiceOver doesn't announce it as tappable. */}
            <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
              <CIconSquare size={34} tone="gold">
                <KeyRound size={17} color={cl.goldKicker} strokeWidth={1.7} />
              </CIconSquare>
            </View>
            <CText t="cardTitle" style={{ flex: 1 }}>
              Import contacts
            </CText>
            {/* "Done" read like a save. Nothing on this sheet needs saving — keys
                are created and revoked immediately — so the label says what it
                actually does. */}
            <Pressable
              onPress={mgr.hide}
              accessibilityRole="button"
              accessibilityLabel="Close this sheet"
              hitSlop={10}
              style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
            >
              <CText t="listTitle" color={cl.goldDeep}>
                Close
              </CText>
            </Pressable>
          </View>

          <ScrollView
            contentContainerStyle={{
              paddingHorizontal: spacing.lg,
              gap: spacing.md,
              // Clears the home indicator so YOUR KEYS can be scrolled fully into
              // view rather than peeking up from the bottom edge.
              paddingBottom: insets.bottom + spacing.xl,
            }}
            showsVerticalScrollIndicator={false}
          >
            <CText t="metaSm" color={cl.ink}>
              Push contacts into Amber from Clay, Happenstance, or anything that can make an HTTP
              request. Every contact you send becomes a contact card automatically — deduped against
              your existing people, so re-sending updates a card instead of duplicating it.
            </CText>

            {mgr.createdKey ? (
              <View
                style={{
                  gap: spacing.sm,
                  padding: spacing.md,
                  borderRadius: radius.md,
                  borderWidth: HAIRLINE,
                  borderColor: cl.gold55,
                  backgroundColor: cl.tint100,
                }}
              >
                <CText t="metaSm" color="#B3402C">
                  Copy this now — you won&apos;t be able to see it again.
                </CText>
                <Pressable
                  onPress={() => void mgr.copySecret()}
                  accessibilityRole="button"
                  accessibilityLabel="Copy API key"
                  style={{
                    paddingHorizontal: 12,
                    paddingVertical: 12,
                    borderRadius: radius.md,
                    backgroundColor: '#F4F2EF',
                    borderWidth: HAIRLINE,
                    borderColor: cl.ruleFaint,
                  }}
                >
                  <CText t="metaSm" color={cl.ink} selectable>
                    {mgr.createdKey.key}
                  </CText>
                </Pressable>
                <CText t="metaXs" color={cl.ink55}>
                  {mgr.copied ? 'Copied to your clipboard.' : 'Tap the key to copy it.'}
                </CText>
              </View>
            ) : null}

            <SecondaryButton
              label={mgr.generating ? 'Generating…' : 'Generate a new API key'}
              loading={mgr.generating}
              onPress={mgr.generate}
            />

            <CopyRow label="1 · POST to this URL — tap to copy" value={CONTACTS_INGEST_URL} />
            <CopyRow label="2 · Send this header — tap to copy" value="x-amber-api-key: <your key>" />
            <CopyRow
              label="3 · Body shape — tap to copy"
              value={INGEST_EXAMPLE}
              quiet
            />

            <CText t="metaXs" color={cl.ink}>
              Fields: name (or firstName + lastName), email/emails, phone/phoneNumbers, company,
              title, linkedinUrl, location, notes, source. Send one contact or up to 500 in a
              contacts array. Anything unrecognised is folded into notes rather than dropped.
            </CText>

            <View style={{ gap: spacing.sm, paddingTop: spacing.xs }}>
              <CText t="metaXs" color={cl.ink}>
                YOUR KEYS
              </CText>
              {mgr.keysLoading ? (
                <CText t="metaSm" color={cl.ink48}>
                  Loading…
                </CText>
              ) : mgr.keysError ? (
                <RetryRow label="Couldn't load your keys." onRetry={() => mgr.refetchKeys()} />
              ) : mgr.keys.length === 0 ? (
                <CText t="metaSm" color={cl.ink48}>
                  No keys yet.
                </CText>
              ) : (
                mgr.keys.map((k) => (
                  <View
                    key={k.id}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: spacing.sm,
                      paddingVertical: 10,
                      borderBottomWidth: HAIRLINE,
                      borderBottomColor: cl.ruleFaint,
                    }}
                  >
                    <View style={{ flex: 1 }}>
                      <CText t="listTitle">{k.name?.trim() || 'Untitled key'}</CText>
                      <CText t="metaXs" color={cl.ink55} style={{ marginTop: 2 }}>
                        {`amberk_…${k.last4}`}
                      </CText>
                    </View>
                    <Pressable
                      onPress={() => mgr.revoke(k)}
                      disabled={mgr.revokingId === k.id}
                      accessibilityRole="button"
                      accessibilityLabel={`Revoke ${k.name ?? 'key'}`}
                      hitSlop={8}
                      style={({ pressed }) => ({
                        opacity: mgr.revokingId === k.id ? 0.4 : pressed ? 0.6 : 1,
                      })}
                    >
                      <CText t="metaSm" color={LIGHT.danger}>
                        {mgr.revokingId === k.id ? 'Revoking…' : 'Revoke'}
                      </CText>
                    </Pressable>
                  </View>
                ))
              )}
            </View>

            {/* The other direction. Same sheet, because there is one Clay integration
                from the user's point of view, not two. */}
            <ClayPushSection />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const MENTIONS_PREVIEW = 3;
/** Fetched once, at the full depth "load more" can reveal — one request, not two. */
const MENTIONS_MAX = 10;

// WHO YOU'VE BEEN TALKING ABOUT — the people your voice notes keep landing on.
//
// Deliberately not "recently contacted". You can talk about someone for a month
// without texting them once, and a list built from call and message logs would miss
// exactly the person you have been meaning to call. The server orders by the newest
// mention on a captured note or experience, so this is only ever people Amber has
// actually heard you talk about.
function RecentlyMentionedSection() {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const q = useQuery({
    queryKey: ['recentlyMentioned', MENTIONS_MAX],
    queryFn: async () => unwrapOrThrow(await listRecentlyMentioned(MENTIONS_MAX)).contacts,
    staleTime: 60_000,
  });
  // One clock for the whole list, read once per render, so ten rows do not each
  // call Date.now() and disagree with each other by a millisecond.
  const now = Date.now();

  if (q.isLoading) {
    return (
      <DCard>
        <CText t="metaSm" color={cl.ink48}>
          Loading…
        </CText>
      </DCard>
    );
  }
  const items = q.data ?? [];
  if (items.length === 0) {
    return (
      <DCard>
        <CText t="listTitle">Nobody yet</CText>
        <CText t="metaSm" color={cl.ink48} style={{ marginTop: 4 }}>
          Record a note about someone and they&rsquo;ll show up here.
        </CText>
      </DCard>
    );
  }
  const visible = expanded ? items : items.slice(0, MENTIONS_PREVIEW);
  const hiddenCount = items.length - visible.length;

  return (
    <View style={{ gap: clLayout.cardGap - 4 }}>
      {visible.map((m) => {
        const when = m.mentionedAt ? Date.parse(m.mentionedAt) : NaN;
        const detail = [m.title, m.company].filter(Boolean).join(', ');
        return (
          <Pressable
            key={m.contactId}
            onPress={() => router.push(`/(gated)/person/${m.contactId}`)}
            accessibilityRole="button"
            accessibilityLabel={m.name ?? 'Contact'}
            style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
          >
            <DCard>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <CText t="listTitle" style={{ flex: 1 }}>
                  {m.name ?? 'Someone'}
                </CText>
                {Number.isFinite(when) ? (
                  <CText t="metaSm" color={cl.ink48}>
                    {timeAgo(when, now)}
                  </CText>
                ) : null}
              </View>
              {detail ? (
                <CText t="metaSm" color={cl.ink48} style={{ marginTop: 3 }}>
                  {detail}
                </CText>
              ) : null}
              {m.excerpt ? (
                // numberOfLines, not a character cap: the excerpt is already
                // trimmed server-side, and clamping by LINES is what keeps every
                // card the same height at any accessibility text size.
                <CText t="metaSm" style={{ marginTop: 7 }} numberOfLines={2}>
                  {m.excerpt}
                </CText>
              ) : null}
              {m.mentionCount > 1 ? (
                <CText t="metaSm" color={cl.goldDeep} style={{ marginTop: 7 }}>
                  {`Mentioned ${m.mentionCount} times`}
                </CText>
              ) : null}
            </DCard>
          </Pressable>
        );
      })}
      {hiddenCount > 0 ? (
        <Pressable
          onPress={() => setExpanded(true)}
          accessibilityRole="button"
          accessibilityLabel={`Load ${hiddenCount} more`}
          hitSlop={8}
          style={({ pressed }) => ({ alignSelf: 'flex-start', opacity: pressed ? 0.6 : 1 })}
        >
          <CText t="metaSm" color={cl.goldDeep}>
            {`Load more (${hiddenCount})`}
          </CText>
        </Pressable>
      ) : items.length > MENTIONS_PREVIEW ? (
        <Pressable
          onPress={() => setExpanded(false)}
          accessibilityRole="button"
          accessibilityLabel="Show fewer"
          hitSlop={8}
          style={({ pressed }) => ({ alignSelf: 'flex-start', opacity: pressed ? 0.6 : 1 })}
        >
          <CText t="metaSm" color={cl.goldDeep}>
            Show less
          </CText>
        </Pressable>
      ) : null}
    </View>
  );
}

/**
 * Pick a circle to pin, in place.
 *
 * This was a Modal -- a dark scrim over the whole page and a sheet sliding up
 * from the bottom -- for a decision that takes one tap and changes something
 * three inches above it. Dimming the page you are arranging, in order to
 * arrange it, is the wrong gesture at the wrong weight.
 *
 * So it is a row that opens under the grid: the same surface, no backdrop,
 * nothing to dismiss. It scrolls sideways because the interesting case is a
 * handful of circles, not ninety, and a horizontal rail of emblems reads as
 * "here are the ones you could add" without claiming a page of its own.
 *
 * Already-pinned circles are absent here rather than shown-and-disabled, which
 * is the opposite of the old sheet. A sheet was a list you scanned, so keeping
 * the pinned ones in place stopped it reflowing under your eyes; a short rail of
 * things you can actually tap has no such problem, and grayed-out entries in a
 * five-item rail are just clutter.
 */
function PinCircleRow({
  circles,
  pinnedIds,
  onPick,
  onClose,
}: {
  circles: CirclePreview[];
  pinnedIds: string[];
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  const pinned = new Set(pinnedIds);
  const available = circles.filter((c) => !pinned.has(c.id));

  return (
    <View
      style={{
        marginTop: spacing.sm,
        paddingTop: spacing.base,
        borderTopWidth: HAIRLINE,
        borderTopColor: cl.ruleFaint,
      }}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: spacing.sm,
        }}
      >
        <CText t="kicker" color={cl.goldKicker}>
          {available.length > 0 ? 'PIN A CIRCLE' : 'NOTHING LEFT TO PIN'}
        </CText>
        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close"
          hitSlop={10}
          style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}
        >
          <CText t="metaSm" color={cl.ink48}>
            Done
          </CText>
        </Pressable>
      </View>

      {available.length === 0 ? (
        <CText t="metaSm" color={cl.ink48}>
          {circles.length === 0
            ? 'You have no circles yet — make one with + New above.'
            : 'Every circle you have is already pinned.'}
        </CText>
      ) : (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          // This rail lives inside the vertical profile scroll view, which is
          // itself inside the horizontal pager. Without the lock a
          // slightly-diagonal drag here is claimed by the rail and the page
          // neither scrolls nor swipes.
          directionalLockEnabled
          contentContainerStyle={{ gap: 14, paddingRight: spacing.base }}
        >
          {available.map((c) => (
            <Pressable
              key={c.id}
              onPress={() => onPick(c.id)}
              accessibilityRole="button"
              accessibilityLabel={`Pin ${c.name}`}
              style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, alignItems: 'center', width: 64 })}
            >
              <ContactEmblem
                name={c.name}
                initials={(c.name || '?').trim().charAt(0).toUpperCase() || '?'}
                size={48}
                accent={(c.color && NAMED_COLORS[c.color]) || NAMED_COLORS.orange}
              />
              <CText
                t="metaXs"
                color={cl.ink55}
                numberOfLines={1}
                style={{ marginTop: 5, textAlign: 'center', maxWidth: '100%' }}
              >
                {c.name}
              </CText>
            </Pressable>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

// LinkedInRow USED TO BE HERE, and its own comment above the connections list
// said it was 'still defined below' after the row was pulled from the UI. That
// is the same sentence that kept a whole second search bar alive in AskChat.
// git has it.



// The profile hero, built to `Circle Profile Light.dc.html`.
//
// Layers, bottom to top: a warm radial bloom bleeding off the top of the screen,
// a 112px chord ring, and a gradient monogram disc inset 15px inside it. Then the
// serif name, the tracked "@handle · ROLE" line, a three-column stat row fenced by
// hairlines, and the two pill actions side by side.
function ProfileHero({
  me,
  connectionsCount,
  circlesCount,
  contactsCount,
  onEdit,
  onShare,
  onGenerateApiKey,
  onOpenConnections,
}: {
  me: Me | null;
  connectionsCount: number;
  circlesCount: number;
  contactsCount: number;
  onEdit: () => void;
  onShare: () => void;
  onGenerateApiKey: () => void;
  onOpenConnections: () => void;
}) {
  const displayName = (me?.displayName ?? '').trim();
  const username = (me?.username ?? '').trim();
  const role = (me?.occupation ?? '').trim();
  const monogram = (displayName || username || '?').trim().charAt(0).toUpperCase();

  // "@handle · ROLE" — each half is optional, so the separator only appears when
  // there is something on both sides of it.
  const identityLine = [username ? `@${username}` : null, role || null]
    .filter(Boolean)
    .join('  ·  ');

  return (
    <View style={{ alignItems: 'center', paddingHorizontal: clLayout.gutter }}>
      {/* THE BLOOM, AND WHY IT NO LONGER TOUCHES THE TOP OF THE SCREEN.
          -------------------------------------------------------------
          "Look at the colors between the calendar at the top of the homepage
           and the You tab page. It should blend in perfectly."

          This was the seam, and it was not the palette's fault. Every page in
          the app shares ONE background wash (ClassicalGround, behind the pager),
          so at any given height the three pages are the same color by
          construction -- except that this bloom painted #D67F48 at 26% over the
          top of this one, bleeding off the top edge from y = -140. Terracotta at
          a quarter strength is a different PIGMENT from the wash, not a shade of
          it, so mid-swipe the top of You sat against the top of Today with a
          hard vertical line between a peach and a cream. No amount of retuning
          the wash could close a gap that one page was opening on top of it.

          Two changes, and the first is the one that matters:

          IT STARTS BELOW THE TOP EDGE. Centered on the mark rather than bleeding
          off the screen, and faded to nothing well before it gets there, so the
          top ~110pt of this page is the bare shared wash -- identical to Today's
          and People's, to the byte. That is what "blends in perfectly" requires:
          not a closer color, the same color.

          IT IS IN THE WASH'S OWN FAMILY. #E0A45C rather than #D67F48 -- the same
          warm amber the page is already made of, at half the old peak opacity.
          Where it does show, behind the mark, it reads as the page catching more
          light in one place, which is what a bloom is for. It is still visibly
          there; it is no longer a second color scheme.

          The bloom must not intercept touches: the mark under it is a button. */}
      <View
        pointerEvents="none"
        style={{ position: 'absolute', top: 4, width: 460, height: 340 }}
      >
        <Svg width={460} height={340}>
          <Defs>
            <RadialGradient id="profileGlow" cx="50%" cy="50%" r="50%">
              <Stop offset="0%" stopColor="#E0A45C" stopOpacity={0.13} />
              <Stop offset="46%" stopColor="#E0A45C" stopOpacity={0.055} />
              <Stop offset="72%" stopColor="#F5EAD8" stopOpacity={0} />
              <Stop offset="100%" stopColor="#F5EAD8" stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Ellipse cx={230} cy={170} rx={230} ry={170} fill="url(#profileGlow)" />
        </Svg>
      </View>

      <Pressable
        onPress={onEdit}
        accessibilityRole="button"
        accessibilityLabel="Edit your profile"
        style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1, paddingTop: 22 })}
      >
        {/* YOUR MARK. It was a 112pt chord ring with a gradient terracotta
            disc inset inside it, transcribed from a mockup whose page was pale
            gray. The ground is a warm orange gradient now, so a saturated
            orange coin had nothing to separate against but its own shadow, and
            it out-weighed your own name directly underneath it.
            Cream, rings, and small unlabelled colored dots: the same drawing
            as the circles web further down the page. See components/marks.tsx.
            138 rather than 112 because a constellation needs the room, and this
            is the one image on the page that is you. */}
        <ProfileMark monogram={monogram} size={138} />
      </Pressable>

      <Text
        numberOfLines={1}
        style={{
          marginTop: 15,
          fontFamily: fonts.serif,
          fontSize: 36,
          lineHeight: 40,
          letterSpacing: 0.36,
          color: '#2E2B25',
        }}
      >
        {displayName || 'Your name'}
      </Text>
      {identityLine ? (
        <Text
          style={{
            marginTop: 8,
            fontFamily: fonts.body,
            fontSize: 11.5,
            lineHeight: 17,
            letterSpacing: 2.3,
            color: '#8C491A',
            textTransform: 'uppercase',
          }}
        >
          {identityLine}
        </Text>
      ) : null}

      {/* Stat row, fenced top and bottom by hairlines with 1px column dividers. */}
      <View
        style={{
          flexDirection: 'row',
          alignSelf: 'stretch',
          marginTop: 16,
          borderTopWidth: 1,
          borderBottomWidth: 1,
          borderColor: 'rgba(178,98,45,0.18)',
        }}
      >
        {/* THE ONLY ONE OF THE THREE THAT DOES ANYTHING. Circles and Contacts
            are counts with pages of their own elsewhere; this one had no
            destination at all, which is the app knowing something it would not
            show you. */}
        <HeroStat value={connectionsCount} label="Connections" onPress={onOpenConnections} />
        <View style={{ width: 1, backgroundColor: 'rgba(178,98,45,0.18)', marginVertical: 12 }} />
        <HeroStat value={circlesCount} label={circlesCount === 1 ? 'Circle' : 'Circles'} />
        <View style={{ width: 1, backgroundColor: 'rgba(178,98,45,0.18)', marginVertical: 12 }} />
        <HeroStat value={contactsCount} label={contactsCount === 1 ? 'Contact' : 'Contacts'} />
      </View>

      <View style={{ flexDirection: 'row', alignSelf: 'stretch', gap: 10, marginTop: 14 }}>
        <HeroAction label="Share card" glyph="◱" onPress={onShare} />
        <HeroAction label="Generate API key" glyph="⌘" onPress={onGenerateApiKey} />
      </View>
    </View>
  );
}

/**
 * One number in the hero's stat row.
 *
 * `onPress` is OPTIONAL and deliberately so: "If you press Circles or Contacts,
 * nothing should happen." A count with no destination should not look like a
 * button, so without a handler this renders a plain View -- no press opacity, no
 * button role for the screen reader, nothing to invite the tap.
 */
function HeroStat({
  value,
  label,
  onPress,
}: {
  value: number;
  label: string;
  onPress?: () => void;
}) {
  const body = (
    <View style={{ flex: 1, alignItems: 'center', gap: 4, paddingVertical: 14 }}>
      <Text
        style={{
          fontFamily: fonts.serif,
          fontSize: 26,
          lineHeight: 28,
          color: '#2E2B25',
          fontVariant: ['tabular-nums'],
        }}
      >
        {value}
      </Text>
      <Text
        style={{
          fontFamily: fonts.body,
          fontSize: 9.5,
          lineHeight: 14,
          letterSpacing: 1.52,
          textTransform: 'uppercase',
          color: 'rgba(32,30,29,0.45)',
        }}
      >
        {label}
      </Text>
    </View>
  );
  if (!onPress) return body;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${value} ${label}`}
      style={({ pressed }) => ({ flex: 1, opacity: pressed ? 0.6 : 1 })}
    >
      {body}
    </Pressable>
  );
}

function HeroAction({
  label,
  glyph,
  onPress,
  disabled = false,
}: {
  label: string;
  glyph: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      style={({ pressed }) => ({ flex: 1, opacity: disabled ? 0.5 : pressed ? 0.7 : 1 })}
    >
      {/* Deliberately quiet: a hairline instead of a 1px border, the glyph bare
          rather than boxed, and content centerd. The boxed icon plus a heavier
          border made these read as primary buttons competing with the stat row
          above them — they are secondary actions and should sit back. */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          paddingVertical: 11,
          paddingHorizontal: 12,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: 'rgba(178,98,45,0.35)',
          borderRadius: radius.full,
          backgroundColor: 'rgba(255,248,240,0.55)',
        }}
      >
        <Text style={{ fontFamily: fonts.body, fontSize: 11, color: 'rgba(140,73,26,0.75)' }}>
          {glyph}
        </Text>
        <Text
          numberOfLines={1}
          style={{
            fontFamily: fonts.body,
            fontSize: 12.5,
            lineHeight: 18,
            color: 'rgba(32,30,29,0.72)',
          }}
        >
          {label}
        </Text>
      </View>
    </Pressable>
  );
}








function EditProfileSheet({
  visible,
  me,
  onClose,
  onSaved,
}: {
  visible: boolean;
  me: Me | null;
  onClose: () => void;
  onSaved: (patch: Partial<Me>) => void;
}) {
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [usernameStatus, setUsernameStatus] = useState<
    'idle' | 'checking' | 'available' | 'taken' | 'invalid'
  >('idle');
  const [usernameReason, setUsernameReason] = useState<string | undefined>(undefined);
  const [currentCity, setCurrentCity] = useState('');
  const [bio, setBio] = useState('');
  const [occupation, setOccupation] = useState('');
  const [mbti, setMbti] = useState('');
  const [school, setSchool] = useState('');
  const [hometown, setHometown] = useState('');
  const [horoscope, setHoroscope] = useState('');
  const insets = useSafeAreaInsets();

  const originalUsername = (me?.username ?? '').trim().toLowerCase();

  useEffect(() => {
    if (visible) {
      setDisplayName(me?.displayName ?? '');
      setUsername(me?.username ?? '');
      setUsernameStatus('idle');
      setUsernameReason(undefined);
      setCurrentCity(me?.currentCity ?? '');
      setBio(me?.bio ?? '');
      setOccupation(me?.occupation ?? '');
      setMbti(me?.mbti ?? '');
      setSchool(me?.school ?? '');
      setHometown(me?.hometown ?? '');
      setHoroscope(me?.horoscope ?? '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // Debounced availability check — skipped entirely when the draft matches
  // the username already on file, so opening the sheet never fires a
  // spurious network call.
  useEffect(() => {
    if (!visible) return undefined;
    const trimmed = username.trim().toLowerCase();

    if (trimmed === originalUsername) {
      setUsernameStatus('idle');
      setUsernameReason(undefined);
      return undefined;
    }
    if (trimmed.length === 0) {
      setUsernameStatus('idle');
      setUsernameReason(undefined);
      return undefined;
    }
    if (!/^[a-z0-9_]{3,20}$/.test(trimmed)) {
      setUsernameStatus('invalid');
      setUsernameReason(undefined);
      return undefined;
    }

    setUsernameStatus('checking');
    let cancelled = false;
    const timer = setTimeout(() => {
      void usernameAvailable(trimmed).then((r) => {
        if (cancelled) return;
        if (!r.ok) {
          setUsernameStatus('idle');
          return;
        }
        if (r.data.available) {
          setUsernameStatus('available');
          setUsernameReason(undefined);
        } else {
          setUsernameStatus('taken');
          setUsernameReason(r.data.reason);
        }
      });
    }, 400);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [username, visible, originalUsername]);

  const save = useMutation({
    mutationFn: async (): Promise<{ usernameError?: 'taken' | 'invalid' }> => {
      const body: Record<string, string> = {};
      const name = displayName.trim();
      const city = currentCity.trim();
      const nextBio = bio.trim();
      const trimmedUsername = username.trim().toLowerCase();
      if (name) body.displayName = name;
      if (trimmedUsername) body.username = trimmedUsername;
      body.currentCity = city;
      body.bio = nextBio;
      body.occupation = occupation.trim();
      body.mbti = mbti.trim();
      body.school = school.trim();
      body.hometown = hometown.trim();
      body.horoscope = horoscope.trim();

      const r = await callMedhaId<Me>({ path: '/v1/me', method: 'PATCH', body, requireAuth: true });
      if (r.ok) return {};

      if ((r.status === 409 || r.status === 400) && body.username) {
        // Username-specific failure — retry without it so the rest of the
        // edits still land instead of blocking the whole save.
        const { username: _dropped, ...rest } = body;
        const retry = await callMedhaId<Me>({
          path: '/v1/me',
          method: 'PATCH',
          body: rest,
          requireAuth: true,
        });
        unwrapOrThrow(retry);
        return { usernameError: r.status === 409 ? 'taken' : 'invalid' };
      }

      throw new MedhaIdRequestError(r);
    },
    onSuccess: ({ usernameError }) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      if (usernameError === 'taken') {
        toast.error('Username taken', 'The rest of your profile was saved.');
      } else if (usernameError === 'invalid') {
        toast.error('Invalid username', 'The rest of your profile was saved.');
      } else {
        toast.success('Profile saved.');
      }
      onSaved({
        displayName: displayName.trim(),
        ...(usernameError ? {} : { username: username.trim().toLowerCase() || null }),
        currentCity: currentCity.trim(),
        bio: bio.trim(),
        occupation: occupation.trim(),
        mbti: mbti.trim(),
        school: school.trim(),
        hometown: hometown.trim(),
        horoscope: horoscope.trim(),
      });
    },
    onError: (e) => toast.error('Could not save', errorCopy(e)),
  });

  const nameInvalid = displayName.trim().length === 0;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
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
            flexDirection: 'column',
            maxHeight: '88%',
          }}
        >
          <View style={{ alignItems: 'center', paddingTop: spacing.sm }}>
            <View
              style={{ width: 36, height: 4, borderRadius: radius.full, backgroundColor: LIGHT.hairline }}
            />
          </View>
          <ScrollView
            style={{ flexGrow: 1, flexShrink: 1 }}
            contentContainerStyle={{ padding: spacing.lg, gap: spacing.base }}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <View
              style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
            >
              <Text variant="displaySm" style={{ color: LIGHT.textPrimary, letterSpacing: -0.3 }}>
                Edit profile
              </Text>
              <CornerButton accessibilityLabel="Close" onPress={onClose}>
                <X size={18} color={LIGHT.textSecondary} />
              </CornerButton>
            </View>

            <Field label="Name" value={displayName} onChangeText={setDisplayName} placeholder="Your name" autoCapitalize="words" error={nameInvalid ? 'Name cannot be empty.' : undefined} />
            <UsernameField
              value={username}
              onChangeText={setUsername}
              status={usernameStatus}
              reason={usernameReason}
            />
            <Field label="City" value={currentCity} onChangeText={setCurrentCity} placeholder="Where you are based" autoCapitalize="words" />
            <Field label="Bio" value={bio} onChangeText={setBio} placeholder="A line about you" helperText="Amber uses this to introduce you." multiline />
            <Field label="Occupation" value={occupation} onChangeText={setOccupation} placeholder="What you do" autoCapitalize="words" />
            <Field label="Personality (MBTI)" value={mbti} onChangeText={setMbti} placeholder="e.g. INTJ" autoCapitalize="characters" />
            <Field label="School" value={school} onChangeText={setSchool} placeholder="Where you studied" autoCapitalize="words" />
            <Field label="Hometown" value={hometown} onChangeText={setHometown} placeholder="Where you're from" autoCapitalize="words" />
            <Field label="Horoscope" value={horoscope} onChangeText={setHoroscope} placeholder="e.g. Scorpio" autoCapitalize="words" />
          </ScrollView>

          <View
            style={{
              flexShrink: 0,
              alignItems: 'flex-end',
              paddingHorizontal: spacing.lg,
              paddingTop: spacing.md,
              paddingBottom: insets.bottom + spacing.md,
              borderTopWidth: 1,
              borderColor: LIGHT.hairline,
              backgroundColor: LIGHT.surface,
            }}
          >
            <Pressable
              onPress={() => save.mutate()}
              disabled={nameInvalid || save.isPending}
              accessibilityRole="button"
              accessibilityLabel="Save changes"
              style={[
                {
                  alignSelf: 'flex-end',
                  height: 44,
                  minWidth: 120,
                  paddingHorizontal: spacing.xl,
                  borderRadius: clRadius.chip,
                  borderWidth: HAIRLINE,
                  borderColor: cl.gold55,
                  backgroundColor: cl.tint100,
                  alignItems: 'center',
                  justifyContent: 'center',
                },
                nameInvalid && { opacity: 0.4 },
              ]}
            >
              {save.isPending ? (
                <ActivityIndicator color={cl.goldDeep} size="small" />
              ) : (
                <CText t="listTitle" color={cl.goldDeep}>
                  Save changes
                </CText>
              )}
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  helperText,
  error,
  autoCapitalize,
  multiline,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  helperText?: string;
  error?: string;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  multiline?: boolean;
}) {
  return (
    <View style={{ gap: spacing.xs }}>
      <Text variant="microLabel" uppercase>
        {label}
      </Text>
      <View
        style={{
          borderRadius: radius.md,
          borderWidth: 1,
          borderColor: error ? LIGHT.danger : LIGHT.hairlineStrong,
          backgroundColor: LIGHT.surface,
          paddingHorizontal: spacing.base,
          paddingVertical: spacing.sm,
          minHeight: multiline ? 80 : undefined,
        }}
      >
        <RNTextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={LIGHT.textMuted}
          autoCapitalize={autoCapitalize ?? 'sentences'}
          autoCorrect={false}
          multiline={multiline}
          style={{
            color: LIGHT.textPrimary,
            fontFamily: typography.bodyMd.fontFamily,
            fontSize: typography.bodyMd.fontSize,
            paddingTop: 0,
            paddingBottom: 0,
            textAlignVertical: multiline ? 'top' : 'center',
          }}
        />
      </View>
      {helperText && !error ? (
        <Text variant="captionSm" style={{ color: LIGHT.textMuted }}>
          {helperText}
        </Text>
      ) : null}
      {error ? (
        <Text variant="captionSm" style={{ color: LIGHT.danger }}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

function UsernameField({
  value,
  onChangeText,
  status,
  reason,
}: {
  value: string;
  onChangeText: (v: string) => void;
  status: 'idle' | 'checking' | 'available' | 'taken' | 'invalid';
  reason?: string;
}) {
  const isProblem = status === 'taken' || status === 'invalid';
  const borderColor = isProblem ? LIGHT.danger : LIGHT.hairlineStrong;

  let helper = '3–20 chars, a–z 0–9 _';
  let helperColor: string = LIGHT.textMuted;
  if (status === 'checking') {
    helper = 'Checking…';
  } else if (status === 'available') {
    helper = 'Available';
    helperColor = TREND_UP;
  } else if (status === 'taken') {
    helper = reason ?? 'Username taken.';
    helperColor = LIGHT.danger;
  } else if (status === 'invalid') {
    helper = 'Invalid username.';
    helperColor = LIGHT.danger;
  }

  return (
    <View style={{ gap: spacing.xs }}>
      <Text variant="microLabel" uppercase>
        Username
      </Text>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.xs,
          borderRadius: radius.md,
          borderWidth: 1,
          borderColor,
          backgroundColor: LIGHT.surface,
          paddingHorizontal: spacing.base,
          paddingVertical: spacing.sm,
        }}
      >
        <Text
          style={{
            color: LIGHT.textMuted,
            fontFamily: typography.bodyMd.fontFamily,
            fontSize: typography.bodyMd.fontSize,
          }}
        >
          @
        </Text>
        <RNTextInput
          value={value}
          onChangeText={(t) => onChangeText(t.toLowerCase())}
          placeholder="username"
          placeholderTextColor={LIGHT.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
          style={{
            flex: 1,
            color: LIGHT.textPrimary,
            fontFamily: typography.bodyMd.fontFamily,
            fontSize: typography.bodyMd.fontSize,
            paddingTop: 0,
            paddingBottom: 0,
          }}
        />
        {status === 'checking' ? <ActivityIndicator size="small" color={LIGHT.textMuted} /> : null}
        {status === 'available' ? <Check size={16} color={TREND_UP} /> : null}
      </View>
      <Text variant="captionSm" style={{ color: helperColor }}>
        {helper}
      </Text>
    </View>
  );
}

// Memoized: HomeScreen re-renders on each pager-position change. `isActive`
// only flips when the pager actually lands on (or leaves) this third page, so
// memo confines this page's re-renders to those real transitions instead of
// every halfway-cross of a swipe elsewhere.
export const ProfilePage = memo(ProfilePageBase);
