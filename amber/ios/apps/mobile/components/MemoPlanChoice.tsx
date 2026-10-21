import { useRef, useState } from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';
import { callMedhaId } from '../lib/medhaId';
import type { ReviewRequest } from '../lib/memoActions';
import { requestStyles as s } from './MemoStyles';
import { cl } from '../lib/classical';
import { selectMemoPlan, type SavedMemoPlan as Plan } from '../lib/memoPlanSelection';
export function MemoPlanChoice({
  request,
  onChange,
  disabled,
  sample,
}: {
  request: ReviewRequest;
  onChange: (patch: Partial<ReviewRequest>) => void;
  disabled: boolean;
  sample: boolean;
}) {
  const original = useRef(request);
  const [query, setQuery] = useState(request.title);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [searched, setSearched] = useState(false);
  async function search() {
    if (busy || disabled) return;
    if (sample) {
      setError('Sign in to choose a saved plan.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const result = await callMedhaId<{ plans: Plan[] }>({
        path: `/v1/me/memo-plans?q=${encodeURIComponent(query.trim())}`,
        requireAuth: true,
        retries: 0,
      });
      if (!result.ok) throw Error('unavailable');
      setPlans(result.data.plans);
      setSearched(true);
    } catch {
      setError('Could not load saved plans. Your draft is safe.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <View style={{ gap: 10 }}>
      <Text style={s.label}>NEW PLAN OR UPDATE?</Text>
      <Pressable
        disabled={disabled}
        accessibilityRole="radio"
        accessibilityState={{ checked: request.planChoice === 'new' }}
        style={s.row}
        onPress={() =>
          onChange({
            ...original.current,
            planChoice: 'new',
            planId: undefined,
            planVersion: undefined,
            planDestination: undefined,
          })
        }
      >
        <Text style={s.body}>Create a new plan</Text>
      </Pressable>
      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
        <TextInput
          accessibilityLabel="Find an existing plan"
          placeholder="Find an existing plan"
          value={query}
          maxLength={200}
          onChangeText={setQuery}
          onSubmitEditing={() => void search()}
          style={[s.input, { flex: 1 }]}
        />
        <Pressable
          accessibilityRole="button"
          disabled={disabled || busy}
          onPress={() => void search()}
          style={{ padding: 12 }}
        >
          {busy ? <ActivityIndicator color={cl.goldDeep} /> : <Text style={s.hint}>Find</Text>}
        </Pressable>
      </View>
      {!!error && (
        <Text accessibilityRole="alert" style={s.hint}>
          {error}
        </Text>
      )}
      {searched && !plans.length && <Text style={s.hint}>No matching saved plans.</Text>}
      {plans.map((plan) => (
        <Pressable
          key={plan.id}
          disabled={disabled}
          accessibilityRole="radio"
          accessibilityState={{ checked: request.planId === plan.id }}
          style={[
            s.notice,
            {
              borderWidth: 1,
              borderColor: request.planId === plan.id ? cl.goldDeep : cl.cardHairline,
            },
          ]}
          onPress={() => onChange(selectMemoPlan(original.current, plan))}
        >
          <View style={{ gap: 4 }}>
            <Text style={s.body}>{plan.title}</Text>
            <Text style={s.hint}>
              {new Date(plan.startsAt).toLocaleString()} ·{' '}
              {plan.provider === 'google' ? 'Google Calendar' : 'Amber'}
            </Text>
            {!!plan.place && <Text style={s.hint}>{plan.place}</Text>}
          </View>
        </Pressable>
      ))}
      {request.planId && (
        <Text style={s.hint}>Updating this saved plan. Review the time and place below.</Text>
      )}
    </View>
  );
}
