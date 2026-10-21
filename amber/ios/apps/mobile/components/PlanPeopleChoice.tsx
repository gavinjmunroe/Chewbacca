import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { requestStyles as s } from './MemoStyles';
import { cl } from '../lib/classical';
export function PlanPeopleChoice({
  contacts,
  selected,
  onChange,
  disabled,
}: {
  contacts: { id: string; name: string; detail?: string }[];
  selected: string[];
  onChange: (ids: string[]) => void;
  disabled: boolean;
}) {
  const [query, setQuery] = useState('');
  const rows = contacts
    .filter(
      (c) =>
        selected.includes(c.id) ||
        (query.trim() &&
          `${c.name} ${c.detail || ''}`.toLowerCase().includes(query.trim().toLowerCase())),
    )
    .slice(0, 30);
  return (
    <View style={{ gap: 8 }}>
      <Text style={s.label}>PEOPLE</Text>
      <Text style={s.body}>You · your plan</Text>
      <TextInput
        accessibilityLabel="Add people to this plan"
        placeholder="Who is this with?"
        value={query}
        onChangeText={setQuery}
        editable={!disabled}
        style={s.input}
      />
      {rows.map((person) => (
        <Pressable
          key={person.id}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: selected.includes(person.id) }}
          disabled={disabled}
          style={s.row}
          onPress={() =>
            onChange(
              selected.includes(person.id)
                ? selected.filter((id) => id !== person.id)
                : [...selected, person.id],
            )
          }
        >
          <View style={{ flex: 1 }}>
            <Text style={s.body}>{person.name}</Text>
            {!!person.detail && <Text style={s.hint}>{person.detail}</Text>}
          </View>
          <Text style={{ color: cl.goldDeep }}>{selected.includes(person.id) ? '✓' : '+'}</Text>
        </Pressable>
      ))}
      <Text style={s.hint}>
        Private associations. No invitations are sent; existing attendees stay unchanged.
      </Text>
    </View>
  );
}
