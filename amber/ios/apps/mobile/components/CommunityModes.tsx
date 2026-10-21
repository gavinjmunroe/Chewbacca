import { ScrollView, Text, View, StyleSheet } from 'react-native';
import { UserPlus } from 'lucide-react-native';
import { NETWORK_CATEGORIES, type SavedNetwork } from '../lib/amberSpace';
import { Pressable } from './Pressable';
import { cl } from '../lib/classical';
export function CommunityModes({
  active,
  onSelect,
  onAdd,
}: {
  active: SavedNetwork;
  onSelect: (mode: SavedNetwork) => void;
  onAdd: () => void;
}) {
  return (
    <View style={s.row}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={s.content}
      >
        {(['All', ...NETWORK_CATEGORIES, 'Nearby'] as SavedNetwork[]).map((mode) => (
          <Pressable
            key={mode}
            accessibilityRole="button"
            accessibilityState={{ selected: active === mode }}
            onPress={() => onSelect(mode)}
            style={({ pressed }) => [
              s.chip,
              active === mode && s.selected,
              pressed && { opacity: 0.6 },
            ]}
          >
            <Text style={[s.label, active === mode && { color: cl.card }]}>{mode}</Text>
          </Pressable>
        ))}
      </ScrollView>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          active === 'All' || active === 'Nearby' ? 'Add a contact' : `Add people to ${active}`
        }
        onPress={onAdd}
        style={s.add}
      >
        <UserPlus size={21} color={cl.goldDeep} />
      </Pressable>
    </View>
  );
}
const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', marginTop: 8 },
  content: { paddingLeft: 16, paddingRight: 8, gap: 6 },
  chip: {
    minHeight: 44,
    paddingHorizontal: 14,
    borderRadius: 22,
    justifyContent: 'center',
    backgroundColor: cl.card,
  },
  selected: { backgroundColor: cl.goldDeep },
  label: { fontFamily: 'Outfit_500Medium', fontSize: 12, color: cl.ink62 },
  add: { width: 48, minHeight: 44, alignItems: 'center', justifyContent: 'center', marginRight: 8 },
});
