import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { getCalendarAccounts, type CalendarAccount } from '../lib/calendarAccounts';
import { requestStyles as s } from './MemoStyles';
import { cl } from '../lib/classical';
export function GoogleCalendarDestination({
  value,
  onChange,
  disabled,
}: {
  value?: string;
  onChange: (id: string) => void;
  disabled: boolean;
}) {
  const [accounts, setAccounts] = useState<CalendarAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError('');
    getCalendarAccounts()
      .then((result) => {
        if (!alive) return;
        if (!result.ok) throw new Error('unavailable');
        setAccounts(result.data.accounts.filter((a) => a.provider === 'google'));
      })
      .catch(() => {
        if (alive) setError('Could not load Google accounts. Tap to retry.');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [revision]);
  return (
    <View style={{ gap: 8 }}>
      <Text style={s.label}>GOOGLE CALENDAR</Text>
      {loading ? (
        <ActivityIndicator color={cl.goldDeep} />
      ) : error ? (
        <Pressable disabled={disabled} onPress={() => setRevision((v) => v + 1)}>
          <Text style={s.hint}>{error}</Text>
        </Pressable>
      ) : accounts.length ? (
        accounts.map((account) => (
          <Pressable
            key={account.id}
            accessibilityRole="radio"
            accessibilityState={{ checked: value === account.id, disabled }}
            disabled={disabled}
            onPress={() => onChange(account.id)}
            style={[s.input, { borderColor: value === account.id ? cl.goldDeep : '#e8e5e0' }]}
          >
            <Text style={s.body}>
              {value === account.id ? '✓ ' : ''}
              {account.accountEmail}
            </Text>
            <Text style={s.hint}>Primary calendar</Text>
          </Pressable>
        ))
      ) : (
        <Text style={s.hint}>
          Google export needs a connected account. Your memo stays saved in Amber; account setup is
          not available on this screen.
        </Text>
      )}
      <Text style={s.hint}>
        Creates an event in your selected Google calendar and syncs it to Amber. No guests are
        invited.
      </Text>
    </View>
  );
}
