import { useChat } from '../lib/ChatContext';
import { publishPendingNote } from '../lib/pendingNote';
import { VoiceNoteRecorder } from './VoiceNoteRecorder';
import {
  parseAndScheduleReminders,
  reminderConfirmationText,
  scheduleFailureText,
} from '../lib/reminders';
import { setNoteShare, type NoteShareScope } from '../lib/noteShares';
import { uploadNoteAudio } from '../lib/noteMedia';
import { toast } from '../lib/toast';

// The home voice note: the egg opens THIS light recorder (no glow, no dark
// screen). What you say runs through the same capture pipeline as everything
// else, so it files onto the right people and lands as a voice note in Today.
// Rendered inside ChatProvider so it can reach runSearch.
export function HomeVoiceCapture({
  visible,
  onClose,
  onFloatingChange,
}: {
  visible: boolean;
  onClose: () => void;
  /** Passed straight through: the screen needs to know when the recorder has
   *  been minimized so the search bar can go inert. */
  onFloatingChange?: (floating: boolean) => void;
}) {
  const { runSearch, resetChat, notifyHomeNote, getConversationId } = useChat();
  return (
    <VoiceNoteRecorder
      visible={visible}
      title="New voice note"
      shareControl
      // Home is the one place the pill can be positioned correctly (it renders in
      // home.tsx's full-screen root, outside the pager), and it is the place the
      // recording most needs to survive being left alone: you start a note, then
      // want to look someone up mid-thought.
      minimizable
      onFloatingChange={onFloatingChange}
      onCancel={onClose}
      onDone={(
        t,
        scope?: NoteShareScope,
        media?: { uri: string; durationMs: number; peaks: number[] },
      ) => {
        onClose();
        const text = t.trim();
        if (!text) return;
        // Start a fresh conversation so each voice note is its own Today card and
        // never appends to a prior Ask thread. 'soundboard' keeps the reply short;
        // capture still files the note to whoever it mentions. Refresh Today once
        // it's persisted so the new note shows without a remount.
        resetChat();
        // ON THE FEED NOW, not in a second and not after a tab change. The
        // transcript exists on this device already; the card does not need to wait
        // for a round trip to prove it. lib/pendingNote holds it until the real row
        // arrives and then steps aside. It is upgraded to the real thread id on the
        // stream's `meta` event, so it becomes tappable almost immediately.
        publishPendingNote(text);
        const pending = runSearch(text, undefined, undefined, 'soundboard');
        // Then refresh for real. LADDERED, because the single 600ms shot this
        // replaces frequently fired before the server had created the conversation
        // row, and the next refresh was not until the whole reply finished — which
        // is the nine-second gap that made leaving the tab and coming back look
        // like the fix. Cheap: HomePage never blanks the feed on a refetch.
        const bumps = [400, 1200, 2500, 5000].map((ms) => setTimeout(() => notifyHomeNote(), ms));
        void pending.finally(() => bumps.forEach(clearTimeout));
        void pending.then(() => {
          notifyHomeNote();
          const audioNoteId = getConversationId();
          // UPLOAD THE CLIP ITSELF. Without this the note is transcript-only and
          // the feed shows no player — which is what "sharing a voice note"
          // looked like before. Started before the share call and not awaited by
          // it: a slow upload must not delay the note appearing in the circle,
          // and the feed simply gains a player when it finishes.
          if (audioNoteId && media?.uri) {
            void uploadNoteAudio(audioNoteId, media.uri, {
              durationMs: media.durationMs,
              peaks: media.peaks,
            }).then((ok) => {
              if (!ok) toast.error('Saved your words, but the audio did not upload.');
            });
          }
          // The note id isn't known until the capture stream resolves; once it
          // is, apply the chosen audience (fire-and-forget with a toast). No
          // scope = the note stays private, so nothing to do.
          if (scope) {
            const noteId = getConversationId();
            if (noteId) {
              void setNoteShare(noteId, scope).then((res) => {
                if (res.ok) {
                  const where =
                    scope.visibility === 'network'
                      ? 'your network'
                      : scope.targetName ?? `this ${scope.visibility}`;
                  toast.success(`Shared with ${where}.`);
                } else {
                  toast.error('Saved, but could not share that note.');
                }
              });
            }
          }
        });
        // Additive side-effect: if the note contains a reminder ("remind me at
        // 6pm"), schedule an on-device local notification. Fire-and-forget and
        // fully self-contained — it never blocks or alters the capture above.
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
