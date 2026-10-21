import { useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { getMailAccounts, syncMail, mailSyncMessage, type MailAccount } from '../lib/mail';
import { requestStyles as s } from './RequestReview';
/** Calendar and Gmail share a grant, but report their sync results separately. */
export function GoogleMailStatus({ onSynced }: { onSynced?: () => void }) {
  const [accounts, setAccounts] = useState<MailAccount[]>([]);
  const [message, setMessage] = useState('Checking Gmail…');
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const alive = useRef(true);
  async function refresh() {
    const result = await getMailAccounts();
    if (!alive.current) return;
    if (!result.ok || !Array.isArray(result.data.accounts)) {
      setMessage('Gmail status could not load. Tap sync to retry.'); return;
    }
    setAccounts(result.data.accounts);
    setMessage(result.data.accounts.length ? '' : 'Connect Google with Gmail access to import relationship activity.');
  }
  useEffect(() => { alive.current = true; void refresh(); return () => { alive.current = false; }; }, []);
  async function sync() {
    if (lock.current) return;
    lock.current = true; setBusy(true); setMessage('Syncing Gmail relationship activity…');
    try {
      const result = await syncMail();
      if (!alive.current) return;
      await refresh();
      if (!alive.current) return;
      setMessage(result.ok ? mailSyncMessage(result.data) : 'Gmail could not sync. Check your connection or reconnect Google.');
      if (result.ok) onSynced?.();
    } catch {
      if (alive.current) setMessage('Gmail could not sync. Please retry.');
    } finally { lock.current = false; if (alive.current) setBusy(false); }
  }
  return <View style={{ gap: 12 }}>
    <Text style={s.label}>GMAIL ACTIVITY</Text>
    <Text style={s.hint}>Sync message headers to update relationship frequency. Message bodies are not imported by this sync.</Text>
    {accounts.map(account => <View key={account.accountId}>
      <Text style={s.body}>{account.email || 'Google account'}</Text>
      <Text style={s.hint}>{account.lastError ? 'Needs attention — reconnect Google with Gmail access.' : account.lastSyncedAt ? `Last synced ${new Date(account.lastSyncedAt).toLocaleString()}` : 'Not synced yet'}</Text>
    </View>)}
    <Pressable accessibilityRole="button" disabled={busy} onPress={() => void sync()} style={s.notice}>
      <Text style={s.body}>{busy ? 'Syncing Gmail…' : 'Sync Gmail'}</Text>
    </Pressable>
    {!!message && <Text accessibilityLiveRegion="polite" style={s.hint}>{message}</Text>}
  </View>;
}
