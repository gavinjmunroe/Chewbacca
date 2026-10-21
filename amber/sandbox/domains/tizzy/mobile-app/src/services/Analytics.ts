/**
 * Analytics Service
 *
 * Privacy-compliant analytics with:
 * - Event tracking (screen views, button clicks, feature usage)
 * - User properties (opt-in only)
 * - Session tracking
 * - Conversion funnels
 * - Opt-out support
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Application from 'expo-application';

// ==================== Types ====================

export interface AnalyticsEvent {
  name: string;
  properties?: Record<string, any>;
  timestamp?: number;
}

export interface UserProperties {
  [key: string]: string | number | boolean | null;
}

export interface ScreenViewEvent {
  screenName: string;
  previousScreen?: string;
  params?: Record<string, any>;
}

export interface SessionData {
  sessionId: string;
  startTime: number;
  lastActivityTime: number;
  eventCount: number;
}

// ==================== Constants ====================

const STORAGE_KEYS = {
  ANALYTICS_ENABLED: '@tizzy/analytics_enabled',
  ANONYMOUS_ID: '@tizzy/anonymous_id',
  SESSION_DATA: '@tizzy/session_data',
  USER_PROPERTIES: '@tizzy/user_properties',
} as const;

const SESSION_TIMEOUT = 30 * 60 * 1000; // 30 minutes
const BATCH_SIZE = 20;
const BATCH_INTERVAL = 10000; // 10 seconds

// ==================== State ====================

let isInitialized = false;
let analyticsEnabled = true;
let anonymousId: string | null = null;
let currentSession: SessionData | null = null;
let eventQueue: AnalyticsEvent[] = [];
let batchTimer: NodeJS.Timeout | null = null;
let userProperties: UserProperties = {};

// ==================== Initialization ====================

/**
 * Initialize analytics service
 * Call this at app startup in _layout.tsx
 */
export async function initializeAnalytics(options?: {
  enableInDev?: boolean;
  autoTrackScreens?: boolean;
}): Promise<void> {
  const { enableInDev = false, autoTrackScreens = true } = options || {};

  // Skip in development unless explicitly enabled
  if (__DEV__ && !enableInDev) {
    console.log('[Analytics] Disabled in development mode');
    isInitialized = true;
    analyticsEnabled = false;
    return;
  }

  try {
    // Check if user has opted out
    const storedEnabled = await AsyncStorage.getItem(STORAGE_KEYS.ANALYTICS_ENABLED);
    analyticsEnabled = storedEnabled !== 'false';

    if (!analyticsEnabled) {
      console.log('[Analytics] Analytics disabled by user');
      isInitialized = true;
      return;
    }

    // Get or create anonymous ID
    anonymousId = await getOrCreateAnonymousId();

    // Load user properties
    const storedProperties = await AsyncStorage.getItem(STORAGE_KEYS.USER_PROPERTIES);
    if (storedProperties) {
      userProperties = JSON.parse(storedProperties);
    }

    // Initialize session
    await initializeSession();

    // Start batch processing
    startBatchProcessing();

    isInitialized = true;
    console.log('[Analytics] Initialized successfully');

    // Track app opened
    trackEvent('app_opened', {
      version: Application.nativeApplicationVersion,
      buildNumber: Application.nativeBuildVersion,
    });
  } catch (error) {
    console.error('[Analytics] Initialization failed:', error);
    isInitialized = true;
    analyticsEnabled = false;
  }
}

/**
 * Get or create anonymous user ID
 */
