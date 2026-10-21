import { useEffect, useState } from 'react';
import { View, TextInput } from 'react-native';
import { Pressable } from './Pressable';
import { Plus, Search } from 'lucide-react-native';
import { CCard, CText } from './classical';
import { cl } from '../lib/classical';
import { searchMyContacts, type PendingResolution, type PendingCandidate } from '../lib/pending';

// A persistent "who did you mean" card on the Today feed. Tight, clean pills:
// cream inside with a thin amber edge, and the pill you tap lights up amber
// before it resolves. Beyond Amber's suggestions there's a "choose another
// contact" search over ALL your contacts (for names Amber transcribed wrong and
// couldn't guess, like hard-to-spell ethnic names), plus add-new and not-now.
/** One of the two pills on a second-pass confirmation. */
function YesNo({ label, lit, onPress }: { label: string; lit: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => ({ flex: 1, opacity: pressed && !lit ? 0.85 : 1 })}
    >
      <View
        style={{
          alignItems: 'center',
          paddingVertical: 10,
          borderRadius: 11,
          backgroundColor: lit ? cl.gold : '#FFFDFA',
          borderWidth: 1,
          borderColor: lit ? cl.gold : cl.gold40,
        }}
      >
        <CText t="rowName" color={lit ? '#FFFFFF' : cl.ink} style={{ fontSize: 13.5 }}>
          {label}
        </CText>
      </View>
    </Pressable>
  );
}

