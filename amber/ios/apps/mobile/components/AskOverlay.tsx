import { useEffect, useRef, useState } from 'react';
import { Animated, Modal, StyleSheet, View } from 'react-native';
import { Pressable } from './Pressable';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { X } from 'lucide-react-native';
import { ChatProvider, useChat } from '../lib/ChatContext';
import { useLiveTurn } from '../lib/liveTurn';
import { LOCAL_NOTE_PREFIX } from '../lib/pendingNote';
import { AskChat } from './AskChat';
import { SearchDock } from './SearchDock';
import { VoiceNoteRecorder } from './VoiceNoteRecorder';
import { submitAsk } from '../lib/askBridge';
import { stageMessageClip, clearMessageClip } from '../lib/pendingMessageClip';
import { ClassicalGround, CText } from './classical';
import { GlassSurface } from './LiquidGlass';
import { LIGHT } from '../lib/theme';
import { spacing } from '../lib/tokens';

// THE ASK SURFACE. One head, reachable from two tabs, isolated from capture.
//
// This opens two ways and they are the same surface either way:
//   - expanding a voice note on Today, which loads that note's thread
//   - typing a question into the shared bar on Today or on Profile
//
// It is its OWN chat head -- a nested ChatProvider -- and that isolation is the
// load-bearing part, not a detail. The tree above this one is the `publishLive`
// provider that owns voice-note capture. Folding Ask into it would put your
// recorded notes and your questions in one context, which is how a note you
// spoke ends up appended to a question you typed. The Ask page in the People tab
// used to be a separate head for exactly this reason; People has one page now, so
// that head moved here rather than being merged into Home's.
//
// It fades in and cuts away rather than sliding, and the title sits on a
// translucent banner that fades the content under it instead of a hard edge.
function AskInner({
  conversationId,
  initialAsk,
  onClose,
  openPerson,
}: {
  conversationId: string | null;
  /** A question typed into the shared bar. Mutually exclusive with a note id in
   *  practice: you either opened a note or you asked something. */
  initialAsk?: string;
  onClose: () => void;
  openPerson: (id: string) => void;
}) {
  const { openConversation, adoptLiveTurn, turns, streaming } = useChat();
  const insets = useSafeAreaInsets();

  // ── SPEAKING A FOLLOW-UP ─────────────────────────────────────────────────
  //
  // The bar here had no record button, with this reasoning in the comment
  // below: "this sits over the whole stack, and a recording started from behind
  // it is one nobody can see or stop." That was true of the GLOBAL recorder --
  // home.tsx mounts it under this overlay -- and the conclusion was wrong. The
  // answer is not to withhold the button, it is to own the recorder here, where
  // it is on top of this surface and can be seen and stopped.
  //
  // VoiceNoteRecorder is a Modal, so mounted inside this tree it draws above
  // the overlay rather than behind it. It hands back the transcript, which goes
  // straight to the same submitter the typed field uses -- so a spoken follow-up
  // and a typed one are the same turn, in the same thread, with no second code
  // path to keep in step.
  const [recording, setRecording] = useState(false);

  // A note whose id is still the local stand-in has no thread on the server yet,
  // so asking for one would replace the mirrored turn with an empty history. A
  // FRESH ASK has no id at all, which takes the same branch for the same reason:
  // there is nothing on the server to load or poll for, and doing either would
  // wipe the turn this surface is about to create.
  const isLocal = !conversationId || conversationId.startsWith(LOCAL_NOTE_PREFIX);

  useEffect(() => {
    if (conversationId && !isLocal) void openConversation(conversationId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, isLocal]);

  // MIRROR THE STREAM INSTEAD OF WAITING FOR THE DATABASE.
  //
  // The note being opened is very often still generating in the provider that owns
  // the recording. Server history cannot show that — there is no assistant row
  // until the reply finishes — so this reads the live turn straight from the tree
  // that owns it. Tapping a note now shows whatever has arrived so far, usually
  // most of the answer, instead of a spinner over an empty page.
  //
  // adoptLiveTurn decides precedence, and it lets stored history win the moment
  // history has content, so a name corrected after the fact is never overwritten
  // by the pre-correction copy sitting in the live store.
  const live = useLiveTurn(conversationId);
  useEffect(() => {
    if (live) adoptLiveTurn(live);
  }, [live, adoptLiveTurn]);

  // THE FALLBACK POLL, for when mirroring cannot help: the app was relaunched
  // while the reply was generating, so the stream belongs to a process that no
  // longer exists and only the server has the answer.
  //
  // THIS USED TO CANCEL ITSELF AFTER ONE TRY. The ladder was four timers scheduled
  // inside an effect that listed `turns` in its dependencies — and openConversation
  // always calls setTurns with a fresh array. So the first refetch changed `turns`,
  // React ran the cleanup, the cleanup cleared timers two, three and four, and the
  // re-run hit a `retriedRef` guard and did nothing. Exactly one attempt, at 900ms,
  // against an answer that lands around nine seconds. That is the whole reason the
  // sheet had to be closed and reopened to see a reply.
  //
  // So the loop now lives in a ref-held interval keyed on the conversation, where
  // a `turns` update cannot reach it. It reads the latest turns through a ref, and
  // it stops itself the moment there is anything to show.
  const turnsRef = useRef(turns);
  turnsRef.current = turns;
  // NEVER POLL OVER A LIVE SEND. openConversation aborts this provider's in-flight
  // request, so a tick that landed while the user was waiting on a question they
  // typed here would kill that answer mid-sentence and replace it with history that
  // does not contain it yet. This is the failure the previous implementation's
  // comment describes; the guard is what actually prevents it.
  const streamingRef = useRef(streaming);
  streamingRef.current = streaming;
  useEffect(() => {
    if (!conversationId || isLocal) return undefined;
    let tries = 0;
    const settled = () => {
      const last = turnsRef.current[turnsRef.current.length - 1];
      if (!last) return false; // nothing at all yet — keep polling
      return (
        !!last.result?.answer ||
        (last.captured?.length ?? 0) > 0 ||
        (last.clarify?.length ?? 0) > 0 ||
        (last.softConfirm?.length ?? 0) > 0 ||
        last.status === 'error'
      );
    };
    // Every 1.5s for 30s. Generous because the alternative — what shipped — is a
    // note that never fills in at all, and cheap because it stops on first content.
    const id = setInterval(() => {
      if (streamingRef.current) return; // a live send owns this provider right now
      tries += 1;
      if (settled() || tries > 20) {
        clearInterval(id);
        return;
      }
      void openConversation(conversationId);
    }, 1500);
    return () => clearInterval(id);
  }, [conversationId, isLocal, openConversation]);

  // The note loads a beat after the overlay appears; rather than let the text
  // pop in, fade the whole transcript up once it is ready so it arrives as one
  // smooth motion.
  const contentOpacity = useRef(new Animated.Value(0)).current;
  // A fresh ask is ready the moment it opens: its first turn appears from the
  // question, not from a fetch, and gating the fade on `turns.length` held the
  // whole surface at zero opacity until the answer's first token landed.
  const ready = turns.length > 0 || !!initialAsk;
  useEffect(() => {
    Animated.timing(contentOpacity, {
      toValue: ready ? 1 : 0,
      duration: 280,
      useNativeDriver: true,
    }).start();
  }, [ready, contentOpacity]);

  return (
    <View style={{ flex: 1 }}>
      <Animated.View style={{ flex: 1, opacity: contentOpacity }}>
        <AskChat
          // Opening a person from inside the overlay must close the overlay
          // first, otherwise the person screen is pushed BEHIND this modal and
          // you can't see it until you dismiss. Close → then navigate.
          onOpenPerson={(id) => {
            onClose();
            setTimeout(() => openPerson(id), 60);
          }}
          hideNewChat
          hideEmpty
          tabBarClear={false}
          topInset={insets.top + 70}
          initialAsk={initialAsk}
          // NO `showComposer` PROP ANY MORE, because AskChat no longer has a
          // composer to switch off. It carried a whole second bar behind that
          // flag -- its own shell, field, placeholder and keyboard offset -- and
          // `false` here was the only value it was ever passed anywhere in the
          // app, so it never rendered. It is deleted rather than defaulted: one
          // bar means one implementation of the bar. See the note where it used
          // to be in AskChat, and lib/searchModes.
        />
      </Animated.View>

      {/* Translucent banner: a soft fade from the ground color down to clear so
          the transcript dissolves under the title rather than meeting a line. */}
      <LinearGradient
        // Cream, matching the ground's own top tone. This was the old near-white
        // #FBFAFB, which over a gold field read as a gray shelf across the top of
        // the overlay rather than the page fading under its title.
        colors={['#FDFAF0', 'rgba(253,250,240,0.82)', 'rgba(253,250,240,0)']}
        locations={[0, 0.6, 1]}
        pointerEvents="none"
        style={{ position: 'absolute', top: 0, left: 0, right: 0, height: insets.top + 76 }}
      />
      <View
        style={{
          position: 'absolute',
          top: insets.top + 6,
          left: spacing.lg,
          right: spacing.lg,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <CText t="screenTitle">Voice Chat</CText>
        {/* No New chat here: a note's Ask is specific to that line of thought.
            For a fresh chat, use the Ask in the People tab. */}
        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close"
          hitSlop={10}
          style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
        >
          {/* REAL GLASS, and this one is safe to glass. Frosted glass samples what
              is behind it, which is why the sheets that sit over a dimmed backdrop
              are deliberately left opaque — glass there resolved to a murky panel
              under the keyboard. This button floats over ClassicalGround with no
              scrim anywhere near it, and it holds an icon rather than text, so
              there is nothing for a translucent surface to make harder to read.
              The fallback keeps today's exact fill and rim on iOS < 26. */}
          <GlassSurface
            glassStyle="clear"
            tintColor="rgba(255,255,255,0.28)"
            style={{
              width: 40,
              height: 40,
              borderRadius: 20,
              alignItems: 'center',
              justifyContent: 'center',
              borderWidth: 1,
              // borderColor belongs on the SHARED style, not the fallback. A
              // borderWidth with no color defaults to BLACK, so leaving it out of
              // the glass path draws a black ring around the button on exactly the
              // OS the glass is for.
              borderColor: 'rgba(255,255,255,0.6)',
              overflow: 'hidden',
            }}
            fallbackStyle={{ backgroundColor: 'rgba(255,255,255,0.5)' }}
          >
            <X size={20} color={LIGHT.textSecondary} strokeWidth={2} />
          </GlassSurface>
        </Pressable>
      </View>

      {/* THE SAME BAR THAT IS ON HOME AND ON THE PROFILE, and it was missing
          from here entirely.
          AskChat is mounted with showComposer={false} on the reasoning that
          "the bar is global now" — but the global one is rendered by home.tsx
          BEFORE this overlay, so this surface covered the very bar it was
          relying on. Opening a note lost the Ask field, the web search, the
          network search, all of it.
          The fix is not to give this surface a composer of its own — that was
          the arrangement before, and two bars styled to match is what
          lib/searchModes exists to have stopped. It is the same COMPONENT,
          mounted here, publishing through the same lib/askBridge that AskChat
          already registers its submitter on. The recorder button IS here now,
          and the recorder it opens is mounted in this tree (see `recording`
          above) rather than being the global one sitting behind this surface --
          which is what the old comment here was right to refuse.
          Resting position is the default on purpose — AskChat's `dockReserve`
          already pads the transcript by exactly peopleBarBottom + PEOPLE_BAR_H
          when it owns no composer, so the default is the one number the two
          already agree on. */}
      <SearchDock
        mode="ask"
        onAsk={submitAsk}
        onRecord={() => setRecording(true)}
      />

      {/* Above this overlay, because a Modal renders in its own native
          hierarchy -- so it is visible, and the same tap that starts it stops
          it.

          AND THE AUDIO IS KEPT NOW, not only the words. The old note here said
          it could not be: media_assets held one clip per conversation, and that
          one belongs to the note this thread already is. It holds one per
          MESSAGE as well since migration 037, so a spoken follow-up saves the
          recording and shows it with the transcript underneath -- which is what
          was asked for.

          The clip is staged rather than uploaded here, because it attaches to a
          message row that does not exist until the request is in flight. The
          stream hands back its id (`user_message`) and ChatContext does the
          upload; see lib/pendingMessageClip for why it is matched on the text. */}
      <VoiceNoteRecorder
        visible={recording}
        title="Ask out loud"
        onCancel={() => {
          setRecording(false);
          // A cancelled recording must not leave a clip waiting to attach
          // itself to whatever is typed next.
          clearMessageClip();
        }}
        onDone={(transcript, _scope, media) => {
          setRecording(false);
          const t = (transcript ?? '').trim();
          if (!t) return;
          if (media?.uri) {
            stageMessageClip({
              uri: media.uri,
              durationMs: media.durationMs,
              peaks: media.peaks,
              transcript: t,
            });
          }
          submitAsk(t);
        }}
      />
    </View>
  );
}

export function AskOverlay({
  visible,
  conversationId,
  initialAsk,
  onClose,
  openPerson,
}: {
  visible: boolean;
  /** A stored note to load, or null for a fresh question. */
  conversationId: string | null;
  /** The question that opened this, when it was opened by the bar. */
  initialAsk?: string;
  onClose: () => void;
  openPerson: (id: string) => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={StyleSheet.absoluteFill}>
        <ClassicalGround />
        {visible ? (
          <ChatProvider>
            <AskInner
              conversationId={conversationId}
              initialAsk={initialAsk}
              onClose={onClose}
              openPerson={openPerson}
            />
          </ChatProvider>
        ) : null}
      </View>
    </Modal>
  );
}
