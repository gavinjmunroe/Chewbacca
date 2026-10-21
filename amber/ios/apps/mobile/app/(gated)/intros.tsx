import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Check, Mail, Phone, X } from 'lucide-react-native';
import { Text } from '../../components/Text';
import { GlassCard } from '../../components/GlassCard';
import { toast } from '../../lib/toast';
import {
  approveIntro,
  declineIntro,
  getIntroContact,
  listIntros,
  type Intro,
  type IntroContact,
} from '../../lib/directory';
import { errorCopy, medhaIdErrorCopy, unwrapOrThrow } from '../../lib/medhaId';
import { radius, spacing } from '../../lib/tokens';
import { LIGHT } from '../../lib/theme';
import { HAIRLINE, cl } from '../../lib/classical';

export default function IntrosScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();

  const incomingQuery = useQuery({
    queryKey: ['intros', 'incoming'],
    queryFn: async () => unwrapOrThrow(await listIntros('incoming')).intros,
  });
  const outgoingQuery = useQuery({
    queryKey: ['intros', 'outgoing'],
    queryFn: async () => unwrapOrThrow(await listIntros('outgoing')).intros,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['intros', 'incoming'] });
    qc.invalidateQueries({ queryKey: ['intros', 'outgoing'] });
  };

  const approveMutation = useMutation({
    mutationFn: (id: string) => approveIntro(id),
    onSuccess: (res) => {
      if (!res.ok) toast.error('Could not approve.', medhaIdErrorCopy(res, 'Amber'));
      else toast.success('Intro approved.');
    },
    onError: (e) => toast.error('Could not approve.', errorCopy(e)),
    onSettled: invalidate,
  });
  const declineMutation = useMutation({
    mutationFn: (id: string) => declineIntro(id),
    onSuccess: (res) => {
      if (!res.ok) toast.error('Could not decline.', medhaIdErrorCopy(res, 'Amber'));
    },
    onError: (e) => toast.error('Could not decline.', errorCopy(e)),
    onSettled: invalidate,
  });

  const incoming = incomingQuery.data ?? [];
  const outgoing = outgoingQuery.data ?? [];

  return (
    <View style={{ flex: 1, backgroundColor: LIGHT.canvas }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.md,
          paddingHorizontal: spacing.lg,
          paddingTop: insets.top + spacing.base,
          paddingBottom: spacing.md,
        }}
      >
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Back"
          hitSlop={10}
        >
          <View
            style={{
              width: 40,
              height: 40,
              borderRadius: radius.full,
              backgroundColor: LIGHT.surface,
              borderWidth: 1,
              borderColor: LIGHT.hairline,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <ArrowLeft color={LIGHT.textPrimary} size={20} />
          </View>
        </Pressable>
        <Text variant="titleMd" style={{ color: LIGHT.textPrimary }}>
          Intros
        </Text>
      </View>

      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: spacing.lg,
          paddingBottom: spacing.xxl,
          gap: spacing.lg,
        }}
        showsVerticalScrollIndicator={false}
      >
        <View style={{ gap: spacing.sm }}>
          <Text variant="microLabel" uppercase>
            Requests to you
          </Text>
          {incomingQuery.isLoading ? (
            <ActivityIndicator color={LIGHT.textMuted} size="small" />
          ) : incoming.length === 0 ? (
            <Text variant="bodySm" style={{ color: LIGHT.textMuted }}>
              No intro requests right now.
            </Text>
          ) : (
            incoming.map((intro) => (
              <IncomingIntroRow
                key={intro.introId}
                intro={intro}
                busy={
                  (approveMutation.isPending && approveMutation.variables === intro.introId) ||
                  (declineMutation.isPending && declineMutation.variables === intro.introId)
                }
                onApprove={() => approveMutation.mutate(intro.introId)}
                onDecline={() => declineMutation.mutate(intro.introId)}
              />
            ))
          )}
        </View>

        <View style={{ gap: spacing.sm }}>
          <Text variant="microLabel" uppercase>
            Your requests
          </Text>
          {outgoingQuery.isLoading ? (
            <ActivityIndicator color={LIGHT.textMuted} size="small" />
          ) : outgoing.length === 0 ? (
            <Text variant="bodySm" style={{ color: LIGHT.textMuted }}>
              You haven&rsquo;t requested any intros yet.
            </Text>
          ) : (
            outgoing.map((intro) => <OutgoingIntroRow key={intro.introId} intro={intro} />)
          )}
        </View>
      </ScrollView>
    </View>
  );
}

function IntroTitle({ intro }: { intro: Intro }) {
  return (
    <Text variant="titleSm" numberOfLines={1} style={{ color: LIGHT.textPrimary }}>
      {intro.contactName ?? 'A contact'}
    </Text>
  );
}

