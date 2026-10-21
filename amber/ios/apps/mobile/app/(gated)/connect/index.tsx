import { FlatList, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react-native';
import { Avatar } from '../../../components/Avatar';
import { Text } from '../../../components/Text';
import { listConnections, type Connection } from '../../../lib/connect';
import { unwrapOrThrow } from '../../../lib/medhaId';
import { radius, spacing } from '../../../lib/tokens';
import { LIGHT } from '../../../lib/theme';

export default function ConnectionsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const connectionsQuery = useQuery({
    queryKey: ['connect', 'list'],
    queryFn: async () => unwrapOrThrow(await listConnections()).connections,
  });
  const connections = connectionsQuery.data ?? [];

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
        </Pressable>
        <Text variant="titleMd" style={{ flex: 1, color: LIGHT.textPrimary }}>
          Connections
        </Text>
        {/* INTROS IS NOT LINKED. This was the only way into app/(gated)/intros.tsx, whose
            Approve and Decline buttons call /v1/me/intros/:id/approve and /decline —
            endpoints medha-id does not serve (it has /v1/me/intros and
            /v1/me/intros/:id/contact only), so both taps 404 silently. Rather than ship a
            screen whose primary actions cannot work, the entry point is removed.

            NOTHING WAS DELETED: the route file, lib/directory.ts's approveIntro/declineIntro,
            and the working /contact endpoint all remain. Restoring this is putting the
            Pressable back — once the two endpoints exist. */}
      </View>

      {connectionsQuery.isLoading ? (
        <View style={{ paddingHorizontal: spacing.lg, gap: spacing.sm }}>
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
        </View>
      ) : connectionsQuery.isError ? (
        <View
          style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xl }}
        >
          <Text variant="bodyMd" centered style={{ color: LIGHT.textSecondary }}>
            Couldn&apos;t load your connections.
          </Text>
        </View>
      ) : connections.length === 0 ? (
        <View
          style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xl }}
        >
          <Text variant="bodyMd" centered style={{ color: LIGHT.textMuted }}>
            No connections yet. Find people from the Feed tab.
          </Text>
        </View>
      ) : (
        <FlatList
          data={connections}
          keyExtractor={(c) => c.connectionId}
          contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.xl }}
          renderItem={({ item }) => (
            <ConnectionRow
              connection={item}
              onPress={() => router.push(`/(gated)/u/${item.user.amberId}`)}
            />
          )}
        />
      )}
    </View>
  );
}

function SkeletonRow() {
  return <View style={{ height: 60, borderRadius: radius.lg, backgroundColor: LIGHT.surface }} />;
}

function ConnectionRow({
  connection,
  onPress,
}: {
  connection: Connection;
  onPress: () => void;
}) {
  const fullName = connection.user.fullName ?? connection.user.username ?? 'Amber user';
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={fullName}
      style={({ pressed }) => ({ paddingVertical: spacing.sm, opacity: pressed ? 0.6 : 1 })}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
        <Avatar name={fullName} url={connection.user.avatarUrl ?? undefined} size={44} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="titleMd" numberOfLines={1} style={{ color: LIGHT.textPrimary }}>
            {fullName}
          </Text>
          {connection.user.username ? (
            <Text variant="captionSm" style={{ color: LIGHT.textSecondary }}>
              {`@${connection.user.username}`}
            </Text>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}
