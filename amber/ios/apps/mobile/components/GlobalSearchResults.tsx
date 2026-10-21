import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, ScrollView, Text, TextInput, View, StyleSheet } from 'react-native';
import { ArrowLeft, ChevronRight, Check, Search, UserPlus } from 'lucide-react-native';
import { useDiscoverySearch } from '../lib/useDiscoverySearch';
import { Pressable } from './Pressable';
import { Avatar } from './Avatar';
import { ClayContactActions } from './ClayContactActions';
import { callMedhaId } from '../lib/medhaId';
import { saveToAppleContacts, chooseAppleContact } from '../lib/appleContactWrite';
import { type ContactExport } from '../lib/contactExport';
import { syncAppleContactById } from '../lib/contactsSync';
import { bustContactsCache } from '../lib/network';
import { cl } from '../lib/classical';
type Person=ContactExport & {id:string; location?:string; summary?:string; url?:string; source?:string};
export function GlobalSearchResults({query,sample=false}:{query:string;sample?:boolean}) {
  const [selected,setSelected]=useState<string|null>(null);
  const [text,setText]=useState(query);
  const {job,busy,error,setError,search:runSearch}=useDiscoverySearch<Person>(sample);
  const [people,setPeople]=useState<Person[]>([]);
  const [saved,setSaved]=useState<Record<string,{id:string;apple:boolean;message?:string}>>({});
  const [saving,setSaving]=useState('');const saveLock=useRef(false);
  const enrichments=useRef(new Map<string,string[]>());
  const search=()=>{setSelected(null);void runSearch({query:text.trim(),scope:'people'});};
  useEffect(()=>{setPeople(job?.results || []);},[job]);
  useEffect(()=>{void runSearch({query,scope:'people'});},[query,runSearch]);
  async function add(person:Person) {
    if(!job || saveLock.current)return;saveLock.current=true;setSaving(person.id);setError('');
    let contactId=saved[person.id]?.id;
    try {
      const existing=await chooseAppleContact(person,true);
      if(existing) {
        const sync=await syncAppleContactById(existing.id);
        if(!sync.ok || sync.failed)throw Error('Could not sync the existing Apple card. Retry before adding.');
      }
      if(!contactId){const res=await callMedhaId<{contactId:string}>({path:`/v1/me/discovery/jobs/${job.id}/people/${person.id}/save`,method:'POST',requireAuth:true,retries:0,body:existing?{appleExternalId:existing.id}:{}});
        if(!res.ok)throw Error(res.message || 'Could not save to People. Please retry.');contactId=res.data.contactId;
        setSaved(v=>({...v,[person.id]:{id:contactId!,apple:false}}));bustContactsCache();}
      for(const id of enrichments.current.get(person.id) || []) {
        const res=await callMedhaId({path:`/v1/me/clay/jobs/${id}/apply`,method:'POST',requireAuth:true,retries:0,body:{contactId}});
        if(!res.ok)throw Error('Person saved. A Clay detail could not be attached; retry to finish.');
      }
      await saveToAppleContacts(person,existing?.id);
      bustContactsCache();
      setSaved(v=>({...v,[person.id]:{id:contactId!,apple:true}}));
    }catch(e){setError(e instanceof Error?e.message:'Could not finish saving.');}
    finally{saveLock.current=false;setSaving('');}
  }
  const person=people.find(p=>p.id===selected);
  const enriched=(person:Person,fields:Partial<ContactExport>,id:string)=>{
    setSaved(v=>v[person.id]?{...v,[person.id]:{...v[person.id],apple:false}}:v);
    const ids=enrichments.current.get(person.id) || [];if(!ids.includes(id))ids.push(id);enrichments.current.set(person.id,ids);
    setPeople(v=>v.map(p=>p.id===person.id?{...p,...Object.fromEntries(Object.entries(fields).filter(([,value])=>!!value))}:p));
  };
  return <View style={ui.screen}>
    {person ? <>
      <Pressable accessibilityRole="button" accessibilityLabel="Back to search results" onPress={()=>setSelected(null)} style={ui.back}>
        <ArrowLeft size={18} color={cl.ink62}/><Text style={ui.caption}>Search results</Text>
      </Pressable>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={ui.detail}>
        <Avatar name={person.name} size={72}/>
        <View style={{gap:8}}><Text style={ui.name}>{person.name}</Text>
          {!!(person.title || person.company) && <Text style={ui.body}>{[person.title,person.company].filter(Boolean).join(' · ')}</Text>}
          {!!person.location && <Text style={ui.caption}>{person.location}</Text>}
        </View>
        {!!person.summary && <Text numberOfLines={4} style={ui.caption}>{person.summary}</Text>}
        {!!person.linkedin && <Pressable accessibilityRole="link" onPress={()=>void Linking.openURL(person.linkedin!).catch(()=>setError('Could not open LinkedIn.'))} style={ui.source}><Text style={ui.link}>View LinkedIn ↗</Text></Pressable>}
        <ClayContactActions key={`${job?.id}:${person.id}`} person={person} searchId={job?.id} onExistingDetails={fields=>setPeople(v=>v.map(p=>p.id===person.id?{...p,...fields,name:p.name,id:p.id}:p))} onResult={(fields,id)=>enriched(person,fields,id)}/>
      </ScrollView>
      <View style={ui.footer}>
        {!!error && <Text accessibilityRole="alert" style={ui.caption}>{error}</Text>}
        <Pressable accessibilityRole="button" disabled={!!saving || !!saved[person.id]?.apple} onPress={()=>void add(person)} style={[ui.add,{opacity:saving?0.6:1}]}>
          {saving===person.id?<ActivityIndicator color={cl.card}/>:saved[person.id]?.apple?<Check color={cl.card} size={20}/>:<UserPlus color={cl.card} size={20}/>}
          <Text style={ui.addText}>{saving===person.id?'Saving contact…':saved[person.id]?.apple?'Added to your people':saved[person.id]?'Finish saving to Contacts':'Save contact'}</Text>
        </Pressable>
        <Text style={ui.footnote}>{saved[person.id]?.apple?'Saved in Amber and Apple Contacts.':'Checks Apple Contacts first. Existing people and details are kept.'}</Text>
      </View>
    </> : <>
      <View style={ui.search}>
        <Search size={19} color={cl.ink48}/>
        <TextInput accessibilityLabel="Search people on the web" value={text} onChangeText={setText} onSubmitEditing={()=>void search()} returnKeyType="search" maxLength={500} placeholder="Name, company, role or city" style={ui.input}/>
        <Pressable accessibilityRole="button" accessibilityLabel="Search people" disabled={text.trim().length<2} onPress={()=>void search()} style={ui.searchAction}>{busy?<ActivityIndicator color={cl.goldDeep}/>:<ChevronRight color={cl.goldDeep} size={20}/>}</Pressable>
      </View>
      {!!error && <Text accessibilityRole="alert" style={ui.caption}>{error}</Text>}
      <Text style={ui.caption}>{busy?'Finding people…':job?.status==='complete'?`${people.length} people found`:'Find someone beyond your network.'}</Text>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{paddingBottom:24}}>
        {job?.status==='complete' && !people.length && <Text style={ui.caption}>No matching people found. Try a name, company, or a broader role.</Text>}
        {people.map(p=><Pressable key={`${job?.id}:${p.id}`} accessibilityRole="button" accessibilityLabel={`Preview ${p.name}`} onPress={()=>{setSelected(p.id);setError('');}} style={({pressed})=>[ui.result,{opacity:pressed?0.65:1}]}>
          <Avatar name={p.name} size={48}/>
          <View style={{flex:1,gap:5}}><Text style={ui.resultName}>{p.name}</Text><Text numberOfLines={2} style={ui.caption}>{[p.title,p.company,p.location].filter(Boolean).join(' · ') || p.summary || 'LinkedIn profile'}</Text></View>
          {saved[p.id]?.apple?<Check size={19} color={cl.goldDeep}/>:<ChevronRight size={18} color={cl.ink48}/>}
        </Pressable>)}
      </ScrollView>
    </>}
  </View>;
}
const ui=StyleSheet.create({
 screen:{flex:1,paddingHorizontal:24,gap:16},
 search:{flexDirection:'row',alignItems:'center',gap:10,borderRadius:28,backgroundColor:cl.groundGold,borderWidth:1,borderColor:cl.ruleFaint,paddingLeft:16},
 input:{flex:1,paddingVertical:14,fontFamily:'Outfit_400Regular',fontSize:16,color:cl.ink},
 searchAction:{minHeight:48,width:44,alignItems:'center',justifyContent:'center'},
 result:{flexDirection:'row',alignItems:'center',gap:14,padding:16,marginBottom:10,borderRadius:24,backgroundColor:cl.card,borderWidth:1,borderColor:cl.ruleFaint},
 resultName:{fontFamily:'Outfit_500Medium',fontSize:19,lineHeight:25,color:cl.ink},
 name:{fontFamily:'Newsreader_500Medium',fontSize:36,lineHeight:40,color:cl.ink},
 body:{fontFamily:'Outfit_400Regular',fontSize:17,lineHeight:24,color:cl.ink},
 caption:{fontFamily:'Outfit_400Regular',fontSize:14,lineHeight:21,color:cl.ink62},
 back:{flexDirection:'row',gap:9,alignItems:'center',minHeight:44},detail:{gap:20,paddingBottom:24},
 source:{alignSelf:'flex-start',minHeight:44,justifyContent:'center'},link:{fontFamily:'Outfit_500Medium',fontSize:15,color:cl.goldDeep},
 footer:{gap:10,paddingBottom:16,paddingTop:12,borderTopWidth:1,borderColor:cl.ruleFaint},
 add:{backgroundColor:cl.ink,borderRadius:28,minHeight:56,alignItems:'center',justifyContent:'center',flexDirection:'row',gap:10},
 addText:{fontFamily:'Outfit_500Medium',fontSize:17,color:cl.card},footnote:{fontFamily:'Outfit_400Regular',fontSize:12,lineHeight:18,color:cl.ink48,textAlign:'center'},
});
