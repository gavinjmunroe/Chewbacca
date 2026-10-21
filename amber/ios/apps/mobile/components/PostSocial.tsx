import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X } from 'lucide-react-native';
import { Pressable } from './Pressable';
import { Avatar } from './Avatar';
import { CText } from './classical';
import { cl, HAIRLINE } from '../lib/classical';
import { toast } from '../lib/toast';
import { REACTION_EMOJI, REACTION_LABEL, REACTION_ORDER } from '../lib/noteMedia';
import { COMMENT_MAX } from '../lib/postSocial';
import { useKeyboardClaim } from '../lib/barSuppression';
import { VoiceCommentBubble } from './VoiceCommentBubble';
import type { FeedActions, FeedComment, FeedReactor } from '../lib/feedSocial';

/**
 * THE TWO SHEETS BEHIND A FEED CARD: the whole comment thread, and who reacted.
 *
 * Both are opened from FeedCard and both take `actions` rather than an id, so
 * neither knows whether it is looking at a shared voice note or a network post.
 * See lib/feedSocial for why that split exists.
 *
 * ONE OF EACH, MOUNTED BY THE SECTION, never one per card. A Modal per row is
 * forty modals in the tree on a busy feed, and each one is a native view the OS
 * has to keep alive.
 */

/**
 * The whole thread.
 *
 * LOADED WHEN OPENED. The feed page already carries a count and the last two
 * comments -- one extra grouped query for the whole page -- and the rest come
 * down only for the post somebody actually opened. Fetching every comment on
 * every post to render a number would make the feed slower for everybody so
 * that a minority of posts could open instantly.
 */
