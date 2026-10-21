import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X } from 'lucide-react-native';
import { useChat } from '../lib/ChatContext';
import { DARK } from '../lib/theme';
import { spacing, radius } from '../lib/tokens';
import { ChatSurface } from './ChatSurface';

export function AmberVoiceOverlay({ openPerson }: { openPerson: (id: string) => void }) {
  const { overlayOpen, closeOverlay } = useChat();
  // SafeAreaView's automatic inset is unreliable inside a full-screen Modal
  // (the header would render under the status bar and the X becomes
  // untappable there), so apply the top inset explicitly instead.
  const insets = useSafeAreaInsets();

  return (
    <Modal
      visible={overlayOpen}
      animationType="fade"
      presentationStyle="fullScreen"
      onRequestClose={closeOverlay}
    >
      <View style={[styles.safeArea, { paddingTop: insets.top + spacing.sm }]}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={styles.topRow}>
            <View style={styles.labelRow}>
              <View style={styles.dot} />
              <Text style={styles.label}>amber voice</Text>
            </View>
            <Pressable
              onPress={closeOverlay}
              accessibilityRole="button"
              accessibilityLabel="Close"
              hitSlop={12}
              style={({ pressed }) => [styles.closeButton, { opacity: pressed ? 0.6 : 1 }]}
            >
              <X color={DARK.textSecondary} size={20} strokeWidth={2.25} />
            </Pressable>
          </View>
          <ChatSurface openPerson={openPerson} />
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: DARK.canvas,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 44,
    paddingHorizontal: spacing.base,
    zIndex: 10,
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: DARK.accent,
  },
  label: {
    fontStyle: 'italic',
    color: DARK.textSecondary,
    fontSize: 16,
  },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
