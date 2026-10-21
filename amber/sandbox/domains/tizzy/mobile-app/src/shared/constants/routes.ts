/**
 * Routes
 * Centralized constants for all navigation routes in the app
 */

export const ROUTES = {
  // Root
  ROOT: '/',

  // Auth Routes
  AUTH: '/(auth)',
  LOGIN: '/(auth)/login',
  LOGIN_SIMPLE: '/(auth)/login-simple',
  SIGNUP: '/(auth)/signup',

  // Tab Routes
  TABS: '/(tabs)',
  HOME: '/(tabs)/',
  DEVICES: '/(tabs)/devices',
  SESSIONS: '/(tabs)/sessions',
  COACHING: '/(tabs)/coaching',
  PROFILE: '/(tabs)/profile',

  // Coaching Routes
  SESSION_DETAIL: '/coaching/session-detail',
} as const;
