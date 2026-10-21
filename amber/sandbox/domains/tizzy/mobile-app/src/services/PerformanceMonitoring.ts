/**
 * Performance Monitoring Service
 * Tracks app performance metrics and reports to analytics
 */

import { Platform } from 'react-native';
import * as Analytics from './Analytics';
import * as ErrorTracking from './ErrorTracking';

interface PerformanceMetrics {
  appLaunchTime?: number;
  screenLoadTime?: number;
  apiResponseTime?: number;
  componentRenderTime?: number;
}

interface ScreenMetrics {
  name: string;
  loadTime: number;
  timestamp: Date;
}

class PerformanceMonitoringService {
  private metrics: PerformanceMetrics = {};
  private screenMetrics: Map<string, ScreenMetrics> = new Map();
  private apiCallTimestamps: Map<string, number> = new Map();
  private appLaunchTimestamp: number;

  constructor() {
    this.appLaunchTimestamp = Date.now();
  }

  /**
   * Mark app launch complete
   */
  markAppLaunchComplete(): void {
    const launchTime = Date.now() - this.appLaunchTimestamp;
    this.metrics.appLaunchTime = launchTime;

    console.log(`[Performance] App launch completed in ${launchTime}ms`);

    Analytics.trackEvent('app_launch_time', {
      duration_ms: launchTime,
      platform: Platform.OS,
    });

    // Alert if launch time is slow (>3 seconds)
    if (launchTime > 3000) {
      ErrorTracking.captureMessage('Slow app launch', 'warning', {
        performance: {
          duration_ms: launchTime,
          platform: Platform.OS,
        },
      });
    }
  }

  /**
   * Mark screen load start
   */
  startScreenLoad(screenName: string): void {
    this.screenMetrics.set(screenName, {
      name: screenName,
      loadTime: Date.now(),
      timestamp: new Date(),
    });
  }

  /**
   * Mark screen load complete
   */
  endScreenLoad(screenName: string): void {
    const startMetrics = this.screenMetrics.get(screenName);
    if (!startMetrics) {
      console.warn(`[Performance] No start metrics found for screen: ${screenName}`);
      return;
    }

    const loadTime = Date.now() - startMetrics.loadTime;

    console.log(`[Performance] Screen "${screenName}" loaded in ${loadTime}ms`);

    Analytics.trackEvent('screen_load_time', {
      screen_name: screenName,
      duration_ms: loadTime,
      platform: Platform.OS,
    });

    // Alert if screen load is slow (>2 seconds)
    if (loadTime > 2000) {
      ErrorTracking.captureMessage('Slow screen load', 'warning', {
        performance: {
          screen_name: screenName,
          duration_ms: loadTime,
          platform: Platform.OS,
        },
      });
    }

    this.screenMetrics.delete(screenName);
  }

  /**
   * Start API call timing
   */
  startAPICall(callId: string): void {
    this.apiCallTimestamps.set(callId, Date.now());
  }

  /**
   * End API call timing
   */
  endAPICall(callId: string, endpoint: string, success: boolean): void {
    const startTime = this.apiCallTimestamps.get(callId);
    if (!startTime) {
      return;
    }

    const duration = Date.now() - startTime;

    console.log(`[Performance] API call to ${endpoint} completed in ${duration}ms`);

    Analytics.trackEvent('api_call_time', {
      endpoint,
      duration_ms: duration,
      success,
      platform: Platform.OS,
    });

    // Alert if API call is very slow (>5 seconds)
    if (duration > 5000) {
      ErrorTracking.captureMessage('Slow API call', 'warning', {
        performance: {
          endpoint,
          duration_ms: duration,
          success,
          platform: Platform.OS,
        },
      });
    }

    this.apiCallTimestamps.delete(callId);
  }

