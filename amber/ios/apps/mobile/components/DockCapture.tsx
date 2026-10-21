import { Image, StyleSheet } from 'react-native';
import { Pressable } from './Pressable';
import { cl } from '../lib/classical';
/** A single native press opens the recorder; no hidden drag target or capture menu. */
export function DockCapture({ onVoice }: { onVoice: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Record a voice memo"
      onPress={onVoice}
      style={({ pressed }) => [
        s.button,
        pressed && { transform: [{ scale: 0.94 }], opacity: 0.85 },
      ]}
    >
      <Image
        source={require('../assets/amber-logo.png')}
        style={{ width: 56, height: 56 }}
        resizeMode="contain"
        accessible={false}
      />
    </Pressable>
  );
}
const s = StyleSheet.create({
  button: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: cl.groundGold,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: cl.card,
  },
});
