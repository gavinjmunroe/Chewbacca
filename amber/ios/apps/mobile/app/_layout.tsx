import { requestCardImport, requestVCardImport } from '../lib/cardImportIntent';
import { useFonts } from 'expo-font';
// TWO FAMILIES, NOT FOUR. This was Fraunces for display, Lora for reading copy
// and Hanken Grotesk for labels -- three serif/sans roles across three packages,
// which is more voices than a screen this quiet needs. Newsreader carries every
// serif role now (it is a reading serif, so it holds a headline and a paragraph
// equally well) and Outfit carries every grotesk one: labels, buttons, meta.
// The role names in lib/tokens.ts did not change, so nothing downstream knows.
import {
  Newsreader_400Regular,
  Newsreader_400Regular_Italic,
  Newsreader_500Medium,
  Newsreader_600SemiBold,
  Newsreader_700Bold,
} from '@expo-google-fonts/newsreader';
import {
  Outfit_400Regular,
  Outfit_500Medium,
  Outfit_600SemiBold,
  Outfit_700Bold,
} from '@expo-google-fonts/outfit';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { Stack, useRouter, type Href } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import * as Linking from 'expo-linking';
import { requestConnect } from '../lib/pendingConnect';
import * as Notifications from 'expo-notifications';
import { useEffect, useRef } from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, initialWindowMetrics } from 'react-native-safe-area-context';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { AuthGate } from '../components/AuthGate';
import { RouteErrorBoundary } from '../components/RouteErrorBoundary';
import { ToastHost } from '../components/ToastHost';
import { hasSession } from '../lib/auth';
import { QuickActionsBridge } from '../lib/quickActions';
import { RecordDeepLinkBridge } from '../lib/recordDeepLink';
import { queryClient } from '../lib/queryClient';
import { toast } from '../lib/toast';
import { LIGHT } from '../lib/theme';
import '../global.css';

SplashScreen.preventAutoHideAsync().catch(() => {});

// expo-router picks up a named `ErrorBoundary` export per route file. At the
// root this is the last line of defense: without it a render throw anywhere
// outside the gated group (sign-in, the router itself) unmounts to a white
// screen with no way back.
export { RouteErrorBoundary as ErrorBoundary };

// Foreground notifications should still surface a banner + list entry and play
// a sound; badges are managed elsewhere.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

// Two links land here.
//
//   amber://oauth-callback?platform=google&status=connected|failed
//     medha-id's OAuth callback handlers redirect into the custom scheme; we
//     invalidate the connections query and toast.
//
//   amber://connect?u=<username>   (also .../connect/<username>)
//     A shared profile link. medha-id's public GET /u/:username page redirects here
//     (see src/routes/connect-link.js in that repo). This function only PARKS the
//     intent, because it can run before a session exists — on a cold start the URL
//     arrives before auth is read, and the recipient may not even have an account yet.
//     ConnectLinkBridge, mounted inside the gated group, is what acts on it.
function handleDeepLink(url: string, qc: QueryClient) {
  try {
    if(url.startsWith('file:')){requestVCardImport(url);return;}
    const parsed = Linking.parse(url);
    if(parsed.hostname==='import-card' || parsed.path==='import-card'){const token=parsed.queryParams?.token;if(typeof token==='string')requestCardImport(token);return;}

    // ── the shared profile link ───────────────────────────────────────────────────
    const host = (parsed.hostname ?? '').toLowerCase();
    const path = (parsed.path ?? '').replace(/^\/+/, '');
    const isConnect = host === 'connect' || path === 'connect' || path.startsWith('connect/');
    if (isConnect) {
      // Accept the username from the query (`?u=name`) or the path (`/connect/name`),
      // because both shapes are easy to produce by hand and there is no reason to be
      // strict about which one a link uses.
      const fromQuery = parsed.queryParams?.u;
      const fromPath = host === 'connect' ? path : path.replace(/^connect\/?/, '');
      const raw = typeof fromQuery === 'string' && fromQuery ? fromQuery : fromPath;
      const username = String(raw ?? '').trim().replace(/^@+/, '');
      // Validated here as well as server-side: this value goes into an API path, and a
      // link is attacker-supplied no matter how friendly the page that produced it.
      if (/^[a-zA-Z0-9._-]{1,40}$/.test(username)) requestConnect(username);
      return;
    }

    // ── the OAuth callback ────────────────────────────────────────────────────────
    const isCallback = parsed.hostname === 'oauth-callback' || parsed.path === 'oauth-callback';
    if (!isCallback) return;
    const platform = (parsed.queryParams?.platform as string | undefined) ?? 'platform';
    const status = (parsed.queryParams?.status as string | undefined) ?? 'connected';
    const pretty = platform.charAt(0).toUpperCase() + platform.slice(1);
    if (status === 'connected') {
      toast.success(`${pretty} connected.`, 'Amber will start pulling in the next minute.');
    } else {
      toast.error(`Could not connect ${pretty}.`, 'Try again, or remove the app and reconnect.');
    }
    qc.invalidateQueries({ queryKey: ['connections'] });
  } catch {
    /* ignore malformed link */
  }
}

