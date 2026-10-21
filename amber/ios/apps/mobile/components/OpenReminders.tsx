import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { Check, ChevronRight } from 'lucide-react-native';
import { Pressable } from './Pressable';
import { CText } from './classical';
import { cl, HAIRLINE } from '../lib/classical';
import { hc } from '../lib/homeSurface';
import { spacing } from '../lib/tokens';
import { toast } from '../lib/toast';
import {
  listOpenReminders,
  repeatLabel,
  setOpenReminderDone,
  type OpenReminder,
} from '../lib/openReminders';

/**
 * WHAT YOU STILL OWE, AT THE TOP OF NOTES & JOURNAL.
 *
 *   "Anything that's a reminder, like 'remind me to pick up my clothes sometime
 *    this week,' should just be a notification and a reminder that sits at the
 *    top of your notes and journals until it's checked off. It doesn't need to
 *    go in the calendar. ... If someone says, 'Remind me to drink water every
 *    day,' there should be a reminder at the top of their notes and journals
 *    that says, 'Reminder: drink water.' If they check it off, it goes away for
 *    the day, but it's still on the next day and every other day."
 *
 * NOT ON THE CALENDAR, and that is the whole distinction. Anything with a stated
 * time is an event and belongs on the day above; these have no time, so there is
 * no row on a timeline to draw and no hour to file them under. An earlier
 * version of this put them at the top of the AGENDA, which was the right
 * persistence in the wrong place.
 *
 * TICKING IS PER DAY, NOT PER ROW. A repeating reminder is one row on the
 * server; "done" is a fact about (reminder, date). So the tick is sent with the
 * local date and a daily reminder ticked this morning is back tomorrow. See
 * migration 049 -- the reason reminder_completions is a table and not a status.
 *
 * IT RENDERS NOTHING WHEN THERE IS NOTHING. No empty state, no header, no gap:
 * a section that says "no reminders" is a line of dead page on a screen whose
 * standing complaint is whitespace.
 */
export function OpenReminders({
  /** The local date being viewed, YYYY-MM-DD. */
  onDate,
  /** Bumped when a capture lands, so a new reminder appears without a pull. */
  version = 0,
  onOpen,
}: {
  onDate: string;
  version?: number;
  onOpen?: (reminder: OpenReminder) => void;
}) {
  const [items, setItems] = useState<OpenReminder[]>([]);

  useEffect(() => {
    let alive = true;
    void listOpenReminders(onDate).then((next) => {
      if (alive) setItems(next);
    });
    return () => {
      alive = false;
    };
  }, [onDate, version]);

  /**
   * OPTIMISTIC, THEN CONFIRMED, AND PUT BACK ON FAILURE.
   *
   * The tick has to land under the thumb -- a checkbox that waits on a round
   * trip is a checkbox you tap twice, and the second tap un-ticks it. The row
   * stays visible struck through rather than vanishing: something disappearing
   * the instant you touch it gives you nothing to undo and no way to see that
   * the right one went.
   */
  const toggle = useCallback(
    async (r: OpenReminder) => {
      const next = !r.doneToday;
      const paint = (done: boolean) =>
        setItems((prev) => prev.map((i) => (i.id === r.id ? { ...i, doneToday: done } : i)));
      paint(next);
      const res = await setOpenReminderDone(r.id, onDate, next);
      if (!res.ok) {
        paint(r.doneToday);
        toast.error('Could not save that.');
      }
    },
    [onDate],
  );

  if (items.length === 0) return null;

  return (
    <View
      style={{
        borderRadius: 14,
        borderWidth: HAIRLINE,
        borderColor: 'rgba(139,127,209,0.28)',
        // The reminder tint the rest of the app already uses for this kind, so a
        // reminder looks like a reminder wherever it appears. See hc.note.
        backgroundColor: hc.note.reminder.bg,
        overflow: 'hidden',
      }}
    >
      {items.map((r, i) => (
        <Row
          key={r.id}
          reminder={r}
          first={i === 0}
          onToggle={() => void toggle(r)}
          onOpen={onOpen ? () => onOpen(r) : undefined}
        />
      ))}
    </View>
  );
}

function Row({
  reminder,
  first,
  onToggle,
  onOpen,
}: {
  reminder: OpenReminder;
  first: boolean;
  onToggle: () => void;
  onOpen?: () => void;
}) {
  const done = reminder.doneToday;
  const repeat = repeatLabel(reminder);
  const sub = [repeat, reminder.place].filter(Boolean).join(' · ');

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 11,
        paddingHorizontal: 14,
        paddingVertical: 12,
        borderTopWidth: first ? 0 : HAIRLINE,
        borderTopColor: 'rgba(139,127,209,0.20)',
      }}
    >
      {/*
        THE BOX IS ITS OWN TARGET INSIDE THE ROW'S. At 20pt it is under the 44pt
        Apple asks for, and an undersized target nested in a larger one that does
        something ELSE is the worst kind: miss it and you open the editor instead
        of ticking the thing off. The slop takes it past 44 in every direction.
      */}
      <Pressable
        onPress={onToggle}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: done }}
        accessibilityLabel={
          done ? `Mark ${reminder.title} as not done` : `Mark ${reminder.title} as done`
        }
        hitSlop={{ top: 14, bottom: 14, left: 14, right: 12 }}
        style={({ pressed }) => ({ opacity: pressed ? 0.55 : 1 })}
      >
        <View
          style={{
            width: 20,
            height: 20,
            borderRadius: 6,
            borderWidth: 1.75,
            alignItems: 'center',
            justifyContent: 'center',
            borderColor: done ? hc.note.reminder.dot : 'rgba(108,95,192,0.55)',
            backgroundColor: done ? hc.note.reminder.dot : 'transparent',
          }}
        >
          {done ? <Check size={13} color="#FFFFFF" strokeWidth={3} /> : null}
        </View>
      </Pressable>

      <Pressable
        onPress={onOpen}
        disabled={!onOpen}
        accessibilityRole="button"
        accessibilityLabel={`${reminder.title}. Edit.`}
        style={({ pressed }) => ({ flex: 1, opacity: pressed && onOpen ? 0.6 : 1 })}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
            <CText
              t="listTitle"
              numberOfLines={2}
              color={done ? cl.ink38 : cl.ink}
              style={done ? { textDecorationLine: 'line-through' } : undefined}
            >
              {reminder.title}
            </CText>
            {sub ? (
              <CText t="metaSm" color={done ? cl.ink30 : hc.note.reminder.label} numberOfLines={1}>
                {sub}
              </CText>
            ) : null}
          </View>
          {onOpen ? (
            <ChevronRight size={16} color="rgba(108,95,192,0.55)" strokeWidth={2} />
          ) : null}
        </View>
      </Pressable>
    </View>
  );
}

/** The gap this section leaves when it renders, so a caller can lay out around it. */
export const OPEN_REMINDERS_GAP = spacing.base;
