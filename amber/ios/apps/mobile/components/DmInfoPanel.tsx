import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, View } from 'react-native';
import { Ban, ChevronRight, Download, Flag, Pin, Trash2 } from 'lucide-react-native';
import { Pressable } from './Pressable';
import { Avatar } from './Avatar';
import { CText } from './classical';
import { getContactRank, type ContactRank } from '../lib/contactRank';
import { listPinnedDmMessages, type DmMessage, type DmPerson } from '../lib/dms';
import { getNotificationPrefs, setPersonMuted } from '../lib/notificationSettings';
import { toast } from '../lib/toast';

/**
 * THE INFO TAB OF A DIRECT MESSAGE THREAD.
 *
 * A chat used to be only its messages: to see who you were talking to, what
 * Amber knew about them, or the voice memo with the address in it, you left the
 * thread and went looking. This is the other half of the same screen — Chat is
 * what was said, Info is who it was with.
 *
 * FOUR THINGS, in the order they are wanted:
 *
 *   1. THEM. Name, handle, and the way through to their card, which is where
 *      every fact, note and experience already lives. This tab does not
 *      duplicate any of that; it links to it.
 *   2. WHERE THE RELATIONSHIP STANDS. The PeopleRank score AND the six
 *      dimensions of health, because the score alone is a number with no
 *      account of itself — "0.62" tells you nothing, "0.62, and everything
 *      Amber knows about her is social and financial" tells you what the app
 *      actually has. Read from the rollup; see lib/contactRank.ts.
 *   3. PINNED MESSAGES. A shared bookmark per thread.
 *   4. THE ACTIONS THAT ARE ABOUT THIS PERSON: mute, export, clear, block.
 *      They were behind a gear icon that also held them; a gear is where you
 *      look for settings and this is where you look for this person.
 *
 * Colors are passed in rather than imported: this panel lives inside
 * DmThreadView's palette (the Circles visual language, not the Classical
 * tokens), and a second copy of those constants is how the two drift.
 */
export type DmInfoTheme = {
  cardBg: string;
  cardBorder: string;
  accent: string;
  accentDeep: string;
  ink: string;
  inkSoft: string;
  inkFaint: string;
};

