/**
 * Error Tracking Service - Sentry Integration
 *
 * Provides comprehensive error and performance monitoring with:
 * - Crash reporting
 * - Error boundary integration
 * - Performance monitoring
 * - Release tracking
 * - User context (privacy-compliant)
 */

import * as Sentry from '@sentry/react-native';
import { reactNavigationIntegration } from '@sentry/react-native';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Application from 'expo-application';

// ==================== Types ====================

export interface ErrorContext {
  [key: string]: any;
}

export interface BreadcrumbData {
  message: string;
  category?: string;
  level?: 'debug' | 'info' | 'warning' | 'error' | 'fatal';
  data?: Record<string, any>;
}

export interface PerformanceTransaction {
  name: string;
  op: string;
}

export interface UserContext {
  id: string;
  anonymousId?: string;
  deviceId?: string;
}

// ==================== Configuration ====================

const SENTRY_DSN = Constants.expoConfig?.extra?.sentryDsn || process.env.EXPO_PUBLIC_SENTRY_DSN;
const ENVIRONMENT = Constants.expoConfig?.extra?.environment || __DEV__ ? 'development' : 'production';
const APP_VERSION = Application.nativeApplicationVersion || '1.0.0';
const BUILD_NUMBER = Application.nativeBuildVersion || '1';

/**
 * Initialize Sentry error tracking
 * Call this at app startup in _layout.tsx
 */
export function initializeErrorTracking(options?: {
  enableInDev?: boolean;
  tracesSampleRate?: number;
  enableAutoSessionTracking?: boolean;
}): void {
  const {
    enableInDev = false,
    tracesSampleRate = 1.0,
    enableAutoSessionTracking = true,
  } = options || {};

  // Skip initialization in development unless explicitly enabled
  if (__DEV__ && !enableInDev) {
    console.log('[ErrorTracking] Sentry disabled in development mode');
    return;
  }

  if (!SENTRY_DSN) {
    console.warn('[ErrorTracking] Sentry DSN not configured. Error tracking disabled.');
    return;
  }

  try {
    Sentry.init({
      dsn: SENTRY_DSN,
      environment: ENVIRONMENT,

      // Release and version tracking
      release: `${Constants.expoConfig?.slug}@${APP_VERSION}`,
      dist: BUILD_NUMBER,

      // Performance monitoring
      tracesSampleRate,
      enableAutoSessionTracking,

      // Session tracking
      sessionTrackingIntervalMillis: 30000, // 30 seconds

      // Enable/disable features
      enabled: true,
      enableNative: true,
      enableNativeCrashHandling: true,
      enableNativeNagger: false, // Don't show native warnings

      // Privacy settings
      maxBreadcrumbs: 100,
      attachStacktrace: true,

      // Before send hook - sanitize data
      beforeSend(event, hint) {
        // Remove PII from events
        if (event.request?.cookies) {
          delete event.request.cookies;
        }

        if (event.user?.email) {
          delete event.user.email;
        }

        if (event.user?.ip_address) {
          delete event.user.ip_address;
        }

        // In dev, log the event
        if (__DEV__) {
          console.log('[ErrorTracking] Sentry event:', event);
          console.log('[ErrorTracking] Sentry hint:', hint);
        }

        return event;
      },

      // Before breadcrumb hook - filter sensitive data
      beforeBreadcrumb(breadcrumb) {
        // Filter out sensitive breadcrumbs
        if (breadcrumb.category === 'console' && breadcrumb.message?.includes('password')) {
          return null;
        }

        return breadcrumb;
      },

      // Integration configuration
      integrations: [
        reactNavigationIntegration(),
      ],
    });

    // Set initial device context
    Sentry.setContext('device', {
      manufacturer: Device.manufacturer,
      modelName: Device.modelName,
      osName: Device.osName,
      osVersion: Device.osVersion,
      deviceYearClass: Device.deviceYearClass,
      totalMemory: Device.totalMemory,
    });

    // Set app context
    Sentry.setContext('app', {
      version: APP_VERSION,
      buildNumber: BUILD_NUMBER,
      expoVersion: Constants.expoConfig?.sdkVersion,
    });

    console.log('[ErrorTracking] Sentry initialized successfully');
  } catch (error) {
    console.error('[ErrorTracking] Failed to initialize Sentry:', error);
  }
}

// ==================== User Context ====================

/**
 * Set user context (privacy-compliant - no PII)
 */
export function setUser(user: UserContext | null): void {
  if (!user) {
    Sentry.setUser(null);
    return;
  }

  // Only set anonymous identifiers
  Sentry.setUser({
    id: user.anonymousId || user.id,
    // Never include: email, username, ip_address, or any PII
  });

  // Store additional context separately
  if (user.deviceId) {
    Sentry.setContext('user_device', {
      deviceId: user.deviceId,
    });
  }
}

/**
 * Set user context (alias for setUser)
 */
export function setUserContext(user: UserContext | null): void {
  setUser(user);
}

/**
 * Clear user context
 */
export function clearUser(): void {
  Sentry.setUser(null);
  Sentry.setContext('user_device', null);
}

// ==================== Error Reporting ====================

/**
 * Capture an exception with optional context
 */
export function captureException(
  error: Error,
  context?: ErrorContext,
  level?: Sentry.SeverityLevel
): string {
  const eventId = Sentry.captureException(error, {
    level: level || 'error',
    contexts: context,
  });

  if (__DEV__) {
    console.error('[ErrorTracking] Exception captured:', error, 'Event ID:', eventId);
  }

  return eventId;
}

/**
 * Capture an error message (alias for captureMessage)
 */
export function captureError(
  message: string,
  level?: Sentry.SeverityLevel,
  context?: ErrorContext
): string {
  return captureMessage(message, level, context);
}

