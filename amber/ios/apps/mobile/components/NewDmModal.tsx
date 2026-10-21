import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Modal, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Pressable } from './Pressable';
import { MessageSquare, Search, Send, X } from 'lucide-react-native';
import { CText } from './classical';
import { cl } from '../lib/classical';
import { toast } from '../lib/toast';
import { inviteBySms } from '../lib/inviteBySms';
import { dmCandidates, openDmThread, type DmCandidate, type DmInvitee } from '../lib/dms';

// Who do you want to message?
//
// THE HONEST SPLIT. A direct message needs an account on the other end — voice
// memos, reactions and read state have nowhere to live otherwise. So contacts
// come back in two groups: the ones you can actually talk to, and the ones you
// can invite. Showing only the first would leave this list mysteriously empty on
// a 973-contact address book where almost nobody has signed up yet; showing them
// mixed together would promise a chat that cannot exist.
//
// Invite hands off to the phone's own Messages app with a prefilled line. That is
// deliberately NOT a synced thread — it is the OS doing what it is good at, and
// the same hand-off the contact card's Message button uses.

const CARD_BG = '#FFFCF8';
const CARD_BORDER = 'rgba(178,98,45,0.15)';
const ACCENT_700 = '#8C491A';
const ACCENT_600 = '#B2622D';
const ACCENT_500 = '#D67F48';
const INK_86 = 'rgba(32,30,29,0.86)';
const INK_45 = 'rgba(32,30,29,0.45)';
const INK_38 = 'rgba(32,30,29,0.38)';
const DISC = 32;

