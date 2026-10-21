import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Platform,
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getNotificationService } from '../../../services/NotificationService';

interface NotificationPermissionScreenProps {
  onComplete: (granted: boolean) => void;
  onSkip?: () => void;
}

/**
 * Notification Permission Request Screen
 *
 * Presents a user-friendly explanation before requesting notification permissions
 */
export default function NotificationPermissionScreen({
  onComplete,
  onSkip,
}: NotificationPermissionScreenProps) {
  const [requesting, setRequesting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleRequestPermission = async () => {
    setRequesting(true);
    setError(null);

    try {
      const notificationService = getNotificationService();
      const result = await notificationService.requestPermissions();

      if (result.granted) {
        // Also register for push notifications
        await notificationService.registerForPushNotifications();
        onComplete(true);
      } else {
        if (!result.canAskAgain) {
          setError(
            'Please enable notifications in your device settings to receive session reminders and insights.'
          );
        } else {
          onComplete(false);
        }
      }
    } catch (err) {
      console.error('Failed to request permissions:', err);
      setError('Failed to request notification permissions. Please try again.');
    } finally {
      setRequesting(false);
    }
  };

  const handleOpenSettings = () => {
    if (Platform.OS === 'ios') {
      Linking.openURL('app-settings:');
    } else {
      Linking.openSettings();
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        {/* Icon */}
        <View style={styles.iconContainer}>
          <Text style={styles.icon}>[bell.fill]</Text>
        </View>

        {/* Title */}
        <Text style={styles.title}>Stay Connected to Your Progress</Text>

        {/* Description */}
        <Text style={styles.description}>
          Enable notifications to receive:
        </Text>

        {/* Features */}
        <View style={styles.featuresContainer}>
          <FeatureItem
            icon="[hourglass]"
            title="Session Reminders"
            description="Get timely reminders based on your patterns"
          />
          <FeatureItem
            icon="[lightbulb.fill]"
            title="Coaching Insights"
            description="Receive insights when they're ready"
          />
          <FeatureItem
            icon="[trophy.fill]"
            title="Achievements"
            description="Celebrate your progress and milestones"
          />
          <FeatureItem
            icon="[target]"
            title="Daily Goals"
            description="Gentle reminders for your micro-goals"
          />
        </View>

        {/* Error message */}
        {error && (
          <View style={styles.errorContainer}>
            <Text style={styles.errorText}>{error}</Text>
            {!error.includes('try again') && (
              <TouchableOpacity
                style={styles.settingsButton}
                onPress={handleOpenSettings}
              >
                <Text style={styles.settingsButtonText}>Open Settings</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* Action buttons */}
        <View style={styles.buttonsContainer}>
          <TouchableOpacity
            style={[styles.button, styles.primaryButton]}
            onPress={handleRequestPermission}
            disabled={requesting}
          >
            <Text style={styles.primaryButtonText}>
              {requesting ? 'Requesting...' : 'Enable Notifications'}
            </Text>
          </TouchableOpacity>

          {onSkip && (
            <TouchableOpacity
              style={[styles.button, styles.secondaryButton]}
              onPress={onSkip}
              disabled={requesting}
            >
              <Text style={styles.secondaryButtonText}>Not Now</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Privacy note */}
        <Text style={styles.privacyNote}>
          You can customize notification preferences anytime in settings
        </Text>
      </View>
    </SafeAreaView>
  );
}

function FeatureItem({
  icon,
  title,
  description,
}: {
  icon: string;
  title: string;
  description: string;
}) {
  return (
    <View style={styles.featureItem}>
      <Text style={styles.featureIcon}>{icon}</Text>
      <View style={styles.featureContent}>
        <Text style={styles.featureTitle}>{title}</Text>
        <Text style={styles.featureDescription}>{description}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  content: {
    flex: 1,
    padding: 24,
    justifyContent: 'center',
  },
  iconContainer: {
    alignItems: 'center',
    marginBottom: 24,
  },
  icon: {
    fontSize: 80,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#1F2937',
    textAlign: 'center',
    marginBottom: 16,
  },
  description: {
    fontSize: 16,
    color: '#6B7280',
    textAlign: 'center',
    marginBottom: 32,
  },
  featuresContainer: {
    marginBottom: 32,
  },
  featureItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 20,
  },
  featureIcon: {
    fontSize: 32,
    marginRight: 16,
  },
  featureContent: {
    flex: 1,
  },
  featureTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1F2937',
    marginBottom: 4,
  },
  featureDescription: {
    fontSize: 14,
    color: '#6B7280',
    lineHeight: 20,
  },
  errorContainer: {
    backgroundColor: '#FEE2E2',
    borderRadius: 12,
    padding: 16,
    marginBottom: 24,
  },
  errorText: {
    fontSize: 14,
    color: '#991B1B',
    textAlign: 'center',
    marginBottom: 12,
  },
  settingsButton: {
    backgroundColor: '#DC2626',
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  settingsButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  buttonsContainer: {
    gap: 12,
  },
  button: {
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 24,
    alignItems: 'center',
  },
  primaryButton: {
    backgroundColor: '#3B82F6',
  },
  primaryButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  secondaryButton: {
    backgroundColor: '#F3F4F6',
  },
  secondaryButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#6B7280',
  },
  privacyNote: {
    fontSize: 12,
    color: '#9CA3AF',
    textAlign: 'center',
    marginTop: 16,
  },
});
