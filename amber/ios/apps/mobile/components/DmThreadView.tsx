import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Share,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { enterFullscreenLayer } from '../lib/fullscreenLayer';
import { TapbackBadges, TapbackPicker } from './Tapbacks';
import { Pressable } from './Pressable';
import {
  ArrowUp,
  ChevronLeft,
  Pin,
  Search,
  Settings2,
  Trash2,
  Ban,
  Download,
  Flag,
  X,
} from 'lucide-react-native';
import { CText } from './classical';
import { cl } from '../lib/classical';
import { VoiceNotePlayer } from './VoiceNotePlayer';
import { VoiceNoteRecorder } from './VoiceNoteRecorder';
import { toast } from '../lib/toast';
import { type ReactionKind } from '../lib/noteMedia';
import {
  clearDmThread,
  exportDmThread,
  getDmAudio,
  pinDmMessage,
  searchDmThread,
  sendDmText,
  sendDmVoice,
  setDmBlock,
  setDmReaction,
  useDmConversation,
  type DmMessage,
  type DmPerson,
} from '../lib/dms';
import { DmInfoPanel, type DmInfoTheme } from './DmInfoPanel';
import { ReportSheet } from './ReportSheet';

// One direct-message thread, in the Circles visual language: the same #FFFCF8
// card fill, rgba(178,98,45,0.15) edges, terracotta accents and 34pt control
// rhythm the circle feed uses.
//
// THE COMPOSER IS THE SHAPE THAT WAS ASKED FOR: the voice control is a circle
// with a dot inside on the LEFT, the field is in the middle, and send is on the
// RIGHT. A voice memo posts as its full recording with the transcription
// underneath it, which is the same pairing the circle feed already draws.

const CARD_BG = '#FFFCF8';
const CARD_BORDER = 'rgba(178,98,45,0.15)';
const MINE_BG = 'rgba(214,127,72,0.13)';
const MINE_BORDER = 'rgba(178,98,45,0.30)';
const ACCENT_700 = '#8C491A';
const ACCENT_600 = '#B2622D';
const ACCENT_500 = '#D67F48';
const INK_86 = 'rgba(32,30,29,0.86)';
const INK_72 = 'rgba(32,30,29,0.72)';
const INK_45 = 'rgba(32,30,29,0.45)';
const INK_38 = 'rgba(32,30,29,0.38)';
const INK_18 = 'rgba(32,30,29,0.18)';
const PILL_H = 34;

/**
 * Where a not-yet-acknowledged message's id starts.
 *
 * The thread sorts on `Number(id)` because the real ids are a bigserial, so a
 * pending row needs a NUMBER that outranks every real one -- a string like
 * "pending-1" makes the comparator return NaN, and a comparator returning NaN
 * scrambles the list rather than misplacing one row. 9e15 is under
 * Number.MAX_SAFE_INTEGER and a very long way above any row id this app will
 * ever hold.
 */
const PENDING_ID_BASE = 9_000_000_000_000_000;

// The Info tab's palette, handed to it rather than imported there: that panel
// lives inside THIS screen's visual language (the Circles one, not the
// Classical tokens), and a second copy of these constants is how the two drift.
const INFO_THEME: DmInfoTheme = {
  cardBg: CARD_BG,
  cardBorder: CARD_BORDER,
  accent: ACCENT_500,
  accentDeep: ACCENT_700,
  ink: INK_86,
  inkSoft: INK_72,
  inkFaint: INK_45,
};

