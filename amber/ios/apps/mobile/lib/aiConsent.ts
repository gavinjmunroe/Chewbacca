import AsyncStorage from '@react-native-async-storage/async-storage';
import { Alert, AppState, Linking } from 'react-native';
import { CryptoDigestAlgorithm, digestStringAsync } from 'expo-crypto';
import { loadSession } from './secureStorage';
import { privacyPolicyUrl } from './config';
import { processingDisclosure, type ProcessingConsent } from './aiConsentPolicy';
const prefix = 'amber_processing_consent_v1:';
let serial: Promise<unknown> = Promise.resolve();
let generation = 0;
const pending = new Map<string, Promise<boolean>>();
async function ownerKey() {
  const session = await loadSession();
  return session ? digestStringAsync(CryptoDigestAlgorithm.SHA256, session.phone) : null;
}
export async function ensureProcessingConsent(kind: ProcessingConsent, signal?: AbortSignal): Promise<boolean> {
  const owner = await ownerKey();
  if (!owner || signal?.aborted) return false;
  const started = generation;
  const key = prefix + owner + ':' + kind;
  if (await AsyncStorage.getItem(key) === 'allowed') return !signal?.aborted;
  if (!pending.has(key)) {
    const task = serial.catch(() => {}).then(async () => {
      if (await ownerKey() !== owner || signal?.aborted || AppState.currentState !== 'active') return false;
      if (await AsyncStorage.getItem(key) === 'allowed') return true;
      const { title, message } = processingDisclosure[kind];
      const allowed = await new Promise<boolean>(resolve => {
        Alert.alert(title, message, [
          { text: 'Not now', style: 'cancel', onPress: () => resolve(false) },
          { text: 'Privacy policy', onPress: () => { resolve(false); void Linking.openURL(privacyPolicyUrl).catch(() => {}); } },
          { text: 'Allow', onPress: () => resolve(true) },
        ], { cancelable: true, onDismiss: () => resolve(false) });
      });
      if (!allowed || started !== generation || await ownerKey() !== owner) return false;
      await AsyncStorage.setItem(key, 'allowed');
      return true;
    }).catch(() => false).finally(() => pending.delete(key));
    pending.set(key, task); serial = task;
  }
  const allowed = await pending.get(key)!;
  return allowed && started === generation && !signal?.aborted && await ownerKey() === owner;
}
export async function revokeProcessingConsent(): Promise<void> {
  generation++;
  const owner = await ownerKey();
  if (owner) await AsyncStorage.multiRemove(['ai', 'research', 'enrichment'].map(kind => prefix + owner + ':' + kind));
}
