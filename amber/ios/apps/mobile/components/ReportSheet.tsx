import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, ScrollView, TextInput } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Check } from 'lucide-react-native';
import { Pressable } from './Pressable';
import { CText } from './classical';
import { cl, HAIRLINE } from '../lib/classical';
import {
  REPORT_DETAIL_MAX,
  REPORT_REASONS,
  reportUser,
  type ReportReason,
} from '../lib/reports';
import { toast } from '../lib/toast';

/**
 * REPORTING SOMEBODY.
 *
 * There was a Block and nothing else. Block is a private boundary: it stops
 * contact and tells nobody anything, which is right for "I do not want to hear
 * from this person" and useless for "this person is threatening me and should
 * not be here". The second one needs somewhere to go, and there was nowhere.
 *
 * ── WHAT THIS SHEET PROMISES, AND WHY IT SAYS IT BEFORE THE TAP ─────────────
 *
 * Three facts, on screen, above the button rather than in a toast afterwards:
 * that they will be blocked, that their recent messages travel with the report
 * so somebody can actually read them, and that they are never told. Each of
 * those is a thing a person weighs before deciding, and an app that reveals
 * them after the fact has taken the decision away.
 *
 * The evidence line matters most. Somebody reporting harassment is handing over
 * a conversation, and the app should say so plainly rather than quietly
 * shipping it.
 *
 * ── A REASON IS REQUIRED, A DESCRIPTION IS NOT ──────────────────────────────
 *
 * The reason is one tap and makes the report sortable. Demanding a written
 * explanation from somebody who has just been harassed is asking them to write
 * about it, and most will close the sheet instead -- which is the outcome that
 * loses the report entirely.
 */
export function ReportSheet({
  visible,
  name,
  threadId,
  amberId,
  onClose,
  onReported,
}: {
  visible: boolean;
  /** Who is being reported, for the copy. */
  name: string;
  /** The thread this is about, when it is about one. Evidence comes from it. */
  threadId?: string | null;
  /** Their Amber id, for a report that is not about a conversation. */
  amberId?: string | null;
  onClose: () => void;
  /** Fired after a report lands, with whether the block also landed. */
  onReported?: (blocked: boolean) => void;
}) {
  const insets = useSafeAreaInsets();
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [detail, setDetail] = useState('');
  const [busy, setBusy] = useState(false);

  /**
   * A FRESH SHEET EVERY TIME IT OPENS.
   *
   * Without this, reporting one person for harassment and then opening the
   * sheet on somebody else shows their reason and their typed words already
   * filled in, and a fast tap files the wrong report about the wrong person.
   */
  useEffect(() => {
    if (visible) {
      setReason(null);
      setDetail('');
      setBusy(false);
    }
  }, [visible]);

  const who = (name ?? '').trim().split(/\s+/)[0] || 'this person';

  async function submit() {
    if (!reason || busy) return;
    setBusy(true);
    const res = await reportUser({ threadId, amberId, reason, detail });
    setBusy(false);
    if (!res.ok) {
      // Left open on purpose. Closing the sheet on a failure throws away what
      // they typed and reads as success.
      toast.error('Not sent', res.message);
      return;
    }
    toast.success(
      'Reported',
      res.blocked
        ? `We will review this. ${who} is blocked and is not told.`
        : 'We will review this.',
    );
    onReported?.(res.blocked);
    onClose();
  }

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <Pressable
        onPress={busy ? () => {} : onClose}
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
            maxHeight: '88%',
          }}
        >
          <CText t="kicker" color={cl.goldKicker}>
            {`REPORT ${who.toUpperCase()}`}
          </CText>
          <CText t="body" color={cl.ink55} style={{ fontSize: 14, marginTop: 6 }}>
            Tell us what is wrong and we will review it. Reports are normally
            reviewed within 24 hours.
          </CText>

          <ScrollView
            style={{ marginTop: 12 }}
            contentContainerStyle={{ paddingBottom: 8 }}
            keyboardShouldPersistTaps="handled"
          >
            {REPORT_REASONS.map((r, i) => {
              const on = reason === r.key;
              return (
                <Pressable
                  key={r.key}
                  onPress={() => setReason(r.key)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={r.label}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 10,
                    paddingVertical: 13,
                    borderTopWidth: i === 0 ? 0 : HAIRLINE,
                    borderTopColor: cl.gold12,
                  }}
                >
                  <CText t="body" color={on ? cl.ink : cl.ink55} style={{ flex: 1, fontSize: 15 }}>
                    {r.label}
                  </CText>
                  {on ? <Check size={17} color={cl.goldDeep} strokeWidth={2.2} /> : null}
                </Pressable>
              );
            })}

            <TextInput
              value={detail}
              onChangeText={(v) => setDetail(v.slice(0, REPORT_DETAIL_MAX))}
              placeholder="Anything else we should know? (optional)"
              placeholderTextColor={cl.ink38}
              multiline
              maxLength={REPORT_DETAIL_MAX}
              accessibilityLabel="Anything else we should know"
              style={{
                marginTop: 12,
                minHeight: 86,
                borderRadius: 12,
                borderWidth: HAIRLINE,
                borderColor: cl.gold12,
                backgroundColor: cl.card,
                padding: 12,
                fontSize: 15,
                color: cl.ink,
                textAlignVertical: 'top',
              }}
            />

            {/* WHAT HAPPENS, BEFORE IT HAPPENS. See the header: each of these is
                something a person weighs while deciding, so none of them belong
                in a toast afterwards. */}
            <CText t="metaSm" color={cl.ink48} style={{ fontSize: 11.5, marginTop: 12, lineHeight: 17 }}>
              {threadId
                ? `${who} will be blocked. Their recent messages in this chat are sent with the report so we can review it. They are never told.`
                : `${who} will be blocked. They are never told.`}
            </CText>
          </ScrollView>

          <Pressable
            onPress={() => void submit()}
            disabled={!reason || busy}
            accessibilityRole="button"
            accessibilityLabel="Send report"
            accessibilityState={{ disabled: !reason || busy }}
            style={{
              marginTop: 14,
              borderRadius: 12,
              paddingVertical: 14,
              alignItems: 'center',
              backgroundColor: reason && !busy ? '#9B2C1E' : cl.gold12,
            }}
          >
            {busy ? (
              <ActivityIndicator size="small" color={cl.card} />
            ) : (
              <CText t="body" color={reason ? cl.card : cl.ink38} style={{ fontSize: 15 }}>
                Send report
              </CText>
            )}
          </Pressable>

          <Pressable
            onPress={busy ? () => {} : onClose}
            accessibilityRole="button"
            accessibilityLabel="Cancel"
            style={{ marginTop: 4, paddingVertical: 12, alignItems: 'center' }}
          >
            <CText t="body" color={cl.ink48} style={{ fontSize: 14 }}>
              Cancel
            </CText>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
