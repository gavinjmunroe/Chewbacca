import { Text as RNText, type TextProps as RNTextProps } from 'react-native';
import { colors, fontScale, headingVariants, typography } from '../lib/tokens';

type Variant = keyof typeof typography;
type Color = 'ink' | 'body' | 'muted' | 'mutedSoft' | 'onPrimary' | 'onDark' | 'primary' | 'error';

type Props = RNTextProps & {
  variant?: Variant;
  color?: Color;
  uppercase?: boolean;
  centered?: boolean;
};

const colorMap: Record<Color, string> = {
  ink: colors.ink,
  body: colors.body,
  muted: colors.muted,
  mutedSoft: colors.mutedSoft,
  onPrimary: colors.onPrimary,
  onDark: colors.onDark,
  primary: colors.primary,
  error: colors.errorText,
};

const headingSet = new Set<string>(headingVariants);

export function Text({
  variant = 'bodyMd',
  color,
  uppercase,
  centered,
  style,
  children,
  ...rest
}: Props) {
  const t = typography[variant];
  // Dynamic Type: honor the user's font-size setting but cap the multiplier so
  // a heading or a tight row never blows out the layout. Headings cap tighter.
  const maxMultiplier = headingSet.has(variant) ? fontScale.maxHeading : fontScale.maxBody;
  // Resolution order: an explicit `color` prop, then the variant's own default
  // (microLabel/uppercaseTag carry the gold kicker color), then ink. `color` no
  // longer defaults to 'ink' — that default would have shadowed every variant
  // color — but the fallback keeps behavior identical for variants without one.
  const resolvedColor = color ? colorMap[color] : (t.color ?? colors.ink);
  return (
    <RNText
      allowFontScaling
      maxFontSizeMultiplier={maxMultiplier}
      {...rest}
      style={[
        {
          fontFamily: t.fontFamily,
          fontSize: t.fontSize,
          lineHeight: t.lineHeight,
          letterSpacing: t.letterSpacing,
          color: resolvedColor,
          textTransform: uppercase ? 'uppercase' : t.textTransform,
          textAlign: centered ? 'center' : undefined,
        },
        style,
      ]}
    >
      {children}
    </RNText>
  );
}
