/**
 * Analytics Helper Utilities
 *
 * Common patterns and utilities for analytics tracking
 */

import * as Analytics from '../../services/Analytics';
import * as ErrorTracking from '../../services/ErrorTracking';

// ==================== Timing Utilities ====================

/**
 * Create a timer for tracking operation duration
 */
export function createTimer() {
  const startTime = Date.now();

  return {
    /**
     * Get elapsed time in milliseconds
     */
    elapsed: () => Date.now() - startTime,

    /**
     * Stop timer and return duration
     */
    stop: () => {
      const duration = Date.now() - startTime;
      return duration;
    },
  };
}

/**
 * Track the duration of a function execution
 */
export async function trackTiming<T>(
  eventName: string,
  operation: () => Promise<T>,
  metadata?: Record<string, any>
): Promise<T> {
  const timer = createTimer();

  try {
    const result = await operation();
    const duration = timer.stop();

    Analytics.trackEvent(`${eventName}_completed`, {
      duration,
      success: true,
      ...metadata,
    });

    return result;
  } catch (error) {
    const duration = timer.stop();

    Analytics.trackEvent(`${eventName}_failed`, {
      duration,
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      ...metadata,
    });

    throw error;
  }
}

// ==================== Page View Tracking ====================

interface PageViewTracker {
  startTime: number;
  screenName: string;
}

const pageViewTrackers = new Map<string, PageViewTracker>();

/**
 * Start tracking page view duration
 */
export function startPageView(screenName: string): void {
  pageViewTrackers.set(screenName, {
    startTime: Date.now(),
    screenName,
  });

  Analytics.trackScreenView({
    screenName,
  });
}

/**
 * End page view tracking and log duration
 */
export function endPageView(screenName: string): void {
  const tracker = pageViewTrackers.get(screenName);

  if (tracker) {
    const duration = Date.now() - tracker.startTime;

    Analytics.trackEvent('page_view_duration', {
      screenName,
      duration,
    });

    pageViewTrackers.delete(screenName);
  }
}

// ==================== Feature Flag Tracking ====================

/**
 * Track feature flag impression
 */
export function trackFeatureFlag(
  flagName: string,
  isEnabled: boolean,
  context?: Record<string, any>
): void {
  Analytics.trackEvent('feature_flag_impression', {
    flagName,
    isEnabled,
    ...context,
  });
}

// ==================== User Action Tracking ====================

/**
 * Track form submission
 */
export function trackFormSubmit(
  formName: string,
  success: boolean,
  validationErrors?: string[]
): void {
  Analytics.trackEvent('form_submit', {
    formName,
    success,
    hasErrors: validationErrors && validationErrors.length > 0,
    errorCount: validationErrors?.length || 0,
  });
}

/**
 * Track search query
 */
export function trackSearch(
  query: string,
  resultCount: number,
  context?: Record<string, any>
): void {
  Analytics.trackEvent('search_performed', {
    query: query.toLowerCase(),
    resultCount,
    hasResults: resultCount > 0,
    ...context,
  });
}

/**
 * Track navigation action
 */
export function trackNavigation(
  from: string,
  to: string,
  method: 'tap' | 'swipe' | 'back' | 'deeplink' = 'tap'
): void {
  Analytics.trackEvent('navigation', {
    from,
    to,
    method,
  });
}

// ==================== E-commerce / Conversion Tracking ====================

/**
 * Track purchase or conversion
 */
export function trackPurchase(
  itemId: string,
  itemName: string,
  price: number,
  currency: string = 'USD',
  metadata?: Record<string, any>
): void {
  Analytics.trackEvent('purchase', {
    itemId,
    itemName,
    price,
    currency,
    ...metadata,
  });
}

/**
 * Track subscription event
 */
export function trackSubscription(
  action: 'start' | 'cancel' | 'renew' | 'upgrade' | 'downgrade',
  planName: string,
  price: number,
  metadata?: Record<string, any>
): void {
  Analytics.trackEvent('subscription_event', {
    action,
    planName,
    price,
    ...metadata,
  });
}

// ==================== A/B Testing ====================