export function DmInfoPanel({
  threadId,
  name,
  other,
  blocked,
  theme,
  onOpenPerson,
  onExport,
  onClear,
  onToggleBlock,
  onReport,
  onOpenMessage,
}: {
  threadId: string;
  name: string;
  other?: DmPerson | null;
  blocked: boolean;
  theme: DmInfoTheme;
  /** Their contact card. Absent when nobody in the address book is linked. */
  onOpenPerson?: (contactId: string) => void;
  onExport: () => void;
  onClear: () => void;
  onToggleBlock: () => void;
  /** Open the report sheet. The parent owns it, because reporting also blocks. */
  onReport: () => void;
  /** Jump back to a pinned message in the Chat tab. */
  onOpenMessage?: (message: DmMessage) => void;
}) {
  const contactId = other?.contactId ?? null;
  const [rank, setRank] = useState<ContactRank | null>(null);
  const [rankState, setRankState] = useState<'loading' | 'done' | 'error' | 'none'>(
    contactId ? 'loading' : 'none',
  );
  const [pinned, setPinned] = useState<DmMessage[]>([]);
  const [muted, setMuted] = useState<boolean | null>(null);
  const [muting, setMuting] = useState(false);

  useEffect(() => {
    if (!contactId) {
      setRankState('none');
      return;
    }
    let alive = true;
    setRankState('loading');
    void getContactRank(contactId).then((res) => {
      if (!alive) return;
      if (res.ok) {
        setRank(res.data);
        setRankState('done');
      } else {
        setRankState('error');
      }
    });
    return () => {
      alive = false;
    };
  }, [contactId]);

  useEffect(() => {
    let alive = true;
    void listPinnedDmMessages(threadId).then((res) => {
      if (alive && res.ok) setPinned(res.data?.messages ?? []);
    });
    return () => {
      alive = false;
    };
  }, [threadId]);

  useEffect(() => {
    const amberId = other?.amberId;
    if (!amberId) return;
    let alive = true;
    void getNotificationPrefs().then((prefs) => {
      if (alive) setMuted(prefs.muted.includes(String(amberId).toLowerCase()));
    });
    return () => {
      alive = false;
    };
  }, [other?.amberId]);

  const toggleMute = useCallback(async () => {
    const amberId = other?.amberId;
    if (!amberId || muting) return;
    const next = !muted;
    setMuting(true);
    try {
      const list = await setPersonMuted({ amberId, contactId: contactId ?? undefined }, next);
      setMuted(list.includes(String(amberId).toLowerCase()));
      toast.success(next ? `Muted ${first(name)}.` : `Unmuted ${first(name)}.`);
    } catch {
      toast.error('Could not change that just now.');
    } finally {
      setMuting(false);
    }
  }, [other?.amberId, contactId, muted, muting, name]);

  return (
    <ScrollView
      contentContainerStyle={{ padding: 14, gap: 14, paddingBottom: 40 }}
      keyboardShouldPersistTaps="handled"
    >
      {/* ── them ── */}
      <Card theme={theme}>
        <Pressable
          onPress={() => (contactId ? onOpenPerson?.(contactId) : undefined)}
          disabled={!contactId}
          accessibilityRole="button"
          accessibilityLabel={contactId ? `Open ${name}'s card` : name}
          style={({ pressed }) => ({ opacity: pressed && contactId ? 0.6 : 1 })}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <Avatar name={name} size={44} />
            <View style={{ flex: 1 }}>
              <CText t="cardTitle" style={{ fontSize: 17 }} numberOfLines={1}>
                {name}
              </CText>
              <CText t="metaSm" color={theme.inkFaint} style={{ fontSize: 12 }}>
                {other?.username ? `@${other.username}` : 'On Amber'}
                {blocked ? ' · Blocked' : ''}
              </CText>
            </View>
            {contactId ? (
              <ChevronRight size={18} color={theme.inkFaint} strokeWidth={2} />
            ) : null}
          </View>
        </Pressable>
        {!contactId ? (
          // Said plainly rather than showing an empty relationship card: there
          // is genuinely nothing to score, because they are not in the address
          // book at all.
          <CText t="metaSm" color={theme.inkFaint} style={{ fontSize: 12, marginTop: 10 }}>
            They are not in your contacts, so Amber has nothing filed under them yet.
          </CText>
        ) : null}
      </Card>

      {/* ── where the relationship stands ── */}
      {contactId ? (
        <Card theme={theme}>
          <CText t="kicker" color={theme.accentDeep}>
            RELATIONSHIP
          </CText>

          {rankState === 'loading' ? (
            <View style={{ paddingVertical: 16, alignItems: 'center' }}>
              <ActivityIndicator size="small" color={theme.accent} />
            </View>
          ) : rankState === 'error' ? (
            <CText t="metaSm" color={theme.inkFaint} style={{ fontSize: 12, marginTop: 10 }}>
              Could not read this just now.
            </CText>
          ) : rank && rank.computedAt ? (
            <>
              <View style={{ flexDirection: 'row', gap: 18, marginTop: 12 }}>
                <Stat theme={theme} label="Score" value={pct(rank.score)} />
                <Stat theme={theme} label="Warmth" value={pct(rank.warmth)} />
                <Stat theme={theme} label="Last 30d" value={String(rank.interactions.d30)} />
              </View>
              <CText t="metaSm" color={theme.inkFaint} style={{ fontSize: 11.5, marginTop: 10 }}>
                {rank.lastInteractionAt
                  ? `Last anything: ${new Date(rank.lastInteractionAt).toLocaleDateString()} · ${
                      rank.observations
                    } thing${rank.observations === 1 ? '' : 's'} Amber knows`
                  : `${rank.observations} thing${rank.observations === 1 ? '' : 's'} Amber knows`}
              </CText>

              <View style={{ height: 1, backgroundColor: theme.cardBorder, marginVertical: 14 }} />

              <CText t="kicker" color={theme.accentDeep}>
                SIX DIMENSIONS OF HEALTH
              </CText>
              <View style={{ gap: 9, marginTop: 11 }}>
                {rank.dimensions.map((d) => (
                  <DimensionBar key={d.code} theme={theme} dimension={d} />
                ))}
              </View>
              {rank.dimensions.every((d) => d.score <= 0) ? (
                <CText t="metaSm" color={theme.inkFaint} style={{ fontSize: 11.5, marginTop: 10 }}>
                  Nothing is filed against a dimension yet. Talking here counts —
                  every exchange adds to it.
                </CText>
              ) : null}
            </>
          ) : (
            // computedAt null: the rollup has not reached them. NOT rendered as
            // zeroes, which reads as a verdict on the relationship rather than
            // an absence of data.
            <CText t="metaSm" color={theme.inkFaint} style={{ fontSize: 12, marginTop: 10 }}>
              Not enough yet. Amber scores a relationship once it has something to
              go on — notes, messages, or time spent.
            </CText>
          )}
        </Card>
      ) : null}

      {/* ── pinned ── */}
      <Card theme={theme}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
          <Pin size={13} color={theme.accentDeep} strokeWidth={2.2} />
          <CText t="kicker" color={theme.accentDeep}>
            {pinned.length > 0 ? `PINNED · ${pinned.length}` : 'PINNED'}
          </CText>
        </View>
        {pinned.length === 0 ? (
          <CText t="metaSm" color={theme.inkFaint} style={{ fontSize: 12, marginTop: 10 }}>
            Hold any message in the chat to pin it here.
          </CText>
        ) : (
          <View style={{ marginTop: 10 }}>
            {pinned.map((m) => (
              <Pressable
                key={m.id}
                onPress={() => onOpenMessage?.(m)}
                accessibilityRole="button"
                accessibilityLabel="Open this message"
                style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
              >
                <View
                  style={{
                    paddingVertical: 11,
                    borderTopWidth: 1,
                    borderTopColor: theme.cardBorder,
                    gap: 3,
                  }}
                >
                  <CText t="body" color={theme.ink} style={{ fontSize: 14 }} numberOfLines={3}>
                    {m.body?.trim() ||
                      (m.kind === 'voice' ? 'Voice message' : 'Message')}
                  </CText>
                  <CText t="metaSm" color={theme.inkFaint} style={{ fontSize: 11 }}>
                    {`${m.mine ? 'You' : first(name)} · ${new Date(
                      m.createdAt,
                    ).toLocaleDateString()}${m.kind === 'voice' ? ' · voice' : ''}`}
                  </CText>
                </View>
              </Pressable>
            ))}
          </View>
        )}
      </Card>

      {/* ── the actions that are about this person ── */}
      <Card theme={theme} flush>
        {other?.amberId ? (
          <Row
            theme={theme}
            first
            icon={<Ban size={17} color={theme.inkSoft} strokeWidth={1.9} />}
            title={muted ? 'Unmute notifications' : 'Mute notifications'}
            sub={
              muted
                ? 'Their messages arrive quietly'
                : 'No banners from them. They are never told.'
            }
            right={muting ? <ActivityIndicator size="small" color={theme.accent} /> : undefined}
            onPress={() => void toggleMute()}
          />
        ) : null}
        <Row
          theme={theme}
          first={!other?.amberId}
          icon={<Download size={17} color={theme.inkSoft} strokeWidth={1.9} />}
          title="Export this chat"
          sub="Every message, as text you can share"
          onPress={onExport}
        />
        <Row
          theme={theme}
          icon={<Trash2 size={17} color="#9B2C1E" strokeWidth={1.9} />}
          title="Clear this chat"
          sub="Only your copy. Theirs is untouched."
          danger
          onPress={onClear}
        />
        <Row
          theme={theme}
          icon={<Ban size={17} color={blocked ? theme.inkSoft : '#9B2C1E'} strokeWidth={1.9} />}
          title={blocked ? 'Unblock' : 'Block'}
          sub={
            blocked
              ? 'They can message you again'
              : 'They cannot message you, and you cannot message them'
          }
          danger={!blocked}
          onPress={onToggleBlock}
        />
        {/* Blocking and reporting are not the same action and this panel had
            only the first. A block is a private boundary that tells nobody
            anything; a report is a claim that something should stop for
            everybody, and there was nowhere for one to go. */}
        <Row
          theme={theme}
          icon={<Flag size={17} color="#9B2C1E" strokeWidth={1.9} />}
          title="Report this person"
          sub="We review every report. They are blocked and never told."
          danger
          onPress={onReport}
        />
      </Card>
    </ScrollView>
  );
}

