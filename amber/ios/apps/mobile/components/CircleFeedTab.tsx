import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { MessageCircle, ThumbsDown, ThumbsUp, X } from 'lucide-react-native';
import { Text } from './Text';
import { VoiceNotePlayer } from './VoiceNotePlayer';
import { getCircleFeed, type FeedItem } from '../lib/noteShares';
import {
  REACTION_GLYPH,
  REACTION_KINDS,
  REACTION_LABEL,
  addComment,
  clearReaction,
  getComments,
  setReaction,
  type NoteComment,
  type ReactionKind,
  type ReactionSummary,
} from '../lib/noteMedia';
import { toast } from '../lib/toast';
import { LIGHT } from '../lib/theme';
import { fonts, radius, spacing } from '../lib/tokens';

// The circle Feed: every note members shared here, newest first.
//
// Transcribed from `Circle Feed Light.dc.html` — 22pt row padding, a
// rgba(178,98,45,0.16) divider, 13pt internal gap, a 26pt author disc, the
// duration right-aligned in tabular numerals, tapback pills at 5x11, and comments
// hanging off a terracotta left rule. The one deliberate deviation is the
// waveform: the mockup draws a polyline, and this draws Apple-Voice-Memos bars,
// because that is the read the product owner asked for repeatedly. Colors,
// heights and stroke weights are the mockup's.
//
// Loading this marks the circle seen server-side, which is what clears the unseen
// dot on the circles grid.

// ── design tokens, straight from the mockup ─────────────────────────────────────
const RULE = 'rgba(178,98,45,0.16)';
// EACH NOTE IS ITS OWN CARD. Rows used to be separated by a single hairline, which
// on a screen of transcripts read as "text after text after text" with nothing
// telling you where one person stopped and the next started. A card gives each note
// an edge, and the space BETWEEN cards is what does the separating.
const CARD_BG = '#FFFCF8';
const CARD_BORDER = 'rgba(178,98,45,0.15)';
const CARD_GAP = 14;
const CARD_PAD = 18;
const CARD_RADIUS = 20;
// Interactive controls sit on a 34pt row: 26pt pills were legible but not
// comfortably tappable, and the comment affordance was plain text with no edge at
// all. 34 clears the 44pt guidance once hitSlop is counted, and reads as a control.
const PILL_H = 34;
// The transcript's clamp. Three lines is enough to recognize a note you already
// know about and to decide whether to open one you don't.
const TRANSCRIPT_PREVIEW_LINES = 3;
const TRANSCRIPT_LINE_H = 25;
// Hard cap on how much text is handed to the collapsed Text node. The clamp works by
// laying the transcript out unclipped and hiding the overflow (see the note at the
// render site, which explains why numberOfLines cannot answer "did it clip?"), and a
// five-minute note transcribes to ~800 words — so measuring the whole thing on every
// visible row is real layout work for text nobody can see. 400 characters is well past
// three lines at any type size, so the "is it clipped?" answer is unchanged and the
// work is bounded.
const TRANSCRIPT_PREVIEW_CHARS = 400;
// Must match fontScale.maxBody in lib/tokens.ts, which is the cap components/Text.tsx
// passes to maxFontSizeMultiplier. Clamping to it here rather than trusting the raw
// system fontScale keeps the box from growing past what the text can actually reach.
const MAX_BODY_SCALE = 1.4;
const RULE_COMMENT = 'rgba(178,98,45,0.25)';
const INK_92 = 'rgba(32,30,29,0.92)';
const INK_86 = 'rgba(32,30,29,0.86)';
const INK_72 = 'rgba(32,30,29,0.72)';
const INK_48 = 'rgba(32,30,29,0.48)';
const INK_45 = 'rgba(32,30,29,0.45)';
const INK_38 = 'rgba(32,30,29,0.38)';
const INK_18 = 'rgba(32,30,29,0.18)';
const ACCENT_700 = '#8C491A';
const ACCENT_600 = '#B2622D';
const ACCENT_500 = '#D67F48';
const PILL_ON_BORDER = 'rgba(178,98,45,0.45)';

