import React, { useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { SymbolView } from 'expo-symbols';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withTiming,
  withSpring,
  FadeInDown,
} from 'react-native-reanimated';
import { ConnectionState } from '../../services/BLEManager';
import { colors } from '../constants/colors';
import { spacing } from '../constants/spacing';

interface StatusBannerProps {
  connectionState: ConnectionState;
}

export function StatusBanner({ connectionState }: StatusBannerProps) {
  const pulseOpacity = useSharedValue(1);

  const isAnimating = connectionState === 'connecting' || connectionState === 'discovering';

  useEffect(() => {
    if (isAnimating) {
      pulseOpacity.value = withRepeat(
        withSequence(
          withTiming(0.5, { duration: 600 }),
          withTiming(1, { duration: 600 })
        ),
        -1,
        false
      );
    } else {
      pulseOpacity.value = withTiming(1, { duration: 200 });
    }
  }, [connectionState]);

  const pulseStyle = useAnimatedStyle(() => ({
    opacity: pulseOpacity.value,
  }));

  const getStatusConfig = () => {
    switch (connectionState) {
      case 'connected':
        return {
          backgroundColor: colors.success.main,
          text: 'Connected',
          symbolName: 'checkmark.circle.fill' as const,
          textColor: colors.text.inverse,
        };
      case 'connecting':
        return {
          backgroundColor: colors.warning.main,
          text: 'Connecting...',
          symbolName: 'arrow.triangle.2.circlepath' as const,
          textColor: colors.text.inverse,
        };
      case 'discovering':
        return {
          backgroundColor: colors.info.main,
          text: 'Discovering services...',
          symbolName: 'magnifyingglass' as const,
          textColor: colors.text.inverse,
        };
      case 'disconnected':
        return {
          backgroundColor: colors.neutral.gray700,
          text: 'Not connected',
          symbolName: 'iphone.slash' as const,
          textColor: colors.text.inverse,
        };
      default:
        return {
          backgroundColor: colors.neutral.gray400,
          text: 'Unknown',
          symbolName: 'questionmark.circle' as const,
          textColor: colors.text.inverse,
        };
    }
  };

  const config = getStatusConfig();

  return (
    <Animated.View
      entering={FadeInDown.duration(300).springify()}
      style={[styles.container, { backgroundColor: config.backgroundColor }]}
    >
      <Animated.View style={[styles.iconWrapper, isAnimating && pulseStyle]}>
        <SymbolView
          name={config.symbolName}
          size={18}
          tintColor={config.textColor}
        />
      </Animated.View>
      <Text style={[styles.text, { color: config.textColor }]}>{config.text}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: spacing.md,
    borderRadius: spacing.radius.md,
    marginBottom: spacing.md,
    gap: 8,
  },
  iconWrapper: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    fontSize: 15,
    fontWeight: '600',
  },
});
