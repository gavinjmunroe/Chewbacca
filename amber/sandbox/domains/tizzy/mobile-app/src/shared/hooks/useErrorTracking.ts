/**
 * useErrorTracking Hook
 *
 * Provides easy access to error tracking functionality in React components
 */

import { useCallback, useEffect } from 'react';
import * as ErrorTracking from '../../services/ErrorTracking';

export interface UseErrorTrackingOptions {
  /**
   * Component name for context
   */
  componentName?: string;

  /**
   * Additional context to include with errors
   */
  context?: Record<string, any>;
}

export interface UseErrorTrackingReturn {
  /**
   * Capture an exception
   */
  captureException: (error: Error, additionalContext?: Record<string, any>) => void;

  /**
   * Capture a message
   */
  captureMessage: (message: string, level?: 'debug' | 'info' | 'warning' | 'error' | 'fatal') => void;

  /**
   * Add a breadcrumb
   */
  addBreadcrumb: (message: string, data?: Record<string, any>) => void;

  /**
   * Track BLE error
   */
  trackBLEError: (error: Error, deviceInfo?: Record<string, any>) => void;

  /**
   * Track audio error
   */
  trackAudioError: (error: Error, audioInfo?: Record<string, any>) => void;

  /**
   * Track API error
   */
  trackAPIError: (error: Error, endpoint: string, method: string, statusCode?: number) => void;
}

/**
 * Hook for error tracking in React components
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const { captureException, addBreadcrumb } = useErrorTracking({
 *     componentName: 'MyComponent',
 *   });
 *
 *   const handleAction = async () => {
 *     try {
 *       addBreadcrumb('Starting action');
 *       await performAction();
 *     } catch (error) {
 *       captureException(error as Error, { actionType: 'perform' });
 *     }
 *   };
 *
 *   return <Button onPress={handleAction}>Do Action</Button>;
 * }
 * ```
 */
export function useErrorTracking(options?: UseErrorTrackingOptions): UseErrorTrackingReturn {
  const { componentName, context: baseContext } = options || {};

  // Add component context on mount
  useEffect(() => {
    if (componentName) {
      ErrorTracking.addBreadcrumb({
        message: `${componentName} mounted`,
        category: 'lifecycle',
        level: 'info',
      });

      return () => {
        ErrorTracking.addBreadcrumb({
          message: `${componentName} unmounted`,
          category: 'lifecycle',
          level: 'info',
        });
      };
    }
  }, [componentName]);

  const captureException = useCallback(
    (error: Error, additionalContext?: Record<string, any>) => {
      const fullContext = {
        component: componentName,
        ...baseContext,
        ...additionalContext,
      };

      ErrorTracking.captureException(error, fullContext);
    },
    [componentName, baseContext]
  );

  const captureMessage = useCallback(
    (message: string, level: 'debug' | 'info' | 'warning' | 'error' | 'fatal' = 'info') => {
      const fullContext = {
        component: componentName,
        ...baseContext,
      };

      ErrorTracking.captureMessage(message, level, fullContext);
    },
    [componentName, baseContext]
  );

  const addBreadcrumb = useCallback(
    (message: string, data?: Record<string, any>) => {
      ErrorTracking.addBreadcrumb({
        message,
        category: componentName || 'component',
        data: {
          ...baseContext,
          ...data,
        },
      });
    },
    [componentName, baseContext]
  );

  const trackBLEError = useCallback(
    (error: Error, deviceInfo?: Record<string, any>) => {
      ErrorTracking.trackBLEError(error, {
        component: componentName,
        ...baseContext,
        ...deviceInfo,
      });
    },
    [componentName, baseContext]
  );

  const trackAudioError = useCallback(
    (error: Error, audioInfo?: Record<string, any>) => {
      ErrorTracking.trackAudioError(error, {
        component: componentName,
        ...baseContext,
        ...audioInfo,
      });
    },
    [componentName, baseContext]
  );

  const trackAPIError = useCallback(
    (error: Error, endpoint: string, method: string, statusCode?: number) => {
      ErrorTracking.trackAPIError(error, endpoint, method, statusCode);
    },
    []
  );

  return {
    captureException,
    captureMessage,
    addBreadcrumb,
    trackBLEError,
    trackAudioError,
    trackAPIError,
  };
}

/**
 * Hook for tracking async operations with automatic error handling
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const trackAsync = useAsyncErrorTracking('MyComponent');
 *
 *   const fetchData = async () => {
 *     await trackAsync('fetchData', async () => {
 *       const data = await api.getData();
 *       return data;
 *     });
 *   };
 * }
 * ```
 */
export function useAsyncErrorTracking(componentName?: string) {
  return useCallback(
    async <T,>(
      operationName: string,
      operation: () => Promise<T>,
      onError?: (error: Error) => void
    ): Promise<T> => {
      ErrorTracking.addBreadcrumb({
        message: `Starting ${operationName}`,
        category: componentName || 'async',
        level: 'info',
      });

      try {
        const result = await operation();

        ErrorTracking.addBreadcrumb({
          message: `Completed ${operationName}`,
          category: componentName || 'async',
          level: 'info',
        });

        return result;
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));

        ErrorTracking.captureException(err, {
          component: componentName,
          operation: operationName,
        });

        if (onError) {
          onError(err);
        }

        throw error;
      }
    },
    [componentName]
  );
}
