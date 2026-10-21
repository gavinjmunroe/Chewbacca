import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Check } from 'lucide-react-native';
import { Pressable } from './Pressable';
import { Avatar } from './Avatar';
import { CText } from './classical';
import { cl, HAIRLINE } from '../lib/classical';
import { getLinkSuggestions, linkContactToAccount, type LinkSuggestion } from '../lib/contactLinks';
import { toast } from '../lib/toast';

/**
 * "I FOUND ANOTHER SAGAR TIWARI IN YOUR CONTACTS. IS THAT THIS ONE?"
 *
 * Asked ONCE, on connect, which is the moment the answer is obvious and the
 * moment it matters. Before this, a connection with somebody whose card could
 * not be PROVEN to be theirs stayed unlinked forever, and everything downstream
 * quietly did nothing: their circle membership never resolved to their account,
 * a note shared with that card never reached their phone, and a notification
 * addressed to them had no recipient.
 *
 * IT OPENS ONLY WHEN THERE IS SOMETHING TO ASK. The suggestions are fetched
 * first and an empty answer closes it without ever being seen — a modal that
 * appears to say "no candidates" is worse than the silence it replaced, because
 * it interrupts to tell you nothing.
 *
 * "None of these" is a real answer and it is the LAST word: the prompt is not
 * repeated, because being asked the same question after saying no is how a
 * feature becomes something people learn to dismiss.
 */
export function LinkContactPrompt({
  visible,
  amberId,
  personName,
  onClose,
  onLinked,
}: {
  visible: boolean;
  /** The account just connected with. */
  amberId: string | null;
  personName: string | null;
  onClose: () => void;
  /** Fired after a successful link, so the caller can refresh what it shows. */
  onLinked?: (contactId: string) => void;
}) {
  const insets = useSafeAreaInsets();
  const [suggestions, setSuggestions] = useState<LinkSuggestion[] | null>(null);
  const [linking, setLinking] = useState<string | null>(null);

  useEffect(() => {
    if (!visible || !amberId) {
      setSuggestions(null);
      return;
    }
    let alive = true;
    void getLinkSuggestions(amberId).then((res) => {
      if (!alive) return;
      const list = res.ok ? (res.data?.suggestions ?? []) : [];
      setSuggestions(list);
      // Nothing to ask: leave without ever appearing.
      if (list.length === 0) onClose();
    });
    return () => {
      alive = false;
    };
    // onClose is intentionally not a dep: it changes identity per render and
    // this must run once per (visible, account) pair.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, amberId]);

  const first = (personName ?? '').trim().split(/\s+/)[0] || 'them';
  const shown = suggestions ?? [];

  return (
    <Modal
      visible={visible && shown.length > 0}
      animationType="fade"
      transparent
      onRequestClose={onClose}
    >
      <Pressable
        onPress={onClose}
        accessibilityLabel="Not now"
        style={{ flex: 1, backgroundColor: 'rgba(32,31,29,0.28)', justifyContent: 'flex-end' }}
      >
        <Pressable
          onPress={() => {}}
          style={{
            backgroundColor: cl.groundCream,
            borderTopLeftRadius: 22,
            borderTopRightRadius: 22,
            paddingHorizontal: 18,
            paddingTop: 18,
            paddingBottom: Math.max(insets.bottom, 12) + 12,
            gap: 4,
          }}
        >
          <CText t="kicker" color={cl.goldKicker}>
            IS THIS THEM?
          </CText>
          <CText t="body" color={cl.ink55} style={{ fontSize: 14, marginTop: 4 }}>
            {`You just connected with ${personName || 'someone'} on Amber. Amber found ${
              shown.length === 1 ? 'a card' : 'cards'
            } in your contacts that could be ${first} — tap the right one and everything filed there becomes theirs.`}
          </CText>

          {suggestions === null ? (
            <View style={{ paddingVertical: 22, alignItems: 'center' }}>
              <ActivityIndicator size="small" color={cl.gold55} />
            </View>
          ) : (
            shown.map((s) => (
              <Pressable
                key={s.contactId}
                disabled={!!linking}
                onPress={async () => {
                  if (!amberId) return;
                  setLinking(s.contactId);
                  const res = await linkContactToAccount(s.contactId, amberId);
                  setLinking(null);
                  if (!res.ok) {
                    toast.error(
                      res.status === 409
                        ? 'That card is already linked to someone else.'
                        : 'Could not link that just now.',
                    );
                    return;
                  }
                  toast.success(`${s.name || 'That card'} is ${personName || 'them'}.`);
                  onLinked?.(s.contactId);
                  onClose();
                }}
                accessibilityRole="button"
                accessibilityLabel={`Yes, ${s.name ?? 'this contact'} is them`}
                style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
              >
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 12,
                    paddingVertical: 13,
                    borderBottomWidth: HAIRLINE,
                    borderBottomColor: cl.gold12,
                  }}
                >
                  <Avatar name={s.name || undefined} size={34} />
                  <View style={{ flex: 1 }}>
                    <CText t="body" color={cl.ink} numberOfLines={1}>
                      {s.name || 'Unnamed contact'}
                    </CText>
                    {s.phone || s.email ? (
                      <CText t="metaSm" color={cl.ink48} numberOfLines={1} style={{ fontSize: 11.5 }}>
                        {s.phone || s.email}
                      </CText>
                    ) : null}
                  </View>
                  {linking === s.contactId ? (
                    <ActivityIndicator size="small" color={cl.gold55} />
                  ) : (
                    <Check size={17} color={cl.goldDeep} strokeWidth={2.2} />
                  )}
                </View>
              </Pressable>
            ))
          )}

          {/* A REAL ANSWER, not a dismissal. Saying no here is the end of it —
              the question is not asked again. */}
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="None of these"
            style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, paddingVertical: 14 })}
          >
            <CText t="metaSm" color={cl.ink48} style={{ textAlign: 'center' }}>
              None of these
            </CText>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
