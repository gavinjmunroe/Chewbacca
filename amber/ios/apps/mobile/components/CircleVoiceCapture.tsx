import { ChatProvider, useChat } from '../lib/ChatContext';
import { VoiceNoteRecorder } from './VoiceNoteRecorder';
import { setNoteShare } from '../lib/noteShares';
import { uploadNoteAudio } from '../lib/noteMedia';
import {
  parseAndScheduleReminders,
  reminderConfirmationText,
  scheduleFailureText,
} from '../lib/reminders';
import { toast } from '../lib/toast';

// RECORD A NOTE STRAIGHT INTO A CIRCLE.
//
// Before this, sharing a note with a circle meant going back to the home tab,
// recording there, and picking the circle out of a list — so the one place where
// you are already looking at a circle was the one place you could not talk to it.
//
// The capture pipeline is the same one home uses: the transcript goes through
// /v1/chat (so it still files facts onto whoever it mentions and still lands in
// Today), the clip is uploaded once the note has an id, and the audience is then
// set to THIS circle. The difference is only that the audience is decided by where
// you are standing rather than by a picker — which is why the recorder is mounted
// without `shareControl`.
//
// It brings its OWN ChatProvider. The circle screen is a pushed route and is not
// inside home's provider, and the alternative — hoisting the provider to the
// layout — would put one shared conversation behind every screen in the app, so a
// note recorded in a circle could append to whatever thread Ask happened to be on.
// A provider per capture surface keeps each note its own conversation, which is
// exactly the invariant home already relies on when it calls resetChat().
export function CircleVoiceCapture({
  visible,
  circleId,
  circleName,
  onClose,
}: {
  visible: boolean;
  circleId: string;
  circleName: string;
  /** Called on cancel AND on submit; the share/upload work continues after. */
  onClose: () => void;
  /** Fired once the note has been shared, so the feed can refetch. */
}) {
  return (
    <ChatProvider>
      <CircleVoiceCaptureInner
        visible={visible}
        circleId={circleId}
        circleName={circleName}
        onClose={onClose}
      />
    </ChatProvider>
  );
}

function CircleVoiceCaptureInner({
  visible,
  circleId,
  circleName,
  onClose,
}: {
  visible: boolean;
  circleId: string;
  circleName: string;
  onClose: () => void;
}) {
  const { runSearch, resetChat, getConversationId } = useChat();
  return (
    <VoiceNoteRecorder
      visible={visible}
      title={`Note for ${circleName}`}
      onCancel={onClose}
      onDone={(t, _scope, media) => {
        onClose();
        const text = t.trim();
        if (!text) return;
        // Fresh conversation per note, so this never appends to a previous one.
        resetChat();
        // 'soundboard' keeps the reply short — nobody is reading a reply here, the
        // note itself is the point — while capture still runs in full.
        void runSearch(text, undefined, undefined, 'soundboard').then(() => {
          const noteId = getConversationId();
          if (!noteId) {
            toast.error('Saved your words, but could not share them to the circle.');
            return;
          }
          // Audio first and not awaited: a slow upload must not delay the note
          // appearing in the circle. The feed gains a player when it lands.
          if (media?.uri) {
            void uploadNoteAudio(noteId, media.uri, {
              durationMs: media.durationMs,
              peaks: media.peaks,
            }).then((ok) => {
              if (!ok) toast.error('Saved your words, but the audio did not upload.');
            });
          }
          void setNoteShare(noteId, {
            visibility: 'circle',
            targetId: circleId,
            targetName: circleName,
          }).then((res) => {
            if (res.ok) toast.success(`Shared with ${circleName}.`);
            else toast.error('Saved, but could not share that note.');
          });
        });
        // Same additive reminder pass home does; self-contained and never blocking.
        // A REFUSED WRITE IS NOT SILENCE. `.catch(() => {})` here, plus a
        // parse that returned [] on any error, is how an entire outage of
        // reminder writes stayed invisible for days.
        void parseAndScheduleReminders(text)
          .then((outcome) => {
            if (outcome.failure) {
              toast.error('Reminder not saved', scheduleFailureText(outcome.failure));
              return;
            }
            const copy = reminderConfirmationText(outcome.scheduled);
            if (copy) toast.success(copy);
          })
          .catch(() => {
            toast.error('Reminder not saved', 'Amber could not save it. Try again.');
          });
      }}
    />
  );
}
