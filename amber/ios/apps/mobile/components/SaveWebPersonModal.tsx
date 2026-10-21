import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Check, Mic, X } from 'lucide-react-native';
import { Pressable } from './Pressable';
import { Text } from './Text';
import { RecordingWaveform } from './RecordingWaveform';
import { createContactFromWeb } from '../lib/contacts';
import { useVoiceDictation } from '../lib/useVoiceDictation';
import { toast } from '../lib/toast';
import type { WebPerson } from '../lib/chat';
import { LIGHT } from '../lib/theme';
import { elevation, fonts, radius, spacing } from '../lib/tokens';

// SAVE A STRANGER AS A CONTACT — the sheet you get from a web profile card.
//
// Deliberately the same shape as AddFavoriteModal: a tag row and a note you can speak
// or type. Someone you just found is exactly when the context is in your head ("VP at
// Zocdoc, warm intro through Sagar, chase in September") and exactly when it is
// cheapest to record. A save button with no capture step means the contact lands as a
// bare name, which is how address books become useless.
//
// The tags are the words the user picks, not derived from anything. They merge into
// whatever tags the contact already has server-side, so saving someone twice never
// discards enrichment's tags.

/** The tags people actually reach for. Anything else goes in the note. */
const TAG_PRESETS = ['work', 'friend', 'reach out', 'investor', 'recruiting', 'intro'];