export function PostCommentsSheet({
  open,
  actions,
  onClose,
  onCountChange,
}: {
  open: boolean;
  /** null while nothing is open. */
  actions: FeedActions | null;
  onClose: () => void;
  /** So the card underneath updates without refetching the feed. */
  onCountChange?: (count: number, lastTwo: FeedComment[]) => void;
}) {
  const insets = useSafeAreaInsets();
  const [comments, setComments] = useState<FeedComment[] | null>(null);
  const [status, setStatus] = useState<'loading' | 'done' | 'gone'>('loading');
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const claim = useKeyboardClaim();

  useEffect(() => {
    if (!open || !actions) return;
    let alive = true;
    setStatus('loading');
    setComments(null);
    setDraft('');
    void actions.loadComments().then((rows) => {
      if (!alive) return;
      // null is "you cannot see that any more" -- deleted, or the connection it
      // came through has gone. Saying so beats an empty thread, which reads as
      // nobody having said anything.
      setComments(rows ?? []);
      setStatus(rows === null ? 'gone' : 'done');
    });
    return () => {
      alive = false;
    };
  }, [open, actions]);

  const publish = useCallback(
    (rows: FeedComment[]) => {
      setComments(rows);
      onCountChange?.(rows.length, rows.slice(-2));
    },
    [onCountChange],
  );

  const send = useCallback(async () => {
    const body = draft.trim();
    if (!actions || body.length === 0 || sending) return;
    setSending(true);
    const made = await actions.addComment(body);
    setSending(false);
    if (!made) {
      toast.error('Could not post that.');
      return;
    }
    setDraft('');
    publish([...(comments ?? []), made]);
  }, [draft, actions, sending, comments, publish]);

  const remove = useCallback(
    async (commentId: string) => {
      if (!actions) return;
      const before = comments ?? [];
      publish(before.filter((c) => c.id !== commentId));
      const ok = await actions.deleteComment(commentId);
      if (ok) return;
      publish(before);
      toast.error('Could not delete that.');
    },
    [actions, comments, publish],
  );

  const over = draft.trim().length > COMMENT_MAX;

  return (
    <Modal visible={open} animationType="fade" transparent onRequestClose={onClose}>
      <Pressable
        onPress={onClose}
        accessibilityLabel="Close"
        style={{ flex: 1, backgroundColor: 'rgba(32,31,29,0.28)', justifyContent: 'flex-end' }}
      >
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          {/* Swallows the tap so pressing the sheet does not dismiss it. */}
          <Pressable
            onPress={() => {}}
            style={{
              backgroundColor: cl.groundCream,
              borderTopLeftRadius: 22,
              borderTopRightRadius: 22,
              paddingTop: 16,
              paddingBottom: Math.max(insets.bottom, 12) + 8,
              maxHeight: '80%',
            }}
          >
            <SheetHead title="COMMENTS" onClose={onClose} />

            <ScrollView
              style={{ maxHeight: 380 }}
              contentContainerStyle={{ paddingHorizontal: 18, paddingBottom: 12, gap: 14 }}
              keyboardShouldPersistTaps="handled"
            >
              {status === 'loading' ? (
                <CText t="metaSm" color={cl.ink48}>
                  Loading…
                </CText>
              ) : status === 'gone' ? (
                <CText t="metaSm" color={cl.ink48}>
                  That is no longer here.
                </CText>
              ) : (comments ?? []).length === 0 ? (
                <CText t="metaSm" color={cl.ink48}>
                  Nothing yet. Say something.
                </CText>
              ) : (
                (comments ?? []).map((c) => (
                  <CommentRow key={c.id} comment={c} onDelete={() => void remove(c.id)} />
                ))
              )}
            </ScrollView>

            {status === 'gone' ? null : (
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'flex-end',
                  gap: 10,
                  paddingHorizontal: 18,
                  paddingTop: 10,
                  borderTopWidth: HAIRLINE,
                  borderTopColor: cl.gold12,
                }}
              >
                <TextInput
                  value={draft}
                  onChangeText={setDraft}
                  placeholder="Add a comment..."
                  placeholderTextColor={cl.ink32}
                  // Claims the keyboard so Amber's own bar does not ride up on
                  // top of this field. See lib/barSuppression.
                  onFocus={claim.onFocus}
                  onBlur={claim.onBlur}
                  multiline
                  // The server refuses anything longer, so refusing it here is
                  // the difference between a limit and a rejected paragraph.
                  maxLength={COMMENT_MAX}
                  style={{
                    flex: 1,
                    maxHeight: 110,
                    color: cl.ink,
                    fontSize: 15,
                    lineHeight: 21,
                    paddingVertical: 8,
                  }}
                />
                <Pressable
                  onPress={() => void send()}
                  disabled={draft.trim().length === 0 || sending || over}
                  accessibilityRole="button"
                  accessibilityLabel="Send"
                  style={({ pressed }) => ({
                    opacity: draft.trim().length === 0 || over ? 0.35 : pressed ? 0.6 : 1,
                    paddingVertical: 10,
                  })}
                >
                  {sending ? (
                    <ActivityIndicator size="small" color={cl.goldDeep} />
                  ) : (
                    <CText t="listTitle" color={cl.goldDeep}>
                      Send
                    </CText>
                  )}
                </Pressable>
              </View>
            )}
          </Pressable>
        </KeyboardAvoidingView>
      </Pressable>
    </Modal>
  );
}

/**
 * WHO REACTED, AND WITH WHAT.
 *
 * "If you long-press that, you should see who sent which reaction."
 *
 * GROUPED BY REACTION rather than listed flat, because the question somebody is
 * asking when they hold a row of emoji is "who laughed" -- and a flat list of
 * names with a small glyph beside each makes them read every line to answer it.
 */
