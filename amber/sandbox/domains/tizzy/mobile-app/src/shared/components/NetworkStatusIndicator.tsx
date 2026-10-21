/**
 * Network Status Indicator Component
 * Shows current network connection status and quality
 */

import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import NetInfo, { NetInfoState } from '@react-native-community/netinfo';
import { colors } from '../constants/colors';
import { spacing } from '../constants/spacing';
import { typography } from '../constants/typography';

interface NetworkStatusIndicatorProps {
  /**
   * Show detailed connection info
   */
  showDetails?: boolean;

  /**
   * Compact mode (smaller indicator)
   */
  compact?: boolean;
}

type ConnectionQuality = 'excellent' | 'good' | 'fair' | 'poor' | 'offline';

/**
 * Network Status Indicator Component
 *
 * Displays real-time network status and connection quality.
 *
 * @example
 * ```tsx
 * <NetworkStatusIndicator showDetails />
 * ```
 */
export const NetworkStatusIndicator: React.FC<NetworkStatusIndicatorProps> = ({
  showDetails = false,
  compact = false,
}) => {
  const [netInfo, setNetInfo] = useState<NetInfoState | null>(null);
  const [quality, setQuality] = useState<ConnectionQuality>('offline');

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      setNetInfo(state);
      setQuality(determineConnectionQuality(state));
    });

    return () => unsubscribe();
  }, []);

  if (!netInfo) {
    return null;
  }

  const isConnected = netInfo.isConnected && netInfo.isInternetReachable;

  if (compact) {
    return (
      <View style={[styles.compactContainer, getQualityStyles(quality)]}>
        <View style={[styles.dot, getQualityDotStyles(quality)]} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={[styles.indicator, getQualityStyles(quality)]}>
        <Text style={styles.statusText}>
          {isConnected ? getConnectionText(netInfo) : 'Offline'}
        </Text>
        {showDetails && netInfo.type && (
          <Text style={styles.detailsText}>
            {netInfo.type === 'wifi'
              ? 'Wi-Fi'
              : netInfo.type === 'cellular'
              ? getCellularGeneration(netInfo)
              : netInfo.type}
          </Text>
        )}
      </View>
      {showDetails && (
        <View style={styles.qualityBars}>
          {renderSignalBars(quality)}
        </View>
      )}
    </View>
  );
};

/**
 * Determine connection quality based on network state
 */
function determineConnectionQuality(state: NetInfoState): ConnectionQuality {
  if (!state.isConnected || !state.isInternetReachable) {
    return 'offline';
  }

  if (state.type === 'wifi') {
    return 'excellent';
  }

  if (state.type === 'cellular' && state.details && 'cellularGeneration' in state.details) {
    const generation = state.details.cellularGeneration;
    switch (generation) {
      case '5g':
        return 'excellent';
      case '4g':
        return 'good';
      case '3g':
        return 'fair';
      case '2g':
        return 'poor';
      default:
        return 'good';
    }
  }

  return 'good';
}

/**
 * Get connection description text
 */
function getConnectionText(state: NetInfoState): string {
  switch (state.type) {
    case 'wifi':
      return 'Connected';
    case 'cellular':
      return 'Cellular';
    case 'ethernet':
      return 'Ethernet';
    default:
      return 'Connected';
  }
}

/**
 * Get cellular generation text
 */
function getCellularGeneration(state: NetInfoState): string {
  if (state.details && 'cellularGeneration' in state.details) {
    const gen = state.details.cellularGeneration;
    if (gen && typeof gen === 'string') {
      return gen.toUpperCase();
    }
    return 'Cellular';
  }
  return 'Cellular';
}

/**
 * Get quality-based styles
 */
function getQualityStyles(quality: ConnectionQuality) {
  switch (quality) {
    case 'excellent':
      return { backgroundColor: colors.success.light };
    case 'good':
      return { backgroundColor: colors.primary.light };
    case 'fair':
      return { backgroundColor: colors.warning.light };
    case 'poor':
      return { backgroundColor: colors.warning.main };
    case 'offline':
      return { backgroundColor: colors.danger.light };
  }
}

/**
 * Get quality-based dot styles
 */
function getQualityDotStyles(quality: ConnectionQuality) {
  switch (quality) {
    case 'excellent':
      return { backgroundColor: colors.success.main };
    case 'good':
      return { backgroundColor: colors.primary.main };
    case 'fair':
      return { backgroundColor: colors.warning.main };
    case 'poor':
      return { backgroundColor: colors.warning.dark };
    case 'offline':
      return { backgroundColor: colors.danger.main };
  }
}

/**
 * Render signal strength bars
 */
function renderSignalBars(quality: ConnectionQuality) {
  const barCount = quality === 'excellent' ? 4 : quality === 'good' ? 3 : quality === 'fair' ? 2 : quality === 'poor' ? 1 : 0;

  return (
    <>
      {[1, 2, 3, 4].map((bar) => (
        <View
          key={bar}
          style={[
            styles.signalBar,
            bar <= barCount ? styles.signalBarActive : styles.signalBarInactive,
            { height: 4 + bar * 3 },
          ]}
        />
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  indicator: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: spacing.radius.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  statusText: {
    ...typography.caption,
    color: colors.text.primary,
    fontWeight: '600',
  },
  detailsText: {
    ...typography.caption,
    color: colors.text.secondary,
  },
  qualityBars: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 2,
    marginLeft: spacing.xs,
  },
  signalBar: {
    width: 3,
    borderRadius: 2,
  },
  signalBarActive: {
    backgroundColor: colors.success.main,
  },
  signalBarInactive: {
    backgroundColor: colors.border.light,
  },
  compactContainer: {
    width: 24,
    height: 24,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
});
