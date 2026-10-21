import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Check, Globe, Search, X } from 'lucide-react-native';
import { Avatar } from './Avatar';
import { Text } from './Text';
import { useContacts } from '../lib/useContacts';
import { useCircles } from '../lib/circles';
import {
  createShare,
  listSharesForItem,
  unshare,
  type ShareItemType,
  type ShareScopeType,
} from '../lib/shares';
import { toast } from '../lib/toast';
import { LIGHT } from '../lib/theme';
import { elevation, radius, spacing, typography } from '../lib/tokens';
import { filterPeople } from '../lib/peopleSearch';

// One audience key so current state, in-flight state, and toggles all agree.
function keyOf(scopeType: ShareScopeType, scopeRef: string | null): string {
  return `${scopeType}:${scopeRef ?? ''}`;
}

// The share sheet: pick who can see one item. Toggling a row writes a share (or
// removes it) immediately, and reflects what's already shared so you can turn a
// scope back off. View-only for the recipients; this screen is the control.
export function ShareSheet({
  visible,
  itemType,
  itemId,
  itemLabel,
  onClose,
}: {
  visible: boolean;
  itemType: ShareItemType;
  itemId: string;
  itemLabel?: string;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const contacts = useContacts();
  const circles = useCircles();
  // Only the caller's OWN circles are shareable audiences (not inbound ones).
  const ownCircles = useMemo(
    () => (circles.status === 'done' ? circles.items.filter((c) => c.origin !== 'inbound') : []),
    [circles.status, circles.items],
  );

  const [shared, setShared] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');

  // Load what this item is already shared to whenever the sheet opens.
  const loadedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!visible) {
      loadedFor.current = null;
      return;
    }
    if (loadedFor.current === itemId) return;
    loadedFor.current = itemId;
    let cancelled = false;
    setLoading(true);
    void listSharesForItem(itemType, itemId).then((res) => {
      if (cancelled) return;
      const next = new Set<string>();
      if (res.ok) for (const s of res.data.shares) next.add(keyOf(s.scopeType, s.scopeRef));
      setShared(next);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [visible, itemId, itemType]);

  const toggle = (scopeType: ShareScopeType, scopeRef: string | null) => {
    const key = keyOf(scopeType, scopeRef);
    if (busy.has(key)) return;
    const isOn = shared.has(key);
    setBusy((b) => new Set(b).add(key));
    // Optimistic flip.
    setShared((s) => {
      const next = new Set(s);
      if (isOn) next.delete(key);
      else next.add(key);
      return next;
    });
    const call = isOn
      ? unshare({ itemType, itemId, scopeType, scopeRef })
      : createShare({ itemType, itemId, scopeType, scopeRef });
    void call.then((res) => {
      if (!res.ok) {
        // Revert on failure.
        setShared((s) => {
          const next = new Set(s);
          if (isOn) next.add(key);
          else next.delete(key);
          return next;
        });
        toast.error(isOn ? 'Could not unshare.' : 'Could not share.');
      }
      setBusy((b) => {
        const next = new Set(b);
        next.delete(key);
        return next;
      });
    });
  };

  // One matcher for every people list -- see lib/peopleSearch.ts. This copy also
  // searched three fields where the contacts page searched four, so the same
  // query returned different people depending on which sheet you were in.
  const filteredContacts = useMemo(() => {
    const base = contacts.status === 'done' ? contacts.items : [];
    return filterPeople(base, query).slice(0, 40);
  }, [contacts.status, contacts.items, query]);

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(32,31,29,0.35)', justifyContent: 'flex-end' }}>
        <View
          style={{
            maxHeight: '86%',
            backgroundColor: LIGHT.canvas,
            borderTopLeftRadius: 22,
            borderTopRightRadius: 22,
            paddingTop: spacing.base,
            paddingBottom: insets.bottom + spacing.base,
          }}
        >
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingHorizontal: spacing.lg,
              paddingBottom: spacing.sm,
            }}
          >
            <View style={{ flex: 1, paddingRight: spacing.md }}>
              <Text variant="titleMd" style={{ color: LIGHT.textPrimary }}>
                Share
              </Text>
              {itemLabel ? (
                <Text variant="captionSm" numberOfLines={1} style={{ color: LIGHT.textSecondary }}>
                  {itemLabel}
                </Text>
              ) : null}
            </View>
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close"
              hitSlop={10}
              style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
            >
              <View
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: radius.full,
                  backgroundColor: LIGHT.surface,
                  borderWidth: 1,
                  borderColor: LIGHT.hairline,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <X color={LIGHT.textPrimary} size={18} />
              </View>
            </Pressable>
          </View>

          {loading ? (
            <View style={{ paddingVertical: spacing.xl, alignItems: 'center' }}>
              <ActivityIndicator color={LIGHT.textMuted} />
            </View>
          ) : (
            <ScrollView
              keyboardShouldPersistTaps="handled"
              automaticallyAdjustKeyboardInsets
              keyboardDismissMode="interactive"
              contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.lg }}
            >
              {/* Whole network */}
              <ToggleRow
                title="Your whole network"
                subtitle="Everyone you're connected with on Amber"
                on={shared.has(keyOf('network', null))}
                busy={busy.has(keyOf('network', null))}
                leading={
                  <View style={iconCircle}>
                    <Globe color={LIGHT.accentText} size={18} strokeWidth={2.25} />
                  </View>
                }
                onPress={() => toggle('network', null)}
              />

              {ownCircles.length > 0 ? (
                <>
                  <Text variant="microLabel" uppercase style={{ marginTop: spacing.base, marginBottom: spacing.xs }}>
                    Circles
                  </Text>
                  {ownCircles.map((c) => (
                    <ToggleRow
                      key={c.id}
                      title={c.name}
                      subtitle={`${c.memberCount} ${c.memberCount === 1 ? 'person' : 'people'}`}
                      on={shared.has(keyOf('circle', c.id))}
                      busy={busy.has(keyOf('circle', c.id))}
                      leading={
                        <View style={iconCircle}>
                          <Text variant="titleSm" style={{ color: LIGHT.accentText }}>
                            {c.name.trim().charAt(0).toUpperCase()}
                          </Text>
                        </View>
                      }
                      onPress={() => toggle('circle', c.id)}
                    />
                  ))}
                </>
              ) : null}

              <Text variant="microLabel" uppercase style={{ marginTop: spacing.base, marginBottom: spacing.xs }}>
                One person
              </Text>
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: spacing.sm,
                  backgroundColor: LIGHT.surface,
                  borderRadius: radius.lg,
                  borderWidth: 1,
                  borderColor: LIGHT.hairline,
                  paddingHorizontal: spacing.base,
                  height: 42,
                  marginBottom: spacing.sm,
                }}
              >
                <Search color={LIGHT.textMuted} size={16} strokeWidth={2.25} />
                <TextInput
                  value={query}
                  onChangeText={setQuery}
                  placeholder="Search people…"
                  placeholderTextColor={LIGHT.textMuted}
                  autoCapitalize="none"
                  autoCorrect={false}
                  style={{
                    flex: 1,
                    color: LIGHT.textPrimary,
                    fontFamily: typography.bodyMd.fontFamily,
                    fontSize: typography.bodyMd.fontSize,
                    padding: 0,
                    height: 42,
                  }}
                />
              </View>
              {filteredContacts.map((p) => (
                <ToggleRow
                  key={p.id}
                  title={p.name}
                  on={shared.has(keyOf('contact', p.id))}
                  busy={busy.has(keyOf('contact', p.id))}
                  leading={<Avatar name={p.name} url={p.avatarUrl} size={36} />}
                  onPress={() => toggle('contact', p.id)}
                />
              ))}
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

