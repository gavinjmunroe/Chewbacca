import { ActivityIndicator, Switch, View, type ViewStyle } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { Pressable } from './Pressable';
import { CCard, CSectionHeader, CText } from './classical';
import { HAIRLINE, cl, clLayout, clRadius, clShadow } from '../lib/classical';
import { radius, spacing } from '../lib/tokens';
import { TREND_UP } from '../lib/theme';
import { errorCopy } from '../lib/medhaId';
import { toast } from '../lib/toast';
import type { ConnectionRow } from '../lib/api';
import {
  CATEGORY_ROWS,
  DEFAULT_CATEGORIES,
  DEFAULT_CHANNELS,
  getNotificationPrefs,
  getNotificationSettings,
  patchNotificationCategories,
  patchNotificationSettings,
  setCachedNotificationChannels,
  type NotificationCategories,
  type NotificationChannels,
  type NotificationPrefs,
} from '../lib/notificationSettings';
import { ensureNotificationPermission } from '../lib/reminders';

/**
 * THE PIECES THE PROFILE AND SETTINGS BOTH BUILD OUT OF.
 *
 * WHY THIS FILE EXISTS. Everything in it used to live at the bottom of
 * components/pages/ProfilePage.tsx, because for a while the profile WAS the
 * settings screen -- your name, your circles, your six dimensions, and then your
 * OAuth connections, your notification switches, sign out and delete account, all
 * on one scroll.
 *
 *   "Move the following into the settings at the top, in the gear icon:
 *    Notifications, Contact Support, Delete Account, Sign Out, What Amber Tells
 *    You About, Notifications section, The Network and Connections section. The
 *    profile page ends after the 'What Amber Knows' section."
 *
 * So the second half of that page became components/pages/SettingsPage.tsx, and
 * these are the parts both halves need. THEY ARE MOVED, NOT REWRITTEN -- byte for
 * byte what ProfilePage had, so the two screens cannot drift into looking like
 * two different apps, and so this change is a move rather than a redesign.
 *
 * The alternative was copying Section and DCard into the new file, which is how a
 * codebase ends up with two section headers that are four points apart.
 */

// ── surfaces ─────────────────────────────────────────────────────────────────

