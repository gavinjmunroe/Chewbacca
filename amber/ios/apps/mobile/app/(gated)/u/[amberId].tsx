import { ActivityIndicator, Linking, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowLeft, ExternalLink, Linkedin } from 'lucide-react-native';
import { Avatar } from '../../../components/Avatar';
import { Text } from '../../../components/Text';
import { GlassCard } from '../../../components/GlassCard';
import { errorCopy, medhaIdErrorCopy, unwrapOrThrow } from '../../../lib/medhaId';
import { toast } from '../../../lib/toast';
import {
  createIntro,
  viewUserNetwork,
  viewUserProfile,
  type DirectoryContact,
} from '../../../lib/directory';
import { radius, spacing } from '../../../lib/tokens';
import { LIGHT } from '../../../lib/theme';
import { HAIRLINE, cl } from '../../../lib/classical';

export default function MutualProfileScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { amberId } = useLocalSearchParams<{ amberId: string }>();
  const id = typeof amberId === 'string' ? amberId : '';

  const profileQuery = useQuery({
    queryKey: ['directory', 'profile', id],
    enabled: id.length > 0,
    queryFn: async () => unwrapOrThrow(await viewUserProfile(id)).profile,
  });

  const networkQuery = useQuery({
    queryKey: ['directory', 'network', id],
    enabled: id.length > 0,
    queryFn: async () => unwrapOrThrow(await viewUserNetwork(id)).contacts,
  });

  // Track which contacts have had an intro requested so the button reflects it
  // immediately (no per-contact status comes back from the network read).
  const introMutation = useMutation({
    mutationFn: (contactId: string) => createIntro({ ownerAmberId: id, contactId }),
    onSuccess: (res) => {
      if (!res.ok) {
        toast.error('Could not request intro.', medhaIdErrorCopy(res, 'Amber'));
        return;
      }
      toast.success('Intro requested.');
    },
    onError: (e) => toast.error('Could not request intro.', errorCopy(e)),
  });

  const profile = profileQuery.data;
  const fullName = profile?.fullName ?? profile?.username ?? 'Amber user';
  const caption = [profile?.occupation, profile?.company].filter(Boolean).join(' · ');
  const location = [profile?.currentCity, profile?.hometown].filter(Boolean).join(' · ');
  const contacts = networkQuery.data ?? [];

  const openLinkedin = () => {
    if (!profile?.linkedinUrl) return;
    Linking.openURL(profile.linkedinUrl).catch(() => toast.error('Could not open LinkedIn.'));
  };

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
        <Text variant="titleMd" numberOfLines={1} style={{ flex: 1, color: LIGHT.textPrimary }}>
          {profileQuery.data ? fullName : 'Profile'}
        </Text>
      </View>

      {profileQuery.isLoading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={LIGHT.textMuted} />
        </View>
      ) : profileQuery.isError ? (
        <View
          style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xl }}
        >
          <Text variant="bodyMd" centered style={{ color: LIGHT.textSecondary }}>
            Couldn&rsquo;t load this profile.
          </Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{
            paddingHorizontal: spacing.lg,
            paddingBottom: spacing.xxl,
            gap: spacing.lg,
          }}
          showsVerticalScrollIndicator={false}
        >
          <GlassCard>
            <View style={{ alignItems: 'center', gap: spacing.sm }}>
              <Avatar name={fullName} url={profile?.avatarUrl ?? undefined} size={72} />
              <View style={{ alignItems: 'center', gap: 2 }}>
                <Text variant="displaySm" numberOfLines={1} style={{ color: LIGHT.textPrimary }}>
                  {fullName}
                </Text>
                {profile?.username ? (
                  <Text variant="captionSm" style={{ color: LIGHT.textSecondary }}>
                    {`@${profile.username}`}
                  </Text>
                ) : null}
              </View>
              {caption ? (
                <Text variant="bodySm" centered style={{ color: LIGHT.textSecondary }}>
                  {caption}
                </Text>
              ) : null}
              {location ? (
                <Text variant="captionSm" centered style={{ color: LIGHT.textMuted }}>
                  {location}
                </Text>
              ) : null}
              {profile?.school ? (
                <Text variant="captionSm" centered style={{ color: LIGHT.textMuted }}>
                  {profile.school}
                </Text>
              ) : null}
              {profile?.linkedinUrl ? (
                <Pressable
                  onPress={openLinkedin}
                  accessibilityRole="link"
                  accessibilityHint="Opens LinkedIn"
                  style={({ pressed }) => ({
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: spacing.xs,
                    marginTop: spacing.xs,
                    opacity: pressed ? 0.6 : 1,
                  })}
                >
                  <Linkedin color={LIGHT.accent} size={16} />
                  <Text variant="bodySm" style={{ color: LIGHT.accentText }}>
                    LinkedIn
                  </Text>
                  <ExternalLink color={LIGHT.textMuted} size={13} />
                </Pressable>
              ) : null}
            </View>
          </GlassCard>

          <View style={{ gap: spacing.sm }}>
            <Text variant="microLabel" uppercase>
              Their network
            </Text>
            {networkQuery.isLoading ? (
              <ActivityIndicator color={LIGHT.textMuted} size="small" style={{ marginTop: spacing.sm }} />
            ) : contacts.length === 0 ? (
              <Text variant="bodySm" style={{ color: LIGHT.textMuted }}>
                Nothing shared yet.
              </Text>
            ) : (
              <View style={{ gap: spacing.sm }}>
                {contacts.map((c) => (
                  <NetworkContactRow
                    key={c.contactId}
                    contact={c}
                    busy={
                      introMutation.isPending && introMutation.variables === c.contactId
                    }
                    onRequestIntro={() => introMutation.mutate(c.contactId)}
                  />
                ))}
              </View>
            )}
          </View>
        </ScrollView>
      )}
    </View>
  );
}

function NetworkContactRow({
  contact,
  busy,
  onRequestIntro,
}: {
  contact: DirectoryContact;
  busy: boolean;
  onRequestIntro: () => void;
}) {
  const name = contact.name ?? 'Contact';
  const meta = [contact.title, contact.company, contact.city].filter(Boolean).join(' · ');
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.md,
        padding: spacing.base,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: LIGHT.hairline,
        backgroundColor: LIGHT.surface,
      }}
    >
      <Avatar name={name} url={contact.avatarUrl ?? undefined} size={40} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="titleSm" numberOfLines={1} style={{ color: LIGHT.textPrimary }}>
          {name}
        </Text>
        {meta ? (
          <Text variant="captionSm" numberOfLines={2} style={{ color: LIGHT.textSecondary }}>
            {meta}
          </Text>
        ) : null}
      </View>
      <Pressable
        onPress={onRequestIntro}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel={`Request intro to ${name}`}
        hitSlop={6}
        style={({ pressed }) => ({ opacity: busy ? 0.6 : pressed ? 0.85 : 1 })}
      >
        <View
          style={{
            paddingHorizontal: spacing.md,
            height: 32,
            borderRadius: radius.full,
            backgroundColor: cl.tint100,
            borderWidth: HAIRLINE,
            borderColor: cl.gold55,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {busy ? (
            <ActivityIndicator size="small" color={cl.goldDeep} />
          ) : (
            <Text variant="buttonSm" style={{ color: cl.goldDeep }}>
              Request intro
            </Text>
          )}
        </View>
      </Pressable>
    </View>
  );
}
