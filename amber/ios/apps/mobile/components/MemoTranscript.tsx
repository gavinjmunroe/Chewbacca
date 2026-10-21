import { useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { ChevronDown, ChevronRight } from 'lucide-react-native';
import { Pressable } from './Pressable';
import { memoTranscript } from '../lib/memoDetail';
import { contextualMemo } from '../lib/memoContext';
import type { MemoEntry } from '../lib/memoActions';
import { requestStyles as s } from './MemoStyles';
import { cl } from '../lib/classical';
export function MemoTranscript({
  entry,
  onSave,
}: {
  entry: MemoEntry;
  onSave?: (text: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  async function save() {
    if (!onSave || draft === null || !draft.trim() || saving) return;
    setSaving(true);
    setError('');
    try {
      await onSave(contextualMemo(draft.trim(), entry.context));
      setDraft(null);
    } catch {
      setError('Could not save this correction. Your draft is still here.');
    } finally {
      setSaving(false);
    }
  }
  return (
    <View style={{ gap: 8 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Transcript"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((v) => !v)}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          minHeight: 44,
        }}
      >
        <Text style={s.label}>TRANSCRIPT</Text>
        {open ? (
          <ChevronDown size={18} color={cl.ink62} />
        ) : (
          <ChevronRight size={18} color={cl.ink62} />
        )}
      </Pressable>
      {open && (
        <>
          {draft === null ? (
            <Text selectable style={s.body}>
              {memoTranscript(entry.text) || 'No transcript yet. Your audio is preserved.'}
            </Text>
          ) : (
            <TextInput
              accessibilityLabel="Correct memo transcript"
              multiline
              maxLength={32000}
              editable={!saving}
              value={draft}
              onChangeText={setDraft}
              style={[s.input, { minHeight: 120, textAlignVertical: 'top' }]}
            />
          )}
          {onSave && (
            <View style={{ flexDirection: 'row', gap: 20 }}>
              <Pressable
                accessibilityRole="button"
                disabled={saving || (draft !== null && !draft.trim())}
                onPress={() =>
                  draft === null ? setDraft(memoTranscript(entry.text)) : void save()
                }
                style={{ minHeight: 44, justifyContent: 'center' }}
              >
                <Text style={[s.body, { color: cl.goldDeep }]}>
                  {saving ? 'Saving…' : draft === null ? 'Correct transcript' : 'Save correction'}
                </Text>
              </Pressable>
              {draft !== null && (
                <Pressable
                  accessibilityRole="button"
                  disabled={saving}
                  onPress={() => setDraft(null)}
                  style={{ minHeight: 44, justifyContent: 'center' }}
                >
                  <Text style={s.body}>Cancel</Text>
                </Pressable>
              )}
            </View>
          )}
          {!!error && (
            <Text accessibilityRole="alert" style={s.hint}>
              {error}
            </Text>
          )}
        </>
      )}
    </View>
  );
}
