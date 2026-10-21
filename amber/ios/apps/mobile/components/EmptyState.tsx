import { View } from 'react-native';
import { Button } from './Button';
import { Text } from './Text';
import { radius, spacing } from '../lib/tokens';
import { cl } from '../lib/classical';

type EmptyStateProps = {
  title: string;
  description?: string;
  primaryLabel?: string;
  onPrimaryPress?: () => void;
  secondaryLabel?: string;
  onSecondaryPress?: () => void;
  // A lucide icon node. It is wrapped in a soft bubble so every empty state
  // across the app reads as one family rather than ad-hoc glyphs.
  icon?: React.ReactNode;
};

export function EmptyState({
  title,
  description,
  primaryLabel,
  onPrimaryPress,
  secondaryLabel,
  onSecondaryPress,
  icon,
}: EmptyStateProps) {
  return (
    <View
      accessibilityRole="summary"
      style={{
        alignItems: 'center',
        gap: spacing.base,
        paddingVertical: spacing.xxl,
        paddingHorizontal: spacing.lg,
      }}
    >
      {icon ? <IconBubble>{icon}</IconBubble> : null}
      <Text variant="displaySm" centered>
        {title}
      </Text>
      {description ? (
        <Text variant="bodyMd" color="muted" centered>
          {description}
        </Text>
      ) : null}
      <View style={{ flexDirection: 'row', gap: spacing.md, marginTop: spacing.sm }}>
        {primaryLabel ? <Button label={primaryLabel} onPress={onPrimaryPress} /> : null}
        {secondaryLabel ? (
          <Button label={secondaryLabel} onPress={onSecondaryPress} variant="secondary" />
        ) : null}
      </View>
    </View>
  );
}

// Shared 64x64 soft bubble that frames the illustrative icon on empty and error
// states. Kept here and re-exported so ErrorState draws from the same shape.
export function IconBubble({ children }: { children: React.ReactNode }) {
  return (
    <View
      style={{
        width: 64,
        height: 64,
        borderRadius: radius.full,
        backgroundColor: cl.tint100,
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: spacing.xs,
      }}
    >
      {children}
    </View>
  );
}
