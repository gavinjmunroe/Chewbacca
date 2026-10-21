import { useDeferredValue, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Check, Circle, Plus, X } from 'lucide-react-native';
import { cl } from '../lib/classical';
export function CircleMembersSheet({
  category,
  people,
  members,
  onSave,
  onClose,
  onNew,
}: {
  category: string;
  people: { id: string; name: string }[];
  members: string[];
  onSave: (ids: string[]) => Promise<void>;
  onClose: () => void;
  onNew: (ids: string[]) => void;
}) {
  const [selected, setSelected] = useState(() => new Set(members));
  const [query, setQuery] = useState('');
  const deferred = useDeferredValue(query.trim().toLocaleLowerCase());
  const rows = useMemo(
    () =>
      people
        .filter((p) => !deferred || p.name.toLocaleLowerCase().includes(deferred))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [people, deferred],
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function save() {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await onSave([...selected]);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save this circle.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => !busy && onClose()}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={s.backdrop}
      >
        <View style={s.sheet} accessibilityViewIsModal>
          <View style={s.heading}>
            <Text style={s.title}>{category}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close members"
              disabled={busy}
              onPress={onClose}
              style={s.icon}
            >
              <X size={22} color={cl.ink} />
            </Pressable>
          </View>
          <Text style={s.caption}>Choose who belongs here. Only you organize this circle.</Text>
          <TextInput
            accessibilityLabel="Search contacts to add"
            placeholder="Search your contacts"
            value={query}
            onChangeText={setQuery}
            style={s.input}
            placeholderTextColor={cl.ink48}
          />
          <Pressable
            disabled={busy}
            accessibilityRole="button"
            onPress={() => onNew([...selected])}
            style={s.new}
          >
            <Plus size={19} color={cl.goldDeep} />
            <Text style={s.label}>New contact</Text>
          </Pressable>
          {!!error && (
            <Text accessibilityRole="alert" style={s.caption}>
              {error}
            </Text>
          )}
          <FlatList
            data={rows}
            extraData={selected}
            keyExtractor={(item) => item.id}
            keyboardShouldPersistTaps="handled"
            initialNumToRender={12}
            windowSize={5}
            getItemLayout={(_, index) => ({ length: 56, offset: 56 * index, index })}
            ListEmptyComponent={<Text style={s.caption}>No matching contacts.</Text>}
            renderItem={({ item }) => (
              <Pressable
                disabled={busy}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: selected.has(item.id) }}
                onPress={() =>
                  setSelected((old) => {
                    const next = new Set(old);
                    if (next.has(item.id)) next.delete(item.id);
                    else next.add(item.id);
                    return next;
                  })
                }
                style={s.person}
              >
                <Text style={[s.label, { flex: 1 }]} numberOfLines={1}>
                  {item.name}
                </Text>
                {selected.has(item.id) ? (
                  <Check size={21} color={cl.goldDeep} />
                ) : (
                  <Circle size={21} color={cl.ink32} />
                )}
              </Pressable>
            )}
          />
          <Pressable
            disabled={busy}
            accessibilityRole="button"
            onPress={() => void save()}
            style={s.save}
          >
            {busy ? (
              <ActivityIndicator color={cl.card} />
            ) : (
              <Text style={[s.label, { color: cl.card }]}>Save · {selected.size} people</Text>
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
const s = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(28,25,23,0.3)' },
  sheet: {
    height: '82%',
    backgroundColor: cl.ground,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: 20,
    paddingBottom: 36,
  },
  heading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontFamily: 'Newsreader_500Medium', fontSize: 30, color: cl.ink },
  icon: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  caption: { fontFamily: 'Outfit_400Regular', fontSize: 13, color: cl.ink62, marginBottom: 12 },
  input: {
    minHeight: 48,
    borderRadius: 16,
    backgroundColor: cl.card,
    paddingHorizontal: 14,
    color: cl.ink,
    fontFamily: 'Outfit_400Regular',
  },
  new: { flexDirection: 'row', gap: 8, minHeight: 48, alignItems: 'center' },
  label: { fontFamily: 'Outfit_500Medium', fontSize: 15, color: cl.ink },
  person: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: cl.cardHairline,
    gap: 12,
  },
  save: {
    marginTop: 12,
    minHeight: 52,
    borderRadius: 26,
    backgroundColor: cl.goldDeep,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
