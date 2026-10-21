import { StyleSheet, Text, View } from 'react-native';
import { AudioLines, CalendarDays, Check, Users } from 'lucide-react-native';
import Animated, { FadeIn, ZoomIn, useReducedMotion } from 'react-native-reanimated';
import { cl } from '../lib/classical';
/** Only mounted after an acknowledged write, never on transcription or a suggested action. */
export function MemoImpact({
  community,
  calendar,
  sample,
}: {
  community: boolean;
  calendar: boolean;
  sample: boolean;
}) {
  const reduced = useReducedMotion();
  return (
    <View style={s.card} accessibilityLiveRegion="polite">
      <View style={s.flow}>
        <View style={s.source}>
          <AudioLines color={cl.goldDeep} size={22} />
        </View>
        <View style={s.line} />
        {[
          { done: community, label: 'People', Icon: Users },
          { done: calendar, label: 'Plans', Icon: CalendarDays },
        ].map(({ done, label, Icon }) => (
          <View key={label} style={s.destination}>
            <Animated.View
              key={`${label}:${done}`}
              entering={reduced ? undefined : done ? ZoomIn.duration(260) : FadeIn.duration(160)}
              style={[s.target, done && s.saved]}
            >
              <Icon color={done ? cl.card : cl.ink62} size={22} />
              {done && (
                <View style={s.check}>
                  <Check size={10} color={cl.goldDeep} />
                </View>
              )}
            </Animated.View>
            <Text style={s.label}>{label}</Text>
            <Text style={s.status}>
              {done ? (sample ? 'Preview updated' : 'Updated') : 'No changes'}
            </Text>
          </View>
        ))}
      </View>
      <Text style={s.caption}>
        {sample
          ? 'Preview changes only.'
          : 'Your memo, put into action. Only confirmed changes appear here.'}
      </Text>
    </View>
  );
}
const s = StyleSheet.create({
  card: { padding: 16, borderRadius: 24, backgroundColor: cl.groundGold, gap: 12 },
  flow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  source: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: cl.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  line: { height: 1, flex: 1, backgroundColor: cl.warmHairline },
  destination: { alignItems: 'center', gap: 5 },
  target: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: cl.warmHairline,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saved: { backgroundColor: cl.goldDeep, borderColor: cl.goldDeep },
  check: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    padding: 3,
    borderRadius: 8,
    backgroundColor: cl.card,
  },
  label: { fontFamily: 'Outfit_500Medium', fontSize: 11, color: cl.ink },
  status: { fontFamily: 'Outfit_400Regular', fontSize: 10, color: cl.ink62 },
  caption: { fontFamily: 'Outfit_400Regular', fontSize: 12, lineHeight: 18, color: cl.ink62 },
});
