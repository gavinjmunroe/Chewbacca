import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, TextInput, View, type TextStyle } from 'react-native';
import { Pressable } from './Pressable';
import { Text } from './Text';
import { LIGHT } from '../lib/theme';

// TAP THE THING TO CHANGE THE THING.
//
// The contact card used to have one Edit button in the header that opened a modal
// containing every field. That is a form, and a form is the wrong shape for changing
// one word: you tap Edit, wait for a sheet, find the field among nine others, change
// it, find Save, and come back. Editing a job title should cost one tap on the job
// title.
//
// WHAT MAKES THIS FEEL RIGHT rather than like a text box bolted onto a label:
//   - it renders as the SAME text it replaces, with the same variant and style, so
//     nothing moves when it becomes editable
//   - an empty field still occupies its line and shows a muted prompt, because a
//     field you cannot see is a field you cannot tap
//   - commit on blur AND on submit; iOS users do both, and losing an edit because
//     you tapped away instead of hitting return is the kind of thing people never
//     forgive an app for
//   - unchanged text does not hit the network at all
//   - a failed save RESTORES the previous value rather than leaving the input
//     showing something the server rejected, which would otherwise read as saved
export function EditableField({
  value,
  placeholder,
  onSave,
  variant = 'bodySm',
  style,
  numberOfLines = 2,
  multiline = false,
  accessibilityLabel,
  autoCapitalize = 'words',
}: {
  value: string | undefined;
  placeholder: string;
  /** Persist. Return false (or throw) to reject and roll the field back. */
  onSave: (next: string) => Promise<boolean>;
  variant?: 'displayMd' | 'bodySm' | 'bodyMd' | 'titleSm';
  style?: TextStyle;
  numberOfLines?: number;
  multiline?: boolean;
  accessibilityLabel: string;
  autoCapitalize?: 'none' | 'words' | 'sentences';
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? '');
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<TextInput>(null);
  // The value we would roll back to. Held in a ref so a failed save can restore it
  // without the committed prop having to arrive first.
  const lastGood = useRef(value ?? '');

  useEffect(() => {
    // Adopt an external change (a save elsewhere, a refetch) but never yank the text
    // out from under someone who is mid-edit.
    if (editing) return;
    setDraft(value ?? '');
    lastGood.current = value ?? '';
  }, [value, editing]);

  const commit = () => {
    if (!editing) return;
    setEditing(false);
    const next = draft.trim();
    if (next === (lastGood.current ?? '').trim()) {
      setDraft(lastGood.current);
      return;
    }
    setSaving(true);
    void onSave(next)
      .then((ok) => {
        if (ok) lastGood.current = next;
        else setDraft(lastGood.current);
      })
      .catch(() => setDraft(lastGood.current))
      .finally(() => setSaving(false));
  };

  if (editing) {
    return (
      <TextInput
        ref={inputRef}
        value={draft}
        onChangeText={setDraft}
        onBlur={commit}
        onSubmitEditing={commit}
        autoFocus
        selectTextOnFocus
        multiline={multiline}
        numberOfLines={multiline ? numberOfLines : 1}
        returnKeyType="done"
        // blurOnSubmit so return commits a single-line field instead of inserting a
        // newline into a job title.
        blurOnSubmit={!multiline}
        autoCapitalize={autoCapitalize}
        accessibilityLabel={accessibilityLabel}
        placeholder={placeholder}
        placeholderTextColor={LIGHT.textMuted}
        style={[
          TEXT_STYLES[variant],
          style,
          {
            // A faint rule under the field is the whole affordance: it says "this is
            // live" without a box that would reflow everything around it.
            borderBottomWidth: 1,
            borderBottomColor: LIGHT.accentText,
            paddingVertical: 6,
            includeFontPadding: true,
            margin: 0,
          },
        ]}
      />
    );
  }

  const shown = (value ?? '').trim();
  return (
    <Pressable
      onPress={() => {
        lastGood.current = value ?? '';
        setDraft(value ?? '');
        setEditing(true);
      }}
      accessibilityRole="button"
      accessibilityLabel={`${accessibilityLabel}. ${shown || placeholder}. Tap to edit.`}
      hitSlop={6}
      style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Text
          variant={variant}
          numberOfLines={numberOfLines}
          style={[style, shown ? null : { color: LIGHT.textMuted }]}
        >
          {shown || placeholder}
        </Text>
        {saving ? <ActivityIndicator size="small" color={LIGHT.textMuted} /> : null}
      </View>
    </Pressable>
  );
}

// The editing state has to match the resting state exactly or the line jumps as it
// becomes a field. A TextInput does not read our Text variants, so the handful this
// component supports are mirrored here.
const TEXT_STYLES: Record<string, TextStyle> = {
  displayMd: { fontSize: 26, lineHeight: 31, fontWeight: '600', color: LIGHT.textPrimary },
  titleSm: { fontSize: 16, lineHeight: 21, fontWeight: '600', color: LIGHT.textPrimary },
  bodyMd: { fontSize: 15, lineHeight: 21, color: LIGHT.textPrimary },
  bodySm: { fontSize: 13, lineHeight: 18, color: LIGHT.textSecondary },
};
