import { revokeProcessingConsent } from '../../lib/aiConsent';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Linking, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import * as WebBrowser from 'expo-web-browser';
import * as Contacts from 'expo-contacts';
import {
  Bell,
  Check,
  ChevronLeft,
  FileText,
  LifeBuoy,
  Merge,
  ShieldCheck,
  Trash2,
  Users,
} from 'lucide-react-native';
import { Screen } from '../Screen';
import { Pressable } from '../Pressable';
import { BuildStamp } from '../BuildStamp';
import { CalendarSyncSheet } from '../CalendarSyncSheet';
import { ImessageChannelSection } from '../ImessageChannelSection';
import { DuplicateContactsSheet } from '../DuplicateContactsSheet';
import { AmbiguousLinksSheet } from '../AmbiguousLinksSheet';
import { CCard, CHeader, CListRow, CText } from '../classical';
import {
  Block,
  DCard,
  NotificationCategoriesSection,
  NotificationsSection,
  PlatformRow,
  RetryRow,
  Section,
  SecondaryButton,
} from '../profileParts';
import { privacyPolicyUrl, termsUrl } from '../../lib/config';
import { HAIRLINE, cl, clLayout, clRadius } from '../../lib/classical';
import { LIGHT } from '../../lib/theme';
import { spacing } from '../../lib/tokens';
import { api, fetchConnections, type ConnectionRow } from '../../lib/api';
import { callMedhaId, errorCopy, unwrapOrThrow } from '../../lib/medhaId';
import { clearLocalUserData, signOut } from '../../lib/auth';
import { formatCount, type ContactsAccess } from '../../lib/contactsSync';
import { startContactsSync } from '../../lib/contactsSyncEngine';
import { useSyncState } from '../../lib/syncState';
import { useContactsSummaryCache } from '../../lib/contactsSummary';
import { calendarAccess, readCalendarSources, type CalendarAccess } from '../../lib/deviceCalendar';
import { getAmbiguousLinks } from '../../lib/contactLinks';
import { listDuplicateContacts } from '../../lib/contactMerge';
import { toast } from '../../lib/toast';

/**
 * SETTINGS. BEHIND THE GEAR, WHICH UNTIL NOW HAD NOTHING BEHIND IT.
 *
 *   "Move the following into the settings at the top, in the gear icon:
 *    Notifications, Contact Support, Delete Account, Sign Out, What Amber Tells
 *    You About, Notifications section, The Network and Connections section. The
 *    profile page ends after the 'What Amber Knows' section. Move the rest to
 *    the settings."
 *
 * EVERY SECTION HERE IS MOVED, NOT WRITTEN. It is the second half of
 * components/pages/ProfilePage.tsx, lifted with its queries, its mutations and
 * its copy intact, and the shared primitives it draws with now live in
 * components/profileParts.tsx so the two screens cannot drift apart. Nothing
 * about how contacts sync, how OAuth connects, or what delete-account does has
 * changed -- which is deliberate, because a move that also rewrites is a move
 * nobody can review.
 *
 * WHY THE PROFILE WAS WRONG. It had become two screens on one scroll: who you
 * are (your name, your circles, what Amber has learned) and then how the app is
 * configured (which accounts are connected, which notifications are on, sign
 * out, delete everything). The second half is the longest part and the part you
 * open twice a year, and it was sitting under the first, which is the part you
 * open to look at. A profile that ends with "delete your account" is not a
 * profile.
 *
 * THE GEAR WAS A MOCK. components/SharedHeader.tsx rendered it unconditionally
 * with a real accessibility label and no handler -- "just leave that as a blank
 * mock button for now. We'll build that out later." This is later.
 */

// ONLY WHAT ACTUALLY WORKS END TO END.
//
// Slack, Notion, Microsoft and X were listed here and rendered as live Connect buttons,
// but the OAuth flows behind them are not finished — so tapping one either dead-ended or
// looked like it had done something it had not. A connector that appears connectable and
// is not is worse than an absent one: it makes the user think their data is flowing when
// nothing is.
//
// Nothing was deleted to achieve this. The generic /v1/oauth/:platform init and disconnect
// endpoints, PlatformRow, and every handler below are untouched and platform-agnostic, so
// finishing a provider is a matter of putting its entry back in this array.
//
// Apple is not here on purpose: Apple Contacts is device-contacts sync (expo-contacts),
// not OAuth, and has its own row above with its own Sync action.
const OAUTH_PLATFORMS: { id: string; label: string; blurb: string }[] = [
  { id: 'google', label: 'Google', blurb: 'Calendar and Gmail so Amber prepares you for meetings.' },
];

