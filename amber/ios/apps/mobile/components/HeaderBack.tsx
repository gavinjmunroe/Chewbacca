import { TouchableOpacity, View } from 'react-native';
import { ChevronLeft } from 'lucide-react-native';
import { useRouter } from 'expo-router';
import { Text } from './Text';
import { colors, spacing } from '../lib/tokens';

export function HeaderBack({ label = 'Back' }: { label?: string }) {
  const router = useRouter();
  return (
    <View
      style={{
        paddingHorizontal: spacing.lg,
        paddingTop: spacing.sm,
        paddingBottom: spacing.md,
        backgroundColor: colors.canvas,
      }}
    >
      <TouchableOpacity
        onPress={() => router.back()}
        accessibilityRole="button"
        accessibilityLabel="Go back"
        activeOpacity={0.6}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 4,
          alignSelf: 'flex-start',
        }}
      >
        <ChevronLeft color={colors.ink} size={20} />
        <Text variant="bodyMd">{label}</Text>
      </TouchableOpacity>
    </View>
  );
}
