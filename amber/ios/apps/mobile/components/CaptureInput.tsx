import { useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { AudioLines, ArrowRight, FilePlus2, X, Paperclip } from 'lucide-react-native';
import { WebView } from 'react-native-webview';
import * as FileSystem from 'expo-file-system/legacy';
import { randomUUID } from 'expo-crypto';
import { readCaptureFile, validateCaptureFile, type CaptureFile } from '../lib/captureInput';
import type { MemoEntry } from '../lib/memoActions';
import { cl } from '../lib/classical';
const picker = `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'"><style>body{margin:0;background:#fcfaf7;font:16px -apple-system}label{display:block;padding:17px;text-align:center;background:#eee7db;border-radius:18px;color:#282622}input{position:absolute;opacity:0;width:1px;height:1px}</style><label for="file">Choose a photo or file</label><input id="file" type="file" accept="image/jpeg,image/png,image/webp,image/gif,.pdf,.docx,.xlsx,.pptx,.rtf,.txt,.md,.csv,.tsv,.json,.vcf,.ics,.xml,audio/*"><script>document.getElementById('file').onchange=function(){var f=this.files[0];if(!f)return;if(f.size>8388608){window.ReactNativeWebView.postMessage(JSON.stringify({error:'Choose a file up to 8 MB.'}));return;}var r=new FileReader();r.onload=function(){window.ReactNativeWebView.postMessage(JSON.stringify({name:f.name,mimeType:f.type,data:r.result.split(',')[1],size:f.size}));};r.onerror=function(){window.ReactNativeWebView.postMessage(JSON.stringify({error:'Could not read this file.'}));};r.readAsDataURL(f);};</script>`;
export function CaptureInput({
  onRecord,
  onCapture,
  onClose,
  sample = false,
}: {
  onRecord: () => void;
  onCapture: (entry: MemoEntry) => void;
  onClose: () => void;
  sample?: boolean;
}) {
  const [text, setText] = useState(''),
    [file, setFile] = useState<CaptureFile | null>(null),
    [picking, setPicking] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const lock = useRef(false);
  async function capture() {
    if (lock.current || (!text.trim() && !file)) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      if (sample && file) throw Error('File processing is available after signing in.');
      const extracted = file ? await readCaptureFile(file) : '';
      const value = [text.trim(), extracted].filter(Boolean).join('\n\n');
      if (value.length > 32000)
        throw Error('Choose a shorter note or document, up to 32,000 characters.');
      const id = randomUUID();
      let source: MemoEntry['source'];
      if (file) {
        if (!FileSystem.documentDirectory) throw Error('File storage is unavailable.');
        const directory = FileSystem.documentDirectory + 'capture/';
        await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
        const uri = directory + id + '.' + (file.name.split('.').pop() || 'bin');
        await FileSystem.writeAsStringAsync(uri, file.data, {
          encoding: FileSystem.EncodingType.Base64,
        });
        source = { name: file.name, mimeType: file.mimeType, uri };
      }
      onCapture({
        id,
        text: value,
        createdAt: new Date().toISOString(),
        destination: 'Needs review',
        source,
        ...(!sample ? { cloud: { conversationId: id, originalText: value } } : {}),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add this. Your draft is still here.');
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={s.content}>
      <View style={s.row}>
        <View style={{ flex: 1 }}>
          <Text style={s.title}>Add to Amber.</Text>
          <Text style={s.hint}>Voice, files, and context for your people and plans.</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close capture"
          disabled={busy}
          onPress={onClose}
          style={s.close}
        >
          <X color={cl.ink} />
        </Pressable>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Record voice memo"
        disabled={busy}
        onPress={onRecord}
        style={s.record}
      >
        <AudioLines size={27} color={cl.goldDeep} />
        <View style={{ flex: 1 }}>
          <Text style={s.body}>Record a voice memo</Text>
          <Text style={s.hint}>Speak once. Review contact updates, plans, and tasks.</Text>
        </View>
        <ArrowRight size={20} color={cl.goldDeep} />
      </Pressable>
      <TextInput
        multiline
        editable={!busy}
        maxLength={32000}
        accessibilityLabel="Note or context for Amber"
        placeholder="What would you like Amber to know or do? Paste a note, a conversation, or a link…"
        value={text}
        onChangeText={setText}
        style={s.input}
      />
      <Pressable
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel="Attach a photo or file"
        onPress={() => setPicking((v) => !v)}
        style={s.row}
      >
        <FilePlus2 size={22} color={cl.goldDeep} />
        <Text style={s.body}>Attach a photo or file</Text>
      </Pressable>
      <Text style={s.hint}>
        Photos · PDF · Documents · Spreadsheets · Audio · Contacts (.vcf) · Calendars (.ics)
      </Text>
      {picking && !busy && (
        <View style={{ height: 58 }}>
          <WebView
            source={{ html: picker }}
            originWhitelist={['about:*']}
            scrollEnabled={false}
            style={{ backgroundColor: cl.ground }}
            onShouldStartLoadWithRequest={(r) =>
              r.url === 'about:blank' || r.url.startsWith('about:srcdoc')
            }
            onMessage={(e) => {
              try {
                const value = JSON.parse(e.nativeEvent.data);
                if (value.error) throw Error(value.error);
                setFile(validateCaptureFile(value));
                setPicking(false);
                setError('');
              } catch (err) {
                setError(err instanceof Error ? err.message : 'Could not open that file.');
              }
            }}
          />
        </View>
      )}
      {file && (
        <View style={s.record}>
          <Paperclip size={18} color={cl.goldDeep} />
          <Text numberOfLines={2} style={[s.body, { flex: 1 }]}>
            {file.name}
          </Text>
          <Pressable
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel="Remove attachment"
            onPress={() => setFile(null)}
            style={s.close}
          >
            <X size={19} color={cl.ink} />
          </Pressable>
        </View>
      )}
      <Text style={s.hint}>Contact updates · Calendar plans · Agent tasks</Text>
      {!!error && (
        <Text accessibilityRole="alert" style={s.body}>
          {error}
        </Text>
      )}
      <Pressable
        accessibilityRole="button"
        disabled={busy || (!text.trim() && !file)}
        onPress={() => void capture()}
        style={[s.submit, { opacity: busy || (!text.trim() && !file) ? 0.5 : 1 }]}
      >
        {busy ? (
          <ActivityIndicator color={cl.card} />
        ) : (
          <Text style={s.submitText}>Find the next steps</Text>
        )}
        <ArrowRight size={20} color={cl.card} />
      </Pressable>
      {busy && (
        <Text accessibilityLiveRegion="polite" style={s.hint}>
          Reading your file securely. The original is saved on this device.
        </Text>
      )}
    </ScrollView>
  );
}
const s = StyleSheet.create({
  content: { padding: 24, gap: 20 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  title: { fontFamily: 'Newsreader_500Medium', fontSize: 32, color: cl.ink },
  body: { fontFamily: 'Outfit_400Regular', fontSize: 16, color: cl.ink },
  hint: { fontFamily: 'Outfit_400Regular', fontSize: 13, lineHeight: 19, color: cl.ink62 },
  close: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  record: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 16,
    borderRadius: 20,
    backgroundColor: cl.groundGold,
  },
  input: {
    minHeight: 150,
    maxHeight: 250,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: cl.cardHairline,
    padding: 17,
    textAlignVertical: 'top',
    fontFamily: 'Outfit_400Regular',
    fontSize: 17,
    lineHeight: 25,
    color: cl.ink,
  },
  submit: {
    minHeight: 54,
    borderRadius: 28,
    backgroundColor: cl.ink,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
  },
  submitText: { fontFamily: 'Outfit_500Medium', fontSize: 16, color: cl.card },
});
