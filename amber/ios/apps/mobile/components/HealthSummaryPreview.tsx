import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { randomUUID } from 'expo-crypto';
import { readHealthSummary, type HealthSummary } from '../lib/applePermissions';
import { callMedhaId } from '../lib/medhaId';
import { cl } from '../lib/classical';
export function HealthSummaryPreview() {
  const [summary, setSummary] = useState<HealthSummary>();
  const [requestId, setRequestId] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [saved, setSaved] = useState(false);
  async function preview() {
    setBusy(true);
    setMessage('');
    setSaved(false);
    try {
      setSummary(await readHealthSummary());
      setRequestId(randomUUID());
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Health could not load.');
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    if (!summary || busy) return;
    setBusy(true);
    setMessage('');
    try {
      const result = await callMedhaId<{ ok: boolean }>({
        path: '/v1/me/health-summary',
        method: 'POST',
        body: { ...summary, requestId, consent: true },
        requireAuth: true,
        retries: 0,
      });
      if (!result.ok || !result.data.ok)
        throw Error('Save was not confirmed. Your preview is still here; retry safely.');
      setSaved(true);
      setMessage('Saved privately to Amber.');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  }
  const hasData = summary && (summary.steps != null || summary.workoutMinutes != null);
  return (
    <View style={{ gap: 8 }}>
      <Pressable
        accessibilityRole="button"
        disabled={busy}
        onPress={() => void preview()}
        style={{ minHeight: 44, justifyContent: 'center' }}
      >
        <Text style={{ color: cl.goldDeep }}>{busy ? 'Working…' : 'Preview today’s activity'}</Text>
      </Pressable>
      {summary && (
        <Text style={{ color: cl.ink62 }}>
          {hasData
            ? [
                summary.steps != null ? `${summary.steps.toLocaleString()} steps` : '',
                summary.workoutMinutes != null ? `${summary.workoutMinutes} workout minutes` : '',
              ]
                .filter(Boolean)
                .join(' · ')
            : 'No readable activity. Health may have no data, or access may be off.'}
        </Text>
      )}
      {!!hasData && !saved && (
        <>
          <Text style={{ color: cl.ink62, fontSize: 12 }}>
            Save this activity summary to your private Amber ID for personal wellness context. This
            does not change anyone’s contact card or share activity with other people.
          </Text>
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={() => void save()}
            style={{ minHeight: 44, justifyContent: 'center' }}
          >
            <Text style={{ color: cl.goldDeep }}>Save privately to Amber</Text>
          </Pressable>
        </>
      )}
      {!!message && (
        <Text accessibilityLiveRegion="polite" style={{ color: cl.ink62 }}>
          {message}
        </Text>
      )}
    </View>
  );
}
