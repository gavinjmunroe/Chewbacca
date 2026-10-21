/**
 * useAnalytics Hook
 *
 * Provides easy access to analytics functionality in React components
 */

import { useEffect, useCallback, useRef } from 'react';
import * as Analytics from '../../services/Analytics';

export interface UseAnalyticsOptions {
  /**
   * Screen name for automatic screen view tracking
   */
  screenName?: string;

  /**
   * Track screen view on mount
   */
  trackOnMount?: boolean;

  /**
   * Additional properties to include with screen view
   */
  screenProperties?: Record<string, any>;
}

export interface UseAnalyticsReturn {
  /**
   * Track a custom event
   */
  trackEvent: (eventName: string, properties?: Record<string, any>) => void;

  /**
   * Track a button click
   */
  trackButtonClick: (buttonName: string, context?: Record<string, any>) => void;

  /**
   * Track feature usage
   */
  trackFeatureUsage: (featureName: string, action: string, metadata?: Record<string, any>) => void;

  /**
   * Track screen view manually
   */
  trackScreenView: (screenName: string, params?: Record<string, any>) => void;

  /**
   * Track funnel step
   */
  trackFunnelStep: (funnelName: string, stepName: string, stepNumber: number, metadata?: Record<string, any>) => void;

  /**
   * Check if analytics is enabled
   */
  isEnabled: () => boolean;
}

/**
 * Hook for analytics tracking in React components
 *
 * @example
 * ```tsx
 * function MyScreen() {
 *   const { trackEvent, trackButtonClick } = useAnalytics({
 *     screenName: 'MyScreen',
 *     trackOnMount: true,
 *   });
 *
 *   const handlePress = () => {
 *     trackButtonClick('submit_button', { formType: 'contact' });
 *   };
 *
 *   return <Button onPress={handlePress}>Submit</Button>;
 * }
 * ```
 */
export function useAnalytics(options?: UseAnalyticsOptions): UseAnalyticsReturn {
  const { screenName, trackOnMount = true, screenProperties } = options || {};
  const previousScreenRef = useRef<string | null>(null);
  const mountedRef = useRef(false);

  // Track screen view on mount
  useEffect(() => {
    if (!trackOnMount || !screenName || mountedRef.current) return;

    Analytics.trackScreenView({
      screenName,
      previousScreen: previousScreenRef.current || undefined,
      params: screenProperties,
    });

    previousScreenRef.current = screenName;
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
    };
  }, [screenName, trackOnMount, screenProperties]);

  // Memoized tracking functions
  const trackEvent = useCallback((eventName: string, properties?: Record<string, any>) => {
    Analytics.trackEvent(eventName, properties);
  }, []);

  const trackButtonClick = useCallback((buttonName: string, context?: Record<string, any>) => {
    Analytics.trackButtonClick(buttonName, {
      ...context,
      screen: screenName,
    });
  }, [screenName]);

  const trackFeatureUsage = useCallback(
    (featureName: string, action: string, metadata?: Record<string, any>) => {
      Analytics.trackFeatureUsage(featureName, action, {
        ...metadata,
        screen: screenName,
      });
    },
    [screenName]
  );

  const trackScreenViewManual = useCallback((screen: string, params?: Record<string, any>) => {
    Analytics.trackScreenView({
      screenName: screen,
      previousScreen: previousScreenRef.current || undefined,
      params,
    });
    previousScreenRef.current = screen;
  }, []);

  const trackFunnelStep = useCallback(
    (funnelName: string, stepName: string, stepNumber: number, metadata?: Record<string, any>) => {
      Analytics.trackFunnelStep(funnelName, stepName, stepNumber, {
        ...metadata,
        screen: screenName,
      });
    },
    [screenName]
  );

  const isEnabled = useCallback(() => {
    return Analytics.isAnalyticsEnabled();
  }, []);

  return {
    trackEvent,
    trackButtonClick,
    trackFeatureUsage,
    trackScreenView: trackScreenViewManual,
    trackFunnelStep,
    isEnabled,
  };
}

/**
 * Hook for tracking component lifecycle events
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   useAnalyticsLifecycle('MyComponent', {
 *     onMount: { action: 'loaded' },
 *     onUnmount: { action: 'unloaded' },
 *   });
 *
 *   return <View>...</View>;
 * }
 * ```
 */
export function useAnalyticsLifecycle(
  componentName: string,
  options?: {
    onMount?: { action: string; metadata?: Record<string, any> };
    onUnmount?: { action: string; metadata?: Record<string, any> };
  }
): void {
  const { onMount, onUnmount } = options || {};

  useEffect(() => {
    if (onMount) {
      Analytics.trackEvent(`${componentName}_${onMount.action}`, onMount.metadata);
    }

    return () => {
      if (onUnmount) {
        Analytics.trackEvent(`${componentName}_${onUnmount.action}`, onUnmount.metadata);
      }
    };
  }, [componentName, onMount, onUnmount]);
}

/**
 * Hook for tracking async operations
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const trackAsync = useAsyncAnalytics();
 *
 *   const fetchData = async () => {
 *     await trackAsync('fetch_data', async () => {
 *       const data = await api.getData();
 *       return data;
 *     });
 *   };
 * }
 * ```
 */
export function useAsyncAnalytics() {
  return useCallback(
    async <T,>(
      eventName: string,
      operation: () => Promise<T>,
      metadata?: Record<string, any>
    ): Promise<T> => {
      const startTime = Date.now();

      try {
        const result = await operation();
        const duration = Date.now() - startTime;

        Analytics.trackEvent(`${eventName}_success`, {
          ...metadata,
          duration,
        });

        return result;
      } catch (error) {
        const duration = Date.now() - startTime;

        Analytics.trackEvent(`${eventName}_error`, {
          ...metadata,
          duration,
          error: error instanceof Error ? error.message : 'Unknown error',
        });

        throw error;
      }
    },
    []
  );
}
