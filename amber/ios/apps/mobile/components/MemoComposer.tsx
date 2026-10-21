import { contextualMemo, type MemoContext } from '../lib/memoContext';
import { X } from 'lucide-react-native';
import { cl } from '../lib/classical';
import { CaptureInput } from './CaptureInput';
import { randomUUID } from 'expo-crypto';
import Animated, { FadeIn, useReducedMotion } from 'react-native-reanimated';
import { useRef, useState, type ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { VoiceNotePlayer } from './VoiceNotePlayer';
import { VoiceNoteRecorder } from './VoiceNoteRecorder';
import {
  RequestReview,
  type MemoEntry,
  type ReviewRequest,
  type MemoActionsHandle,
} from './RequestReview';
import { requestStyles as s } from './MemoStyles';
/** The native modal and its sheet stay mounted from capture through every action receipt. */
export function MemoComposer({
  initialEntry,
  context,
  sortingFor,
  initialMode = 'capture',
  contacts,
  sample = false,
  onClose,
  onCaptured,
  onPreserve,
  onUpdated,
  onConfirm,
  renderDiscussion,
}: {
  renderDiscussion?: (entry: MemoEntry) => ReactNode;
  sortingFor?: (id: string) => import('../lib/memoObjects').MemoSorting | undefined;
  initialEntry?: MemoEntry | null;
  context?: MemoContext;
  initialMode?: 'capture' | 'voice';
  contacts: { id: string; name: string; detail?: string }[];
  sample?: boolean;
  onClose: () => void;
  onCaptured: (entry: MemoEntry) => void;
  onPreserve?: (entry: MemoEntry) => Promise<MemoEntry>;
  onUpdated: (entry: MemoEntry) => void;
  onConfirm: (entry: MemoEntry, request: ReviewRequest) => Promise<string>;
}) {
  const recordingId = useRef<string | null>(null);
  const recordingDate = useRef<string | null>(null);
  const actions = useRef<MemoActionsHandle>(null);
  const [voice, setVoice] = useState(initialMode === 'voice');
  const [entry, setEntry] = useState<MemoEntry | null>(initialEntry ?? null);
  const [captureBusy, setCaptureBusy] = useState(false);
  const [showActions, setShowActions] = useState(false);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [processingActions, setProcessingActions] = useState(false);
  const reduced = useReducedMotion();
  const busy = captureBusy || reviewBusy;
  const review = entry ? (
    <>
      {entry.media && (
        <View style={{ gap: 8, paddingBottom: 16 }}>
          <Text style={s.label}>ORIGINAL AUDIO</Text>
          <VoiceNotePlayer
            durationMs={entry.media.durationMs}
            peaks={entry.media.peaks}
            fetchAudio={async () => ({ playbackUrl: entry.media!.uri })}
          />
        </View>
      )}
      {renderDiscussion && <View>{renderDiscussion(entry)}</View>}
      {!renderDiscussion && (
        <View style={{ paddingHorizontal: 20 }}>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: showActions }}
            onPress={() => setShowActions((v) => !v)}
            style={{ paddingVertical: 14 }}
          >
            <Text style={[s.hint, { color: cl.goldDeep }]}>
              {showActions ? 'Hide updates' : 'Choose what to save'}
            </Text>
          </Pressable>
          {showActions && (
            <RequestReview
              showActions
              prepared={sortingFor?.(entry.id)}
              autoPrepare={false}
              actionRef={actions}
              embedded
              inline={!!renderDiscussion || (voice && !initialEntry)}
              visible
              initialText={entry.text}
              media={entry.media}
              source={entry.source}
              contacts={contacts}
              sample={sample}
              receipts={(entry.reviews ?? (entry.review ? [entry.review] : [])).map((receipt) => ({
                ...receipt,
                text: receipt.text ?? entry.text,
              }))}
              onTextChange={(text) => {
                const updated = { ...entry, text };
                setEntry(updated);
                onUpdated(updated);
              }}
              onBusyChange={setReviewBusy}
              onProcessingChange={setProcessingActions}
              onClose={onClose}
              onConfirm={(request) => onConfirm(entry, request)}
            />
          )}
        </View>
      )}
    </>
  ) : null;
  return (
    <Modal
      visible
      transparent
      animationType="fade"
      onRequestClose={() => {
        if (!busy) onClose();
      }}
    >
      <KeyboardAvoidingView
        style={s.backdrop}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View
          style={[
            s.glow,
            !entry && voice && { height: '54%', minHeight: 360, maxHeight: '90%' },
            !entry && !voice && { height: 'auto', maxHeight: '90%' },
          ]}
        >
          <View
            style={[s.sheet, !entry && !voice && { flex: 0, flexShrink: 1 }]}
            accessibilityViewIsModal
          >
            {!!context && (
              <Text style={[s.hint, { paddingHorizontal: 20, paddingTop: 16 }]}>
                Memo for {context.label}
              </Text>
            )}
            {entry && !voice ? (
              <>
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    paddingHorizontal: 20,
                    paddingVertical: 12,
                  }}
                >
                  <Text style={[s.body, { flex: 1 }]}>Your voice memo</Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Close memo actions"
                    disabled={busy}
                    onPress={onClose}
                    style={s.close}
                  >
                    <X color={cl.ink} />
                  </Pressable>
                </View>
                <ScrollView
                  keyboardShouldPersistTaps="handled"
                  contentContainerStyle={{ padding: 20 }}
                >
                  {review}
                </ScrollView>
              </>
            ) : !voice ? (
              <CaptureInput
                sample={sample}
                onClose={onClose}
                onRecord={() => setVoice(true)}
                onCapture={(captured) => {
                  setEntry(captured);
                  onCaptured(captured);
                }}
              />
            ) : (
              <VoiceNoteRecorder
                embedded
                glow
                preserveSurface
                localOnly={sample}
                visible
                completed={!!entry}
                processingActions={processingActions}
                reviewBusy={reviewBusy}
                reviewContent={
                  entry ? (
                    <Animated.View entering={reduced ? undefined : FadeIn.duration(220)}>
                      {review}
                    </Animated.View>
                  ) : null
                }
                onBeforeProcess={
                  onPreserve
                    ? async (media) => {
                        recordingId.current ??= randomUUID();
                        recordingDate.current ??= new Date().toISOString();
                        const id = recordingId.current;
                        const saved = await onPreserve({
                          id,
                          text: '',
                          context,
                          media,
                          createdAt: recordingDate.current,
                          destination: 'Transcript needed',
                          ...(!sample ? { cloud: { conversationId: id, originalText: '' } } : {}),
                        });
                        return saved.media!;
                      }
                    : undefined
                }
                onProcessingChange={setCaptureBusy}
                onCancel={onClose}
                onDone={(transcript, _scope, media) => {
                  const text = contextualMemo(transcript, context);
                  const id = recordingId.current ?? randomUUID();
                  const captured: MemoEntry = {
                    id,
                    ...(!sample ? { cloud: { conversationId: id, originalText: text } } : {}),
                    text,
                    media,
                    createdAt: recordingDate.current ?? new Date().toISOString(),
                    destination: 'Needs review',
                    context,
                  };
                  setEntry(captured);
                  onCaptured(captured);
                }}
              />
            )}
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
