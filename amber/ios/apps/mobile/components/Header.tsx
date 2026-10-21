import { Pressable, View } from 'react-native';
import { ChevronLeft } from 'lucide-react-native';
import { useRouter } from 'expo-router';
import { Text } from './Text';
import { colors, control, spacing } from '../lib/tokens';

type HeaderProps = {
  title?: string;
  // Show the leading back chevron. Defaults to the router back action; pass
  // onBack to override (for example, to confirm before discarding a draft).
  showBack?: boolean;
  onBack?: () => void;
  // A node pinned to the trailing edge: the profile avatar on tab screens, an
  // action button on detail screens.
  right?: React.ReactNode;
};

// The single header used across every stack so the title, back affordance, and
// trailing action sit in the same place on every screen.
export function Header({ title, showBack = false, onBack, right }: HeaderProps) {
  const router = useRouter();
  const handleBack = onBack ?? (() => router.back());

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
        paddingHorizontal: spacing.lg,
        paddingTop: spacing.sm,
        paddingBottom: spacing.md,
        backgroundColor: colors.canvas,
        minHeight: control.height,
      }}
    >
      {showBack ? (
        <Pressable
          onPress={handleBack}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          hitSlop={control.hitSlop}
          style={{ marginLeft: -spacing.xs }}
        >
          <ChevronLeft color={colors.ink} size={24} />
        </Pressable>
      ) : null}
      <View style={{ flex: 1 }}>
        {title ? (
          <Text variant="displaySm" numberOfLines={1} accessibilityRole="header">
            {title}
          </Text>
        ) : null}
      </View>
      {right ? <View>{right}</View> : null}
    </View>
  );
}
