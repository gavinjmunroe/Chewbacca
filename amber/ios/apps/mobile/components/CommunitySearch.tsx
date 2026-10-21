import { AmberOutline } from './AmberOutline';
import { View, Pressable, TextInput, StyleSheet } from 'react-native';
import { Search } from 'lucide-react-native';
import { cl } from '../lib/classical';
export function CommunitySearch({
  value,
  onChange,
  calendar = false,
  placeholder,
  web = false,
  onWebChange,
  onSubmit,
}: {
  value: string;
  onChange: (value: string) => void;
  calendar?: boolean;
  placeholder?: string;
  web?: boolean;
  onWebChange?: (value: boolean) => void;
  onSubmit?: () => void;
}) {
  return (
    <View style={s.bar}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Search"
        disabled={!onSubmit || !value.trim()}
        onPress={onSubmit}
        style={{ minWidth: 28, minHeight: 44, justifyContent: 'center' }}
      >
        <Search size={20} color={cl.ink62} />
      </Pressable>
      <TextInput
        value={value}
        onChangeText={onChange}
        accessibilityLabel={placeholder || (calendar ? 'Search plans' : 'Search people')}
        placeholder={
          placeholder ||
          (web
            ? calendar ? 'Find places for your plans' : 'Find new people on the web'
            : calendar
              ? 'Search your plans'
              : 'Search your people')
        }
        placeholderTextColor={cl.ink62}
        clearButtonMode="while-editing"
        autoCorrect={false}
        style={s.input}
        returnKeyType="search"
        onSubmitEditing={onSubmit}
      />
      {onWebChange && (
        <Pressable
          accessibilityRole="switch"
          accessibilityLabel="Amber web search"
          accessibilityHint="Turn on to search the web; turn off to search saved content"
          accessibilityState={{ checked: web }}
          onPress={() => onWebChange(!web)}
          style={{
            width: 44,
            height: 44,
            borderRadius: 22,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: web ? cl.groundGold : 'transparent',
          }}
        >
          <AmberOutline size={24} active={web} />
        </Pressable>
      )}
    </View>
  );
}
const s = StyleSheet.create({
  bar: {
    marginBottom: 8,
    borderWidth: 1,
    borderColor: cl.cardHairline,
    backgroundColor: cl.card,
    minHeight: 50,
    borderRadius: 27,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 18,
  },
  input: { flex: 1, minHeight: 48, color: cl.ink, fontFamily: 'Outfit_400Regular', fontSize: 16 },
});
