import { useEffect, useMemo, useRef } from 'react';
import { Animated, Dimensions, PanResponder, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AlertCircle, Check, Info, X } from 'lucide-react-native';
import { Text } from './Text';
import { useReducedMotion } from './useReducedMotion';
import { useToastStore, type Toast } from '../lib/toast';
import { colors, elevation, radius, spacing } from '../lib/tokens';

export function ToastHost() {
  const toasts = useToastStore((s) => s.toasts);
  const insets = useSafeAreaInsets();

  if (toasts.length === 0) return null;

  return (
    <View
      pointerEvents="box-none"
      style={{
        position: 'absolute',
        // Clears the screen header band and the wordmark beneath it, so a toast
        // never lands on a
        // card heading the way it did on Profile's "Apple Contacts".
        top: insets.top + 78,
        left: spacing.lg,
        right: spacing.lg,
        gap: spacing.sm,
        zIndex: 1000,
      }}
    >
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} />
      ))}
    </View>
  );
}

const SWIPE_THRESHOLD = 64;

function ToastItem({ toast }: { toast: Toast }) {
  const dismiss = useToastStore((s) => s.dismiss);
  const reduceMotion = useReducedMotion();
  const translateY = useRef(new Animated.Value(reduceMotion ? 0 : -16)).current;
  const translateX = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.spring(translateY, { toValue: 0, useNativeDriver: true, friction: 8 }),
      Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true }),
    ]).start();
  }, [opacity, translateY]);

  // Swipe horizontally to dismiss. Past the threshold the toast slides off the
  // edge it was thrown toward; short of it, it springs back into place.
  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_e, g) =>
          Math.abs(g.dx) > 8 && Math.abs(g.dx) > Math.abs(g.dy),
        onPanResponderMove: (_e, g) => {
          translateX.setValue(g.dx);
          opacity.setValue(Math.max(0.2, 1 - Math.abs(g.dx) / (SWIPE_THRESHOLD * 3)));
        },
        onPanResponderRelease: (_e, g) => {
          if (Math.abs(g.dx) > SWIPE_THRESHOLD) {
            const width = Dimensions.get('window').width;
            const toValue = g.dx > 0 ? width : -width;
            Animated.parallel([
              Animated.timing(translateX, { toValue, duration: 160, useNativeDriver: true }),
              Animated.timing(opacity, { toValue: 0, duration: 160, useNativeDriver: true }),
            ]).start(() => dismiss(toast.id));
          } else {
            Animated.parallel([
              Animated.spring(translateX, { toValue: 0, useNativeDriver: true, friction: 7 }),
              Animated.spring(opacity, { toValue: 1, useNativeDriver: true, friction: 7 }),
            ]).start();
          }
        },
      }),
    [dismiss, opacity, toast.id, translateX],
  );

  const Icon = toast.kind === 'success' ? Check : toast.kind === 'error' ? AlertCircle : Info;
  const iconColor =
    toast.kind === 'success'
      ? colors.success
      : toast.kind === 'error'
        ? colors.errorText
        : colors.primary;

  return (
    <Animated.View
      accessibilityRole="alert"
      {...panResponder.panHandlers}
      style={{
        transform: [{ translateY }, { translateX }],
        opacity,
        backgroundColor: colors.canvas,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: colors.hairline,
        paddingHorizontal: spacing.base,
        paddingVertical: spacing.md,
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: spacing.md,
        ...elevation.md,
      }}
    >
      <View style={{ marginTop: 2 }}>
        <Icon color={iconColor} size={18} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="titleSm">{toast.title}</Text>
        {toast.description ? (
          <Text variant="bodySm" color="muted">
            {toast.description}
          </Text>
        ) : null}
      </View>
      <Pressable
        onPress={() => dismiss(toast.id)}
        accessibilityRole="button"
        accessibilityLabel="Dismiss notification"
        hitSlop={8}
      >
        <X color={colors.muted} size={16} />
      </Pressable>
    </Animated.View>
  );
}
