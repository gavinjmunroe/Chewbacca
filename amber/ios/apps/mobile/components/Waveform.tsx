import { useEffect, useRef } from 'react';
import { Animated, View, type ViewStyle } from 'react-native';
import { LIGHT } from '../lib/theme';

// A dense sound-wave: many thin amber bars at varied heights, like a real audio
// waveform, breathing gently. Used everywhere voice happens. Decorative (the
// dictation engine exposes no live level), tuned to match the recorder mockup:
// each bar has its own stable base height so the shape reads as sound, not a
// row of equal bars, and `active` widens the motion.
export function Waveform({
  color = LIGHT.accent,
  active = true,
  bars = 28,
  barWidth = 3,
  gap = 3,
  height = 48,
  style,
}: {
  color?: string;
  active?: boolean;
  bars?: number;
  barWidth?: number;
  gap?: number;
  height?: number;
  style?: ViewStyle;
}) {
  // A stable, varied base height per bar (deterministic, so it doesn't reshuffle
  // every render). Mixed sines give the uneven, natural waveform silhouette.
  const seeds = useRef(
    Array.from({ length: bars }, (_, i) => {
      const s = 0.3 + 0.55 * Math.abs(Math.sin(i * 1.7) * Math.cos(i * 0.55 + 0.6));
      return Math.min(1, Math.max(0.16, s));
    }),
  ).current;
  const values = useRef(seeds.map((s) => new Animated.Value(s))).current;

  useEffect(() => {
    const loops = values.map((v, i) => {
      const base = seeds[i];
      const amp = active ? 0.26 : 0.1;
      const hi = Math.min(1, base + amp);
      const lo = Math.max(0.14, base - amp);
      const duration = 300 + (i % 6) * 80;
      return Animated.loop(
        Animated.sequence([
          Animated.timing(v, { toValue: hi, duration, useNativeDriver: true }),
          Animated.timing(v, { toValue: lo, duration, useNativeDriver: true }),
        ]),
      );
    });
    const timers = loops.map((loop, i) => setTimeout(() => loop.start(), i * 26));
    return () => {
      timers.forEach(clearTimeout);
      loops.forEach((loop) => loop.stop());
    };
  }, [values, seeds, active]);

  return (
    <View
      style={[{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', height, gap }, style]}
    >
      {values.map((v, i) => (
        <Animated.View
          key={i}
          style={{
            width: barWidth,
            height,
            borderRadius: barWidth / 2,
            backgroundColor: color,
            transform: [{ scaleY: v }],
          }}
        />
      ))}
    </View>
  );
}
