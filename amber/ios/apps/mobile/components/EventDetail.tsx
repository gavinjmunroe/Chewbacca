import { useEffect, useRef, useState } from 'react';
import { Linking, Modal, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowLeft, AudioLines, ChevronRight, Clock, MapPin, Navigation, X } from 'lucide-react-native';
import { Pressable } from './Pressable';
import { Avatar } from './Avatar';
import { CText } from './classical';
import { cl, clLayout } from '../lib/classical';
import { timeRange, type AgendaItem } from '../lib/agenda';
import { eventPeople, mapsLinks } from '../lib/eventDetail';

export function EventDetail({ item, onClose, onAddMemo, onOpenPerson }: {
  item: AgendaItem | null; onClose: () => void; onAddMemo?: () => void;
  onOpenPerson?: (contactId: string) => void;
}) {
  const insets = useSafeAreaInsets();
  const [leaving, setLeaving] = useState(false);
  const [locationOpen, setLocationOpen] = useState(false);
  const [error, setError] = useState('');
  const next = useRef<(() => void) | null>(null);
  useEffect(() => { setLocationOpen(false); setError(''); }, [item?.key]);
  const leaveFor = (action: () => void) => { next.current = action; setLeaving(true); };
  const place = item?.location && !/^https?:/i.test(item.location.trim()) ? item.location : null;
  const people = eventPeople(item);
  const day = item ? new Date(item.startsAt).toLocaleDateString(undefined, {
    weekday: 'long', month: 'long', day: 'numeric',
  }) : '';
  const open = (url: string) => void Linking.openURL(url).catch(() => setError('Could not open this link. Please try again.'));
  const memo = onAddMemo ? (
    <Pressable accessibilityRole="button" accessibilityLabel="Add voice memo to this plan"
      onPress={() => leaveFor(onAddMemo)} style={{ flexDirection:'row', alignItems:'center', gap:10,
        alignSelf:'flex-start', minHeight:48, paddingHorizontal:18, borderRadius:24, borderWidth:1, borderColor:cl.ruleFaint }}>
      <AudioLines size={19} color={cl.goldDeep}/><CText t="body" color={cl.goldDeep}>Add voice memo</CText>
    </Pressable>
  ) : null;
  return <Modal visible={!!item && !leaving} transparent animationType="fade" presentationStyle="overFullScreen"
    onRequestClose={onClose} onDismiss={() => { const action=next.current; next.current=null; setLeaving(false); action?.(); }}>
    <View style={{flex:1,backgroundColor:cl.groundCream,paddingTop:insets.top}}>
      <View style={{paddingHorizontal:clLayout.textGutter,paddingVertical:16,flexDirection:'row',justifyContent:'space-between',alignItems:'center'}}>
        <Pressable accessibilityRole="button" accessibilityLabel={locationOpen ? 'Back to plan' : 'Close plan'}
          onPress={() => locationOpen ? setLocationOpen(false) : onClose()} style={{minHeight:44,minWidth:44,justifyContent:'center'}}>
          {locationOpen ? <ArrowLeft color={cl.ink}/> : <X color={cl.ink}/>}
        </Pressable>
        <CText t="kicker" color={cl.ink48}>{locationOpen ? 'LOCATION' : 'YOUR PLAN'}</CText>
      </View>
      <ScrollView contentContainerStyle={{paddingHorizontal:clLayout.textGutter,paddingBottom:insets.bottom+32,gap:24}}>
        {locationOpen && place ? <>
          <View style={{backgroundColor:cl.groundGold,borderRadius:24,padding:28,gap:16}}>
            <MapPin size={36} color={cl.goldDeep}/><CText t="heroName" style={{fontSize:30,lineHeight:36}}>{place}</CText>
            <CText t="metaSm" color={cl.ink48}>{item?.title} · {day}</CText>
          </View>
          <CText t="body">The location saved on this plan. Add a voice memo with meeting points, access instructions, or details to remember.</CText>
          <View style={{flexDirection:'row',gap:20}}>
            <Pressable accessibilityRole="button" onPress={() => open(mapsLinks(place).map)} style={{paddingVertical:12}}><CText t="body" color={cl.goldDeep}>View in Maps</CText></Pressable>
            <Pressable accessibilityRole="button" onPress={() => open(mapsLinks(place).directions)} style={{paddingVertical:12,flexDirection:'row',gap:8}}><Navigation size={18} color={cl.goldDeep}/><CText t="body" color={cl.goldDeep}>Directions</CText></Pressable>
          </View>
          {memo}
        </> : <>
          <View style={{backgroundColor:cl.groundGold,borderRadius:24,padding:22,gap:20}}>
            <CText t="heroName" style={{fontSize:32,lineHeight:38}}>{item?.title || ''}</CText>
            <View style={{flexDirection:'row',gap:12,alignItems:'center'}}><Clock size={19} color={cl.goldDeep}/><View><CText t="body">{day}</CText><CText t="metaSm" color={cl.ink48}>{item ? timeRange(item) : ''}</CText></View></View>
            {!!place && <Pressable accessibilityRole="button" accessibilityLabel={`Open location: ${place}`} onPress={() => setLocationOpen(true)} style={{flexDirection:'row',alignItems:'center',gap:12,minHeight:48}}>
              <MapPin size={20} color={cl.goldDeep}/><View style={{flex:1}}><CText t="body">{place}</CText><CText t="metaSm" color={cl.ink48}>Location and directions</CText></View><ChevronRight size={18} color={cl.ink48}/>
            </Pressable>}
            {!!item?.meetingUrl && /^https:\/\//i.test(item.meetingUrl) && <Pressable accessibilityRole="link" onPress={() => open(item.meetingUrl!)} style={{paddingVertical:12}}><CText t="body" color={cl.goldDeep}>Join meeting ↗</CText></Pressable>}
            {memo}
          </View>
          <View style={{gap:12}}>
            <CText t="kicker" color={cl.ink48}>PEOPLE</CText>
            {!people.length && <CText t="body">You</CText>}
            {people.map(person => <Pressable key={person.contactId || person.name} accessibilityRole="button"
              accessibilityLabel={`Open ${person.name}`} disabled={!person.contactId || !onOpenPerson}
              onPress={() => leaveFor(() => { onClose(); onOpenPerson?.(person.contactId!); })}
              style={{flexDirection:'row',alignItems:'center',gap:12,paddingVertical:12}}>
              <Avatar name={person.name || ''} size={40}/><View style={{flex:1}}><CText t="body">{person.name}</CText>
              <CText t="metaSm" color={cl.ink48}>{person.contactId ? 'View person and add a voice memo' : 'From this event'}</CText></View>
              {!!person.contactId && !!onOpenPerson && <ChevronRight size={18} color={cl.ink48}/>}
            </Pressable>)}
          </View>
          <CText t="metaXs" color={cl.ink48}>{item?.provider === 'google' ? 'Google Calendar' : item?.source === 'device' ? 'Apple Calendar' : 'Saved in Amber'}</CText>
        </>}
        {!!error && <CText t="body" color={cl.goldDeep}>{error}</CText>}
      </ScrollView>
    </View>
  </Modal>;
}