  /**
   * Track component render performance
   */
  trackComponentRender(
    componentName: string,
    phase: 'mount' | 'update',
    actualDuration: number,
    baseDuration: number
  ): void {
    // Only log if render took longer than 16ms (one frame at 60fps)
    if (actualDuration > 16) {
      console.warn(
        `[Performance] Slow ${phase} of ${componentName}: ${actualDuration.toFixed(2)}ms`
      );

      // Report significant performance issues
      if (actualDuration > 100) {
        ErrorTracking.captureMessage('Slow component render', 'warning', {
          performance: {
            component: componentName,
            phase,
            actual_duration_ms: actualDuration,
            base_duration_ms: baseDuration,
          },
        });
      }
    }

    Analytics.trackEvent('component_render_time', {
      component: componentName,
      phase,
      actual_duration_ms: actualDuration,
      base_duration_ms: baseDuration,
    });
  }

  /**
   * Track list scroll performance
   */
  trackListScroll(
    listName: string,
    itemCount: number,
    fps: number,
    isSmooth: boolean
  ): void {
    if (!isSmooth || fps < 50) {
      console.warn(`[Performance] Janky scroll in ${listName}: ${fps} fps`);

      ErrorTracking.captureMessage('Janky list scroll', 'warning', {
        performance: {
          list_name: listName,
          item_count: itemCount,
          fps,
        },
      });
    }

    Analytics.trackEvent('list_scroll_performance', {
      list_name: listName,
      item_count: itemCount,
      fps,
      is_smooth: isSmooth,
    });
  }

  /**
   * Track memory usage
   */
  trackMemoryUsage(screenName: string, usageMB: number): void {
    console.log(`[Performance] Memory usage on ${screenName}: ${usageMB}MB`);

    // Alert if memory usage is high (>200MB)
    if (usageMB > 200) {
      ErrorTracking.captureMessage('High memory usage', 'warning', {
        performance: {
          screen_name: screenName,
          usage_mb: usageMB,
          platform: Platform.OS,
        },
      });
    }

    Analytics.trackEvent('memory_usage', {
      screen_name: screenName,
      usage_mb: usageMB,
      platform: Platform.OS,
    });
  }

  /**
   * Get current metrics
   */
  getMetrics(): PerformanceMetrics {
    return { ...this.metrics };
  }

  /**
   * Clear all metrics
   */
  clearMetrics(): void {
    this.metrics = {};
    this.screenMetrics.clear();
    this.apiCallTimestamps.clear();
  }
}

// Singleton instance
let performanceMonitoringInstance: PerformanceMonitoringService | null = null;

export function getPerformanceMonitoring(): PerformanceMonitoringService {
  if (!performanceMonitoringInstance) {
    performanceMonitoringInstance = new PerformanceMonitoringService();
  }
  return performanceMonitoringInstance;
}

export const PerformanceMonitoring = {
  markAppLaunchComplete: () => getPerformanceMonitoring().markAppLaunchComplete(),
  startScreenLoad: (screenName: string) => getPerformanceMonitoring().startScreenLoad(screenName),
  endScreenLoad: (screenName: string) => getPerformanceMonitoring().endScreenLoad(screenName),
  startAPICall: (callId: string) => getPerformanceMonitoring().startAPICall(callId),
  endAPICall: (callId: string, endpoint: string, success: boolean) =>
    getPerformanceMonitoring().endAPICall(callId, endpoint, success),
  trackComponentRender: (
    componentName: string,
    phase: 'mount' | 'update',
    actualDuration: number,
    baseDuration: number
  ) => getPerformanceMonitoring().trackComponentRender(componentName, phase, actualDuration, baseDuration),
  trackListScroll: (listName: string, itemCount: number, fps: number, isSmooth: boolean) =>
    getPerformanceMonitoring().trackListScroll(listName, itemCount, fps, isSmooth),
  trackMemoryUsage: (screenName: string, usageMB: number) =>
    getPerformanceMonitoring().trackMemoryUsage(screenName, usageMB),
  getMetrics: () => getPerformanceMonitoring().getMetrics(),
  clearMetrics: () => getPerformanceMonitoring().clearMetrics(),
};
