import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { getContactProvenance, type ContactProvenance as Provenance } from '../lib/contactProvenance';
import { requestStyles as s } from './RequestReview';
/** Fetch only when Sources is opened, so it never delays opening the card. */
export function ContactProvenance({ contactId }: { contactId: string }) {
  const [value, setValue] = useState<Provenance | null>(null);
  const [message, setMessage] = useState('Loading source records…');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let current = true;
    setValue(null); setMessage('Loading source records…');
    void getContactProvenance(contactId).then(result => {
      if (!current) return;
      if (!result.ok || result.data.contactId !== contactId || !Array.isArray(result.data.sources)) {
        setMessage('Source records could not load. Tap to retry.'); return;
      }
      setValue(result.data); setMessage('');
    }).catch(() => { if (current) setMessage('Source records could not load. Tap to retry.'); });
    return () => { current = false; };
  }, [contactId, retry]);
  return <View style={{ gap: 14 }}>
    {!!message && <Pressable onPress={() => setRetry(n => n + 1)} accessibilityRole="button"><Text style={s.hint}>{message}</Text></Pressable>}
    {!!value?.summary && <Text style={s.body}>{value.summary}</Text>}
    {value?.sources.map((source, index) => <View key={`${source.source}-${index}`} style={{ gap: 6 }}>
      <Text style={s.label}>{source.source.replace(/_/g, ' ').toUpperCase()}</Text>
      {[source.contributed.name, source.contributed.company, ...source.contributed.emails, ...source.contributed.phones].filter(Boolean).map((text, i) => <Text selectable key={i} style={s.body}>{text}</Text>)}
      <Text style={s.hint}>From {source.trustLabel}</Text>
    </View>)}
    {value?.fields?.map(field => <Text key={field.field} style={s.hint}>{field.field.replace(/_/g, ' ')} · {field.source.replace(/_/g, ' ')}</Text>)}
  </View>;
}
