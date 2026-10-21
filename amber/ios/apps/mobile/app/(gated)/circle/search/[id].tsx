import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Search, X } from 'lucide-react-native';
import { CircleFeedRow } from '../../../../components/CircleFeedTab';
import { Text } from '../../../../components/Text';
import { getCircleFeed } from '../../../../lib/noteShares';
import { unwrapOrThrow } from '../../../../lib/medhaId';
import { radius, spacing, typography } from '../../../../lib/tokens';
import { LIGHT } from '../../../../lib/theme';

// Live-as-you-type feel (Twitter search): a short debounce keeps the query key
// stable between keystrokes so react-query fires one request per pause.
const SEARCH_DEBOUNCE_MS = 250;

// Transcript search over ONE circle's shared notes. A clean search bar pinned at
// the top; below it, the circle's notes whose transcript matches the keyword,
// rendered with the SAME card as the circle Feed tab (CircleFeedRow). An empty
// query shows all the circle's notes; results update live as the user types.
//
// Member-scoping is entirely server-side: this hits GET /v1/me/circles/:id/feed
// with `q`, which 404s for non-members. The `q` path also does NOT mark the
// circle seen, so searching never clears the unread dot.
export default function CircleTranscriptSearchScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id, accent: accentParam } = useLocalSearchParams<{ id: string; accent?: string }>();
  const accent = accentParam ? decodeURIComponent(accentParam) : LIGHT.accent;

  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  const feedQuery = useQuery({
    queryKey: [id, 'feed', debouncedQuery],
    queryFn: async () =>
      unwrapOrThrow(await getCircleFeed(id, { limit: 100, q: debouncedQuery })).items,
    enabled: !!id,
  });
  const items = feedQuery.data ?? [];
  const searching = debouncedQuery.length > 0;

  return (
    <View style={{ flex: 1, backgroundColor: LIGHT.canvas }}>
      {/* Search bar pinned at the top, next to Back. */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.sm,
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
        <View
          style={{
            flex: 1,
            flexDirection: 'row',
            alignItems: 'center',
            gap: spacing.sm,
            backgroundColor: LIGHT.surface,
            borderRadius: radius.full,
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
            placeholder="Search transcripts"
            placeholderTextColor={LIGHT.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            autoFocus
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

      {feedQuery.isLoading ? (
        <View style={{ paddingTop: spacing.xl, alignItems: 'center' }}>
          <ActivityIndicator color={LIGHT.textMuted} />
        </View>
      ) : feedQuery.isError ? (
        <View style={{ paddingTop: spacing.xl, alignItems: 'center', paddingHorizontal: spacing.xl }}>
          <Text variant="bodyMd" centered style={{ color: LIGHT.textSecondary }}>
            Could not search this circle&apos;s notes.
          </Text>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(it) => it.noteId}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          contentContainerStyle={{
            paddingHorizontal: spacing.lg,
            paddingBottom: spacing.xl,
            paddingTop: spacing.md,
          }}
          ListEmptyComponent={
            <View style={{ paddingTop: spacing.xl, alignItems: 'center', paddingHorizontal: spacing.xl }}>
              <Text variant="bodyMd" centered style={{ color: LIGHT.textMuted }}>
                {searching ? 'No notes match.' : 'No shared notes here yet.'}
              </Text>
            </View>
          }
          renderItem={({ item }) => (
            <CircleFeedRow item={item} accent={accent} highlight={debouncedQuery} />
          )}
        />
      )}
    </View>
  );
}
