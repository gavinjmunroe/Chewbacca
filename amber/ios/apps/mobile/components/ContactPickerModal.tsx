import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Modal, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Search, X } from 'lucide-react-native';
import { Pressable } from './Pressable';
import { Avatar } from './Avatar';
import { CText } from './classical';
import { cl, HAIRLINE } from '../lib/classical';
import { searchMyContacts } from '../lib/pending';

/**
 * PICK ONE OF YOUR CONTACTS. One component, wherever that is the question.
 *
 * There were three places asking it and no shared answer: the reconciliation
 * card's "choose another contact" field, the circle editor's add-people list,
 * and — the one that did not exist at all — correcting a wrong tag on a note.
 * Each had its own field, its own debounce and its own empty state.
 *
 * Server-side search, not a local filter over a loaded address book. On 974
 * contacts the local version is the reason the DM picker used to hang: it sent
 * the ids of everything matching so the server could resolve them one at a
 * time. `/v1/me/contacts/search` answers the question in one query.
 */
export type PickedContact = { id: string; name: string };

export function ContactPickerModal({
  visible,
  title,
  subtitle,
  onPick,
  onClose,
}: {
  visible: boolean;
  title: string;
  /** Why the picker is open — e.g. the sentence the wrong name came out of. */
  subtitle?: string | null;
  onPick: (contact: PickedContact) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<PickedContact[]>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  // Reset between openings. Without this the picker opens showing whoever was
  // searched for last time, which reads as a suggestion.
  useEffect(() => {
    if (!visible) {
      setQ('');
      setRows([]);
      setFailed(false);
    }
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    const needle = q.trim();
    if (needle.length < 2) {
      setRows([]);
      setLoading(false);
      return;
    }
    let alive = true;
    setLoading(true);
    setFailed(false);
    const t = setTimeout(async () => {
      // A CATCH, because callMedhaId can reject rather than resolve, and an
      // unhandled rejection in here leaves the spinner up forever with no error
      // state — which is exactly how the DM picker looked broken.
      try {
        const res = await searchMyContacts(needle);
        if (!alive) return;
        if (res.ok) {
          setRows(
            (res.data.contacts ?? []).map((c) => ({ id: String(c.id), name: c.name ?? '' })),
          );
        } else {
          setFailed(true);
        }
      } catch {
        if (alive) setFailed(true);
      } finally {
        if (alive) setLoading(false);
      }
    }, 220);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [visible, q]);

  const pick = useCallback(
    (c: PickedContact) => {
      onPick(c);
      onClose();
    },
    [onPick, onClose],
  );

  return (
    <Modal visible={visible} animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: cl.groundCream }}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'flex-start',
            gap: 10,
            paddingHorizontal: 16,
            // From the real inset plus room. A hardcoded number here is what put
            // "New message" hard against the notch on a Dynamic Island phone.
            paddingTop: insets.top + 40,
            paddingBottom: 14,
          }}
        >
          <View style={{ flex: 1, gap: 3 }}>
            <CText t="cardTitle" style={{ fontSize: 19 }}>
              {title}
            </CText>
            {subtitle ? (
              <CText t="metaSm" color={cl.ink48} numberOfLines={2}>
                {subtitle}
              </CText>
            ) : null}
          </View>
          <Pressable onPress={onClose} accessibilityLabel="Close" hitSlop={12}>
            <X size={20} color={cl.ink48} strokeWidth={2.2} />
          </Pressable>
        </View>

        <View style={{ paddingHorizontal: 16, paddingBottom: 12 }}>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 9,
              paddingHorizontal: 12,
              height: 42,
              borderRadius: 999,
              backgroundColor: cl.card,
              borderWidth: HAIRLINE,
              borderColor: cl.gold22,
            }}
          >
            <Search size={16} color={cl.ink38} strokeWidth={2} />
            <TextInput
              value={q}
              onChangeText={setQ}
              placeholder="Search your contacts"
              placeholderTextColor={cl.ink38}
              autoFocus
              autoCorrect={false}
              style={{ flex: 1, fontSize: 15, color: cl.ink }}
            />
            {loading ? <ActivityIndicator size="small" color={cl.gold55} /> : null}
          </View>
        </View>

        <FlatList
          data={rows}
          keyExtractor={(c) => c.id}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 24 }}
          ListEmptyComponent={
            <View style={{ paddingTop: 36, alignItems: 'center', paddingHorizontal: 24 }}>
              <CText t="metaSm" color={cl.ink48} style={{ textAlign: 'center' }}>
                {failed
                  ? // "Nobody by that name" and "we could not ask" are different
                    // sentences and the difference matters to whoever is stuck.
                    'Could not search your contacts just now.'
                  : q.trim().length < 2
                    ? 'Type a name to search.'
                    : loading
                      ? ' '
                      : 'Nobody here by that name.'}
              </CText>
            </View>
          }
          renderItem={({ item }) => (
            <Pressable
              onPress={() => pick(item)}
              accessibilityRole="button"
              accessibilityLabel={`Choose ${item.name}`}
              style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
            >
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 12,
                  paddingVertical: 12,
                  borderBottomWidth: HAIRLINE,
                  borderBottomColor: cl.gold12,
                }}
              >
                <Avatar name={item.name || undefined} size={32} />
                <CText t="body" color={cl.ink} numberOfLines={1} style={{ flex: 1 }}>
                  {item.name || 'Unnamed'}
                </CText>
              </View>
            </Pressable>
          )}
        />
      </View>
    </Modal>
  );
}
