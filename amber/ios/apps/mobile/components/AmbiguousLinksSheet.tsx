import { useState } from 'react';
import { ActivityIndicator, Modal, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Check } from 'lucide-react-native';
import { Pressable } from './Pressable';
import { Avatar } from './Avatar';
import { CText } from './classical';
import { cl, HAIRLINE } from '../lib/classical';
import { linkContactToAccount, type AmbiguousLink } from '../lib/contactLinks';
import { toast } from '../lib/toast';

/**
 * "THIS ONE CARD IS TWO PEOPLE. WHICH ONE IS IT?"
 *
 * A card's identity keys can resolve to more than one Amber account: a shared
 * family email, a recycled work number, a card merged from two sources years
 * ago. The linker REFUSES those deliberately rather than picking one, because
 * picking wrong hands that card's circles and shared notes to a stranger and
 * the mistake is invisible.
 *
 * So they wait for a human, and this is where the human answers. Everything
 * needed to answer is on screen: the card on the left, the accounts it could be
 * on the right, each with the name, the @username and the avatar of an actual
 * person. The server already refused to guess; this asks rather than guessing on
 * its behalf.
 *
 * ONE TAP WRITES THE LINK, and the row leaves the list. Nothing is written by
 * being looked at, and "not sure" is a valid outcome that leaves the card
 * exactly as it is -- unlinked and safe -- rather than forcing a choice between
 * two people the owner may need to go and check.
 */
export function AmbiguousLinksSheet({
  visible,
  links,
  loading = false,
  onClose,
  onResolved,
}: {
  visible: boolean;
  links: AmbiguousLink[];
  loading?: boolean;
  onClose: () => void;
  /** Fired after a link is written, so the caller can refetch the list. */
  onResolved?: (contactId: string) => void;
}) {
  const insets = useSafeAreaInsets();
  const [busy, setBusy] = useState<string | null>(null);
  // Cards answered in this session. Kept locally so the row disappears the
  // instant it is answered rather than after a refetch round trip.
  const [done, setDone] = useState<Record<string, true>>({});

  const remaining = links.filter((l) => !done[l.contactId]);

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <Pressable
        onPress={onClose}
        accessibilityLabel="Close"
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
            maxHeight: '82%',
          }}
        >
          <CText t="kicker" color={cl.goldKicker}>
            WHICH PERSON IS THIS?
          </CText>
          <CText t="body" color={cl.ink55} style={{ fontSize: 14, marginTop: 6 }}>
            {remaining.length === 1
              ? 'One card in your contacts matches two Amber accounts — a shared email, or a number that changed hands. Pick the right person and that card becomes theirs.'
              : 'These cards each match more than one Amber account — a shared email, or a number that changed hands. Pick the right person and the card becomes theirs.'}
          </CText>

          {loading ? (
            <View style={{ paddingVertical: 26, alignItems: 'center' }}>
              <ActivityIndicator size="small" color={cl.gold55} />
            </View>
          ) : remaining.length === 0 ? (
            // Answered everything without closing the sheet. Saying so beats an
            // empty panel, which reads as a failure to load.
            <View style={{ paddingVertical: 26, alignItems: 'center' }}>
              <CText t="body" color={cl.ink48} style={{ fontSize: 14 }}>
                All sorted. Nothing left to decide.
              </CText>
            </View>
          ) : (
            <ScrollView style={{ marginTop: 10 }} contentContainerStyle={{ paddingBottom: 8 }}>
              {remaining.map((link) => (
                <View
                  key={link.contactId}
                  style={{
                    paddingTop: 14,
                    paddingBottom: 6,
                    borderBottomWidth: HAIRLINE,
                    borderBottomColor: cl.gold12,
                  }}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                    <Avatar name={link.name || undefined} size={30} />
                    <CText t="body" color={cl.ink} numberOfLines={1} style={{ flex: 1 }}>
                      {link.name || 'Unnamed contact'}
                    </CText>
                  </View>

                  {/* THE CANDIDATES. An account with no profile row (deleted
                      since its key was written) is deliberately not offered:
                      there is nobody to link to, and an empty row would invite
                      a tap that cannot mean anything. */}
                  {link.accounts.length === 0 ? (
                    <CText t="metaSm" color={cl.ink48} style={{ fontSize: 11.5, marginTop: 8 }}>
                      {`Matches ${link.amberIds.length} accounts we cannot show right now.`}
                    </CText>
                  ) : (
                    link.accounts.map((acct) => (
                      <Pressable
                        key={acct.amberId}
                        disabled={busy != null}
                        onPress={async () => {
                          setBusy(`${link.contactId}:${acct.amberId}`);
                          const res = await linkContactToAccount(link.contactId, acct.amberId);
                          setBusy(null);
                          if (!res.ok) {
                            toast.error(
                              res.status === 409
                                ? 'That card is already linked to someone else.'
                                : 'Could not link that just now.',
                            );
                            return;
                          }
                          setDone((prev) => ({ ...prev, [link.contactId]: true }));
                          toast.success(
                            `${link.name || 'That card'} is ${acct.name || acct.username || 'them'}.`,
                          );
                          onResolved?.(link.contactId);
                        }}
                        accessibilityRole="button"
                        accessibilityLabel={`${link.name ?? 'This card'} is ${
                          acct.name ?? acct.username ?? 'this account'
                        }`}
                        style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
                      >
                        <View
                          style={{
                            flexDirection: 'row',
                            alignItems: 'center',
                            gap: 12,
                            paddingVertical: 11,
                            paddingLeft: 40,
                          }}
                        >
                          <Avatar
                            name={acct.name || acct.username || undefined}
                            url={acct.avatarUrl || undefined}
                            size={32}
                          />
                          <View style={{ flex: 1 }}>
                            <CText t="body" color={cl.ink} numberOfLines={1}>
                              {acct.name || acct.username || 'Amber account'}
                            </CText>
                            {acct.username ? (
                              <CText
                                t="metaSm"
                                color={cl.ink48}
                                numberOfLines={1}
                                style={{ fontSize: 11.5 }}
                              >
                                {`@${acct.username}`}
                              </CText>
                            ) : null}
                          </View>
                          {busy === `${link.contactId}:${acct.amberId}` ? (
                            <ActivityIndicator size="small" color={cl.gold55} />
                          ) : (
                            <Check size={17} color={cl.goldDeep} strokeWidth={2.2} />
                          )}
                        </View>
                      </Pressable>
                    ))
                  )}
                </View>
              ))}
            </ScrollView>
          )}

          {/* NOT ANSWERING IS AN ANSWER. The card stays unlinked, which is the
              safe state -- nothing is handed to the wrong person by closing
              this. It is worth being explicit about, because "skip" on a screen
              full of decisions usually implies something was lost. */}
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Decide later"
            style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, paddingVertical: 14 })}
          >
            <CText t="metaSm" color={cl.ink48} style={{ textAlign: 'center' }}>
              Decide later
            </CText>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
