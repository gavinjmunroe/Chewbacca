import { HealthSummaryPreview } from './HealthSummaryPreview';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Activity, Heart, Images, MapPin, Users } from 'lucide-react-native';
import {
  APPLE_PERMISSIONS,
  getApplePermission,
  permissionAction,
  permissionLabel,
  performApplePermissionAction,
  HEALTH_MANAGEMENT_INSTRUCTIONS,
  type ApplePermission,
  type PermissionState,
} from '../lib/applePermissions';
import { cl } from '../lib/classical';

const icons = {
  location: MapPin,
  contacts: Users,
  photos: Images,
  health: Heart,
  fitness: Activity,
};
const initial = Object.fromEntries(
  APPLE_PERMISSIONS.map(({ key }) => [key, 'notDetermined']),
) as Record<ApplePermission, PermissionState>;
/** Demo selections never call iOS or claim that device access was granted. */
export function ApplePermissions({
  demo = false,
  demoPermissions,
  onDemoChange,
}: {
  demo?: boolean;
  demoPermissions?: ApplePermission[];
  onDemoChange?: (permissions: ApplePermission[]) => void;
}) {
  const [states, setStates] = useState(initial);
  const [demoSelected, setDemoSelected] = useState<ApplePermission[]>([]);
  const demoChoices = demoPermissions ?? demoSelected;
  const [busy, setBusy] = useState<ApplePermission | null>(null);
  const [message, setMessage] = useState('');
  const lock = useRef(false);
  const refresh = useCallback(async () => {
    if (demo) return;
    const pairs = await Promise.all(
      APPLE_PERMISSIONS.map(async ({ key }) => [
        key,
        await getApplePermission(key).catch(() => 'unavailable'),
      ]),
    );
    setStates(Object.fromEntries(pairs));
  }, [demo]);
  useEffect(() => {
    void refresh();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refresh();
    });
    return () => subscription.remove();
  }, [refresh]);
  async function choose(kind: ApplePermission) {
    if (demo) {
      const selected = demoChoices.includes(kind)
        ? demoChoices.filter((value) => value !== kind)
        : [...demoChoices, kind];
      if (onDemoChange) onDemoChange(selected);
      else setDemoSelected(selected);
      return;
    }
    if (lock.current) return;
    const current = states[kind];
    lock.current = true;
    setBusy(kind);
    setMessage('');
    try {
      const result = await performApplePermissionAction(kind, current);
      if (result.kind === 'instructions') {
        setMessage(result.message);
        return;
      }
      if (result.kind === 'settings') {
        await Linking.openSettings().catch(() =>
          setMessage('Open iPhone Settings to adjust access for Amber.'),
        );
        return;
      }
      setStates((values) => ({ ...values, [kind]: result.status }));
      if (kind === 'health' && result.status === 'reviewed')
        setMessage(HEALTH_MANAGEMENT_INSTRUCTIONS);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : 'Could not request permission. Please retry.',
      );
    } finally {
      lock.current = false;
      setBusy(null);
    }
  }
  return (
    <View style={s.container}>
      <Text style={s.heading}>Make Amber yours</Text>
      <Text style={s.description}>
        {demo
          ? 'Try each choice in this demo. Device permissions are unchanged.'
          : 'Everything here is optional. Choose what helps you; you can continue without granting access.'}
      </Text>
      {APPLE_PERMISSIONS.map(({ key, title, purpose }) => {
        const Icon = icons[key];
        const status = demo
          ? demoChoices.includes(key)
            ? 'Selected for demo'
            : 'Off in demo'
          : permissionLabel(states[key]);
        const unavailable = !demo && states[key] === 'unavailable';
        return (
          <View key={key}>
            {key === 'health' && <Text style={s.group}>HEALTH & FITNESS</Text>}
            <View style={s.row}>
              <View style={s.icon}>
                <Icon size={19} color={cl.goldDeep} />
              </View>
              <View style={s.copy}>
                <Text style={s.title}>{title}</Text>
                <Text style={s.purpose}>{purpose}</Text>
                <Text style={s.status}>{status}</Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${demo ? 'Toggle demo' : permissionAction(states[key])} ${title} permission`}
                accessibilityState={{ disabled: !!busy || unavailable }}
                disabled={!!busy || unavailable}
                onPress={() => void choose(key)}
                style={[s.button, unavailable && s.unavailable]}
              >
                {busy === key ? (
                  <ActivityIndicator size="small" color={cl.goldDeep} />
                ) : (
                  <Text style={s.action}>
                    {demo
                      ? demoChoices.includes(key)
                        ? 'Remove'
                        : 'Try'
                      : unavailable
                        ? '—'
                        : permissionAction(states[key])}
                  </Text>
                )}
              </Pressable>
            </View>
          </View>
        );
      })}
      {!demo && states.health === 'reviewed' && <HealthSummaryPreview />}
      {!!message && (
        <Text accessibilityLiveRegion="polite" style={s.description}>
          {message}
        </Text>
      )}
      {!demo && (
        <Text style={s.footnote}>
          Permission does not upload data or share your location. Contacts are imported only when
          you choose Import contacts. Photos are attached individually. Health summaries are
          previewed before you choose to save; location is not uploaded automatically.
        </Text>
      )}
    </View>
  );
}
const s = StyleSheet.create({
  container: { gap: 12 },
  heading: { fontFamily: 'Outfit_500Medium', fontSize: 18, color: cl.ink },
  description: { fontFamily: 'Outfit_400Regular', fontSize: 12, lineHeight: 18, color: cl.ink62 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: cl.cardHairline,
  },
  icon: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: cl.groundGold,
    borderRadius: 12,
  },
  copy: { flex: 1, gap: 4 },
  title: { fontFamily: 'Outfit_500Medium', fontSize: 13, color: cl.ink },
  purpose: { fontFamily: 'Outfit_400Regular', fontSize: 11, lineHeight: 15, color: cl.ink62 },
  status: { fontFamily: 'Outfit_500Medium', fontSize: 10, color: cl.goldDeep },
  button: {
    minWidth: 62,
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 16,
    backgroundColor: cl.groundGold,
  },
  action: { fontFamily: 'Outfit_500Medium', fontSize: 11, color: cl.goldDeep },
  unavailable: { opacity: 0.45 },
  group: {
    fontFamily: 'Outfit_500Medium',
    fontSize: 9,
    letterSpacing: 1,
    color: cl.ink62,
    paddingTop: 8,
    paddingBottom: 5,
  },
  footnote: { fontFamily: 'Outfit_400Regular', fontSize: 10, lineHeight: 15, color: cl.ink62 },
});
