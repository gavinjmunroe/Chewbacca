import { type ReactNode } from 'react';
import { type StyleProp, type ViewStyle } from 'react-native';
import { CCard } from './classical';

type GlassCardProps = {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
  /** Drop the inner padding for cards that host their own full-bleed rows. */
  flush?: boolean;
  /** The warm cream surface the mockups use for suggestions and share prompts. */
  tone?: 'plain' | 'warm';
};

// Kept as a name because it is imported across every screen, but this is now
// just the Classical card: near-white #FFFDFA, 1px hairline, 16 radius, whisper
// shadow. See components/classical.tsx (CCard) for the implementation and
// lib/classical.ts for where the numbers come from.
//
// It was frosted glass before — a BlurView with a white tint and a gloss sheen
// over the warm backdrop. Two problems: the mockups show soft-FILLED cards, not
// glass, and a translucent card takes its tone from whatever sits behind it, so
// the same card read differently on different parts of the page.
export function GlassCard({ children, style, onPress, flush, tone }: GlassCardProps) {
  return (
    <CCard onPress={onPress} style={style} flush={flush} tone={tone}>
      {children}
    </CCard>
  );
}