const SUPPORT_EMAIL = 'team@joinrytual.com';

export function SettingsPage() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const qc = useQueryClient();

  // PROGRESS COMES FROM THE SHARED STORE, NOT FROM THIS SCREEN.
  //
  // The sync used to be an async function in a component's scope reporting into
  // local state, so leaving the page took the progress, the completion and the
  // error copy with it -- while the upload itself carried on invisibly. It lives
  // in lib/contactsSyncEngine and reports into lib/syncState, so this screen
  // renders a sync it does not own and can be left at any time.
  const syncState = useSyncState();
  const syncingContacts = syncState.status === 'syncing';
  const syncProgress =
    syncState.status === 'syncing' && syncState.total > 0
      ? { synced: syncState.synced, total: syncState.total }
      : null;
  /**
   * A SYNC THAT STOPPED MUST NEVER LOOK LIKE A SYNC THAT IS WORKING.
   *
   * "It's been syncing at 1,000 out of 1,179 forever, like 30 minutes now."
   *
   * It was not syncing. It had stopped, and this button had no way to say so:
   * `syncProgress` requires status === 'syncing', so on 'error' the label fell
   * all the way through to "Refresh" or, mid-resume, sat on a count that never
   * moved. Either way the only number on screen was a partial count with no
   * indication that nothing was going to change it.
   */
  const syncStopped =
    syncState.status === 'error' && syncState.total > 0 && syncState.synced < syncState.total
      ? { synced: syncState.synced, total: syncState.total }
      : null;
  // HOW MUCH OF THE ADDRESS BOOK iOS IS SHARING. null until a sync has looked.
  //
  // Worth a piece of state because 'limited' is invisible otherwise: permission
  // reports granted, every read succeeds, and the same handful of contacts syncs
  // forever while contacts he adds never appear.
  const [contactsAccess, setContactsAccess] = useState<ContactsAccess | null>(null);
  const contactsSummaryCache = useContactsSummaryCache();
  const syncedTotal = contactsSummaryCache?.total ?? 0;
  const hasSyncedContacts = syncedTotal > 0;
  const [busyPlatform, setBusyPlatform] = useState<string | null>(null);

  /**
   * CALENDARS, AND WHY THEY WERE UNFINDABLE.
   *
   *   "By the way, is the calendar syncing working? ... I don't see calendar
   *    syncing in the settings. I'm not really sure where that stuff is at now."
   *
   * It is working. lib/agendaApi's loadDay reads the phone's calendar database
   * for the day being shown, alongside the server, on every load -- so there is
   * no schedule to run and nothing to fall behind: iOS keeps that database
   * current for every account added in its own Settings, and Amber reads it
   * fresh each time. A sync job here would be a slower copy of something already
   * live.
   *
   * WHAT WAS BROKEN WAS THE DOOR. CalendarSyncSheet had exactly one entry point:
   * the empty-day prompt in components/DayAgenda, which by construction is gone
   * the moment the day has anything on it. So after the first note you could not
   * check whether calendars were connected, see which ones, or grant access if
   * you had said no the first time -- and CalendarSyncSheet's own header note
   * says the option was meant to "move to the settings area" once connected.
   * It never did. This is that.
   */
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [calAccess, setCalAccess] = useState<CalendarAccess | null>(null);
  const [calSources, setCalSources] = useState<{ title: string; account: string | null }[]>([]);

  const refreshCalendars = useCallback(async () => {
    const a = await calendarAccess();
    setCalAccess(a);
    setCalSources(a === 'granted' ? await readCalendarSources() : []);
  }, []);

  useEffect(() => {
    void refreshCalendars();
  }, [refreshCalendars]);

  const connectionsQuery = useQuery({
    queryKey: ['connections'],
    queryFn: async () => unwrapOrThrow(await fetchConnections()),
  });
  const conns = connectionsQuery.data ?? {};

  /**
   * POSSIBLE DUPLICATES, AND THE ROW IS ALWAYS HERE NOW.
   *
   *   "I also don't see the merge duplicates thing in the settings anymore...
   *    I'm not really sure where that stuff is at now."
   *
   * It was conditional on `duplicateCount > 0`, with a comment arguing that a
   * permanent row reading "0 duplicates" is a chore the app invented for itself.
   * That argument is right about the WORDING and wrong about the ROW: a feature
   * that appears only when the app has already decided there is work to do is a
   * feature you cannot find, cannot check, and cannot trust -- and the query
   * feeding it runs once, so a stale empty answer hid the row indefinitely.
   *
   * So the row is permanent and its subtitle says which of the three things is
   * true: still looking, nothing found, or here is what I found. Tapping it when
   * there is nothing re-checks rather than opening an empty sheet, which is the
   * "check now" that was missing.
   */
  const [duplicatesOpen, setDuplicatesOpen] = useState(false);
  const duplicatesQuery = useQuery({
    queryKey: ['contactDuplicates'],
    queryFn: async () => {
      const res = await listDuplicateContacts();
      return res.ok ? (res.data?.duplicates ?? []) : [];
    },
  });
  const duplicateCount = duplicatesQuery.data?.length ?? 0;

  // CARDS THAT MATCH MORE THAN ONE ACCOUNT, waiting on a human.
  //
  // The linker refuses to guess between two accounts a card's keys both resolve
  // to -- a shared family email, a number that changed hands -- because guessing
  // wrong hands that card's circles and shared notes to a stranger.
  const [ambiguousOpen, setAmbiguousOpen] = useState(false);
  const ambiguousQuery = useQuery({
    queryKey: ['contactAmbiguousLinks'],
    queryFn: async () => {
      const res = await getAmbiguousLinks();
      return res.ok ? (res.data?.ambiguous ?? []) : [];
    },
  });
  const ambiguousCount = ambiguousQuery.data?.length ?? 0;

  const oauthInit = useMutation({
    mutationFn: async (platform: string) => {
      setBusyPlatform(platform);
      return unwrapOrThrow(await api.oauthInit(platform)).authorize_url;
    },
    onSuccess: async (url) => {
      try {
        const result = await WebBrowser.openAuthSessionAsync(url, 'amber://oauth-callback');
        if (result.type === 'success' && result.url) {
          const status = result.url.match(/[?&]status=([^&]+)/)?.[1];
          const platform = result.url.match(/[?&]platform=([^&]+)/)?.[1] ?? 'Account';
          const pretty = platform.charAt(0).toUpperCase() + platform.slice(1);
          if (status === 'failed') {
            toast.error(`Could not connect ${pretty}.`, 'Try again.');
          } else {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
            toast.success(`${pretty} connected.`, 'Amber will start pulling in the next minute.');
          }
        }
      } catch {
        toast.error('Could not open browser', 'Try again in a moment.');
      } finally {
        qc.invalidateQueries({ queryKey: ['connections'] });
        qc.invalidateQueries({ queryKey: ['me'] });
      }
    },
    onError: (e) => toast.error('Could not connect', errorCopy(e)),
    onSettled: () => setBusyPlatform(null),
  });

  const oauthDisconnect = useMutation({
    mutationFn: async (platform: string) => {
      setBusyPlatform(platform);
      unwrapOrThrow(await api.oauthDisconnect(platform));
      return platform;
    },
    onMutate: async (platform) => {
      await qc.cancelQueries({ queryKey: ['connections'] });
      const previous = qc.getQueryData<Record<string, ConnectionRow>>(['connections']);
      if (previous?.[platform]) {
        qc.setQueryData<Record<string, ConnectionRow>>(['connections'], {
          ...previous,
          [platform]: { ...previous[platform], connected: false, needsScopeUpgrade: false },
        });
      }
      return { previous };
    },
    onSuccess: (platform) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      toast.success(`Disconnected ${platform}.`);
    },
    onError: (e, _platform, context) => {
      if (context?.previous) qc.setQueryData(['connections'], context.previous);
      toast.error('Could not disconnect', errorCopy(e));
    },
    onSettled: () => {
      setBusyPlatform(null);
      qc.invalidateQueries({ queryKey: ['connections'] });
    },
  });

  const deleteAccount = useMutation({
    mutationFn: async () => {
      unwrapOrThrow(
        await callMedhaId<{ ok: boolean }>({
          path: '/v1/account/delete',
          method: 'POST',
          body: { confirm: true },
          requireAuth: true,
          timeoutMs: 20_000,
        }),
      );
    },
    onSuccess: async () => {
      // Clear the session AND every other per-user device cache (offline write
      // queue, contacts summary), matching sign-out. Without the queue clear a
      // write the deleted user had pending could replay under the next account.
      await clearLocalUserData();
      qc.clear();
      toast.success('Account deleted.');
      router.replace('/(auth)/sign-in');
    },
    onError: (e) => toast.error('Could not delete account', errorCopy(e)),
  });

  // THE SCREEN ASKS FOR A SYNC. IT DOES NOT RUN ONE.
  //
  // The whole run lives in lib/contactsSyncEngine at module scope: progress goes
  // to the shared store, a checkpoint is written after every batch so an
  // interrupted sync resumes on the next foreground, and a second request joins
  // the run in progress instead of racing it.
  const syncContacts = useCallback(async () => {
    if (syncingContacts) return;
    const res = await startContactsSync();
    setContactsAccess(res.access);

    if (!res.ok) {
      if (res.access === 'none') {
        toast.error(
          'No contacts synced',
          'Allow Contacts access for Amber in Settings, then tap Sync again.',
        );
        return;
      }
      if (res.access === 'limited' && res.deviceTotal === 0) {
        toast.error(
          'No contacts synced',
          'iOS is only sharing a few selected contacts with Amber. Tap "Choose contacts" to add more.',
        );
        return;
      }
      // Stopped partway. The ground already taken is kept and the checkpoint is
      // on disk, so this is a pause rather than a loss.
      toast.error(
        res.sent > 0 ? 'Sync paused' : 'Sync failed',
        res.sent > 0
          ? `${formatCount(res.sent)} of ${formatCount(res.deviceTotal)} done. It will pick up where it left off.`
          : (res.errorMessage ?? 'Something interrupted the sync. Try again.'),
      );
      return;
    }

    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});

    if (res.failed > 0) {
      toast.error(
        'Some contacts did not save.',
        `${formatCount(res.inserted)} added, ${formatCount(res.failed)} could not be written. Tap Refresh to retry.`,
      );
    } else if (res.access === 'limited') {
      toast.success(
        'Contacts synced.',
        `${formatCount(res.inserted)} added from the contacts iOS is sharing with Amber. Tap "Choose contacts" to share more.`,
      );
    } else if (res.inserted === 0) {
      const skippedNote = res.skipped > 0 ? ` ${formatCount(res.skipped)} had no name.` : '';
      toast.success(
        'Already up to date.',
        `No new contacts in your ${formatCount(res.deviceTotal)} Apple contacts.${skippedNote}`,
      );
    } else {
      toast.success(
        `${formatCount(res.inserted)} new contact${res.inserted === 1 ? '' : 's'} added.`,
        `Nothing already in Amber was changed.`,
      );
    }

    qc.invalidateQueries({ queryKey: ['connections'] });
    qc.invalidateQueries({ queryKey: ['contacts'] });
  }, [syncingContacts, qc]);

  // OPEN iOS 18's CONTACT PICKER, then sync whatever he just shared.
  //
  // presentAccessPickerAsync resolves with the identifiers newly granted, so an
  // empty array means he opened it and shared nobody -- worth saying, because
  // otherwise the button looks like it did nothing. It rejects on iOS below 18
  // and on other platforms, which is the Settings fallback.
  const chooseMoreContacts = async () => {
    try {
      const added = await Contacts.presentAccessPickerAsync();
      if (added.length === 0) {
        toast.info('Nothing new shared.', 'Amber still sees the same contacts.');
        return;
      }
      await syncContacts();
    } catch {
      toast.error(
        'Could not open the picker',
        'Open Settings > Amber > Contacts and choose Full Access instead.',
      );
    }
  };

  const handleSignOut = async () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
    await signOut();
    // Drop every cached query before leaving the gated group. Without this the
    // next user to sign in on this device paints the previous user's profile,
    // contacts, and connections from cache while their own fetches are still in
    // flight. Matches what deleteAccount already does.
    qc.clear();
    toast.success('Signed out.');
    router.replace('/(auth)/sign-in');
  };

  const confirmDelete = () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
    Alert.alert(
      'Delete your account?',
      'This erases your profile, contacts, and everything Amber has learned. It cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete account', style: 'destructive', onPress: () => deleteAccount.mutate() },
      ],
    );
  };

  /** Re-check for duplicates, and open the sheet only if there is something in it. */
  const checkDuplicates = async () => {
    if (duplicateCount > 0) {
      setDuplicatesOpen(true);
      return;
    }
    const res = await duplicatesQuery.refetch();
    if ((res.data?.length ?? 0) > 0) {
      setDuplicatesOpen(true);
      return;
    }
    toast.success('No duplicates.', 'Every contact looks like one person.');
  };

  /**
   * SAY WHICH OF THE FOUR THINGS IS TRUE, and name the calendars.
   *
   * "Connected" on its own does not answer the question that was asked. The
   * count is what tells you the permission actually reached something, and the
   * denied case has to say where the switch is, because it is not in this app.
   */
  const calendarSub =
    calAccess === null
      ? 'Checking…'
      : calAccess === 'granted'
        ? calSources.length === 0
          ? 'Connected, but this phone has no calendars in it yet.'
          : `${calSources.length} calendar${calSources.length === 1 ? '' : 's'} on this phone: ${calSources
              .map((c) => c.title)
              .slice(0, 3)
              .join(', ')}${calSources.length > 3 ? '…' : ''}`
        : calAccess === 'denied'
          ? 'Off. Turn Calendars on for Amber in iOS Settings.'
          : 'Not connected — your meetings will not show on your day.';

  const duplicatesSub = duplicatesQuery.isLoading
    ? 'Looking…'
    : duplicateCount > 0
      ? `${duplicateCount} ${duplicateCount === 1 ? 'person looks' : 'people look'} like two cards`
      : 'None right now — tap to check again';

  return (
    <Screen padded={false} background="transparent" edges={[]}>
      <CHeader paddingTop={insets.top + 10} glass>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            paddingHorizontal: 4,
            paddingBottom: 10,
          }}
        >
          <Pressable
            onPress={() => router.back()}
            accessibilityRole="button"
            accessibilityLabel="Back"
            hitSlop={10}
          >
            {({ pressed }) => (
              <View
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 20,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: pressed ? cl.gold12 : 'rgba(255,255,255,0.42)',
                  borderWidth: 1,
                  borderColor: 'rgba(255,255,255,0.55)',
                }}
              >
                <ChevronLeft size={19} color="#605D5D" strokeWidth={1.9} />
              </View>
            )}
          </Pressable>
          <CText t="screenTitle" style={{ flex: 1 }} numberOfLines={1}>
            Settings
          </CText>
        </View>
      </CHeader>

      <ScrollView
        contentContainerStyle={{
          paddingTop: spacing.sm,
          /**
           * NOT clLayout.tabBarClearance, WHICH IS WHAT THIS INHERITED.
           *
           * That constant is 132 points, and it is 132 points because Home and
           * You have a floating tab pill hovering over their last row. This is a
           * PUSHED ROUTE -- components/TabBar is rendered only by
           * app/(gated)/home.tsx and app/(gated)/profile.tsx -- so there is
           * nothing down there to clear, and the clearance was a hundred-odd
           * points of empty page under Sign out. On a screen whose standing
           * complaint is whitespace, inheriting a constant is how you get it.
           */
          paddingBottom: insets.bottom + spacing.xxl,
          gap: clLayout.sectionGap,
        }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/*
          THREE SECTIONS, NAMED FOR WHAT THEY ARE.

            "I don't see the place to add multiple calendars or manage which
             calendars are connected. It should be very clear because there's a
             network section in settings and a connections section in settings,
             and I'm not too sure what is what or what's going on."

          He is right and the old names were the problem. "Network" held Apple
          Contacts sync and "Connections" held Google OAuth -- two words that
          both mean "the people and services you are hooked up to", sitting one
          above the other, distinguishable only by reading the cards inside
          them. And the word "connections" already means something else in this
          app: the people you are connected to on Amber, counted in the profile
          hero.

          So: CALENDARS, CONTACTS, CONNECTED APPS. Each named for the noun it
          contains, each with one sentence saying what it is for rather than a
          mood. The order is what you are most likely to have come here to
          change.
        */}
        <Section
          title="Calendars"
          subtitle="Your meetings, on your day. One permission covers every calendar account already on this phone."
        >
          <DCard>
            <View style={{ gap: 7 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                {calAccess === 'granted' ? (
                  <View
                    style={{
                      width: 20,
                      height: 20,
                      borderRadius: 10,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: cl.tint100,
                      borderWidth: HAIRLINE,
                      borderColor: cl.gold55,
                    }}
                  >
                    <Check size={12} color={cl.goldDeep} strokeWidth={3} />
                  </View>
                ) : null}
                <CText t="listTitle">
                  {calAccess === 'granted' ? 'Connected' : 'Not connected'}
                </CText>
              </View>
              <CText t="metaSm" color={cl.ink48}>
                {calendarSub}
              </CText>
              <View style={{ marginTop: spacing.sm }}>
                <SecondaryButton
                  label={calAccess === 'granted' ? 'Manage calendars' : 'Connect calendars'}
                  onPress={() => setCalendarOpen(true)}
                />
              </View>
            </View>
          </DCard>
        </Section>

        <Section
          title="Contacts"
          subtitle="Who Amber knows about. Names and numbers from your phone, and nothing else."
        >
          <DCard>
            <View style={{ gap: 7 }}>
              {/* DONE STATE, NOT A PERMANENT CALL TO ACTION. Once contacts are synced this
                  row used to keep offering the same "Sync contacts" button, which reads as
                  an unfinished step forever — you cannot tell whether it worked. A tick and
                  a count answer that, and Refresh is the honest name for what the action
                  actually does from then on: pick up Apple contacts added since. */}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                {hasSyncedContacts && !syncingContacts ? (
                  <View
                    style={{
                      width: 20,
                      height: 20,
                      borderRadius: 10,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: cl.tint100,
                      borderWidth: HAIRLINE,
                      borderColor: cl.gold55,
                    }}
                  >
                    <Check size={12} color={cl.goldDeep} strokeWidth={3} />
                  </View>
                ) : null}
                <CText t="listTitle">Apple Contacts</CText>
              </View>
              <CText t="metaSm" color={cl.ink48}>
                {syncStopped
                  ? `The sync stopped after ${formatCount(syncStopped.synced)} of ${formatCount(syncStopped.total)}. Nothing was lost — tap to pick up where it left off.`
                  : contactsAccess === 'limited'
                    ? 'iOS is only sharing the contacts you picked once. Anyone you add to your phone after that stays invisible to Amber until you share them.'
                    : hasSyncedContacts
                      ? `${formatCount(syncedTotal)} contacts synced. Refresh to pick up anyone you have added since.`
                      : 'Sync the contacts on your phone so Amber knows who is in your network. Names and numbers only, and you can re-sync anytime.'}
              </CText>
              <View style={{ marginTop: spacing.sm }}>
                <SecondaryButton
                  label={
                    syncProgress && syncProgress.total > 0
                      ? `Synced ${formatCount(syncProgress.synced)} of ${formatCount(syncProgress.total)}…`
                      : syncingContacts
                        ? 'Reading your contacts…'
                        : syncStopped
                          ? 'Resume sync'
                          : hasSyncedContacts
                            ? 'Refresh'
                            : 'Sync contacts'
                  }
                  loading={syncingContacts}
                  onPress={() => void syncContacts()}
                />
              </View>
              {/* THE WAY OUT OF LIMITED ACCESS, offered only once we know we are
                  in it. iOS 18's own picker, so he adds people without leaving
                  the app and without being sent to Settings to hunt for a
                  toggle. Newly shared contacts sync immediately afterwards. */}
              {contactsAccess === 'limited' ? (
                <View style={{ marginTop: spacing.xs }}>
                  <SecondaryButton
                    label="Choose contacts"
                    onPress={() => void chooseMoreContacts()}
                  />
                </View>
              ) : null}
            </View>
          </DCard>

          {/* MERGING DUPLICATES IS A CONTACTS JOB, and it was filed under
              "Account" -- beside Delete account and Contact support, which is
              where you look for things about your subscription, not for the two
              cards that are the same person. */}
          <View style={{ marginTop: clLayout.cardGap - 4 }}>
            <CCard flush>
            {/* PERMANENT, and the subtitle says which of the three things is true.
                  See the note on duplicatesQuery: a row that appears only when the
                  app has already decided there is work to do is a row you cannot
                  find and cannot trust. */}
              <CListRow
                first
                icon={<Merge size={17} color={cl.goldKicker} strokeWidth={1.7} />}
                title="Possible duplicates"
                sub={duplicatesSub}
                onPress={() => void checkDuplicates()}
                right={
                  duplicatesQuery.isFetching ? (
                    <ActivityIndicator size="small" color={cl.gold} />
                  ) : undefined
                }
              />
            </CCard>
          </View>
        </Section>

        <Section
          title="Connected apps"
          subtitle="Accounts Amber can read from. Separate from your Amber connections, which are people."
        >
          {connectionsQuery.isLoading ? (
            <View style={{ gap: clLayout.cardGap - 4 }}>
              <Block w="100%" h={80} radius={clRadius.card} />
              <Block w="100%" h={80} radius={clRadius.card} />
            </View>
          ) : connectionsQuery.isError ? (
            <DCard>
              <RetryRow
                label="Couldn't load connections."
                onRetry={() => connectionsQuery.refetch()}
              />
            </DCard>
          ) : (
            <View style={{ gap: clLayout.cardGap - 4 }}>
              {OAUTH_PLATFORMS.map((p) => (
                <PlatformRow
                  key={p.id}
                  label={p.label}
                  blurb={p.blurb}
                  status={conns[p.id]}
                  busy={busyPlatform === p.id}
                  onConnect={() => oauthInit.mutate(p.id)}
                  onDisconnect={() =>
                    Alert.alert('Disconnect?', `Amber will stop pulling from ${p.label}.`, [
                      { text: 'Cancel', style: 'cancel' },
                      {
                        text: 'Disconnect',
                        style: 'destructive',
                        onPress: () => oauthDisconnect.mutate(p.id),
                      },
                    ])
                  }
                />
              ))}
              {/* LinkedIn is NOT rendered: it depends on the Amber Chrome extension
                  capturing a desktop session, which is not shipped, so the row was three
                  setup steps the user cannot complete. PlatformRow is platform-agnostic —
                  restore the entry in OAUTH_PLATFORMS once the extension exists. */}
            </View>
          )}
        </Section>

        <Section
          title="Notifications"
          subtitle="Apple carries everything. iMessage carries reminders only."
        >
          <NotificationsSection />
        </Section>

        <Section
          title="Messaging"
          // NOT A SECOND COPY OF THE ROW ABOVE. The Notifications card's
          // "iMessage" is outbound -- may Amber text me. This is inbound -- may
          // a text act as me. Two headings because one word of difference is
          // not enough separation for two opposite blast radii.
          subtitle="Whether a text from your number is allowed to act as you."
        >
          <ImessageChannelSection />
        </Section>

        <Section
          title="What Amber tells you about"
          // The per-person half of this lives on each person's card ("Mute
          // notifications"), because the reason somebody wants silence is
          // usually one person rather than one kind of event.
          subtitle="Turn off a kind of notification without turning them all off. Mute one person from their card."
        >
          <NotificationCategoriesSection />
        </Section>

        <Section title="Account">
          {/* One grouped card, hairline-separated rows — mockup-2's settings list. */}
          <CCard flush>
            <CListRow
              first
              icon={<Bell size={17} color={cl.goldKicker} strokeWidth={1.7} />}
              title="Notifications"
              sub="Manage alerts in iOS Settings"
              onPress={() => Linking.openSettings().catch(() => {})}
            />
            {/* Only when there is something to decide. Nothing is broken while
                these wait -- the card is simply unlinked, which is the safe
                state, and there is no "check again" to offer because the server
                decides this, not a scan. */}
            {ambiguousCount > 0 ? (
              <CListRow
                icon={<Users size={17} color={cl.goldKicker} strokeWidth={1.7} />}
                title="Which person is this?"
                sub={`${ambiguousCount} ${
                  ambiguousCount === 1 ? 'card matches' : 'cards match'
                } more than one Amber account`}
                onPress={() => setAmbiguousOpen(true)}
              />
            ) : null}
            <CListRow
              icon={<LifeBuoy size={17} color={cl.goldKicker} strokeWidth={1.7} />}
              title="Contact support"
              sub="Get help with your account"
              onPress={() =>
                Linking.openURL(
                  `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('Amber account help')}`,
                ).catch(() => toast.error('No mail app', `Email us at ${SUPPORT_EMAIL}.`))
              }
            />
            {/* THE APP HAD NO LINK TO EITHER OF THESE ANYWHERE, and both are
                required: App Store Connect wants a privacy policy URL on the
                listing, and Guideline 1.2 wants terms reachable from inside an
                app whose users see what other users wrote. They open in the
                in-app browser rather than kicking the user out to Safari --
                leaving the app to read a policy and coming back to a cold start
                is a worse read of a document nobody wants to read anyway.

                The URLs come from lib/config.ts and default to medha-id, which
                serves both at these paths. There is deliberately no fallback
                here: a row that quietly does nothing is worse than no row. */}
            <CListRow
              icon={<ShieldCheck size={17} color={cl.goldKicker} strokeWidth={1.7} />}
              title="Reset AI and research permissions"
              sub="Ask again before new processing; saved notes stay available"
              onPress={() => void revokeProcessingConsent().then(() => toast.success('Processing permissions reset.')).catch(() => toast.error('Could not reset', 'Please try again.'))}
            />
            <CListRow
              icon={<ShieldCheck size={17} color={cl.goldKicker} strokeWidth={1.7} />}
              title="Privacy Policy"
              sub="What Amber holds, and what it does not"
              onPress={() =>
                WebBrowser.openBrowserAsync(privacyPolicyUrl).catch(() =>
                  Linking.openURL(privacyPolicyUrl).catch(() =>
                    toast.error('Could not open', 'Check your connection and try again.'),
                  ),
                )
              }
            />
            <CListRow
              icon={<FileText size={17} color={cl.goldKicker} strokeWidth={1.7} />}
              title="Terms of Service"
              sub="The agreement you are using Amber under"
              onPress={() =>
                WebBrowser.openBrowserAsync(termsUrl).catch(() =>
                  Linking.openURL(termsUrl).catch(() =>
                    toast.error('Could not open', 'Check your connection and try again.'),
                  ),
                )
              }
            />
            <CListRow
              danger
              icon={<Trash2 size={17} color="#B3402C" strokeWidth={1.7} />}
              title="Delete account"
              sub="Permanently erase your data"
              onPress={confirmDelete}
              right={
                deleteAccount.isPending ? (
                  <ActivityIndicator size="small" color="#B3402C" />
                ) : undefined
              }
            />
          </CCard>
        </Section>

        <View
          style={{
            marginHorizontal: clLayout.gutter,
            borderTopWidth: HAIRLINE,
            borderTopColor: cl.ruleFaint,
            paddingTop: spacing.lg,
          }}
        >
          <Pressable
            onPress={() => void handleSignOut()}
            accessibilityRole="button"
            accessibilityLabel="Sign out"
            style={{ alignSelf: 'center' }}
          >
            {({ pressed }) => (
              <View
                style={{
                  paddingHorizontal: spacing.lg,
                  paddingVertical: spacing.sm,
                  opacity: pressed ? 0.6 : 1,
                }}
              >
                <CText t="listTitle" color={LIGHT.danger} style={{ letterSpacing: 0.2 }}>
                  Sign out
                </CText>
              </View>
            )}
          </Pressable>
          {__DEV__ ? (
            <Pressable
              onPress={() => router.push('/(gated)/onboarding')}
              accessibilityRole="button"
              accessibilityLabel="Preview onboarding"
              style={{ alignSelf: 'center', marginTop: spacing.sm }}
            >
              {({ pressed }) => (
                <View
                  style={{
                    paddingHorizontal: spacing.lg,
                    paddingVertical: spacing.sm,
                    opacity: pressed ? 0.6 : 1,
                  }}
                >
                  <CText t="listTitle" color="#B68235" style={{ letterSpacing: 0.2 }}>
                    Preview onboarding (dev)
                  </CText>
                </View>
              )}
            </Pressable>
          ) : null}
          {/* Which JS bundle this is, and when it was published. See
              components/BuildStamp -- this exists because "I don't see the
              changes" was unanswerable from inside the app three times over. */}
          <BuildStamp />
        </View>
      </ScrollView>

      {/* One permission, every account the phone already has. See the header of
          CalendarSyncSheet for why this is not a row of provider logos. */}
      <CalendarSyncSheet
        visible={calendarOpen}
        onClose={() => {
          setCalendarOpen(false);
          // Access can have changed while the sheet was open -- including in iOS
          // Settings, if they left and came back -- so the row re-reads it rather
          // than trusting what it said when the screen loaded.
          void refreshCalendars();
        }}
        onConnected={() => {
          void refreshCalendars();
          // Every cached day was assembled without a calendar, so the whole
          // prefix goes rather than just today's.
          void qc.invalidateQueries({ queryKey: ['agenda'] });
        }}
      />

      {/* Two cards for one person, offered rather than collapsed. */}
      <DuplicateContactsSheet
        visible={duplicatesOpen}
        onClose={() => setDuplicatesOpen(false)}
        onMerged={() => {
          void duplicatesQuery.refetch();
          // The People list is one card shorter now.
          qc.invalidateQueries({ queryKey: ['contacts'] });
        }}
      />

      {/* One card, two accounts, and only a person can say which. */}
      <AmbiguousLinksSheet
        visible={ambiguousOpen}
        links={ambiguousQuery.data ?? []}
        loading={ambiguousQuery.isLoading}
        onClose={() => setAmbiguousOpen(false)}
        onResolved={() => {
          void ambiguousQuery.refetch();
          // The card now belongs to an account, which changes what the People
          // list and anything reading a link can resolve.
          qc.invalidateQueries({ queryKey: ['contacts'] });
        }}
      />
    </Screen>
  );
}
