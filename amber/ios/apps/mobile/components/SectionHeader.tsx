import { View } from 'react-native';
import { Text } from './Text';
import { spacing } from '../lib/tokens';

type Props = {
  title: string;
  subtitle?: string;
};

export function SectionHeader({ title, subtitle }: Props) {
  return (
    <View style={{ gap: spacing.xs, marginBottom: spacing.base }}>
      <Text variant="displayMd">{title}</Text>
      {subtitle ? (
        <Text variant="bodyMd" color="muted">
          {subtitle}
        </Text>
      ) : null}
    </View>
  );
}
