import { Pressable, StyleSheet } from 'react-native';
import { Navigation2, Plus } from 'lucide-react-native';
import { GlassSurface } from './LiquidGlass';
import { cl } from '../lib/classical';
export function FloatingAccent({ kind, onPress }: { kind: 'recenter' | 'add'; onPress: () => void }) {
  const Icon = kind === 'recenter' ? Navigation2 : Plus;
  return <Pressable accessibilityRole="button" accessibilityLabel={kind === 'recenter' ? 'Return to me' : 'Add calendar event'} onPress={onPress} style={[s.position, kind === 'recenter' ? { left: 14 } : { right: 14 }]}><GlassSurface style={s.surface} fallbackStyle={{ backgroundColor: cl.card }}><Icon size={21} color={cl.goldDeep} /></GlassSurface></Pressable>;
}
const s = StyleSheet.create({ position: { position: 'absolute', bottom: 12, width: 44, height: 44 }, surface: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, borderColor: cl.cardHairline, alignItems: 'center', justifyContent: 'center', shadowColor: cl.ink, shadowOpacity: .08, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } } });
