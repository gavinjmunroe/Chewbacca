import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { SymbolView } from 'expo-symbols';
import * as Haptics from 'expo-haptics';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
} from 'react-native-reanimated';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export interface SessionData {
  id: string;
  start_time: string;
  end_time: string;
  duration_seconds: number;
  speaker_count_estimate: number;
  environment_tag: string;
  conversation_count?: number;
  created_at: string;
  // Optional metrics for enhanced display
  metrics?: {
    clarity?: number;
    pace?: number;
    variety?: number;
  };
  sentiment?: 'positive' | 'neutral' | 'negative';
}

interface SessionCardProps {
  session: SessionData;
  onPress?: () => void;
  isActive?: boolean;
  showMetrics?: boolean;
}

export const SessionCard = React.memo(function SessionCard({ session, onPress, isActive = false, showMetrics = true }: SessionCardProps) {
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePressIn = () => {
    if (onPress) scale.value = withSpring(0.97, { damping: 15, stiffness: 400 });
  };

  const handlePressOut = () => {
    scale.value = withSpring(1, { damping: 15, stiffness: 400 });
  };

  const handlePress = () => {
    if (onPress) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      onPress();
    }
  };
  const formatDuration = (seconds: number): string => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);

    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }
    return `${minutes}m`;
  };

  const formatDate = (dateString: string): string => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffHours / 24);

    if (diffHours < 1) {
      const diffMins = Math.floor(diffMs / (1000 * 60));
      return `${diffMins}m ago`;
    } else if (diffHours < 24) {
      return `${diffHours}h ago`;
    } else if (diffDays < 7) {
      return `${diffDays}d ago`;
    } else {
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }
  };

  const getEnvironmentSymbol = (tag: string): string => {
    const tagLower = tag.toLowerCase();
    if (tagLower.includes('work')) return 'briefcase.fill';
    if (tagLower.includes('social')) return 'party.popper.fill';
    if (tagLower.includes('meeting')) return 'person.3.fill';
    if (tagLower.includes('family')) return 'house.fill';
    if (tagLower.includes('call')) return 'phone.fill';
    return 'bubble.left.and.bubble.right.fill';
  };

  const getSentimentSymbol = (sentiment?: string): string => {
    if (!sentiment) return '';
    switch (sentiment) {
      case 'positive':
        return 'hand.thumbsup.fill';
      case 'neutral':
        return 'minus.circle.fill';
      case 'negative':
        return 'hand.thumbsdown.fill';
      default:
        return '';
    }
  };

  const getMetricColor = (value: number): string => {
    if (value >= 75) return '#10B981'; // Green
    if (value >= 50) return '#F59E0B'; // Yellow
    return '#EF4444'; // Red
  };

  if (!onPress) {
    return (
      <View
        style={[
          styles.container,
          isActive && styles.activeContainer,
        ]}
      >
        {/* Content rendered inline below */}
        <View style={styles.header}>
          <View style={styles.leftHeader}>
            <SymbolView
              name={getEnvironmentSymbol(session.environment_tag)}
              size={32}
              type="hierarchical"
              tintColor="#3B82F6"
              style={styles.symbolIcon}
            />
            <View>
              <Text style={styles.environment}>{session.environment_tag}</Text>
              <Text style={styles.timestamp}>{formatDate(session.start_time)}</Text>
            </View>
          </View>
          {isActive && (
            <View style={styles.activeBadge}>
              <View style={styles.activeDot} />
              <Text style={styles.activeText}>Active</Text>
            </View>
          )}
        </View>
        <View style={styles.statsContainer}>
          <View style={styles.stat}>
            <Text style={styles.statLabel}>Duration</Text>
            <Text style={styles.statValue}>{formatDuration(session.duration_seconds)}</Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.stat}>
            <Text style={styles.statLabel}>Speakers</Text>
            <Text style={styles.statValue}>{session.speaker_count_estimate}</Text>
          </View>
          {session.conversation_count !== undefined && (
            <>
              <View style={styles.divider} />
              <View style={styles.stat}>
                <Text style={styles.statLabel}>Conversations</Text>
                <Text style={styles.statValue}>{session.conversation_count}</Text>
              </View>
            </>
          )}
        </View>
      </View>
    );
  }

  return (
    <AnimatedPressable
      onPress={handlePress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      style={[
        styles.container,
        isActive && styles.activeContainer,
        animatedStyle,
      ]}
    >
      <View style={styles.header}>
        <View style={styles.leftHeader}>
          <SymbolView
            name={getEnvironmentSymbol(session.environment_tag)}
            size={32}
            type="hierarchical"
            tintColor="#3B82F6"
            style={styles.symbolIcon}
          />
          <View>
            <Text style={styles.environment}>{session.environment_tag}</Text>
            <Text style={styles.timestamp}>{formatDate(session.start_time)}</Text>
          </View>
        </View>
        {isActive && (
          <View style={styles.activeBadge}>
            <View style={styles.activeDot} />
            <Text style={styles.activeText}>Active</Text>
          </View>
        )}
      </View>

      <View style={styles.statsContainer}>
        <View style={styles.stat}>
          <Text style={styles.statLabel}>Duration</Text>
          <Text style={styles.statValue}>{formatDuration(session.duration_seconds)}</Text>
        </View>

        <View style={styles.divider} />

        <View style={styles.stat}>
          <Text style={styles.statLabel}>Speakers</Text>
          <Text style={styles.statValue}>{session.speaker_count_estimate}</Text>
        </View>

        {session.conversation_count !== undefined && (
          <>
            <View style={styles.divider} />
            <View style={styles.stat}>
              <Text style={styles.statLabel}>Conversations</Text>
              <Text style={styles.statValue}>{session.conversation_count}</Text>
            </View>
          </>
        )}
      </View>

      {/* Metrics Section */}
      {showMetrics && session.metrics && (
        <View style={styles.metricsContainer}>
          {session.metrics.clarity !== undefined && (
            <View style={styles.metricItem}>
              <Text style={styles.metricLabel}>Clarity</Text>
              <View style={styles.metricBar}>
                <View
                  style={[
                    styles.metricBarFill,
                    {
                      width: `${session.metrics.clarity}%`,
                      backgroundColor: getMetricColor(session.metrics.clarity),
                    },
                  ]}
                />
              </View>
              <Text style={styles.metricValue}>{session.metrics.clarity}%</Text>
            </View>
          )}

          {session.metrics.pace !== undefined && (
            <View style={styles.metricItem}>
              <Text style={styles.metricLabel}>Pace</Text>
              <View style={styles.metricBar}>
                <View
                  style={[
                    styles.metricBarFill,
                    {
                      width: `${session.metrics.pace}%`,
                      backgroundColor: getMetricColor(session.metrics.pace),
                    },
                  ]}
                />
              </View>
              <Text style={styles.metricValue}>{session.metrics.pace}%</Text>
            </View>
          )}

          {session.metrics.variety !== undefined && (
            <View style={styles.metricItem}>
              <Text style={styles.metricLabel}>Variety</Text>
              <View style={styles.metricBar}>
                <View
                  style={[
                    styles.metricBarFill,
                    {
                      width: `${session.metrics.variety}%`,
                      backgroundColor: getMetricColor(session.metrics.variety),
                    },
                  ]}
                />
              </View>
              <Text style={styles.metricValue}>{session.metrics.variety}%</Text>
            </View>
          )}
        </View>
      )}

      {/* Sentiment Section */}
      {session.sentiment && (
        <View style={styles.sentimentContainer}>
          <SymbolView
            name={getSentimentSymbol(session.sentiment)}
            size={20}
            type="hierarchical"
            tintColor="#6B7280"
          />
          <Text style={styles.sentimentText}>
            {session.sentiment.charAt(0).toUpperCase() + session.sentiment.slice(1)} session
          </Text>
        </View>
      )}
    </AnimatedPressable>
  );
});

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
    borderWidth: 1,
    borderColor: '#F3F4F6',
  },
  activeContainer: {
    borderColor: '#3B82F6',
    borderWidth: 2,
  },
  pressedContainer: {
    opacity: 0.8,
    transform: [{ scale: 0.98 }],
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  leftHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  symbolIcon: {
    marginRight: 12,
  },
  environment: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1F2937',
    marginBottom: 2,
  },
  timestamp: {
    fontSize: 13,
    color: '#6B7280',
  },
  activeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#DBEAFE',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  activeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#3B82F6',
    marginRight: 6,
  },
  activeText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#3B82F6',
  },
  statsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
  },
  stat: {
    alignItems: 'center',
    flex: 1,
  },
  statLabel: {
    fontSize: 12,
    color: '#6B7280',
    marginBottom: 4,
  },
  statValue: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1F2937',
  },
  divider: {
    width: 1,
    height: 30,
    backgroundColor: '#E5E7EB',
  },
  metricsContainer: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
    gap: 8,
  },
  metricItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  metricLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#6B7280',
    width: 60,
  },
  metricBar: {
    flex: 1,
    height: 6,
    backgroundColor: '#E5E7EB',
    borderRadius: 3,
    overflow: 'hidden',
  },
  metricBarFill: {
    height: '100%',
    borderRadius: 3,
  },
  metricValue: {
    fontSize: 12,
    fontWeight: '700',
    color: '#1F2937',
    width: 40,
    textAlign: 'right',
  },
  sentimentContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
    gap: 8,
  },
  sentimentText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#6B7280',
  },
});
