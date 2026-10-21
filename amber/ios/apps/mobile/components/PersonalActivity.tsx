import { useEffect, useRef, useState } from 'react';
import { randomUUID } from 'expo-crypto';
import { listCircles, type CirclePreview } from '../lib/circles';
import { sendAmberAlert } from '../lib/sendAmberAlert';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { X } from 'lucide-react-native';
import { requestStyles as s } from './MemoStyles';
import { cl } from '../lib/classical';

const AUDIENCES = [
  'Private',
  'Family',
  'Friends',
  'Romance',
  'Work',
  'School',
  'Exercise',
  'Nearby',
] as const;

export function PersonalActivity({
  sample = false,
  latest,
  onClose,
  onSaved,
}: {
  sample?: boolean;
  latest?: string;
  onClose: () => void;
  onSaved: (text: string) => void;
}) {
  const [audience, setAudience] = useState<(typeof AUDIENCES)[number]>('Private');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const saving = useRef(false);
  const [circles, setCircles] = useState<CirclePreview[]>([]);
  const [circleId, setCircleId] = useState('');
  const [loading, setLoading] = useState(!sample);
  const pending = useRef<{ id: string; text: string; circleId: string; createdAt: string } | null>(
    null,
  );
  useEffect(() => {
    if (sample) return;
    let alive = true;
    void listCircles().then((result) => {
      if (!alive) return;
      if (result.ok) setCircles(result.data.circles);
      else setError('Could not load your circles. Close and try again.');
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [sample]);
  const matches = circles.filter(
    (circle) => (circle.kindTag || circle.name).trim().toLowerCase() === audience.toLowerCase(),
  );
  const target =
    matches.find((circle) => circle.id === circleId) ??
    (matches.length === 1 ? matches[0] : undefined);
  const available =
    sample || audience === 'Private' || (audience !== 'Nearby' && !!target?.connectedCount);
  async function save() {
    if (saving.current || !text.trim()) return;
    if (!available) return;
    saving.current = true;
    setBusy(true);
    try {
      if (!sample && (target || audience === 'Private')) {
        const value =
          audience === 'Private' ? text.trim() : `Amber Alert · ${audience}: ${text.trim()}`;
        const targetId = audience === 'Private' ? '' : target!.id;
        if (pending.current?.text !== value || pending.current.circleId !== targetId)
          pending.current = {
            id: randomUUID(),
            text: value,
            circleId: targetId,
            createdAt: new Date().toISOString(),
          };
        await sendAmberAlert(pending.current.id, value, targetId, pending.current.createdAt);
      }
      onSaved(
        audience === 'Private'
          ? `Private note: ${text.trim()}`
          : `Amber Alert · ${audience}: ${text.trim()}`,
      );
      onClose();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'Could not save your alert. Your draft is still here.',
      );
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => !busy && onClose()}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={[s.backdrop, { paddingBottom: 32 }]}
      >
        <View style={[s.glow, { height: 'auto', maxHeight: '90%', flexShrink: 1 }]}>
          <View style={[s.sheet, { flex: 0, flexShrink: 1 }]}>
            <View style={s.heading}>
              <Text style={s.title}>Your Amber Alert.</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close activity"
                disabled={busy}
                onPress={onClose}
                style={s.close}
              >
                <X color={cl.ink} />
              </Pressable>
            </View>
            <ScrollView
              style={{ flexGrow: 0, flexShrink: 1 }}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={[s.content, { paddingBottom: 20 }]}
            >
              {!!latest && <Text style={s.body}>Latest update: {latest}</Text>}
              <Text style={s.hint}>
                {sample
                  ? 'Preview only · nobody will be notified'
                  : audience === 'Private'
                    ? 'Only you and Amber. Nobody will be notified.'
                    : loading
                      ? 'Loading your saved circles…'
                      : audience === 'Nearby'
                        ? 'Nearby sharing needs location permissions and recipient opt-in. It is not available yet.'
                        : target
                          ? `${target.connectedCount} connected ${target.connectedCount === 1 ? 'person' : 'people'} in ${target.name} can see this alert.`
                          : matches.length > 1
                            ? 'Choose the saved circle for this alert.'
                            : `Add people to a ${audience} circle in Community to share an alert.`}
              </Text>
              <Text style={s.body}>Who can see this?</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {AUDIENCES.map((value) => (
                  <Pressable
                    key={value}
                    disabled={busy}
                    accessibilityRole="radio"
                    accessibilityLabel={value}
                    accessibilityState={{ checked: audience === value }}
                    onPress={() => {
                      setAudience(value);
                      setCircleId('');
                      setError('');
                    }}
                    style={[
                      s.notice,
                      {
                        flexBasis: '30%',
                        flexGrow: 1,
                        justifyContent: 'center',
                        paddingHorizontal: 8,
                        borderWidth: 1,
                        borderColor: audience === value ? cl.goldDeep : cl.cardHairline,
                      },
                    ]}
                  >
                    <Text style={[s.body, { textAlign: 'center' }]}>{value}</Text>
                  </Pressable>
                ))}
              </View>
              {matches.length > 1 &&
                matches.map((circle) => (
                  <Pressable
                    key={circle.id}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: target?.id === circle.id }}
                    onPress={() => setCircleId(circle.id)}
                    style={s.notice}
                  >
                    <Text style={s.body}>
                      {circle.name} · {circle.connectedCount} connected
                    </Text>
                  </Pressable>
                ))}
              <TextInput
                multiline
                editable={!busy}
                value={text}
                onChangeText={setText}
                maxLength={4000}
                accessibilityLabel="Your Amber Alert text"
                placeholder="What's happening with you?"
                style={[
                  s.body,
                  {
                    minHeight: 140,
                    padding: 16,
                    textAlignVertical: 'top',
                    borderWidth: 1,
                    borderColor: cl.cardHairline,
                    borderRadius: 18,
                  },
                ]}
              />
              {!!error && (
                <Text accessibilityRole="alert" style={s.body}>
                  {error}
                </Text>
              )}
              <Pressable
                accessibilityRole="button"
                disabled={busy || !text.trim() || !available}
                onPress={() => void save()}
                style={[s.confirm, { opacity: busy || !text.trim() || !available ? 0.5 : 1 }]}
              >
                {busy ? (
                  <ActivityIndicator color={cl.card} />
                ) : (
                  <Text style={s.confirmText}>
                    {audience === 'Private' ? 'Save private note' : 'Send Amber Alert'}
                  </Text>
                )}
              </Pressable>
            </ScrollView>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
