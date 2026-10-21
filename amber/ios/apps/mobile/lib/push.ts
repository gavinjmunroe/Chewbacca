import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { callMedhaId } from './medhaId';

// EAS projectId (app.json extra.eas.projectId) — required by
// getExpoPushTokenAsync to mint a token bound to this project.
const EAS_PROJECT_ID = '65b9b69f-7b1a-4915-9309-42a1069869e8';

// Register this device for push and upload its Expo token to medha-id.
//
// Fully self-contained and defensive: it never throws and never blocks the
// caller. iOS only (Android/simulator/web no-op), returns quietly if the user
// declines the permission, and swallows upload failures (logs only) so a
// registration hiccup can never crash the app.
export async function registerForPushNotifications(): Promise<void> {
  try {
    // expo-device isn't installed; guard on the platform instead. On the iOS
    // Simulator getExpoPushTokenAsync throws, which the try/catch swallows.
    if (Platform.OS !== 'ios') return;

    const perm = await Notifications.requestPermissionsAsync();
    if (perm.status !== 'granted') return;

    const tokenResult = await Notifications.getExpoPushTokenAsync({ projectId: EAS_PROJECT_ID });
    const token = tokenResult.data;
    if (!token) return;

    const res = await callMedhaId({
      path: '/v1/me/push-token',
      method: 'POST',
      body: { token, platform: 'ios' },
      requireAuth: true,
    });
    if (!res.ok) {
      console.warn('[push] token upload did not succeed', res.status, res.error);
    }
  } catch (e) {
    // Never crash on registration — a missing key, denied permission mid-flow,
    // or simulator environment should all degrade silently.
    console.warn('[push] registration failed', e);
  }
}