function mmss(totalMs: number): string {
  const s = Math.max(0, Math.round(totalMs / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function timeOf(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '';
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/** Split text into plain + matched runs so a search hit is visible in place. */
function highlightRuns(text: string, needle: string): { text: string; hit: boolean }[] {
  const n = needle.trim().toLowerCase();
  if (!n) return [{ text, hit: false }];
  const out: { text: string; hit: boolean }[] = [];
  const lower = text.toLowerCase();
  let i = 0;
  while (i < text.length) {
    const at = lower.indexOf(n, i);
    if (at === -1) {
      out.push({ text: text.slice(i), hit: false });
      break;
    }
    if (at > i) out.push({ text: text.slice(i, at), hit: false });
    out.push({ text: text.slice(at, at + n.length), hit: true });
    i = at + n.length;
  }
  return out;
}

// ── reactions ────────────────────────────────────────────────────────────────
//
// ReactionRow USED TO LIVE HERE and it is gone. It was a row of outlined pills
// under every bubble -- used ones always visible, a dashed "+" expanding the rest
// inline -- which reserved permanent space on every message for a control almost
// none of them use, and put the control in the place the RESULT belongs.
//
// "The reactions in the DMs are bad, should be much better, just like the Apple
//  ones."
//
// They are now a gesture and a mark: hold a message, a capsule of glyphs appears
// over it, tap one and it snaps onto the bubble's corner. See components/Tapbacks
// for both halves and why the picker is not a modal.

// ── one message ──────────────────────────────────────────────────────────────

/**
 * MEMOIZED, AND THIS IS THE TYPING LAG.
 *
 *   "It seems like it's just a little laggy to send messages... it's just a
 *    little laggy."
 *
 * The composer's draft was a piece of state on DmThreadView, so every character
 * typed re-rendered the whole screen -- and this component was a plain function
 * inside an inline renderItem, so React had no way to know a bubble from four
 * minutes ago could not possibly have changed. Every visible row was rebuilt on
 * every keystroke, and a voice row rebuilds a waveform and a player with it.
 *
 * memo alone would not have fixed it: an inline renderItem hands every row a new
 * onReact/onOpenPicker closure each render, and shallow comparison sees new
 * props. So this is one half of a pair -- the props below are stable callbacks
 * and renderItem is hoisted, or this does nothing at all.
 *
 * The other half is that the draft no longer lives here (see Composer): a
 * keystroke now re-renders forty points of composer instead of a thread.
 */
const MessageBubble = memo(function MessageBubble({
  message,
  highlight,
  onReact,
  onTogglePin,
  pickerOpen = false,
  onOpenPicker,
  onClosePicker,
}: {
  message: DmMessage;
  highlight?: string;
  onReact: (messageId: string, kind: ReactionKind | null) => void;
  /**
   * PIN NOW LIVES IN THE TAPBACK PICKER, not on the long press itself.
   *
   * Holding a message used to pin it outright, which meant the one gesture a
   * message had was spent on the rarer of its two actions and there was no way to
   * react at all without the permanent pill row underneath. Both are on the hold
   * now: it opens the picker, and the picker's trailing item is the pin.
   */
  onTogglePin?: (message: DmMessage) => void;
  /** Whether THIS message is the one showing the picker. One at a time, thread-wide. */
  pickerOpen?: boolean;
  onOpenPicker?: (messageId: string) => void;
  onClosePicker?: () => void;
}) {
  const mine = message.mine;
  // Fetching the signed URL is deferred to first play by the player itself. The
  // closure is stable per message id, so the player's load effect does not
  // re-run on every render of the list.
  const fetchAudio = useCallback(async () => {
    const res = await getDmAudio(message.id);
    return res.ok ? res.data : null;
  }, [message.id]);

  const react = useCallback(
    (kind: ReactionKind | null) => {
      onReact(message.id, kind);
      // The picker closes on choosing, like Messages: it is a moment, not a panel.
      onClosePicker?.();
    },
    [message.id, onReact, onClosePicker],
  );

  const body = message.body ?? '';

  const isPinned = !!message.pinnedAt;

  return (
    // `overflow: visible` matters here even though it is the default: the badge
    // overlaps the bubble's top edge and the picker sits above the row entirely.
    <View style={{ alignItems: mine ? 'flex-end' : 'flex-start' }}>
      <Pressable
        // A tap on any bubble puts an open picker away, including this one's --
        // which is how you dismiss without choosing. Harmless when nothing is
        // open, and the voice player's own controls are inner Pressables so they
        // still win their touches.
        onPress={() => onClosePicker?.()}
        onLongPress={() => {
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
          onOpenPicker?.(message.id);
        }}
        // 320 was tuned for a pin, which is a deliberate, rare thing. Reacting is
        // neither, and Messages opens its tapbacks well before a third of a
        // second. 240 is quick enough not to feel like a wait and long enough not
        // to fire on a scroll.
        delayLongPress={240}
        accessibilityLabel="React to this message"
        style={({ pressed }) => ({
          maxWidth: '86%',
          opacity: pressed ? 0.85 : 1,
          alignSelf: mine ? 'flex-end' : 'flex-start',
        })}
      >
      <View
        style={{
          maxWidth: '100%',
          minWidth: message.kind === 'voice' ? 240 : undefined,
          padding: 13,
          borderRadius: 18,
          backgroundColor: mine ? MINE_BG : CARD_BG,
          borderWidth: 1,
          borderColor: mine ? MINE_BORDER : CARD_BORDER,
          gap: 9,
        }}
      >
        {message.kind === 'voice' ? (
          <>
            {message.audioStatus === 'ready' ? (
              <VoiceNotePlayer
                fetchAudio={fetchAudio}
                durationMs={message.durationMs}
                peaks={message.peaks}
                accent={ACCENT_600}
                showTimer
              />
            ) : (
              // A clip whose upload never finished. Saying so beats a dead
              // play button that does nothing when pressed.
              <CText t="metaSm" color={INK_45} style={{ fontSize: 12.5 }}>
                Voice message didn&apos;t finish uploading.
              </CText>
            )}
            {/* THE TRANSCRIPTION UNDERNEATH, which is the point of sending voice
                in this app rather than in iMessage: the recording is the message
                and the text is what makes it searchable and skimmable. */}
            {body ? (
              <CText t="body" color={INK_86} style={{ fontSize: 14.5, lineHeight: 23 }}>
                {highlight
                  ? highlightRuns(body, highlight).map((run, i) => (
                      <CText
                        key={i}
                        t="body"
                        color={run.hit ? ACCENT_700 : INK_86}
                        style={{
                          fontSize: 14.5,
                          lineHeight: 23,
                          backgroundColor: run.hit ? 'rgba(214,127,72,0.18)' : undefined,
                        }}
                      >
                        {run.text}
                      </CText>
                    ))
                  : body}
              </CText>
            ) : (
              <CText t="metaSm" color={INK_38} style={{ fontSize: 12 }}>
                Transcribing…
              </CText>
            )}
          </>
        ) : (
          <CText t="body" color={INK_86} style={{ fontSize: 15, lineHeight: 24 }}>
            {highlight
              ? highlightRuns(body, highlight).map((run, i) => (
                  <CText
                    key={i}
                    t="body"
                    color={run.hit ? ACCENT_700 : INK_86}
                    style={{
                      fontSize: 15,
                      lineHeight: 24,
                      backgroundColor: run.hit ? 'rgba(214,127,72,0.18)' : undefined,
                    }}
                  >
                    {run.text}
                  </CText>
                ))
              : body}
          </CText>
        )}

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <CText t="metaSm" color={INK_38} style={{ fontSize: 11, flex: 1 }}>
            {message.kind === 'voice' && message.durationMs > 0
              ? `${timeOf(message.createdAt)} · ${mmss(message.durationMs)}`
              : timeOf(message.createdAt)}
          </CText>
          {/* Marked on the bubble as well as listed in Info, or a pin is a
              thing that happens somewhere you are not looking. */}
          {isPinned ? <Pin size={12} color={ACCENT_600} strokeWidth={2.2} /> : null}
        </View>
      </View>
        {/* THE MARK, on the bubble's corner away from its tail -- trailing for
            yours, leading for theirs, which is where Messages puts it. Inside
            the Pressable so it overlaps the bubble rather than sitting under it. */}
        <TapbackBadges
          reactions={message.reactions}
          side={mine ? 'right' : 'left'}
          onToggle={react}
        />
      </Pressable>

      {pickerOpen ? (
        <TapbackPicker
          mine={message.reactions.mine}
          side={mine ? 'right' : 'left'}
          onPick={react}
          onPin={
            onTogglePin
              ? () => {
                  onTogglePin(message);
                  onClosePicker?.();
                }
              : undefined
          }
          pinned={isPinned}
        />
      ) : null}
    </View>
  );
});

// ── the composer ─────────────────────────────────────────────────────────────

/**
 * THE FIELD, AND THE DRAFT THAT LIVES IN IT.
 *
 *   "It seems like it's just a little laggy to send messages... If I press the
 *    keyboard once in a while..."
 *
 * ITS OWN COMPONENT BECAUSE OF WHERE THE STATE HAS TO SIT. `draft` was a
 * useState on DmThreadView, and a TextInput calls onChangeText on every
 * character -- so every character re-rendered the screen: the header, the Info
 * tab's props, the FlatList, and every visible MessageBubble with whatever a
 * voice row carries (a waveform, a player, a signed-URL closure). At sixty
 * characters a sentence that is sixty full-thread reconciliations, and it is the
 * whole of the typing lag.
 *
 * Memoizing the rows was half the fix and this is the other half. A keystroke
 * now re-renders forty points of composer and stops there. Nothing above it can
 * see the draft, which is also why send() takes the text as an argument and
 * answers with a boolean rather than reaching in to clear or restore the field.
 *
 * WHY NOT LIFT IT INTO A REF. Because the send button is disabled on empty and
 * the arrow changes color when there is something to send, so the draft has to
 * drive a render somewhere. The question was only how much of the tree that
 * render reaches.
 */
const Composer = memo(function Composer({
  insetBottom,
  onSend,
  onRecord,
}: {
  insetBottom: number;
  /** Resolves false when the send failed, and the words go back in the field. */
  onSend: (text: string) => Promise<boolean>;
  onRecord: () => void;
}) {
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const ready = draft.trim().length > 0;

  const submit = useCallback(async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    // Cleared BEFORE the await: leaving the text in the field while the request
    // is in flight invites a second tap and a duplicate message. The bubble is
    // already on screen by the time this returns -- see the pending list in
    // DmThreadView -- so the field emptying is not the app losing the message.
    setDraft('');
    const ok = await onSend(text);
    setSending(false);
    // Put the words back. Losing what someone typed is the one failure a
    // composer must never have.
    if (!ok) setDraft(text);
  }, [draft, sending, onSend]);

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'flex-end',
        gap: 10,
        paddingHorizontal: 12,
        paddingTop: 10,
        // THE HOME-BAR INSET. This was a flat 12, which was enough when the
        // tab pill sat below the composer and absorbed the gesture area.
        // With the pill gone (this view owns the whole screen now) the
        // composer would sit on the home indicator on every phone that has
        // one. Math.max so a device with no inset still gets real padding.
        paddingBottom: Math.max(insetBottom, 12) + 4,
        borderTopWidth: 1,
        borderTopColor: CARD_BORDER,
      }}
    >
      {/* A CIRCLE WITH A DOT INSIDE, on the left — the same shape the other
          record affordances use, so the gesture reads the same everywhere. */}
      <Pressable
        onPress={onRecord}
        accessibilityRole="button"
        accessibilityLabel="Record a voice message"
        hitSlop={8}
        style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
      >
        <View
          style={{
            width: PILL_H,
            height: PILL_H,
            borderRadius: PILL_H / 2,
            alignItems: 'center',
            justifyContent: 'center',
            borderWidth: 1,
            borderColor: 'rgba(178,98,45,0.45)',
            backgroundColor: 'rgba(214,127,72,0.10)',
          }}
        >
          <View
            style={{
              width: 12,
              height: 12,
              borderRadius: 6,
              backgroundColor: ACCENT_500,
            }}
          />
        </View>
      </Pressable>

      <View
        style={{
          flex: 1,
          justifyContent: 'center',
          minHeight: PILL_H,
          maxHeight: 120,
          paddingHorizontal: 13,
          paddingVertical: 6,
          borderRadius: 17,
          backgroundColor: CARD_BG,
          borderWidth: 1,
          borderColor: CARD_BORDER,
        }}
      >
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder="Message"
          placeholderTextColor={INK_38}
          multiline
          maxLength={4000}
          style={{
            padding: 0,
            fontSize: 15,
            lineHeight: 22,
            color: INK_86,
            maxHeight: 100,
          }}
        />
      </View>

      <Pressable
        onPress={() => void submit()}
        disabled={!ready || sending}
        accessibilityRole="button"
        accessibilityLabel="Send"
        hitSlop={8}
        style={({ pressed }) => ({
          opacity: !ready || sending ? 0.35 : pressed ? 0.6 : 1,
        })}
      >
        <View
          style={{
            width: PILL_H,
            height: PILL_H,
            borderRadius: PILL_H / 2,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: ready ? ACCENT_500 : 'transparent',
            borderWidth: 1,
            borderColor: ready ? ACCENT_500 : INK_18,
          }}
        >
          {sending ? (
            <ActivityIndicator size="small" color={ready ? '#FFF2EB' : ACCENT_600} />
          ) : (
            <ArrowUp size={17} color={ready ? '#FFF2EB' : INK_45} strokeWidth={2.4} />
          )}
        </View>
      </Pressable>
    </View>
  );
});