export function DCard({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return (
    <View
      style={[
        {
          backgroundColor: cl.card,
          borderRadius: clRadius.card,
          borderWidth: HAIRLINE,
          borderColor: cl.cardHairline,
          padding: clLayout.cardPadX,
          ...clShadow.card,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

/** A loading placeholder. */
export function Block({
  w,
  h,
  radius: r = radius.sm,
}: {
  w: number | `${number}%`;
  h: number;
  radius?: number;
}) {
  return <View style={{ width: w, height: h, borderRadius: r, backgroundColor: '#EFECE8' }} />;
}

export function Section({
  title,
  subtitle,
  right,
  onPressRight,
  prominent,
  children,
}: {
  title: string;
  subtitle?: string;
  /** Optional right-hand action in the header rule, e.g. "+ New". */
  right?: string;
  onPressRight?: () => void;
  /** Larger head and a gold action. See CSectionHeader. */
  prominent?: boolean;
  children: React.ReactNode;
}) {
  return (
    <View>
      <CSectionHeader
        title={title}
        right={right}
        onPressRight={onPressRight}
        prominent={prominent}
      />
      {subtitle ? (
        <CText
          t="metaSm"
          color={cl.ink50}
          style={{
            paddingHorizontal: clLayout.textGutter,
            paddingBottom: clLayout.kickerGap,
            marginTop: -6,
          }}
        >
          {subtitle}
        </CText>
      ) : null}
      <View style={{ paddingHorizontal: clLayout.gutter }}>{children}</View>
    </View>
  );
}

// ── small controls ───────────────────────────────────────────────────────────

export function RetryRow({ label, onRetry }: { label: string; onRetry: () => void }) {
  return (
    <View style={{ gap: spacing.sm }}>
      <CText t="body" color={cl.ink55}>
        {label}
      </CText>
      <Pressable onPress={onRetry} hitSlop={8} accessibilityRole="button" accessibilityLabel="Retry">
        <CText t="listTitle" color={cl.goldDeep}>
          Try again
        </CText>
      </Pressable>
    </View>
  );
}

export function SecondaryButton({
  label,
  onPress,
  loading,
}: {
  label: string;
  onPress: () => void;
  loading?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={loading}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={{ alignSelf: 'flex-start' }}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          height: 42,
          paddingHorizontal: 18,
          borderRadius: clRadius.chip,
          borderWidth: HAIRLINE,
          borderColor: cl.gold55,
          backgroundColor: 'rgba(255,255,255,0.6)',
        }}
      >
        {loading ? <ActivityIndicator color={cl.goldDeep} size="small" /> : null}
        <CText t="listTitle" color={cl.goldDeep}>
          {label}
        </CText>
      </View>
    </Pressable>
  );
}

export function StatusDot({ connected, warn }: { connected: boolean; warn?: boolean }) {
  const color = warn ? cl.gold : connected ? TREND_UP : cl.ink30;
  return <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />;
}

export function PlatformRow({
  label,
  blurb,
  status,
  busy,
  onConnect,
  onDisconnect,
}: {
  label: string;
  blurb: string;
  status?: ConnectionRow;
  busy: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
}) {
  const connected = !!status?.connected;
  const needsUpgrade = connected && !!status?.needsScopeUpgrade;
  const actionLabel = needsUpgrade ? 'Reconnect' : connected ? 'Disconnect' : 'Connect';
  const onAction = needsUpgrade ? onConnect : connected ? onDisconnect : onConnect;
  const actionColor = connected && !needsUpgrade ? cl.ink50 : cl.goldDeep;

  return (
    <DCard>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.base }}>
        <StatusDot connected={connected} warn={needsUpgrade} />
        <View style={{ flex: 1, gap: 2 }}>
          <CText t="listTitle">{label}</CText>
          <CText t="metaSm" color={cl.ink48} numberOfLines={2}>
            {needsUpgrade ? 'Reconnect to grant the access Amber needs.' : blurb}
          </CText>
        </View>
        <Pressable
          onPress={onAction}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel={`${actionLabel} ${label}`}
          hitSlop={8}
          style={({ pressed }) => ({ opacity: busy ? 0.4 : pressed ? 0.6 : 1, paddingLeft: spacing.sm })}
        >
          {busy ? (
            <ActivityIndicator size="small" color={cl.gold} />
          ) : (
            <CText t="listTitle" color={actionColor} style={{ fontSize: 14, lineHeight: 18 }}>
              {actionLabel}
            </CText>
          )}
        </Pressable>
      </View>
    </DCard>
  );
}

// A settings row whose action is a native Switch. Mirrors CListRow's layout
// (title + sub, hairline between rows) but is non-pressable — the switch owns
// the interaction, so there's no chevron.
export function NotificationToggleRow({
  title,
  sub,
  value,
  disabled,
  onValueChange,
  first = false,
}: {
  title: string;
  sub: string;
  value: boolean;
  disabled?: boolean;
  onValueChange: (v: boolean) => void;
  first?: boolean;
}) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 13,
        paddingHorizontal: clLayout.cardPadX,
        paddingVertical: clLayout.rowPadY,
        borderTopWidth: first ? 0 : HAIRLINE,
        borderTopColor: cl.ruleSoft,
      }}
    >
      <View style={{ flex: 1, minWidth: 0 }}>
        <CText t="listTitle" color={cl.ink} numberOfLines={1}>
          {title}
        </CText>
        <CText t="metaSm" color={cl.ink48} numberOfLines={2} style={{ marginTop: 1 }}>
          {sub}
        </CText>
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
        trackColor={{ false: '#D9D4CE', true: cl.gold }}
        ios_backgroundColor="#D9D4CE"
        accessibilityLabel={title}
      />
    </View>
  );
}

// ── the two notification sections ────────────────────────────────────────────

