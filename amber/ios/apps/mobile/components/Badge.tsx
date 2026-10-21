import { View } from 'react-native';
import { Text } from './Text';
import { colors, radius, spacing } from '../lib/tokens';

type Tone = 'neutral' | 'rausch' | 'planning' | 'active' | 'archived' | 'dnc';

const tones: Record<Tone, { bg: string; fg: string }> = {
  neutral: { bg: colors.surfaceStrong, fg: colors.ink },
  rausch: { bg: colors.primary, fg: colors.onPrimary },
  planning: { bg: '#e3edff', fg: '#0044a3' },
  active: { bg: colors.successSurface, fg: colors.success },
  archived: { bg: colors.surfaceStrong, fg: colors.muted },
  dnc: { bg: '#fde2dc', fg: colors.errorText },
};

export function Badge({
  label,
  tone = 'neutral',
  uppercase = false,
}: {
  label: string;
  tone?: Tone;
  uppercase?: boolean;
}) {
  const { bg, fg } = tones[tone];
  return (
    <View
      style={{
        backgroundColor: bg,
        borderRadius: radius.full,
        paddingHorizontal: spacing.sm + 2,
        paddingVertical: 4,
        alignSelf: 'flex-start',
      }}
    >
      <Text
        variant={uppercase ? 'uppercaseTag' : 'badge'}
        uppercase={uppercase}
        style={{ color: fg }}
      >
        {label}
      </Text>
    </View>
  );
}