function DeepLinkBridge() {
  const qc = useQueryClient();
  useEffect(() => {
    Linking.getInitialURL().then((url) => {
      if (url) handleDeepLink(url, qc);
    });
    const sub = Linking.addEventListener('url', ({ url }) => handleDeepLink(url, qc));
    return () => sub.remove();
  }, [qc]);
  return null;
}

// Where a notification's payload says to go. Pure, so the routing table is one
// readable thing and not spread through an async handler.
function destinationForNotification(data: Record<string, unknown> | undefined): Href | null {
  const type = typeof data?.type === 'string' ? data.type : '';
  if (!type) return null;
  const str = (k: string) => (typeof data?.[k] === 'string' ? (data[k] as string) : '');
  switch (type) {
    case 'question': {
      const threadId = str('threadId');
      return threadId ? `/(gated)/questions/${threadId}` : '/(gated)/home?tab=today';
    }
    case 'circle': {
      const circleId = str('circleId');
      // Straight to the circle when we know which one; otherwise the Circles page,
      // NOT Today — landing on Today after "you were added to a circle" leaves the
      // user to go find it.
      // Circles live on Profile now, not in their own tab. `tab=circles` is
      // still accepted by home's tabToIndex (it maps to You) so older
      // notifications already in flight keep landing somewhere sensible, but new
      // links say where they mean.
      return circleId ? `/(gated)/circle/${circleId}` : '/(gated)/home?tab=you';
    }
    case 'dm': {
      // A direct message. The thread is not a route -- it is a layer inside the
      // Messages panel, which is itself a layer over Home, because all of it
      // lives inside a horizontal pager and pushing a route from inside one
      // loses the pager's position (see components/MessagesPanel).
      //
      // `tab=messages` opens the panel. `tab=people` still does the same thing
      // and is what every notification already in flight says -- home's
      // wantsMessages() accepts all three spellings -- but new links say what
      // they mean, because People is not a tab any more.
      const threadId = str('threadId');
      return threadId
        ? `/(gated)/home?tab=messages&dm=${encodeURIComponent(threadId)}`
        : '/(gated)/home?tab=messages';
    }
    case 'connection':
      // The body of this push says "open Amber to accept", so it has to land on the
      // screen with the Accept button. It used to land on Home's Today page, one
      // tab away from the request it was telling you about.
      return '/(gated)/connect';
    case 'note':
    case 'share':
      // A note or an item shared WITH you appears in the network feed on Today.
      // Passing the tab explicitly matters: tabToIndex(undefined) happens to
      // default to Today, and relying on that is how a later default change
      // silently breaks every one of these taps.
      return '/(gated)/home?tab=today';
    case 'reminder': {
      // A locally-scheduled reminder, and this case used to be a dead end:
      // "nothing to open but the day it is about", which is why tapping "call
      // Sagar at 7:30" opened the app onto Today and left the user to go and
      // find both the reminder and the person.
      //
      // The payload carries ids now (lib/reminders.ts schedules them), so:
      //   the reminder itself, which is the thing the banner was about and
      //   which holds the person's card, the time and the line Amber heard;
      //   failing that the person, when the reminder named one;
      //   failing both, the day, as before.
      const reminderId = str('reminderId');
      if (reminderId) {
        return `/(gated)/home?tab=today&reminder=${encodeURIComponent(reminderId)}`;
      }
      const contactId = str('contactId');
      if (contactId) return `/(gated)/person/${contactId}`;
      return '/(gated)/home?tab=today';
    }
    default:
      // An unknown future type still opens something rather than nothing.
      return '/(gated)/home?tab=today';
  }
}

// A session may not be readable the instant a cold start finishes: the token is
// still coming off disk. Returning early there is why a tapped notification
// opened the app and then went nowhere. Wait a few beats instead of dropping the
// user's tap on the floor.
async function waitForSession(timeoutMs = 6000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await hasSession().catch(() => false)) return true;
    if (Date.now() >= deadline) return false;
    await new Promise((r) => setTimeout(r, 250));
  }
}

