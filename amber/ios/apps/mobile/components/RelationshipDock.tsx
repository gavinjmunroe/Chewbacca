import { DockCapture } from './DockCapture';
import { useEffect, useState } from 'react';
import { AccessibilityInfo, Pressable, StyleSheet, Text, View } from 'react-native';
import { BlurView } from 'expo-blur';
import { GlassView, isLiquidGlassAvailable, isGlassEffectAPIAvailable } from 'expo-glass-effect';
import { CalendarDays, Users } from 'lucide-react-native';
import { cl } from '../lib/classical';
export type RelationshipTab = 'people' | 'calendar';
export function RelationshipDock({
  tab,
  onTab,
  onSpeak,
  onVoice,
}: {
  tab: RelationshipTab;
  onTab: (tab: RelationshipTab) => void;
  onSpeak: () => void;
  onVoice?: () => void;
}) {
  const [opaque, setOpaque] = useState(true);
  useEffect(() => {
    void AccessibilityInfo.isReduceTransparencyEnabled().then(setOpaque);
    const listener = AccessibilityInfo.addEventListener('reduceTransparencyChanged', setOpaque);
    return () => listener.remove();
  }, []);
  let nativeGlass = false;
  try {
    nativeGlass = !opaque && isLiquidGlassAvailable() && isGlassEffectAPIAvailable();
  } catch {
    /* Older development clients use the fallback. */
  }
  const contents = (
    <>
      <Pressable
        accessibilityRole="tab"
        accessibilityState={{ selected: tab === 'people' }}
        onPress={() => onTab('people')}
        style={[s.tab, tab === 'people' && s.selected]}
      >
        <Users size={23} color={cl.ink} />
        <Text style={s.label}>People</Text>
      </Pressable>

      <View style={{ width: 58, height: 58 }} />
      <Pressable
        accessibilityRole="tab"
        accessibilityState={{ selected: tab === 'calendar' }}
        onPress={() => onTab('calendar')}
        style={[s.tab, tab === 'calendar' && s.selected]}
      >
        <CalendarDays size={23} color={cl.ink} />
        <Text style={s.label}>Plans</Text>
      </Pressable>
    </>
  );
  const bar = nativeGlass ? (
    <GlassView glassEffectStyle="regular" isInteractive colorScheme="light" style={s.bar}>
      {contents}
    </GlassView>
  ) : (
    <View style={[s.bar, { backgroundColor: cl.card }]}>
      {!opaque && (
        <BlurView
          pointerEvents="none"
          tint="light"
          intensity={65}
          style={[StyleSheet.absoluteFill, { borderRadius: 40, overflow: 'hidden' }]}
        />
      )}
      {contents}
    </View>
  );
  return (
    <View>
      {bar}
      <View
        pointerEvents="box-none"
        style={{ position: 'absolute', left: '50%', marginLeft: -29, top: 8, zIndex: 10 }}
      >
        <DockCapture onVoice={onVoice ?? onSpeak} />
      </View>
    </View>
  );
}
const s = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'center',
    padding: 7,
    borderRadius: 40,
    borderWidth: 1,
    borderColor: cl.cardHairline,
    overflow: 'hidden',
    backgroundColor: 'transparent',
  },
  tab: {
    flex: 1,
    minHeight: 52,
    borderRadius: 30,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 4,
  },
  selected: { backgroundColor: cl.groundGold },
  label: { fontFamily: 'Outfit_500Medium', fontSize: 12, color: cl.ink },
  speak: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: cl.goldDeep,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: cl.card,
  },
});
