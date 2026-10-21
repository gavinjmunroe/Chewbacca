import { useEffect, useState } from 'react';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import {
  Newsreader_400Regular,
  Newsreader_400Regular_Italic,
  Newsreader_500Medium,
  Newsreader_600SemiBold,
  Newsreader_700Bold,
} from '@expo-google-fonts/newsreader';
import {
  Outfit_400Regular,
  Outfit_500Medium,
  Outfit_600SemiBold,
  Outfit_700Bold,
} from '@expo-google-fonts/outfit';
import { SafeAreaProvider, initialWindowMetrics } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import NetworkOnboarding from './NetworkOnboarding';
import ProductionOnboarding from '../app/(gated)/onboarding';
import HealthNetworkPreview from './HealthNetworkPreview';
import '../global.css';

// Isolated health-network design prototype with in-memory sample data.
// Never mounts the auth/session, notification, deep-link or data-sync bridges.
export default function OnboardingPreview() {
  const [name, setName] = useState<string | null>(null);
  const [loaded, error] = useFonts({
    Newsreader_400Regular,
    Newsreader_400Regular_Italic,
    Newsreader_500Medium,
    Newsreader_600SemiBold,
    Newsreader_700Bold,
    Outfit_400Regular,
    Outfit_500Medium,
    Outfit_600SemiBold,
    Outfit_700Bold,
  });
  useEffect(() => {
    if (loaded || error) void SplashScreen.hideAsync();
  }, [loaded, error]);
  if (!__DEV__) return null;
  if (!loaded && !error) return null;
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <KeyboardProvider>
        <SafeAreaProvider initialMetrics={initialWindowMetrics}>
          <>
            {name === null ? (
              process.env.EXPO_PUBLIC_ONBOARDING_QA === '1' ? <ProductionOnboarding preview onPreviewComplete={() => setName('Preview')} /> : <NetworkOnboarding onComplete={setName} />
            ) : (
              <HealthNetworkPreview selfName={name} onRestartOnboarding={() => setName(null)} />
            )}
          </>
        </SafeAreaProvider>
      </KeyboardProvider>
    </GestureHandlerRootView>
  );
}
