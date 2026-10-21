import { useCallback, useState } from 'react';
import { ActivityIndicator, TextInput, View } from 'react-native';
import { ArrowUp, Mic, MessageCircle, Share2, X } from 'lucide-react-native';
import { Pressable } from './Pressable';
import { Avatar } from './Avatar';
import { CText } from './classical';
import { cl } from '../lib/classical';
import { toast } from '../lib/toast';
import { useKeyboardClaim } from '../lib/barSuppression';
import { useCommentRecorder } from '../lib/commentVoice';
import { RecordingWaveform } from './RecordingWaveform';
import { VoiceCommentBubble } from './VoiceCommentBubble';
import {
  REACTION_EMOJI,
  REACTION_LABEL,
  REACTION_ORDER,
  type ReactionKind,
} from '../lib/noteMedia';
import {
  applyReaction,
  COMMENT_MAX,
  nextKind,
  type PostReactions,
} from '../lib/postSocial';
import type { FeedActions, FeedComment, FeedSocial } from '../lib/feedSocial';

/**
 * A THING SOMEBODY SHARED, AS THE DESIGN DRAWS IT.
 *
 * The shape is the mockup's, top to bottom: a colored bar across the top of the
 * card, the sharer with their avatar and a "Work · 2h" line, the circle it went
 * to as a chip on the right, the thing itself, then a row of reactions with a
 * comment count and a share, then up to two comments, then a box that says "Add
 * a comment...".
 *
 * ONE CARD FOR BOTH KINDS OF ROW. The feed holds shared voice notes and network
 * posts, which live in different tables behind different routes -- but to
 * somebody reading the page they are both "something a person said", and two
 * components would drift into looking like two features. The differences are
 * handled by `actions`, built per row in lib/feedSocial.
 *
 * THE COLOR IS THE CIRCLE'S OWN. A note shared to Work is the color Work
 * already is everywhere else in the app; Amber does not assign it here. A post
 * to the whole network has no circle and takes the page's gold.
 */
