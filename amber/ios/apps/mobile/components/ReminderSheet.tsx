import { Modal, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Check, ChevronRight, Clock, Sparkles } from 'lucide-react-native';
import { Pressable } from './Pressable';
import { Avatar } from './Avatar';
import { CText } from './classical';
import { cl, HAIRLINE } from '../lib/classical';
import type { Reminder } from '../lib/reminders';

/**
 * THE REMINDER, OPENED.
 *
 * A reminder had no surface of its own. It was a card on Today with a checkbox,
 * and a lock-screen banner that routed to `/(gated)/home?tab=today` and stopped
 * there -- so tapping "Call Sagar at 7:30 AM" opened the app onto a day view and
 * left the user to find both the reminder and the person themselves. That is the
 * whole of the reported bug: the notification "didn't do anything".
 *
 * This is what the notification opens now. It is deliberately the SAME sheet
 * whether you arrive from a banner or from the card, because a reminder is one
 * thing and it should not read differently depending on how you got to it.
 *
 * What it holds is everything the reminder knows: what to do, when, the line
 * Amber heard it as, and -- when it is about somebody -- their card, one tap
 * away. Ticking it off from here is the same optimistic PATCH the card does, so
 * the two cannot disagree.
 *
 * A COMPONENT, not a block inside HomePage. Three surfaces will want it (Today,
 * the notification tap, and the person's own card once reminders appear there),
 * and the second of those already exists.
 */
