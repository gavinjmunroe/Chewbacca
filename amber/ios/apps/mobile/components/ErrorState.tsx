import { View } from 'react-native';
import { AlertCircle } from 'lucide-react-native';
import { Button } from './Button';
import { IconBubble } from './EmptyState';
import { Text } from './Text';
import { colors, spacing } from '../lib/tokens';

type Props = {
  title?: string;
  message?: string;
  retryLabel?: string;
  onRetry?: () => void;
};

export function ErrorState({
  title = 'Something went wrong.',
  message = 'We could not load this just now. Try again in a moment.',
  retryLabel = 'Try again',
  onRetry,
}: Props) {
  return (
    <View
      accessibilityRole="alert"
      style={{
        alignItems: 'center',
        gap: spacing.base,
        paddingVertical: spacing.xxl,
        paddingHorizontal: spacing.lg,
      }}
    >
      <IconBubble>
        <AlertCircle color={colors.errorText} size={28} />
      </IconBubble>
      <Text variant="displaySm" centered>
        {title}
      </Text>
      <Text variant="bodyMd" color="muted" centered>
        {message}
      </Text>
      {onRetry ? <Button label={retryLabel} variant="secondary" onPress={onRetry} /> : null}
    </View>
  );
}