export function FeedCard({
  authorName,
  authorAvatarUrl,
  meta,
  chipLabel,
  accent,
  social,
  actions,
  myAvatarUrl,
  myName,
  onCountChange,
  onOpenComments,
  onShowReactors,
  onShare,
  children,
}: {
  authorName: string;
  authorAvatarUrl?: string | null;
  /** "Work · 2h" -- the audience and how long ago, already assembled. */
  meta: string;
  /** The circle it went to, or null for the whole network. */
  chipLabel: string | null;
  accent: string;
  social: FeedSocial;
  actions: FeedActions;
  myAvatarUrl?: string | null;
  myName?: string | null;
  /** So the row above can keep the count when the full sheet changes it. */
  onCountChange?: (n: number) => void;
  /** Open the whole thread. Only offered when there is more than the card shows. */
  onOpenComments: () => void;
  onShowReactors: () => void;
  onShare?: () => void;
  /** The body: a transcript, a post, a waveform. */
  children: React.ReactNode;
}) {
  /**
   * THE LOCAL COPY EXISTS ONLY ONCE SOMETHING HAS BEEN DONE.
   *
   * `null` means "no local opinion, draw the server's" -- so a refetch that
   * brings somebody else's reaction in is not fighting a stale override, which
   * is what plain state seeded from a prop does.
   */
  const [localReactions, setLocalReactions] = useState<PostReactions | null>(null);
  const shown = localReactions ?? social.reactions;

  const [localComments, setLocalComments] = useState<FeedComment[] | null>(null);
  const comments = localComments ?? social.comments;
  const [count, setCount] = useState<number | null>(null);
  const commentCount = count ?? social.commentCount;

  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);

  /**
   * THE ROW SIZES ITSELF TO THE PHONE IT IS ON.
   *
   * Six emoji plus counts plus a comment button plus a share have to fit at
   * 320pt as well as at 430. Measured rather than assumed; 0 until the first
   * layout, and the fallback is the SMALL end because growing after measuring
   * is invisible and shrinking after measuring is a jump.
   */
  const [rowWidth, setRowWidth] = useState(0);
  const roomy = rowWidth >= 330;
  const glyph = roomy ? 19 : 16;
  const pad = roomy ? 5 : 3;

  /**
   * OPTIMISTIC, AND IT ROLLS BACK. A tap that waits for a round trip before it
   * lights up reads as a tap that did not register, so people tap again -- and
   * the second tap is an UNDO, which turns a slow network into "react and
   * immediately un-react". The count moves first; a failure puts the old value
   * back and says so.
   */
  const react = useCallback(
    (kind: ReactionKind) => {
      const before = localReactions ?? social.reactions;
      setLocalReactions(applyReaction(before, kind));
      void actions.react(nextKind(before, kind)).then((res) => {
        if (res) {
          // The server's counts, which include everybody else's -- ours was a
          // guess about one row of a shared object.
          setLocalReactions(res);
          return;
        }
        setLocalReactions(before);
        toast.error('Could not save that reaction.');
      });
    },
    [localReactions, social.reactions, actions],
  );

  /**
   * A VOICE COMMENT: record, upload, transcribe, post.
   *
   * The transcript comes back from the SERVER and becomes the comment's text --
   * which is what makes a voice comment searchable, readable in a notification,
   * and counted exactly like a typed one. "Shown with the voice" means both: the
   * waveform plays and the words sit under it.
   *
   * A FAILED TRANSCRIPTION IS NOT A FAILED COMMENT. An empty transcript posts
   * the clip anyway, because that is also what two seconds of laughing produces.
   */
  const recorder = useCommentRecorder();
  const claim = useKeyboardClaim();

  const postComment = useCallback(
    async (body: string, mediaId?: string) => {
      const made = await actions.addComment(body, mediaId);
      if (!made) {
        toast.error('Could not post that.');
        return;
      }
      const next = [...comments, made].slice(-2);
      setLocalComments(next);
      const total = commentCount + 1;
      setCount(total);
      onCountChange?.(total);
    },
    [actions, comments, commentCount, onCountChange],
  );

  const finishRecording = useCallback(async () => {
    const clip = await recorder.stop();
    if (!clip) return;
    const uploaded = await recorder.upload(clip);
    if (!uploaded) return;
    await postComment(uploaded.transcript, uploaded.mediaId);
  }, [recorder, postComment]);

  const cancelRecording = useCallback(async () => {
    await recorder.cancel();
  }, [recorder]);

  /**
   * THE CARD SHOWS THE LAST TWO, so a third pushes the oldest off rather than
   * growing the card. What must NOT happen is the count staying at 2 -- the
   * comments button is the only way to the rest, and a button reading 2 above
   * two visible comments looks like there is nothing behind it.
   */
  const send = useCallback(async () => {
    const body = draft.trim();
    if (body.length === 0 || body.length > COMMENT_MAX || sending) return;
    setSending(true);
    setDraft('');
    await postComment(body);
    setSending(false);
  }, [draft, sending, postComment]);

  const over = draft.trim().length > COMMENT_MAX;
  const hidden = Math.max(0, commentCount - comments.length);

  return (
    <View
      style={{
        borderRadius: 20,
        overflow: 'hidden',
        backgroundColor: withAlpha(accent, 0.09),
      }}
    >
      {/* The bar across the top. The card's own tint is a wash of the same
          color, so the two read as one object rather than as a card with a
          stripe glued to it. */}
      <View style={{ height: 5, backgroundColor: accent }} />

      <View style={{ paddingHorizontal: 16, paddingTop: 14, paddingBottom: 12, gap: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 11 }}>
          <Avatar name={authorName} url={authorAvatarUrl ?? undefined} size={40} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <CText t="cardName" numberOfLines={1}>
              {authorName}
            </CText>
            <CText t="metaXs" color={cl.ink45} numberOfLines={1} style={{ marginTop: 1 }}>
              {meta}
            </CText>
          </View>
          {chipLabel ? (
            <View
              style={{
                paddingHorizontal: 10,
                paddingVertical: 4,
                borderRadius: 999,
                backgroundColor: withAlpha(accent, 0.18),
              }}
            >
              <CText t="labelXs" color={readableOn(accent)} numberOfLines={1}>
                {chipLabel.toUpperCase()}
              </CText>
            </View>
          ) : null}
        </View>

        {children}

        {/* ── reactions, comments, share ─────────────────────────────── */}
        {/*
          EVERY EMOJI IS ON THE CARD, ALWAYS.

          "I don't like that I have to press the heart for the other emojis to
           come up. All the emojis should just be there, along with the comments
           button next to it."

          The first version drew only the reactions people had already used and
          hid the rest behind a heart that opened a picker -- so an untouched
          post offered one emoji and a hidden menu, and reacting took two taps.
          The row is the full set now: tap one, it lights and it counts.

          AND IT DOES NOT GET CUT OFF. Six emoji, a comment button and a share
          have to fit a phone at its narrowest, so the row MEASURES itself and
          sizes the glyphs to the width it actually got rather than to a
          constant that happens to fit one device. Before the first layout it
          uses the small end, because growing after measuring is invisible and
          shrinking after measuring is a visible jump.
        */}
        <View
          onLayout={(e) => setRowWidth(e.nativeEvent.layout.width)}
          style={{ flexDirection: 'row', alignItems: 'center' }}
        >
          {REACTION_ORDER.map((kind) => {
            const count = shown.counts[kind] ?? 0;
            const mine = shown.mine === kind;
            return (
              <Pressable
                key={kind}
                onPress={() => react(kind)}
                onLongPress={onShowReactors}
                delayLongPress={320}
                accessibilityRole="button"
                accessibilityLabel={`${REACTION_LABEL[kind]}${count > 0 ? `, ${count}` : ''}, hold to see who`}
                hitSlop={6}
                style={({ pressed }) => ({
                  opacity: pressed ? 0.55 : 1,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 3,
                  paddingHorizontal: pad,
                  paddingVertical: 4,
                  borderRadius: 999,
                  // Lit only when it is YOURS. An unused emoji is an offer, not
                  // a chip, so it carries no fill and no border.
                  backgroundColor: mine ? '#FFFFFF' : 'transparent',
                })}
              >
                <CText
                  t="metaSm"
                  style={{
                    fontSize: glyph,
                    // Room for the glyph's own descenders. Without it the emoji
                    // clip along the bottom, which is what "a little cut off"
                    // was.
                    lineHeight: Math.round(glyph * 1.32),
                    opacity: mine || count > 0 ? 1 : 0.45,
                  }}
                >
                  {REACTION_EMOJI[kind]}
                </CText>
                {count > 0 ? (
                  <CText t="metaXs" color={mine ? cl.ink : cl.ink48}>
                    {String(count)}
                  </CText>
                ) : null}
              </Pressable>
            );
          })}

          <View style={{ width: 6 }} />

          <Pressable
            onPress={onOpenComments}
            accessibilityRole="button"
            accessibilityLabel="Comments"
            hitSlop={8}
            style={({ pressed }) => ({
              opacity: pressed ? 0.6 : 1,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 4,
              paddingVertical: 4,
            })}
          >
            <MessageCircle size={Math.round(glyph * 0.88)} color={cl.ink48} strokeWidth={2} />
            {commentCount > 0 ? (
              <CText t="metaXs" color={cl.ink48}>
                {String(commentCount)}
              </CText>
            ) : null}
          </Pressable>

          <View style={{ flex: 1 }} />

          {onShare ? (
            <Pressable
              onPress={onShare}
              accessibilityRole="button"
              accessibilityLabel="Share"
              hitSlop={8}
              style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, paddingVertical: 4 })}
            >
              <Share2 size={Math.round(glyph * 0.88)} color={cl.ink48} strokeWidth={2} />
            </Pressable>
          ) : null}
        </View>

        {/* ── the last two comments ──────────────────────────────────── */}
        {comments.length > 0 ? (
          <View style={{ gap: 9 }}>
            {comments.map((c) => (
              <View key={c.id} style={{ flexDirection: 'row', gap: 9 }}>
                <Avatar name={c.author.name ?? 'Someone'} url={c.author.avatarUrl ?? undefined} size={22} />
                <View style={{ flex: 1, gap: 5 }}>
                  {c.audio ? (
                    /* SHOWN WITH THE VOICE: the waveform plays, and the
                       transcript sits under it as ordinary text. */
                    <VoiceCommentBubble
                      commentId={c.id}
                      durationMs={c.audio.durationMs}
                      peaks={c.audio.peaks}
                      tint={accent}
                    />
                  ) : null}
                  {c.text ? (
                    <CText t="metaSm" color={cl.ink}>
                      <CText t="metaSm" color={cl.ink} style={{ fontWeight: '600' }}>
                        {`${c.author.name ?? 'Someone'}  `}
                      </CText>
                      {c.text}
                    </CText>
                  ) : (
                    /* A clip with no words -- a failed transcription, or two
                       seconds of laughing. The name still has to be said, or the
                       waveform belongs to nobody. */
                    <CText t="metaXs" color={cl.ink45}>
                      {c.author.name ?? 'Someone'}
                    </CText>
                  )}
                </View>
              </View>
            ))}
            {hidden > 0 ? (
              <Pressable
                onPress={onOpenComments}
                accessibilityRole="button"
                accessibilityLabel="See all comments"
                hitSlop={6}
                style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, paddingLeft: 31 })}
              >
                <CText t="metaXs" color={cl.goldDeep}>
                  {`See ${hidden} more comment${hidden === 1 ? '' : 's'}`}
                </CText>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        {/* ── add a comment ──────────────────────────────────────────── */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
          <Avatar name={myName ?? 'You'} url={myAvatarUrl ?? undefined} size={26} />
          <View
            style={{
              flex: 1,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 8,
              paddingLeft: 13,
              paddingRight: 8,
              borderRadius: 999,
              backgroundColor: 'rgba(255,255,255,0.75)',
            }}
          >
            {recorder.recording ? (
              /*
                WHILE RECORDING THE FIELD BECOMES THE WAVEFORM. A text box next
                to a live microphone is two things asking for the same attention,
                and the thing somebody needs to see is that it is hearing them.
              */
              <>
                <RecordingWaveform getMetering={recorder.getMetering} height={22} />
                <Pressable
                  onPress={() => void cancelRecording()}
                  accessibilityRole="button"
                  accessibilityLabel="Cancel recording"
                  hitSlop={8}
                  style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
                >
                  <X size={17} color={cl.ink48} strokeWidth={2} />
                </Pressable>
                <Pressable
                  onPress={() => void finishRecording()}
                  accessibilityRole="button"
                  accessibilityLabel="Send recording"
                  hitSlop={8}
                  style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
                >
                  <ArrowUp size={19} color={cl.goldDeep} strokeWidth={2.4} />
                </Pressable>
              </>
            ) : (
              <>
                <TextInput
                  value={draft}
                  onChangeText={setDraft}
                  placeholder="Add a comment..."
                  placeholderTextColor={cl.ink38}
                  maxLength={COMMENT_MAX}
                  returnKeyType="send"
                  onSubmitEditing={() => void send()}
                  /*
                    CLAIMS THE KEYBOARD. Without this, Amber's own search bar
                    rides up with the keyboard and sits on top of the field you
                    are typing into -- "when I press somewhere to type, the
                    search bar should not come up with it; just the keyboard
                    should." See lib/barSuppression.
                  */
                  onFocus={claim.onFocus}
                  onBlur={claim.onBlur}
                  style={{ flex: 1, color: cl.ink, fontSize: 14, paddingVertical: 9 }}
                />
                {sending || recorder.uploading ? (
                  <ActivityIndicator size="small" color={cl.goldDeep} />
                ) : draft.trim().length > 0 ? (
                  <Pressable
                    onPress={() => void send()}
                    disabled={over}
                    accessibilityRole="button"
                    accessibilityLabel="Send"
                    hitSlop={8}
                    style={({ pressed }) => ({ opacity: over ? 0.35 : pressed ? 0.6 : 1 })}
                  >
                    <CText t="metaSm" color={cl.goldDeep}>
                      Send
                    </CText>
                  </Pressable>
                ) : (
                  /*
                    THE MIC IS ONLY OFFERED WHEN THERE IS NOTHING TYPED, so the
                    same corner is never two buttons. A half-written comment and
                    a recording are two different messages, and a mic beside a
                    draft invites losing one of them.
                  */
                  <Pressable
                    onPress={() => void recorder.start()}
                    accessibilityRole="button"
                    accessibilityLabel="Record a voice comment"
                    hitSlop={8}
                    style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, padding: 2 })}
                  >
                    <Mic size={17} color={cl.ink48} strokeWidth={2} />
                  </Pressable>
                )}
              </>
            )}
          </View>
        </View>
      </View>
    </View>
  );
}

/**
 * A hex color at an opacity, as an rgba string.
 *
 * The accent is a circle's own color and can be any of the twenty-four in the
 * palette, so the wash is derived rather than chosen. Anything unparseable is
 * returned untouched -- it is still a valid color to the platform, and an
 * unpainted card beats one painted `NaN`.
 */
function withAlpha(hex: string, alpha: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

/**
 * Ink that can be read on a wash of this color.
 *
 * THE CHIP IS THE PROBLEM THIS SOLVES. Its text is the circle's own color on an
 * 18% wash of that same color, and the palette runs from #E0A45C to #2E2B25 --
 * so the pale end of it is a yellow label on a yellow ground. Anything too
 * light for the wash is darkened toward the page's ink instead of drawn as
 * given.
 */
function readableOn(hex: string): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return cl.ink;
  const n = parseInt(m[1], 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  // Rec. 601 luma, which is what the eye reads as "how light is this".
  const luma = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luma > 0.62 ? cl.ink : hex;
}