// Split a transcript into plain + matched runs for keyword highlighting. Used by
// the transcript-search screen, which renders this same row with `highlight` set
// and without the player or tapbacks — searching is for finding, not reacting.
function highlightRuns(text: string, needle: string): { text: string; hit: boolean }[] {
  const n = needle.trim().toLowerCase();
  if (!n) return [{ text, hit: false }];
  const out: { text: string; hit: boolean }[] = [];
  let i = 0;
  const hay = text.toLowerCase();
  for (;;) {
    const at = hay.indexOf(n, i);
    if (at === -1) {
      if (i < text.length) out.push({ text: text.slice(i), hit: false });
      break;
    }
    if (at > i) out.push({ text: text.slice(i, at), hit: false });
    out.push({ text: text.slice(at, at + n.length), hit: true });
    i = at + n.length;
  }
  return out;
}

function initialsOf(name: string): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

function formatAgo(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const mins = Math.floor((Date.now() - t) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return 'yesterday';
  return `${days}d`;
}

function mmss(totalMs: number): string {
  const s = Math.max(0, Math.round(totalMs / 1000));
  return `${Math.floor(s / 60)}:${s % 60 < 10 ? '0' : ''}${s % 60}`;
}

// ── the author disc ────────────────────────────────────────────────────────────
function AuthorDisc({ name, filled }: { name: string; filled: boolean }) {
  return (
    <View
      style={{
        width: 26,
        height: 26,
        borderRadius: 13,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: filled ? ACCENT_500 : '#F9F4ED',
        borderWidth: filled ? 0 : 1,
        borderColor: PILL_ON_BORDER,
      }}
    >
      <Text
        style={{
          fontFamily: fonts.body,
          fontSize: 9.5,
          letterSpacing: 0.5,
          color: filled ? '#FFF2EB' : ACCENT_700,
        }}
      >
        {initialsOf(name)}
      </Text>
    </View>
  );
}

// ── tapbacks ───────────────────────────────────────────────────────────────────
function TapbackPill({
  label,
  icon,
  a11yLabel,
  count,
  mine,
  dashed = false,
  onPress,
  disabled,
}: {
  /** The text glyph, or null when `icon` draws it instead. */
  label?: string | null;
  /** Used for the thumbs, which have no good text form at this size. */
  icon?: (color: string) => ReactNode;
  /** The glyph is unreadable aloud ("!!", "HA"), so a11y gets the real word. */
  a11yLabel?: string;
  count?: number;
  mine?: boolean;
  dashed?: boolean;
  onPress: () => void;
  disabled?: boolean;
}) {
  // A glyph carrying a newline is drawn stacked (the laugh tapback).
  const stacked = !!label?.includes('\n');
  const fg = mine ? ACCENT_700 : dashed ? INK_45 : 'rgba(32,30,29,0.62)';
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={a11yLabel ?? label?.replace('\n', '') ?? 'Reaction'}
      accessibilityState={{ selected: !!mine }}
      hitSlop={8}
      style={({ pressed }) => ({ opacity: disabled ? 0.5 : pressed ? 0.6 : 1 })}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 6,
          paddingHorizontal: 13,
          // FIXED height, not vertical padding: the stacked "HA/HA" glyph is two
          // lines and would otherwise render a taller pill than its neighbors,
          // leaving the row visibly uneven.
          height: PILL_H,
          minWidth: PILL_H + 6,
          borderRadius: radius.full,
          borderWidth: 1,
          borderStyle: dashed ? 'dashed' : 'solid',
          borderColor: mine ? PILL_ON_BORDER : dashed ? 'rgba(32,30,29,0.22)' : INK_18,
          backgroundColor: mine ? 'rgba(214,127,72,0.10)' : 'transparent',
        }}
      >
        {icon ? (
          icon(fg)
        ) : (
          <Text
            style={{
              fontFamily: fonts.body,
              // The stacked laugh needs two lines inside the same 34pt pill, so its
              // type is smaller and its leading tighter than a single-line glyph's.
              fontSize: stacked ? 9.5 : 14,
              lineHeight: stacked ? 10.5 : 17,
              textAlign: 'center',
              color: fg,
            }}
          >
            {label}
          </Text>
        )}
        {count != null ? (
          <Text
            style={{
              fontFamily: fonts.body,
              fontSize: 13,
              lineHeight: 16,
              color: fg,
              fontVariant: ['tabular-nums'],
            }}
          >
            {count}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

// The thumbs, as line icons rather than emoji — see REACTION_GLYPH's note.
const REACTION_ICON: Partial<Record<ReactionKind, (color: string) => ReactNode>> = {
  like: (c) => <ThumbsUp size={15} color={c} strokeWidth={2} />,
  dislike: (c) => <ThumbsDown size={15} color={c} strokeWidth={2} />,
};

/** A circular icon button on the same 34pt rhythm as the pills. */
function RoundButton({
  onPress,
  a11yLabel,
  children,
  active,
}: {
  onPress: () => void;
  a11yLabel: string;
  children: ReactNode;
  active?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={a11yLabel}
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
          borderColor: active ? PILL_ON_BORDER : INK_18,
          backgroundColor: active ? 'rgba(214,127,72,0.10)' : 'transparent',
        }}
      >
        {children}
      </View>
    </Pressable>
  );
}

