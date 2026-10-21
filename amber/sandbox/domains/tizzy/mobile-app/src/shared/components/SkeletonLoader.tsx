import React, { useEffect } from 'react';
import { View, StyleSheet, ViewStyle } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withTiming,
  Easing,
  interpolateColor,
} from 'react-native-reanimated';
import { colors } from '../constants/colors';
import { spacing } from '../constants/spacing';

interface SkeletonProps {
  width?: number | string;
  height?: number;
  borderRadius?: number;
  style?: ViewStyle;
}

export function SkeletonBox({ width = '100%', height = 16, borderRadius = spacing.radius.sm, style }: SkeletonProps) {
  const shimmer = useSharedValue(0);

  useEffect(() => {
    shimmer.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 900, easing: Easing.inOut(Easing.quad) }),
        withTiming(0, { duration: 900, easing: Easing.inOut(Easing.quad) })
      ),
      -1,
      false
    );
  }, []);

  const animatedStyle = useAnimatedStyle(() => {
    const backgroundColor = interpolateColor(
      shimmer.value,
      [0, 1],
      [colors.neutral.gray200, colors.neutral.gray100]
    );
    return { backgroundColor };
  });

  return (
    <Animated.View
      style={[
        { width: width as any, height, borderRadius },
        animatedStyle,
        style,
      ]}
    />
  );
}

export function HomeScreenSkeleton() {
  return (
    <View style={skeletonStyles.container}>
      {/* Header skeleton */}
      <View style={skeletonStyles.header}>
        <SkeletonBox width={120} height={18} borderRadius={spacing.radius.xs} />
        <SkeletonBox width={200} height={32} borderRadius={spacing.radius.xs} style={{ marginTop: 8 }} />
      </View>

      {/* Status banner skeleton */}
      <SkeletonBox height={48} borderRadius={spacing.radius.md} style={skeletonStyles.banner} />

      {/* Quick actions skeleton */}
      <View style={skeletonStyles.section}>
        <SkeletonBox width={120} height={20} borderRadius={spacing.radius.xs} style={{ marginBottom: 16 }} />
        <View style={skeletonStyles.actionsGrid}>
          <SkeletonBox width="48%" height={120} borderRadius={spacing.radius.lg} />
          <SkeletonBox width="48%" height={120} borderRadius={spacing.radius.lg} />
          <SkeletonBox width="48%" height={120} borderRadius={spacing.radius.lg} />
          <SkeletonBox width="48%" height={120} borderRadius={spacing.radius.lg} />
        </View>
      </View>

      {/* Weekly progress skeleton */}
      <View style={skeletonStyles.section}>
        <SkeletonBox width={100} height={20} borderRadius={spacing.radius.xs} style={{ marginBottom: 16 }} />
        <SkeletonBox height={100} borderRadius={spacing.radius.lg} />
      </View>

      {/* Recent sessions skeleton */}
      <View style={skeletonStyles.section}>
        <SkeletonBox width={140} height={20} borderRadius={spacing.radius.xs} style={{ marginBottom: 16 }} />
        <SkeletonBox height={88} borderRadius={spacing.radius.lg} style={{ marginBottom: 12 }} />
        <SkeletonBox height={88} borderRadius={spacing.radius.lg} style={{ marginBottom: 12 }} />
        <SkeletonBox height={88} borderRadius={spacing.radius.lg} />
      </View>
    </View>
  );
}

export function SessionsListSkeleton() {
  return (
    <View style={skeletonStyles.container}>
      <SkeletonBox height={88} borderRadius={spacing.radius.lg} style={{ marginBottom: 12 }} />
      <SkeletonBox height={88} borderRadius={spacing.radius.lg} style={{ marginBottom: 12 }} />
      <SkeletonBox height={88} borderRadius={spacing.radius.lg} style={{ marginBottom: 12 }} />
      <SkeletonBox height={88} borderRadius={spacing.radius.lg} style={{ marginBottom: 12 }} />
      <SkeletonBox height={88} borderRadius={spacing.radius.lg} />
    </View>
  );
}

export function DeviceCardSkeleton() {
  return (
    <View style={skeletonStyles.deviceCard}>
      <View style={skeletonStyles.deviceHeader}>
        <SkeletonBox width={48} height={48} borderRadius={24} />
        <View style={{ flex: 1, marginLeft: 12 }}>
          <SkeletonBox width={120} height={18} borderRadius={spacing.radius.xs} style={{ marginBottom: 6 }} />
          <SkeletonBox width={180} height={14} borderRadius={spacing.radius.xs} />
        </View>
        <SkeletonBox width={60} height={28} borderRadius={spacing.radius.sm} />
      </View>
      <View style={skeletonStyles.divider} />
      <SkeletonBox height={14} borderRadius={spacing.radius.xs} style={{ marginBottom: 8 }} />
      <SkeletonBox width="70%" height={14} borderRadius={spacing.radius.xs} style={{ marginBottom: 8 }} />
      <SkeletonBox width="85%" height={14} borderRadius={spacing.radius.xs} />
    </View>
  );
}

const skeletonStyles = StyleSheet.create({
  container: {
    padding: spacing.screenPadding,
  },
  header: {
    marginBottom: 24,
  },
  banner: {
    marginBottom: 20,
  },
  section: {
    marginBottom: 24,
  },
  actionsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  deviceCard: {
    backgroundColor: colors.background.primary,
    borderRadius: spacing.radius.lg,
    padding: spacing.cardPadding,
  },
  deviceHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  divider: {
    height: 1,
    backgroundColor: colors.border.light,
    marginVertical: 16,
  },
});
