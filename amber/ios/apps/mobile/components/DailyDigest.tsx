import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { ArrowUp, Bookmark, ChevronRight, Sparkles } from 'lucide-react-native';
import { cl } from '../lib/classical';

const examples = [
  { id: 'gather', title: 'Find a reason to get together', people: 'Your nearby people', topic: 'community local events friends', detail: 'A local event that overlaps with a shared interest.', action: 'Explore the connection' },
  { id: 'reconnect', title: 'Make room for a reconnection', people: 'Someone you want to see more', topic: 'coffee reconnect friends people', detail: 'An opportunity to turn a shared update into time together.', action: 'See why it fits' },
];
/** Search-led digest UI. Examples are explicitly fictional; no external search is simulated as live. */
export function DailyDigest({ day, query, sample = false }: { day: Date; query: string; sample?: boolean }) {
  const [followup, setFollowup] = useState('');
  const [refinements, setRefinements] = useState<string[]>([]);
  const [saved, setSaved] = useState<string[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showExamples, setShowExamples] = useState(sample);
  const terms = [query, ...refinements].map(value => value.trim().toLowerCase()).filter(Boolean);
  const results = examples.filter(item => terms.every(term => `${item.title} ${item.topic} ${item.detail}`.toLowerCase().includes(term)));
  const submit = () => { if (followup.trim()) { setRefinements(values => [...values, followup.trim()]); setFollowup(''); } };
  return <View style={{ flex: 1 }}><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={s.content}>
    <View style={s.line}><Sparkles size={16} color={cl.goldDeep} /><Text style={s.eyebrow}>DAILY DIGEST · WEB</Text></View>
    <Text accessibilityRole="header" style={s.heading}>{query.trim() || 'What could this day bring?'}</Text>
    <Text style={s.context}>{showExamples ? 'Explore how Amber could connect an opportunity to your people, with a reason to act.' : 'Search for opportunities around your people and interests.'}</Text>
    <Text style={s.note}>Web search is not connected. {showExamples ? 'Illustrative cards below are not real findings.' : 'No sources have been scanned or results generated.'}</Text>
    {!showExamples && <Pressable accessibilityRole="button" onPress={() => setShowExamples(true)} style={s.chip}><Text style={s.link}>Preview example results</Text></Pressable>}
    {showExamples && results.map(item => <View key={item.id} style={s.card}>
      <View style={s.line}><Text style={[s.eyebrow, { flex: 1 }]}>EXAMPLE OPPORTUNITY</Text><Pressable accessibilityRole="button" accessibilityLabel={`${saved.includes(item.id) ? 'Unsave' : 'Save'} example opportunity`} onPress={() => setSaved(values => values.includes(item.id) ? values.filter(value => value !== item.id) : [...values, item.id])} style={s.icon}><Bookmark size={19} color={cl.goldDeep} fill={saved.includes(item.id) ? cl.goldDeep : 'transparent'} /></Pressable></View>
      <Text style={s.cardTitle}>{item.title}</Text><Text style={s.context}>{item.detail}</Text>
      <View style={s.line}><View style={s.avatar}><Text style={s.initial}>a</Text></View><Text style={[s.note, { flex: 1 }]}>{item.people}</Text></View>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: expanded === item.id }} onPress={() => setExpanded(value => value === item.id ? null : item.id)} style={s.line}><Text style={[s.link, { flex: 1, paddingVertical: 12 }]}>{item.action}</Text><ChevronRight size={17} color={cl.goldDeep} /></Pressable>
      {expanded === item.id && <Text style={s.note}>A connected result will show the source, publication date, people involved, and the reason it is relevant on {day.toLocaleDateString()}. This example has no verified event, score, or availability.{saved.includes(item.id) ? ' Saved in this preview only.' : ''}</Text>}
    </View>)}
    {showExamples && !results.length && <Text style={s.context}>No example cards match. Try “community” or clear your filters. Live research will answer the full request once connected.</Text>}
    {refinements.length > 0 && <Pressable accessibilityRole="button" onPress={() => setRefinements([])} style={s.chip}><Text style={s.link}>Clear refinements · {refinements.join(' · ')}</Text></Pressable>}
  </ScrollView><View style={s.composer}><TextInput accessibilityLabel="Follow up on daily opportunities" value={followup} onChangeText={setFollowup} placeholder="Ask a follow-up…" placeholderTextColor={cl.ink62} returnKeyType="search" onSubmitEditing={submit} style={s.input} /><Pressable accessibilityRole="button" accessibilityLabel="Refine daily opportunities" disabled={!followup.trim()} onPress={submit} style={[s.icon, { opacity: followup.trim() ? 1 : .35 }]}><ArrowUp size={21} color={cl.ink} /></Pressable></View><Text style={[s.note, { fontSize: 10, paddingBottom: 8 }]}>Preview filters only · nothing sent or scheduled</Text></View>;
}
const s = StyleSheet.create({ content: { gap: 16, paddingTop: 20, paddingBottom: 24 }, line: { flexDirection: 'row', gap: 10, alignItems: 'center' }, eyebrow: { fontFamily: 'Outfit_500Medium', fontSize: 10, letterSpacing: 1, color: cl.goldDeep }, heading: { fontFamily: 'Newsreader_400Regular', fontSize: 30, color: cl.ink }, context: { fontFamily: 'Outfit_400Regular', fontSize: 15, lineHeight: 22, color: cl.ink70 }, note: { fontFamily: 'Outfit_400Regular', fontSize: 12, lineHeight: 18, color: cl.ink62 }, card: { padding: 18, gap: 12, borderRadius: 26, borderWidth: 1, borderColor: cl.cardHairline, backgroundColor: cl.card }, cardTitle: { fontFamily: 'Newsreader_500Medium', fontSize: 25, color: cl.ink }, icon: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }, avatar: { width: 32, height: 32, borderRadius: 16, backgroundColor: cl.groundGold, alignItems: 'center', justifyContent: 'center' }, initial: { fontFamily: 'Newsreader_500Medium', fontSize: 22, color: cl.goldDeep }, link: { fontFamily: 'Outfit_500Medium', fontSize: 13, color: cl.goldDeep }, chip: { minHeight: 44, justifyContent: 'center' }, composer: { flexDirection: 'row', alignItems: 'center', borderRadius: 28, borderWidth: 1, borderColor: cl.cardHairline, paddingLeft: 16, marginBottom: 8 }, input: { flex: 1, minHeight: 54, fontFamily: 'Outfit_400Regular', color: cl.ink } });
