import React, { useEffect, useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  Alert,
} from 'react-native';
import { SymbolView } from 'expo-symbols';
import * as Haptics from 'expo-haptics';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withTiming,
  withSpring,
  FadeInDown,
  Easing,
} from 'react-native-reanimated';
import { useDeviceStore } from '../../src/store/deviceStore';
import { useDevice } from '../../src/features/devices/hooks/useDevice';
import { DeviceCard } from '../../src/features/devices/components/DeviceCard';
import { ConnectionStatus } from '../../src/features/devices/components/ConnectionStatus';
import { Button } from '../../src/shared/components/Button';
import { EmptyState, ErrorState } from '../../src/shared/components/EmptyState';
import { DeviceCardSkeleton } from '../../src/shared/components/SkeletonLoader';
import { colors } from '../../src/shared/constants/colors';
import { spacing } from '../../src/shared/constants/spacing';
import { typography } from '../../src/shared/constants/typography';

function ScanningAnimation() {
  const ring1 = useSharedValue(0.6);
  const ring2 = useSharedValue(0.3);
  const ring3 = useSharedValue(0);

  useEffect(() => {
    const config = { duration: 1800, easing: Easing.inOut(Easing.ease) };
    ring1.value = withRepeat(
      withSequence(withTiming(1, config), withTiming(0.6, config)),
      -1, false
    );
    ring2.value = withRepeat(
      withSequence(withTiming(0.8, { ...config, duration: 1800 }), withTiming(0.3, config)),
      -1, false
    );
    ring3.value = withRepeat(
      withSequence(withTiming(0.6, { ...config, duration: 1800 }), withTiming(0, config)),
      -1, false
    );
  }, []);

  const ring1Style = useAnimatedStyle(() => ({ opacity: ring1.value }));
  const ring2Style = useAnimatedStyle(() => ({ opacity: ring2.value }));
  const ring3Style = useAnimatedStyle(() => ({ opacity: ring3.value }));

  return (
    <View style={scanStyles.container}>
      <Animated.View style={[scanStyles.ring, scanStyles.ring3, ring3Style]} />
      <Animated.View style={[scanStyles.ring, scanStyles.ring2, ring2Style]} />
      <Animated.View style={[scanStyles.ring, scanStyles.ring1, ring1Style]} />
      <View style={scanStyles.center}>
        <SymbolView name="headphones" size={32} tintColor={colors.primary.main} />
      </View>
    </View>
  );
}

