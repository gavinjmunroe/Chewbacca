/**
 * MESSAGING: THE INBOUND SWITCH.
 *
 * Amber's iMessage webhook receives a phone number on every inbound text and,
 * until this switch exists, treated it as proof of who was texting: the number
 * resolved to an account and the message drove it -- contacts, notes, research.
 * Nothing in that chain was verified by us. Apple makes a handle hard to forge,
 * which is a property of somebody else's system that we neither control nor
 * observe.
 *
 * So this is the consent. Signed in, on a session that already proved this
 * phone, the owner says texting counts. Until they do, a text from their number
 * is told how to turn it on and nothing else.
 *
 * WHY IT IS NOT IN THE NOTIFICATIONS CARD, two sections up, where there is
 * already a row labeled "iMessage". That one is outbound -- may Amber text me
 * my reminders. This one is inbound -- may a text act as me. One word apart,
 * opposite in blast radius, and a user who read the second as a duplicate of
 * the first and flipped it to stop getting texts would have done the reverse of
 * what they meant. Two cards, two headings, and neither row says only
 * "iMessage".
 */
import { Linking, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { Pressable } from './Pressable';
import { NotificationToggleRow } from './profileParts';
import { CCard, CText } from './classical';
import { HAIRLINE, cl, clLayout } from '../lib/classical';
import { errorCopy, unwrapOrThrow } from '../lib/medhaId';
import { toast } from '../lib/toast';
import {
  amberMessagesUrl,
  getImessageLink,
  isStaleLink,
  linkImessage,
  linkStatusLine,
  unlinkImessage,
  type ImessageLink,
} from '../lib/imessageLink';

const KEY = ['imessageLink'] as const;

const OFF: ImessageLink = {
  linked: false,
  phone: null,
  linkedPhone: null,
  linkedAt: null,
  amberNumber: null,
};

export function ImessageChannelSection() {
  const qc = useQueryClient();

  const linkQuery = useQuery({
    queryKey: KEY,
    queryFn: async () => unwrapOrThrow(await getImessageLink()),
  });
  const link = linkQuery.data ?? OFF;

  const setLink = useMutation({
    mutationFn: async (next: boolean) =>
      unwrapOrThrow(await (next ? linkImessage() : unlinkImessage())),
    onMutate: async (next) => {
      await qc.cancelQueries({ queryKey: KEY });
      const previous = qc.getQueryData<ImessageLink>(KEY) ?? link;
      // Optimistic, but only the fields we can actually predict. Guessing
      // linkedPhone here is how the stale-number warning would flicker on for a
      // frame every time somebody armed it.
      qc.setQueryData<ImessageLink>(KEY, {
        ...previous,
        linked: next,
        linkedPhone: next ? previous.phone : null,
      });
      Haptics.selectionAsync().catch(() => {});
      return { previous };
    },
    onSuccess: (row) => qc.setQueryData<ImessageLink>(KEY, row),
    onError: (e: unknown, _next: boolean, context: { previous: ImessageLink } | undefined) => {
      // A switch that stays where you left it after a failed write is lying
      // about what the server thinks, and here the lie is "your texts work".
      if (context?.previous) qc.setQueryData<ImessageLink>(KEY, context.previous);
      toast.error('Could not change texting', errorCopy(e));
    },
  });

  const busy = linkQuery.isLoading || setLink.isPending;
  const messagesUrl = amberMessagesUrl(link);
  const stale = isStaleLink(link);

  return (
    <CCard flush>
      <NotificationToggleRow
        first
        title="Texting Amber"
        sub={linkStatusLine(link)}
        value={link.linked}
        disabled={busy || (link.available === false && !link.linked)}
        onValueChange={(v) => setLink.mutate(v)}
      />

      {stale ? (
        <Row>
          {/* The one state the switch itself cannot show. On, refusing everything,
              and unexplainable from the outside: they text and hear nothing. */}
          <CText t="metaSm" color={cl.ink48}>
            Your phone number changed after you turned this on. Turn it off and back on so texts
            from your new number reach you.
          </CText>
        </Row>
      ) : null}

      {link.linked && link.available !== false && !stale && messagesUrl ? (
        <Pressable
          onPress={() => {
            Linking.openURL(messagesUrl).catch(() => {
              toast.error('Could not open Messages', 'Text Amber at ' + link.amberNumber);
            });
          }}
          accessibilityRole="button"
          accessibilityLabel="Open Messages to Amber"
        >
          <Row>
            <CText t="listTitle" color={cl.ink}>
              Open Messages to Amber
            </CText>
            <CText t="metaSm" color={cl.ink48} style={{ marginTop: 1 }}>
              {/* Apple will not reliably deliver a cold message from a number you
                  have never texted, so the thread has to start from this side.
                  Same reason lib/imessage-opt-in.js exists on the server. */}
              {link.amberNumber}. Say hello once so Amber can reach you here.
            </CText>
          </Row>
        </Pressable>
      ) : null}
    </CCard>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return (
    <View
      style={{
        paddingHorizontal: clLayout.cardPadX,
        paddingVertical: clLayout.rowPadY,
        borderTopWidth: HAIRLINE,
        borderTopColor: cl.ruleSoft,
      }}
    >
      {children}
    </View>
  );
}