export function ReactorsSheet({
  open,
  actions,
  onClose,
}: {
  open: boolean;
  actions: FeedActions | null;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [rows, setRows] = useState<FeedReactor[] | null>(null);
  const [status, setStatus] = useState<'loading' | 'done' | 'gone'>('loading');

  useEffect(() => {
    if (!open || !actions) return;
    let alive = true;
    setStatus('loading');
    setRows(null);
    void actions.loadReactors().then((r) => {
      if (!alive) return;
      setRows(r ?? []);
      setStatus(r === null ? 'gone' : 'done');
    });
    return () => {
      alive = false;
    };
  }, [open, actions]);

  const groups = REACTION_ORDER.map((kind) => ({
    kind,
    people: (rows ?? []).filter((r) => r.kind === kind),
  })).filter((g) => g.people.length > 0);

  return (
    <Modal visible={open} animationType="fade" transparent onRequestClose={onClose}>
      <Pressable
        onPress={onClose}
        accessibilityLabel="Close"
        style={{ flex: 1, backgroundColor: 'rgba(32,31,29,0.28)', justifyContent: 'flex-end' }}
      >
        <Pressable
          onPress={() => {}}
          style={{
            backgroundColor: cl.groundCream,
            borderTopLeftRadius: 22,
            borderTopRightRadius: 22,
            paddingTop: 16,
            paddingBottom: Math.max(insets.bottom, 12) + 8,
            maxHeight: '70%',
          }}
        >
          <SheetHead title="REACTIONS" onClose={onClose} />
          <ScrollView contentContainerStyle={{ paddingHorizontal: 18, paddingBottom: 12, gap: 16 }}>
            {status === 'loading' ? (
              <CText t="metaSm" color={cl.ink48}>
                Loading…
              </CText>
            ) : status === 'gone' ? (
              <CText t="metaSm" color={cl.ink48}>
                That is no longer here.
              </CText>
            ) : groups.length === 0 ? (
              <CText t="metaSm" color={cl.ink48}>
                Nobody has reacted yet.
              </CText>
            ) : (
              groups.map((g) => (
                <View key={g.kind} style={{ gap: 9 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                    <CText t="body" style={{ fontSize: 17 }}>
                      {REACTION_EMOJI[g.kind]}
                    </CText>
                    <CText t="kicker" color={cl.ink45}>
                      {`${REACTION_LABEL[g.kind]} · ${g.people.length}`}
                    </CText>
                  </View>
                  {g.people.map((p, i) => (
                    <View
                      key={`${g.kind}-${p.name ?? i}`}
                      style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingLeft: 4 }}
                    >
                      <Avatar name={p.name ?? 'Someone'} url={p.avatarUrl ?? undefined} size={26} />
                      <CText t="body" color={cl.ink}>
                        {p.mine ? 'You' : (p.name ?? 'Someone')}
                      </CText>
                    </View>
                  ))}
                </View>
              ))
            )}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function SheetHead({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 18,
        paddingBottom: 10,
      }}
    >
      <CText t="kicker" color={cl.ink45}>
        {title}
      </CText>
      <Pressable
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="Close"
        hitSlop={12}
        style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}
      >
        <X size={19} color={cl.ink48} strokeWidth={2} />
      </Pressable>
    </View>
  );
}

function CommentRow({ comment, onDelete }: { comment: FeedComment; onDelete: () => void }) {
  const name = comment.author.name ?? 'Someone';
  return (
    <View style={{ flexDirection: 'row', gap: 10 }}>
      <Avatar name={name} url={comment.author.avatarUrl ?? undefined} size={28} />
      <View style={{ flex: 1, gap: 4 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <CText t="metaSm" color={cl.ink} style={{ fontWeight: '600' }}>
            {name}
          </CText>
          {comment.mine ? (
            <Pressable
              onPress={onDelete}
              accessibilityRole="button"
              accessibilityLabel="Delete this comment"
              hitSlop={8}
              style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}
            >
              <CText t="metaXs" color={cl.ink32}>
                Delete
              </CText>
            </Pressable>
          ) : null}
        </View>
        {comment.audio ? (
          <VoiceCommentBubble
            commentId={comment.id}
            durationMs={comment.audio.durationMs}
            peaks={comment.audio.peaks}
          />
        ) : null}
        {comment.text ? (
          <CText t="body" color={cl.ink}>
            {comment.text}
          </CText>
        ) : null}
      </View>
    </View>
  );
}
