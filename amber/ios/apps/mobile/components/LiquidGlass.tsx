import { useEffect, useState } from 'react';
import { AccessibilityInfo, Platform, View, type StyleProp, type ViewProps, type ViewStyle } from 'react-native';
import { GlassView, isLiquidGlassAvailable, type GlassStyle } from 'expo-glass-effect';

// iOS 26 "Liquid Glass" for Amber's chrome surfaces, with a mandatory fallback.
//
// expo-glass-effect renders Apple's UIGlassEffect ONLY on iOS 26+. On iOS < 26
// and Android its GlassView degrades to a plain (transparent) <View>, so any
// surface we glass MUST also carry the opaque style it has today or those users
// see a broken, see-through surface. We therefore gate on a single runtime flag
// resolved once here, and every glass surface supplies a `fallbackStyle` that
// reproduces exactly the current look for the non-glass path.
//
// A solid backgroundColor cannot simply be left on the GlassView: on iOS 26 it
// would paint over the glass and hide the effect. Hence the branch — glass path
// omits the opaque fill; fallback path keeps it.

// Availability is fixed for the process lifetime, so resolve it once. Guarded so
// a missing/older native module (e.g. an OTA update onto an old binary) can never
// throw at import time — it just falls back to the current opaque surfaces.
export const liquidGlassEnabled: boolean =
  Platform.OS === 'ios' &&
  (() => {
    try {
      return isLiquidGlassAvailable();
    } catch {
      return false;
    }
  })();

type GlassSurfaceProps = {
  /**
   * Styles that reproduce today's opaque surface — backgroundColor, and any
   * border/edge that would otherwise vanish. Applied ONLY on the fallback path
   * (iOS < 26 / Android) so those users see exactly the current surface. Keep
   * structural styles (size, radius, border width, overflow) in `style` so they
   * apply on both paths.
   */
  fallbackStyle?: StyleProp<ViewStyle>;
  /** Glass material. Defaults to the library's 'regular' frosted look. */
  glassStyle?: GlassStyle;
  /** Optional tint applied to the glass (glass path only). */
  tintColor?: string;
} & ViewProps;

/**
 * A drop-in surface that renders Liquid Glass on iOS 26+ and the existing opaque
 * View everywhere else. `style` holds the shared structural styling; put the
 * opaque fill in `fallbackStyle`.
 */
export function GlassSurface({
  fallbackStyle,
  glassStyle = 'regular',
  tintColor,
  style,
  children,
  ...rest
}: GlassSurfaceProps) {
  const [reduceTransparency, setReduceTransparency] = useState(true);
  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isReduceTransparencyEnabled().then(value => { if (active) setReduceTransparency(value); }).catch(() => {});
    const subscription = AccessibilityInfo.addEventListener('reduceTransparencyChanged', setReduceTransparency);
    return () => { active = false; subscription.remove(); };
  }, []);
  if (liquidGlassEnabled && !reduceTransparency) {
    return (
      <GlassView glassEffectStyle={glassStyle} tintColor={tintColor} style={style} {...rest}>
        {children}
      </GlassView>
    );
  }
  return (
    <View style={[style, fallbackStyle]} {...rest}>
      {children}
    </View>
  );
}
