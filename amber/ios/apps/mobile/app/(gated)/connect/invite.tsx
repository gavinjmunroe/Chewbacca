import { useCallback, useMemo } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { ArrowLeft, Check } from 'lucide-react-native';
import { Pressable } from '../../../components/Pressable';
import { Avatar } from '../../../components/Avatar';
import { Text } from '../../../components/Text';
import { CText } from '../../../components/classical';
import {
  acceptConnectRequest,
  listIncomingRequests,
  searchConnectUsers,
  sendConnectRequest,
  type ConnectSearchUser,
  connectResultCopy,
} from '../../../lib/connect';
import { errorCopy, unwrapOrThrow } from '../../../lib/medhaId';
import { toast } from '../../../lib/toast';
import { fonts, radius, spacing } from '../../../lib/tokens';
import { LIGHT } from '../../../lib/theme';
import { HAIRLINE, cl } from '../../../lib/classical';

// THE LANDING SCREEN FOR A SHARED PROFILE LINK.
//
// Someone taps a friend's Amber link, the web page hands off to
// `amber://connect?u=<username>`, and this is where they arrive.
//
// It exists because the previous behavior was a dead end. The bridge resolved the
// username and fired an Alert on top of whatever screen the app happened to open — usually
// Home. So the recipient landed on a full app they had no context for, with nothing
// indicating who had invited them, no way to act on it after the alert closed, and nothing
// to go "back" from. Worse, if that person had ALREADY sent them a request, the only place
// to accept it was a section on the Today tab they had no reason to visit.
//
// So: one screen, one person, one action. Every state of the relationship is handled here —
// connect, already asked, they asked you (accept right here), already connected — and there
// is always a way out.
export default function ConnectInviteScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const { u } = useLocalSearchParams<{ u?: string }>();
  const username = typeof u === 'string' ? u.trim().replace(/^@+/, '') : '';

  // Leaving always goes HOME, never `back()`. This screen is usually the first thing in the
  // navigation stack — the app cold-started from a link — so there is nothing behind it, and
  // back() on an empty stack is precisely the "cannot press back" dead end.
  const leave = useCallback(() => {
    router.replace('/(gated)/home');
  }, [router]);

  const personQuery = useQuery({
    queryKey: ['connect', 'invite', username],
    enabled: username.length > 0,
    queryFn: async () => {
      const users = unwrapOrThrow(await searchConnectUsers(username)).users;
      // Search matches on a username PREFIX, so it can return several people. Only an
      // exact match is the person whose card was shared; connecting someone to a near-miss
      // would be worse than failing.
      return (
        users.find((x) => (x.username ?? '').toLowerCase() === username.toLowerCase()) ?? null
      );
    },
  });
  const person: ConnectSearchUser | null = personQuery.data ?? null;

  // Only needed to ACCEPT: the accept endpoint takes a requestId, and the search result
  // only tells us a request exists ('pending_in'). Fetched lazily for that case alone.
  const incomingQuery = useQuery({
    queryKey: ['connect', 'incoming'],
    enabled: person?.status === 'pending_in',
    queryFn: async () => unwrapOrThrow(await listIncomingRequests()).requests,
  });
  const matchingRequestId = useMemo(() => {
    if (!person) return null;
    return (
      incomingQuery.data?.find((r) => r.requester.amberId === person.amberId)?.requestId ?? null
    );
  }, [incomingQuery.data, person]);

  const connect = useMutation({
    mutationFn: async () => unwrapOrThrow(await sendConnectRequest(person!.amberId)),
    onSuccess: (res) => {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      // Say what happened, not what was attempted: a 200 here can mean already
      // connected or already requested, and claiming "request sent" for those is a
      // small lie the user finds out about later.
      toast.success(connectResultCopy(res?.status, firstName));
      void qc.invalidateQueries({ queryKey: ['connect'] });
      leave();
    },
    onError: (e) => toast.error("Couldn't send that request", errorCopy(e)),
  });

  const accept = useMutation({
    mutationFn: async () => unwrapOrThrow(await acceptConnectRequest(matchingRequestId!)),
    onSuccess: () => {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      toast.success(`You and ${firstName} are connected.`);
      void qc.invalidateQueries({ queryKey: ['connect'] });
      leave();
    },
    onError: (e) => toast.error("Couldn't accept that request", errorCopy(e)),
  });

  const fullName = (person?.fullName ?? '').trim() || (person ? `@${person.username}` : '');
  const firstName = fullName.split(/\s+/)[0] || 'them';
  const detail = [person?.occupation, person?.currentCity].filter(Boolean).join(' · ');
  const busy = connect.isPending || accept.isPending;

  return (
    <View style={{ flex: 1, backgroundColor: LIGHT.canvas, paddingTop: insets.top + 8 }}>
      {/* Always present, always leads somewhere. */}
      <View style={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.md }}>
        <Pressable onPress={leave} accessibilityRole="button" accessibilityLabel="Close" hitSlop={10}>
          {({ pressed }) => (
            <View
              style={{
                width: 40,
                height: 40,
                borderRadius: 20,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: 'rgba(255,255,255,0.6)',
                borderWidth: HAIRLINE,
                borderColor: 'rgba(255,255,255,0.7)',
                opacity: pressed ? 0.6 : 1,
              }}
            >
              <ArrowLeft color={cl.ink} size={20} />
            </View>
          )}
        </Pressable>
      </View>

      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xl, gap: spacing.base }}>
        {personQuery.isLoading ? (
          <ActivityIndicator color={cl.goldDeep} />
        ) : !person ? (
          <>
            <Text variant="displaySm" centered style={{ color: LIGHT.textPrimary }}>
              We couldn&apos;t find that profile
            </Text>
            <Text variant="bodyMd" centered style={{ color: LIGHT.textSecondary }}>
              {username
                ? `No Amber account for @${username}. The link may be out of date.`
                : 'That link was missing a username.'}
            </Text>
            <PrimaryPill label="Go to Amber" onPress={leave} />
          </>
        ) : (
          <>
            <Avatar name={fullName} size={92} />
            <View style={{ gap: 4, alignItems: 'center' }}>
              <Text variant="displaySm" centered style={{ color: LIGHT.textPrimary }}>
                {fullName}
              </Text>
              {detail ? (
                <Text variant="bodyMd" centered style={{ color: LIGHT.textSecondary }}>
                  {detail}
                </Text>
              ) : null}
              <CText t="kicker" color={cl.goldKicker} style={{ marginTop: 6 }}>
                SHARED THEIR AMBER PROFILE
              </CText>
            </View>

            {/* One action, chosen by the actual state of the relationship. */}
            {person.status === 'connected' ? (
              <View style={{ alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Check size={16} color={cl.goldDeep} strokeWidth={3} />
                  <Text variant="bodyMd" style={{ color: LIGHT.textSecondary }}>
                    {`You and ${firstName} are already connected.`}
                  </Text>
                </View>
                <PrimaryPill label="Go to Amber" onPress={leave} />
              </View>
            ) : person.status === 'pending_out' ? (
              <View style={{ alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm }}>
                <Text variant="bodyMd" centered style={{ color: LIGHT.textSecondary }}>
                  {`You've already asked to connect with ${firstName}.`}
                </Text>
                <PrimaryPill label="Go to Amber" onPress={leave} />
              </View>
            ) : person.status === 'pending_in' ? (
              <View style={{ alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm }}>
                <Text variant="bodyMd" centered style={{ color: LIGHT.textSecondary }}>
                  {`${firstName} asked to connect with you.`}
                </Text>
                {/* ACCEPT, RIGHT HERE. This is the case that used to strand people: the only
                    accept UI lived in a section of the Today tab, so a recipient following a
                    link had no way to say yes from where the link put them. */}
                <PrimaryPill
                  label={accept.isPending ? 'Accepting…' : 'Accept'}
                  busy={accept.isPending}
                  disabled={busy || !matchingRequestId}
                  onPress={() => accept.mutate()}
                />
                {incomingQuery.isLoading ? (
                  <ActivityIndicator size="small" color={cl.goldDeep} />
                ) : !matchingRequestId ? (
                  <Text variant="captionSm" centered style={{ color: LIGHT.textMuted }}>
                    That request is no longer pending.
                  </Text>
                ) : null}
              </View>
            ) : (
              <View style={{ alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm }}>
                <PrimaryPill
                  label={connect.isPending ? 'Sending…' : `Connect with ${firstName}`}
                  busy={connect.isPending}
                  disabled={busy}
                  onPress={() => connect.mutate()}
                />
                <Pressable onPress={leave} accessibilityRole="button" accessibilityLabel="Not now" hitSlop={8}>
                  {({ pressed }) => (
                    <Text variant="bodySm" style={{ color: LIGHT.textMuted, opacity: pressed ? 0.6 : 1 }}>
                      Not now
                    </Text>
                  )}
                </Pressable>
              </View>
            )}
          </>
        )}
      </View>
    </View>
  );
}

function PrimaryPill({
  label,
  onPress,
  busy = false,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  busy?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityLabel={label}>
      {({ pressed }) => (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 10,
            paddingHorizontal: spacing.xl,
            height: 52,
            borderRadius: radius.full,
            backgroundColor: '#201E1D',
            opacity: disabled ? 0.45 : pressed ? 0.9 : 1,
          }}
        >
          {busy ? <ActivityIndicator size="small" color="#FFF8F0" /> : null}
          <Text style={{ fontFamily: fonts.body, fontSize: 12.5, letterSpacing: 1.6, color: '#FFF8F0' }}>
            {label.toUpperCase()}
          </Text>
        </View>
      )}
    </Pressable>
  );
}