export function ReminderSheet({
  visible,
  reminder,
  onClose,
  onOpenPerson,
  onToggleDone,
  onAsk,
}: {
  visible: boolean;
  /** null while the list is still loading, so the sheet can say so. */
  reminder: Reminder | null;
  onClose: () => void;
  onOpenPerson?: (contactId: string) => void;
  onToggleDone?: (reminderId: string, done: boolean) => void;
  /**
   * ASK ABOUT IT. "If I click on anything -- a reminder, a voice note, a
   * journal entry -- it should expand, and I should see the search bar."
   *
   * The bar itself is not mounted INSIDE this sheet, and that is deliberate
   * rather than lazy: a react-native Modal renders in its own native hierarchy
   * above the whole navigation stack, so a dock drawn in here could not open
   * the Ask surface (it would land behind this sheet) and its gestures would be
   * inert without a nested GestureHandlerRootView. One tap on this row closes
   * the sheet and opens the real bar, on the real Ask surface, with the
   * reminder already in the question.
   */
  onAsk?: (question: string) => void;
}) {
  const insets = useSafeAreaInsets();
  const due = reminder?.dueAt ? new Date(reminder.dueAt) : null;
  const dueValid = due && !Number.isNaN(due.getTime());
  const overdue = !!dueValid && !reminder?.done && due.getTime() < Date.now();

  // The full date, not the bare time the card shows. A sheet you opened from a
  // banner has to answer "when was this for" without you doing the arithmetic.
  const whenLabel = !dueValid
    ? null
    : `${due.toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'short',
        day: 'numeric',
      })} · ${due.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;

  const first = (reminder?.contact?.name ?? '').trim().split(/\s+/)[0];

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <Pressable
        onPress={onClose}
        accessibilityLabel="Close"
        style={{ flex: 1, backgroundColor: 'rgba(32,31,29,0.28)', justifyContent: 'flex-end' }}
      >
        {/* Swallows the tap so pressing the sheet does not dismiss it through
            the backdrop underneath. */}
        <Pressable
          onPress={() => {}}
          style={{
            backgroundColor: cl.groundCream,
            borderTopLeftRadius: 22,
            borderTopRightRadius: 22,
            paddingHorizontal: 18,
            paddingTop: 18,
            paddingBottom: Math.max(insets.bottom, 12) + 12,
            gap: 10,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Clock size={13} color={overdue ? cl.goldDeep : cl.ink48} strokeWidth={2.2} />
            <CText t="kicker" color={overdue ? cl.goldKicker : cl.ink45}>
              {reminder?.done ? 'REMINDER · DONE' : overdue ? 'REMINDER · DUE' : 'REMINDER'}
            </CText>
          </View>

          {!reminder ? (
            <CText t="body" color={cl.ink55} style={{ paddingVertical: 16 }}>
              Opening that reminder…
            </CText>
          ) : (
            <>
              <CText
                t="cardTitle"
                style={{
                  fontSize: 20,
                  textDecorationLine: reminder.done ? 'line-through' : 'none',
                }}
                color={reminder.done ? cl.ink38 : undefined}
              >
                {reminder.title}
              </CText>

              {whenLabel ? (
                <CText t="metaSm" color={overdue ? cl.goldDeep : cl.ink48}>
                  {whenLabel}
                </CText>
              ) : null}

              {/* The line Amber heard, when it says more than the title does.
                  Most reminders have a body identical to the title, and printing
                  the same sentence twice reads as a rendering bug. */}
              {reminder.body && reminder.body.trim() !== reminder.title.trim() ? (
                <CText t="body" color={cl.ink55} style={{ marginTop: 2 }}>
                  {reminder.body}
                </CText>
              ) : null}

              {reminder.contact?.id ? (
                <Pressable
                  onPress={() => onOpenPerson?.(reminder.contact!.id)}
                  accessibilityRole="button"
                  accessibilityLabel={`Open ${reminder.contact.name ?? 'contact'}`}
                  style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
                >
                  <View
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 12,
                      marginTop: 8,
                      paddingVertical: 12,
                      borderTopWidth: HAIRLINE,
                      borderTopColor: cl.gold12,
                      borderBottomWidth: HAIRLINE,
                      borderBottomColor: cl.gold12,
                    }}
                  >
                    <Avatar name={reminder.contact.name ?? undefined} size={34} />
                    <View style={{ flex: 1 }}>
                      <CText t="body" color={cl.ink} numberOfLines={1}>
                        {reminder.contact.name || 'Contact'}
                      </CText>
                      <CText t="metaSm" color={cl.ink48}>
                        {first ? `About ${first}` : 'About this person'}
                      </CText>
                    </View>
                    <ChevronRight size={18} color={cl.ink38} strokeWidth={2} />
                  </View>
                </Pressable>
              ) : null}

              {onAsk ? (
                <Pressable
                  onPress={() => {
                    const who = reminder.contact?.name?.trim();
                    onClose();
                    // Seeded as a question rather than a bare title, because
                    // the Ask surface answers questions -- and the person, when
                    // there is one, is what makes the answer about a
                    // relationship rather than about a task.
                    onAsk(
                      who
                        ? `About my reminder to ${reminder.title} — what should I know about ${who}?`
                        : `About my reminder: ${reminder.title}`,
                    );
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="Ask Amber about this reminder"
                  style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, marginTop: 8 })}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Sparkles size={14} color={cl.goldDeep} strokeWidth={2.2} />
                    <CText t="metaSm" color={cl.goldDeep}>
                      Ask Amber about this
                    </CText>
                  </View>
                </Pressable>
              ) : null}

              <Pressable
                onPress={() => {
                  onToggleDone?.(reminder.reminderId, !reminder.done);
                  onClose();
                }}
                accessibilityRole="button"
                accessibilityLabel={reminder.done ? 'Mark as not done' : 'Mark as done'}
                style={({ pressed }) => ({
                  marginTop: 6,
                  opacity: pressed ? 0.7 : 1,
                })}
              >
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 8,
                    height: 46,
                    borderRadius: 999,
                    borderWidth: HAIRLINE,
                    borderColor: cl.gold40,
                    backgroundColor: reminder.done ? 'transparent' : cl.card,
                  }}
                >
                  {reminder.done ? null : (
                    <Check size={16} color={cl.goldDeep} strokeWidth={2.4} />
                  )}
                  <CText t="body" color={reminder.done ? cl.ink55 : cl.ink}>
                    {reminder.done ? 'Put it back' : 'Mark it done'}
                  </CText>
                </View>
              </Pressable>
            </>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}