function IncomingIntroRow({
  intro,
  busy,
  onApprove,
  onDecline,
}: {
  intro: Intro;
  busy: boolean;
  onApprove: () => void;
  onDecline: () => void;
}) {
  const decided = intro.status !== 'pending';
  return (
    <GlassCard>
      <View style={{ gap: spacing.sm }}>
        <IntroTitle intro={intro} />
        {intro.message ? (
          <Text variant="captionSm" style={{ color: LIGHT.textSecondary }}>
            {intro.message}
          </Text>
        ) : null}
        {decided ? (
          <Text variant="captionSm" style={{ color: LIGHT.textMuted }}>
            {intro.status === 'approved' ? 'Approved' : 'Declined'}
          </Text>
        ) : (
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <Pressable
              onPress={onDecline}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel="Decline intro"
              hitSlop={6}
              style={({ pressed }) => ({ opacity: busy ? 0.6 : pressed ? 0.85 : 1 })}
            >
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 6,
                  height: 36,
                  paddingHorizontal: spacing.md,
                  borderRadius: radius.full,
                  borderWidth: 1,
                  borderColor: LIGHT.hairlineStrong,
                }}
              >
                <X size={15} color={LIGHT.textSecondary} />
                <Text variant="buttonSm" style={{ color: LIGHT.textSecondary }}>
                  Decline
                </Text>
              </View>
            </Pressable>
            <Pressable
              onPress={onApprove}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel="Approve intro"
              hitSlop={6}
              style={({ pressed }) => ({ opacity: busy ? 0.6 : pressed ? 0.85 : 1 })}
            >
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 6,
                  height: 36,
                  paddingHorizontal: spacing.md,
                  borderRadius: radius.full,
                  backgroundColor: cl.tint100,
                  borderWidth: HAIRLINE,
                  borderColor: cl.gold55,
                }}
              >
                <Check size={15} color={cl.goldDeep} />
                <Text variant="buttonSm" style={{ color: cl.goldDeep }}>
                  Approve
                </Text>
              </View>
            </Pressable>
          </View>
        )}
      </View>
    </GlassCard>
  );
}

function OutgoingIntroRow({ intro }: { intro: Intro }) {
  const [revealed, setRevealed] = useState<IntroContact | null>(null);
  const [loading, setLoading] = useState(false);

  const showContact = async () => {
    if (loading) return;
    setLoading(true);
    const r = await getIntroContact(intro.introId);
    setLoading(false);
    if (!r.ok) {
      toast.error('Could not load contact.', medhaIdErrorCopy(r, 'Amber'));
      return;
    }
    setRevealed(r.data.contact);
  };

  return (
    <GlassCard>
      <View style={{ gap: spacing.sm }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm }}>
          <IntroTitle intro={intro} />
          <IntroStatusChip status={intro.status} />
        </View>

        {intro.status === 'approved' ? (
          revealed ? (
            <View style={{ gap: spacing.xs }}>
              {revealed.phone ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                  <Phone size={14} color={LIGHT.textSecondary} />
                  <Text variant="bodySm" style={{ color: LIGHT.textPrimary }}>
                    {revealed.phone}
                  </Text>
                </View>
              ) : null}
              {revealed.email ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                  <Mail size={14} color={LIGHT.textSecondary} />
                  <Text variant="bodySm" style={{ color: LIGHT.textPrimary }}>
                    {revealed.email}
                  </Text>
                </View>
              ) : null}
              {!revealed.phone && !revealed.email ? (
                <Text variant="captionSm" style={{ color: LIGHT.textMuted }}>
                  No contact details available.
                </Text>
              ) : null}
            </View>
          ) : (
            <Pressable
              onPress={() => void showContact()}
              disabled={loading}
              accessibilityRole="button"
              accessibilityLabel="Show contact"
              hitSlop={6}
              style={({ pressed }) => ({
                alignSelf: 'flex-start',
                opacity: loading ? 0.6 : pressed ? 0.85 : 1,
              })}
            >
              <View
                style={{
                  height: 36,
                  paddingHorizontal: spacing.lg,
                  borderRadius: radius.full,
                  backgroundColor: cl.tint100,
                  borderWidth: HAIRLINE,
                  borderColor: cl.gold55,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {loading ? (
                  <ActivityIndicator size="small" color={cl.goldDeep} />
                ) : (
                  <Text variant="buttonSm" style={{ color: cl.goldDeep }}>
                    Show contact
                  </Text>
                )}
              </View>
            </Pressable>
          )
        ) : null}
      </View>
    </GlassCard>
  );
}

function IntroStatusChip({ status }: { status: Intro['status'] }) {
  const label = status === 'approved' ? 'Approved' : status === 'declined' ? 'Declined' : 'Pending';
  const isApproved = status === 'approved';
  return (
    <View
      style={{
        paddingHorizontal: spacing.md,
        height: 26,
        borderRadius: radius.full,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: isApproved ? LIGHT.chipBg : LIGHT.surfaceSoft,
      }}
    >
      <Text variant="captionSm" style={{ color: isApproved ? LIGHT.chipText : LIGHT.textMuted }}>
        {label}
      </Text>
    </View>
  );
}