/**
 * One note in the feed.
 *
 * Reactions are OPTIMISTIC: the pill flips the instant you tap it and the server
 * response replaces the whole summary. Waiting ~200ms across the Atlantic for a
 * tapback to register makes the app feel broken even when it is working, and the
 * write is idempotent (one row per person per note), so a failed request just
 * restores what the server actually thinks.
 */
function FeedRow({
  item,
  accent,
  expanded = false,
  onToggleComments,
  highlight,
}: {
  item: FeedItem;
  accent: string;
  expanded?: boolean;
  onToggleComments?: () => void;
  /**
   * Search mode. When set, the transcript is rendered with matched spans
   * emphasized and the player, tapbacks and comments are omitted — the search
   * screen is a way to FIND a note, and interacting belongs on the note itself.
   */
  highlight?: string;
}) {
  const searchMode = !!highlight;
  const ownerId = item.sharedBy.amberId;
  const name = item.sharedBy.name || item.sharedBy.username || 'Amber user';
  const [reactions, setReactions] = useState<ReactionSummary | null>(item.reactions ?? null);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [comments, setComments] = useState<NoteComment[] | null>(null);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  // Heard-in-this-session. The mockup draws heard notes flatter; without this the
  // whole feed would render as "new" forever.
  const [heard, setHeard] = useState(false);
  // Long transcripts are CLAMPED, not truncated. A five-minute note transcribes to
  // a wall of text that pushed the reactions and the comment button off the bottom
  // of the screen, so the controls for a note were unreachable without scrolling
  // past the note itself. Three lines is enough to know whether you want the rest.
  const [showFull, setShowFull] = useState(false);
  // Whether the clamp actually clipped anything. Measured, not guessed from
  // character count: the same 300 characters wrap to a different number of lines
  // depending on type size and screen width, so a length heuristic shows "Press to
  // see more" on notes that are already fully visible.
  const [clipped, setClipped] = useState(false);
  // THE CLAMP HAS TO SCALE WITH THE USER'S TEXT SIZE.
  //
  // maxHeight was a raw 75 (3 x 25pt of leading). But components/Text.tsx allows font
  // scaling up to fontScale.maxBody (1.4x), and iOS multiplies a style lineHeight by
  // that factor while leaving an ancestor's maxHeight alone. At the largest Larger-Text
  // setting the leading becomes ~35pt, so a 75pt box showed 2.1 lines -- and the
  // "is it clipped?" test counts LINES, which still read 3, so no "PRESS TO SEE MORE"
  // appeared and the third line was silently unreachable. Scaling the box by the same
  // multiplier keeps the box and the leading in agreement at every text size.
  const { fontScale } = useWindowDimensions();
  const clampHeight =
    TRANSCRIPT_LINE_H * TRANSCRIPT_PREVIEW_LINES * Math.min(MAX_BODY_SCALE, Math.max(1, fontScale));

  const commentCount = comments?.length ?? item.commentCount ?? 0;

  const react = useCallback(
    async (kind: ReactionKind) => {
      if (busy) return;
      setBusy(true);
      setPicking(false);
      void Haptics.selectionAsync().catch(() => {});
      const previous = reactions;
      const removing = reactions?.mine === kind;
      // Optimistic: adjust counts locally before the round trip.
      setReactions((r) => {
        const counts = { ...(r?.counts ?? ({} as Record<ReactionKind, number>)) };
        for (const k of REACTION_KINDS) counts[k] = counts[k] ?? 0;
        if (r?.mine) counts[r.mine] = Math.max(0, counts[r.mine] - 1);
        if (!removing) counts[kind] = (counts[kind] ?? 0) + 1;
        const total = REACTION_KINDS.reduce((n, k) => n + counts[k], 0);
        return { counts, mine: removing ? null : kind, total };
      });
      const res = removing
        ? await clearReaction(ownerId, item.noteId)
        : await setReaction(ownerId, item.noteId, kind);
      setBusy(false);
      if (res.ok) setReactions(res.data);
      else {
        setReactions(previous);
        toast.error("Couldn't save that reaction.");
      }
    },
    [busy, reactions, ownerId, item.noteId],
  );

  const loadComments = useCallback(async () => {
    if (comments || commentsLoading) return;
    setCommentsLoading(true);
    const res = await getComments(ownerId, item.noteId);
    setCommentsLoading(false);
    if (res.ok) setComments(res.data.comments);
    else toast.error("Couldn't load comments.");
  }, [comments, commentsLoading, ownerId, item.noteId]);

  useEffect(() => {
    if (expanded) void loadComments();
  }, [expanded, loadComments]);

  const send = useCallback(async () => {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    const res = await addComment(ownerId, item.noteId, body);
    setSending(false);
    if (res.ok) {
      setComments(res.data.comments);
      setDraft('');
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } else {
      toast.error("Couldn't post that comment.");
    }
  }, [draft, sending, ownerId, item.noteId]);

  const shownKinds = useMemo(
    () => REACTION_KINDS.filter((k) => (reactions?.counts?.[k] ?? 0) > 0),
    [reactions],
  );

  return (
    <View
      style={
        // Search mode keeps the flat, borderless row: the transcript-search screen
        // is a list of results, and drawing every result as a card there makes the
        // page read as a feed you can act on, which it is not.
        searchMode
          ? { paddingVertical: 18, borderBottomWidth: 1, borderBottomColor: RULE, gap: 12 }
          : {
              padding: CARD_PAD,
              borderRadius: CARD_RADIUS,
              backgroundColor: CARD_BG,
              borderWidth: 1,
              borderColor: CARD_BORDER,
              gap: 13,
              // A whisper of lift, not a drop shadow. The cards sit on cream; enough
              // shadow to separate them from it, not enough to look like Material.
              shadowColor: '#7A5230',
              shadowOpacity: 0.05,
              shadowRadius: 8,
              shadowOffset: { width: 0, height: 2 },
              elevation: 1,
            }
      }
    >
      {/* Author, when, and the clip's length on the right. */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <AuthorDisc name={name} filled={!!item.audio && !heard} />
        <Text
          numberOfLines={1}
          style={{
            flexShrink: 1,
            fontFamily: fonts.body,
            fontSize: 12,
            letterSpacing: 0.36,
            color: INK_92,
          }}
        >
          {name}
        </Text>
        <Text
          numberOfLines={1}
          style={{ flexShrink: 0, fontFamily: fonts.body, fontSize: 12, color: INK_38 }}
        >
          {formatAgo(item.sharedAt)}
        </Text>
        {item.audio && !searchMode ? (
          <Text
            style={{
              marginLeft: 'auto',
              paddingLeft: 8,
              fontFamily: fonts.body,
              fontSize: 11.5,
              color: heard ? INK_45 : ACCENT_700,
              fontVariant: ['tabular-nums'],
            }}
          >
            {mmss(item.audio.durationMs)}
          </Text>
        ) : null}
      </View>

      {/* The player. Absent for transcript-only notes rather than a dead button. */}
      {item.audio && !searchMode ? (
        <VoiceNotePlayer
          ownerId={ownerId}
          noteId={item.noteId}
          durationMs={item.audio.durationMs}
          peaks={item.audio.peaks}
          accent={ACCENT_600}
          showTimer={false}
          dimmed={heard}
          onFirstPlay={() => setHeard(true)}
        />
      ) : null}

      {item.transcript ? (
        // The whole block is the tap target, not just the words: a 12pt "Press to
        // see more" link is a fussy thing to hit, and the obvious gesture on a
        // clipped paragraph is to tap the paragraph.
        <Pressable
          onPress={() => setShowFull((v) => !v)}
          disabled={searchMode || (!clipped && !showFull)}
          accessibilityRole={searchMode ? undefined : 'button'}
          accessibilityLabel={
            searchMode ? undefined : showFull ? 'Collapse transcript' : 'Expand transcript'
          }
          style={({ pressed }) => ({ opacity: pressed ? 0.75 : 1, gap: 5 })}
        >
          {/* CLIPPED BY A HEIGHT CAP, NOT BY numberOfLines — deliberately. With
              numberOfLines={3}, onTextLayout reports the CLAMPED line count, so a
              transcript that is exactly three lines long and one that is thirty both
              report three and are indistinguishable; every short note would offer a
              "see more" that revealed nothing. Rendering the text unclamped inside
              an overflow-hidden box means onTextLayout reports the TRUE line count,
              so the control appears if and only if something is actually hidden.
              maxHeight is an exact multiple of the explicit lineHeight, so the cut
              lands between lines rather than through one. */}
          <View
            style={
              searchMode || showFull
                ? undefined
                : { maxHeight: clampHeight, overflow: 'hidden' }
            }
          >
            <Text
              onTextLayout={(e) => {
                // Two ways to be clipped, and both are exact rather than heuristic:
                // the slice below dropped characters, or the text that survived it
                // still wrapped past the line limit.
                const over =
                  item.transcript!.length > TRANSCRIPT_PREVIEW_CHARS ||
                  e.nativeEvent.lines.length > TRANSCRIPT_PREVIEW_LINES;
                setClipped((prev) => (prev === over ? prev : over));
              }}
              style={{
                fontFamily: fonts.body,
                fontSize: 15.5,
                lineHeight: TRANSCRIPT_LINE_H,
                color: INK_86,
              }}
            >
              {searchMode
                ? highlightRuns(item.transcript, highlight!).map((run, i) => (
                    <Text
                      key={i}
                      style={
                        run.hit
                          ? { color: ACCENT_700, backgroundColor: 'rgba(214,127,72,0.16)' }
                          : undefined
                      }
                    >
                      {run.text}
                    </Text>
                  ))
                : showFull
                  ? item.transcript
                  : item.transcript.slice(0, TRANSCRIPT_PREVIEW_CHARS)}
            </Text>
          </View>
          {!searchMode && (clipped || showFull) ? (
            <Text
              style={{
                fontFamily: fonts.body,
                fontSize: 11.5,
                letterSpacing: 1.1,
                color: ACCENT_700,
              }}
            >
              {showFull ? 'PRESS TO COLLAPSE' : 'PRESS TO SEE MORE'}
            </Text>
          ) : null}
        </Pressable>
      ) : null}

      {/* Tapbacks + the comment count. */}
      {searchMode ? null : (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
        {(picking ? REACTION_KINDS : shownKinds).map((k) => (
          <TapbackPill
            key={k}
            label={REACTION_GLYPH[k]}
            icon={REACTION_ICON[k]}
            a11yLabel={
              picking ? REACTION_LABEL[k] : `${REACTION_LABEL[k]}, ${reactions?.counts?.[k] ?? 0}`
            }
            count={picking ? undefined : reactions?.counts?.[k]}
            mine={reactions?.mine === k}
            onPress={() => void react(k)}
            disabled={busy}
          />
        ))}
        {picking ? (
          // JUST AN X. This used to be a dashed pill reading "close", which sat in
          // the same row as five reaction pills and read as a sixth reaction you
          // could send. An X is unambiguous: it dismisses, it does not post.
          <RoundButton
            onPress={() => setPicking(false)}
            a11yLabel="Close reactions"
          >
            <X size={16} color={INK_45} strokeWidth={2.2} />
          </RoundButton>
        ) : (
          <TapbackPill
            label={reactions?.mine ? 'change' : 'react'}
            dashed
            onPress={() => setPicking(true)}
          />
        )}
        {/* The comment affordance, as a real bordered control on the same 34pt
            rhythm. It was 11.5pt unbordered gray text pinned to the right edge —
            legible as a label, invisible as a button, and a small target.
            Hidden while the picker is open: five pills plus an X plus this would
            wrap to a second line, and the row is a reaction picker at that moment,
            not a place to start commenting. */}
        {picking ? null : (
        <Pressable
          onPress={onToggleComments ?? (() => {})}
          accessibilityRole="button"
          accessibilityLabel={
            commentCount === 0
              ? 'Add a comment'
              : `${commentCount} ${commentCount === 1 ? 'comment' : 'comments'}`
          }
          accessibilityState={{ expanded }}
          hitSlop={8}
          style={({ pressed }) => ({ marginLeft: 'auto', opacity: pressed ? 0.6 : 1 })}
        >
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 7,
              paddingHorizontal: 13,
              height: PILL_H,
              borderRadius: radius.full,
              borderWidth: 1,
              borderColor: expanded ? PILL_ON_BORDER : INK_18,
              backgroundColor: expanded ? 'rgba(214,127,72,0.10)' : 'transparent',
            }}
          >
            <MessageCircle
              size={15}
              color={expanded ? ACCENT_700 : 'rgba(32,30,29,0.62)'}
              strokeWidth={2}
            />
            <Text
              style={{
                fontFamily: fonts.body,
                fontSize: 13,
                lineHeight: 16,
                color: expanded ? ACCENT_700 : 'rgba(32,30,29,0.62)',
                fontVariant: ['tabular-nums'],
              }}
            >
              {commentCount > 0 ? String(commentCount) : 'Comment'}
            </Text>
          </View>
        </Pressable>
        )}
      </View>
      )}

      {/* Comments, hanging off a terracotta rule exactly as the mockup does. */}
      {expanded && !searchMode ? (
        <View
          style={{
            borderLeftWidth: 1,
            borderLeftColor: RULE_COMMENT,
            paddingLeft: 14,
            gap: 12,
            marginTop: 2,
          }}
        >
          {commentsLoading && !comments ? (
            <ActivityIndicator size="small" color={ACCENT_600} />
          ) : null}
          {comments?.map((c) => (
            <View key={c.id} style={{ gap: 3 }}>
              <Text style={{ fontFamily: fonts.body, fontSize: 11.5, letterSpacing: 0.35, color: INK_48 }}>
                {`${c.author.name || c.author.username || 'Amber user'} · ${formatAgo(c.createdAt)}`}
              </Text>
              <Text style={{ fontFamily: fonts.body, fontSize: 14, lineHeight: 22, color: INK_72 }}>
                {c.body}
              </Text>
            </View>
          ))}
          {comments && comments.length === 0 ? (
            <Text style={{ fontFamily: fonts.body, fontSize: 14, color: INK_45 }}>
              No comments yet.
            </Text>
          ) : null}

          <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 10 }}>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              placeholder="Say something"
              placeholderTextColor={INK_38}
              multiline
              maxLength={1000}
              style={{
                flex: 1,
                minHeight: 34,
                maxHeight: 110,
                padding: 0,
                fontFamily: fonts.body,
                fontSize: 14,
                lineHeight: 22,
                color: INK_86,
              }}
            />
            <Pressable
              onPress={() => void send()}
              disabled={!draft.trim() || sending}
              accessibilityRole="button"
              accessibilityLabel="Post comment"
              hitSlop={8}
              style={({ pressed }) => ({
                opacity: !draft.trim() || sending ? 0.35 : pressed ? 0.6 : 1,
                paddingBottom: 4,
              })}
            >
              <Text style={{ fontFamily: fonts.body, fontSize: 11.5, letterSpacing: 1.2, color: ACCENT_700 }}>
                {sending ? 'POSTING…' : 'POST'}
              </Text>
            </Pressable>
          </View>
        </View>
      ) : null}
    </View>
  );
}