function initialsOf(name: string): string {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

type Row =
  | { type: 'header'; key: string; label: string; detail?: string }
  | { type: 'amber'; key: string; person: DmCandidate }
  | { type: 'invite'; key: string; person: DmInvitee };

export function NewDmModal({
  visible,
  onClose,
  onOpenThread,
}: {
  visible: boolean;
  // `contacts` is gone. The page used to hand its whole loaded address book down
  // so this sheet could filter it locally and send the matching ids off to be
  // resolved one at a time. The server searches now (see the effect below), so
  // passing 973 contacts through a prop to re-send their ids was work with no
  // product behind it.
  onClose: () => void;
  onOpenThread: (threadId: string, name: string) => void;
}) {
  // A hardcoded 52 was a guess at a status bar, and on a Dynamic Island phone the
  // bar is 59: "New message" and the search field were pressed against the very
  // top of the screen with nothing above them. From the real inset, plus room.
  const insets = useSafeAreaInsets();
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(false);
  // Told apart from an empty result -- see the note in the effect below.
  const [failed, setFailed] = useState(false);
  const [messageable, setMessageable] = useState<DmCandidate[]>([]);
  const [invite, setInvite] = useState<DmInvitee[]>([]);
  const [opening, setOpening] = useState<string | null>(null);

  // THE SERVER DOES THE SEARCHING NOW.
  //
  // This used to filter the address book locally, slice the first 200, and send
  // those uuids to be resolved one at a time. Two things were wrong with it: a
  // 7KB URL, and four hundred sequential server-side lookups per keystroke. On
  // a 973-contact book that request hung, and because the await below had no
  // try/catch, a THROWN error skipped setLoading(false) entirely — so the sheet
  // sat on its spinner with nothing in the list, forever. That is the whole of
  // "direct messages still isn't working".
  //
  // Empty query = everyone with an Amber account, straight from the server.
  useEffect(() => {
    if (!visible) return;
    let alive = true;
    setLoading(true);
    setFailed(false);
    const t = setTimeout(async () => {
      // A CATCH, AND IT IS THE IMPORTANT PART. callMedhaId can reject rather
      // than resolve — a dropped connection, a URL the platform refuses — and
      // an unhandled rejection inside a setTimeout callback leaves `loading`
      // true with no error state and no way for the user to tell why.
      try {
        const res = await dmCandidates({ q });
        if (!alive) return;
        if (res.ok) {
          setMessageable(res.data?.messageable ?? []);
          setInvite(res.data?.invite ?? []);
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

  const open = useCallback(
    async (person: DmCandidate) => {
      if (opening) return;
      setOpening(person.contactId);
      // Pass the ACCOUNT when the candidate list already knows it. That list is
      // built by joining contacts.linked_amber_id, so it knows exactly who is
      // reachable -- and sending only the contact id made the server resolve the
      // same question again, by phone, and answer "not_on_amber" for anybody
      // linked by email. Belt and braces: the server reads the link now too.
      const res = await openDmThread(
        person.amberId ? { amberId: person.amberId } : { contactId: person.contactId },
      );
      setOpening(null);
      if (!res.ok) {
        // SAY WHICH FAILURE IT WAS. "Couldn't open that chat" covered a blocked
        // thread, a contact with no account and a network blip in one shrug,
        // which is how a working feature looks broken.
        toast.error(
          res.status === 409
            ? `${person.name || 'They'} are not on Amber yet.`
            : res.status === 403
              ? 'You can’t message them.'
              : 'Couldn’t open that chat. Try again.',
        );
        return;
      }
      onClose();
      onOpenThread(res.data.threadId, person.name || person.username || 'Amber user');
    },
    [opening, onClose, onOpenThread],
  );

  const sendInvite = useCallback(async (person: DmInvitee) => {
    if (!person.phone) {
      toast.error('No number saved for them.');
      return;
    }
    // The OS composer, prefilled. Nothing is sent on their behalf — they still
    // press send, which is the only correct way to text someone from an app.
    //
    // The URL is built in lib/inviteBySms.ts because the web's faint suggestion
    // nodes do exactly this too, and the iOS/Android separator rule it carries
    // fails SILENTLY when it is wrong: Messages opens, addressed correctly, with
    // an empty draft. Two copies of that expression is a coin flip on whether
    // the next edit keeps the comment explaining the ternary.
    const outcome = await inviteBySms(person.phone);
    if (outcome === 'cannot-open') toast.error('Couldn’t open Messages.');
  }, []);

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    if (messageable.length > 0) {
      out.push({ type: 'header', key: 'h-amber', label: 'On Amber' });
      for (const p of messageable) out.push({ type: 'amber', key: `a-${p.contactId}`, person: p });
    }
    if (invite.length > 0) {
      out.push({
        type: 'header',
        key: 'h-invite',
        label: 'Not on Amber yet',
        detail: 'Invite them, or text them from Messages',
      });
      for (const p of invite) out.push({ type: 'invite', key: `i-${p.contactId}`, person: p });
    }
    return out;
  }, [messageable, invite]);

  return (
    <Modal visible={visible} animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: '#FBF6EF' }}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 10,
            paddingHorizontal: 14,
            // insets.top + 40. The first version hardcoded 52, which crowded
            // the status bar on a Dynamic Island phone; +26 cleared it but still
            // read as pinned to the top. A sheet should look like it starts
            // below the notch, not immediately after it.
            paddingTop: insets.top + 40,
            paddingBottom: 18,
          }}
        >
          <CText t="cardTitle" style={{ flex: 1, fontSize: 18 }}>
            New message
          </CText>
          <Pressable onPress={onClose} accessibilityLabel="Close" hitSlop={10}>
            <X size={20} color={INK_45} strokeWidth={2.2} />
          </Pressable>
        </View>

        <View style={{ paddingHorizontal: 14, paddingBottom: 12 }}>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 9,
              paddingHorizontal: 12,
              height: 40,
              borderRadius: 20,
              backgroundColor: CARD_BG,
              borderWidth: 1,
              borderColor: CARD_BORDER,
            }}
          >
            <Search size={16} color={INK_45} strokeWidth={2.2} />
            <TextInput
              value={q}
              onChangeText={setQ}
              placeholder="Search your contacts"
              placeholderTextColor={INK_38}
              autoCorrect={false}
              style={{ flex: 1, padding: 0, fontSize: 15, color: INK_86 }}
            />
            {loading ? <ActivityIndicator size="small" color={ACCENT_600} /> : null}
          </View>
        </View>

        <FlatList
          data={rows}
          keyExtractor={(r) => r.key}
          contentContainerStyle={{ paddingHorizontal: 14, paddingBottom: 40, gap: 6 }}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            loading ? null : (
              <View style={{ paddingTop: 40, alignItems: 'center' }}>
                <CText t="aside" color={INK_45}>
                  {failed
                    ? 'Could not check who you can message. Pull down or reopen to try again.'
                    : q.trim()
                      ? 'Nobody here by that name.'
                      : 'No contacts to message yet.'}
                </CText>
              </View>
            )
          }
          renderItem={({ item }) => {
            if (item.type === 'header') {
              return (
                <View style={{ paddingTop: 14, paddingBottom: 6, gap: 2 }}>
                  <CText t="kicker" color={cl.goldKicker}>
                    {item.label}
                  </CText>
                  {item.detail ? (
                    <CText t="metaSm" color={INK_45} style={{ fontSize: 11.5 }}>
                      {item.detail}
                    </CText>
                  ) : null}
                </View>
              );
            }
            const isAmber = item.type === 'amber';
            const name =
              (isAmber ? item.person.name || item.person.username : item.person.name) ||
              'Contact';
            const busy = isAmber && opening === item.person.contactId;
            return (
              <Pressable
                onPress={() =>
                  isAmber ? void open(item.person) : void sendInvite(item.person)
                }
                disabled={busy}
                accessibilityRole="button"
                accessibilityLabel={isAmber ? `Message ${name}` : `Invite ${name}`}
                style={({ pressed }) => ({ opacity: busy ? 0.5 : pressed ? 0.75 : 1 })}
              >
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 11,
                    paddingVertical: 10,
                    paddingHorizontal: 12,
                    borderRadius: 15,
                    backgroundColor: isAmber ? CARD_BG : 'transparent',
                    borderWidth: 1,
                    borderColor: isAmber ? CARD_BORDER : 'rgba(32,30,29,0.10)',
                  }}
                >
                  <View
                    style={{
                      width: DISC,
                      height: DISC,
                      borderRadius: DISC / 2,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: isAmber ? 'rgba(214,127,72,0.14)' : 'rgba(32,30,29,0.05)',
                    }}
                  >
                    <CText
                      t="label"
                      color={isAmber ? ACCENT_700 : INK_45}
                      style={{ fontSize: 10.5 }}
                    >
                      {initialsOf(name)}
                    </CText>
                  </View>
                  <CText t="listTitle" style={{ flex: 1, fontSize: 15 }} numberOfLines={1}>
                    {name}
                  </CText>
                  {busy ? (
                    <ActivityIndicator size="small" color={ACCENT_600} />
                  ) : isAmber ? (
                    <MessageSquare size={16} color={ACCENT_500} strokeWidth={2.2} />
                  ) : (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                      <CText t="metaSm" color={INK_45} style={{ fontSize: 11.5 }}>
                        Invite
                      </CText>
                      <Send size={14} color={INK_45} strokeWidth={2.2} />
                    </View>
                  )}
                </View>
              </Pressable>
            );
          }}
        />
      </View>
    </Modal>
  );
}
