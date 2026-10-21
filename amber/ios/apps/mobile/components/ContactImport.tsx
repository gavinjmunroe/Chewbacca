import { config } from '../lib/config';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, StyleSheet, Text, View } from 'react-native';
import * as Contacts from 'expo-contacts';
import { requireOptionalNativeModule } from 'expo-modules-core';
import * as FileSystem from 'expo-file-system/legacy';
import { Camera, FileUp, UserPlus, Check, X } from 'lucide-react-native';
import { Pressable } from './Pressable';
import { TextInput } from './TextInput';
import { previewContactImport } from '../lib/contactImport';
import { findAppleContacts, saveToAppleContacts } from '../lib/appleContactWrite';
import { syncAppleContactById } from '../lib/contactsSync';
import { linkedinKey, type ContactExport } from '../lib/contactExport';
import { cl } from '../lib/classical';

type Matches = Awaited<ReturnType<typeof findAppleContacts>>;
/** Every entry point ends at the same explicit, additive Apple -> Amber save. */
export function ContactImport({ importIntent }: { importIntent?: string }) {
  const [open, setOpen] = useState(!!importIntent),
    [scan, setScan] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [success, setSuccess] = useState('');
  const [drafts, setDrafts] = useState<ContactExport[]>([]),
    [index, setIndex] = useState(0),
    [matches, setMatches] = useState<Matches | null>(null),
    [selected, setSelected] = useState<string | null | undefined>(undefined),
    [extra, setExtra] = useState<Contacts.ExistingContact | null>(null);
  const [checked, setChecked] = useState(false),
    [reload, setReload] = useState(0);
  const locked = useRef(false),
    savedApple = useRef<string | null>(null);
  const draft = drafts[index];
  const draftKey = JSON.stringify(draft || null);
  const readRef = useRef(read);
  readRef.current = read;
  useEffect(() => {
    if (!importIntent) return;
    setOpen(true);
    if (!importIntent.startsWith('file:')) {
      void readRef.current({ text: config.medhaIdBaseUrl + '/card/' + importIntent });
      return;
    }
    void (async () => {
      try {
        const base = FileSystem.documentDirectory;
        if (!base) throw Error('File access unavailable.');
        const uri = new URL(importIntent);
        const inbox = new URL(base + 'Inbox/');
        if (
          uri.protocol !== 'file:' ||
          !uri.pathname.startsWith(inbox.pathname) ||
          /(^|\/)\.\.(\/|$)/.test(decodeURIComponent(uri.pathname))
        )
          throw Error('Choose this vCard with Import file.');
        const info = await FileSystem.getInfoAsync(importIntent);
        if (!info.exists || info.isDirectory || info.size > 32000)
          throw Error('Choose a smaller vCard or use Import file.');
        const text = await FileSystem.readAsStringAsync(importIntent);
        await readRef.current({ text });
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not open the vCard.');
      }
    })();
  }, [importIntent]);
  useEffect(() => {
    if (!draftKey || draftKey === 'null') return;
    let active = true;
    setMatches(null);
    setChecked(false);
    setSelected(undefined);
    setExtra(null);
    savedApple.current = null;
    void findAppleContacts(JSON.parse(draftKey), true)
      .then((r) => {
        if (active) {
          setMatches(r);
          setChecked(true);
        }
      })
      .catch(() => {
        if (active) setError('Could not check Apple Contacts. Retry before saving.');
      });
    return () => {
      active = false;
    };
  }, [draftKey, reload]);
  async function read(input: Parameters<typeof previewContactImport>[0]) {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError('');
    setSuccess('');
    setScan(false);
    try {
      setDrafts(await previewContactImport(input));
      setIndex(0);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read this card.');
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  async function pickFile() {
    if (locked.current) return;
    setError('');
    try {
      if (!requireOptionalNativeModule('ExpoDocumentPicker'))
        throw Error('Card imports need the next app build. You can enter a contact below now.');
      const picker = await import('expo-document-picker');
      const result = await picker.getDocumentAsync({
        type: [
          'text/vcard',
          'text/x-vcard',
          'text/plain',
          'text/csv',
          'image/*',
          'application/pdf',
        ],
        copyToCacheDirectory: true,
      });
      if (result.canceled) return;
      const file = result.assets[0];
      const info = await FileSystem.getInfoAsync(file.uri);
      if (!info.exists || info.isDirectory || info.size > 8 * 1024 * 1024)
        throw Error('Choose a card or file under 8 MB.');
      try {
        const data = await FileSystem.readAsStringAsync(file.uri, {
          encoding: FileSystem.EncodingType.Base64,
        });
        await read({
          file: { name: file.name, mimeType: file.mimeType || '', size: info.size, data },
        });
      } finally {
        if (file.uri.startsWith(FileSystem.cacheDirectory || 'no-cache:'))
          await FileSystem.deleteAsync(file.uri, { idempotent: true }).catch(() => {});
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not open that file.');
    }
  }
  async function save() {
    if (!draft || locked.current || selected === undefined || !checked) return;
    locked.current = true;
    setBusy(true);
    setError('');
    try {
      if ((draft.emails || []).some((e) => e && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim())))
        throw Error('Check the email address before saving.');
      if ((draft.phoneNumbers || []).some((n) => n && !/^\+?[0-9 ()-]{7,30}$/.test(n.trim())))
        throw Error('Check the phone number before saving.');
      if (draft.linkedin && !linkedinKey(draft.linkedin))
        throw Error('Use a LinkedIn profile URL beginning with https://linkedin.com/in/.');
      const appleId =
        savedApple.current || (await saveToAppleContacts(draft, selected || undefined));
      savedApple.current = appleId;
      const result = await syncAppleContactById(appleId);
      if (!result.ok || result.failed)
        throw Error('Saved to Apple Contacts. Retry to finish syncing this same card to Amber.');
      setSuccess('Saved to Apple Contacts and Amber.');
      setDrafts((old) => old.filter((_, i) => i !== index));
      setIndex(0);
      savedApple.current = null;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save this contact.');
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  function edit(patch: Partial<ContactExport>) {
    if (savedApple.current) return;
    setDrafts((old) => old.map((d, i) => (i === index ? { ...d, ...patch } : d)));
  }
  const candidates = [
    ...(matches?.exact || []),
    ...(matches?.candidates || []),
    ...(extra ? [extra] : []),
  ].filter((c, i, all) => all.findIndex((a) => a.id === c.id) === i);
  return (
    <View style={s.box}>
      <Pressable onPress={() => setOpen(!open)} style={s.row}>
        <UserPlus size={21} color={cl.goldDeep} />
        <View style={{ flex: 1 }}>
          <Text style={s.title}>Add someone</Text>
          <Text style={s.caption}>Scan a card, a QR code, or import a vCard</Text>
        </View>
      </Pressable>
      {open && (
        <View style={s.section}>
          <View style={s.actions}>
            <Pressable
              disabled={busy}
              style={s.button}
              onPress={() => {
                setError('');
                if (!requireOptionalNativeModule('ExpoCamera')) {
                  setError(
                    'Scanning needs the next app build. Import a file or enter details for now.',
                  );
                  return;
                }
                setScan(true);
              }}
            >
              <Camera size={19} color={cl.ink} />
              <Text style={s.body}>Scan</Text>
            </Pressable>
            <Pressable disabled={busy} style={s.button} onPress={() => void pickFile()}>
              <FileUp size={19} color={cl.ink} />
              <Text style={s.body}>Import file</Text>
            </Pressable>
          </View>
          {scan && <CardCamera onRead={read} onClose={() => setScan(false)} />}
          {!draft && !busy && (
            <Pressable
              style={s.button}
              onPress={() => {
                setDrafts([{ name: '', emails: [], phoneNumbers: [] }]);
                setIndex(0);
                setSuccess('');
              }}
            >
              <Text style={s.action}>Enter details</Text>
            </Pressable>
          )}
          {busy && <ActivityIndicator color={cl.goldDeep} />}
          {!!success && <Text style={s.body}>{success}</Text>}
          {!!error && (
            <Text style={s.body} accessibilityRole="alert">
              {error}
            </Text>
          )}
          {draft && (
            <View style={s.section}>
              <View style={s.row}>
                <Text style={[s.title, { flex: 1 }]}>
                  Review contact{drafts.length > 1 ? ' · ' + drafts.length + ' remaining' : ''}
                </Text>
                <Pressable
                  disabled={busy}
                  accessibilityLabel="Discard this draft"
                  style={s.button}
                  onPress={() => {
                    setDrafts((old) => old.filter((_, i) => i !== index));
                    setIndex(0);
                  }}
                >
                  <X size={19} color={cl.ink} />
                </Pressable>
              </View>
              <TextInput
                label="Full name"
                value={draft.name}
                editable={!busy && !savedApple.current}
                onChangeText={(name) => edit({ name })}
              />
              <TextInput
                label="Email"
                value={draft.emails?.[0] || ''}
                autoCapitalize="none"
                keyboardType="email-address"
                editable={!busy && !savedApple.current}
                onChangeText={(value) =>
                  edit({ emails: [value, ...(draft.emails || []).slice(1)] })
                }
              />
              <TextInput
                label="Phone"
                value={draft.phoneNumbers?.[0] || ''}
                keyboardType="phone-pad"
                editable={!busy && !savedApple.current}
                onChangeText={(value) =>
                  edit({ phoneNumbers: [value, ...(draft.phoneNumbers || []).slice(1)] })
                }
              />
              {(draft.emails || []).slice(1).map((v, i) => (
                <Text key={'e' + i} style={s.caption}>
                  Additional email: {v}
                </Text>
              ))}
              {(draft.phoneNumbers || []).slice(1).map((v, i) => (
                <Text key={'p' + i} style={s.caption}>
                  Additional phone: {v}
                </Text>
              ))}
              <TextInput
                label="Company"
                value={draft.company || ''}
                editable={!busy && !savedApple.current}
                onChangeText={(company) => edit({ company })}
              />
              <TextInput
                label="LinkedIn"
                value={draft.linkedin || ''}
                autoCapitalize="none"
                editable={!busy && !savedApple.current}
                onChangeText={(linkedin) => edit({ linkedin })}
              />
              <Text style={s.caption}>
                Review the match. Existing details are preserved; new details are added alongside
                them.
              </Text>
              {!checked ? (
                <Pressable style={s.button} onPress={() => setReload((v) => v + 1)}>
                  <Text style={s.body}>Checking contacts · Tap to retry</Text>
                </Pressable>
              ) : !matches?.access ? (
                <Pressable style={s.button} onPress={() => void Linking.openSettings()}>
                  <Text style={s.body}>Allow Contacts access in Settings</Text>
                </Pressable>
              ) : (
                <>
                  {candidates.map((c) => (
                    <Pressable
                      key={c.id}
                      disabled={busy}
                      style={[s.match, selected === c.id && s.chosen]}
                      onPress={() => setSelected(c.id)}
                    >
                      <Text style={s.body}>{c.name}</Text>
                      <Text style={s.caption}>
                        {c.company ||
                          c.emails?.[0]?.email ||
                          c.phoneNumbers?.[0]?.number ||
                          'Existing Apple contact'}
                      </Text>
                      {selected === c.id && <Check size={17} color={cl.goldDeep} />}
                    </Pressable>
                  ))}
                  <Pressable
                    disabled={busy}
                    style={s.button}
                    onPress={() =>
                      void Contacts.presentContactPickerAsync()
                        .then((c) => {
                          if (c) {
                            setExtra(c);
                            setSelected(c.id);
                          }
                        })
                        .catch(() => setError('Could not open Apple Contacts.'))
                    }
                  >
                    <Text style={s.action}>Choose an existing contact</Text>
                  </Pressable>
                  {!matches.limited && !candidates.length && (
                    <Pressable
                      disabled={busy}
                      style={[s.match, selected === null && s.chosen]}
                      onPress={() => setSelected(null)}
                    >
                      <Text style={s.body}>Create a new contact</Text>
                      {selected === null && <Check size={17} color={cl.goldDeep} />}
                    </Pressable>
                  )}
                  {!!candidates.length && (
                    <Text style={s.caption}>
                      A possible match was found. Select the existing card or resolve it in Apple
                      Contacts before creating another.
                    </Text>
                  )}
                </>
              )}
              <Pressable
                disabled={busy || selected === undefined || !draft.name.trim() || !checked}
                onPress={() => void save()}
                style={[
                  s.save,
                  (busy || selected === undefined || !draft.name.trim()) && { opacity: 0.4 },
                ]}
              >
                <Text style={s.saveText}>
                  {busy
                    ? 'Saving…'
                    : savedApple.current
                      ? 'Retry Amber sync'
                      : 'Save to Apple & Amber'}
                </Text>
              </Pressable>
            </View>
          )}
        </View>
      )}
    </View>
  );
}
function CardCamera({
  onRead,
  onClose,
}: {
  onRead: (input: Parameters<typeof previewContactImport>[0]) => Promise<void>;
  onClose: () => void;
}) {
  // Loaded only after the native availability gate, allowing older TestFlight builds to keep opening.
  const { CameraView, useCameraPermissions } =
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- Older binaries must pass the native availability check first.
    require('expo-camera') as typeof import('expo-camera');
  const [permission, request] = useCameraPermissions();
  const camera = useRef<import('expo-camera').CameraView>(null);
  const lock = useRef(false);
  const [ready, setReady] = useState(false),
    [error, setError] = useState('');
  async function photo() {
    if (!ready || lock.current) return;
    lock.current = true;
    setError('');
    try {
      const p = await camera.current?.takePictureAsync({ base64: true, quality: 0.6 });
      if (!p?.base64) throw Error('Could not take a photo.');
      await onRead({
        file: {
          name: 'business-card.jpg',
          mimeType: 'image/jpeg',
          data: p.base64,
          size: Math.ceil(p.base64.length * 0.75),
        },
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Try again.');
      lock.current = false;
    }
  }
  return (
    <View style={s.section}>
      <Pressable style={s.button} onPress={onClose}>
        <Text style={s.body}>Close camera</Text>
      </Pressable>
      {!permission?.granted ? (
        <Pressable
          style={s.button}
          onPress={() => (permission?.canAskAgain ? void request() : void Linking.openSettings())}
        >
          <Text style={s.body}>Allow camera access</Text>
        </Pressable>
      ) : (
        <>
          <CameraView
            ref={camera}
            style={{ height: 280, borderRadius: 22 }}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onCameraReady={() => setReady(true)}
            onMountError={() =>
              setError('Camera unavailable here. Use a physical iPhone or import a file.')
            }
            onBarcodeScanned={(e) => {
              if (!lock.current) {
                lock.current = true;
                void onRead({ text: e.data });
              }
            }}
          />
          <Pressable disabled={!ready} style={s.button} onPress={() => void photo()}>
            <Camera size={19} color={cl.ink} />
            <Text style={s.body}>Capture business card</Text>
          </Pressable>
        </>
      )}
      {!!error && <Text style={s.body}>{error}</Text>}
    </View>
  );
}
const s = StyleSheet.create({
  box: { padding: 18, borderRadius: 28, borderWidth: 1, borderColor: cl.rule, gap: 18 },
  section: { gap: 14 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52 },
  title: { fontFamily: 'Outfit_500Medium', fontSize: 18, color: cl.ink },
  caption: { fontFamily: 'Outfit_400Regular', fontSize: 13, lineHeight: 20, color: cl.ink62 },
  body: { fontFamily: 'Outfit_400Regular', fontSize: 16, lineHeight: 23, color: cl.ink },
  action: { fontFamily: 'Outfit_500Medium', fontSize: 15, color: cl.goldDeep },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  button: {
    minHeight: 44,
    padding: 10,
    borderRadius: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  match: { padding: 16, borderWidth: 1, borderColor: cl.rule, borderRadius: 20, gap: 4 },
  chosen: { borderColor: cl.goldDeep, backgroundColor: cl.groundGold },
  save: {
    backgroundColor: cl.ink,
    padding: 16,
    borderRadius: 28,
    minHeight: 54,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveText: { fontFamily: 'Outfit_500Medium', fontSize: 16, color: 'white' },
});
