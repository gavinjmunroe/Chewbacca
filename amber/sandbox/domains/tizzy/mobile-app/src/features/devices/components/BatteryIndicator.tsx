import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { SymbolView } from 'expo-symbols';

interface BatteryIndicatorProps {
  level: number; // 0-100
  charging?: boolean;
  size?: 'small' | 'medium' | 'large';
  showPercentage?: boolean;
}

export function BatteryIndicator({
  level,
  charging = false,
  size = 'medium',
  showPercentage = true,
}: BatteryIndicatorProps) {
  // Clamp battery level between 0 and 100
  const batteryLevel = Math.max(0, Math.min(100, level));

  // Determine battery color based on level
  const getBatteryColor = () => {
    if (charging) return '#4CAF50'; // Green when charging
    if (batteryLevel > 50) return '#4CAF50'; // Green
    if (batteryLevel > 20) return '#FFC107'; // Yellow/Orange
    return '#F44336'; // Red
  };

  // Size configurations
  const sizeConfig = {
    small: {
      width: 28,
      height: 14,
      tipWidth: 2,
      tipHeight: 6,
      fontSize: 10,
      iconSize: 12,
    },
    medium: {
      width: 36,
      height: 18,
      tipWidth: 3,
      tipHeight: 8,
      fontSize: 13,
      iconSize: 14,
    },
    large: {
      width: 48,
      height: 24,
      tipWidth: 4,
      tipHeight: 12,
      fontSize: 16,
      iconSize: 18,
    },
  };

  const config = sizeConfig[size];
  const batteryColor = getBatteryColor();

  return (
    <View style={styles.container}>
      {/* Battery Icon */}
      <View style={[styles.batteryContainer, { width: config.width, height: config.height }]}>
        {/* Battery body */}
        <View style={[styles.batteryBody, { borderColor: batteryColor }]}>
          {/* Battery fill */}
          <View
            style={[
              styles.batteryFill,
              {
                width: `${batteryLevel}%`,
                backgroundColor: batteryColor,
              },
            ]}
          />
          {/* Low battery pattern */}
          {batteryLevel <= 20 && !charging && (
            <View style={styles.lowBatteryPattern}>
              <Text style={styles.lowBatteryIcon}>!</Text>
            </View>
          )}
          {/* Charging indicator */}
          {charging && (
            <View style={styles.chargingIndicator}>
              <SymbolView name="bolt.fill" size={config.iconSize} tintColor="#fff" />
            </View>
          )}
        </View>
        {/* Battery tip */}
        <View
          style={[
            styles.batteryTip,
            {
              width: config.tipWidth,
              height: config.tipHeight,
              backgroundColor: batteryColor,
            },
          ]}
        />
      </View>

      {/* Percentage Text */}
      {showPercentage && (
        <Text style={[styles.percentageText, { fontSize: config.fontSize, color: batteryColor }]}>
          {Math.round(batteryLevel)}%
        </Text>
      )}

      {/* Charging Badge */}
      {charging && showPercentage && (
        <View style={styles.chargingBadge}>
          <SymbolView name="bolt.fill" size={10} tintColor="#4CAF50" />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  batteryContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  batteryBody: {
    flex: 1,
    height: '100%',
    borderWidth: 2,
    borderRadius: 3,
    padding: 2,
    overflow: 'hidden',
    position: 'relative',
  },
  batteryFill: {
    height: '100%',
    borderRadius: 1,
    minWidth: 2, // Ensure at least a small fill is visible
  },
  batteryTip: {
    borderTopRightRadius: 2,
    borderBottomRightRadius: 2,
    marginLeft: 1,
  },
  percentageText: {
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  lowBatteryPattern: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
  },
  lowBatteryIcon: {
    color: '#fff',
    fontSize: 10,
    fontWeight: 'bold',
  },
  chargingIndicator: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
  },
  chargingIcon: {
    color: '#fff',
  },
  chargingBadge: {
    backgroundColor: '#E8F5E9',
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  chargingBadgeText: {
    fontSize: 10,
  },
});