export function CircleFeedTab({
  circleId,
  accent = LIGHT.accent,
  refreshKey = 0,
  bottomClearance = 0,
}: {
  circleId: string;
  accent?: string;
  /**
   * Bump to refetch. Used after recording a note INTO this circle: the note is
   * created by the chat pipeline and then shared, so this component has no way to
   * know a new row exists. Cheaper and more predictable than a focus listener,
   * which would also refetch every time a comment sheet closed.
   */
  refreshKey?: number;
  /**
   * Extra bottom padding so posts scroll clear of the record bar that now sits at the
   * bottom of the circle screen. Passed in rather than hard-coded because this feed is
   * also rendered where no such bar exists.
   */
  bottomClearance?: number;
}) {
  const [items, setItems] = useState<FeedItem[]>([]);
  const [status, setStatus] = useState<'loading' | 'done' | 'error'>('loading');
  // Which rows have their comments open. A Set rather than a per-row boolean so
  // opening one does not re-render the others.
  const [openComments, setOpenComments] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    void getCircleFeed(circleId).then((res) => {
      if (cancelled) return;
      if (res.ok) {
        setItems(res.data.items);
        setStatus('done');
      } else {
        setStatus('error');
      }
    });
    return () => {
      cancelled = true;
    };
  }, [circleId, refreshKey]);

  const toggle = useCallback((noteId: string) => {
    setOpenComments((prev) => {
      const next = new Set(prev);
      if (next.has(noteId)) next.delete(noteId);
      else next.add(noteId);
      return next;
    });
  }, []);

  if (status === 'loading') {
    return (
      <View style={{ paddingTop: spacing.xl, alignItems: 'center' }}>
        <ActivityIndicator color={LIGHT.textMuted} />
      </View>
    );
  }
  if (status === 'error') {
    return (
      <View style={{ paddingTop: spacing.xl, alignItems: 'center', paddingHorizontal: spacing.xl }}>
        <Text variant="bodyMd" centered style={{ color: LIGHT.textSecondary }}>
          Could not load this circle&apos;s feed.
        </Text>
      </View>
    );
  }

  return (
    <FlatList
      data={items}
      keyExtractor={(it) => it.noteId}
      // gap, not a separator component: the space between cards IS the separation
      // now that each note has its own edge, and paddingTop gives the first card the
      // same air as the ones below it.
      contentContainerStyle={{
        paddingHorizontal: 20,
        paddingTop: 14,
        paddingBottom: 132 + bottomClearance,
        gap: CARD_GAP,
      }}
      // directionalLockEnabled: this list lives inside a horizontal pager. Without the
      // lock, iOS lets this scroll view claim a slightly-diagonal drag, so the swipe
      // between People / Today / You worked sometimes and did nothing other times
      // depending on the exact angle of the finger. The lock makes a mostly-horizontal
      // drag stay unclaimed here so the pager gets it, every time.
      directionalLockEnabled
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      ListEmptyComponent={
        <View style={{ paddingTop: spacing.xl, alignItems: 'center' }}>
          <Text variant="bodyMd" style={{ color: LIGHT.textMuted }}>
            No shared notes here yet.
          </Text>
        </View>
      }
      renderItem={({ item }) => (
        <FeedRow
          item={item}
          accent={accent}
          expanded={openComments.has(item.noteId)}
          onToggleComments={() => toggle(item.noteId)}
        />
      )}
    />
  );
}

// The transcript-search screen renders this same row with `highlight` set, so one
// card definition serves both surfaces and they cannot drift apart visually.
export { FeedRow as CircleFeedRow };