/**
 * Track A/B test variant impression
 */
export function trackABTest(
  testName: string,
  variant: string,
  context?: Record<string, any>
): void {
  Analytics.trackEvent('ab_test_impression', {
    testName,
    variant,
    ...context,
  });
}

/**
 * Track A/B test conversion
 */
export function trackABTestConversion(
  testName: string,
  variant: string,
  conversionType: string,
  metadata?: Record<string, any>
): void {
  Analytics.trackEvent('ab_test_conversion', {
    testName,
    variant,
    conversionType,
    ...metadata,
  });
}

// ==================== Error Tracking Helpers ====================

/**
 * Track retry attempt
 */
export function trackRetry(
  operation: string,
  attemptNumber: number,
  maxAttempts: number,
  metadata?: Record<string, any>
): void {
  Analytics.trackEvent('retry_attempt', {
    operation,
    attemptNumber,
    maxAttempts,
    ...metadata,
  });

  ErrorTracking.addBreadcrumb({
    message: `Retry attempt ${attemptNumber}/${maxAttempts} for ${operation}`,
    category: 'retry',
    level: 'warning',
    data: metadata,
  });
}

/**
 * Track operation timeout
 */
export function trackTimeout(
  operation: string,
  timeoutMs: number,
  metadata?: Record<string, any>
): void {
  Analytics.trackEvent('operation_timeout', {
    operation,
    timeoutMs,
    ...metadata,
  });

  ErrorTracking.addBreadcrumb({
    message: `Operation ${operation} timed out after ${timeoutMs}ms`,
    category: 'timeout',
    level: 'error',
    data: metadata,
  });
}

// ==================== Batch Event Tracking ====================

interface BatchEvent {
  name: string;
  properties?: Record<string, any>;
}

/**
 * Track multiple events in a batch
 */
export function trackEventBatch(events: BatchEvent[]): void {
  events.forEach((event) => {
    Analytics.trackEvent(event.name, event.properties);
  });
}

// ==================== Session Quality Metrics ====================

/**
 * Track session quality metric
 */
export function trackSessionQuality(
  metric: 'engagement' | 'performance' | 'stability',
  score: number,
  details?: Record<string, any>
): void {
  Analytics.trackEvent('session_quality', {
    metric,
    score,
    ...details,
  });
}

// ==================== Device Performance ====================

/**
 * Track device performance metric
 */
export function trackDevicePerformance(
  metric: 'memory' | 'cpu' | 'battery' | 'network',
  value: number,
  unit: string,
  context?: Record<string, any>
): void {
  Analytics.trackEvent('device_performance', {
    metric,
    value,
    unit,
    ...context,
  });
}

// ==================== User Engagement ====================

/**
 * Track user engagement score
 */
export function trackEngagement(
  score: number,
  factors: Record<string, number>
): void {
  Analytics.trackEvent('user_engagement', {
    score,
    factors,
  });
}

/**
 * Track feature discovery
 */
export function trackFeatureDiscovery(
  featureName: string,
  discoveryMethod: 'tutorial' | 'exploration' | 'tooltip' | 'notification' | 'search'
): void {
  Analytics.trackEvent('feature_discovered', {
    featureName,
    discoveryMethod,
  });
}

// ==================== Permission Tracking ====================

/**
 * Track permission request result
 */
export function trackPermissionRequest(
  permissionType: 'camera' | 'microphone' | 'bluetooth' | 'notifications' | 'location',
  granted: boolean,
  context?: Record<string, any>
): void {
  Analytics.trackEvent('permission_request', {
    permissionType,
    granted,
    ...context,
  });
}

// ==================== Exports ====================

export default {
  createTimer,
  trackTiming,
  startPageView,
  endPageView,
  trackFeatureFlag,
  trackFormSubmit,
  trackSearch,
  trackNavigation,
  trackPurchase,
  trackSubscription,
  trackABTest,
  trackABTestConversion,
  trackRetry,
  trackTimeout,
  trackEventBatch,
  trackSessionQuality,
  trackDevicePerformance,
  trackEngagement,
  trackFeatureDiscovery,
  trackPermissionRequest,
};
