import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { ArrowUpRight } from 'lucide-react-native';
import { WebDiscoverySheet, type DiscoveryPerson } from './WebDiscoverySheet';
import { PerplexityMark } from './ProviderMarks';
import { cl } from '../lib/classical';
export function DailyFocus({
  intent = '',
  onSave,
  sample,
  calendarContext,
  onAddSample,
}: {
  intent?: string;
  onAddSample?: (person: DiscoveryPerson) => void;
  onSave?: (value: string) => Promise<void>;
  sample: boolean;
  calendarContext: string;
}) {
  const [draft, setDraft] = useState(intent),
    [open, setOpen] = useState<'opportunities' | 'network' | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  useEffect(() => setDraft(intent), [intent]);
  async function explore(scope: 'opportunities' | 'network') {
    if (!draft.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      await onSave?.(draft.trim());
      setOpen(scope);
    } catch {
      setError('Could not save your daily focus. Please retry.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <View style={s.card}>
      <View style={s.row}>
        <PerplexityMark size={20} />
        <Text style={s.eyebrow}>TODAY’S FOCUS</Text>
      </View>
      <Text style={s.title}>Who am I looking for today?</Text>
      <Text style={s.body}>
        A collaborator, a new perspective, someone who gets it. Follow that thought into useful news
        and opportunities.
      </Text>
      <TextInput
        value={draft}
        onChangeText={setDraft}
        maxLength={500}
        multiline
        accessibilityLabel="Who am I looking for today?"
        placeholder="A cofounder who cares about community…"
        placeholderTextColor={cl.ink62}
        style={s.input}
      />
      <View style={s.row}>
        <Pressable
          accessibilityRole="button"
          disabled={!draft.trim() || busy}
          onPress={() => void explore('opportunities')}
          style={[s.primary, { opacity: !draft.trim() || busy ? 0.5 : 1 }]}
        >
          <Text style={s.primaryText}>News & opportunities</Text>
          <ArrowUpRight size={16} color={cl.card} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          disabled={!draft.trim() || busy}
          onPress={() => void explore('network')}
          style={s.people}
        >
          <Text style={s.link}>Find people</Text>
        </Pressable>
      </View>
      {!!intent && <Text style={s.note}>Your focus is saved. This does not publish a status.</Text>}
      {!!error && (
        <Text accessibilityRole="alert" style={s.body}>
          {error}
        </Text>
      )}
      {open && (
        <WebDiscoverySheet
          onAddSample={onAddSample}
          query={draft.trim()}
          scope={open}
          context={calendarContext}
          sample={sample}
          onClose={() => setOpen(null)}
        />
      )}
    </View>
  );
}
const s = StyleSheet.create({
  card: { padding: 20, borderRadius: 26, backgroundColor: '#F7EEDF', gap: 13, marginBottom: 8 },
  row: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  eyebrow: { fontFamily: 'Outfit_500Medium', fontSize: 10, letterSpacing: 1.2, color: cl.goldDeep },
  title: { fontFamily: 'Newsreader_400Regular', fontSize: 30, lineHeight: 34, color: cl.ink },
  body: { fontFamily: 'Outfit_400Regular', fontSize: 14, lineHeight: 21, color: cl.ink70 },
  input: {
    minHeight: 84,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E1D0B5',
    borderRadius: 18,
    backgroundColor: cl.card,
    fontFamily: 'Outfit_400Regular',
    fontSize: 15,
    color: cl.ink,
    textAlignVertical: 'top',
  },
  primary: {
    minHeight: 48,
    paddingHorizontal: 15,
    borderRadius: 24,
    backgroundColor: cl.ink,
    flexDirection: 'row',
    gap: 6,
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
  },
  primaryText: { fontFamily: 'Outfit_500Medium', fontSize: 12, color: cl.card },
  people: { minHeight: 44, justifyContent: 'center' },
  link: { fontFamily: 'Outfit_500Medium', fontSize: 12, color: cl.goldDeep },
  note: { fontFamily: 'Outfit_400Regular', fontSize: 11, lineHeight: 16, color: cl.ink62 },
});
