import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Modal, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Merge, X } from 'lucide-react-native';
import { Pressable } from './Pressable';
import { Avatar } from './Avatar';
import { CText } from './classical';
import { cl, HAIRLINE } from '../lib/classical';
import {
  listDuplicateContacts,
  mergeContacts,
  type DuplicateCandidate,
} from '../lib/contactMerge';
import { toast } from '../lib/toast';

/**
 * TWO CARDS FOR ONE PERSON, OFFERED RATHER THAN COLLAPSED.
 *
 * ONLY PAIRS THAT SHARE A PHONE NUMBER OR AN EMAIL REACH HERE, and that rule is
 * the whole feature. It used to offer everything the two finders produced,
 * tiered `provable` down to `likely` -- same name plus a shared label, a shared
 * company, or one card being a bare stub.
 *
 * Every one of those may well be a duplicate, and NONE of them can be checked by
 * the person being asked. They open their contacts, find one card, and conclude
 * the app is inventing pairs. A review queue whose items cannot be verified is
 * worse than no review queue, because acting on it is guessing with somebody's
 * notes -- and a wrong merge files one person's history under another with
 * nothing in the app to show it happened.
 *
 * A shared number is a fact on both cards. The person can go and look.
 *
 * WHAT THIS SHOWS, AND WHY EACH PART IS THERE. The other card's NAME, because it
 * is usually not the name on this row -- somebody hunting for a second "Josh
 * Bernson" finds nothing, since the other one is filed as "Josh B". The RULE
 * that fired, so the pair is answerable rather than asserted. The Amber
 * sentence only when there is actually an account, because half of these come
 * from an address-book comparison that knows nothing about accounts, and being
 * told something about your own contacts that you know to be false is enough to
 * distrust everything else on the screen.
 *
 * And after a merge, WHAT MOVED. The server counts it per table on purpose.
 */
/** The pair IS the key; there is no surrogate id on a candidate. */
const pairKey = (p: DuplicateCandidate) => `${p.keepContactId}:${p.dropContactId}`;