const iconCircle = {
  width: 36,
  height: 36,
  borderRadius: radius.full,
  backgroundColor: LIGHT.chipBg,
  alignItems: 'center' as const,
  justifyContent: 'center' as const,
};

function ToggleRow({
  title,
  subtitle,
  on,
  busy,
  leading,
  onPress,
}: {
  title: string;
  subtitle?: string;
  on: boolean;
  busy: boolean;
  leading: React.ReactNode;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ selected: on }}
      style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1, marginBottom: spacing.sm })}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.md,
          paddingVertical: spacing.sm,
          paddingHorizontal: spacing.base,
          borderRadius: radius.lg,
          borderWidth: on ? 1.5 : 1,
          borderColor: on ? LIGHT.accent : LIGHT.hairline,
          backgroundColor: on ? LIGHT.chipBg : LIGHT.surface,
          ...elevation.sm,
        }}
      >
        {leading}
        <View style={{ flex: 1 }}>
          <Text variant="titleMd" numberOfLines={1} style={{ color: LIGHT.textPrimary }}>
            {title}
          </Text>
          {subtitle ? (
            <Text variant="captionSm" numberOfLines={1} style={{ color: LIGHT.textMuted }}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        {busy ? (
          <ActivityIndicator color={LIGHT.textMuted} />
        ) : (
          <View
            style={{
              width: 26,
              height: 26,
              borderRadius: radius.full,
              borderWidth: on ? 0 : 1.5,
              borderColor: LIGHT.hairlineStrong,
              backgroundColor: on ? LIGHT.accent : 'transparent',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {on ? <Check color="#FFFFFF" size={15} strokeWidth={2.75} /> : null}
          </View>
        )}
      </View>
    </Pressable>
  );
}