const first = (n: string) => (n ?? '').trim().split(/\s+/)[0] || 'them';
const pct = (v: number) => `${Math.round(Math.max(0, Math.min(1, v || 0)) * 100)}%`;

function Card({
  children,
  theme,
  flush,
}: {
  children: React.ReactNode;
  theme: DmInfoTheme;
  flush?: boolean;
}) {
  return (
    <View
      style={{
        backgroundColor: theme.cardBg,
        borderWidth: 1,
        borderColor: theme.cardBorder,
        borderRadius: 18,
        paddingHorizontal: flush ? 0 : 15,
        paddingVertical: flush ? 0 : 14,
      }}
    >
      {children}
    </View>
  );
}

function Stat({ theme, label, value }: { theme: DmInfoTheme; label: string; value: string }) {
  return (
    <View style={{ gap: 2 }}>
      <CText t="cardTitle" style={{ fontSize: 21 }}>
        {value}
      </CText>
      <CText t="metaSm" color={theme.inkFaint} style={{ fontSize: 11 }}>
        {label}
      </CText>
    </View>
  );
}

/**
 * One dimension as a bar. A number per dimension would be six numbers to
 * compare by eye; the bars are the comparison.
 *
 * A dimension with no evidence draws an empty track rather than being hidden,
 * so the card is the same shape for everybody and a gap reads as a gap.
 */