// Two toggles for how reminders reach you. "Apple notifications" is the app's
// own on-device local notifications (lib/reminders schedules them, gated on this
// channel); "iMessage" is delivered entirely server-side (Amber texts you), so
// the app only reads/writes the switch. Reads GET on mount, PATCHes the changed
// key optimistically, and reverts on error. Turning Apple ON first requests iOS
// permission — if that's denied the switch stays off so it never lies.
export function NotificationsSection() {
  const qc = useQueryClient();

  const settingsQuery = useQuery({
    queryKey: ['notificationSettings'],
    // Force a fresh read on mount so the toggles reflect the server, not a stale
    // process cache; the module still caches the result for lib/reminders.
    queryFn: () => getNotificationSettings(true),
  });
  const channels = settingsQuery.data ?? DEFAULT_CHANNELS;

  const patchChannel = useMutation({
    mutationFn: (patch: Partial<NotificationChannels>) => patchNotificationSettings(patch),
    onMutate: async (patch) => {
      await qc.cancelQueries({ queryKey: ['notificationSettings'] });
      const previous = qc.getQueryData<NotificationChannels>(['notificationSettings']) ?? channels;
      const next = { ...previous, ...patch };
      qc.setQueryData<NotificationChannels>(['notificationSettings'], next);
      // Keep the reminders cache in step so a reminder created seconds later
      // respects the just-flipped Apple channel without waiting on the network.
      setCachedNotificationChannels(next);
      Haptics.selectionAsync().catch(() => {});
      return { previous };
    },
    onSuccess: (merged) => {
      qc.setQueryData<NotificationChannels>(['notificationSettings'], merged);
      setCachedNotificationChannels(merged);
    },
    onError: (e, _patch, context) => {
      if (context?.previous) {
        qc.setQueryData<NotificationChannels>(['notificationSettings'], context.previous);
        setCachedNotificationChannels(context.previous);
      }
      toast.error('Could not update notifications', errorCopy(e));
    },
  });

  const onToggleApple = async (next: boolean) => {
    if (next) {
      // Turning ON: iOS must actually grant permission, or the toggle is a lie.
      // We prompt BEFORE writing the channel, and only persist true once granted.
      const granted = await ensureNotificationPermission();
      if (!granted) {
        toast.error(
          'Notifications are off for Amber',
          'Turn them on in iOS Settings to get reminders on this phone.',
        );
        // The switch is bound to the query value (still false), so it stays off.
        return;
      }
    }
    patchChannel.mutate({ apple: next });
  };

  const disabled = settingsQuery.isLoading || patchChannel.isPending;

  return (
    <CCard flush>
      <NotificationToggleRow
        first
        title="Apple notifications"
        sub="Everything: reminders, circles, shared notes, requests"
        value={channels.apple}
        disabled={disabled}
        onValueChange={(v) => void onToggleApple(v)}
      />
      <NotificationToggleRow
        title="iMessage"
        // THE TWO CHANNELS DO NOT CARRY THE SAME THINGS, and labeling them as a
        // pair of equals implied they did. iMessage is reminders ONLY: the only
        // thing that ever texts you is jobs/reminder-scheduler.js, and every
        // social event (added to a circle, a note shared with you, a connection
        // request) goes out over push and nothing else. A user who turned Apple
        // off and iMessage on, expecting to move their notifications to Messages,
        // would silently stop hearing about everything except reminders.
        sub="Reminders only, as a text from Amber"
        value={channels.imessage}
        disabled={disabled}
        onValueChange={(v) => patchChannel.mutate({ imessage: v })}
      />
    </CCard>
  );
}

/**
 * THE CATEGORY SWITCHES.
 *
 * Separate from NotificationsSection above on purpose: that one is about HOW a
 * notification reaches you (this phone, or a text) and this one is about WHAT
 * is worth reaching you at all. Merging them put "iMessage" next to "Circles"
 * as if they were the same kind of choice.
 *
 * Every row is optimistic and rolls back on failure, same as the channels: a
 * switch that stays where you left it after a failed write is lying about what
 * the server thinks.
 */
export function NotificationCategoriesSection() {
  const qc = useQueryClient();
  const KEY = ['notificationPrefs'] as const;

  const prefsQuery = useQuery({
    queryKey: KEY,
    queryFn: () => getNotificationPrefs(true),
  });
  const categories = prefsQuery.data?.categories ?? DEFAULT_CATEGORIES;

  const patch = useMutation({
    mutationFn: (p: Partial<NotificationCategories>) => patchNotificationCategories(p),
    onMutate: async (p) => {
      await qc.cancelQueries({ queryKey: KEY });
      const previous = qc.getQueryData<NotificationPrefs>(KEY);
      if (previous) {
        qc.setQueryData<NotificationPrefs>(KEY, {
          ...previous,
          categories: { ...previous.categories, ...p },
        });
      }
      Haptics.selectionAsync().catch(() => {});
      return { previous };
    },
    onSuccess: (merged) => qc.setQueryData<NotificationPrefs>(KEY, merged),
    onError: (e, _p, context) => {
      if (context?.previous) qc.setQueryData<NotificationPrefs>(KEY, context.previous);
      toast.error('Could not update notifications', errorCopy(e));
    },
  });

  const disabled = prefsQuery.isLoading || patch.isPending;

  return (
    <CCard flush>
      {CATEGORY_ROWS.map((row, i) => (
        <NotificationToggleRow
          key={row.key}
          first={i === 0}
          title={row.title}
          sub={row.sub}
          value={categories[row.key]}
          disabled={disabled}
          onValueChange={(v) => patch.mutate({ [row.key]: v })}
        />
      ))}
    </CCard>
  );
}
