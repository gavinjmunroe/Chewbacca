import { useEffect, useState } from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Search, X } from 'lucide-react-native';
import { Avatar } from '../../../components/Avatar';
import { ConnectButton } from '../../../components/ConnectButton';
import { Text } from '../../../components/Text';
import {
  searchConnectUsers,
  sendConnectRequest,
  type ConnectSearchUser,
  connectResultCopy,
} from '../../../lib/connect';
import { errorCopy, medhaIdErrorCopy, unwrapOrThrow } from '../../../lib/medhaId';
import { toast } from '../../../lib/toast';
import { radius, spacing, typography } from '../../../lib/tokens';
import { LIGHT } from '../../../lib/theme';

const SEARCH_DEBOUNCE_MS = 350;

export default function ConnectSearchScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();

  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  const searchQuery = useQuery({
    queryKey: ['connect', 'search', debouncedQuery],
    queryFn: async () => unwrapOrThrow(await searchConnectUsers(debouncedQuery)).users,
    enabled: debouncedQuery.length > 0,
  });
  const results = searchQuery.data ?? [];

  const connectMutation = useMutation({
    mutationFn: (amberId: string) => sendConnectRequest(amberId),
    onSuccess: (res, amberId) => {
      if (res.ok) {
        qc.setQueryData<ConnectSearchUser[]>(['connect', 'search', debouncedQuery], (prev) =>
          prev?.map((u) => (u.amberId === amberId ? { ...u, status: 'pending_out' } : u)),
        );
        // 200 does not mean "sent" — see connectResultCopy.
        toast.success(connectResultCopy(res.data?.status, 'them').replace(' them.', '.'));
      } else {
        toast.error('Could not send request.', medhaIdErrorCopy(res, 'Amber'));
      }
    },
    onError: (e) => toast.error('Could not send request.', errorCopy(e)),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['connect', 'search'] });
      qc.invalidateQueries({ queryKey: ['connect', 'outgoing'] });
    },
  });

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
        <Text variant="titleMd" style={{ color: LIGHT.textPrimary }}>
          Find people
        </Text>
      </View>

      <View style={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.md }}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: spacing.sm,
            backgroundColor: LIGHT.surface,
            borderRadius: radius.lg,
            borderWidth: 1,
            borderColor: LIGHT.hairline,
            paddingHorizontal: spacing.base,
            height: 40,
          }}
        >
          <Search color={LIGHT.textMuted} size={16} strokeWidth={2.25} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search by name, @username, or Amber ID"
            placeholderTextColor={LIGHT.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            style={{
              flex: 1,
              color: LIGHT.textPrimary,
              fontFamily: typography.bodyMd.fontFamily,
              fontSize: typography.bodyMd.fontSize,
              padding: 0,
              height: 40,
            }}
          />
          {query ? (
            <Pressable
              onPress={() => setQuery('')}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Clear search"
            >
              <X color={LIGHT.textMuted} size={16} />
            </Pressable>
          ) : null}
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.xl }}
        keyboardShouldPersistTaps="handled"
      >
        {debouncedQuery.length === 0 ? (
          <Text variant="bodySm" style={{ color: LIGHT.textMuted }}>
            Search for someone by name, username, or Amber ID.
          </Text>
        ) : searchQuery.isLoading ? (
          <View style={{ gap: spacing.sm }}>
            <SkeletonRow />
            <SkeletonRow />
            <SkeletonRow />
          </View>
        ) : searchQuery.isError ? (
          <Text variant="bodySm" style={{ color: LIGHT.textMuted }}>
            Couldn&apos;t search right now.
          </Text>
        ) : results.length === 0 ? (
          <Text variant="bodySm" style={{ color: LIGHT.textMuted }}>
            {`No one matches "${debouncedQuery}".`}
          </Text>
        ) : (
          <View style={{ gap: spacing.xs }}>
            {results.map((user) => (
              <SearchResultRow
                key={user.amberId}
                user={user}
                busy={connectMutation.isPending && connectMutation.variables === user.amberId}
                onConnect={() => connectMutation.mutate(user.amberId)}
                onGoToInbox={() => router.push('/(gated)/home')}
              />
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

function SkeletonRow() {
  return <View style={{ height: 60, borderRadius: radius.lg, backgroundColor: LIGHT.surface }} />;
}

function SearchResultRow({
  user,
  busy,
  onConnect,
  onGoToInbox,
}: {
  user: ConnectSearchUser;
  busy: boolean;
  onConnect: () => void;
  onGoToInbox: () => void;
}) {
  const fullName = user.fullName ?? user.username ?? 'Amber user';
  const meta = [user.occupation, user.currentCity].filter(Boolean).join(' · ');

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm }}>
      <Avatar name={fullName} url={user.avatarUrl ?? undefined} size={44} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="titleMd" numberOfLines={1} style={{ color: LIGHT.textPrimary }}>
          {fullName}
        </Text>
        {user.username ? (
          <Text variant="captionSm" style={{ color: LIGHT.textSecondary }}>
            {`@${user.username}`}
          </Text>
        ) : null}
        {meta ? (
          <Text variant="captionSm" numberOfLines={1} style={{ color: LIGHT.textMuted }}>
            {meta}
          </Text>
        ) : null}
      </View>
      <ConnectButton status={user.status} busy={busy} onConnect={onConnect} onGoToInbox={onGoToInbox} />
    </View>
  );
}
