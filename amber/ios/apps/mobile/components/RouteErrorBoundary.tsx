import { View } from 'react-native';
import type { ErrorBoundaryProps } from 'expo-router';
import { ErrorState } from './ErrorState';
import { LIGHT } from '../lib/theme';
import { spacing } from '../lib/tokens';

// Fallback for an expo-router ErrorBoundary export. A render throw anywhere in
// the subtree lands here instead of unmounting the tree to a white screen, and
// `retry` remounts the route so the user can recover without killing the app.
//
// Deliberately provider-free: the root layout's boundary replaces that layout's
// own render, so SafeAreaProvider / GestureHandlerRootView are NOT mounted
// around it. Anything needing safe-area insets or gesture context would crash
// the fallback itself. Centering avoids the notch without needing insets.
export function RouteErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  // The raw message is never shown — it is a stack-level string, not copy — but
  // it must be observable, so log it once on mount of the fallback.
  console.error('[route] render error', error);

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: LIGHT.canvas,
        justifyContent: 'center',
        paddingHorizontal: spacing.lg,
      }}
    >
      <ErrorState
        title="This screen hit a snag."
        message="Amber could not finish drawing this screen. Try again — your data is safe."
        retryLabel="Reload screen"
        onRetry={() => {
          void retry();
        }}
      />
    </View>
  );
}
