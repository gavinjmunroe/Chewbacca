import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, Share, StyleSheet, Switch, Text, View } from 'react-native';
import { ArrowUpRight, Check, Link2, Plus, QrCode, Share2, Trash2 } from 'lucide-react-native';
import QRCode from 'react-native-qrcode-styled/src';
import { randomUUID } from 'expo-crypto';
import { GlassSurface } from './LiquidGlass';
import { Pressable } from './Pressable';
import { TextInput } from './TextInput';
import { loadAmberCard, saveAmberCard, type AmberCard, type CardLink } from '../lib/amberCard';
import { cl } from '../lib/classical';

export function AmberLiveCard({
  name,
  phone,
  bio,
}: {
  name: string;
  phone?: string;
  bio?: string;
}) {
  const [card, setCard] = useState<AmberCard | null>(null),
    [saved, setSaved] = useState('');
  const [url, setUrl] = useState<string | null>(null),
    [error, setError] = useState('');
  const [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [editing, setEditing] = useState(false),
    [qr, setQr] = useState(false);
  const [retry, setRetry] = useState(0);
  const lock = useRef(false);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    void loadAmberCard()
      .then((r) => {
        if (!active) return;
        const value = r.card || {
          name,
          bio: bio || '',
          published: false,
          links: phone
            ? [
                {
                  id: 'phone',
                  type: 'phone' as const,
                  label: 'Phone',
                  value: phone,
                  enabled: false,
                },
              ]
            : [],
        };
        setCard(value);
        setSaved(JSON.stringify(value));
        setUrl(r.shareUrl);
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [name, phone, bio, retry]);
  const dirty = card && JSON.stringify(card) !== saved;
  async function persist(published: boolean, share = false) {
    if (!card || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      const r = await saveAmberCard({ ...card, published });
      setCard(r.card);
      setSaved(JSON.stringify(r.card));
      setUrl(r.shareUrl);
      if (share && r.shareUrl)
        await Share.share({ title: card.name, message: r.shareUrl, url: r.shareUrl });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save your card.');
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  function changeLink(id: string, patch: Partial<CardLink>) {
    setCard((c) =>
      c ? { ...c, links: c.links.map((l) => (l.id === id ? { ...l, ...patch } : l)) } : c,
    );
  }
  if (loading)
    return (
      <View style={s.loading}>
        <ActivityIndicator color={cl.goldDeep} />
        <Text style={s.muted}>Opening your card…</Text>
      </View>
    );
  if (!card)
    return (
      <View style={s.section}>
        <Text style={s.body}>{error}</Text>
        <Pressable onPress={() => setRetry((v) => v + 1)} style={s.small}>
          <Text style={s.body}>Retry</Text>
        </Pressable>
      </View>
    );
  return (
    <View style={s.section}>
      <GlassSurface
        style={s.card}
        fallbackStyle={{ backgroundColor: '#FFFDFA' }}
        tintColor="rgba(255,250,241,0.3)"
      >
        <View style={s.top}>
          <View style={s.brand}>
            <Image source={require('../assets/amber-logo.png')} style={s.rock} />
            <Text style={s.wordmark}>amber</Text>
          </View>
          <Text style={s.tag}>YOUR ID</Text>
        </View>
        <Text style={s.name}>{card.name}</Text>
        {!!card.bio && <Text style={s.bio}>{card.bio}</Text>}
        <View style={s.previewLinks}>
          {card.links
            .filter((l) => l.enabled)
            .map((l) => (
              <View key={l.id} style={s.link}>
                <Text style={[s.body, { flex: 1 }]}>{l.label}</Text>
                <ArrowUpRight size={18} color={cl.goldDeep} />
              </View>
            ))}
        </View>
        {!card.links.some((l) => l.enabled) && (
          <Text style={s.muted}>Choose the links you want to share below.</Text>
        )}
        <Text style={s.previewLabel}>SHARED CARD PREVIEW</Text>
      </GlassSurface>
      <View style={s.top}>
        <Text style={s.heading}>What you share</Text>
        <Pressable onPress={() => setEditing(!editing)} style={s.small}>
          <Text style={s.action}>{editing ? 'Done editing' : 'Edit details'}</Text>
        </Pressable>
      </View>
      {editing && (
        <View style={s.section}>
          <TextInput
            label="Name"
            value={card.name}
            maxLength={120}
            onChangeText={(name) => setCard({ ...card, name })}
          />
          <TextInput
            label="About you"
            value={card.bio}
            multiline
            maxLength={280}
            onChangeText={(bio) => setCard({ ...card, bio })}
          />
        </View>
      )}
      {!!dirty && <Text style={s.muted}>Unsaved changes. Save below to update your live card.</Text>}
      <View style={s.links}>
        {card.links.map((l) => (
          <View key={l.id} style={s.linkEditor}>
            <View style={s.top}>
              <View style={{ flex: 1, gap: 3 }}>
                <Text style={s.body}>{l.label}</Text>
                <Text style={s.muted} selectable>
                  {l.value}
                </Text>
              </View>
              <Switch
                disabled={busy}
                accessibilityLabel={'Share ' + l.label}
                value={l.enabled}
                onValueChange={(enabled) => changeLink(l.id, { enabled })}
                trackColor={{ true: cl.goldDeep }}
              />
            </View>
            {editing && (
              <View style={s.section}>
                <TextInput
                  label="Link label"
                  value={l.label}
                  maxLength={60}
                  onChangeText={(label) => changeLink(l.id, { label })}
                />
                <View style={s.types}>
                  {(['url', 'email', 'phone'] as const).map((type) => (
                    <Pressable
                      key={type}
                      onPress={() => changeLink(l.id, { type })}
                      style={[s.small, l.type === type && s.selected]}
                    >
                      <Text style={s.body}>
                        {type === 'url' ? 'Website' : type === 'email' ? 'Email' : 'Phone'}
                      </Text>
                    </Pressable>
                  ))}
                </View>
                <TextInput
                  label="Value"
                  value={l.value}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType={
                    l.type === 'phone' ? 'phone-pad' : l.type === 'email' ? 'email-address' : 'url'
                  }
                  onChangeText={(value) => changeLink(l.id, { value })}
                />
                <Pressable
                  accessibilityLabel={'Remove ' + l.label}
                  style={s.small}
                  onPress={() =>
                    setCard({ ...card, links: card.links.filter((x) => x.id !== l.id) })
                  }
                >
                  <Trash2 size={17} color={cl.ink62} />
                </Pressable>
              </View>
            )}
          </View>
        ))}
      </View>
      {card.links.length < 20 && (
        <Pressable
          style={s.add}
          onPress={() => {
            setEditing(true);
            setCard({
              ...card,
              links: [
                ...card.links,
                {
                  id: randomUUID(),
                  label: 'Website',
                  value: 'https://',
                  type: 'url',
                  enabled: false,
                },
              ],
            });
          }}
        >
          <Plus size={18} color={cl.goldDeep} />
          <Text style={s.action}>Add a link</Text>
        </Pressable>
      )}
      {!!error && (
        <Text accessibilityRole="alert" style={s.body}>
          {error}
        </Text>
      )}
      <Pressable
        disabled={busy || !card.name.trim()}
        onPress={() => void persist(true, true)}
        style={[s.primary, busy && { opacity: 0.5 }]}
      >
        {busy ? <ActivityIndicator color="white" /> : <Share2 size={18} color="white" />}
        <Text style={s.primaryText}>
          {busy ? 'Saving…' : dirty ? 'Save & share card' : 'Share my card'}
        </Text>
      </Pressable>
      {dirty && (
        <Pressable disabled={busy} onPress={() => void persist(card.published)} style={s.add}>
          <Check size={18} color={cl.goldDeep} />
          <Text style={s.action}>Save changes{card.published ? ' to live card' : ''}</Text>
        </Pressable>
      )}
      {url && (
        <View style={s.section}>
          <View style={s.top}>
            <Pressable style={s.add} onPress={() => setQr(!qr)}>
              <QrCode size={20} color={cl.ink} />
              <Text style={s.body}>{qr ? 'Hide QR code' : 'Show QR code'}</Text>
            </Pressable>
            <Pressable disabled={busy} onPress={() => void persist(false)} style={s.small}>
              <Text style={s.muted}>Unpublish</Text>
            </Pressable>
          </View>
          {qr && (
            <View style={s.qr}>
              <QRCode data={url} pieceSize={5} />
            </View>
          )}
          <View style={s.brand}>
            <Link2 size={15} color={cl.ink62} />
            <Text style={[s.muted, { flex: 1 }]}>
              One live link. Saved changes update it for everyone.
            </Text>
          </View>
        </View>
      )}
      <Text style={s.privacy}>
        Only your name, bio and selected links are shared. Your notes and relationships stay
        private.
      </Text>
    </View>
  );
}
const s = StyleSheet.create({
  section: { gap: 16 },
  loading: { padding: 32, gap: 12, alignItems: 'center' },
  card: {
    borderRadius: 32,
    padding: 24,
    gap: 18,
    borderWidth: 1,
    borderColor: '#eee8de',
    overflow: 'hidden',
  },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rock: { width: 26, height: 38, resizeMode: 'contain' },
  wordmark: { fontFamily: 'Newsreader_500Medium', fontSize: 32, color: cl.ink },
  tag: { fontFamily: 'Outfit_500Medium', fontSize: 11, letterSpacing: 2, color: cl.ink62 },
  name: {
    fontFamily: 'Outfit_500Medium',
    fontSize: 32,
    lineHeight: 39,
    letterSpacing: -0.8,
    color: cl.ink,
    marginTop: 10,
  },
  bio: { fontFamily: 'Outfit_400Regular', fontSize: 17, lineHeight: 25, color: cl.ink62 },
  previewLinks: { gap: 8 },
  link: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 18,
    padding: 15,
    backgroundColor: '#ffffffcc',
    borderWidth: 1,
    borderColor: '#eee9e1',
  },
  previewLabel: {
    fontFamily: 'Outfit_500Medium',
    fontSize: 10,
    letterSpacing: 1.4,
    color: cl.ink62,
    marginTop: 12,
  },
  body: { fontFamily: 'Outfit_400Regular', fontSize: 16, lineHeight: 23, color: cl.ink },
  muted: { fontFamily: 'Outfit_400Regular', fontSize: 13, lineHeight: 19, color: cl.ink62 },
  heading: { fontFamily: 'Outfit_500Medium', fontSize: 18, color: cl.ink },
  small: { minHeight: 44, padding: 10, justifyContent: 'center', borderRadius: 16 },
  action: { fontFamily: 'Outfit_500Medium', fontSize: 15, color: cl.goldDeep },
  links: { gap: 12 },
  linkEditor: { gap: 16, padding: 16, borderRadius: 24, backgroundColor: '#f8f7f4' },
  types: { flexDirection: 'row', gap: 5, flexWrap: 'wrap' },
  selected: { backgroundColor: '#eee3d1' },
  add: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
  },
  primary: {
    minHeight: 56,
    borderRadius: 28,
    padding: 16,
    backgroundColor: cl.ink,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  primaryText: { fontFamily: 'Outfit_500Medium', fontSize: 16, color: 'white' },
  qr: { alignSelf: 'center', backgroundColor: 'white', padding: 22, borderRadius: 24 },
  privacy: { fontFamily: 'Outfit_400Regular', fontSize: 13, lineHeight: 20, color: cl.ink62 },
});
