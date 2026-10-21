import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Platform,
  useWindowDimensions,
  PanResponder,
  GestureResponderEvent,
  PanResponderGestureState,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  runOnJS,
  Easing,
} from 'react-native-reanimated';
import { colors } from '../../constants/colors';
import { spacing } from '../../constants/spacing';
import { typography } from '../../constants/typography';

// Window dimensions are obtained via useWindowDimensions() hook inside the component

export interface NotificationBannerData {
  title: string;
  body: string;
  icon?: string;
  type?: 'success' | 'error' | 'warning' | 'info';
  data?: any;
}

interface InAppNotificationBannerProps {
  notification: NotificationBannerData | null;
  onPress?: (data: any) => void;
  onDismiss?: () => void;
  duration?: number;
}

/**
 * In-App Notification Banner
 *
 * Animated banner that slides down from top with:
 * - Auto-dismiss after configurable duration (default 5 seconds)
 * - Tap to handle action
 * - Swipe up to dismiss
 * - Smooth spring animations powered by react-native-reanimated
 */
export default function InAppNotificationBanner({
  notification,
  onPress,
  onDismiss,
  duration = 5000,
}: InAppNotificationBannerProps) {
  const insets = useSafeAreaInsets();
  useWindowDimensions(); // Subscribe to dimension changes for responsive layout
  const [visible, setVisible] = useState(false);
  const dismissTimer = useRef<NodeJS.Timeout | null>(null);

  // Reanimated shared values
  const translateY = useSharedValue(-200);
  const opacity = useSharedValue(0);

  // Gesture responder for swipe dismiss
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (e, { dy }) => Math.abs(dy) > 5,
      onPanResponderMove: (e, { dy }) => {
        if (dy < 0) {
          translateY.value = dy;
          opacity.value = 1 + dy / 200; // Fade out as swipe up
        }
      },
      onPanResponderRelease: (e, { dy, vy }) => {
        // If swiped up significantly or velocity is high, dismiss
        if (dy < -50 || vy < -0.5) {
          dismissBanner();
        } else {
          // Spring back
          translateY.value = withSpring(0, {
            damping: 10,
            mass: 1,
            overshootClamping: false,
          });
          opacity.value = withSpring(1, {
            damping: 10,
            mass: 1,
            overshootClamping: false,
          });
        }
      },
    })
  ).current;

  useEffect(() => {
    if (!notification) return;
    showBanner();
  }, [notification]);

  useEffect(() => {
    return () => {
      if (dismissTimer.current) {
        clearTimeout(dismissTimer.current);
      }
    };
  }, []);

  const showBanner = () => {
    setVisible(true);

    // Clear any existing timer
    if (dismissTimer.current) {
      clearTimeout(dismissTimer.current);
    }

    // Animate in with spring
    translateY.value = withSpring(0, {
      damping: 10,
      mass: 1,
      overshootClamping: false,
    });

    opacity.value = withSpring(1, {
      damping: 10,
      mass: 1,
      overshootClamping: false,
    });

    // Auto dismiss after duration
    dismissTimer.current = setTimeout(() => {
      dismissBanner();
    }, duration);
  };

  const dismissBanner = useCallback(() => {
    if (dismissTimer.current) {
      clearTimeout(dismissTimer.current);
    }

    // Animate out
    translateY.value = withTiming(-200, {
      duration: 300,
      easing: Easing.out(Easing.ease),
    });

    opacity.value = withTiming(0, {
      duration: 300,
      easing: Easing.out(Easing.ease),
    }, () => {
      runOnJS(setVisible)(false);
      if (onDismiss) {
        runOnJS(onDismiss)();
      }
    });
  }, [onDismiss]);

  const handlePress = () => {
    if (onPress && notification) {
      onPress(notification.data);
    }
    dismissBanner();
  };

  const getTypeConfig = () => {
    switch (notification?.type || 'info') {
      case 'success':
        return {
          backgroundColor: colors.success.main,
          icon: '[checkmark.circle]',
        };
      case 'error':
        return {
          backgroundColor: colors.danger.main,
          icon: '[xmark.circle]',
        };
      case 'warning':
        return {
          backgroundColor: colors.warning.main,
          icon: '[exclamationmark.triangle]',
        };
      case 'info':
      default:
        return {
          backgroundColor: colors.info.main,
          icon: '[info.circle]',
        };
    }
  };

  // Animated styles using Reanimated
  const animatedContainerStyle = useAnimatedStyle(() => {
    return {
      transform: [{ translateY: translateY.value }],
      opacity: opacity.value,
    };
  });

  if (!visible || !notification) {
    return null;
  }

  const typeConfig = getTypeConfig();
  const displayIcon = notification.icon || typeConfig.icon;

  return (
    <Animated.View
      style={[
        styles.container,
        {
          top: insets.top,
        },
        animatedContainerStyle,
      ]}
      {...panResponder.panHandlers}
    >
      <TouchableOpacity
        activeOpacity={0.9}
        onPress={handlePress}
        style={styles.touchable}
      >
        <View
          style={[
            styles.banner,
            {
              backgroundColor: typeConfig.backgroundColor,
            },
          ]}
        >
          {/* Icon */}
          <Text style={styles.icon}>{displayIcon}</Text>

          {/* Content */}
          <View style={styles.content}>
            <Text style={styles.title} numberOfLines={1}>
              {notification.title}
            </Text>
            <Text style={styles.body} numberOfLines={2}>
              {notification.body}
            </Text>
          </View>

          {/* Dismiss button */}
          <TouchableOpacity
            onPress={(e) => {
              e.stopPropagation();
              dismissBanner();
            }}
            style={styles.dismissButton}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            accessible={true}
            accessibilityLabel="Dismiss notification"
            accessibilityRole="button"
          >
            <Text style={styles.dismissText}>[xmark]</Text>
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
}

/**
 * Hook for managing in-app notification banner state and actions
 *
 * @example
 * const { notification, show, hide } = useNotificationBanner();
 *
 * show({
 *   title: 'Success',
 *   body: 'Action completed',
 *   type: 'success',
 * });
 */
export function useNotificationBanner() {
  const [notification, setNotification] = useState<NotificationBannerData | null>(
    null
  );

  const show = useCallback((bannerData: NotificationBannerData) => {
    setNotification(bannerData);
  }, []);

  const hide = useCallback(() => {
    setNotification(null);
  }, []);

  return {
    notification,
    show,
    hide,
  };
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 9999,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
  touchable: {
    width: '100%',
  },
  banner: {
    borderRadius: spacing.radius.lg,
    padding: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
  },
  icon: {
    fontSize: spacing.iconSize.xl,
    color: colors.neutral.white,
    marginRight: spacing.md,
    fontWeight: '600',
  },
  content: {
    flex: 1,
    marginRight: spacing.md,
  },
  title: {
    ...typography.subtitle2,
    color: colors.neutral.white,
    marginBottom: spacing.xs,
    fontWeight: '600',
  },
  body: {
    ...typography.body2,
    color: colors.neutral.white,
    lineHeight: 18,
  },
  dismissButton: {
    width: spacing.iconSize.md,
    height: spacing.iconSize.md,
    borderRadius: spacing.radius.full,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dismissText: {
    fontSize: 14,
    color: colors.neutral.white,
    fontWeight: '600',
  },
});