function DimensionBar({
  theme,
  dimension,
}: {
  theme: DmInfoTheme;
  dimension: { label: string; score: number; observations: number };
}) {
  const w = Math.round(Math.max(0, Math.min(1, dimension.score || 0)) * 100);
  return (
    <View style={{ gap: 5 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <CText t="metaSm" color={theme.ink} style={{ fontSize: 12, flex: 1 }}>
          {dimension.label}
        </CText>
        <CText t="metaSm" color={theme.inkFaint} style={{ fontSize: 11 }}>
          {dimension.observations > 0 ? `${w}%` : '—'}
        </CText>
      </View>
      <View
        style={{
          height: 5,
          borderRadius: 3,
          backgroundColor: theme.cardBorder,
          overflow: 'hidden',
        }}
      >
        <View
          style={{
            width: `${w}%`,
            height: '100%',
            borderRadius: 3,
            backgroundColor: theme.accent,
          }}
        />
      </View>
    </View>
  );
}

function Row({
  theme,
  icon,
  title,
  sub,
  onPress,
  right,
  danger,
  first: isFirst,
}: {
  theme: DmInfoTheme;
  icon: React.ReactNode;
  title: string;
  sub?: string;
  onPress: () => void;
  right?: React.ReactNode;
  danger?: boolean;
  first?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={title}
      style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          paddingHorizontal: 15,
          paddingVertical: 14,
          borderTopWidth: isFirst ? 0 : 1,
          borderTopColor: theme.cardBorder,
        }}
      >
        {icon}
        <View style={{ flex: 1, gap: 2 }}>
          <CText t="body" color={danger ? '#9B2C1E' : theme.ink} style={{ fontSize: 15 }}>
            {title}
          </CText>
          {sub ? (
            <CText t="metaSm" color={theme.inkFaint} style={{ fontSize: 11.5 }}>
              {sub}
            </CText>
          ) : null}
        </View>
        {right}
      </View>
    </Pressable>
  );
}
