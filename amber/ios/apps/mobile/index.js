// Entry point. Hands control to expo-router which discovers app/ routes.
if (__DEV__ && process.env.EXPO_PUBLIC_DESIGN_PREVIEW === '1') {
  // A separate component tree: no auth gate, stored session, or app bridges.
  const { registerRootComponent } = require('expo');
  registerRootComponent(require('./preview/OnboardingPreview').default);
} else {
  require('expo-router/entry');
}