export function PendingConfirmCard({
  item,
  onResolve,
  onDecline,
}: {
  item: PendingResolution;
  /**
   * Resolve one card. Return true when it is SETTLED (the caller removed it) and
   * false when it is not — a server error, or a form the user can still cancel.
   * The card re-enables itself on false; without that a restored card kept its
   * `chosen` flag and every pill was dead for the rest of the session.
   */
  onResolve: (pendingId: number, contactId: string) => boolean | Promise<boolean>;
  /**
   * "No, not them" on a second-pass confirmation. Not a resolution: the server
   * downgrades the row to a full clarify and re-issues it, so the next thing the
   * user sees is the candidate list rather than the same guess again.
   */
  onDecline?: (pendingId: number) => void;
}) {
  const [chosen, setChosen] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [q, setQ] = useState('');
  const [results, setResults] = useState<PendingCandidate[]>([]);
  const first = (item.rawName || '').trim().split(/\s+/)[0] || 'them';

  // A restored or recycled card is a LIVE card. React reuses this instance when
  // the same pendingId comes back from a reload, so without this the component
  // that was left mid-tap stays permanently untappable.
  useEffect(() => {
    setChosen(null);
  }, [item.pendingId]);

  const choose = (id: string) => {
    if (chosen) return;
    setChosen(id);
    void Promise.resolve(onResolve(item.pendingId, id))
      .then((settled) => {
        if (!settled) setChosen(null);
      })
      .catch(() => setChosen(null));
  };

  // Debounced typeahead over all contacts.
  useEffect(() => {
    if (!searchOpen) return;
    const query = q.trim();
    if (query.length < 2) {
      setResults([]);
      return;
    }
    let alive = true;
    const t = setTimeout(async () => {
      const res = await searchMyContacts(query);
      if (alive && res.ok) setResults(res.data?.contacts ?? []);
    }, 220);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [q, searchOpen]);

  const initials = (name: string) => {
    const parts = (name || '').trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return '?';
    if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
    return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
  };

  const Dot = ({ name, lit }: { name?: string; lit: boolean }) => (
    <View
      style={{
        width: 22,
        height: 22,
        borderRadius: 11,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: lit ? 'rgba(255,255,255,0.28)' : cl.gold12,
      }}
    >
      <CText t="label" color={lit ? '#FFFFFF' : cl.goldDeep} style={{ fontSize: 9.5, letterSpacing: 0.2 }}>
        {initials(name || '')}
      </CText>
    </View>
  );

  const Row = ({ id, label, node }: { id: string; label: string; node: React.ReactNode }) => {
    const lit = chosen === id;
    return (
      <Pressable
        onPress={() => choose(id)}
        accessibilityRole="button"
        accessibilityLabel={label}
        style={({ pressed }) => ({ opacity: pressed && !lit ? 0.85 : 1 })}
      >
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 9,
            paddingVertical: 7,
            paddingHorizontal: 9,
            borderRadius: 11,
            backgroundColor: lit ? cl.gold : '#FFFDFA',
            borderWidth: 1,
            borderColor: lit ? cl.gold : cl.gold40,
          }}
        >
          {node}
          <CText t="rowName" color={lit ? '#FFFFFF' : cl.ink} style={{ fontSize: 13.5, flex: 1 }}>
            {label}
          </CText>
        </View>
      </Pressable>
    );
  };

  // TWO QUESTIONS, TWO SHAPES -- AND THE SHAPE FOLLOWS THE QUESTION, NOT THE
  // SCREEN IT IS ON.
  //
  // These are different asks and they deserve different weight:
  //
  //   clarify  "Who did you mean by Maggi?"  -- genuinely open. Needs the whole
  //            apparatus: every candidate, add-as-new, search the address book,
  //            and a way to defer.
  //   soft     "You mean Spencer Blume, right?" -- one guess we already believe,
  //            being checked once before the confidence is committed. Anything
  //            more than yes or no is noise around an answer that is almost
  //            certainly yes.
  //
  // Until now the shape depended on WHERE you saw it: a live turn rendered
  // inline chips, a reopened note rendered this card, so the same question wore
  // two different faces depending on how you got to it. It branches on the
  // question now, and both surfaces render this one component.
  if (item.kind === 'soft' && item.guess) {
    const guess = item.guess;
    return (
      <CCard glass style={{ paddingVertical: 13, paddingHorizontal: 13 }}>
        <CText t="kicker" color={cl.goldKicker} style={{ fontSize: 9.5, letterSpacing: 1.3 }}>
          WHO DID YOU MEAN
        </CText>
        <CText t="cardName" style={{ fontSize: 14.5, lineHeight: 19, marginTop: 3 }}>
          {item.question}
        </CText>
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 11 }}>
          <YesNo
            label="Yes"
            lit={chosen === guess.id}
            onPress={() => choose(guess.id)}
          />
          <YesNo
            label="No"
            lit={chosen === '__no__'}
            onPress={() => {
              if (chosen) return;
              setChosen('__no__');
              onDecline?.(item.pendingId);
            }}
          />
        </View>
      </CCard>
    );
  }

  return (
    <CCard glass style={{ paddingVertical: 13, paddingHorizontal: 13 }}>
      <CText t="kicker" color={cl.goldKicker} style={{ fontSize: 9.5, letterSpacing: 1.3 }}>
        WHO DID YOU MEAN
      </CText>
      <CText t="cardName" style={{ fontSize: 14.5, lineHeight: 19, marginTop: 3 }}>
        {item.question}
      </CText>

      <View style={{ gap: 6, marginTop: 10 }}>

        {item.candidates.map((c) => {
          if (c.id === '__new__') {
            return (
              <Row
                key="__new__"
                id="__new__"
                label={`Add "${item.rawName}"`}
                node={
                  <View
                    style={{
                      width: 22,
                      height: 22,
                      borderRadius: 11,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: chosen === '__new__' ? 'rgba(255,255,255,0.28)' : cl.gold12,
                    }}
                  >
                    <Plus size={13} color={chosen === '__new__' ? '#FFFFFF' : cl.goldDeep} strokeWidth={2.5} />
                  </View>
                }
              />
            );
          }
          if (c.id === '__skip__') return null; // rendered as a quiet link below
          return (
            <Row
              key={c.id}
              id={c.id}
              label={c.name || first}
              node={<Dot name={c.name || undefined} lit={chosen === c.id} />}
            />
          );
        })}

        {/* Choose another contact: search ALL contacts when the suggestions miss. */}
        {!searchOpen ? (
          <Pressable
            onPress={() => setSearchOpen(true)}
            accessibilityRole="button"
            accessibilityLabel="Choose another contact"
            style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
          >
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 9,
                paddingVertical: 7,
                paddingHorizontal: 9,
                borderRadius: 11,
                backgroundColor: '#FFFDFA',
                borderWidth: 1,
                borderColor: cl.gold40,
              }}
            >
              <View
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: 11,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: cl.gold12,
                }}
              >
                <Search size={12} color={cl.goldDeep} strokeWidth={2.5} />
              </View>
              <CText t="rowName" color={cl.ink} style={{ fontSize: 13.5, flex: 1 }}>
                Choose another contact
              </CText>
            </View>
          </Pressable>
        ) : (
          <View style={{ gap: 6 }}>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 8,
                paddingHorizontal: 10,
                borderRadius: 11,
                backgroundColor: '#FFFDFA',
                borderWidth: 1,
                borderColor: cl.gold40,
              }}
            >
              <Search size={13} color={cl.ink48} strokeWidth={2.2} />
              <TextInput
                autoFocus
                value={q}
                onChangeText={setQ}
                placeholder="Search your contacts"
                placeholderTextColor={cl.ink48}
                style={{ flex: 1, paddingVertical: 9, fontSize: 14, color: cl.ink }}
              />
            </View>
            {results.map((r) => (
              <Row key={r.id} id={r.id} label={r.name} node={<Dot name={r.name} lit={chosen === r.id} />} />
            ))}
            {q.trim().length >= 2 && results.length === 0 ? (
              <CText t="label" color={cl.ink48} style={{ fontSize: 12, paddingLeft: 4, paddingVertical: 2 }}>
                No matches
              </CText>
            ) : null}
          </View>
        )}

        {item.candidates.some((c) => c.id === '__skip__') ? (
          <Pressable
            onPress={() => choose('__skip__')}
            accessibilityRole="button"
            accessibilityLabel="Not now"
            hitSlop={8}
            style={({ pressed }) => ({
              opacity: pressed ? 0.6 : 1,
              alignSelf: 'center',
              paddingVertical: 4,
            })}
          >
            <CText t="label" color={cl.ink48} style={{ fontSize: 11.5, letterSpacing: 0.3 }}>
              Not now
            </CText>
          </Pressable>
        ) : null}
      </View>
    </CCard>
  );
}