async function getOrCreateAnonymousId(): Promise<string> {
  try {
    let id = await AsyncStorage.getItem(STORAGE_KEYS.ANONYMOUS_ID);

    if (!id) {
      // Generate a new anonymous ID
      id = `anon_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      await AsyncStorage.setItem(STORAGE_KEYS.ANONYMOUS_ID, id);
    }

    return id;
  } catch (error) {
    console.error('[Analytics] Failed to get/create anonymous ID:', error);
    return `temp_${Date.now()}`;
  }
}

// ==================== Opt-In/Out ====================

/**
 * Enable analytics tracking
 */
export async function enableAnalytics(): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEYS.ANALYTICS_ENABLED, 'true');
    analyticsEnabled = true;

    if (!isInitialized) {
      await initializeAnalytics();
    } else {
      await initializeSession();
      startBatchProcessing();
    }

    trackEvent('analytics_enabled');
    console.log('[Analytics] Analytics enabled');
  } catch (error) {
    console.error('[Analytics] Failed to enable analytics:', error);
  }
}

/**
 * Disable analytics tracking and clear data
 */
export async function disableAnalytics(): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEYS.ANALYTICS_ENABLED, 'false');
    analyticsEnabled = false;

    // Clear all data
    await clearAllData();

    // Stop batch processing
    if (batchTimer) {
      clearInterval(batchTimer);
      batchTimer = null;
    }

    console.log('[Analytics] Analytics disabled and data cleared');
  } catch (error) {
    console.error('[Analytics] Failed to disable analytics:', error);
  }
}

/**
 * Check if analytics is enabled
 */
export function isAnalyticsEnabled(): boolean {
  return analyticsEnabled;
}

/**
 * Clear all analytics data
 */
async function clearAllData(): Promise<void> {
  try {
    await Promise.all([
      AsyncStorage.removeItem(STORAGE_KEYS.ANONYMOUS_ID),
      AsyncStorage.removeItem(STORAGE_KEYS.SESSION_DATA),
      AsyncStorage.removeItem(STORAGE_KEYS.USER_PROPERTIES),
    ]);

    anonymousId = null;
    currentSession = null;
    eventQueue = [];
    userProperties = {};
  } catch (error) {
    console.error('[Analytics] Failed to clear data:', error);
  }
}

// ==================== Session Management ====================

/**
 * Initialize or resume session
 */
async function initializeSession(): Promise<void> {
  try {
    const storedSession = await AsyncStorage.getItem(STORAGE_KEYS.SESSION_DATA);
    const now = Date.now();

    if (storedSession) {
      const session: SessionData = JSON.parse(storedSession);

      // Check if session is still valid
      if (now - session.lastActivityTime < SESSION_TIMEOUT) {
        // Resume existing session
        currentSession = {
          ...session,
          lastActivityTime: now,
        };

        trackEvent('session_resumed');
      } else {
        // Session expired, start new one
        await startNewSession();
      }
    } else {
      // No existing session, start new one
      await startNewSession();
    }

    // Save updated session
    if (currentSession) {
      await AsyncStorage.setItem(STORAGE_KEYS.SESSION_DATA, JSON.stringify(currentSession));
    }
  } catch (error) {
    console.error('[Analytics] Failed to initialize session:', error);
  }
}

/**
 * Start a new session
 */
async function startNewSession(): Promise<void> {
  const now = Date.now();

  currentSession = {
    sessionId: `session_${now}_${Math.random().toString(36).substr(2, 9)}`,
    startTime: now,
    lastActivityTime: now,
    eventCount: 0,
  };

  trackEvent('session_started', {
    deviceModel: Device.modelName,
    osName: Device.osName,
    osVersion: Device.osVersion,
  });
}

/**
 * Update session activity
 */
async function updateSessionActivity(): Promise<void> {
  if (!currentSession) return;

  try {
    const now = Date.now();

    // Check if session has timed out
    if (now - currentSession.lastActivityTime >= SESSION_TIMEOUT) {
      // End old session and start new one
      trackEvent('session_ended', {
        duration: currentSession.lastActivityTime - currentSession.startTime,
        eventCount: currentSession.eventCount,
      });

      await startNewSession();
    } else {
      // Update activity time
      currentSession.lastActivityTime = now;
      currentSession.eventCount++;
    }

    await AsyncStorage.setItem(STORAGE_KEYS.SESSION_DATA, JSON.stringify(currentSession));
  } catch (error) {
    console.error('[Analytics] Failed to update session:', error);
  }
}

/**
 * End current session
 */
export async function endSession(): Promise<void> {
  if (!currentSession) return;

  try {
    trackEvent('session_ended', {
      duration: Date.now() - currentSession.startTime,
      eventCount: currentSession.eventCount,
    });

    // Flush any remaining events
    await flushEvents();

    await AsyncStorage.removeItem(STORAGE_KEYS.SESSION_DATA);
    currentSession = null;
  } catch (error) {
    console.error('[Analytics] Failed to end session:', error);
  }
}

// ==================== Event Tracking ====================

/**
 * Track a custom event
 */
export function trackEvent(eventName: string, properties?: Record<string, any>): void {
  if (!isInitialized || !analyticsEnabled) return;

  try {
    const event: AnalyticsEvent = {
      name: eventName,
      properties: {
        ...properties,
        anonymousId,
        sessionId: currentSession?.sessionId,
        timestamp: Date.now(),
        platform: Device.osName,
        appVersion: Application.nativeApplicationVersion,
        ...userProperties,
      },
      timestamp: Date.now(),
    };

    // Add to queue
    eventQueue.push(event);

    // Update session
    updateSessionActivity();

    // Log in dev mode
    if (__DEV__) {
      console.log('[Analytics] Event tracked:', eventName, properties);
    }

    // Flush if queue is full
    if (eventQueue.length >= BATCH_SIZE) {
      flushEvents();
    }
  } catch (error) {
    console.error('[Analytics] Failed to track event:', error);
  }
}

/**
 * Track screen view
 */
export function trackScreenView(screen: ScreenViewEvent): void {
  trackEvent('screen_view', {
    screenName: screen.screenName,
    previousScreen: screen.previousScreen,
    ...screen.params,
  });
}

/**
 * Track button click
 */
export function trackButtonClick(buttonName: string, context?: Record<string, any>): void {
  trackEvent('button_click', {
    buttonName,
    ...context,
  });
}

/**
 * Track feature usage
 */
export function trackFeatureUsage(featureName: string, action: string, metadata?: Record<string, any>): void {
  trackEvent('feature_used', {
    featureName,
    action,
    ...metadata,
  });
}

// ==================== User Properties ====================

/**
 * Set user properties (opt-in only)
 */
export async function setUserProperties(properties: UserProperties): Promise<void> {
  if (!isInitialized || !analyticsEnabled) return;

  try {
    userProperties = {
      ...userProperties,
      ...properties,
    };

    await AsyncStorage.setItem(STORAGE_KEYS.USER_PROPERTIES, JSON.stringify(userProperties));

    if (__DEV__) {
      console.log('[Analytics] User properties updated:', properties);
    }
  } catch (error) {
    console.error('[Analytics] Failed to set user properties:', error);
  }
}

/**
 * Clear user properties
 */
export async function clearUserProperties(): Promise<void> {
  try {
    userProperties = {};
    await AsyncStorage.removeItem(STORAGE_KEYS.USER_PROPERTIES);
  } catch (error) {
    console.error('[Analytics] Failed to clear user properties:', error);
  }
}

// ==================== Batch Processing ====================

/**
 * Start batch processing timer
 */
function startBatchProcessing(): void {
  if (batchTimer) {
    clearInterval(batchTimer);
  }

  batchTimer = setInterval(() => {
    if (eventQueue.length > 0) {
      flushEvents();
    }
  }, BATCH_INTERVAL);
}

/**
 * Flush events to analytics backend
 */
async function flushEvents(): Promise<void> {
  if (eventQueue.length === 0) return;

  try {
    const eventsToSend = [...eventQueue];
    eventQueue = [];

    // In a real implementation, send to analytics backend
    // For now, just log in dev mode
    if (__DEV__) {
      console.log('[Analytics] Flushing events:', eventsToSend.length);
    }

    // TODO: Send to analytics backend (Mixpanel, Amplitude, etc.)
    // await sendEventsToBackend(eventsToSend);
  } catch (error) {
    console.error('[Analytics] Failed to flush events:', error);
  }
}

// ==================== Feature-Specific Tracking ====================

/**
 * Track BLE connection event
 */
export function trackBLEConnection(action: 'connect' | 'disconnect' | 'error', deviceInfo?: Record<string, any>): void {
  trackFeatureUsage('ble', action, deviceInfo);
}

/**
 * Track haptic feedback event
 */
export function trackHapticFeedback(feedbackType: string, metadata?: Record<string, any>): void {
  trackFeatureUsage('haptic', feedbackType, metadata);
}

/**
 * Track audio event
 */
export function trackAudioEvent(action: 'play' | 'pause' | 'stop' | 'record', metadata?: Record<string, any>): void {
  trackFeatureUsage('audio', action, metadata);
}

/**
 * Track API call
 */
export function trackAPICall(endpoint: string, method: string, duration: number, success: boolean): void {
  trackEvent('api_call', {
    endpoint,
    method,
    duration,
    success,
  });
}

/**
 * Track error (non-crash)
 */
export function trackError(errorType: string, errorMessage: string, context?: Record<string, any>): void {
  trackEvent('error_occurred', {
    errorType,
    errorMessage,
    ...context,
  });
}

// ==================== Conversion Funnels ====================

/**
 * Track funnel step
 */
export function trackFunnelStep(funnelName: string, stepName: string, stepNumber: number, metadata?: Record<string, any>): void {
  trackEvent('funnel_step', {
    funnelName,
    stepName,
    stepNumber,
    ...metadata,
  });
}

/**
 * Track funnel completion
 */
export function trackFunnelComplete(funnelName: string, totalSteps: number, metadata?: Record<string, any>): void {
  trackEvent('funnel_complete', {
    funnelName,
    totalSteps,
    ...metadata,
  });
}

/**
 * Track funnel abandonment
 */
export function trackFunnelAbandoned(funnelName: string, lastStep: string, stepNumber: number, metadata?: Record<string, any>): void {
  trackEvent('funnel_abandoned', {
    funnelName,
    lastStep,
    stepNumber,
    ...metadata,
  });
}

// ==================== Exports ====================

export default {
  initialize: initializeAnalytics,
  enable: enableAnalytics,
  disable: disableAnalytics,
  isEnabled: isAnalyticsEnabled,
  trackEvent,
  trackScreenView,
  trackButtonClick,
  trackFeatureUsage,
  setUserProperties,
  clearUserProperties,
  endSession,
  trackBLEConnection,
  trackHapticFeedback,
  trackAudioEvent,
  trackAPICall,
  trackError,
  trackFunnelStep,
  trackFunnelComplete,
  trackFunnelAbandoned,
};
