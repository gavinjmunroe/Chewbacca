import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, TextInput, View } from 'react-native';
import { Check, Globe, Lock, Search, User, Users } from 'lucide-react-native';
import { Avatar } from './Avatar';
import { Text } from './Text';
import { useCircles } from '../lib/circles';
import { useContacts } from '../lib/useContacts';
import { type NoteShareScope, type NoteVisibility } from '../lib/noteShares';
import { LIGHT } from '../lib/theme';
import { radius, spacing } from '../lib/tokens';
import { filterPeople } from '../lib/peopleSearch';

// A compact, reusable audience picker shared by the record-box share control and
// the 3-dots "Sharing" modal. Segments: (Private) / Network / Circle / Contact.
// Choosing Circle or Contact reveals an inline list to pick the specific one.
// Circles + contacts load lazily the first time their segment is opened.

type Segment = { key: NoteVisibility; label: string; icon: typeof Globe };

const SEGMENTS: Segment[] = [
  { key: 'private', label: 'Private', icon: Lock },
  { key: 'network', label: 'Network', icon: Globe },
  { key: 'circle', label: 'Circle', icon: Users },
  { key: 'contact', label: 'Contact', icon: User },
];

export function ShareScopePicker({
  value,
  onChange,
  includePrivate = true,
}: {
  value: NoteShareScope;
  onChange: (scope: NoteShareScope) => void;
  includePrivate?: boolean;
}) {
  const segments = useMemo(
    () => (includePrivate ? SEGMENTS : SEGMENTS.filter((s) => s.key !== 'private')),
    [includePrivate],
  );

  const selectVisibility = (v: NoteVisibility) => {
    // Switching to network/private drops any specific target; circle/contact
    // keep whatever was picked so re-tapping the segment doesn't clear it.
    if (v === 'network' || v === 'private') {
      onChange({ visibility: v, targetId: null, targetName: null });
    } else {
      onChange({ visibility: v, targetId: value.targetId ?? null, targetName: value.targetName ?? null });
    }
  };

  return (
    <View style={{ gap: spacing.sm }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
        {segments.map((seg) => {
          const active = value.visibility === seg.key;
          const Icon = seg.icon;
          return (
            <Pressable
              key={seg.key}
              onPress={() => selectVisibility(seg.key)}
              accessibilityRole="button"
              accessibilityLabel={seg.label}
              accessibilityState={{ selected: active }}
              style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
            >
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 5,
                  paddingHorizontal: spacing.base,
                  paddingVertical: spacing.sm + 1,
                  borderRadius: radius.full,
                  borderWidth: active ? 1.5 : 1,
                  borderColor: active ? LIGHT.accent : LIGHT.hairline,
                  backgroundColor: active ? LIGHT.chipBg : 'transparent',
                }}
              >
                <Icon
                  color={active ? LIGHT.accentText : LIGHT.textMuted}
                  size={14}
                  strokeWidth={2.25}
                />
                <Text
                  variant="captionSm"
                  style={{ color: active ? LIGHT.accentText : LIGHT.textSecondary }}
                >
                  {seg.label}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </View>

      {value.visibility === 'circle' ? (
        <CirclePicker
          selectedId={value.targetId ?? null}
          onSelect={(id, name) => onChange({ visibility: 'circle', targetId: id, targetName: name })}
        />
      ) : null}

      {value.visibility === 'contact' ? (
        <ContactPicker
          selectedId={value.targetId ?? null}
          onSelect={(id, name) => onChange({ visibility: 'contact', targetId: id, targetName: name })}
        />
      ) : null}
    </View>
  );
}

function CirclePicker({
  selectedId,
  onSelect,
}: {
  selectedId: string | null;
  onSelect: (id: string, name: string) => void;
}) {
  const circles = useCircles();

  if (circles.status === 'loading' && circles.items.length === 0) {
    return <ActivityIndicator color={LIGHT.textMuted} style={{ alignSelf: 'flex-start' }} />;
  }
  if (circles.items.length === 0) {
    return (
      <Text variant="captionSm" style={{ color: LIGHT.textMuted }}>
        No circles yet. Create one first.
      </Text>
    );
  }

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ gap: spacing.xs, paddingVertical: 2, paddingRight: spacing.base }}
    >
      {circles.items.map((c) => {
        const active = c.id === selectedId;
        return (
          <Pressable
            key={c.id}
            onPress={() => onSelect(c.id, c.name)}
            accessibilityRole="button"
            accessibilityLabel={c.name}
            accessibilityState={{ selected: active }}
            style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
          >
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 5,
                paddingHorizontal: spacing.md,
                paddingVertical: spacing.xs,
                borderRadius: radius.full,
                borderWidth: active ? 1.5 : 1,
                borderColor: active ? LIGHT.accent : LIGHT.hairline,
                backgroundColor: active ? LIGHT.chipBg : LIGHT.surface,
              }}
            >
              {active ? <Check color={LIGHT.accentText} size={13} strokeWidth={2.75} /> : null}
              <Text
                variant="captionSm"
                style={{ color: active ? LIGHT.accentText : LIGHT.textPrimary }}
              >
                {c.name}
              </Text>
            </View>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

function ContactPicker({
  selectedId,
  onSelect,
}: {
  selectedId: string | null;
  onSelect: (id: string, name: string) => void;
}) {
  const contacts = useContacts();
  const [query, setQuery] = useState('');

  // One matcher for every people list -- see lib/peopleSearch.ts.
  const filtered = useMemo(
    () => filterPeople(contacts.items, query).slice(0, 40),
    [contacts.items, query],
  );

  return (
    <View style={{ gap: spacing.xs }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.sm,
          backgroundColor: LIGHT.surface,
          borderRadius: radius.lg,
          borderWidth: 1,
          borderColor: LIGHT.hairline,
          paddingHorizontal: spacing.base,
          height: 38,
        }}
      >
        <Search color={LIGHT.textMuted} size={15} strokeWidth={2.25} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search contacts…"
          placeholderTextColor={LIGHT.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
          style={{ flex: 1, color: LIGHT.textPrimary, fontSize: 15, padding: 0, height: 38 }}
        />
      </View>

      {contacts.status === 'loading' && contacts.items.length === 0 ? (
        <ActivityIndicator color={LIGHT.textMuted} style={{ alignSelf: 'flex-start' }} />
      ) : (
        <ScrollView
          style={{ maxHeight: 176 }}
          keyboardShouldPersistTaps="handled"
          nestedScrollEnabled
          showsVerticalScrollIndicator={false}
        >
          {filtered.length === 0 ? (
            <Text variant="captionSm" style={{ color: LIGHT.textMuted, paddingVertical: spacing.sm }}>
              {query ? 'No contacts match.' : 'No contacts yet.'}
            </Text>
          ) : (
            filtered.map((p) => {
              const active = p.id === selectedId;
              return (
                <Pressable
                  key={p.id}
                  onPress={() => onSelect(p.id, p.name)}
                  accessibilityRole="button"
                  accessibilityLabel={p.name}
                  accessibilityState={{ selected: active }}
                  style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
                >
                  <View
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: spacing.sm,
                      paddingVertical: spacing.xs,
                      paddingHorizontal: spacing.xs,
                      borderRadius: radius.md,
                      backgroundColor: active ? LIGHT.chipBg : 'transparent',
                    }}
                  >
                    <Avatar name={p.name} url={p.avatarUrl} size={32} />
                    <Text
                      variant="bodySm"
                      numberOfLines={1}
                      style={{ flex: 1, color: LIGHT.textPrimary }}
                    >
                      {p.name}
                    </Text>
                    {active ? <Check color={LIGHT.accentText} size={16} strokeWidth={2.75} /> : null}
                  </View>
                </Pressable>
              );
            })
          )}
        </ScrollView>
      )}
    </View>
  );
}
