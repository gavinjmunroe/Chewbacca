import { useEffect, useRef } from 'react';
import { Animated, View, type ViewStyle } from 'react-native';
import { colors, radius, spacing } from '../lib/tokens';
import { useReducedMotion } from './useReducedMotion';

// Base shimmer block. Pulses opacity on the native driver; under Reduce Motion
// it holds a static dim so the loading shape is still legible without movement.
export function Skeleton({
  height = 16,
  width = '100%',
  radius: r = radius.sm,
  style,
}: {
  height?: number;
  width?: number | `${number}%`;
  radius?: number;
  style?: ViewStyle;
}) {
  const reduceMotion = useReducedMotion();
  const opacity = useRef(new Animated.Value(0.5)).current;

  useEffect(() => {
    if (reduceMotion) {
      opacity.setValue(0.7);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.5, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity, reduceMotion]);

  return (
    <Animated.View
      accessibilityRole="progressbar"
      accessibilityLabel="Loading"
      style={[
        { backgroundColor: colors.surfaceStrong, height, width, borderRadius: r, opacity },
        style,
      ]}
    />
  );
}

// A single line of placeholder text. The last line of a paragraph reads shorter.
export function SkeletonText({
  lines = 1,
  lastLineWidth = '60%',
}: {
  lines?: number;
  lastLineWidth?: `${number}%`;
}) {
  return (
    <View style={{ gap: spacing.sm }}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          height={14}
          width={i === lines - 1 && lines > 1 ? lastLineWidth : '100%'}
        />
      ))}
    </View>
  );
}

// A circular avatar placeholder, sized to match the Avatar component.
export function SkeletonAvatar({ size = 48 }: { size?: number }) {
  return <Skeleton height={size} width={size} radius={radius.full} />;
}

// A full card-shaped placeholder: optional avatar, a title, and body lines.
export function SkeletonCard({ withAvatar = false }: { withAvatar?: boolean }) {
  return (
    <View
      style={{
        padding: spacing.lg,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: colors.hairline,
        backgroundColor: colors.canvas,
        gap: spacing.md,
      }}
    >
      {withAvatar ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
          <SkeletonAvatar size={44} />
          <View style={{ flex: 1, gap: spacing.sm }}>
            <Skeleton height={16} width="50%" />
            <Skeleton height={12} width="30%" />
          </View>
        </View>
      ) : (
        <>
          <Skeleton height={20} width="60%" />
          <Skeleton height={14} width="30%" />
        </>
      )}
      <Skeleton height={14} width="80%" />
    </View>
  );
}

// A vertical run of card skeletons for list-shaped loading surfaces.
export function SkeletonList({
  count = 4,
  withAvatar = true,
}: {
  count?: number;
  withAvatar?: boolean;
}) {
  return (
    <View style={{ gap: spacing.md }}>
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={i} withAvatar={withAvatar} />
      ))}
    </View>
  );
}

// Back-compat alias for the original card skeleton name used on existing screens.
export function GroupCardSkeleton() {
  return <SkeletonCard />;
}
