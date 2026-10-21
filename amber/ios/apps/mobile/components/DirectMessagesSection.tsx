import { memo, useMemo } from 'react';
import { View } from 'react-native';
import { Pressable } from './Pressable';
import { AudioLines, Plus } from 'lucide-react-native';
import { CText } from './classical';
import { cl, clLayout } from '../lib/classical';
import type { DmThread } from '../lib/dms';

// Direct messages, between Network favorites and All contacts on the People tab.
//
// Drawn in the Circles language — the same gold kicker + hairline rule the
// favorites section uses above it, the same 26pt initial disc as the circle
// feed's author disc, the same terracotta accents. It is deliberately NOT a
// second favorites grid: a conversation needs a preview line and a timestamp,
// and four faces in a row cannot carry either.

const HAIRLINE = 1;
const ROW_GAP = 2;
const DISC = 34;
const ACCENT_700 = '#8C491A';
const ACCENT_500 = '#D67F48';
const CARD_BG = '#FFFCF8';
const CARD_BORDER = 'rgba(178,98,45,0.15)';

function initialsOf(name: string): string {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

/** "now" / "12m" / "3h" / "Tue" / "Mar 4" — the density a thread list needs. */
function stamp(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';
  const mins = Math.floor((Date.now() - then) / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 7) {
    return new Date(then).toLocaleDateString(undefined, { weekday: 'short' });
  }
  return new Date(then).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function mmss(totalMs: number): string {
  const s = Math.max(0, Math.round(totalMs / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function ThreadRow({
  thread,
  onOpen,
}: {
  thread: DmThread;
  onOpen: (threadId: string, name: string) => void;
}) {
  const name = thread.other.name || thread.other.username || 'Amber user';
  const unread = thread.unread > 0;
  // A voice memo's preview is its TRANSCRIPT. "Voice message" tells you nothing
  // about whether it is worth opening, which is the only question a preview line
  // exists to answer. The duration is the fallback while the transcript is still
  // being written.
  const preview =
    thread.last.kind === 'voice'
      ? thread.last.body || `Voice message · ${mmss(thread.last.durationMs)}`
      : thread.last.body || '';

  return (
    <Pressable
      onPress={() => onOpen(thread.threadId, name)}
      accessibilityRole="button"
      accessibilityLabel={`Open chat with ${name}${unread ? `, ${thread.unread} unread` : ''}`}
      style={({ pressed }) => ({ opacity: pressed ? 0.75 : 1 })}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 11,
          paddingVertical: 11,
          paddingHorizontal: 13,
          borderRadius: 16,
          backgroundColor: CARD_BG,
          borderWidth: 1,
          borderColor: unread ? 'rgba(178,98,45,0.34)' : CARD_BORDER,
        }}
      >
        <View
          style={{
            width: DISC,
            height: DISC,
            borderRadius: DISC / 2,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: unread ? ACCENT_500 : 'rgba(214,127,72,0.12)',
          }}
        >
          <CText
            t="label"
            color={unread ? '#FFF2EB' : ACCENT_700}
            style={{ fontSize: 11, letterSpacing: 0.4 }}
          >
            {initialsOf(name)}
          </CText>
        </View>

        <View style={{ flex: 1, gap: 2 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <CText t="listTitle" style={{ flex: 1, fontSize: 15 }} numberOfLines={1}>
              {name}
            </CText>
            <CText t="metaSm" color={cl.ink45} style={{ fontSize: 11.5 }}>
              {stamp(thread.last.createdAt)}
            </CText>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
            {thread.last.kind === 'voice' ? (
              <AudioLines size={12} color={ACCENT_700} strokeWidth={2.2} />
            ) : null}
            <CText
              t="metaSm"
              color={unread ? cl.ink : cl.ink55}
              style={{ flex: 1, fontSize: 12.5 }}
              numberOfLines={1}
            >
              {/* "You: " so a list of your own last words is readable as such. */}
              {thread.last.mine && preview ? `You: ${preview}` : preview}
            </CText>
            {unread ? (
              <View
                style={{
                  minWidth: 18,
                  height: 18,
                  borderRadius: 9,
                  paddingHorizontal: 5,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: ACCENT_500,
                }}
              >
                <CText t="label" color="#FFF2EB" style={{ fontSize: 10 }}>
                  {thread.unread > 99 ? '99+' : String(thread.unread)}
                </CText>
              </View>
            ) : null}
          </View>
        </View>
      </View>
    </Pressable>
  );
}

function DirectMessagesSectionBase({
  threads,
  loadError,
  onRetry,
  onOpenThread,
  onNewMessage,
  inset,
}: {
  threads: DmThread[];
  /** True when GET /v1/me/dms failed — rendered distinctly from "none yet". */
  loadError?: boolean;
  onRetry?: () => void;
  onOpenThread: (threadId: string, name: string) => void;
  onNewMessage: () => void;
  inset?: object;
}) {
  const total = useMemo(
    () => threads.reduce((n, t) => n + (t.unread || 0), 0),
    [threads],
  );

  return (
    <View style={{ paddingTop: clLayout.sectionGap }}>
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
          Direct messages
        </CText>
        <View style={{ flex: 1, height: HAIRLINE, backgroundColor: cl.ruleGold }} />
        {total > 0 ? (
          <CText t="kicker" color={ACCENT_700} style={{ fontSize: 10 }}>
            {total > 99 ? '99+' : String(total)}
          </CText>
        ) : null}
      </View>

      <View style={[{ gap: ROW_GAP }, inset]}>
        {loadError ? (
          // A FAILED LOAD MUST NOT LOOK LIKE AN EMPTY INBOX. Same reasoning as
          // the favorites section directly above: rendering "no messages yet"
          // over a 500 makes a real conversation look deleted.
          <Pressable
            onPress={onRetry ?? (() => {})}
            accessibilityRole="button"
            accessibilityLabel="Retry loading messages"
            style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
          >
            <View
              style={{
                padding: 14,
                borderRadius: 16,
                backgroundColor: CARD_BG,
                borderWidth: 1,
                borderColor: CARD_BORDER,
              }}
            >
              <CText t="cardTitle">Couldn&apos;t load your messages</CText>
              <CText t="metaSm" color={cl.ink55} style={{ marginTop: 3 }}>
                Your conversations are safe — this is a loading problem. Tap to try
                again.
              </CText>
            </View>
          </Pressable>
        ) : (
          threads.map((t) => (
            <ThreadRow key={t.threadId} thread={t} onOpen={onOpenThread} />
          ))
        )}

        {/* ALWAYS PRESENT, even with no threads — this is how a first
            conversation starts, and an empty section with no way out of it is a
            dead end. With threads above it, it reads as the last row. */}
        {/* ONE ROW, ONE BORDER, NO CHEVRON.
            This was a dashed rounded rectangle containing a dashed circle
            containing a plus, with a chevron on the end -- three borders and two
            affordance markers for a single action, which is why it read as the
            busiest thing on a page of clean cards. A dashed outline is the
            language this app already uses for "an empty slot you can fill" (the
            favorites grid, the pin rail), and it belongs on the small disc
            rather than wrapped around the whole row. The chevron went with it: a
            plus and a verb already say what the row does. */}
        <Pressable
          onPress={onNewMessage}
          accessibilityRole="button"
          accessibilityLabel={threads.length === 0 ? 'Start a conversation' : 'New message'}
          hitSlop={6}
          style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
        >
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 11,
              paddingVertical: 9,
            }}
          >
            <View
              style={{
                width: DISC,
                height: DISC,
                borderRadius: DISC / 2,
                alignItems: 'center',
                justifyContent: 'center',
                borderWidth: 1,
                borderStyle: 'dashed',
                borderColor: 'rgba(178,98,45,0.45)',
              }}
            >
              <Plus size={15} color={ACCENT_700} strokeWidth={2.4} />
            </View>
            <CText t="listTitle" color={ACCENT_700} style={{ flex: 1 }}>
              {threads.length === 0 ? 'Start a conversation' : 'New message'}
            </CText>
          </View>
        </Pressable>
      </View>
    </View>
  );
}

export const DirectMessagesSection = memo(DirectMessagesSectionBase);
