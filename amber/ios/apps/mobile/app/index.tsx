import { Redirect } from 'expo-router';

// Land on the pager home screen — the hero experience.
// AuthGate intercepts unauthenticated users and bounces to /(auth)/sign-in first.
export default function Index() {
  return <Redirect href="/(gated)/home" />;
}
