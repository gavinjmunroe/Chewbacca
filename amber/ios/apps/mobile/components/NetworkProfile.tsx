import { ContactReachability } from './ContactReachability';
import { SelfProfileSources } from './SelfProfileSources';
import { ClayContactActions } from './ClayContactActions';
import { saveToAppleContacts } from '../lib/appleContactWrite';
import { contactName } from '../lib/contactName';
import { ContactProvenance } from './ContactProvenance';
import type { ContactCadence } from '../lib/contactProvenance';
import { PeopleRankCard } from './PeopleRankCard';
import { SelfDimensionsCard } from './SelfDimensionsCard';
import { MemoHistory } from './MemoHistory';
import { contactSourceGroups, detailText } from '../lib/contactContext';
import { getContactRank, type ContactRank } from '../lib/contactRank';
import { config } from '../lib/config';
import { profileShareText, connectProfileUrl } from '../lib/profileSharing';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  ArrowLeft,
  Check,
  ChevronRight,
  ImageIcon,
  AudioLines,
  Share2,
  X,
} from 'lucide-react-native';
import {
  getContact,
  getContactFacts,
  getContactDetails,
  type ContactFact,
  type MedhaContactFull,
} from '../lib/contacts';
import { api, unwrapSingle, type Me } from '../lib/api';
import { SourceLogo, type SourceName } from './SourceLogo';
import { cl } from '../lib/classical';
export type ProfileSeed = {
  id: string;
  name: string;
  subtitle?: string;
  avatarUrl?: string | null;
  notes?: string;
  source?: string;
  contact?: MedhaContactFull;
};
function sourceName(value: string): SourceName | null {
  const source = value.toLowerCase();
  if (/google|gmail/.test(source)) return 'Google';
  if (/whatsapp/.test(source)) return 'WhatsApp';
  if (/imessage/.test(source)) return 'iMessage';
  if (/instagram/.test(source)) return 'Instagram';
  if (/linkedin/.test(source)) return 'LinkedIn';
  if (/snapchat/.test(source)) return 'Snapchat';
  if (/tiktok/.test(source)) return 'TikTok';
  if (/partiful/.test(source)) return 'Partiful';
  if (/clay|web|enrich/.test(source)) return 'Web';
  if (/apple|device|phone_contacts|ios/.test(source)) return 'Apple';
  return null;
}
function Photo({ uri, size, rounded = false }: { uri: string; size: number; rounded?: boolean }) {
  const [failed, setFailed] = useState(false);
  return failed ? (
    <View
      style={[s.photoEmpty, { width: size, height: size, borderRadius: rounded ? size / 2 : 16 }]}
    >
      <ImageIcon color={cl.ink62} />
    </View>
  ) : (
    <Image
      source={{ uri }}
      onError={() => setFailed(true)}
      style={{ width: size, height: size, borderRadius: rounded ? size / 2 : 16 }}
    />
  );
}
export function NetworkProfile({
  seed,
  sample = false,
  onClose,
  onNetwork,
  onAddNote,
  onRecordMemo,
  onEdit,
  initialMe,
}: {
  seed: ProfileSeed;
  sample?: boolean;
  onClose: () => void;
  onNetwork: (id: string) => void;
  onAddNote?: () => void;
  onRecordMemo?: () => void;
  onEdit?: () => void;
  initialMe?: Me | null;
}) {
  const [modalVisible, setModalVisible] = useState(true);
  const afterDismiss = useRef<(() => void) | null>(null);
  const leaveFor = (action?: () => void) => {
    if (!action) return;
    afterDismiss.current = action;
    setModalVisible(false);
  };
  const insets = useSafeAreaInsets();
  const [contact, setContact] = useState<MedhaContactFull | null>(seed.contact ?? null);
  const [me, setMe] = useState<Me | null>(initialMe ?? null);
  const [extraDetails, setExtraDetails] = useState<Record<string, unknown>>({});
  const [rank, setRank] = useState<ContactRank | null>(null);
  const [rankError, setRankError] = useState(false);
  const [sourceMemo, setSourceMemo] = useState<string | null>(null);
  const [cadence, setCadence] = useState<ContactCadence | null>(null);
  const [facts, setFacts] = useState<ContactFact[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<'about' | 'photos' | 'sources'>('about');
  const [sharing, setSharing] = useState(false);
  const [includeDetails, setIncludeDetails] = useState(false);
  const [includeEmail, setIncludeEmail] = useState(false);
  const [includePhone, setIncludePhone] = useState(false);
  const [shareBusy, setShareBusy] = useState(false);
  const [shareError, setShareError] = useState('');
  const [photo, setPhoto] = useState<string | null>(null);
  const [appleMessage, setAppleMessage] = useState('');
  const [appleBusy, setAppleBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  const self = seed.id === 'self';
  useEffect(() => {
    if (sample) return;
    let current = true;
    setLoading(true);
    setError('');
    void (async () => {
      try {
        if (self) {
          const result = await api.me();
          if (!result.ok) throw new Error();
          if (current) {
            const profile = unwrapSingle<Me>(result);
            setMe(profile);
            setExtraDetails(Object.fromEntries(Object.entries({
              currentCity: profile?.currentCity, occupation: profile?.occupation,
              school: profile?.school, hometown: profile?.hometown,
              mbti: profile?.mbti, horoscope: profile?.horoscope,
            }).filter(([,value]) => !!value)));
          }
        } else {
          const extraError = () => {
            if (current) setError('Some details could not refresh. Showing available information.');
          };
          void getContactFacts(seed.id)
            .then((details) => {
              if (!current) return;
              if (details.ok) setFacts(details.data.facts);
              else extraError();
            })
            .catch(extraError);
          void getContactRank(seed.id)
            .then((standing) => {
              if (current) {
                setRank(standing.ok ? standing.data : null);
                setRankError(!standing.ok);
              }
            })
            .catch(() => {
              if (current) setRankError(true);
            });
          void getContactDetails(seed.id)
            .then((extra) => {
              if (!current) return;
              if (extra.ok) setExtraDetails(extra.data.details);
              else extraError();
            })
            .catch(extraError);
          const card = await getContact(seed.id);
          if (!current) return;
          if (!card.ok || card.data.contact?.id !== seed.id) throw new Error();
          setContact({ ...seed.contact, ...card.data.contact });
          setCadence(card.data.cadence ?? null);
        }
      } catch {
        if (current)
          setError('Could not refresh this card. Showing the details already available.');
      } finally {
        if (current) setLoading(false);
      }
    })();
    return () => {
      current = false;
    };
  }, [sample, seed.id, seed.contact, self, retry, initialMe]);
  const name = self ? me?.displayName || seed.name : contactName(contact ?? {}, seed.name);
  const subtitle = self
    ? 'Your private profile'
    : [contact?.title, contact?.company, contact?.city].filter(Boolean).join(' · ') ||
      seed.subtitle ||
      '';
  const email = Array.from(
    new Set([contact?.email, ...(contact?.emails ?? [])].filter((v): v is string => !!v)),
  );
  const phone = Array.from(
    new Set(
      [self ? me?.phone || me?.phoneNumber : contact?.phone, ...(contact?.phoneNumbers ?? [])].filter(
        (v): v is string => !!v,
      ),
    ),
  );
  const avatar = me?.avatarUrl || contact?.avatarUrl || seed.avatarUrl;
  const photos = avatar && /^https:\/\//i.test(avatar) ? [avatar] : [];
  const note = contact?.notes ?? seed.notes ?? me?.bio;
  const sourceGroups = contactSourceGroups(contact?.source || seed.source, facts);
  const sources = sourceGroups.map((group) => group.label);
  const detailCount = email.length + phone.length + facts.length;
  const shareText = profileShareText(
    {
      name,
      subtitle,
      emails: email,
      phones: phone,
      sample,
      profileUrl:
        self && !sample ? connectProfileUrl(config.amberConnectBaseUrl, me?.username) : undefined,
    },
    { details: includeDetails, emails: includeEmail, phones: includePhone },
  );
  async function share() {
    if (shareBusy) return;
    setShareBusy(true);
    setShareError('');
    try {
      await Share.share({ title: name, message: shareText });
    } catch {
      setShareError('Could not open sharing. Please try again.');
    } finally {
      setShareBusy(false);
    }
  }
  return (
    <Modal
      visible={modalVisible}
      onDismiss={() => {
        const action = afterDismiss.current;
        afterDismiss.current = null;
        if (action) {
          onClose();
          action();
        }
      }}
      presentationStyle="fullScreen"
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={[s.screen, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <View style={s.header}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={sharing ? 'Back to profile' : 'Close profile'}
            onPress={() => (sharing ? setSharing(false) : onClose())}
            style={s.icon}
          >
            <ArrowLeft color={cl.ink} />
          </Pressable>
          <View style={s.brand}>
            <Image source={require('../assets/amber-logo.png')} style={{ width: 27, height: 30 }} />
            <Text style={s.wordmark}>amber</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Choose profile details to share"
            onPress={() => setSharing(true)}
            style={s.icon}
          >
            <Share2 color={cl.ink} size={21} />
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={s.content}>
          {sharing ? (
            <>
              <Text style={s.title}>Share {self ? 'your card' : name}</Text>
              <Text style={s.caption}>
                Choose exactly what to include. Your notes, source records, photos, and summaries
                stay private.
              </Text>
              <View style={s.surface}>
                <View style={s.row}>
                  <Text style={s.body}>Name</Text>
                  <Check color={cl.goldDeep} />
                </View>
                {subtitle ? (
                  <View style={s.row}>
                    <Text style={s.body}>Profile details</Text>
                    <Switch
                      accessibilityLabel="Include profile details"
                      value={includeDetails}
                      onValueChange={setIncludeDetails}
                    />
                  </View>
                ) : null}
                {email.length ? (
                  <View style={s.row}>
                    <Text style={s.body}>Email addresses</Text>
                    <Switch
                      accessibilityLabel="Include email addresses"
                      value={includeEmail}
                      onValueChange={setIncludeEmail}
                    />
                  </View>
                ) : null}
                {phone.length ? (
                  <View style={s.row}>
                    <Text style={s.body}>Phone numbers</Text>
                    <Switch
                      accessibilityLabel="Include phone numbers"
                      value={includePhone}
                      onValueChange={setIncludePhone}
                    />
                  </View>
                ) : null}
              </View>
              <Text style={s.label}>SHARING PREVIEW</Text>
              <Text selectable style={[s.body, s.surface]}>
                {shareText}
              </Text>
              <Pressable
                accessibilityRole="button"
                disabled={shareBusy}
                style={s.primary}
                onPress={() => void share()}
              >
                <Share2 color={cl.card} size={19} />
                <Text style={s.primaryText}>Choose where to share</Text>
              </Pressable>
              {shareError ? (
                <Text accessibilityRole="alert" style={s.caption}>
                  {shareError}
                </Text>
              ) : null}
            </>
          ) : (
            <>
              <View style={s.hero}>
                <View style={s.avatarRing}>
                  {photos[0] ? (
                    <Photo uri={photos[0]} size={96} rounded />
                  ) : (
                    <View style={s.initialAvatar}>
                      {self ? (
                        <Image
                          source={require('../assets/amber-logo.png')}
                          style={{ width: 80, height: 80 }}
                        />
                      ) : (
                        <Text style={s.initials}>
                          {name
                            .split(' ')
                            .map((v) => v[0])
                            .slice(0, 2)
                            .join('')}
                        </Text>
                      )}
                    </View>
                  )}
                </View>
                {!self && <View style={s.counts}>
                  {[
                    { n: detailCount, label: 'details' },
                    { n: photos.length, label: 'photos' },
                    { n: sources.length, label: 'sources' },
                  ].map((stat) => (
                    <View key={stat.label} style={s.stat}>
                      <Text style={s.statNumber}>{stat.n}</Text>
                      <Text style={s.caption}>{stat.label}</Text>
                    </View>
                  ))}
                </View>}
              </View>
              <View style={{ gap: 7 }}>
                <Text style={s.title}>{name}</Text>
                {subtitle ? <Text style={s.body}>{subtitle}</Text> : null}
                <Text style={s.caption}>
                  {sample
                    ? self
                      ? 'Design preview · your personal card'
                      : 'Design preview · sample relationship'
                    : self
                      ? 'Visible to you · choose what to share'
                      : 'Your private view of this person'}
                </Text>
              </View>
              {(onRecordMemo || (self && onEdit)) && (
                <View style={s.actions}>
                  {onRecordMemo && (
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => leaveFor(onRecordMemo)}
                      style={s.action}
                    >
                      <AudioLines size={18} color={cl.goldDeep} />
                      <Text style={s.actionText}>Add voice memo</Text>
                    </Pressable>
                  )}
                  {self && onEdit && (
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => leaveFor(onEdit)}
                      style={s.action}
                    >
                      <Text style={s.actionText}>Edit profile</Text>
                    </Pressable>
                  )}
                </View>
              )}
              {self ? (
                !sample && <SelfDimensionsCard />
              ) : (
                <PeopleRankCard
                  rank={rank}
                  loading={loading}
                  error={rankError}
                  onRetry={() => setRetry((v) => v + 1)}
                />
              )}
              <View style={s.tabs}>
                {(['about', ...(!self || photos.length ? ['photos' as const] : []), 'sources'] as const).map((value) => (
                  <Pressable
                    key={value}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: tab === value }}
                    onPress={() => setTab(value)}
                    style={[s.tab, tab === value && s.selectedTab]}
                  >
                    <Text style={s.actionText}>
                      {value === 'about' ? 'Details' : value === 'photos' ? 'Photos' : 'Sources'}
                    </Text>
                  </Pressable>
                ))}
              </View>
              {loading && <ActivityIndicator color={cl.goldDeep} />}
              {error ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setRetry((value) => value + 1)}
                >
                  <Text accessibilityRole="alert" style={s.caption}>
                    {error} Tap to retry.
                  </Text>
                </Pressable>
              ) : null}
              {tab === 'about' && (
                <>
                  {!!cadence?.summary && (
                    <View style={s.surface}>
                      <Text style={s.label}>YOUR RELATIONSHIP</Text>
                      <Text style={s.body}>{cadence.summary}</Text>
                    </View>
                  )}
                  {!self && !sample && contact && <View style={s.surface}>
                    <ClayContactActions key={seed.id} contactId={seed.id} person={{name,company:contact.company,emails:email,phoneNumbers:phone,linkedin:contact.linkedinUrl || contact.enrichment?.linkedinUrl,...contact.enrichment?.clayFields}} onSaved={() => setRetry(v=>v+1)}/>
                    <Pressable accessibilityRole="button" disabled={appleBusy} onPress={() => {
                      setAppleBusy(true);setAppleMessage('');
                      void saveToAppleContacts({name,firstName:contact.firstName,lastName:contact.lastName,company:contact.company,title:contact.title,emails:email,phoneNumbers:phone,linkedin:contact.linkedinUrl || contact.enrichment?.linkedinUrl,...contact.enrichment?.clayFields})
                        .then(()=>setAppleMessage('Saved to Apple Contacts.')).catch(e=>setAppleMessage(e.message)).finally(()=>setAppleBusy(false));
                    }} style={s.action}><Text style={s.actionText}>{appleBusy?'Saving…':'Save details to Apple Contacts'}</Text></Pressable>
                    {!!appleMessage && <Text style={s.caption}>{appleMessage}</Text>}
                  </View>}
                  <Text style={s.label}>OVERVIEW</Text>
                  {note ? (
                    <Text selectable style={s.body}>
                      {note}
                    </Text>
                  ) : (
                    <Text style={s.caption}>
                      {self
                        ? 'Your saved notes about yourself will appear here.'
                        : 'Your saved notes about this person will appear here.'}
                    </Text>
                  )}
                  {facts.map((fact) => (
                    <View key={fact.id} style={s.surface}>
                      <Text selectable style={s.body}>
                        {fact.factText}
                      </Text>
                      <Text style={[s.caption, { marginTop: 8 }]}>
                        {fact.source.replace(/_/g, ' ')}
                        {fact.createdAt
                          ? ` · ${new Date(fact.createdAt).toLocaleDateString()}`
                          : ''}
                      </Text>
                    </View>
                  ))}
                  {(self || sample) && <ContactReachability person={{name,emails:email,phoneNumbers:phone}}/>}
                  {Object.entries(extraDetails).map(([label, value]) => {
                    const text = detailText(value);
                    return text ? (
                      <View key={label} style={s.surface}>
                        <Text style={s.label}>
                          {label
                            .replace(/_/g, ' ')
                            .replace(/([a-z])([A-Z])/g, '$1 $2')
                            .toUpperCase()}
                        </Text>
                        <Text selectable style={[s.body, { marginTop: 8 }]}>
                          {text}
                        </Text>
                      </View>
                    ) : null;
                  })}
                </>
              )}
              {tab === 'photos' && (
                <>
                  <Text style={s.caption}>
                    Only source-provided images appear here. No generated portraits.
                  </Text>
                  {photos.length ? (
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
                      {photos.map((uri) => (
                        <Pressable
                          key={uri}
                          accessibilityRole="button"
                          accessibilityLabel="Open source profile photo"
                          onPress={() => setPhoto(uri)}
                        >
                          <Photo uri={uri} size={144} />
                          <Text style={[s.caption, { marginTop: 8 }]}>Profile photo</Text>
                        </Pressable>
                      ))}
                    </View>
                  ) : (
                    <View style={s.empty}>
                      <ImageIcon size={34} color={cl.goldDeep} />
                      <Text style={s.body}>{self ? 'No profile photo saved' : 'No photos saved'}</Text>
                      <Text style={s.caption}>
                        Photos appear after they are explicitly added to this card.
                      </Text>
                    </View>
                  )}
                </>
              )}
              {tab === 'sources' && self && !sample && <SelfProfileSources onMemo={setSourceMemo} />}
              {tab === 'sources' && !self && (
                <>
                  <Text style={s.caption}>
                    Saved source records are shown together. This view does not create connections
                    or merge identities.
                  </Text>
                  {!sample && !self && <ContactProvenance contactId={seed.id} />}
                  {sourceGroups.map((group) => {
                    const provider = sourceName(group.label);
                    const memoIds = [
                      ...new Set(
                        group.records
                          .map((f) => f.sourceConversationId)
                          .filter((v): v is string => !!v),
                      ),
                    ];
                    return (
                      <View key={group.label} style={[s.surface, { gap: 12 }]}>
                        <View style={s.row}>
                          {provider ? (
                            <SourceLogo name={provider} size={25} />
                          ) : (
                            <AudioLines size={23} color={cl.goldDeep} />
                          )}
                          <Text style={s.body}>{group.label}</Text>
                        </View>
                        {group.label === 'Apple Contacts' && note && (
                          <Text selectable style={s.body}>
                            {note}
                          </Text>
                        )}
                        {group.records.map((fact) => (
                          <View key={fact.id} style={{ gap: 5 }}>
                            <Text selectable style={s.body}>
                              {fact.factText}
                            </Text>
                            {!!fact.createdAt && (
                              <Text style={s.caption}>
                                {new Date(fact.createdAt).toLocaleDateString()}
                              </Text>
                            )}
                          </View>
                        ))}
                        {memoIds.map((id) => (
                          <Pressable
                            key={id}
                            accessibilityRole="button"
                            onPress={() => setSourceMemo(id)}
                            style={s.action}
                          >
                            <AudioLines size={18} color={cl.goldDeep} />
                            <Text style={s.actionText}>Open original memo</Text>
                            <ChevronRight size={18} color={cl.ink62} />
                          </Pressable>
                        ))}
                        {!group.records.length && (
                          <Text style={s.caption}>Saved contact record</Text>
                        )}
                      </View>
                    );
                  })}
                  {!sources.length && (
                    <View style={s.empty}>
                      <Text style={s.body}>No source records yet</Text>
                      <Text style={s.caption}>
                        The source trail will appear as your integrations contribute verified data.
                      </Text>
                    </View>
                  )}
                </>
              )}
            </>
          )}
        </ScrollView>
        {sourceMemo && (
          <MemoHistory
            visible
            sample={sample}
            entries={[]}
            initialConversationId={sourceMemo}
            onClose={() => setSourceMemo(null)}
            onReview={() => {}}
          />
        )}
        <Modal
          visible={!!photo}
          transparent
          animationType="fade"
          onRequestClose={() => setPhoto(null)}
        >
          <SafeAreaView style={{ flex: 1, backgroundColor: cl.ink }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close photo"
              style={[s.icon, { alignSelf: 'flex-end', margin: 16 }]}
              onPress={() => setPhoto(null)}
            >
              <X color={cl.card} />
            </Pressable>
            {photo && <Image source={{ uri: photo }} resizeMode="contain" style={{ flex: 1 }} />}
          </SafeAreaView>
        </Modal>
      </View>
    </Modal>
  );
}
const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: cl.ground },
  header: {
    minHeight: 60,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
  },
  brand: { flexDirection: 'row', alignItems: 'center' },
  wordmark: { fontFamily: 'Newsreader_500Medium', fontSize: 26, color: cl.ink },
  icon: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  content: { paddingHorizontal: 24, paddingTop: 18, paddingBottom: 40, gap: 22 },
  hero: { flexDirection: 'row', alignItems: 'center', gap: 20 },
  avatarRing: { padding: 4, borderRadius: 58, borderWidth: 1.5, borderColor: cl.goldDeep },
  initialAvatar: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: cl.groundGold,
    alignItems: 'center',
    justifyContent: 'center',
  },
  initials: { fontFamily: 'Newsreader_500Medium', fontSize: 38, color: cl.ink70 },
  counts: { flex: 1, flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  stat: { alignItems: 'center', gap: 5 },
  statNumber: { fontFamily: 'Outfit_500Medium', fontSize: 21, color: cl.ink },
  title: { fontFamily: 'Newsreader_500Medium', fontSize: 32, color: cl.ink },
  body: { fontFamily: 'Outfit_400Regular', fontSize: 15, lineHeight: 23, color: cl.ink },
  caption: { fontFamily: 'Outfit_400Regular', fontSize: 12, lineHeight: 18, color: cl.ink62 },
  label: { fontFamily: 'Outfit_500Medium', fontSize: 10, letterSpacing: 1.2, color: cl.ink62 },
  actions: { flexDirection: 'row', gap: 10 },
  action: {
    flex: 1,
    minHeight: 46,
    borderRadius: 23,
    backgroundColor: cl.card,
    borderWidth: 1,
    borderColor: cl.cardHairline,
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  actionText: { fontFamily: 'Outfit_500Medium', fontSize: 13, color: cl.ink },
  source: { width: 72, alignItems: 'center', gap: 7 },
  sourceCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 1,
    borderColor: cl.cardHairline,
    backgroundColor: cl.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sourceLabel: { fontFamily: 'Outfit_400Regular', fontSize: 10, color: cl.ink62 },
  tabs: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: cl.cardHairline },
  tab: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  selectedTab: { borderBottomColor: cl.goldDeep },
  surface: {
    backgroundColor: cl.card,
    padding: 18,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: cl.cardHairline,
  },
  empty: { paddingVertical: 36, gap: 12, alignItems: 'center' },
  photoEmpty: { backgroundColor: cl.groundGold, alignItems: 'center', justifyContent: 'center' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 55,
  },
  primary: {
    minHeight: 54,
    borderRadius: 27,
    backgroundColor: cl.ink,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  primaryText: { fontFamily: 'Outfit_500Medium', fontSize: 15, color: cl.card },
});
