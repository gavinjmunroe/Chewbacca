import { useEffect, useRef } from 'react';
import { PerformanceMonitoring } from '../../services/PerformanceMonitoring';

/**
 * Hook to track screen load performance
 *
 * Usage:
 * function MyScreen() {
 *   usePerformanceTracking('MyScreen');
 *   // ... rest of component
 * }
 */
export function usePerformanceTracking(screenName: string): void {
  const hasTracked = useRef(false);

  useEffect(() => {
    if (!hasTracked.current) {
      PerformanceMonitoring.startScreenLoad(screenName);
      hasTracked.current = true;

      // Mark as loaded after initial render
      const timer = setTimeout(() => {
        PerformanceMonitoring.endScreenLoad(screenName);
      }, 0);

      return () => clearTimeout(timer);
    }
  }, [screenName]);
}

/**
 * Hook to track API call performance
 *
 * Usage:
 * const trackAPICall = useAPICallTracking();
 *
 * const fetchData = async () => {
 *   const callId = trackAPICall.start('/api/sessions');
 *   try {
 *     const data = await api.getSessions();
 *     trackAPICall.end(callId, true);
 *     return data;
 *   } catch (error) {
 *     trackAPICall.end(callId, false);
 *     throw error;
 *   }
 * };
 */
export function useAPICallTracking() {
  const callIdCounter = useRef(0);

  return {
    start: (endpoint: string): string => {
      const callId = `${endpoint}-${Date.now()}-${callIdCounter.current++}`;
      PerformanceMonitoring.startAPICall(callId);
      return callId;
    },
    end: (callId: string, success: boolean, endpoint?: string): void => {
      // Extract endpoint from callId if not provided
      const endpointFromId = callId.split('-')[0];
      PerformanceMonitoring.endAPICall(callId, endpoint || endpointFromId, success);
    },
  };
}
