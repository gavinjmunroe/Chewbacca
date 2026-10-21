import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  SafeAreaProvider,
  SafeAreaView,
  initialWindowMetrics,
} from 'react-native-safe-area-context';
import { X, Check } from 'lucide-react-native';
import { api, unwrapSingle, type Me } from '../lib/api';
import { callMedhaId } from '../lib/medhaId';
import {
  membersFor,
  NETWORK_CATEGORIES,
  type AmberSpace,
  type SavedNetwork,
} from '../lib/amberSpace';
import { cl } from '../lib/classical';
const COLORS = ['#A9641D', '#44665B', '#5E637F', '#8A5962'];
export function AmberProfileEditor({
  space,
  people,
  sample,
  onClose,
  onSave,
  onAccountSettings,
}: {
  space: AmberSpace;
  people: { id: string; name: string }[];
  sample: boolean;
  onClose: () => void;
  onSave: (patch: Partial<AmberSpace>) => Promise<void>;
  onAccountSettings?: () => void;
}) {
  const [profile, setProfile] = useState(space.profile),
    [memberships, setMemberships] = useState(space.memberships),
    [editing, setEditing] = useState<SavedNetwork>('Family');
  const [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(!sample),
    [loaded, setLoaded] = useState(sample),
    [error, setError] = useState('');
  const lock = useRef(false);
  useEffect(() => {
    if (sample) return;
    let alive = true;
    void api
      .me()
      .then((result) => {
        if (!alive) return;
        if (!result.ok) throw Error();
        const me = unwrapSingle<Me>(result);
        if (!me) throw Error();
        setLoaded(true);
        setProfile((old) => ({
          ...old,
          displayName: me.displayName || '',
          bio: me.bio || '',
          city: me.currentCity || '',
        }));
      })
      .catch(() => {
        if (alive) setError('Could not load your profile. Reopen it to retry before editing.');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [sample]);
  const ids = membersFor(
    { ...space, memberships },
    editing,
    people.map((p) => p.id),
  );
  const toggle = (id: string) =>
    setMemberships((old) => ({
      ...old,
      [editing]: ids.includes(id) ? ids.filter((v) => v !== id) : [...ids, id],
    }));
  async function save() {
    if (lock.current || !profile.displayName.trim()) return;
    if (profile.website && !/^https:\/\//i.test(profile.website)) {
      setError('Use a full https:// link for your website.');
      return;
    }
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      const clean = {
        ...profile,
        displayName: profile.displayName.trim(),
        bio: profile.bio.trim(),
        city: profile.city.trim(),
      };
      if (!sample) {
        const result = await callMedhaId({
          path: '/v1/me',
          method: 'PATCH',
          body: { displayName: clean.displayName, bio: clean.bio, currentCity: clean.city },
          requireAuth: true,
        });
        if (!result.ok) throw Error('Your profile could not be saved.');
      }
      await onSave({ profile: clean, memberships });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save your changes.');
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <Modal
      visible
      animationType="fade"
      onRequestClose={() => {
        if (!busy) onClose();
      }}
    >
      <SafeAreaProvider initialMetrics={initialWindowMetrics}>
        <SafeAreaView style={s.screen}>
          <KeyboardAvoidingView
            style={{ flex: 1 }}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          >
            <View style={s.header}>
              <Text style={s.title}>Your Amber profile.</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close profile editor"
                onPress={onClose}
                disabled={busy}
                style={s.icon}
              >
                <X color={cl.ink} />
              </Pressable>
            </View>
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={s.content}>
              <View style={[s.preview, { borderColor: profile.accent }]}>
                <View style={[s.avatar, { backgroundColor: profile.accent }]}>
                  <Text style={s.initial}>{profile.displayName[0]?.toUpperCase() || 'Y'}</Text>
                </View>
                <Text style={s.name}>{profile.displayName || 'Your name'}</Text>
                <Text style={s.body}>
                  {profile.bio || 'A little about you, in your own words.'}
                </Text>
                <Text style={s.small}>
                  {[profile.city, profile.website].filter(Boolean).join(' · ')}
                </Text>
              </View>
              {loading && <ActivityIndicator color={cl.goldDeep} />}
              {(['displayName', 'bio', 'city', 'website'] as const).map((key, i) => (
                <View key={key} style={{ gap: 7 }}>
                  <Text style={s.label}>{['Name', 'About you', 'City', 'Website'][i]}</Text>
                  <TextInput
                    accessibilityLabel={
                      ['Profile name', 'Profile bio', 'Profile city', 'Profile website'][i]
                    }
                    editable={!busy && !loading}
                    value={profile[key]}
                    onChangeText={(value) => setProfile((old) => ({ ...old, [key]: value }))}
                    multiline={key === 'bio'}
                    maxLength={key === 'displayName' ? 80 : key === 'city' ? 120 : 500}
                    autoCapitalize={key === 'website' ? 'none' : 'sentences'}
                    style={[s.input, key === 'bio' && { minHeight: 90, textAlignVertical: 'top' }]}
                    placeholder={key === 'website' ? 'https://…' : undefined}
                  />
                </View>
              ))}
              <Text style={s.label}>Your card color</Text>
              <View style={s.row}>
                {COLORS.map((color) => (
                  <Pressable
                    key={color}
                    accessibilityRole="radio"
                    accessibilityLabel={`Card color ${color}`}
                    accessibilityState={{ checked: profile.accent === color }}
                    onPress={() => setProfile((old) => ({ ...old, accent: color }))}
                    style={[s.swatch, { backgroundColor: color }]}
                  >
                    {profile.accent === color && <Check color={cl.card} />}
                  </Pressable>
                ))}
              </View>
              <Text style={s.section}>Your saved networks</Text>
              <Text style={s.small}>
                Choose who appears in each view. A person can belong to several circles. Changing a
                view does not notify anyone.
              </Text>
              <View style={s.row}>
                {NETWORK_CATEGORIES.map((network) => (
                  <Pressable
                    key={network}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: editing === network }}
                    onPress={() => setEditing(network)}
                    style={[s.tab, editing === network && { backgroundColor: '#F0E0C8' }]}
                  >
                    <Text style={s.label}>{network}</Text>
                  </Pressable>
                ))}
              </View>
              {people.map((person) => (
                <Pressable
                  key={person.id}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: ids.includes(person.id) }}
                  onPress={() => toggle(person.id)}
                  style={s.member}
                >
                  <Text style={s.body}>{person.name}</Text>
                  {ids.includes(person.id) && <Check size={19} color={cl.goldDeep} />}
                </Pressable>
              ))}
              {!people.length && (
                <Text style={s.body}>Connect or add contacts to organize your networks.</Text>
              )}
              <Text style={s.small}>
                {sample
                  ? 'Profile and saved networks stay in this preview on your device.'
                  : 'Name, bio and city save to your Amber account. Circle memberships save to Amber ID. Card color and website are saved on this device.'}
              </Text>
              {!!error && (
                <Text accessibilityRole="alert" style={s.body}>
                  {error}
                </Text>
              )}
              {onAccountSettings && (
                <Pressable
                  accessibilityRole="button"
                  disabled={busy}
                  onPress={onAccountSettings}
                  style={{ minHeight: 48, justifyContent: 'center' }}
                >
                  <Text style={s.label}>Account settings</Text>
                  <Text style={s.small}>
                    Connections, notifications, privacy and account access
                  </Text>
                </Pressable>
              )}
            </ScrollView>
            <Pressable
              disabled={busy || loading || !loaded || !profile.displayName.trim()}
              accessibilityRole="button"
              onPress={() => void save()}
              style={[
                s.save,
                { opacity: busy || loading || !loaded || !profile.displayName.trim() ? 0.5 : 1 },
              ]}
            >
              {busy ? (
                <ActivityIndicator color={cl.card} />
              ) : (
                <Text style={s.saveText}>Save profile & networks</Text>
              )}
            </Pressable>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </SafeAreaProvider>
    </Modal>
  );
}
const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: cl.card },
  header: { padding: 22, flexDirection: 'row', alignItems: 'center' },
  title: { flex: 1, fontFamily: 'Newsreader_400Regular', fontSize: 29, color: cl.ink },
  icon: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  content: { padding: 22, paddingTop: 0, gap: 16, paddingBottom: 30 },
  preview: {
    borderRadius: 26,
    borderWidth: 1,
    padding: 24,
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#FCFAF7',
  },
  avatar: {
    width: 68,
    height: 68,
    borderRadius: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
  initial: { fontFamily: 'Newsreader_400Regular', fontSize: 32, color: cl.card },
  name: { fontFamily: 'Newsreader_400Regular', fontSize: 29, color: cl.ink },
  body: { fontFamily: 'Outfit_400Regular', fontSize: 14, lineHeight: 21, color: cl.ink70 },
  small: { fontFamily: 'Outfit_400Regular', fontSize: 12, lineHeight: 18, color: cl.ink62 },
  label: { fontFamily: 'Outfit_500Medium', fontSize: 13, color: cl.ink },
  input: {
    borderWidth: 1,
    borderColor: cl.cardHairline,
    borderRadius: 16,
    padding: 14,
    minHeight: 50,
    fontFamily: 'Outfit_400Regular',
    fontSize: 15,
    color: cl.ink,
  },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  swatch: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
  },
  section: { fontFamily: 'Newsreader_400Regular', fontSize: 26, color: cl.ink, marginTop: 10 },
  tab: {
    flexGrow: 1,
    flexBasis: '28%',
    minHeight: 44,
    borderRadius: 22,
    backgroundColor: cl.groundGold,
    alignItems: 'center',
    justifyContent: 'center',
  },
  member: {
    minHeight: 50,
    borderBottomWidth: 1,
    borderColor: cl.cardHairline,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  save: {
    margin: 20,
    minHeight: 54,
    borderRadius: 27,
    backgroundColor: cl.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveText: { fontFamily: 'Outfit_500Medium', color: cl.card, fontSize: 15 },
});
