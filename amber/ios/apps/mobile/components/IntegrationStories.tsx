import { GoogleMailStatus } from './GoogleMailStatus';
import { ApplePermissions } from './ApplePermissions';
import { connectCalendarProvider } from '../lib/calendarConnect';
import * as Contacts from 'expo-contacts';
import { startContactsSync } from '../lib/contactsSyncEngine';
import { communitySourceLabels } from '../lib/surfaceSearch';
import { SourceLogo, type SourceName } from './SourceLogo';
import { useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { X, Upload, Link, ShieldCheck, ChevronRight } from 'lucide-react-native';
import { WebView } from 'react-native-webview';
import { CalendarSyncSheet } from './CalendarSyncSheet';
import { cl } from '../lib/classical';
import { requestStyles as r } from './RequestReview';
import { GlassSurface } from './LiquidGlass';
import { integrationCopy, integrationSources, isComingSoon } from '../lib/integrationCatalog';
const betaSources = integrationSources.filter((source) => source === 'Apple' || source === 'Google');
// A local-only document chooser: no remote page, credentials, or injected file contents.
const picker = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'"><style>body{margin:0;font:16px -apple-system;background:#fff}label{display:block;text-align:center;padding:18px;border-radius:26px;background:#282622;color:white}input{position:absolute;opacity:0;width:1px;height:1px}</style></head><body><label for="file">Choose an export from Files</label><input id="file" type="file" accept=".txt,.csv,.json,.vcf,.ics"><script>document.getElementById('file').onchange=async function(){const f=this.files[0];if(!f)return;if(f.size>1048576){window.ReactNativeWebView.postMessage(JSON.stringify({error:'Choose a text export smaller than 1 MB.'}));return;}try{window.ReactNativeWebView.postMessage(JSON.stringify({name:f.name,text:await f.text()}));}catch(e){window.ReactNativeWebView.postMessage(JSON.stringify({error:'This file could not be read.'}));}};</script></body></html>`;
export type SourceUpdate = {
  id: string;
  source: SourceName;
  title: string;
  text: string;
  occurredAt: string;
};
export function IntegrationStories({
  sample = false,
  updates = [],
  onConnected,
}: {
  sample?: boolean;
  updates?: SourceUpdate[];
  onConnected?: () => void;
}) {
  const sources = sample ? integrationSources : betaSources;
  const [selected, setSelected] = useState<SourceName | null>(null);
  const [section, setSection] = useState<'Updates' | 'Connect' | 'Add data'>('Updates');
  const [storyIndex, setStoryIndex] = useState(0);
  const [calendarSetup, setCalendarSetup] = useState(false);
  const [importing, setImporting] = useState(false);
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  function select(name: SourceName) {
    setSelected(name);
    setSection(sample ? 'Updates' : 'Connect');
    setStoryIndex(0);
    setImporting(false);
    setFile(null);
    setMessage('');
  }
  const stories = updates
    .filter((update) => update.source === selected)
    .sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt));
  const story = stories[Math.min(storyIndex, Math.max(0, stories.length - 1))];
  const detail = selected ? integrationCopy[selected] : null;
  const comingSoon = selected !== null && isComingSoon(selected);
  async function connect() {
    if (comingSoon) return;
    if (lock.current) return;
    if (sample) {
      setMessage(
        'Sign in to an Amber account to connect a service. You can review an exported file here without signing in.',
      );
      return;
    }
    if (selected === 'Apple') {
      lock.current = true;
      setBusy(true);
      try {
        const permission = await Contacts.requestPermissionsAsync();
        if (permission.status !== 'granted') {
          setMessage('Contacts permission was not granted.');
          return;
        }
        const result = await startContactsSync();
        if (result.ok) onConnected?.();
        setMessage(
          result.ok
            ? 'Contacts imported into your community.'
            : 'Contact import could not finish. Please retry.',
        );
      } catch {
        setMessage('Could not import contacts. Please retry.');
      } finally {
        lock.current = false;
        setBusy(false);
      }
      return;
    }
    if (selected !== 'Google') {
      setMessage(
        'Direct account connection is not available here yet. Choose an export to review instead.',
      );
      return;
    }
    lock.current = true;
    setBusy(true);
    setMessage('Opening Google’s secure sign-in…');
    try {
      const result = await connectCalendarProvider('google', setMessage);
      setMessage(result.message);
      if (result.connected) onConnected?.();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : 'Could not confirm the connection. Please try again.',
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <>
      <View style={s.strip}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.row}>
          {sources.map((name) => (
            <Pressable
              key={name}
              accessibilityRole="button"
              accessibilityLabel={`${name === 'Apple' || name === 'Google' ? communitySourceLabels[name] : name}${isComingSoon(name) ? ', coming soon' : ' integration'}`}
              onPress={() => select(name)}
              style={[s.item, isComingSoon(name) && { opacity: 0.38 }]}
            >
              <View
                style={[
                  s.circle,
                  updates.some((update) => update.source === name) && {
                    borderColor: cl.goldDeep,
                    borderWidth: 2,
                  },
                ]}
              >
                <SourceLogo name={name} size={32} />
              </View>
              <Text style={s.label}>
                {name === 'Apple' || name === 'Google' ? communitySourceLabels[name] : name}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>
      <Modal
        visible={selected !== null}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (!busy) setSelected(null);
        }}
      >
        <View style={r.backdrop}>
          <GlassSurface style={s.sheet} fallbackStyle={{ backgroundColor: cl.card }}>
            <View style={s.handle} />
            <View style={r.heading}>
              <View style={s.brand}>{selected && <SourceLogo name={selected} size={36} />}</View>
              <Text style={r.title}>
                {selected === 'Apple' ? 'Apple' : selected === 'Google' ? 'Google' : selected}
              </Text>
              <Pressable
                disabled={busy}
                accessibilityRole="button"
                accessibilityLabel="Close integration"
                onPress={() => setSelected(null)}
                style={r.close}
              >
                <X color={cl.ink} />
              </Pressable>
            </View>
            <View style={[s.tabs, comingSoon && { display: 'none' }]}>
              {(sample ? ['Updates', 'Connect', 'Add data'] as const : ['Connect'] as const).map((tab) => (
                <Pressable
                  key={tab}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: section === tab }}
                  onPress={() => {
                    setSection(tab);
                    setImporting(tab === 'Add data');
                    setMessage('');
                  }}
                  style={[s.tab, section === tab && s.selectedTab]}
                >
                  <Text style={r.body}>{tab}</Text>
                </Pressable>
              ))}
            </View>
            <ScrollView contentContainerStyle={r.content}>
              {comingSoon ? (
                <View style={s.story}>
                  <Text style={s.headline}>Coming soon</Text>
                  <Text style={s.description}>
                    The {selected} integration has not been built out yet. Check back for updates.
                  </Text>
                </View>
              ) : (
                <>
                  {section === 'Updates' && (
                    <View style={s.story}>
                      <Text style={r.label}>FROM YOUR NETWORK</Text>
                      {story ? (
                        <>
                          <View style={{ flexDirection: 'row', gap: 4 }}>
                            {stories.map((item, i) => (
                              <View
                                key={item.id}
                                style={{
                                  flex: 1,
                                  height: 3,
                                  borderRadius: 2,
                                  backgroundColor: i <= storyIndex ? cl.goldDeep : cl.warmHairline,
                                }}
                              />
                            ))}
                          </View>
                          <Text style={s.headline}>{story.title}</Text>
                          <Text style={s.description}>{story.text}</Text>
                          <Text style={r.hint}>{new Date(story.occurredAt).toLocaleString()}</Text>
                          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                            <Pressable
                              disabled={storyIndex === 0}
                              onPress={() => setStoryIndex((value) => Math.max(0, value - 1))}
                              style={s.tab}
                            >
                              <Text style={r.body}>Previous</Text>
                            </Pressable>
                            <Pressable
                              disabled={storyIndex >= stories.length - 1}
                              onPress={() =>
                                setStoryIndex((value) => Math.min(stories.length - 1, value + 1))
                              }
                              style={s.tab}
                            >
                              <Text style={r.body}>Next</Text>
                            </Pressable>
                          </View>
                        </>
                      ) : (
                        <>
                          <Text style={s.headline}>Your network, as it happens.</Text>
                          <Text style={s.description}>
                            No updates are available from {selected} yet. Once a supported feed is
                            connected, its recent updates will appear here.
                          </Text>
                          <Pressable onPress={() => setSection('Connect')} style={r.confirm}>
                            <Text style={r.confirmText}>Explore connection</Text>
                          </Pressable>
                        </>
                      )}
                    </View>
                  )}
                  {section === 'Connect' && (
                    <>
                      <Text style={s.headline}>{detail?.title}</Text>
                      <Text style={s.description}>{selected === 'Apple' && !sample ? 'Import the contacts you choose from your iPhone.' : detail?.description}</Text>
                      {selected === 'Apple' && sample && <ApplePermissions demo />}
                      <View style={s.permissions}>
                        {selected !== 'Apple' && detail?.permissions.map((permission) => (
                          <View key={permission} style={s.permission}>
                            <ShieldCheck size={17} color={cl.goldDeep} />
                            <Text style={r.body}>{permission}</Text>
                          </View>
                        ))}
                      </View>
                      <Pressable
                        disabled={busy}
                        onPress={() => void connect()}
                        accessibilityRole="button"
                        style={r.notice}
                      >
                        {selected === 'Google' ? (
                          <SourceLogo name="Google" size={22} />
                        ) : (
                          <Link color={cl.goldDeep} />
                        )}
                        <View style={{ flex: 1 }}>
                          <Text style={r.body}>
                            {selected === 'Apple'
                              ? 'Import contacts from this device'
                              : selected === 'Google'
                                ? 'Continue with Google'
                                : 'Account connection'}
                          </Text>
                          <Text style={r.hint}>{detail?.connection}</Text>
                        </View>
                        <ChevronRight size={18} color={cl.ink62} />
                      </Pressable>
                    </>
                  )}
                  {section === 'Connect' && selected === 'Google' && (
                    <Pressable
                      disabled={busy}
                      accessibilityRole="button"
                      onPress={() => {
                        setSelected(null);
                        setCalendarSetup(true);
                      }}
                      style={r.notice}
                    >
                      <Text style={r.body}>Connect Calendar</Text>
                      <Text style={r.hint}>Calendar access without Gmail or Drive</Text>
                    </Pressable>
                  )}
                  {section === 'Connect' && selected === 'Google' && !sample && <GoogleMailStatus onSynced={onConnected} />}
                  {section === 'Add data' && (
                    <>
                      <Text style={s.headline}>Bring your context.</Text>
                      <Text style={s.description}>
                        Choose an export to review before it becomes part of your network.
                      </Text>
                      <Pressable
                        accessibilityRole="button"
                        onPress={() => setImporting(true)}
                        style={r.notice}
                      >
                        <Upload color={cl.goldDeep} />
                        <View style={{ flex: 1 }}>
                          <Text style={r.body}>Review an exported file</Text>
                          <Text style={r.hint}>
                            CSV, JSON, vCard, calendar, or text · up to 1 MB
                          </Text>
                        </View>
                      </Pressable>
                      {importing && (
                        <>
                          <View style={{ height: 62 }}>
                            <WebView
                              source={{ html: picker }}
                              originWhitelist={['*']}
                              onShouldStartLoadWithRequest={(request) =>
                                request.url === 'about:blank'
                              }
                              scrollEnabled={false}
                              onMessage={(event) => {
                                try {
                                  const value = JSON.parse(event.nativeEvent.data);
                                  if (value.error) {
                                    setMessage(String(value.error));
                                    return;
                                  }
                                  if (
                                    typeof value.name !== 'string' ||
                                    typeof value.text !== 'string' ||
                                    value.text.length > 1048576 ||
                                    !/\.(txt|csv|json|vcf|ics)$/i.test(value.name)
                                  )
                                    throw new Error();
                                  setFile(value);
                                  setMessage(
                                    'File loaded locally for review. It has not been uploaded or merged into your account.',
                                  );
                                } catch {
                                  setMessage('Choose a supported text export under 1 MB.');
                                }
                              }}
                            />
                          </View>
                          {file && (
                            <View style={{ gap: 10 }}>
                              <Text style={r.body}>{file.name}</Text>
                              <Text style={r.hint}>
                                Import mapping and duplicate review are the next step; saving this
                                export is not connected yet.
                              </Text>
                              <Text selectable numberOfLines={10} style={r.hint}>
                                {file.text.slice(0, 2000)}
                              </Text>
                            </View>
                          )}
                        </>
                      )}
                    </>
                  )}
                  {section !== 'Updates' && <Text style={r.hint}>{detail?.footnote}</Text>}
                  {message ? (
                    <Text accessibilityLiveRegion="polite" style={r.body}>
                      {message}
                    </Text>
                  ) : null}
                </>
              )}
            </ScrollView>
          </GlassSurface>
        </View>
      </Modal>
      <CalendarSyncSheet
        visible={calendarSetup}
        onClose={() => setCalendarSetup(false)}
        onConnected={onConnected}
      />
    </>
  );
}
const s = StyleSheet.create({
  tabs: {
    flexDirection: 'row',
    margin: 18,
    padding: 4,
    borderRadius: 26,
    backgroundColor: cl.groundGold,
  },
  tab: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22 },
  selectedTab: { backgroundColor: cl.card },
  story: { minHeight: 300, gap: 22, paddingVertical: 18 },
  sheet: {
    height: '80%',
    borderRadius: 34,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.85)',
    overflow: 'hidden',
  },
  handle: {
    width: 36,
    height: 5,
    borderRadius: 3,
    backgroundColor: cl.ink32,
    alignSelf: 'center',
    marginTop: 10,
  },
  brand: { width: 54, height: 54, alignItems: 'center', justifyContent: 'center' },
  headline: {
    fontFamily: 'Newsreader_500Medium',
    fontSize: 30,
    lineHeight: 34,
    color: cl.ink,
    marginTop: 12,
  },
  description: { fontFamily: 'Outfit_400Regular', fontSize: 15, lineHeight: 22, color: cl.ink70 },
  permissions: { gap: 14, paddingVertical: 10 },
  permission: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  strip: { height: 94 },
  row: { gap: 14, paddingBottom: 10 },
  item: { width: 64, alignItems: 'center', gap: 7 },
  circle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: cl.warmHairline,
    backgroundColor: cl.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: { fontFamily: 'Outfit_400Regular', fontSize: 10, color: cl.ink70 },
});
