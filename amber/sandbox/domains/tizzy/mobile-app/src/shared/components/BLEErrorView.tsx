/**
 * BLE Error View Component
 * Displays BLE-specific errors with helpful recovery guidance
 */

import React from 'react';
import { View, Text, StyleSheet, Platform, Linking } from 'react-native';
import { SymbolView } from 'expo-symbols';
import { colors } from '../constants/colors';
import { spacing } from '../constants/spacing';
import { typography } from '../constants/typography';
import { Button } from './Button';

export type BLEErrorType =
  | 'bluetooth_off'
  | 'permission_denied'
  | 'device_not_found'
  | 'connection_lost'
  | 'pairing_failed'
  | 'unsupported'
  | 'unknown';

interface BLEErrorViewProps {
  /**
   * Type of BLE error
   */
  errorType: BLEErrorType;

  /**
   * Retry callback
   */
  onRetry?: () => void;

  /**
   * Optional custom message
   */
  customMessage?: string;

  /**
   * Show settings button
   */
  showSettingsButton?: boolean;
}

interface ErrorContent {
  icon: string;
  title: string;
  message: string;
  suggestion: string;
  canRetry: boolean;
  showSettings: boolean;
}

/**
 * BLE Error View Component
 *
 * Displays user-friendly error messages for Bluetooth issues with
 * actionable recovery steps.
 *
 * @example
 * ```tsx
 * <BLEErrorView
 *   errorType="bluetooth_off"
 *   onRetry={handleRetry}
 *   showSettingsButton
 * />
 * ```
 */
export const BLEErrorView: React.FC<BLEErrorViewProps> = ({
  errorType,
  onRetry,
  customMessage,
  showSettingsButton = false,
}) => {
  const content = getErrorContent(errorType);

  const handleOpenSettings = () => {
    if (Platform.OS === 'ios') {
      Linking.openURL('app-settings:');
    } else {
      Linking.sendIntent('android.settings.BLUETOOTH_SETTINGS');
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.iconContainer}>
        <SymbolView
          name={content.icon}
          size={64}
          type="hierarchical"
          tintColor={colors.text.secondary}
        />
      </View>

      <Text style={styles.title}>{content.title}</Text>

      <Text style={styles.message}>
        {customMessage || content.message}
      </Text>

      <View style={styles.suggestionContainer}>
        <Text style={styles.suggestionTitle}>What to do:</Text>
        <Text style={styles.suggestion}>{content.suggestion}</Text>
      </View>

      <View style={styles.buttonContainer}>
        {content.canRetry && onRetry && (
          <Button
            title="Try Again"
            onPress={onRetry}
            variant="primary"
            size="large"
            fullWidth
            style={styles.button}
          />
        )}

        {(showSettingsButton || content.showSettings) && (
          <Button
            title="Open Settings"
            onPress={handleOpenSettings}
            variant={content.canRetry ? 'secondary' : 'primary'}
            size="large"
            fullWidth
            style={styles.button}
          />
        )}
      </View>

      {errorType === 'device_not_found' && (
        <View style={styles.troubleshootContainer}>
          <Text style={styles.troubleshootTitle}>Troubleshooting Tips:</Text>
          <View style={styles.tipsList}>
            <Text style={styles.tip}>• Make sure your Tizzy device is powered on</Text>
            <Text style={styles.tip}>• Keep the device within 30 feet (10 meters)</Text>
            <Text style={styles.tip}>• Check if the device battery is charged</Text>
            <Text style={styles.tip}>• Try turning Bluetooth off and on again</Text>
            <Text style={styles.tip}>• Restart your phone if the issue persists</Text>
          </View>
        </View>
      )}

      {errorType === 'pairing_failed' && (
        <View style={styles.troubleshootContainer}>
          <Text style={styles.troubleshootTitle}>Pairing Steps:</Text>
          <View style={styles.tipsList}>
            <Text style={styles.tip}>1. Forget the device in Bluetooth settings</Text>
            <Text style={styles.tip}>2. Restart your Tizzy device</Text>
            <Text style={styles.tip}>3. Make sure no other device is connected to Tizzy</Text>
            <Text style={styles.tip}>4. Try pairing again</Text>
          </View>
        </View>
      )}
    </View>
  );
};

