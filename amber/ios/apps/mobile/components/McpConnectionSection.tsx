import { useEffect, useRef, useState } from 'react';
import { Alert, AppState, StyleSheet, Text, TextInput, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Pressable } from './Pressable';
import { cl } from '../lib/classical';
import { config } from '../lib/config';
import { callMedhaId, errorCopy, unwrapOrThrow } from '../lib/medhaId';

type KeyRow = { id: string; name: string | null; prefix: string; last4: string; purpose?: string };
type IssuedKey = KeyRow & { key: string };
const url = config.medhaIdBaseUrl.replace(/\/+$/, '') + '/mcp';

export function McpConnectionSection() {
  const [keys, setKeys] = useState<KeyRow[]>([]);
  const [issued, setIssued] = useState<IssuedKey | null>(null);
  const [name, setName] = useState('My assistant');
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const locked = useRef(false);
  const alive = useRef(true);
  async function load() {
    const data = unwrapOrThrow(await callMedhaId<{ keys: KeyRow[] }>({ path: '/v1/me/api-keys', requireAuth: true }));
    if (alive.current) { setKeys(data.keys.filter(k => k.purpose === 'mcp' || k.prefix.startsWith('ambermcp_live_'))); setLoaded(true); }
  }
  useEffect(() => {
    alive.current = true;
    void load().catch(e => { if (alive.current) setError(errorCopy(e)); });
    const listener = AppState.addEventListener('change', state => { if (state !== 'active') setIssued(null); });
    return () => { alive.current = false; listener.remove(); };
  }, []);
  async function run(action: () => Promise<void>) {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError(''); setNotice('');
    try { await action(); } catch (e) { if (alive.current) setError(errorCopy(e)); }
    finally { locked.current = false; if (alive.current) setBusy(false); }
  }
  async function create() {
    await run(async () => {
      const row = unwrapOrThrow(await callMedhaId<IssuedKey>({
        path: '/v1/me/api-keys', method: 'POST', requireAuth: true, body: { name: name.trim() || 'My assistant', purpose: 'mcp' },
      }));
      if (alive.current) { setIssued(row); const { key: _secret, ...metadata } = row; setKeys(old => [metadata, ...old]); }
    });
  }
  async function revoke(row: KeyRow) {
    await run(async () => {
      unwrapOrThrow(await callMedhaId({ path: '/v1/me/api-keys/' + encodeURIComponent(row.id), method: 'DELETE', requireAuth: true }));
      if (alive.current) { setKeys(old => old.filter(k => k.id !== row.id)); if (issued?.id === row.id) setIssued(null); setNotice('Connection removed.'); }
    });
  }
  async function copy(value: string, message: string) {
    try { await Clipboard.setStringAsync(value); setNotice(message); }
    catch { setError('Could not copy. Please try again.'); }
  }
  return <View style={s.section}>
    <Text style={s.title}>Take Amber with you.</Text>
    <Text style={s.body}>Connect an assistant to your people and plans.</Text>
    <View style={s.card}>
      <Text style={s.caption}>MCP SERVER · STREAMABLE HTTP</Text>
      <Text selectable style={s.body}>{url}</Text>
      <Pressable accessibilityRole="button" style={s.action} onPress={() => void copy(url, 'Server URL copied.')}><Text style={s.link}>Copy server URL</Text></Pressable>
    </View>
    <Text style={s.body}>A connection key lets your assistant read your people and plans, add contacts, and save contact notes. Only connect an assistant you trust.</Text>
    <TextInput accessibilityLabel="Assistant name" value={name} onChangeText={setName} maxLength={120} placeholder="Assistant name" style={s.input} />
    <Pressable accessibilityRole="button" disabled={busy || !loaded || !!issued} style={[s.primary, (busy || !loaded || !!issued) && s.disabled]} onPress={() => {
      Alert.alert('Connect this assistant?', 'Anyone with this key can read your Amber people and plans and add contacts or contact notes. You can remove its access here.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Create key', onPress: () => void create() }]);
    }}><Text style={s.primaryText}>{busy ? 'Updating…' : 'Create connection key'}</Text></Pressable>
    {issued && <View style={s.card}>
      <Text style={s.body}>Your key is ready. Copy it now—it is shown only once.</Text>
      <Text style={s.caption}>Use it as Authorization: Bearer in your assistant’s private connection settings.</Text>
      <Pressable accessibilityRole="button" style={s.action} onPress={() => void copy(issued.key, 'Key copied. Paste it into your assistant’s private settings.')}><Text style={s.link}>Copy private key</Text></Pressable>
      <Pressable accessibilityRole="button" style={s.action} onPress={() => setIssued(null)}><Text style={s.link}>Done</Text></Pressable>
    </View>}
    {keys.map(row => <View key={row.id} style={s.connection}>
      <View style={{ flex: 1 }}><Text style={s.body}>{row.name || 'Assistant'}</Text><Text style={s.caption}>Key ending {row.last4}</Text></View>
      <Pressable accessibilityRole="button" accessibilityLabel={'Remove ' + (row.name || 'assistant')} disabled={busy} style={s.action} onPress={() => Alert.alert('Remove connection?', 'This assistant will lose access immediately.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Remove', style: 'destructive', onPress: () => void revoke(row) }])}><Text style={s.link}>Remove</Text></Pressable>
    </View>)}
    {!!error && <Text accessibilityRole="alert" style={s.body}>{error}</Text>}
    {!loaded && !!error && <Pressable accessibilityRole="button" style={s.action} onPress={() => void run(load)}><Text style={s.link}>Try again</Text></Pressable>}
    {!!notice && <Text accessibilityLiveRegion="polite" style={s.caption}>{notice}</Text>}
  </View>;
}
const s = StyleSheet.create({
  section: { gap: 14 }, title: { fontFamily: 'Newsreader_500Medium', fontSize: 30, lineHeight: 36, color: cl.ink },
  body: { fontFamily: 'Outfit_400Regular', fontSize: 15, lineHeight: 22, color: cl.ink },
  caption: { fontFamily: 'Outfit_400Regular', fontSize: 12, lineHeight: 18, color: cl.ink62 },
  link: { fontFamily: 'Outfit_500Medium', fontSize: 14, color: cl.goldDeep },
  card: { backgroundColor: cl.card, borderRadius: 22, padding: 18, gap: 8, borderWidth: 1, borderColor: cl.cardHairline },
  input: { fontFamily: 'Outfit_400Regular', fontSize: 16, color: cl.ink, minHeight: 50, borderWidth: 1, borderColor: cl.cardHairline, borderRadius: 16, paddingHorizontal: 16 },
  primary: { minHeight: 52, borderRadius: 26, backgroundColor: cl.ink, alignItems: 'center', justifyContent: 'center' },
  primaryText: { fontFamily: 'Outfit_500Medium', fontSize: 15, color: cl.card }, disabled: { opacity: 0.45 },
  action: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 4 },
  connection: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: cl.cardHairline },
});
