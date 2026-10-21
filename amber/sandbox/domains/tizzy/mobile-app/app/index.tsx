import React, { useEffect, useState } from 'react';
import { View, StyleSheet, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { colors } from '../src/shared/constants/colors';

const ONBOARDING_KEY = 'has_seen_onboarding';
const AUTH_TOKEN_KEY = 'auth_token';

export default function Index() {
  const router = useRouter();
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    const checkInitialRoute = async () => {
      try {
        const [hasSeenOnboarding, authToken] = await Promise.all([
          AsyncStorage.getItem(ONBOARDING_KEY),
          AsyncStorage.getItem(AUTH_TOKEN_KEY),
        ]);

        if (!hasSeenOnboarding) {
          // First time user - show onboarding
          router.replace('/onboarding');
        } else if (authToken) {
          // Already authenticated
          router.replace('/(tabs)');
        } else {
          // Seen onboarding but not logged in
          router.replace('/(auth)/login');
        }
      } catch (err) {
        // Fallback to login on any error
        router.replace('/(auth)/login');
      }
    };

    checkInitialRoute();
  }, []);

  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color={colors.primary.main} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