export function DuplicateContactsSheet({
  visible,
  onClose,
  onMerged,
}: {
  visible: boolean;
  onClose: () => void;
  /** After a merge, so the caller can refresh whatever it was showing. */
  onMerged?: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [pairs, setPairs] = useState<DuplicateCandidate[] | null>(null);
  /**
   * EVERY MERGE THAT IS CURRENTLY RUNNING, not "the one".
   *
   * This was a single key, and `disabled={!!working}` on every button, so
   * starting one merge froze the entire sheet until it came back. A merge
   * repoints rows across a dozen tables inside one transaction and takes
   * seconds; with seven pairs to clear that is a minute of watching a spinner
   * and pressing nothing. They are independent operations and there is no
   * reason to queue them.
   */
  const [working, setWorking] = useState<Set<string>>(() => new Set());
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setFailed(false);
    const res = await listDuplicateContacts();
    if (res.ok) setPairs(res.data?.duplicates ?? []);
    else {
      setFailed(true);
      setPairs([]);
    }
  }, []);

  useEffect(() => {
    if (!visible) {
      setPairs(null);
      return;
    }
    void load();
  }, [visible, load]);

  /**
   * WHICH CARDS A RUNNING MERGE IS ALREADY TOUCHING.
   *
   * Merges of DIFFERENT people run at the same time happily. Two pairs that
   * share a card do not: merging A into B and then B into C concurrently means
   * the second transaction finds a card the first one just soft-deleted, and
   * the server correctly answers not_found -- which would surface as "could not
   * merge those" about a merge that was simply asked in the wrong order.
   *
   * The server is safe either way; it takes both rows FOR UPDATE and checks
   * they are live inside the transaction. This is about not asking it to do
   * something incoherent and then blaming it.
   */
  const busyCards = useMemo(() => {
    const out = new Set<string>();
    for (const p of pairs ?? []) {
      if (!working.has(pairKey(p))) continue;
      out.add(p.keepContactId);
      out.add(p.dropContactId);
    }
    return out;
  }, [pairs, working]);

  const runMerge = useCallback(
    async (p: DuplicateCandidate) => {
      const key = pairKey(p);
      setWorking((prev) => new Set(prev).add(key));
      const res = await mergeContacts(p.keepContactId, p.dropContactId);
      setWorking((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });

      if (!res.ok) {
        // A 404 means one of the two cards is already gone -- almost always
        // because another merge in this same sheet just absorbed it. That is
        // not a failure worth alarming somebody about; the row is stale, so
        // drop it and reload.
        if (res.status === 404) {
          setPairs((prev) => (prev ?? []).filter((x) => pairKey(x) !== key));
          void load();
          return;
        }
        toast.error(`Could not merge ${p.name || 'those'}.`);
        return;
      }

      /**
       * SAY WHAT MOVED, not just that something did. The server returns a
       * per-table count on purpose, and a merge that silently rewrites
       * somebody's notes, reminders and circle memberships and then reports
       * "done" gives the person no way to tell a real merge from a no-op --
       * which is exactly what was reported.
       */
      const moved = Object.values(res.data?.moved ?? {}).reduce((a, b) => a + b, 0);
      toast.success(
        moved > 0
          ? `${p.name || 'They'} are one card now. ${moved} ${moved === 1 ? 'record' : 'records'} moved over.`
          : `${p.name || 'They'} are one card now. Nothing was attached to the other one.`,
      );
      setPairs((prev) => (prev ?? []).filter((x) => pairKey(x) !== key));
      onMerged?.();
    },
    [load, onMerged],
  );

  /** A pair whose cards another running merge is already touching. */
  const blockedBy = (p: DuplicateCandidate) =>
    !working.has(pairKey(p)) && (busyCards.has(p.keepContactId) || busyCards.has(p.dropContactId));

  return (
    <Modal visible={visible} animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: cl.groundCream }}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'flex-start',
            gap: 10,
            paddingHorizontal: 18,
            paddingTop: insets.top + 40,
            paddingBottom: 12,
          }}
        >
          <View style={{ flex: 1, gap: 4 }}>
            <CText t="cardTitle" style={{ fontSize: 19 }}>
              Possible duplicates
            </CText>
            <CText t="metaSm" color={cl.ink48}>
              Amber merges the ones it can prove. These it will not decide for you.
            </CText>
          </View>
          <Pressable onPress={onClose} accessibilityLabel="Close" hitSlop={12}>
            <X size={20} color={cl.ink48} strokeWidth={2.2} />
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={{ paddingHorizontal: 18, paddingBottom: insets.bottom + 30 }}>
          {pairs === null ? (
            <View style={{ paddingTop: 40, alignItems: 'center' }}>
              <ActivityIndicator size="small" color={cl.gold55} />
            </View>
          ) : pairs.length === 0 ? (
            <CText t="body" color={cl.ink55} style={{ paddingTop: 26, fontSize: 14.5 }}>
              {failed
                ? 'Could not check for duplicates just now.'
                : 'Nothing looks duplicated. Amber will say so here if that changes.'}
            </CText>
          ) : (
            pairs.map((p) => (
              <View
                key={`${p.keepContactId}:${p.dropContactId}`}
                style={{
                  paddingVertical: 15,
                  gap: 10,
                  borderBottomWidth: HAIRLINE,
                  borderBottomColor: cl.gold12,
                }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                  <Avatar name={p.name || undefined} size={36} />
                  <View style={{ flex: 1 }}>
                    <CText t="body" color={cl.ink} numberOfLines={1}>
                      {p.name || 'Unnamed'}
                    </CText>
                    {/* WHAT IS ACTUALLY KNOWN ABOUT THIS PAIR, and only that.
                        This line was the hardcoded sentence "Two cards. One is
                        on Amber." under every row. Half the rows come from the
                        address-book comparison, which knows nothing about Amber
                        accounts, so for those it was simply false -- and being
                        told a fact about your own contacts that you know to be
                        wrong is enough to distrust the whole feature.

                        The other card's name matters just as much: it is
                        usually NOT the name on this row, which is why looking
                        for the second "Josh Bernson" finds nothing. */}
                    <CText t="metaSm" color={cl.ink48} style={{ fontSize: 11.5 }}>
                      {p.otherName && p.otherName.trim() && p.otherName.trim() !== (p.name ?? '').trim()
                        ? `Two cards: this one and "${p.otherName.trim()}".`
                        : 'Two cards with this name.'}
                      {p.amberId ? ' One is on Amber.' : ''}
                    </CText>
                    {p.reason ? (
                      <CText t="metaSm" color={cl.ink48} style={{ fontSize: 11.5, marginTop: 1 }}>
                        {`Matched on ${p.reason}.`}
                      </CText>
                    ) : null}
                  </View>
                </View>

                {/* WHAT THE OTHER CARD KNOWS. This is the whole decision: "the
                    other one has a number this one doesn't" is the difference
                    between merging and leaving it alone. */}
                {p.otherPhone || p.otherEmail ? (
                  <CText t="metaSm" color={cl.ink55} style={{ fontSize: 12.5 }}>
                    {`The other card also has ${[p.otherPhone, p.otherEmail]
                      .filter(Boolean)
                      .join(' · ')}`}
                  </CText>
                ) : (
                  <CText t="metaSm" color={cl.ink48} style={{ fontSize: 12.5 }}>
                    The other card adds nothing new — same name, nothing else on it.
                  </CText>
                )}

                <Pressable
                  disabled={working.has(pairKey(p)) || blockedBy(p)}
                  onPress={() => void runMerge(p)}
                  accessibilityRole="button"
                  accessibilityLabel={`Merge ${p.name ?? 'these contacts'}`}
                  style={({ pressed }) => ({
                    opacity: pressed ? 0.7 : blockedBy(p) ? 0.45 : 1,
                    alignSelf: 'flex-start',
                  })}
                >
                  <View
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 8,
                      paddingHorizontal: 14,
                      height: 36,
                      borderRadius: 18,
                      borderWidth: HAIRLINE,
                      borderColor: cl.gold40,
                      backgroundColor: cl.card,
                    }}
                  >
                    {working.has(pairKey(p)) ? (
                      <ActivityIndicator size="small" color={cl.gold55} />
                    ) : (
                      <Merge size={15} color={cl.goldDeep} strokeWidth={2.2} />
                    )}
                    <CText t="metaSm" color={cl.ink}>
                      {working.has(pairKey(p))
                        ? 'Merging'
                        : blockedBy(p)
                          ? 'Waiting on the other merge'
                          : 'Merge into one'}
                    </CText>
                  </View>
                </Pressable>
              </View>
            ))
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}