// ── settings ─────────────────────────────────────────────────────────────────

function SettingsSheet({
  visible,
  name,
  blocked,
  onClose,
  onExport,
  onDelete,
  onBlock,
  onReport,
  onSearch,
}: {
  visible: boolean;
  name: string;
  blocked: boolean;
  onClose: () => void;
  onExport: () => void;
  onDelete: () => void;
  onBlock: () => void;
  onReport: () => void;
  onSearch: () => void;
}) {
  const Row = ({
    icon,
    label,
    detail,
    danger,
    onPress,
  }: {
    icon: React.ReactNode;
    label: string;
    detail?: string;
    danger?: boolean;
    onPress: () => void;
  }) => (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          paddingVertical: 13,
          paddingHorizontal: 14,
          borderRadius: 16,
          backgroundColor: CARD_BG,
          borderWidth: 1,
          borderColor: CARD_BORDER,
        }}
      >
        {icon}
        <View style={{ flex: 1, gap: 2 }}>
          <CText t="listTitle" color={danger ? '#9B2C1E' : cl.ink} style={{ fontSize: 15 }}>
            {label}
          </CText>
          {detail ? (
            <CText t="metaSm" color={INK_45} style={{ fontSize: 12 }}>
              {detail}
            </CText>
          ) : null}
        </View>
      </View>
    </Pressable>
  );

  return (
    // FADE, NOT SLIDE.
    //
    // "When you press the filters button there's this gross flash-up that slides
    //  up with this dark screen. It needs to be a smoother fade-in and fade-out.
    //  Throughout the entire app there should never be any gross slide-up
    //  transitions."
    //
    // animationType="slide" throws the panel up from off-screen while the dim
    // layer appears at full strength in one frame, so the backdrop flashes and
    // the panel races it. "fade" cross-dissolves the whole thing -- dim and panel
    // together -- which is the transition he asked for, and it is now what every
    // modal in the app uses. scripts/motion-check.mts fails the build if a slide
    // comes back.
    <Modal visible={visible} animationType="fade" onRequestClose={onClose} transparent>
      <View style={{ flex: 1, backgroundColor: 'rgba(32,30,29,0.35)', justifyContent: 'flex-end' }}>
        <View
          style={{
            backgroundColor: '#FBF6EF',
            borderTopLeftRadius: 24,
            borderTopRightRadius: 24,
            padding: 18,
            paddingBottom: 34,
            gap: 9,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingBottom: 6 }}>
            <CText t="kicker" color={cl.goldKicker} style={{ flex: 1 }}>
              {name}
            </CText>
            <Pressable onPress={onClose} accessibilityLabel="Close" hitSlop={10}>
              <X size={18} color={INK_45} strokeWidth={2.2} />
            </Pressable>
          </View>

          <Row
            icon={<Search size={17} color={ACCENT_700} strokeWidth={2.2} />}
            label="Search this chat"
            detail="Keyword match across every message and transcript"
            onPress={onSearch}
          />
          <Row
            icon={<Download size={17} color={ACCENT_700} strokeWidth={2.2} />}
            label="Export transcript"
            detail="The whole conversation as text you can share or save"
            onPress={onExport}
          />
          <Row
            icon={<Ban size={17} color={blocked ? '#9B2C1E' : INK_72} strokeWidth={2.2} />}
            label={blocked ? 'Unblock contact' : 'Block contact'}
            /* SAY WHAT IT ACTUALLY DOES NOW. This read "neither of you can
               message the other" and that was the literal truth: the block was
               consulted in three places, all of them in the DM routes, so a
               blocked person could still send a connection request, ask for an
               intro, and put a push on this person's lock screen with their name
               on it. The server now refuses all of that, and copy that still
               promised only messages would be underselling a safety control --
               which is its own kind of wrong, because somebody deciding whether
               blocking is enough needs to know what it covers. */
            detail={
              blocked
                ? 'They can reach you again'
                : 'No messages, no connection or intro requests, no notifications'
            }
            danger={!blocked}
            onPress={onBlock}
          />
          {/* THE OTHER HALF OF BLOCKING, and it is not the same half. A block
              is a private boundary that tells nobody anything, which is right
              for "I do not want to hear from this person" and useless for "this
              person should not be here". Until now there was only the first. */}
          <Row
            icon={<Flag size={17} color="#9B2C1E" strokeWidth={2.2} />}
            label="Report this person"
            detail="We review every report. They are blocked and never told."
            danger
            onPress={onReport}
          />
          <Row
            icon={<Trash2 size={17} color="#9B2C1E" strokeWidth={2.2} />}
            label="Delete this chat"
            // Said plainly, because it is the thing people assume wrongly about
            // a delete button in a messenger.
            detail="Clears your copy only — their history is untouched"
            danger
            onPress={onDelete}
          />
        </View>
      </View>
    </Modal>
  );
}

