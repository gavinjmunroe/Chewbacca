import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Check, ChevronLeft, Search, X } from 'lucide-react-native';
import { Text } from './Text';
import { ContactEmblem } from './ContactEmblem';
import { RecordingWaveform, barsForWidth } from './RecordingWaveform';
import { LIGHT } from '../lib/theme';
import { fonts, radius, spacing } from '../lib/tokens';
import { useVoiceDictation } from '../lib/useVoiceDictation';
import { learnFromCorrection } from '../lib/voiceCorrection';

type PickContact = { id: string; name: string };

// A local `initials()` used to live here, unused: the file calls the shared
// `initialsFor` it already imports. Two implementations of one idea, one of them
// dead, is how they drift.

// The starting tag vocabulary. Deliberately short and life-shaped rather than
// CRM-shaped: these are the answers to "which part of your life is this person
// from?". Users add their own with + TAG, and anything they add is stored the
// same way, so the set grows with them.
function initialsFor(name: string): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

const SUGGESTED_TAGS = ['work', 'close', 'family', 'school'];

function mmss(total: number): string {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

/**
 * TAP to record, not hold.
 *
 * It used to be press-and-hold with a 450ms minimum, which meant your thumb was
 * pinned to a 56pt circle for the entire sentence — you could not scroll, you could
 * not think, and letting go early silently threw the clip away. Worse, a finger that
 * drifted a few points was a "press out" and ended the recording mid-word, which is
 * why the row had to be pinned outside the ScrollView to work at all.
 *
 * So: tap the circle to start. While it is running the row becomes
 * [ discard ] [ waveform ] [ timer ] [ send ] — the same shape as the full recorder
 * sheet, so the two surfaces behave the same way. Nothing is destroyed without an
 * explicit tap on the X, and nothing is committed without an explicit tap on the
 * check.
 *
 * The timer lives HERE rather than in the sheet so ticking it re-renders one row
 * instead of the whole modal (which holds a 968-row FlatList).
 */
function VoiceNoteRow({
  active,
  transcribing,
  compact,
  onStart,
  onStop,
  onCancel,
  getMetering,
}: {
  active: boolean;
  transcribing: boolean;
  /**
   * Keyboard is up. Drops the helper line and tightens the row, because with the
   * keyboard raised the sheet has ~250pt of usable height and a two-line label here
   * pushed the note field it describes off the top of it.
   */
  compact?: boolean;
  onStart: () => void;
  onStop: () => void;
  onCancel: () => void;
  getMetering: () => number | undefined | null;
}) {
  const [seconds, setSeconds] = useState(0);
  // Measured, so the bar count is derived rather than hard-coded — a fixed count is
  // an intrinsic width and overflows onto whatever sits beside it.
  const [waveWidth, setWaveWidth] = useState(0);

  useEffect(() => {
    if (!active) return undefined;
    setSeconds(0);
    const id = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [active]);

  if (active) {
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56 }}>
        {/* Discard. On the left, away from the send button, so the two are not
            adjacent targets for a thumb in a hurry. */}
        <Pressable
          onPress={onCancel}
          accessibilityRole="button"
          accessibilityLabel="Discard this recording"
          hitSlop={10}
          style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
        >
          <View
            style={{
              width: 44,
              height: 44,
              borderRadius: 22,
              borderWidth: 1,
              borderColor: 'rgba(32,30,29,0.28)',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <X size={19} color="rgba(32,30,29,0.6)" strokeWidth={2.2} />
          </View>
        </Pressable>

        {/* Peaks and valleys off the real mic level, Voice-Memos style. */}
        <View
          style={{ flex: 1, minWidth: 0 }}
          onLayout={(e) => {
            const w = Math.floor(e.nativeEvent.layout.width);
            setWaveWidth((prev) => (Math.abs(prev - w) > 1 ? w : prev));
          }}
        >
          {waveWidth > 0 ? (
            <RecordingWaveform
              getMetering={getMetering}
              active
              bars={barsForWidth(waveWidth, 3, 3)}
              barWidth={3}
              gap={3}
              height={36}
              color="#C4703C"
              style={{ width: waveWidth }}
            />
          ) : (
            <View style={{ height: 36 }} />
          )}
        </View>

        <Text
          style={{
            fontFamily: fonts.body,
            fontSize: 12,
            letterSpacing: 0.4,
            color: '#8C491A',
            width: 34,
            textAlign: 'right',
            fontVariant: ['tabular-nums'],
          }}
        >
          {mmss(seconds)}
        </Text>

        {/* Send. Filled ink, the only filled control in the row, because it is the
            only one that commits anything. */}
        <Pressable
          onPress={onStop}
          accessibilityRole="button"
          accessibilityLabel="Save this recording to the note"
          hitSlop={10}
          style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
        >
          <View
            style={{
              width: 52,
              height: 52,
              borderRadius: 26,
              backgroundColor: '#201E1D',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Check size={22} color="#FFF8F0" strokeWidth={2.6} />
          </View>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.base, minHeight: 56 }}>
      <Pressable
        onPress={onStart}
        disabled={transcribing}
        accessibilityRole="button"
        accessibilityLabel="Tap to record a note"
        hitSlop={12}
        style={({ pressed }) => ({ opacity: transcribing ? 0.5 : pressed ? 0.85 : 1 })}
      >
        {/* A dot inside a ring — the record mark from the design, not a mic glyph. */}
        <View
          style={{
            width: 56,
            height: 56,
            borderRadius: 28,
            borderWidth: 1.4,
            borderColor: 'rgba(32,30,29,0.42)',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <View
            style={{
              width: 15,
              height: 15,
              borderRadius: 8,
              backgroundColor: 'rgba(32,30,29,0.66)',
            }}
          />
        </View>
      </Pressable>

      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text
          style={{
            fontFamily: fonts.serifItalic,
            fontSize: 16,
            lineHeight: 23,
            color: transcribing ? '#8C491A' : 'rgba(32,30,29,0.75)',
          }}
        >
          {transcribing ? 'Writing it down…' : 'Tap to record a note'}
        </Text>
        {transcribing || compact ? null : (
          <Text
            style={{
              fontFamily: fonts.body,
              fontSize: 11.5,
              lineHeight: 17,
              color: 'rgba(32,30,29,0.42)',
            }}
          >
            It gets transcribed into the note above.
          </Text>
        )}
      </View>

      {transcribing ? <ActivityIndicator size="small" color="#B2622D" /> : null}
    </View>
  );
}

// Pin someone as a Network Favorite. Two quick steps: pick the person, then
// (optionally) say why they matter.
//
// This is NOT "add a contact" — the whole address book is already in Amber. This
// pins up to MAX_FAVORITES people to the top of the People tab, which is why the
// copy says favorites throughout. Calling it "add to your Amber Network" made it
// look like a duplicate of the header's add-person button.
// (optionally) hold the mic and say how you know them / why they matter — it
// transcribes and gets written onto their contact card.
export function AddFavoriteModal({
  visible,
  contacts,
  onClose,
  onAdd,
  onLateNote,
}: {
  visible: boolean;
  contacts: PickContact[];
  onClose: () => void;
  onAdd: (contactId: string, note?: string, tags?: string[]) => Promise<void>;
  /**
   * Called when a transcript finishes AFTER the favorite was already saved —
   * i.e. the user tapped ADD while still talking, or while the clip was
   * uploading. The words are not lost: they are written onto the same contact a
   * moment later. Without this the sheet would close, the transcript would land
   * in a `note` state nobody is rendering any more, and the recording would be
   * silently thrown away.
   */
  onLateNote?: (contactId: string, note: string, tags?: string[]) => void;
}) {
  const insets = useSafeAreaInsets();
  const { height: winH } = useWindowDimensions();
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<PickContact | null>(null);
  // SINGLE select by design: one pinned profile per pass. A multi-select here
  // would let someone blow past the 9-favorite cap in one tap and would make the
  // per-person note and tags meaningless.
  const [chosen, setChosen] = useState<PickContact | null>(null);
  const [note, setNote] = useState('');
  // Multi-select. A person can be a work contact AND a close friend AND someone
  // you sail with; forcing one choice would lose the thing that makes the tag
  // useful later ("who do I know from work?").
  const [tags, setTags] = useState<string[]>([]);
  const [customTag, setCustomTag] = useState('');
  const [addingTag, setAddingTag] = useState(false);
  const [saving, setSaving] = useState(false);

  // Set when the sheet was submitted with a recording still in flight. A ref, not
  // state, because the reset-on-visibility effect must not clear it — the whole
  // point is that it outlives the sheet being closed.
  const lateRef = useRef<{ contactId: string; tags: string[] } | null>(null);

  // The last thing transcription produced, and what it produced it INTO. Kept so an
  // edit can be compared against it: if the user fixes "AJ" to "Ajay" in the note, that
  // difference is the correction we learn from. Refs, not state — nothing renders from
  // them and they must survive re-renders without causing any.
  const lastTranscriptRef = useRef<string | null>(null);
  const noteAtTranscriptRef = useRef<string>('');

  const dictation = useVoiceDictation({
    onUtterance: (t) => {
      const pending = lateRef.current;
      if (pending) {
        lateRef.current = null;
        // The favorite is already saved; this writes the words onto the same
        // contact. Tags go along so the upsert cannot clear them.
        onLateNote?.(pending.contactId, t, pending.tags.length > 0 ? pending.tags : undefined);
        return;
      }
      setNote((n) => {
        const next = n.trim() ? `${n.trim()} ${t}` : t;
        // Remember exactly what the machine wrote, and the field it wrote into, so a
        // later edit can be diffed against it rather than against the whole note.
        lastTranscriptRef.current = t;
        noteAtTranscriptRef.current = next;
        return next;
      });
    },
  });

  /**
   * Compare what the user ended up with against what transcription produced, and teach
   * the dictionary the difference.
   *
   * Called on SUBMIT rather than on every keystroke: mid-typing the text is transiently
   * wrong ("Aja"), and learning from a half-typed word would poison the dictionary with
   * fragments. Waiting until the user commits means we only ever see the spelling they
   * actually meant.
   */
  const learnEdits = () => {
    const spoken = lastTranscriptRef.current;
    if (!spoken) return;
    const before = noteAtTranscriptRef.current;
    const after = note;
    if (!before || before === after) return;
    learnFromCorrection(before, after, picked?.id);
    lastTranscriptRef.current = null;
  };

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    // No cap. This used to slice(0, 200), which both hid 768 of the user's
    // contacts and made the header count report 200. FlatList only mounts what is
    // on screen, so the full list costs nothing.
    if (!needle) return contacts;
    // Rank matches: names that START with the query first (so "shi" surfaces
    // Shirley ahead of Kaushik), then any substring hit. Match on the whole name
    // and on each word so first- or last-name typing both work.
    const starts: PickContact[] = [];
    const contains: PickContact[] = [];
    for (const c of contacts) {
      const name = c.name.toLowerCase();
      const words = name.split(/\s+/);
      if (name.startsWith(needle) || words.some((w) => w.startsWith(needle))) {
        starts.push(c);
      } else if (name.includes(needle)) {
        contains.push(c);
      }
    }
    // Also uncapped: a search for a common surname could easily exceed 200 and
    // silently drop the person you were looking for.
    return [...starts, ...contains];
  }, [q, contacts]);

  // The keyboard, tracked so step 1 keeps a constant height while typing and step 2
  // tightens up instead of squeezing. With the keyboard raised the sheet has roughly
  // 250pt of usable height, and the pinned record row was being pushed up over the
  // note field it describes.
  const [keyboardUp, setKeyboardUp] = useState(false);
  useEffect(() => {
    // 'Will' events on iOS so the layout changes on the same frames as the keyboard
    // animation rather than a beat behind it.
    const show = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      () => setKeyboardUp(true),
    );
    const hide = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
      () => setKeyboardUp(false),
    );
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  // A FIXED height, not a maximum — and it is actually applied to the list, which
  // the previous `listMaxHeight` never was.
  //
  // With no height on the FlatList, the list sized to its CONTENT, so the sheet grew
  // and shrank as you typed: 900 contacts made a full-height sheet, "shir" made a
  // two-row one, and every keystroke that changed the match count re-laid-out and
  // re-animated the whole modal under your thumb. That is what made it impossible to
  // keep up with while typing. A constant height means the sheet is the same size
  // with 900 results, 3 results or none, and only the rows inside it change.
  //
  // It depends on the KEYBOARD, and on nothing else. Two heights, not a continuum:
  // the keyboard appearing is one expected transition, whereas the result count
  // changing is something that happens on every keystroke — and it was the second
  // one that made the sheet impossible to type into. Raising the keyboard takes ~340pt
  // away from the sheet, so a list sized for the closed state would push the CTA off
  // the bottom; a shorter open-keyboard height keeps every control reachable and still
  // holds perfectly still while you type.
  const listHeight = Math.round(winH * (keyboardUp ? 0.3 : 0.42));


  // Reset everything whenever the sheet is dismissed so it opens clean next time.
  // Reset on EVERY visibility change, not just on close. Resetting only on close
  // meant that if the sheet was dismissed by a route change (which does not always
  // fire the close path) a stale note — including a stray voice transcript —
  // survived into the next open.
  useEffect(() => {
    setQ('');
    setPicked(null);
    setChosen(null);
    setNote('');
    setTags([]);
    setCustomTag('');
    setAddingTag(false);
    setSaving(false);
  }, [visible]);

  const close = () => {
    // Dismissing keeps the words ONLY if a save is already on its way (lateRef).
    // Otherwise the clip is discarded rather than transcribed into a note nobody
    // will ever see.
    if (dictation.active) {
      if (lateRef.current) dictation.stop();
      else dictation.cancel();
    }
    onClose();
  };

  const back = () => {
    // Stepping back abandons this person, so the recording goes with them.
    if (dictation.active) dictation.cancel();
    lateRef.current = null;
    setPicked(null);
    setNote('');
  };

  const submit = async () => {
    if (!picked || saving) return;
    // Tapping ADD mid-sentence must not cost the sentence. Stash the target, save
    // the favorite now, and let the transcript land on the same contact when it
    // arrives — the user gets an instant pin AND their words.
    if (dictation.active || dictation.transcribing) {
      lateRef.current = { contactId: picked.id, tags: [...tags] };
      if (dictation.active) dictation.stop();
    }
    // Learn before saving, while `note` and the remembered transcript are both still
    // in hand. Fire-and-forget, so it cannot delay or fail the save.
    learnEdits();
    setSaving(true);
    try {
      await onAdd(picked.id, note.trim() || undefined, tags.length > 0 ? tags : undefined);
      close();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={close}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Pressable
          onPress={close}
          accessibilityLabel="Close"
          // Softened from rgba(0,0,0,0.55). Warm rather than neutral black, and light
          // enough that the sheet's rounded corners do not sit in a hole.
          style={{ flex: 1, backgroundColor: 'rgba(28,22,16,0.42)' }}
        />
        {/* AN OPAQUE SURFACE, NOT GLASS — this is the "weird black shadow behind what
            I'm typing".
            This was <GlassSurface>, which on iOS 26 renders a real frosted GlassView
            with NO background of its own. Frosted glass samples what is behind it,
            and what was behind it was a 55%-black backdrop, so the sheet resolved to
            a dark gray-brown panel and every character typed onto it sat on a murky
            smudge. Glass is right for a floating pill over content; it is wrong for a
            sheet with a keyboard and a text field, where legibility is the only thing
            that matters. A warm opaque fill also means the surface looks identical on
            iOS 26 and iOS 18 instead of only being readable on one of them. */}
        <View
          style={{
            backgroundColor: LIGHT.canvas,
            borderTopLeftRadius: radius.xl,
          borderTopRightRadius: radius.xl,
          borderTopWidth: 1,
          borderColor: LIGHT.hairline,
          overflow: 'hidden',
          paddingHorizontal: spacing.lg,
          paddingTop: spacing.sm,
          paddingBottom: insets.bottom + spacing.lg,
          // Step 2 needs the height: a note field, a tag wrap and a record row
          // inside 82% left every gap fighting for room on a 6.1" screen.
          maxHeight: '92%',
        }}
      >
        <View style={{ alignItems: 'center', marginBottom: spacing.sm }}>
          <View style={{ width: 36, height: 4, borderRadius: radius.full, backgroundColor: LIGHT.hairline }} />
        </View>

        {!picked ? (
          <>
            {/* Title + close. Serif display, matching the design's picker. */}
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'flex-start',
                justifyContent: 'space-between',
              }}
            >
              <Text
                style={{
                  fontFamily: fonts.serif,
                  fontSize: 30,
                  lineHeight: 34,
                  letterSpacing: 0.2,
                  color: '#2E2B25',
                }}
              >
                Add to favorites
              </Text>
              <Pressable onPress={onClose} hitSlop={12} accessibilityLabel="Close">
                <X size={20} color="rgba(32,30,29,0.45)" strokeWidth={1.8} />
              </Pressable>
            </View>

            {/* Search as an underline, not a box. */}
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 9,
                marginTop: spacing.base,
                paddingBottom: 8,
                borderBottomWidth: 1,
                borderBottomColor: 'rgba(32,30,29,0.5)',
              }}
            >
              <Search size={14} color="rgba(32,30,29,0.35)" strokeWidth={2} />
              <TextInput
                value={q}
                onChangeText={setQ}
                placeholder="Search your contacts"
                placeholderTextColor="rgba(32,30,29,0.38)"
                autoCorrect={false}
                style={{
                  flex: 1,
                  // NOT `padding: 0`. With zero padding iOS gives a single-line
                  // TextInput exactly its font's line box, and the descenders of "y"
                  // and "g" in "Search your contacts" get clipped by the bottom edge.
                  // A minHeight of ~1.5x the font size leaves room for them; the
                  // vertical padding keeps the text off the underline beneath it.
                  minHeight: 24,
                  paddingVertical: 2,
                  paddingHorizontal: 0,
                  fontFamily: fonts.body,
                  fontSize: 15,
                  color: '#2E2B25',
                }}
              />
              {q ? (
                <Pressable onPress={() => setQ('')} hitSlop={10} accessibilityLabel="Clear">
                  <X size={15} color="rgba(32,30,29,0.35)" strokeWidth={2} />
                </Pressable>
              ) : null}
            </View>

            {/* Count + selection state. SINGLE select: one pinned profile per
                pass, so this reads "1 chosen" at most. */}
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginTop: spacing.md,
              }}
            >
              <Text
                style={{
                  fontFamily: fonts.body,
                  fontSize: 10.5,
                  letterSpacing: 1.5,
                  color: 'rgba(32,30,29,0.42)',
                }}
              >
                {`${filtered.length} CONTACTS`}
              </Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                <Text
                  style={{
                    fontFamily: fonts.serif,
                    fontSize: 17,
                    color: '#2E2B25',
                  }}
                >
                  {chosen ? '1' : '0'}
                </Text>
                <Text
                  style={{
                    fontFamily: fonts.body,
                    fontSize: 10.5,
                    letterSpacing: 1.5,
                    color: '#8C491A',
                  }}
                >
                  CHOSEN
                </Text>
              </View>
            </View>

            <FlatList
              data={filtered}
              keyExtractor={(c) => c.id}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              // THE FIXED HEIGHT. See listHeight above: without it the sheet resized
              // on every keystroke that changed the number of matches.
              // flexShrink is a safety valve, not the mechanism: RN defaults it to 0, so
              // an explicit height here would otherwise refuse to yield on a screen
              // shorter than the two heights above assume, and the CTA below would be
              // pushed off the bottom rather than the list giving up a few points.
              style={{ marginTop: spacing.sm, height: listHeight, flexShrink: 1 }}
              contentContainerStyle={{ paddingBottom: spacing.md, flexGrow: 1 }}
              renderItem={({ item }) => {
                const on = chosen?.id === item.id;
                return (
                  <Pressable
                    onPress={() => setChosen(on ? null : item)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                    accessibilityLabel={item.name}
                    style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
                  >
                    <View
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 14,
                        paddingVertical: 12,
                        borderBottomWidth: 1,
                        borderBottomColor: 'rgba(32,30,29,0.09)',
                      }}
                    >
                      {/* Outlined ring + lens + serif initials, filling with the
                          accent when chosen. `size` is the true diameter here, so
                          44 is 44 — no 1.55x compensation like ChordEmblem needed.
                          Selection is carried by the fill AND the check on the
                          right, because color alone is not an accessible state. */}
                      <ContactEmblem
                        name={item.name}
                        initials={initialsFor(item.name)}
                        accent="#C4703C"
                        size={44}
                        selected={on}
                      />
                      <Text
                        numberOfLines={1}
                        style={{
                          flex: 1,
                          fontFamily: fonts.serif,
                          fontSize: 18,
                          color: '#2E2B25',
                        }}
                      >
                        {item.name}
                      </Text>
                      <View
                        style={{
                          width: 25,
                          height: 25,
                          borderRadius: 13,
                          alignItems: 'center',
                          justifyContent: 'center',
                          backgroundColor: on ? '#201E1D' : 'transparent',
                          borderWidth: on ? 0 : 1,
                          borderColor: 'rgba(32,30,29,0.22)',
                        }}
                      >
                        {on ? <Check size={13} color="#FFF8F0" strokeWidth={3} /> : null}
                      </View>
                    </View>
                  </Pressable>
                );
              }}
              ListEmptyComponent={
                <Text
                  style={{
                    fontFamily: fonts.body,
                    fontSize: 14,
                    color: 'rgba(32,30,29,0.45)',
                    paddingVertical: 18,
                  }}
                >
                  No contacts by that name.
                </Text>
              }
            />

            {/* Full-width ink pill. Disabled until someone is chosen; no Skip,
                because closing the sheet already is the skip. */}
            <Pressable
              onPress={() => {
                if (chosen) setPicked(chosen);
              }}
              disabled={!chosen}
              accessibilityRole="button"
              accessibilityLabel="Continue with the chosen contact"
              accessibilityState={{ disabled: !chosen }}
              style={({ pressed }) => ({
                marginTop: spacing.xs,
                opacity: !chosen ? 0.35 : pressed ? 0.9 : 1,
              })}
            >
              <View
                style={{
                  height: 54,
                  borderRadius: radius.full,
                  backgroundColor: '#201E1D',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Text
                  style={{
                    fontFamily: fonts.body,
                    fontSize: 12.5,
                    letterSpacing: 1.6,
                    color: '#FFF8F0',
                  }}
                >
                  ADD TO FAVORITES
                </Text>
              </View>
            </Pressable>
          </>
        ) : (
          <>
            {/* Header: back, the person's monogram in a ring, name + intent line.
                Laid out to `Circle Favorite` — the emblem makes it read as a
                person you are acting on, not a form field. */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
              <Pressable onPress={back} hitSlop={12} accessibilityLabel="Back">
                <ChevronLeft size={24} color="rgba(32,30,29,0.5)" strokeWidth={1.8} />
              </Pressable>
              {/* Filled, because by this step the person IS chosen — the same
                  state the picker row showed a moment ago, carried forward so the
                  transition reads as continuity rather than a new screen. */}
              <ContactEmblem
                name={picked.name}
                initials={initialsFor(picked.name)}
                accent="#C4703C"
                size={54}
                selected
              />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text
                  numberOfLines={1}
                  style={{
                    fontFamily: fonts.serif,
                    fontSize: 25,
                    // 1.28x, not 1.16x. This renders a CONTACT'S NAME — arbitrary user
                    // content — and Fraunces has deep descenders, so a "j", "y" or "g"
                    // clipped against the line box. Fixed display strings can carry a
                    // tighter ratio because you can see them render; a name you have
                    // never seen cannot.
                    lineHeight: 32,
                    letterSpacing: 0.25,
                    color: '#2E2B25',
                  }}
                >
                  {picked.name}
                </Text>
                <Text
                  style={{
                    marginTop: 2,
                    fontFamily: fonts.body,
                    fontSize: 9.5,
                    lineHeight: 14,
                    letterSpacing: 1.6,
                    color: '#8C491A',
                  }}
                >
                  ADDING TO FAVORITES
                </Text>
              </View>
            </View>

            {/* EVERYTHING BETWEEN THE HEADER AND THE PILL SCROLLS.
                This was a plain column inside a height-capped sheet, so on a
                shorter phone Yoga squeezed the rows to fit: the gaps collapsed and
                the record row's label was compressed out of existence. A
                ScrollView lays its content out at natural height and scrolls
                instead of compressing, so the spacing below is the spacing you
                see on every device. */}
            <ScrollView
              // flexShrink so the sheet is only as tall as its content needs, and
              // the pinned rows below can never be pushed off the bottom.
              //
              // minHeight is the KEYBOARD FIX. With the keyboard up the sheet loses
              // ~340pt, and because this view could shrink without limit Yoga took the
              // space from here first — collapsing the scroller until the pinned record
              // row below sat right on top of the note field, which is the "recording
              // piece covers up the wording" report. A floor means the note you are
              // typing keeps its room and the overflow scrolls, which is what a
              // ScrollView is for.
              style={{ marginTop: keyboardUp ? spacing.md : spacing.lg, flexShrink: 1, minHeight: 132 }}
              contentContainerStyle={{
                paddingBottom: spacing.sm,
                gap: keyboardUp ? spacing.lg : spacing.xl,
              }}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
            {/* A soft container rather than two floating rules: the note needs to
                read as one field you can tap into. Warm off-white on cream with a
                faint terracotta edge — present, not brash. */}
            <View
              style={{
                padding: spacing.base,
                borderRadius: radius.lg,
                // OPAQUE. At 42% alpha this panel was letting the dark backdrop
                // through the glass sheet, so the note you typed sat on a gray-brown
                // wash instead of warm paper.
                backgroundColor: '#FFFCF7',
                borderWidth: 1,
                borderColor: 'rgba(178,98,45,0.11)',
              }}
            >
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 12,
              }}
            >
              <Text
                style={{
                  fontFamily: fonts.body,
                  fontSize: 10,
                  letterSpacing: 1.6,
                  color: 'rgba(32,30,29,0.62)',
                }}
              >
                WHY THEY MATTER
              </Text>
              <View style={{ flex: 1, height: 1, backgroundColor: 'rgba(32,30,29,0.55)' }} />
              <Text
                style={{
                  fontFamily: fonts.body,
                  fontSize: 12.5,
                  color: 'rgba(32,30,29,0.42)',
                }}
              >
                Optional
              </Text>
            </View>

            {/* The note itself: large serif, no box. Tapping it focuses the field
                and raises the keyboard — the bordered input read as a form, which
                is not what this moment is. */}
            <TextInput
              value={note}
              onChangeText={setNote}
              editable={!dictation.active && !dictation.transcribing}
              placeholder="Met at the Bryant Park coworking day — one of my closest collaborators."
              placeholderTextColor="rgba(32,30,29,0.38)"
              multiline
              style={{
                marginTop: spacing.sm,
                padding: 0,
                fontFamily: fonts.serif,
                fontSize: 17,
                lineHeight: 25,
                color: '#2E2B25',
                textAlignVertical: 'top',
                minHeight: 66,
              }}
            />
            </View>

            {/* Tags. Multi-select: someone can be work AND close AND sailing.
                Labeled, because an unlabelled row of chips under a note field
                reads as filter controls rather than something being recorded. */}
            <View style={{ gap: spacing.md }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <Text
                style={{
                  fontFamily: fonts.body,
                  fontSize: 10,
                  letterSpacing: 1.6,
                  color: 'rgba(32,30,29,0.62)',
                }}
              >
                HOW YOU KNOW THEM
              </Text>
              <View style={{ flex: 1, height: 1, backgroundColor: 'rgba(32,30,29,0.16)' }} />
            </View>
            <View
              style={{
                flexDirection: 'row',
                flexWrap: 'wrap',
                gap: 8,
              }}
            >
              {Array.from(new Set([...SUGGESTED_TAGS, ...tags])).map((t) => {
                const on = tags.includes(t);
                return (
                  <Pressable
                    key={t}
                    onPress={() =>
                      setTags((prev) =>
                        prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t],
                      )
                    }
                    accessibilityRole="button"
                    accessibilityLabel={`Tag ${t}`}
                    accessibilityState={{ selected: on }}
                    style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
                  >
                    <View
                      style={{
                        paddingHorizontal: 13,
                        height: 30,
                        borderRadius: radius.full,
                        alignItems: 'center',
                        justifyContent: 'center',
                        borderWidth: 1,
                        borderColor: on ? '#B2622D' : 'rgba(32,30,29,0.2)',
                        backgroundColor: on ? 'rgba(214,127,72,0.12)' : 'transparent',
                      }}
                    >
                      <Text
                        style={{
                          fontFamily: fonts.body,
                          fontSize: 9.5,
                          letterSpacing: 1.2,
                          color: on ? '#8C491A' : 'rgba(32,30,29,0.6)',
                        }}
                      >
                        {t.toUpperCase()}
                      </Text>
                    </View>
                  </Pressable>
                );
              })}

              {addingTag ? (
                <View
                  style={{
                    paddingHorizontal: 12,
                    height: 30,
                    borderRadius: radius.full,
                    borderWidth: 1,
                    borderColor: '#B2622D',
                    justifyContent: 'center',
                    minWidth: 130,
                  }}
                >
                  <TextInput
                    value={customTag}
                    onChangeText={setCustomTag}
                    autoFocus
                    autoCapitalize="none"
                    placeholder="new tag"
                    placeholderTextColor="rgba(32,30,29,0.38)"
                    returnKeyType="done"
                    onSubmitEditing={() => {
                      const t = customTag.trim().toLowerCase();
                      if (t) setTags((prev) => (prev.includes(t) ? prev : [...prev, t]));
                      setCustomTag('');
                      setAddingTag(false);
                    }}
                    onBlur={() => setAddingTag(false)}
                    style={{
                      padding: 0,
                      fontFamily: fonts.body,
                      fontSize: 12.5,
                      letterSpacing: 1.2,
                      color: '#2E2B25',
                    }}
                  />
                </View>
              ) : (
                <Pressable
                  onPress={() => setAddingTag(true)}
                  accessibilityRole="button"
                  accessibilityLabel="Add a custom tag"
                  style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
                >
                  <View
                    style={{
                      paddingHorizontal: 13,
                      height: 30,
                      borderRadius: radius.full,
                      alignItems: 'center',
                      justifyContent: 'center',
                      borderWidth: 1,
                      borderStyle: 'dashed',
                      borderColor: 'rgba(32,30,29,0.25)',
                    }}
                  >
                    <Text
                      style={{
                        fontFamily: fonts.body,
                        fontSize: 9.5,
                        letterSpacing: 1.2,
                        color: 'rgba(32,30,29,0.45)',
                      }}
                    >
                      + TAG
                    </Text>
                  </View>
                </Pressable>
              )}
            </View>
            </View>

            </ScrollView>

            {/* The record row — PINNED, outside the ScrollView, so it and the CTA stay
                put while the note above scrolls. (It no longer HAS to be outside now
                that recording is tap-to-start rather than press-and-hold, but keeping
                the controls in a fixed place is still the right call.)
                Margins tighten with the keyboard so this row stops crowding the field
                it writes into. */}
            <View
              style={{
                marginTop: keyboardUp ? spacing.md : spacing.lg,
                marginBottom: keyboardUp ? spacing.md : spacing.lg,
              }}
            >
              <VoiceNoteRow
                active={dictation.active}
                transcribing={dictation.transcribing}
                compact={keyboardUp}
                onStart={dictation.start}
                onStop={dictation.stop}
                onCancel={dictation.cancel}
                getMetering={dictation.getMetering}
              />
            </View>

            {/* Submit. Ink pill, full width — no Skip: the note is already marked
                Optional, so a second way to say "not now" is just noise. */}
            <Pressable
              onPress={() => void submit()}
              disabled={saving}
              accessibilityRole="button"
              accessibilityLabel="Add to favorites"
              style={({ pressed }) => ({
                marginBottom: spacing.sm,
                opacity: saving ? 0.6 : pressed ? 0.9 : 1,
              })}
            >
              <View
                style={{
                  height: 54,
                  borderRadius: radius.full,
                  backgroundColor: '#201E1D',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexDirection: 'row',
                  gap: 10,
                }}
              >
                {saving ? <ActivityIndicator size="small" color="#FFF8F0" /> : null}
                <Text
                  style={{
                    fontFamily: fonts.body,
                    fontSize: 12.5,
                    letterSpacing: 1.6,
                    color: '#FFF8F0',
                  }}
                >
                  {saving ? 'ADDING…' : 'ADD TO FAVORITES'}
                </Text>
              </View>
            </Pressable>
          </>
        )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