export function SaveWebPersonModal({
  person,
  onClose,
  onSaved,
}: {
  /** null closes the sheet. */
  person: WebPerson | null;
  onClose: () => void;
  onSaved?: (contactId: string) => void;
}) {
  const insets = useSafeAreaInsets();
  const [tags, setTags] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  // Reset every time the sheet opens for a new person — a note meant for one stranger
  // must never follow you to the next.
  useEffect(() => {
    if (person) {
      setTags([]);
      setNote('');
      setSaving(false);
    }
  }, [person]);

  // Speak the note instead of typing it. The transcript lands in the FIELD rather than
  // saving itself, so a misheard name can be fixed before it becomes a permanent note.
  const dictation = useVoiceDictation({
    onUtterance: (t: string) => setNote((v) => (v.trim() ? `${v.trim()} ${t}` : t)),
  });

  const toggleTag = (t: string) =>
    setTags((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));

  const save = () => {
    if (!person || saving) return;
    setSaving(true);
    // Stop the mic first: a recording still running while the sheet closes would keep
    // the audio session open with nowhere to put the transcript.
    if (dictation.active) dictation.stop();
    void createContactFromWeb({
      name: person.name,
      profileUrl: person.url,
      title: person.title,
      company: person.company,
      snippet: person.snippet,
      tags,
      note,
    }).then((res) => {
      setSaving(false);
      if (!res.ok) {
        toast.error('Could not save that contact.');
        return;
      }
      const first = person.name.split(/\s+/)[0];
      // Say what is still happening. The contact and its profile link exist now;
      // title, company, city and the rest arrive a second or two later, and a flat
      // "saved" would make that look like data appearing out of nowhere.
      toast.success(
        res.data.enriching
          ? `${first} saved. Filling in what we can find\u2026`
          : `${first} saved to your contacts.`,
      );
      onSaved?.(res.data.contactId);
      onClose();
    });
  };

  const detail = person ? [person.title, person.company].filter(Boolean).join(' · ') : '';

  return (
    <Modal visible={!!person} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable
        onPress={onClose}
        style={{ flex: 1, backgroundColor: 'rgba(32,31,29,0.35)', justifyContent: 'flex-end' }}
      >
        {/* Swallow taps on the sheet so the backdrop's dismiss doesn't fire through it. */}
        <Pressable onPress={() => {}} style={{ width: '100%' }}>
          <View
            style={{
              backgroundColor: LIGHT.surface,
              borderTopLeftRadius: 24,
              borderTopRightRadius: 24,
              paddingHorizontal: spacing.lg,
              paddingTop: spacing.lg,
              paddingBottom: insets.bottom + spacing.lg,
              gap: spacing.lg,
              ...elevation.lg,
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text variant="microLabel" uppercase>
                  Save to contacts
                </Text>
                <Text variant="titleMd" style={{ color: LIGHT.textPrimary, marginTop: 4 }}>
                  {person?.name ?? ''}
                </Text>
                {detail ? (
                  <Text variant="bodySm" style={{ color: LIGHT.textSecondary, marginTop: 2 }}>
                    {detail}
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
                    borderWidth: 1,
                    borderColor: LIGHT.hairline,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <X color={LIGHT.textSecondary} size={18} strokeWidth={2.25} />
                </View>
              </Pressable>
            </View>

            <View style={{ gap: spacing.sm }}>
              <Text variant="captionSm" style={{ color: LIGHT.textSecondary, letterSpacing: 1 }}>
                HOW DO YOU KNOW THEM
              </Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {TAG_PRESETS.map((t) => {
                  const on = tags.includes(t);
                  return (
                    <Pressable
                      key={t}
                      onPress={() => toggleTag(t)}
                      accessibilityRole="button"
                      accessibilityState={{ selected: on }}
                      accessibilityLabel={t}
                      hitSlop={6}
                      style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
                    >
                      <View
                        style={{
                          paddingHorizontal: 13,
                          paddingVertical: 8,
                          borderRadius: radius.full,
                          borderWidth: 1,
                          borderColor: on ? 'rgba(140,73,26,0.5)' : 'rgba(32,30,29,0.14)',
                          backgroundColor: on ? 'rgba(178,98,45,0.12)' : 'transparent',
                        }}
                      >
                        <Text
                          variant="captionSm"
                          style={{ color: on ? '#8C491A' : LIGHT.textSecondary }}
                        >
                          {t.toUpperCase()}
                        </Text>
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            <View style={{ gap: spacing.sm }}>
              <Text variant="captionSm" style={{ color: LIGHT.textSecondary, letterSpacing: 1 }}>
                ANYTHING WORTH REMEMBERING
              </Text>
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'flex-end',
                  gap: 10,
                  borderWidth: 1,
                  borderColor: LIGHT.hairline,
                  borderRadius: radius.lg,
                  paddingHorizontal: 12,
                  paddingVertical: 10,
                }}
              >
                <TextInput
                  value={note}
                  onChangeText={setNote}
                  placeholder={
                    dictation.transcribing ? 'Writing it down…' : 'Why they matter, how to open…'
                  }
                  placeholderTextColor={LIGHT.textMuted}
                  multiline
                  style={{
                    flex: 1,
                    minWidth: 0,
                    // NOT padding: 0 — a zero-padding input clips the descender on a
                    // "y" or "g" at this size.
                    minHeight: 44,
                    maxHeight: 110,
                    paddingVertical: 2,
                    fontFamily: fonts.serifItalic,
                    fontSize: 15,
                    lineHeight: 22,
                    color: LIGHT.textPrimary,
                  }}
                />
                <Pressable
                  onPress={() => {
                    if (dictation.transcribing) return;
                    if (dictation.active) dictation.stop();
                    else dictation.start();
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={dictation.active ? 'Stop dictation' : 'Dictate a note'}
                  hitSlop={10}
                  style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
                >
                  <View
                    style={{
                      width: 34,
                      height: 34,
                      borderRadius: 17,
                      borderWidth: 1,
                      borderColor: dictation.active ? 'rgba(140,73,26,0.5)' : LIGHT.hairline,
                      backgroundColor: dictation.active ? 'rgba(178,98,45,0.12)' : 'transparent',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {dictation.active ? (
                      <RecordingWaveform
                        getMetering={dictation.getMetering}
                        active
                        color="#8C491A"
                        bars={3}
                        barWidth={2}
                        gap={2}
                        height={14}
                      />
                    ) : (
                      <Mic size={16} color={LIGHT.textSecondary} strokeWidth={2} />
                    )}
                  </View>
                </Pressable>
              </View>
            </View>

            <Pressable
              onPress={save}
              disabled={saving}
              accessibilityRole="button"
              accessibilityLabel="Save contact"
              style={({ pressed }) => ({ opacity: saving ? 0.6 : pressed ? 0.85 : 1 })}
            >
              <View
                style={{
                  height: 50,
                  borderRadius: radius.full,
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  backgroundColor: LIGHT.accentText,
                  ...elevation.sm,
                }}
              >
                {saving ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Check size={17} color="#FFFFFF" strokeWidth={2.5} />
                )}
                <Text variant="buttonSm" style={{ color: '#FFFFFF' }}>
                  {saving ? 'Saving…' : 'Save contact'}
                </Text>
              </View>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
