import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { SymbolView } from 'expo-symbols';
import * as Haptics from 'expo-haptics';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { DeviceStatus, ConnectionState, SignalStrength } from '../../../services/BLEManager';
import { BatteryIndicator } from './BatteryIndicator';
import { colors } from '../../../shared/constants/colors';
import { spacing } from '../../../shared/constants/spacing';

interface DeviceCardProps {
  deviceStatus: DeviceStatus;
  connectionState: ConnectionState;
  signalStrength?: SignalStrength;
  rssi?: number;
  onPress?: () => void;
}

export function DeviceCard({ deviceStatus, connectionState, signalStrength, rssi, onPress }: DeviceCardProps) {
  // Calculate storage percentage
  const storagePercentage = Math.round(
    (deviceStatus.storage_used_mb / deviceStatus.storage_total_mb) * 100
  );

  // Format uptime
  const formatUptime = (seconds: number): string => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }
    return `${minutes}m`;
  };

  // Format last sync time
  const formatLastSync = (timestamp: string): string => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays}d ago`;
  };

  // Get signal strength display configuration
  const getSignalConfig = (strength: SignalStrength) => {
    switch (strength) {
      case 'excellent':
        return {
          bars: [true, true, true, true],
          text: 'Excellent Signal',
          color: '#4CAF50',
        };
      case 'good':
        return {
          bars: [true, true, true, false],
          text: 'Good Signal',
          color: '#8BC34A',
        };
      case 'fair':
        return {
          bars: [true, true, false, false],
          text: 'Fair Signal',
          color: '#FFC107',
        };
      case 'poor':
        return {
          bars: [true, false, false, false],
          text: 'Poor Signal',
          color: '#FF5722',
        };
    }
  };

  const signalConfig = signalStrength ? getSignalConfig(signalStrength) : null;

  const handlePress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onPress?.();
  };

  return (
    <Animated.View entering={FadeInDown.duration(400)}>
    <TouchableOpacity
      style={[
        styles.card,
        connectionState === 'connected' && styles.cardConnected,
      ]}
      onPress={handlePress}
      activeOpacity={0.85}
    >
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.deviceInfo}>
          <View style={styles.deviceIconContainer}>
            <SymbolView
              name="headphones"
              size={24}
              type="hierarchical"
              tintColor="#666"
            />
          </View>
          <View>
            <Text style={styles.deviceName}>Tizzy Wearable</Text>
            <Text style={styles.deviceId}>{deviceStatus.device_id}</Text>
          </View>
        </View>
        <BatteryIndicator
          level={deviceStatus.battery_level}
          charging={deviceStatus.battery_charging}
        />
      </View>

      {/* Divider */}
      <View style={styles.divider} />

      {/* Stats Grid */}
      <View style={styles.statsGrid}>
        {/* Firmware Version */}
        <View style={styles.statItem}>
          <View style={styles.statIconContainer}>
            <SymbolView
              name="gearshape.fill"
              size={20}
              type="hierarchical"
              tintColor="#666"
            />
          </View>
          <View style={styles.statContent}>
            <Text style={styles.statLabel}>Firmware</Text>
            <Text style={styles.statValue}>{deviceStatus.firmware_version}</Text>
          </View>
        </View>

        {/* Storage */}
        <View style={styles.statItem}>
          <View style={styles.statIconContainer}>
            <SymbolView
              name="externaldrive.fill"
              size={20}
              type="hierarchical"
              tintColor="#666"
            />
          </View>
          <View style={styles.statContent}>
            <Text style={styles.statLabel}>Storage</Text>
            <View style={styles.storageBar}>
              <View
                style={[
                  styles.storageBarFill,
                  { width: `${storagePercentage}%` },
                  storagePercentage > 80 && styles.storageBarFillHigh,
                ]}
              />
            </View>
            <Text style={styles.statValue}>
              {deviceStatus.storage_used_mb}MB / {deviceStatus.storage_total_mb}MB ({storagePercentage}%)
            </Text>
          </View>
        </View>

        {/* Uptime */}
        <View style={styles.statItem}>
          <View style={styles.statIconContainer}>
            <SymbolView
              name="timer"
              size={20}
              type="hierarchical"
              tintColor="#666"
            />
          </View>
          <View style={styles.statContent}>
            <Text style={styles.statLabel}>Uptime</Text>
            <Text style={styles.statValue}>{formatUptime(deviceStatus.uptime_seconds)}</Text>
          </View>
        </View>

        {/* Last Sync */}
        <View style={styles.statItem}>
          <View style={styles.statIconContainer}>
            <SymbolView
              name="arrow.circlepath"
              size={20}
              type="hierarchical"
              tintColor="#666"
            />
          </View>
          <View style={styles.statContent}>
            <Text style={styles.statLabel}>Last Sync</Text>
            <Text style={styles.statValue}>{formatLastSync(deviceStatus.last_sync_timestamp)}</Text>
          </View>
        </View>
      </View>

      {/* Divider */}
      <View style={styles.divider} />

      {/* Settings Status */}
      <View style={styles.settingsRow}>
        {/* Mute State */}
        <View style={styles.settingBadge}>
          <View style={styles.settingIconContainer}>
            <SymbolView
              name={
                deviceStatus.mute_state === 'unmuted'
                  ? 'speaker.wave.3.fill'
                  : deviceStatus.mute_state === 'muted'
                  ? 'speaker.slash.fill'
                  : 'person.fill'
              }
              size={16}
              type="hierarchical"
              tintColor="#000"
            />
          </View>
          <Text style={styles.settingText}>
            {deviceStatus.mute_state === 'unmuted'
              ? 'Unmuted'
              : deviceStatus.mute_state === 'muted'
              ? 'Muted'
              : 'Self Only'}
          </Text>
        </View>

        {/* Haptics */}
        <View style={styles.settingBadge}>
          <View style={styles.settingIconContainer}>
            <SymbolView
              name={deviceStatus.haptics_enabled ? 'iphone.radiowaves.left.and.right' : 'bell.slash.fill'}
              size={16}
              type="hierarchical"
              tintColor="#000"
            />
          </View>
          <Text style={styles.settingText}>
            Haptics {deviceStatus.haptics_enabled ? 'On' : 'Off'}
          </Text>
        </View>

        {/* Session Status */}
        {deviceStatus.current_session_id && (
          <View style={[styles.settingBadge, styles.settingBadgeActive]}>
            <View style={styles.settingIconContainer}>
              <SymbolView
                name="mic.fill"
                size={16}
                type="hierarchical"
                tintColor="#000"
              />
            </View>
            <Text style={styles.settingText}>Recording</Text>
          </View>
        )}
      </View>

      {/* Signal Strength Indicator */}
      {connectionState === 'connected' && signalConfig && (
        <View style={styles.signalContainer}>
          <View style={styles.signalBars}>
            <View
              style={[
                styles.signalBar,
                { height: 8 },
                signalConfig.bars[0] && { backgroundColor: signalConfig.color },
              ]}
            />
            <View
              style={[
                styles.signalBar,
                { height: 12 },
                signalConfig.bars[1] && { backgroundColor: signalConfig.color },
              ]}
            />
            <View
              style={[
                styles.signalBar,
                { height: 16 },
                signalConfig.bars[2] && { backgroundColor: signalConfig.color },
              ]}
            />
            <View
              style={[
                styles.signalBar,
                { height: 20 },
                signalConfig.bars[3] && { backgroundColor: signalConfig.color },
              ]}
            />
          </View>
          <Text style={[styles.signalText, { color: signalConfig.color }]}>
            {signalConfig.text}
            {rssi !== undefined && ` (${rssi} dBm)`}
          </Text>
        </View>
      )}
    </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.background.primary,
    borderRadius: spacing.radius.lg,
    padding: spacing.cardPadding,
    boxShadow: '0 2px 12px rgba(0,0,0,0.08)',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  cardConnected: {
    borderColor: colors.success.main,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  deviceInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  deviceIconContainer: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#f0f0f0',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  deviceName: {
    fontSize: 18,
    fontWeight: '600',
    color: '#000',
    marginBottom: 2,
  },
  deviceId: {
    fontSize: 12,
    color: '#666',
    fontFamily: 'monospace',
  },
  divider: {
    height: 1,
    backgroundColor: '#e0e0e0',
    marginVertical: 16,
  },
  statsGrid: {
    gap: 12,
  },
  statItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  statIconContainer: {
    marginRight: 12,
    marginTop: 2,
  },
  statContent: {
    flex: 1,
  },
  statLabel: {
    fontSize: 14,
    color: '#666',
    marginBottom: 4,
  },
  statValue: {
    fontSize: 14,
    color: '#000',
    fontWeight: '500',
  },
  storageBar: {
    height: 6,
    backgroundColor: '#e0e0e0',
    borderRadius: 3,
    marginVertical: 6,
    overflow: 'hidden',
  },
  storageBarFill: {
    height: '100%',
    backgroundColor: '#4CAF50',
    borderRadius: 3,
  },
  storageBarFillHigh: {
    backgroundColor: '#FF9800',
  },
  settingsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  settingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
  },
  settingBadgeActive: {
    backgroundColor: '#E8F5E9',
  },
  settingIconContainer: {
    marginRight: 6,
  },
  settingText: {
    fontSize: 13,
    color: '#000',
    fontWeight: '500',
  },
  signalContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#e0e0e0',
  },
  signalBars: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 2,
    marginRight: 8,
  },
  signalBar: {
    width: 4,
    backgroundColor: '#e0e0e0',
    borderRadius: 2,
  },
  signalText: {
    fontSize: 12,
    fontWeight: '500',
  },
});
