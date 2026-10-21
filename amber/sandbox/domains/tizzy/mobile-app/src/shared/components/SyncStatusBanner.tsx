/**
 * Sync Status Banner Component
 * Displays sync status and offline indicators to users
 */

import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated } from 'react-native';
import { useSyncStatus } from '../../services/SyncService';
import { useNetworkStatus } from '../../services/NetworkService';

interface SyncStatusBannerProps {
  /** Show detailed sync information */
  detailed?: boolean;
  /** Position of the banner */
  position?: 'top' | 'bottom';
  /** Custom style */
  style?: any;
  /** Callback when banner is tapped */
  onPress?: () => void;
}

/**
 * Sync Status Banner Component
 * Shows network connectivity and sync status
 */
export function SyncStatusBanner({
  detailed = false,
  position = 'top',
  style,
  onPress
}: SyncStatusBannerProps) {
  const { status: networkStatus, isOnline, isOffline, isPoor } = useNetworkStatus();
  const syncStatus = useSyncStatus();
  const [slideAnim] = React.useState(new Animated.Value(-100));

  // Determine if we should show the banner
  const shouldShow = isOffline || isPoor || syncStatus.isSyncing || syncStatus.pendingOperations > 0;

  // Animate banner in/out
  React.useEffect(() => {
    Animated.timing(slideAnim, {
      toValue: shouldShow ? 0 : (position === 'top' ? -100 : 100),
      duration: 300,
      useNativeDriver: true,
    }).start();
  }, [shouldShow, position]);

  if (!shouldShow) {
    return null;
  }

  // Determine banner content and style
  const getBannerConfig = () => {
    if (isOffline) {
      return {
        text: 'You are offline',
        subtext: syncStatus.pendingOperations > 0
          ? `${syncStatus.pendingOperations} changes will sync when online`
          : 'Changes will be saved locally',
        backgroundColor: '#6B7280',
        icon: '[iphone.slash]'
      };
    }

    if (isPoor) {
      return {
        text: 'Poor connection',
        subtext: 'Some features may be limited',
        backgroundColor: '#F59E0B',
        icon: '[exclamationmark.triangle]'
      };
    }

    if (syncStatus.isSyncing) {
      return {
        text: 'Syncing...',
        subtext: `${syncStatus.pendingOperations} items remaining`,
        backgroundColor: '#3B82F6',
        icon: '[arrow.triangle.2.circlepath]'
      };
    }

    if (syncStatus.pendingOperations > 0) {
      return {
        text: 'Pending sync',
        subtext: `${syncStatus.pendingOperations} changes waiting`,
        backgroundColor: '#8B5CF6',
        icon: '[hourglass]'
      };
    }

    return {
      text: 'All synced',
      subtext: 'Up to date',
      backgroundColor: '#10B981',
      icon: '[checkmark.circle]'
    };
  };

  const config = getBannerConfig();

  const banner = (
    <Animated.View
      style={[
        styles.banner,
        position === 'top' ? styles.bannerTop : styles.bannerBottom,
        { backgroundColor: config.backgroundColor },
        { transform: [{ translateY: slideAnim }] },
        style
      ]}
    >
      <View style={styles.content}>
        <Text style={styles.icon}>{config.icon}</Text>
        <View style={styles.textContainer}>
          <Text style={styles.text}>{config.text}</Text>
          {detailed && config.subtext && (
            <Text style={styles.subtext}>{config.subtext}</Text>
          )}
        </View>
      </View>

      {syncStatus.lastSyncError && detailed && (
        <Text style={styles.error} numberOfLines={1}>
          Error: {syncStatus.lastSyncError}
        </Text>
      )}
    </Animated.View>
  );

  if (onPress) {
    return (
      <TouchableOpacity onPress={onPress} activeOpacity={0.8}>
        {banner}
      </TouchableOpacity>
    );
  }

  return banner;
}

const styles = StyleSheet.create({
  banner: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    zIndex: 1000,
  },
  bannerTop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
  },
  bannerBottom: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  icon: {
    fontSize: 20,
    marginRight: 12,
  },
  textContainer: {
    flex: 1,
  },
  text: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  subtext: {
    color: '#FFFFFF',
    fontSize: 12,
    opacity: 0.9,
    marginTop: 2,
  },
  error: {
    color: '#FFFFFF',
    fontSize: 11,
    marginTop: 4,
    opacity: 0.8,
  },
});

/**
 * Compact Sync Indicator (dot indicator)
 */
export function SyncIndicator() {
  const { isOffline, isPoor } = useNetworkStatus();
  const syncStatus = useSyncStatus();

  const getIndicatorColor = () => {
    if (isOffline) return '#6B7280'; // Gray
    if (isPoor) return '#F59E0B'; // Orange
    if (syncStatus.isSyncing) return '#3B82F6'; // Blue
    if (syncStatus.pendingOperations > 0) return '#8B5CF6'; // Purple
    return '#10B981'; // Green
  };

  const getIndicatorText = () => {
    if (isOffline) return 'Offline';
    if (isPoor) return 'Poor connection';
    if (syncStatus.isSyncing) return 'Syncing...';
    if (syncStatus.pendingOperations > 0) return 'Pending';
    return 'Synced';
  };

  return (
    <View style={indicatorStyles.container}>
      <View
        style={[
          indicatorStyles.dot,
          { backgroundColor: getIndicatorColor() }
        ]}
      />
      <Text style={indicatorStyles.text}>{getIndicatorText()}</Text>
    </View>
  );
}

const indicatorStyles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: '#F3F4F6',
    borderRadius: 12,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  text: {
    fontSize: 12,
    fontWeight: '500',
    color: '#374151',
  },
});
