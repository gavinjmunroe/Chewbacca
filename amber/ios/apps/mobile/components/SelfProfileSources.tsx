import { useEffect, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { AudioLines, ChevronRight } from 'lucide-react-native';
import { Pressable } from './Pressable';
import { fetchConnections } from '../lib/api';
import { getContactsSummary } from '../lib/enrichment';
import { listJournalHistory } from '../lib/journalHistory';
import type { ConversationSummary } from '../lib/conversations';
import { cl } from '../lib/classical';

/** Account data is separate from the provenance of any individual contact. */
export function SelfProfileSources({ onMemo }: { onMemo: (id: string) => void }) {
  const [rows, setRows] = useState<{label:string; detail:string}[]>([]);
  const [memos, setMemos] = useState<ConversationSummary[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let current = true;
    setBusy(true);setError('');
    void Promise.allSettled([getContactsSummary(), fetchConnections(), listJournalHistory({})]).then(([contacts, connections, journal]) => {
      if (!current) return;
      const next: {label:string; detail:string}[] = [];
      const labelFor = (source:string) => /apple|ios|phone_contacts/.test(source) ? 'Apple Contacts' : /google|gmail/.test(source) ? 'Google' : /amber/.test(source) ? 'Amber' : source.replace(/_/g,' ').replace(/\b\w/g, v=>v.toUpperCase());
      const c = contacts.status === 'fulfilled' && contacts.value.ok ? contacts.value.data : null;
      const providers = connections.status === 'fulfilled' && connections.value.ok ? connections.value.data : null;
      const history = journal.status === 'fulfilled' && journal.value.ok ? journal.value.data : null;
      for (const [source, count] of Object.entries(c?.bySource || {})) {
        if (count > 0) next.push({ label: labelFor(source), detail: `${count.toLocaleString()} ${count === 1 ? 'person' : 'people'} in your network` });
      }
      for (const connection of Object.values(providers || {})) {
        if (!connection.connected) continue;
        const label=labelFor(connection.platform), existing=next.find(row=>row.label===label);
        const status=connection.needsScopeUpgrade ? 'Additional access needed' : 'Connected';
        if(existing) existing.detail += ` · ${status}`;
        else next.push({label,detail:status});
      }
      if (history?.conversations.length) next.push({ label:'Voice memos', detail:`${history.conversations.length}${history.next ? '+' : ''} saved recordings` });
      setRows(next);setMemos(history?.conversations.slice(0,3) || []);
      if (!c || !providers || !history) setError('Some sources could not refresh. Tap to retry.');
      setBusy(false);
    });
    return () => {current = false;};
  }, [retry]);
  const body = {fontFamily:'Outfit_400Regular',fontSize:16,lineHeight:23,color:cl.ink} as const;
  const caption = {...body,fontSize:14,lineHeight:21,color:cl.ink62};
  return <View style={{gap:20}}>
    <Text style={caption}>Data saved to your Amber account. Imported contacts stay on their own cards.</Text>
    {busy && <ActivityIndicator color={cl.goldDeep}/>}
    {rows.map((row,index)=><View key={`${row.label}:${index}`} style={{gap:5,paddingVertical:12,borderBottomWidth:1,borderColor:cl.ruleFaint}}><Text style={body}>{row.label}</Text><Text style={caption}>{row.detail}</Text></View>)}
    {!busy && !rows.length && !error && <Text style={body}>No imported sources yet.</Text>}
    {memos.map(memo=><Pressable key={memo.conversationId} accessibilityRole="button" accessibilityLabel={`Open memo ${memo.title}`} onPress={()=>onMemo(memo.conversationId)} style={{flexDirection:'row',gap:12,alignItems:'center',minHeight:48}}><AudioLines size={20} color={cl.goldDeep}/><Text numberOfLines={2} style={[body,{flex:1}]}>{memo.title}</Text><ChevronRight size={18} color={cl.ink62}/></Pressable>)}
    <Text style={caption}>Photo access does not import your library. Amber does not import your Apple Messages history.</Text>
    {!!error && <Pressable accessibilityRole="button" onPress={()=>setRetry(v=>v+1)}><Text accessibilityRole="alert" style={caption}>{error}</Text></Pressable>}
  </View>;
}
