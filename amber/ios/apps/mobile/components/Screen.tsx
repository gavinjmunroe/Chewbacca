import {
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing } from '../lib/tokens';

type ScreenProps = {
  children: React.ReactNode;
  scroll?: boolean;
  centered?: boolean;
  padded?: boolean;
  background?: string;
  contentContainerStyle?: ViewStyle;
  onRefresh?: () => void;
  refreshing?: boolean;
  // Lift the content this many points when the keyboard opens. On a tab screen
  // with a bottom-docked input (the chat), pass the tab bar height so the input
  // sits directly above the keyboard instead of behind it.
  keyboardOffset?: number;
  // Safe-area edges to inset. Defaults to top+bottom. Pass ['bottom'] when a
  // sibling (e.g. WeekStrip) already owns the top inset.
  edges?: readonly ('top' | 'bottom' | 'left' | 'right')[];
};

export function Screen({
  children,
  scroll = false,
  centered = false,
  padded = true,
  // The page ground, not the card fill — colors.canvas is the near-white card.
  background = colors.ground,
  contentContainerStyle,
  onRefresh,
  refreshing = false,
  keyboardOffset = 0,
  edges = ['top', 'bottom'],
}: ScreenProps) {
  const padStyle = padded
    ? { paddingHorizontal: spacing.lg, paddingVertical: spacing.lg }
    : undefined;

  const inner = scroll ? (
    <ScrollView
      contentContainerStyle={[
        padStyle,
        centered && { flexGrow: 1, justifyContent: 'center' },
        contentContainerStyle,
      ]}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      refreshControl={
        onRefresh ? (
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.ink} />
        ) : undefined
      }
    >
      {children}
    </ScrollView>
  ) : (
    <View
      style={[
        styles.fill,
        padStyle,
        centered && { justifyContent: 'center' },
        contentContainerStyle,
      ]}
    >
      {children}
    </View>
  );

  return (
    <SafeAreaView style={[styles.fill, { backgroundColor: background }]} edges={edges}>
      <KeyboardAvoidingView
        style={styles.fill}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={keyboardOffset}
      >
        {inner}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