// Route a tapped notification to its destination.
//
// TWO BUGS MADE THIS A FLICKERING BLANK SCREEN THAT NEVER LANDED.
//
// 1. The effect depended on [router]. expo-router's router is not a stable
//    object identity across renders, so the effect re-ran on every render — and
//    every re-run called getLastNotificationResponseAsync again, which keeps
//    returning the SAME launch tap for the whole process lifetime. So it pushed,
//    the push rendered, the effect re-ran, it pushed again: a navigation loop,
//    which is exactly what rapid on/off flicker looks like. The effect now runs
//    once with no dependencies and reaches the router through a ref.
//
// 2. `if (!(await hasSession())) return` dropped the tap when the session was
//    not yet readable, which on a cold start is most of the time. Now it waits.
//
// A tap is also acted on at most once per notification id, so a warm tap that is
// delivered to both the listener and a later cold-start read cannot double-push.
function NotificationBridge() {
  const router = useRouter();
  // Latest router without making it a dependency — see (1) above.
  const routerRef = useRef(router);
  routerRef.current = router;
  const handledRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    const handle = async (response: Notifications.NotificationResponse | null) => {
      if (!response || cancelled) return;
      const request = response.notification.request;
      const data = request.content.data as Record<string, unknown> | undefined;
      const destination = destinationForNotification(data);
      if (!destination) return;
      // Identify the tap, not the payload: two circle invites must both work,
      // but one invite tapped once must not navigate twice.
      const id = request.identifier || `${destination}:${JSON.stringify(data ?? {})}`;
      if (handledRef.current.has(id)) return;
      handledRef.current.add(id);
      if (!(await waitForSession())) return;
      if (cancelled) return;
      // navigate, not push. Every unrecognised destination resolves to
      // "/(gated)/home?tab=today", so a warm tap while already on Home pushed a
      // SECOND Home onto the stack: the pager reset to its initial page and a back
      // swipe revealed the previous copy. navigate dedupes by route, which is what
      // lib/quickActions already does for the same reason.
      routerRef.current.navigate(destination);
    };
    // Cold start: the tap that launched the app.
    void Notifications.getLastNotificationResponseAsync().then(handle);
    // Warm taps while the app is running or backgrounded.
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      void handle(response);
    });
    return () => {
      cancelled = true;
      sub.remove();
    };
    // Deliberately EMPTY. router is reached through routerRef precisely so it
    // cannot be a dependency: a re-run re-reads the launch notification and
    // navigates again, which is the loop this replaced.
  }, []);
  return null;
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    Newsreader_400Regular,
    Newsreader_400Regular_Italic,
    Newsreader_500Medium,
    Newsreader_600SemiBold,
    Newsreader_700Bold,
    Outfit_400Regular,
    Outfit_500Medium,
    Outfit_600SemiBold,
    Outfit_700Bold,
  });

  useEffect(() => {
    if (fontsLoaded) {
      SplashScreen.hideAsync().catch(() => {});
    }
  }, [fontsLoaded]);

  if (!fontsLoaded) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: LIGHT.canvas }}>
    {/*
      THE KEYBOARD IS TRACKED NATIVELY, FRAME BY FRAME, FROM HERE DOWN.

      "It seems like every single platform has this linking done very well,
       where you press the search bar, and the keyboard seems attached to it and
       comes up. It's not like a separate entity that relies on it... they should
       be linked as the same object."

      That was the right diagnosis and it is why four versions of a timing-based
      lift all felt wrong. This provider hooks iOS's ACTUAL keyboard animation
      and publishes its position as a Reanimated shared value updated every
      frame -- not a duration we match, not a curve we imitate, the real frame of
      the real keyboard. Anything driven by it is moving with the keyboard rather
      than alongside it, including an interactive drag-to-dismiss, which no
      notification-driven version could follow at all.

      AT THE ROOT, ABOVE EVERYTHING, because it must outlive every screen and be
      mounted exactly once -- see scripts/keyboard-check.mts. lib/useKeyboardLift
      is the only thing that reads it directly.
    */}
    <KeyboardProvider>
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <QueryClientProvider client={queryClient}>
        <DeepLinkBridge />
        <NotificationBridge />
        {/* Home Screen quick action ("New voice note") launch handling. Mounts
            once here where the router is ready; auth-gates internally so it never
            auto-records for a signed-out launch. */}
        <QuickActionsBridge />
        {/* Deep-link "start recording" (amber://record) launch handling. The
            bridge the Action Button (via a user Shortcut) and future widgets
            fire into. Mounts once here alongside the quick-action bridge; reuses
            the exact same external-entry recording path and auth-gates internally
            so it never auto-records for a signed-out launch, and only acts on the
            record intent — other amber:// URLs pass through untouched. */}
        <RecordDeepLinkBridge />
        <AuthGate>
          <Stack
            // Was a hardcoded '#EAE5D8' (the old cream). Pointed at the token so
            // the router's screen background tracks the ground instead of
            // flashing the previous palette between screens.
            screenOptions={{ headerShown: false, contentStyle: { backgroundColor: LIGHT.canvas } }}
          />
        </AuthGate>
        <ToastHost />
        <StatusBar style="dark" />
      </QueryClientProvider>
    </SafeAreaProvider>
    </KeyboardProvider>
    </GestureHandlerRootView>
  );
}
