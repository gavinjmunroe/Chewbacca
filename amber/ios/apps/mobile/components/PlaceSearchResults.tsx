import { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, ScrollView, Text, TextInput, View, StyleSheet } from 'react-native';
import { ArrowUpRight, MapPin, Search } from 'lucide-react-native';
import { Pressable } from './Pressable';
import { useDiscoverySearch } from '../lib/useDiscoverySearch';
import { blankEventDraft } from '../lib/scheduleEdits';
import { ScheduleEditor, type EditorSubject } from './ScheduleEditor';
import { cl } from '../lib/classical';

type PlaceResult = { id:string; kind:'place'; name:string; address:string; city:string; summary:string; url:string; source:string };
export function PlaceSearchResults({ query, location = '', sample = false, onPlanSaved }: { query:string; location?:string; sample?:boolean; onPlanSaved?:()=>void }) {
  const [text,setText]=useState(query), [city,setCity]=useState(location);
  const {job,busy,error,setError,search}=useDiscoverySearch<PlaceResult>(sample);
  const [submitted,setSubmitted]=useState('');
  const [editor,setEditor]=useState<EditorSubject|null>(null);
  useEffect(()=>{
    if(location.trim().length<2)return;
    setSubmitted(location.trim());void search({query,scope:'plans',location:location.trim()});
  },[query,location,search]);
  const submit=()=>{setSubmitted(city.trim());void search({query:text.trim(),scope:'plans',location:city.trim()});};
  const open=(url:string)=>void Linking.openURL(url).catch(()=>setError('Could not open this link. Please try again.'));
  const planVisit=(place:PlaceResult)=>setEditor({kind:'event',id:null,creationKey:`place:${place.id}`,personName:'You',
    draft:{...blankEventDraft(new Date()),title:`Visit ${place.name}`.slice(0,200),place:place.address.slice(0,200),description:`${place.summary}\nSource: ${place.url}`}});
  return <View style={s.screen}>
    <View style={s.field}><Search color={cl.ink48} size={19}/><TextInput accessibilityLabel="Find places" style={s.input} value={text} onChangeText={setText} placeholder="Cafés, parks, places to meet…" maxLength={500} returnKeyType="search" onSubmitEditing={submit}/></View>
    <View style={s.field}><MapPin color={cl.goldDeep} size={19}/><TextInput accessibilityLabel="City and region" style={s.input} value={city} onChangeText={setCity} placeholder="City, state or country" maxLength={160} returnKeyType="search" onSubmitEditing={submit}/>
      <Pressable accessibilityRole="button" accessibilityLabel="Search places" onPress={submit} disabled={text.trim().length<2||city.trim().length<2} style={s.action}><ArrowUpRight color={cl.goldDeep} size={22}/></Pressable>
    </View>
    <Text style={s.caption}>{busy?`Finding places in ${submitted}…`:job?`${job.results?.length||0} places in ${submitted}`:'Choose a city to find a place for your next plan.'}</Text>
    {busy&&<ActivityIndicator color={cl.goldDeep}/>}
    {!!error&&<Text accessibilityRole="alert" style={s.caption}>{error}</Text>}
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={s.list}>
      {job?.results?.map(place=><View key={place.id} style={s.card}>
        <Pressable accessibilityRole="link" accessibilityLabel={`View ${place.name}`} onPress={()=>open(place.url)} style={{gap:9}}>
          <Text style={s.name}>{place.name}</Text><Text style={s.caption}>{place.address}</Text>
          {!!place.summary&&<Text numberOfLines={3} style={s.caption}>{place.summary}</Text>}
          <Text style={s.source}>{place.source} ↗</Text>
        </Pressable>
        <View style={{flexDirection:'row',gap:24,flexWrap:'wrap'}}>
          <Pressable accessibilityRole="link" accessibilityLabel={`Map for ${place.name}`} onPress={()=>open(`https://maps.apple.com/?q=${encodeURIComponent(place.name+' '+place.address)}`)} style={{minHeight:44,justifyContent:'center'}}><Text style={s.source}>Open in Maps</Text></Pressable>
          <Pressable accessibilityRole="button" onPress={()=>planVisit(place)} style={{minHeight:44,justifyContent:'center'}}><Text style={s.source}>Plan a visit</Text></Pressable>
        </View>
      </View>)}
      {job?.status==='complete'&&!job.results?.length&&<Text style={s.caption}>No matching places found. Try a broader description or another city.</Text>}
    </ScrollView>
    <ScheduleEditor subject={editor} onClose={()=>setEditor(null)} onSaved={()=>{setEditor(null);onPlanSaved?.();}}/>
  </View>;
}
const s = StyleSheet.create({
  screen:{flex:1,paddingHorizontal:24,gap:12},field:{flexDirection:'row',alignItems:'center',gap:10,paddingLeft:16,borderRadius:24,backgroundColor:cl.groundGold},
  input:{flex:1,minHeight:50,fontFamily:'Outfit_400Regular',fontSize:16,color:cl.ink,paddingRight:12},action:{minHeight:48,minWidth:48,alignItems:'center',justifyContent:'center'},
  caption:{fontFamily:'Outfit_400Regular',fontSize:14,lineHeight:21,color:cl.ink62},list:{paddingBottom:24},card:{gap:9,paddingVertical:20,borderBottomWidth:1,borderColor:cl.ruleFaint},
  date:{flexDirection:'row',alignItems:'center',gap:8},dateText:{fontFamily:'Outfit_500Medium',fontSize:13,color:cl.goldDeep},name:{fontFamily:'Newsreader_500Medium',fontSize:25,lineHeight:29,color:cl.ink},source:{fontFamily:'Outfit_500Medium',fontSize:13,color:cl.goldDeep},
});
