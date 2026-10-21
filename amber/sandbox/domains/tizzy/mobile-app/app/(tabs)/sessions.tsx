import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  FlatList,
  RefreshControl,
  TextInput,
  TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SymbolView } from 'expo-symbols';
import * as Haptics from 'expo-haptics';
import { SessionCard, SessionData } from '../../src/shared/components/SessionCard';
import { EmptyState, ErrorState } from '../../src/shared/components/EmptyState';
import { SessionsListSkeleton } from '../../src/shared/components/SkeletonLoader';
import { apiService } from '../../src/api/client';
import { Session } from '../../src/shared/types/api';
import { debounce } from '../../src/shared/utils/performance';
import { useOptimizedList } from '../../src/shared/hooks/useOptimizedList';
import { STORAGE_KEYS } from '../../src/shared/constants/storage';
import { colors } from '../../src/shared/constants/colors';

type FilterType = 'all' | 'completed' | 'in_progress';
type SortType = 'recent' | 'duration' | 'quality';

interface GroupedSessions {
  today: SessionData[];
  yesterday: SessionData[];
  thisWeek: SessionData[];
  older: SessionData[];
}

export default function SessionsScreen() {
  const router = useRouter();
  const [userId, setUserId] = useState<string>('');
  const [sessions, setSessions] = useState<SessionData[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [filterType, setFilterType] = useState<FilterType>('all');
  const [sortType, setSortType] = useState<SortType>('recent');

  useEffect(() => {
    loadUserIdAndSessions();
  }, []);

  const loadUserIdAndSessions = async () => {
    try {
      // Parse user object from storage
      const userJson = await AsyncStorage.getItem(STORAGE_KEYS.USER);
      if (userJson) {
        const user = JSON.parse(userJson);
        setUserId(user.id);
        await loadSessions(user.id);
      } else {
        setLoading(false);
        setError('User not found. Please log in again.');
      }
    } catch (err) {
      console.error('Failed to load user data:', err);
      setError('Failed to load user data');
      setLoading(false);
    }
  };

  const loadSessions = async (uid: string) => {
    try {
      setLoading(true);
      setError(null);

      // Check if in demo mode
      const isDemoMode = await AsyncStorage.getItem(STORAGE_KEYS.DEMO_MODE);

      if (isDemoMode === 'true') {
        // Return empty sessions array for demo users
        setSessions([]);
        setLoading(false);
        return;
      }

      // Fetch sessions from API
      const sessionsData = await apiService.getSessions(uid, { limit: 100 });

      // Map API Session type to SessionData type and try to enrich with summary data
      const mappedSessions: SessionData[] = await Promise.all(
        sessionsData.map(async (s) => {
          const baseSession: SessionData = {
            id: s.id,
            start_time: s.start_time,
            end_time: s.end_time || new Date().toISOString(),
            duration_seconds: s.duration_seconds || s.total_duration_seconds || 0,
            speaker_count_estimate: s.speaker_count_estimate || 2,
            environment_tag: s.environment_tag,
            conversation_count: s.conversation_count,
            created_at: s.created_at,
          };

          // Try to fetch summary for additional metrics (optional, don't fail if unavailable)
          try {
            const summary = await apiService.getSessionSummary(s.id);
            if (summary.metrics) {
              baseSession.metrics = {
                clarity: summary.metrics.speech_clarity,
                pace: summary.metrics.pace_consistency,
                variety: summary.metrics.vocal_variety,
              };
            }
            // Derive sentiment from metrics or other data
            if (summary.metrics) {
              const avgMetric = (
                summary.metrics.speech_clarity +
                summary.metrics.pace_consistency +
                summary.metrics.vocal_variety
              ) / 3;
              baseSession.sentiment = avgMetric >= 70 ? 'positive' : avgMetric >= 50 ? 'neutral' : 'negative';
            }
          } catch (summaryError) {
            // Silently ignore summary fetch errors - session will just not have metrics
            console.log(`Summary not available for session ${s.id}`);
          }

          return baseSession;
        })
      );

      setSessions(mappedSessions);
    } catch (err) {
      console.error('Failed to load sessions:', err);
      setError(err instanceof Error ? err.message : 'Failed to load sessions');
    } finally {
      setLoading(false);
    }
  };

  const onRefresh = useCallback(async () => {
    if (!userId) return;
    setRefreshing(true);
    await loadSessions(userId);
    setRefreshing(false);
  }, [userId]);

  // Debounce search input to avoid excessive filtering
  const debouncedSetSearchQuery = useMemo(
    () =>
      debounce((query: string) => {
        setSearchQuery(query);
      }, 300),
    []
  );

  const handleSearchChange = useCallback(
    (text: string) => {
      debouncedSetSearchQuery(text);
    },
    [debouncedSetSearchQuery]
  );

  const handleSessionPress = (sessionId: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    // router.push(`/sessions/${sessionId}`);
  };

  // Filter sessions based on filter type
  const filteredSessions = useMemo(() => {
    let filtered = sessions;

    // Apply filter
    if (filterType === 'completed') {
      filtered = sessions.filter(s => s.end_time && new Date(s.end_time) < new Date());
    } else if (filterType === 'in_progress') {
      filtered = sessions.filter(s => !s.end_time || new Date(s.end_time) >= new Date());
    }

    // Apply search
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(s =>
        s.environment_tag.toLowerCase().includes(query) ||
        s.id.toLowerCase().includes(query)
      );
    }

    return filtered;
  }, [sessions, filterType, searchQuery]);

  // Sort sessions
  const sortedSessions = useMemo(() => {
    const sorted = [...filteredSessions];

    switch (sortType) {
      case 'recent':
        sorted.sort((a, b) =>
          new Date(b.start_time).getTime() - new Date(a.start_time).getTime()
        );
        break;
      case 'duration':
        sorted.sort((a, b) => b.duration_seconds - a.duration_seconds);
        break;
      case 'quality':
        // For now, sort by speaker count as a proxy for quality
        sorted.sort((a, b) => b.speaker_count_estimate - a.speaker_count_estimate);
        break;
    }

    return sorted;
  }, [filteredSessions, sortType]);

  // Group sessions by date
  const groupedSessions: GroupedSessions = useMemo(() => {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterdayStart = new Date(todayStart);
    yesterdayStart.setDate(yesterdayStart.getDate() - 1);
    const weekStart = new Date(todayStart);
    weekStart.setDate(weekStart.getDate() - 7);

    const groups: GroupedSessions = {
      today: [],
      yesterday: [],
      thisWeek: [],
      older: [],
    };

    sortedSessions.forEach(session => {
      const sessionDate = new Date(session.start_time);

      if (sessionDate >= todayStart) {
        groups.today.push(session);
      } else if (sessionDate >= yesterdayStart) {
        groups.yesterday.push(session);
      } else if (sessionDate >= weekStart) {
        groups.thisWeek.push(session);
      } else {
        groups.older.push(session);
      }
    });

    return groups;
  }, [sortedSessions]);

  const renderFilterButton = (type: FilterType, label: string) => (
    <TouchableOpacity
      style={[styles.filterButton, filterType === type && styles.filterButtonActive]}
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        setFilterType(type);
      }}
      activeOpacity={0.7}
    >
      <Text style={[styles.filterText, filterType === type && styles.filterTextActive]}>
        {label}
      </Text>
    </TouchableOpacity>
  );

  const renderSortButton = (type: SortType, label: string) => (
    <TouchableOpacity
      style={[styles.sortButton, sortType === type && styles.sortButtonActive]}
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        setSortType(type);
      }}
      activeOpacity={0.7}
    >
      <Text style={[styles.sortText, sortType === type && styles.sortTextActive]}>
        {label}
      </Text>
    </TouchableOpacity>
  );

  // Prepare flat list of all sessions with group headers
  const flatSessionsList = useMemo(() => {
    const items: Array<{ type: 'header' | 'session'; data: SessionData | null; label?: string }> = [];

    if (groupedSessions.today.length > 0) {
      items.push({ type: 'header', data: null, label: 'Today' });
      groupedSessions.today.forEach(session => {
        items.push({ type: 'session', data: session });
      });
    }

    if (groupedSessions.yesterday.length > 0) {
      items.push({ type: 'header', data: null, label: 'Yesterday' });
      groupedSessions.yesterday.forEach(session => {
        items.push({ type: 'session', data: session });
      });
    }

    if (groupedSessions.thisWeek.length > 0) {
      items.push({ type: 'header', data: null, label: 'This Week' });
      groupedSessions.thisWeek.forEach(session => {
        items.push({ type: 'session', data: session });
      });
    }

    if (groupedSessions.older.length > 0) {
      items.push({ type: 'header', data: null, label: 'Older' });
      groupedSessions.older.forEach(session => {
        items.push({ type: 'session', data: session });
      });
    }

    return items;
  }, [groupedSessions]);

  // Optimize list rendering
  const optimizedListProps = useOptimizedList({
    items: flatSessionsList,
    renderItem: ({ item }) => {
      if (item.type === 'header') {
        return <Text style={styles.groupTitle}>{item.label}</Text>;
      }
      return (
        <SessionCard
          session={item.data!}
          onPress={() => handleSessionPress(item.data!.id)}
        />
      );
    },
    keyExtractor: (item, index) =>
      item.type === 'header' ? `header-${item.label}` : `session-${item.data?.id}-${index}`,
    windowSize: 10,
    initialNumToRender: 10,
  });

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        {/* Header still visible during loading */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Sessions</Text>
          <Text style={styles.headerSubtitle}>Loading...</Text>
        </View>
        <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
          <SessionsListSkeleton />
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView style={styles.container}>
        <ErrorState
          title="Unable to load sessions"
          message={error}
          icon={<SymbolView name="chart.bar.fill" style={styles.errorIcon} tintColor="#6B7280" />}
          onRetry={() => loadUserIdAndSessions()}
          retryText="Try Again"
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Sessions</Text>
        <Text style={styles.headerSubtitle}>
          {sessions.length} {sessions.length === 1 ? 'session' : 'sessions'}
        </Text>
      </View>

      {/* Search Bar */}
      <View style={styles.searchContainer}>
        <SymbolView name="magnifyingglass" style={styles.searchIcon} tintColor="#9CA3AF" />
        <TextInput
          style={styles.searchInput}
          placeholder="Search by context or notes..."
          placeholderTextColor="#9CA3AF"
          value={searchQuery}
          onChangeText={handleSearchChange}
          autoCapitalize="none"
          autoCorrect={false}
        />
        {searchQuery.length > 0 && (
          <TouchableOpacity onPress={() => {
            setSearchQuery('');
            debouncedSetSearchQuery.cancel?.();
          }}>
            <Text style={styles.clearButton}>✕</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Filters */}
      <View style={styles.filtersContainer}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filtersContent}
        >
          {renderFilterButton('all', 'All')}
          {renderFilterButton('completed', 'Completed')}
          {renderFilterButton('in_progress', 'In Progress')}
        </ScrollView>
      </View>

      {/* Sort Options */}
      <View style={styles.sortContainer}>
        <Text style={styles.sortLabel}>Sort by:</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.sortContent}
        >
          {renderSortButton('recent', 'Recent')}
          {renderSortButton('duration', 'Duration')}
          {renderSortButton('quality', 'Quality')}
        </ScrollView>
      </View>

      {/* Sessions List - FlatList for optimal performance */}
      <FlatList
        style={styles.scrollView}
        contentContainerStyle={[
          styles.scrollContent,
          flatSessionsList.length === 0 && styles.scrollContentEmpty,
        ]}
        data={flatSessionsList}
        renderItem={optimizedListProps.renderItem}
        keyExtractor={optimizedListProps.keyExtractor}
        windowSize={optimizedListProps.windowSize}
        initialNumToRender={optimizedListProps.initialNumToRender}
        maxToRenderPerBatch={optimizedListProps.maxToRenderPerBatch}
        updateCellsBatchingPeriod={optimizedListProps.updateCellsBatchingPeriod}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary.main}
            colors={[colors.primary.main]}
          />
        }
        ListEmptyComponent={
          <EmptyState
            title={searchQuery ? 'No sessions found' : 'No sessions yet'}
            description={
              searchQuery
                ? 'Try adjusting your search or filters'
                : 'Start your first session to see it here!'
            }
            icon={<SymbolView name="chart.bar.fill" style={styles.emptyIcon} tintColor="#6B7280" />}
          />
        }
        removeClippedSubviews={true}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F9FAFB',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: '#6B7280',
  },
  errorIcon: {
    width: 64,
    height: 64,
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 16,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#1F2937',
    marginBottom: 4,
  },
  headerSubtitle: {
    fontSize: 14,
    color: '#6B7280',
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginHorizontal: 20,
    marginTop: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  searchIcon: {
    width: 18,
    height: 18,
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    color: '#1F2937',
  },
  clearButton: {
    fontSize: 18,
    color: '#9CA3AF',
    paddingHorizontal: 8,
  },
  filtersContainer: {
    marginBottom: 12,
  },
  filtersContent: {
    paddingHorizontal: 20,
    gap: 8,
  },
  filterButton: {
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  filterButtonActive: {
    backgroundColor: '#3B82F6',
    borderColor: '#3B82F6',
  },
  filterText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#6B7280',
  },
  filterTextActive: {
    color: '#FFFFFF',
  },
  sortContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
    paddingHorizontal: 20,
  },
  sortLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#6B7280',
    marginRight: 12,
  },
  sortContent: {
    gap: 8,
  },
  sortButton: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: '#F3F4F6',
  },
  sortButtonActive: {
    backgroundColor: '#DBEAFE',
  },
  sortText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#6B7280',
  },
  sortTextActive: {
    color: '#3B82F6',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingBottom: 24,
  },
  scrollContentEmpty: {
    flexGrow: 1,
  },
  sessionGroup: {
    marginBottom: 24,
  },
  groupTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1F2937',
    marginBottom: 12,
  },
  emptyIcon: {
    width: 64,
    height: 64,
  },
});