/**
 * Capture a message with optional context
 */
export function captureMessage(
  message: string,
  level?: Sentry.SeverityLevel,
  context?: ErrorContext
): string {
  const eventId = Sentry.captureMessage(message, {
    level: level || 'info',
    contexts: context,
  });

  if (__DEV__) {
    console.log('[ErrorTracking] Message captured:', message, 'Event ID:', eventId);
  }

  return eventId;
}

/**
 * Add a breadcrumb for debugging
 */
export function addBreadcrumb(breadcrumb: BreadcrumbData): void {
  Sentry.addBreadcrumb({
    message: breadcrumb.message,
    category: breadcrumb.category || 'default',
    level: breadcrumb.level || 'info',
    data: breadcrumb.data,
    timestamp: Date.now() / 1000,
  });
}

// ==================== Performance Monitoring ====================

/**
 * Start a performance transaction
 * In Sentry v8, use this with the callback pattern for automatic span management
 */
export function startTransaction(
  name: string,
  op: string = 'custom',
  callback?: (span: Sentry.Span | undefined) => void | Promise<void>
): void {
  try {
    if (__DEV__) {
      console.log('[ErrorTracking] Transaction started:', name);
    }

    Sentry.startSpan(
      {
        name,
        op,
      },
      callback || (() => {})
    );
  } catch (error) {
    console.error('[ErrorTracking] Failed to start transaction:', error);
  }
}

/**
 * Measure async operation performance
 */
export async function measurePerformance<T>(
  name: string,
  operation: () => Promise<T>,
  op: string = 'custom'
): Promise<T> {
  return await Sentry.startSpan(
    {
      name,
      op,
    },
    async (span) => {
      try {
        const result = await operation();
        span?.setStatus({ code: 1, message: 'ok' }); // SPAN_STATUS_OK
        return result;
      } catch (error) {
        span?.setStatus({ code: 2, message: 'internal_error' }); // SPAN_STATUS_ERROR
        throw error;
      }
    }
  );
}

/**
 * Track API response time
 */
export function trackAPICall(
  endpoint: string,
  method: string,
  statusCode: number,
  duration: number
): void {
  addBreadcrumb({
    category: 'api',
    message: `${method} ${endpoint}`,
    level: statusCode >= 400 ? 'error' : 'info',
    data: {
      endpoint,
      method,
      statusCode,
      duration,
    },
  });

  // Create a span for the API call
  const client = Sentry.getClient();
  if (client) {
    Sentry.startSpan(
      {
        op: 'http.client',
        name: `${method} ${endpoint}`,
      },
      (span) => {
        if (span) {
          span.setStatus({
            code: statusCode >= 400 ? 2 : 1, // SPAN_STATUS_ERROR : SPAN_STATUS_OK
            message: statusCode >= 400 ? 'unknown_error' : 'ok'
          });
          span.setAttribute('http.method', method);
          span.setAttribute('http.url', endpoint);
          span.setAttribute('http.status_code', statusCode);
          span.setAttribute('duration', duration);
        }
      }
    );
  }
}

// ==================== Context Management ====================

/**
 * Set custom context for debugging
 */
export function setContext(name: string, context: Record<string, any> | null): void {
  Sentry.setContext(name, context);
}

/**
 * Set a tag for filtering
 */
export function setTag(key: string, value: string): void {
  Sentry.setTag(key, value);
}

/**
 * Set multiple tags at once
 */
export function setTags(tags: Record<string, string>): void {
  Sentry.setTags(tags);
}

// ==================== Feature-Specific Tracking ====================

/**
 * Track BLE connection errors
 */
export function trackBLEError(error: Error, deviceInfo?: Record<string, any>): void {
  captureException(error, {
    ble: {
      ...deviceInfo,
      errorType: 'connection',
    },
  }, 'error');

  addBreadcrumb({
    category: 'ble',
    message: `BLE Error: ${error.message}`,
    level: 'error',
    data: deviceInfo,
  });
}

/**
 * Track audio processing errors
 */
export function trackAudioError(error: Error, audioInfo?: Record<string, any>): void {
  captureException(error, {
    audio: {
      ...audioInfo,
      errorType: 'processing',
    },
  }, 'error');

  addBreadcrumb({
    category: 'audio',
    message: `Audio Error: ${error.message}`,
    level: 'error',
    data: audioInfo,
  });
}

/**
 * Track API errors
 */
export function trackAPIError(
  error: Error,
  endpoint: string,
  method: string,
  statusCode?: number
): void {
  captureException(error, {
    api: {
      endpoint,
      method,
      statusCode,
      errorType: 'request',
    },
  }, 'error');

  addBreadcrumb({
    category: 'api',
    message: `API Error: ${method} ${endpoint}`,
    level: 'error',
    data: {
      endpoint,
      method,
      statusCode,
      errorMessage: error.message,
    },
  });
}

// ==================== Session Management ====================

/**
 * Start a new session
 */
export function startSession(): void {
  addBreadcrumb({
    category: 'session',
    message: 'Session started',
    level: 'info',
  });
}

/**
 * End the current session
 */
export function endSession(): void {
  addBreadcrumb({
    category: 'session',
    message: 'Session ended',
    level: 'info',
  });
}

// ==================== Exports ====================

export default {
  initialize: initializeErrorTracking,
  setUser,
  setUserContext,
  clearUser,
  captureError,
  captureException,
  captureMessage,
  addBreadcrumb,
  startTransaction,
  measurePerformance,
  trackAPICall,
  setContext,
  setTag,
  setTags,
  trackBLEError,
  trackAudioError,
  trackAPIError,
  startSession,
  endSession,
};