const scanStyles = StyleSheet.create({
  container: {
    width: 140,
    height: 140,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginVertical: 24,
  },
  ring: {
    position: 'absolute',
    borderRadius: 9999,
    borderWidth: 2,
    borderColor: colors.primary.main,
  },
  ring1: { width: 80, height: 80 },
  ring2: { width: 110, height: 110 },
  ring3: { width: 140, height: 140 },
  center: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: colors.primary.main + '15',
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default function DevicesScreen() {
  const { connectionState, deviceStatus, deviceId, rssi, signalStrength } = useDeviceStore();
  const { scanForDevice, disconnect, isScanning, error } = useDevice();
  const [refreshing, setRefreshing] = useState(false);

  // Handle pull to refresh
  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await scanForDevice();
    } catch (err) {
      console.error('Refresh scan error:', err);
    } finally {
      setRefreshing(false);
    }
  };

  // Handle connection/disconnection
  const handleConnectionToggle = async () => {
    if (connectionState === 'connected') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      Alert.alert(
        'Disconnect Device',
        'Are you sure you want to disconnect from your Tizzy device?',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Disconnect',
            style: 'destructive',
            onPress: async () => {
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
              await disconnect();
            },
          },
        ]
      );
    } else {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      await scanForDevice();
    }
  };

  // Show error alerts
  useEffect(() => {
    if (error) {
      Alert.alert('Connection Error', error, [{ text: 'OK' }]);
    }
  }, [error]);

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Devices</Text>
        <ConnectionStatus state={connectionState} />
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary.main}
            colors={[colors.primary.main]}
          />
        }
      >
        {/* Device Section */}
        <Animated.View entering={FadeInDown.delay(0).duration(400)} style={styles.section}>
          <Text style={styles.sectionTitle}>Your Tizzy Device</Text>

          {connectionState === 'connected' && deviceStatus ? (
            <DeviceCard
              deviceStatus={deviceStatus}
              connectionState={connectionState}
              signalStrength={signalStrength}
              rssi={rssi ?? undefined}
              onPress={handleConnectionToggle}
            />
          ) : connectionState === 'connecting' || connectionState === 'discovering' ? (
            <View style={styles.scanningContainer}>
              <ScanningAnimation />
              <Text style={styles.scanningTitle}>
                {connectionState === 'connecting' ? 'Searching for Device' : 'Connecting...'}
              </Text>
              <Text style={styles.scanningSubtitle}>
                {connectionState === 'connecting'
                  ? 'Make sure your Tizzy device is powered on and nearby'
                  : 'Discovering services and establishing connection...'}
              </Text>
            </View>
          ) : error ? (
            <ErrorState
              message={error}
              onRetry={scanForDevice}
              retryText="Try Again"
            />
          ) : (
            <EmptyState
              title="No Device Connected"
              description="Connect your Tizzy wearable device to start tracking your conversations and get real-time coaching feedback."
              icon={<SymbolView name="headphones" size={64} tintColor={colors.text.secondary} />}
              primaryAction={{
                title: 'Scan for Device',
                onPress: scanForDevice,
                variant: 'primary',
              }}
            />
          )}
        </Animated.View>

        {/* Connection Status Section */}
        <Animated.View entering={FadeInDown.delay(100).duration(400)} style={styles.section}>
          <Text style={styles.sectionTitle}>Connection Status</Text>
          <View style={styles.statusCard}>
            <View style={styles.statusRow}>
              <Text style={styles.statusLabel}>Status:</Text>
              <View style={styles.statusBadgeContainer}>
                <View
                  style={[
                    styles.statusDot,
                    connectionState === 'connected' && styles.statusDotConnected,
                    connectionState === 'connecting' && styles.statusDotConnecting,
                    connectionState === 'discovering' && styles.statusDotConnecting,
                    connectionState === 'disconnected' && styles.statusDotDisconnected,
                  ]}
                />
                <Text style={styles.statusText}>
                  {connectionState === 'connected' && 'Connected'}
                  {connectionState === 'connecting' && 'Connecting...'}
                  {connectionState === 'discovering' && 'Discovering Services...'}
                  {connectionState === 'disconnected' && 'Disconnected'}
                </Text>
              </View>
            </View>
            {deviceId && (
              <View style={styles.statusRow}>
                <Text style={styles.statusLabel}>Device ID:</Text>
                <Text style={styles.statusValue}>{deviceId}</Text>
              </View>
            )}
          </View>
        </Animated.View>

        {/* Action Buttons */}
        {connectionState === 'connected' && (
          <View style={styles.section}>
            <Button
              title="Disconnect Device"
              onPress={handleConnectionToggle}
              variant="danger"
              size="large"
              fullWidth
              disabled={isScanning}
              loading={isScanning}
            />

            <View style={styles.infoBox}>
              <SymbolView name="info.circle.fill" size={spacing.iconSize.md} tintColor={colors.info.dark} style={styles.infoIcon} />
              <Text style={styles.infoText}>
                Your device will automatically reconnect if the connection is lost
              </Text>
            </View>
          </View>
        )}

        {connectionState === 'disconnected' && !error && (
          <View style={styles.section}>
            <Button
              title="Scan for Device"
              onPress={scanForDevice}
              variant="primary"
              size="large"
              fullWidth
              disabled={isScanning}
              loading={isScanning}
            />
          </View>
        )}

        {/* Help Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Troubleshooting</Text>
          <View style={styles.helpCard}>
            <View style={styles.helpItem}>
              <SymbolView name="1.circle.fill" size={spacing.iconSize.md} tintColor={colors.text.secondary} style={styles.helpIcon} />
              <Text style={styles.helpText}>Make sure Bluetooth is enabled on your phone</Text>
            </View>
            <View style={styles.helpItem}>
              <SymbolView name="2.circle.fill" size={spacing.iconSize.md} tintColor={colors.text.secondary} style={styles.helpIcon} />
              <Text style={styles.helpText}>Ensure your Tizzy device is charged and powered on</Text>
            </View>
            <View style={styles.helpItem}>
              <SymbolView name="3.circle.fill" size={spacing.iconSize.md} tintColor={colors.text.secondary} style={styles.helpIcon} />
              <Text style={styles.helpText}>Keep your device within 30 feet of your phone</Text>
            </View>
            <View style={styles.helpItem}>
              <SymbolView name="4.circle.fill" size={spacing.iconSize.md} tintColor={colors.text.secondary} style={styles.helpIcon} />
              <Text style={styles.helpText}>Try restarting both your phone and device if issues persist</Text>
            </View>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background.secondary,
  },
  header: {
    backgroundColor: colors.background.primary,
    paddingTop: 60,
    paddingBottom: spacing.md,
    paddingHorizontal: spacing.screenPadding,
    borderBottomWidth: spacing.borderWidth.thin,
    borderBottomColor: colors.border.light,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  title: {
    ...typography.heading1,
    color: colors.text.primary,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: spacing.screenPadding,
  },
  section: {
    marginBottom: spacing.sectionSpacing,
  },
  sectionTitle: {
    ...typography.heading3,
    color: colors.text.primary,
    marginBottom: spacing.md,
  },
  statusCard: {
    backgroundColor: colors.background.primary,
    borderRadius: spacing.radius.lg,
    padding: spacing.cardPadding,
    shadowColor: colors.shadow.main,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  statusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  statusLabel: {
    ...typography.body1,
    color: colors.text.secondary,
  },
  statusValue: {
    ...typography.body1,
    color: colors.text.primary,
    fontFamily: 'monospace',
  },
  statusBadgeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: spacing.sm,
  },
  statusDotConnected: {
    backgroundColor: colors.success.main,
  },
  statusDotConnecting: {
    backgroundColor: colors.warning.main,
  },
  statusDotDisconnected: {
    backgroundColor: colors.neutral.gray400,
  },
  statusText: {
    ...typography.body1,
    fontWeight: '500',
    color: colors.text.primary,
  },
  infoBox: {
    flexDirection: 'row',
    backgroundColor: colors.info.light + '20', // Light blue with transparency
    padding: spacing.md,
    borderRadius: spacing.radius.md,
    marginTop: spacing.md,
    alignItems: 'center',
  },
  infoIcon: {
    marginRight: spacing.sm,
  },
  infoText: {
    flex: 1,
    ...typography.body2,
    color: colors.info.dark,
  },
  helpCard: {
    backgroundColor: colors.background.primary,
    borderRadius: spacing.radius.lg,
    padding: spacing.cardPadding,
    shadowColor: colors.shadow.main,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  helpItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: spacing.md,
  },
  helpIcon: {
    marginRight: spacing.md,
  },
  helpText: {
    flex: 1,
    ...typography.body2,
    color: colors.text.secondary,
    lineHeight: 20,
  },
  scanningContainer: {
    backgroundColor: colors.background.primary,
    borderRadius: spacing.radius.lg,
    padding: spacing.xl,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 3,
    borderWidth: 1,
    borderColor: colors.border.light,
  },
  scanningTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text.primary,
    marginBottom: 8,
    textAlign: 'center',
  },
  scanningSubtitle: {
    fontSize: 14,
    color: colors.text.secondary,
    textAlign: 'center',
    lineHeight: 20,
    maxWidth: 260,
  },
});
