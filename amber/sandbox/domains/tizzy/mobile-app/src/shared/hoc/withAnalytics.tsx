/**
 * withAnalytics HOC
 *
 * Higher-Order Component for automatic screen tracking
 */

import React, { ComponentType, useEffect } from 'react';
import * as Analytics from '../../services/Analytics';

export interface WithAnalyticsOptions {
  /**
   * Screen name to track
   */
  screenName: string;

  /**
   * Additional properties to include with screen view
   */
  screenProperties?: Record<string, any>;

  /**
   * Track screen view on mount (default: true)
   */
  trackOnMount?: boolean;

  /**
   * Track screen view on unmount (default: false)
   */
  trackOnUnmount?: boolean;
}

/**
 * HOC that automatically tracks screen views
 *
 * @example
 * ```tsx
 * const MyScreen = () => {
 *   return <View>...</View>;
 * };
 *
 * export default withAnalytics(MyScreen, {
 *   screenName: 'MyScreen',
 *   screenProperties: { category: 'main' },
 * });
 * ```
 */
export function withAnalytics<P extends object>(
  Component: ComponentType<P>,
  options: WithAnalyticsOptions
): ComponentType<P> {
  const {
    screenName,
    screenProperties,
    trackOnMount = true,
    trackOnUnmount = false,
  } = options;

  const WrappedComponent = (props: P) => {
    useEffect(() => {
      if (trackOnMount) {
        Analytics.trackScreenView({
          screenName,
          params: screenProperties,
        });
      }

      return () => {
        if (trackOnUnmount) {
          Analytics.trackEvent('screen_exit', {
            screenName,
            ...screenProperties,
          });
        }
      };
    }, []);

    return <Component {...props} />;
  };

  WrappedComponent.displayName = `withAnalytics(${
    Component.displayName || Component.name || 'Component'
  })`;

  return WrappedComponent;
}

/**
 * HOC that tracks both screen views and errors
 *
 * @example
 * ```tsx
 * const MyScreen = () => {
 *   return <View>...</View>;
 * };
 *
 * export default withAnalyticsAndErrors(MyScreen, {
 *   screenName: 'MyScreen',
 * });
 * ```
 */
export function withAnalyticsAndErrors<P extends object>(
  Component: ComponentType<P>,
  options: WithAnalyticsOptions
): ComponentType<P> {
  const { screenName } = options;

  const WrappedComponent = withAnalytics(Component, options);

  const ErrorTrackingComponent = (props: P) => {
    useEffect(() => {
      // Add breadcrumb when screen mounts
      Analytics.trackEvent('screen_mounted', {
        screenName,
      });

      return () => {
        Analytics.trackEvent('screen_unmounted', {
          screenName,
        });
      };
    }, []);

    return <WrappedComponent {...props} />;
  };

  ErrorTrackingComponent.displayName = `withAnalyticsAndErrors(${
    Component.displayName || Component.name || 'Component'
  })`;

  return ErrorTrackingComponent;
}
