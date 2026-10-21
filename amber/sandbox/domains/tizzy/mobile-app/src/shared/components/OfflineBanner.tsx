/**
 * Offline Banner Component
 * Displays a banner when the device is offline with retry functionality
 */

import React, { useEffect, useReducer } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Platform,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import NetInfo from '@react-native-community/netinfo';
import { colors } from '../constants/colors';
import { spacing } from '../constants/spacing';
import { typography } from '../constants/typography';

interface OfflineBannerProps {
  /**
   * Callback when user taps retry
   */
  onRetry?: () => void;

  /**
   * Show connection quality warning for poor connections
   */
  showQualityWarning?: boolean;
}

// ─── Reducer ──────────────────────────────────────────────────────────────────

interface BannerState {
  isOffline: boolean;
  isPoorConnection: boolean;
}

type BannerAction =
  | { type: 'SET_OFFLINE'; value: boolean }
  | { type: 'SET_POOR_CONNECTION'; value: boolean }
  | { type: 'SET_NETWORK_STATE'; isOffline: boolean; isPoorConnection: boolean };

function bannerReducer(state: BannerState, action: BannerAction): BannerState {
  switch (action.type) {
    case 'SET_OFFLINE':
      return { ...state, isOffline: action.value };
    case 'SET_POOR_CONNECTION':
      return { ...state, isPoorConnection: action.value };
    case 'SET_NETWORK_STATE':
      return { isOffline: action.isOffline, isPoorConnection: action.isPoorConnection };
    default:
      return state;
  }
}

const INITIAL_BANNER_STATE: BannerState = {
  isOffline: false,
  isPoorConnection: false,
};

/**
 * Offline Banner Component
 *
 * Automatically displays when device goes offline and hides when back online.
 * Shows connection quality warnings for slow connections.
 *
 * @example
 * ```tsx
 * <OfflineBanner onRetry={() => refetchData()} showQualityWarning />
 * ```
 */
export const OfflineBanner: React.FC<OfflineBannerProps> = ({
  onRetry,
  showQualityWarning = true,
}) => {
  const [state, dispatch] = useReducer(bannerReducer, INITIAL_BANNER_STATE);
  const { isOffline, isPoorConnection } = state;

  // Reanimated shared value for slide animation
  const translateY = useSharedValue(-100);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  useEffect(() => {
    // Subscribe to network state changes
    const unsubscribe = NetInfo.addEventListener((netState) => {
      const offline = !netState.isConnected || !netState.isInternetReachable;

      // Check connection quality
      const isPoor =
        showQualityWarning &&
        netState.isConnected &&
        netState.type === 'cellular' &&
        netState.details !== null &&
        'cellularGeneration' in netState.details &&
        (netState.details.cellularGeneration === '2g' ||
          netState.details.cellularGeneration === '3g');

      dispatch({
        type: 'SET_NETWORK_STATE',
        isOffline: offline,
        isPoorConnection: !!isPoor,
      });
    });

    return () => unsubscribe();
  }, [showQualityWarning]);

  useEffect(() => {
    // Animate banner in/out based on visibility
    if (isOffline || isPoorConnection) {
      translateY.value = withSpring(0, { damping: 12, stiffness: 120 });
    } else {
      translateY.value = withTiming(-100, { duration: 200 });
    }
  }, [isOffline, isPoorConnection, translateY]);

  if (!isOffline && !isPoorConnection) {
    return null;
  }

  const handleRetry = () => {
    if (onRetry) {
      onRetry();
    }
  };

  return (
    <Animated.View
      style={[
        styles.container,
        isOffline ? styles.containerOffline : styles.containerWarning,
        animatedStyle,
      ]}
    >
      <View style={styles.content}>
        <Text style={styles.icon}>{isOffline ? '[antenna.radiowaves.left.and.right.slash]' : '[exclamationmark.triangle]'}</Text>
        <View style={styles.textContainer}>
          <Text style={styles.title}>
            {isOffline ? 'No Internet Connection' : 'Slow Connection'}
          </Text>
          <Text style={styles.message}>
            {isOffline
              ? 'Check your connection and try again'
              : 'Your connection may be unstable'}
          </Text>
        </View>
        {onRetry && (
          <TouchableOpacity
            style={styles.retryButton}
            onPress={handleRetry}
            activeOpacity={0.7}
          >
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        )}
      </View>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 44 : 0, // Account for status bar
    left: 0,
    right: 0,
    zIndex: 999,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    boxShadow: '0 2px 4px rgba(0,0,0,0.25)',
  },
  containerOffline: {
    backgroundColor: colors.danger.main,
  },
  containerWarning: {
    backgroundColor: colors.warning.main,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
  },
  icon: {
    fontSize: 20,
    marginRight: spacing.sm,
  },
  textContainer: {
    flex: 1,
  },
  title: {
    ...typography.subtitle2,
    color: colors.white,
    fontWeight: '600',
    marginBottom: 2,
  },
  message: {
    ...typography.caption,
    color: colors.white,
    opacity: 0.9,
  },
  retryButton: {
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: spacing.radius.sm,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.3)',
  },
  retryText: {
    ...typography.button,
    color: colors.white,
    fontWeight: '600',
  },
});
