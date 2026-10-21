import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X } from 'lucide-react-native';
import { Text } from './Text';
import { GlassSurface } from './LiquidGlass';
import { ShareScopePicker } from './ShareScopePicker';
import { getNoteShare, setNoteShare, type NoteShareScope } from '../lib/noteShares';
import { toast } from '../lib/toast';
import { LIGHT } from '../lib/theme';
import { elevation, radius, spacing } from '../lib/tokens';

// The 3-dots "Network" modal for a voice-note card. Reads the note's current
// audience, lets the user change it (Private / Network / Circle / Contact), and
// writes it back. Rendered on a Liquid Glass surface (opaque enough to stay
// readable) on iOS 26+, with the existing opaque surface as the fallback.
export function NoteSharingModal({
  visible,
  noteId,
  onClose,
  heading = 'Network',
  subheading = 'Choose who can see this voice note.',
}: {
  visible: boolean;
  noteId: string | null;
  onClose: () => void;
  /**
   * Overridable copy, because this sheet now has two callers with two framings.
   * From a voice-note card it is "Network" — you are editing an existing note's
   * audience. From an Ask answer it is "Send this" — you are handing something you
   * just found to someone. Same mechanism, and calling both of them "Network"
   * would be the same words-doing-two-jobs problem this sheet already had once.
   */
  heading?: string;
  subheading?: string;
}) {
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [scope, setScope] = useState<NoteShareScope>({
    visibility: 'private',
    targetId: null,
    targetName: null,
  });

  // Load the current audience each time the sheet opens for a note.
  useEffect(() => {
    if (!visible || !noteId) return undefined;
    let cancelled = false;
    setLoading(true);
    setScope({ visibility: 'private', targetId: null, targetName: null });
    void getNoteShare(noteId).then((res) => {
      if (cancelled) return;
      if (res.ok) {
        setScope({
          visibility: res.data.visibility,
          targetId: res.data.targetId,
          targetName: res.data.targetName,
        });
      }
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [visible, noteId]);

  const canSave =
    !saving &&
    !loading &&
    !(
      (scope.visibility === 'circle' || scope.visibility === 'contact') && !scope.targetId
    );

  const handleSave = () => {
    if (!noteId || !canSave) return;
    setSaving(true);
    void setNoteShare(noteId, scope).then((res) => {
      setSaving(false);
      if (!res.ok) {
        toast.error('Could not update sharing.');
        return;
      }
      // A shared note used to not appear until you left the screen and came back,
      // because nothing here told the feeds their data was stale — leaving and
      // returning worked only because that refetches on focus. The audience is
      // what puts a note in a feed, so changing it invalidates both feeds that
      // render shared notes.
      qc.invalidateQueries({ queryKey: ['notes', 'feed'] });
      qc.invalidateQueries({ queryKey: ['connect', 'feed'] });
      const where =
        scope.visibility === 'private'
          ? null
          : scope.visibility === 'network'
            ? 'your network'
            : scope.targetName ?? `this ${scope.visibility}`;
      toast.success(where ? `Shared with ${where}.` : 'Note is now private.');
      onClose();
    });
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable
        onPress={onClose}
        style={{ flex: 1, backgroundColor: 'rgba(32,31,29,0.35)', justifyContent: 'flex-end' }}
      >
        {/* Stop the backdrop's onPress from closing when tapping the sheet. */}
        <Pressable onPress={() => {}} style={{ width: '100%' }}>
          <GlassSurface
            glassStyle="regular"
            tintColor="rgba(255,253,250,0.72)"
            style={{
              borderTopLeftRadius: 24,
              borderTopRightRadius: 24,
              paddingHorizontal: spacing.lg,
              paddingTop: spacing.lg,
              paddingBottom: insets.bottom + spacing.lg,
              gap: spacing.lg,
              overflow: 'hidden',
            }}
            fallbackStyle={{ backgroundColor: LIGHT.surface, ...elevation.lg }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <View style={{ flex: 1 }}>
                {/* "Network", matching the menu item that opens this. This sheet
                    controls the audience INSIDE Amber; the menu's separate "Share"
                    is the iOS share sheet, which leaves the app. Two words that
                    looked like the same word were doing two different jobs. */}
                <Text variant="microLabel" uppercase>
                  {heading}
                </Text>
                <Text variant="bodySm" style={{ color: LIGHT.textSecondary, marginTop: 2 }}>
                  {subheading}
                </Text>
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
                    backgroundColor: LIGHT.surface,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <X color={LIGHT.textSecondary} size={18} strokeWidth={2.25} />
                </View>
              </Pressable>
            </View>

            {loading ? (
              <View style={{ paddingVertical: spacing.lg, alignItems: 'center' }}>
                <ActivityIndicator color={LIGHT.textMuted} />
              </View>
            ) : (
              <ShareScopePicker value={scope} onChange={setScope} includePrivate />
            )}

            <Pressable
              onPress={handleSave}
              disabled={!canSave}
              accessibilityRole="button"
              accessibilityLabel="Save sharing"
              style={({ pressed }) => ({ opacity: !canSave ? 0.5 : pressed ? 0.85 : 1 })}
            >
              <View
                style={{
                  height: 50,
                  borderRadius: radius.full,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: LIGHT.accentText,
                  ...elevation.sm,
                }}
              >
                <Text variant="buttonSm" style={{ color: '#FFFFFF' }}>
                  {saving ? 'Saving…' : 'Save'}
                </Text>
              </View>
            </Pressable>
          </GlassSurface>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