/**
 * Get error content based on error type
 */
function getErrorContent(errorType: BLEErrorType): ErrorContent {
  switch (errorType) {
    case 'bluetooth_off':
      return {
        icon: 'wifi',
        title: 'Bluetooth is Off',
        message: 'Bluetooth is required to connect to your Tizzy device.',
        suggestion: 'Turn on Bluetooth in your device settings and try again.',
        canRetry: true,
        showSettings: true,
      };

    case 'permission_denied':
      return {
        icon: 'lock.fill',
        title: 'Bluetooth Permission Required',
        message: 'Tizzy needs Bluetooth permission to connect to your device.',
        suggestion: 'Grant Bluetooth permissions in your device settings.',
        canRetry: false,
        showSettings: true,
      };

    case 'device_not_found':
      return {
        icon: 'magnifyingglass',
        title: 'Device Not Found',
        message: "We couldn't find your Tizzy device.",
        suggestion: 'Make sure your device is nearby, powered on, and not connected to another phone.',
        canRetry: true,
        showSettings: false,
      };

    case 'connection_lost':
      return {
        icon: 'antenna.radiowaves.left.and.right',
        title: 'Connection Lost',
        message: 'Lost connection to your Tizzy device.',
        suggestion: 'Move closer to your device and make sure it\'s still powered on.',
        canRetry: true,
        showSettings: false,
      };

    case 'pairing_failed':
      return {
        icon: 'exclamationmark.triangle.fill',
        title: 'Pairing Failed',
        message: 'Unable to pair with your Tizzy device.',
        suggestion: 'Follow the pairing steps below to resolve this issue.',
        canRetry: true,
        showSettings: false,
      };

    case 'unsupported':
      return {
        icon: 'xmark.circle.fill',
        title: 'Bluetooth Not Supported',
        message: 'Your device does not support Bluetooth Low Energy (BLE).',
        suggestion: 'Tizzy requires a device with BLE support to function.',
        canRetry: false,
        showSettings: false,
      };

    case 'unknown':
    default:
      return {
        icon: 'exclamationmark.triangle.fill',
        title: 'Bluetooth Error',
        message: 'An unexpected Bluetooth error occurred.',
        suggestion: 'Try restarting both your phone and Tizzy device.',
        canRetry: true,
        showSettings: false,
      };
  }
}

const styles = StyleSheet.create({
  container: {
    padding: spacing.xl,
    alignItems: 'center',
  },
  iconContainer: {
    marginBottom: spacing.lg,
  },
  title: {
    ...typography.heading3,
    color: colors.text.primary,
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  message: {
    ...typography.body1,
    color: colors.text.secondary,
    textAlign: 'center',
    marginBottom: spacing.lg,
  },
  suggestionContainer: {
    backgroundColor: colors.primary.light,
    borderRadius: spacing.radius.md,
    padding: spacing.md,
    marginBottom: spacing.xl,
    width: '100%',
  },
  suggestionTitle: {
    ...typography.subtitle2,
    color: colors.primary.dark,
    marginBottom: spacing.xs,
    fontWeight: '600',
  },
  suggestion: {
    ...typography.body2,
    color: colors.primary.dark,
  },
  buttonContainer: {
    width: '100%',
    gap: spacing.md,
  },
  button: {
    marginBottom: spacing.sm,
  },
  troubleshootContainer: {
    marginTop: spacing.xl,
    padding: spacing.md,
    backgroundColor: colors.background.tertiary,
    borderRadius: spacing.radius.md,
    width: '100%',
  },
  troubleshootTitle: {
    ...typography.subtitle2,
    color: colors.text.primary,
    marginBottom: spacing.sm,
    fontWeight: '600',
  },
  tipsList: {
    gap: spacing.xs,
  },
  tip: {
    ...typography.body2,
    color: colors.text.secondary,
    lineHeight: 20,
  },
});