// ── the thread ───────────────────────────────────────────────────────────────

export function DmThreadView({
  threadId,
  name,
  other,
  blocked: blockedInitial = false,
  onBack,
  onDeleted,
  onOpenPerson,
}: {
  threadId: string;
  name: string;
  /**
   * The other person, when the caller has them. Carries the account id (for
   * muting) and the viewer's own contact id for them (for their card and their
   * rank) -- the Info tab is mostly empty without it, which is why it degrades
   * to "they are not in your contacts" rather than pretending.
   */
  other?: DmPerson | null;
  blocked?: boolean;
  onBack: () => void;
  /** Fired after the chat is cleared, so the caller can drop it from its list. */
  onDeleted?: () => void;
  /** Their contact card, opened from Info. */
  onOpenPerson?: (contactId: string) => void;
}) {
  const insets = useSafeAreaInsets();

  // THIS IS THE WHOLE SCREEN WHILE IT IS OPEN.
  //
  // "When you go into a direct message, the bottom banner tabs should go away
  //  and the search bar should go away. The only thing that should be in there
  //  is the messages between you and the person and the ability to send voice."
  //
  // A DM is an absolute layer inside the Contacts page, which is inside the
  // pager (pushing a route from within a pager loses the pager's position). But
  // the People header, the one search bar and the tab pill all live ABOVE the
  // pager, so they carried on drawing over the conversation: two headers stacked
  // at the top, and a composer sitting behind a search field and a tab bar.
  //
  // The page cannot reach those, so it declares that the screen is taken and
  // home.tsx fades them out. Released on unmount, which is also the back button.
  useEffect(() => enterFullscreenLayer(), []);

  const { messages, loading, hasMore, loadingMore, loadMore, merge } =
    useDmConversation(threadId);

  /**
   * MESSAGES THAT ARE ON SCREEN BEFORE THE SERVER HAS HEARD OF THEM.
   *
   *   "It seems like it's just a little laggy to send messages."
   *
   * It was not lag in any fixable sense -- it was a round trip to Railway with
   * nothing drawn until it came back. `send` cleared the field, awaited the
   * POST, and only then merged the row, so the gap between your thumb and the
   * bubble was however long the network took. Every messenger people already use
   * draws the bubble on the tap and reconciles afterwards.
   *
   * THE ID HAS TO BE A NUMBER, and this is the trap worth writing down. The
   * conversation sorts with `Number(b.id) - Number(a.id)` because the real ids
   * are a bigserial -- send order without trusting any clock. A temp id like
   * "pending-1" makes that comparator return NaN, and a comparator that returns
   * NaN does not sort a list wrongly, it scrambles it. So a pending id is a real
   * number above anything a bigserial will reach in the lifetime of this app,
   * counting up so two quick sends keep their order.
   *
   * They live HERE rather than in useDmConversation on purpose: that hook holds
   * what the server said, and a row nobody has acknowledged is not that. It also
   * has no way to remove a row -- merge only adds -- which is exactly the
   * operation a failed send needs.
   */
  const [pending, setPending] = useState<DmMessage[]>([]);
  const pendingSeq = useRef(0);
  const [recording, setRecording] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // WHICH MESSAGE IS SHOWING ITS TAPBACK PICKER. One at a time, thread-wide:
  // holding a second message moves the capsule rather than opening another, and
  // any scroll or tap elsewhere puts it away -- the same rules Messages plays by.
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  const closePicker = useCallback(() => setPickerFor(null), []);
  const [blocked, setBlocked] = useState(blockedInitial);
  const [reportOpen, setReportOpen] = useState(false);
  // CHAT | INFO. Two halves of one screen rather than two screens: what was
  // said, and who it was with. A separate route would have taken the thread off
  // the stack to show you a summary of the thread.
  const [tab, setTab] = useState<'chat' | 'info'>('chat');
  // Bumped after a pin, so the Info panel refetches its pinned list instead of
  // showing the state from when the tab was last opened.
  const [pinVersion, setPinVersion] = useState(0);

  // Search is a MODE of this screen, not a separate one: the magnifying glass in
  // the header swaps the composer for a field and the thread for the hits, so
  // finding a message leaves you looking at the message in place.
  const [searchOpen, setSearchOpen] = useState(false);
  const [needle, setNeedle] = useState('');
  const [hits, setHits] = useState<DmMessage[] | null>(null);
  const [searching, setSearching] = useState(false);

  const runSearch = useCallback(
    async (q: string) => {
      const term = q.trim();
      if (term.length < 2) {
        setHits(null);
        return;
      }
      setSearching(true);
      const res = await searchDmThread(threadId, term);
      setSearching(false);
      setHits(res.ok ? (res.data?.messages ?? []) : []);
    },
    [threadId],
  );

  const onReact = useCallback(
    async (messageId: string, kind: ReactionKind | null) => {
      // OPTIMISTIC. Waiting on a round trip for a tapback makes the app feel
      // broken even when it is working, and the write is idempotent (one row per
      // person per message), so the server's answer just replaces ours.
      merge(
        messages.map((m) =>
          m.id === messageId
            ? {
                ...m,
                reactions: (() => {
                  const counts = { ...m.reactions.counts };
                  const was = m.reactions.mine;
                  if (was) counts[was] = Math.max(0, (counts[was] ?? 1) - 1);
                  if (kind) counts[kind] = (counts[kind] ?? 0) + 1;
                  return { counts, mine: kind };
                })(),
              }
            : m,
        ),
      );
      const res = await setDmReaction(messageId, kind);
      if (res.ok) {
        merge(
          messages.map((m) =>
            m.id === messageId ? { ...m, reactions: res.data.reactions } : m,
          ),
        );
      }
    },
    [messages, merge],
  );

  const onTogglePin = useCallback(
    async (message: DmMessage) => {
      const next = !message.pinnedAt;
      // Optimistic, like the reactions: a hold that appears to do nothing for a
      // round trip reads as a hold that missed.
      merge(
        messages.map((m) =>
          m.id === message.id
            ? { ...m, pinnedAt: next ? new Date().toISOString() : null }
            : m,
        ),
      );
      const res = await pinDmMessage(message.id, next);
      if (!res.ok) {
        merge(messages.map((m) => (m.id === message.id ? message : m)));
        toast.error('Could not pin that.');
        return;
      }
      setPinVersion((v) => v + 1);
      toast.success(next ? 'Pinned. It is in Info.' : 'Unpinned.');
    },
    [messages, merge],
  );

  /**
   * Send, and put the bubble up first.
   *
   * Returns false when the send failed, which is how the composer knows to put
   * the words back in the field. Losing what someone typed is the one failure a
   * composer must never have, and the composer owns the text now, so it has to
   * be told rather than reached into.
   */
  const send = useCallback(
    async (text: string): Promise<boolean> => {
      pendingSeq.current += 1;
      const tempId = String(PENDING_ID_BASE + pendingSeq.current);
      const optimistic: DmMessage = {
        id: tempId,
        mine: true,
        kind: 'text',
        body: text,
        durationMs: 0,
        byteSize: 0,
        peaks: [],
        audioStatus: 'none',
        createdAt: new Date().toISOString(),
        reactions: { counts: {}, mine: null },
      };
      setPending((p) => [optimistic, ...p]);

      const res = await sendDmText(threadId, text);

      // Dropped whether it worked or not: on success the real row replaces it in
      // the same commit, and on failure it must not linger as a message that
      // looks sent. React batches both updates, so there is no frame with
      // neither and no frame with both.
      setPending((p) => p.filter((m) => m.id !== tempId));

      if (!res.ok) {
        toast.error(res.status === 403 ? 'You can’t message them.' : 'Couldn’t send that.');
        return false;
      }
      merge([res.data.message]);
      return true;
    },
    [threadId, merge],
  );

  const sendVoice = useCallback(
    async (
      transcript: string,
      _scope: unknown,
      media?: { uri: string; durationMs: number; peaks: number[] },
    ) => {
      setRecording(false);
      if (!media?.uri) {
        // No recording came back — send the transcript as text rather than
        // dropping what they said on the floor.
        if (transcript.trim()) {
          const res = await sendDmText(threadId, transcript.trim());
          if (res.ok) merge([res.data.message]);
        }
        return;
      }
      const message = await sendDmVoice(threadId, media.uri, {
        durationMs: media.durationMs,
        peaks: media.peaks,
        transcript,
      });
      if (!message) {
        toast.error('Couldn’t send that voice message.');
        return;
      }
      merge([message]);
    },
    [threadId, merge],
  );

  const onExport = useCallback(async () => {
    setSettingsOpen(false);
    const res = await exportDmThread(threadId);
    if (!res.ok) {
      toast.error('Couldn’t export this chat.');
      return;
    }
    const lines = (res.data?.messages ?? []).map((m) => {
      const when = new Date(m.createdAt).toLocaleString();
      const kind = m.kind === 'voice' ? ` (voice, ${mmss(m.durationMs)})` : '';
      return `[${when}] ${m.author}${kind}: ${m.body ?? ''}`;
    });
    const text = `Conversation with ${name}\n${lines.length} messages\n\n${lines.join('\n')}`;
    try {
      await Share.share({ message: text, title: `Chat with ${name}` });
    } catch {
      /* the user dismissed the sheet — not an error */
    }
  }, [threadId, name]);

  const onDelete = useCallback(async () => {
    setSettingsOpen(false);
    const res = await clearDmThread(threadId);
    if (!res.ok) {
      toast.error('Couldn’t delete this chat.');
      return;
    }
    toast.success('Chat cleared.', 'Their copy is untouched.');
    onDeleted?.();
    onBack();
  }, [threadId, onBack, onDeleted]);

  const onBlock = useCallback(async () => {
    setSettingsOpen(false);
    const next = !blocked;
    const res = await setDmBlock(threadId, next);
    if (!res.ok) {
      toast.error('Couldn’t change that.');
      return;
    }
    setBlocked(next);
    toast.success(next ? `Blocked ${name}.` : `Unblocked ${name}.`);
  }, [threadId, blocked, name]);

  /**
   * The thread, with anything still in flight sitting on top of it.
   *
   * Search results replace the thread entirely, and a pending row has no place
   * among them -- you are looking at what was said, not at what you are saying.
   *
   * There is a race worth naming: the 4-second poll can pick up the real row
   * between the server writing it and the POST returning, so for those few
   * milliseconds the message is here twice. It resolves itself on the very next
   * commit, when send() drops the pending. Closing it properly needs a
   * client-supplied token echoed back by the server -- a column and an API
   * change for a duplicate nobody can see.
   */
  const data = useMemo(() => {
    if (hits) return hits;
    return pending.length > 0 ? [...pending, ...messages] : messages;
  }, [hits, pending, messages]);

  /**
   * HOISTED, AND THAT IS THE POINT.
   *
   * These were inline in the FlatList, so every render handed every visible row
   * a brand new renderItem and a brand new set of closures -- which defeats
   * memo() completely, because shallow comparison sees different functions and
   * rebuilds the row. Memoizing MessageBubble without this does nothing at all.
   *
   * `pickerFor` is a real dependency: exactly one message shows its tapback
   * capsule thread-wide, so opening one has to re-render the row that gained it
   * and the row that lost it. That happens on a long press, not on a keystroke.
   */
  const keyExtractor = useCallback((m: DmMessage) => m.id, []);
  const renderItem = useCallback(
    ({ item }: { item: DmMessage }) => (
      <MessageBubble
        message={item}
        highlight={hits ? needle : undefined}
        onReact={onReact}
        onTogglePin={onTogglePin}
        pickerOpen={pickerFor === item.id}
        onOpenPicker={setPickerFor}
        onClosePicker={closePicker}
      />
    ),
    [hits, needle, onReact, onTogglePin, pickerFor, closePicker],
  );

  const listEmpty = useMemo(
    () =>
      loading ? null : (
        // CENTERED, and this is why it was "way too low".
        //
        // The list is `inverted` so a chat opens at its newest message, and
        // inverting flips the empty component too -- so `paddingTop: 40` was
        // rendered as 40pt off the BOTTOM, which is exactly where his screenshot
        // shows it, tucked behind the composer. The list is no longer inverted
        // when it is empty (there is no scroll position to preserve in an empty
        // list) and this centers itself in the space instead.
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <CText t="aside" color={INK_45}>
            {hits ? 'No messages match that.' : 'Say something to start.'}
          </CText>
        </View>
      ),
    [loading, hits],
  );

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: '#FBF6EF' }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* ── header: back, name, search, settings ──
          THE TOP INSET IS THE FIX FOR "the upper banner is too high".
          It was paddingTop: 8 from the top of its container, which was fine when
          the People header sat above it and wrong the moment this became the
          whole screen -- the row ran up under the status bar and the notch. It
          takes the safe-area inset plus 6 now, so it clears the hardware on every
          phone rather than on the one it was measured on.

          AND EVERYTHING IN IT IS BIGGER. "The font at the top with their name,
          the back arrow, the magnifying glass, and the filters is too small."
          Name 16 -> 19 (this is the title of the screen, and it was set at the
          size of a list row), back chevron 22 -> 27, the two actions 19 -> 23. */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          paddingHorizontal: 12,
          paddingTop: insets.top + 6,
          paddingBottom: 12,
          borderBottomWidth: 1,
          borderBottomColor: CARD_BORDER,
        }}
      >
        <Pressable onPress={onBack} accessibilityLabel="Back" hitSlop={12}>
          <ChevronLeft size={27} color={ACCENT_700} strokeWidth={2.2} />
        </Pressable>

        {searchOpen ? (
          <View
            style={{
              flex: 1,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 8,
              paddingHorizontal: 11,
              height: PILL_H,
              borderRadius: PILL_H / 2,
              backgroundColor: CARD_BG,
              borderWidth: 1,
              borderColor: CARD_BORDER,
            }}
          >
            <Search size={15} color={INK_45} strokeWidth={2.2} />
            <TextInput
              autoFocus
              value={needle}
              onChangeText={(t) => {
                setNeedle(t);
                void runSearch(t);
              }}
              placeholder={`Search ${name.split(/\s+/)[0]}`}
              placeholderTextColor={INK_38}
              returnKeyType="search"
              style={{ flex: 1, padding: 0, fontSize: 16.5, color: INK_86 }}
            />
            {searching ? <ActivityIndicator size="small" color={ACCENT_600} /> : null}
            <Pressable
              onPress={() => {
                setSearchOpen(false);
                setNeedle('');
                setHits(null);
              }}
              accessibilityLabel="Close search"
              hitSlop={8}
            >
              <X size={16} color={INK_45} strokeWidth={2.2} />
            </Pressable>
          </View>
        ) : (
          <>
            <View style={{ flex: 1 }}>
              <CText t="cardTitle" style={{ fontSize: 19 }} numberOfLines={1}>
                {name}
              </CText>
              {blocked ? (
                <CText t="metaSm" color="#9B2C1E" style={{ fontSize: 11.5 }}>
                  Blocked
                </CText>
              ) : null}
            </View>
            {/* THE MAGNIFYING GLASS AT THE TOP OF THE CHAT, as asked. */}
            <Pressable
              onPress={() => setSearchOpen(true)}
              accessibilityLabel="Search this chat"
              hitSlop={12}
            >
              <Search size={23} color={ACCENT_700} strokeWidth={2.2} />
            </Pressable>
            <Pressable
              onPress={() => setSettingsOpen(true)}
              accessibilityLabel="Chat settings"
              hitSlop={12}
            >
              <Settings2 size={23} color={ACCENT_700} strokeWidth={2.2} />
            </Pressable>
          </>
        )}
      </View>

      {/* ── chat | info ── */}
      {searchOpen ? null : (
        <View
          style={{
            flexDirection: 'row',
            gap: 8,
            paddingHorizontal: 12,
            // Tight under the header, which is where "the Chat and Info tab
            // should be above, not where they are" puts them: they were sitting
            // in the middle of the screen because a duplicated People header was
            // pushing this whole view down by its own height.
            paddingTop: 12,
            paddingBottom: 4,
          }}
        >
          {(['chat', 'info'] as const).map((t) => {
            const on = tab === t;
            return (
              <Pressable
                key={t}
                onPress={() => setTab(t)}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                accessibilityLabel={t === 'chat' ? 'Chat' : 'Info'}
                style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
              >
                {/* 30 -> 38 tall, 12.5 -> 15pt type. These are the screen's
                    only navigation and they were smaller than the message text
                    underneath them. */}
                <View
                  style={{
                    paddingHorizontal: 19,
                    height: 38,
                    borderRadius: 19,
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderWidth: 1,
                    borderColor: on ? 'rgba(178,98,45,0.45)' : CARD_BORDER,
                    backgroundColor: on ? 'rgba(214,127,72,0.13)' : 'transparent',
                  }}
                >
                  <CText t="listTitle" color={on ? ACCENT_700 : INK_45} style={{ fontSize: 15 }}>
                    {t === 'chat' ? 'Chat' : 'Info'}
                  </CText>
                </View>
              </Pressable>
            );
          })}
        </View>
      )}

      {tab === 'info' && !searchOpen ? (
        <DmInfoPanel
          // Remounted after a pin so the pinned list is what it is now, not
          // what it was when the tab was last opened.
          key={`info-${pinVersion}`}
          threadId={threadId}
          name={name}
          other={other}
          blocked={blocked}
          theme={INFO_THEME}
          onOpenPerson={onOpenPerson}
          onExport={onExport}
          onClear={onDelete}
          onToggleBlock={onBlock}
          onReport={() => setReportOpen(true)}
          // A pinned row takes you back to the message, which means back to the
          // Chat tab -- the pin is a bookmark, and a bookmark that shows you a
          // preview and no way to the thing is not a bookmark.
          onOpenMessage={() => setTab('chat')}
        />
      ) : (
        <>
      {/* ── the thread ── */}
      <FlatList
        data={data}
        keyExtractor={keyExtractor}
        // Newest first in the data, drawn bottom-up: this is what makes a chat
        // open at the latest message without measuring or scrolling to an offset.
        inverted={!hits && data.length > 0}
        contentContainerStyle={{ padding: 14, gap: 14, flexGrow: 1 }}
        keyboardDismissMode="interactive"
        // An open picker follows the rules of a transient thing: scrolling the
        // thread puts it away, because it is anchored to a message that is moving
        // out from under your thumb.
        onScrollBeginDrag={closePicker}
        // NOT onTouchStart. A touch anywhere in the list bubbles up from the
        // picker's own glyphs, so closing on it unmounted the capsule before the
        // tap it was reacting to could land -- the reaction would never be sent.
        // Tapping a bubble closes it instead (see MessageBubble's onPress), which
        // covers every touch inside the thread that is not a glyph.
        renderItem={renderItem}
        ListEmptyComponent={listEmpty}
        // Only when showing the real thread: paging back through search hits is
        // not a thing, and `inverted` puts onEndReached at the TOP, which is
        // exactly where "older messages" belongs.
        onEndReached={hits ? undefined : () => void loadMore()}
        onEndReachedThreshold={0.4}
        ListFooterComponent={
          loadingMore && !hits ? (
            <View style={{ paddingVertical: 14, alignItems: 'center' }}>
              <ActivityIndicator size="small" color={ACCENT_600} />
            </View>
          ) : !hasMore && !hits && messages.length > 0 ? (
            <View style={{ paddingVertical: 14, alignItems: 'center' }}>
              <CText t="metaSm" color={INK_38} style={{ fontSize: 11.5 }}>
                Beginning of this conversation
              </CText>
            </View>
          ) : null
        }
      />

      {/* ── composer: voice circle left, field center, send right ── */}
      {searchOpen ? null : blocked ? (
        <View
          style={{
            paddingHorizontal: 16,
            paddingTop: 16,
            paddingBottom: Math.max(insets.bottom, 16),
            alignItems: 'center',
            borderTopWidth: 1,
            borderTopColor: CARD_BORDER,
          }}
        >
          <CText t="metaSm" color={INK_45} style={{ fontSize: 12.5 }}>
            You blocked {name.split(/\s+/)[0]}. Unblock in settings to message again.
          </CText>
        </View>
      ) : (
        <Composer
          insetBottom={insets.bottom}
          onSend={send}
          onRecord={() => setRecording(true)}
        />
      )}
        </>
      )}

      <VoiceNoteRecorder
        visible={recording}
        title={`Voice message to ${name.split(/\s+/)[0]}`}
        onCancel={() => setRecording(false)}
        onDone={sendVoice}
      />

      <SettingsSheet
        visible={settingsOpen}
        name={name}
        blocked={blocked}
        onClose={() => setSettingsOpen(false)}
        onExport={onExport}
        onDelete={onDelete}
        onBlock={onBlock}
        onReport={() => {
          setSettingsOpen(false);
          setReportOpen(true);
        }}
        onSearch={() => {
          setSettingsOpen(false);
          setSearchOpen(true);
        }}
      />

      {/* Reporting blocks in the same request, so the local flag has to follow
          or this screen keeps offering a Block button for somebody already
          blocked and the composer stays open under it. */}
      <ReportSheet
        visible={reportOpen}
        name={name}
        threadId={threadId}
        amberId={other?.amberId ?? null}
        onClose={() => setReportOpen(false)}
        onReported={(didBlock) => {
          if (didBlock) setBlocked(true);
        }}
      />
    </KeyboardAvoidingView>
  );
}
