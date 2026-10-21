import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Modal, ScrollView, Switch, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { randomUUID, digestStringAsync, CryptoDigestAlgorithm } from 'expo-crypto';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Check, Clock, MapPin, Repeat as RepeatIcon, Trash2, User, X } from 'lucide-react-native';
import { Pressable } from './Pressable';
import { CText } from './classical';
import { cl, HAIRLINE } from '../lib/classical';
import { toast } from '../lib/toast';
import {
  deleteOpenReminder,
  updateOpenReminder,
  type OpenReminder,
  type Repeat,
} from '../lib/openReminders';
import {
  deleteCalendarEvent,
  eventPatchFrom,
  NOTIFY_CHOICES,
  REPEAT_CHOICES,
  reminderPatchFrom,
  createCalendarEvent,
  updateCalendarEvent,
  type EventDraft,
  type ReminderDraft,
} from '../lib/scheduleEdits';

/**
 * THE TWO EDITORS, WHICH ARE ONE EDITOR.
 *
 *   "Look at how this is all-encompassing and has everything you need. The
 *    reminders and events should both have stuff like this, but obviously
 *    reminders don't need a time in there because if it's a timed thing, then
 *    that would be an event which goes on the calendar. Make sense? But: how
 *    often it repeats, if the reminder involves someone, if there's a
 *    description, if the reminder involves a location, if the reminder should
 *    stop on a certain day."
 *
 * ONE COMPONENT, because the shell is identical and this codebase has already
 * learned that lesson the expensive way: two bottom bars styled to match by hand
 * drifted every time either was touched, and the fix was one bar, not a fifth
 * attempt at matching. Everything below the header is a list of rows, the rows
 * are shared, and the only difference between the two is WHICH rows.
 *
 * WHAT DIFFERS, AND WHY IT IS NOT COSMETIC. An event has a clock time and a
 * reminder does not -- that is the whole rule that decides which one a spoken
 * plan becomes, so the editor cannot blur it. An event gets Starts, Ends,
 * All-day and a notification measured in minutes BEFORE it. A reminder gets a
 * day it starts on and a time of day to be nudged at, because there is no
 * instant to count backwards from.
 *
 * NOTHING IS SAVED THAT WAS NOT CHANGED. See eventPatchFrom: the server refuses
 * an empty patch outright, and sending every field on every save would overwrite
 * whatever the user did not touch with whatever the screen was holding.
 */

type EventSubject = {
  kind: 'event';
  /**
   * null means this event does not exist yet -- the manual Add path. Everything
   * below the header is identical either way, which is the reason this is a null
   * id on the same component rather than a second sheet built to match: this
   * codebase has already paid for two surfaces styled to look the same.
   */
  id: string | null;
  creationKey?: string;
  draft: EventDraft;
  /** Shown, not editable: the event patch has no contact field. */
  personName: string | null;
};

type ReminderSubject = {
  kind: 'reminder';
  id: string;
  draft: ReminderDraft;
  personName: string | null;
};

export type EditorSubject = EventSubject | ReminderSubject;

/** Build the reminder editor's subject from a row of the strip. */
export function subjectFromReminder(r: OpenReminder): ReminderSubject {
  return {
    kind: 'reminder',
    id: r.id,
    personName: null,
    draft: {
      title: r.title,
      description: r.description ?? '',
      place: r.place ?? '',
      repeat: r.repeat,
      repeatUntil: r.repeatUntil,
      repeatDays: r.repeatDays,
      startsOn: r.startsOn,
      notifyAtLocal: r.notifyAtLocal,
    },
  };
}

export function ScheduleEditor({
  subject,
  onClose,
  onSaved,
}: {
  /** null closes it. Held as the value so the sheet fades with its content. */
  subject: EditorSubject | null;
  onClose: () => void;
  /** Fired after a save or a delete, so the day and the strip reload. */
  onSaved?: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [draft, setDraft] = useState<EditorSubject['draft'] | null>(null);
  const [busy, setBusy] = useState(false);
  const creationSeed = useRef(randomUUID());
  const saving = useRef(false);
  const [picker, setPicker] = useState<'start' | 'end' | 'until' | 'startsOn' | 'notifyAt' | null>(
    null,
  );
  const [showRepeat, setShowRepeat] = useState(false);
  const [showNotify, setShowNotify] = useState(false);

  /**
   * Reset when a DIFFERENT row is opened, and only then.
   *
   * Keyed on the id and kind rather than on the subject object: a refetch under
   * the editor hands back an equal-but-new object every time, and depending on
   * it would wipe whatever somebody is halfway through typing. The subject
   * itself is read through a ref so the dependency list can say exactly what it
   * means without lying to the linter about what this effect uses.
   */
  const subjectRef = useRef(subject);
  subjectRef.current = subject;
  const subjectId = subject?.id ?? null;
  const subjectKind = subject?.kind ?? null;
  useEffect(() => {
    const current = subjectRef.current;
    setDraft(current ? { ...current.draft } : null);
    creationSeed.current = current?.kind === 'event' && current.creationKey ? current.creationKey : randomUUID();
    setPicker(null);
    setShowRepeat(false);
    setShowNotify(false);
  }, [subjectId, subjectKind]);

  const isEvent = subject?.kind === 'event';
  const ev = isEvent ? (draft as EventDraft | null) : null;
  const rem = !isEvent ? (draft as ReminderDraft | null) : null;

  /** A row that does not exist yet cannot be diffed; it just needs a title. */
  const isNew = subject?.kind === 'event' && subject.id === null;

  const dirty = useMemo(() => {
    if (!subject || !draft) return false;
    // Save is enabled the moment there is something to call it. The server
    // requires a title and refuses a blank one, so the button must not offer to
    // send it.
    if (isNew) return ((draft as EventDraft).title || '').trim().length > 0;
    const patch =
      subject.kind === 'event'
        ? eventPatchFrom(subject.draft as EventDraft, draft as EventDraft)
        : reminderPatchFrom(subject.draft as ReminderDraft, draft as ReminderDraft);
    return Object.keys(patch).length > 0;
  }, [subject, draft, isNew]);

  const save = useCallback(async () => {
    if (!subject || !draft || saving.current) return;
    // A close with nothing changed is not a save. The server answers an empty
    // patch with a 400, and an error toast for "I looked at it" is nonsense.
    if (!dirty) {
      onClose();
      return;
    }
    saving.current = true;
    setBusy(true);
    try {
    if (isNew) {
      const hash = await digestStringAsync(CryptoDigestAlgorithm.SHA256, JSON.stringify([creationSeed.current, draft]));
      const requestId = `${hash.slice(0,8)}-${hash.slice(8,12)}-5${hash.slice(13,16)}-a${hash.slice(17,20)}-${hash.slice(20,32)}`;
      const made = await createCalendarEvent(draft as EventDraft, requestId);
      setBusy(false);
      if (!made.ok) {
        // NAMES THE FAILURE. A create that fails quietly is how an entire
        // outage of calendar writes went unnoticed for days.
        toast.error('Could not confirm the save', 'Retry this unchanged plan safely.');
        return;
      }
      toast.success('Event added.');
      onSaved?.();
      onClose();
      return;
    }
    const res =
      subject.kind === 'event'
        ? await updateCalendarEvent(
            subject.id as string,
            eventPatchFrom(subject.draft as EventDraft, draft as EventDraft),
          )
        : await updateOpenReminder(
            subject.id as string,
            reminderPatchFrom(subject.draft as ReminderDraft, draft as ReminderDraft),
          );
    setBusy(false);
    if (!res.ok) {
      toast.error('Could not save that', 'Try again in a moment.');
      return;
    }
    onSaved?.();
    onClose();
    } catch {
      toast.error('Could not confirm the save', 'Please retry.');
    } finally { saving.current = false; setBusy(false); }
  }, [subject, draft, dirty, isNew, onClose, onSaved]);

  const remove = useCallback(async () => {
    if (!subject) return;
    setBusy(true);
    const res =
      subject.kind === 'event'
        ? await deleteCalendarEvent(subject.id as string)
        : await deleteOpenReminder(subject.id as string);
    setBusy(false);
    if (!res.ok) {
      toast.error('Could not delete that', 'Try again in a moment.');
      return;
    }
    toast.success(subject.kind === 'event' ? 'Event deleted.' : 'Reminder deleted.');
    onSaved?.();
    onClose();
  }, [subject, onClose, onSaved]);

  const set = useCallback((patch: Record<string, unknown>) => {
    setDraft((d) => (d ? ({ ...d, ...patch } as EditorSubject['draft']) : d));
  }, []);

  const repeatLabel =
    REPEAT_CHOICES.find((c) => c.value === (draft as { repeat?: Repeat } | null)?.repeat)?.label ??
    'Does not repeat';
  const notifyLabel = ev
    ? (NOTIFY_CHOICES.find((c) => c.minutes === ev.notifyMinutesBefore)?.label ?? 'None')
    : (rem?.notifyAtLocal ?? 'None');

  return (
    <Modal
      visible={subject !== null}
      animationType="fade"
      transparent
      onRequestClose={onClose}
    >
      <View style={{ flex: 1, backgroundColor: 'rgba(32,31,29,0.28)', justifyContent: 'flex-end' }}>
        <View
          style={{
            backgroundColor: cl.groundCream,
            borderTopLeftRadius: 22,
            borderTopRightRadius: 22,
            paddingTop: 14,
            paddingBottom: Math.max(insets.bottom, 12) + 8,
            maxHeight: '92%',
          }}
        >
          {/* HEADER: close, what this is, save. Save is the only affirmative
              action up here; delete lives at the bottom, away from the thumb
              that is reaching for Save. */}
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingHorizontal: 18,
              paddingBottom: 10,
            }}
          >
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close"
              hitSlop={12}
              style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}
            >
              <X size={19} color={cl.ink48} strokeWidth={2} />
            </Pressable>
            <CText t="kicker" color={cl.ink45}>
              {isNew ? 'NEW EVENT' : isEvent ? 'EVENT' : 'REMINDER'}
            </CText>
            <Pressable
              onPress={() => void save()}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel="Save"
              hitSlop={12}
              style={({ pressed }) => ({ opacity: busy ? 0.5 : pressed ? 0.6 : 1 })}
            >
              <CText t="listTitle" color={dirty ? cl.goldDeep : cl.ink45}>
                {busy ? 'Saving…' : isNew ? 'Add' : 'Save'}
              </CText>
            </Pressable>
          </View>

          <ScrollView
            contentContainerStyle={{ paddingHorizontal: 18, paddingBottom: 20 }}
            keyboardShouldPersistTaps="handled"
          >
            {/* TITLE, big, first, and always. It is the one field somebody came
                here to fix more often than any other. */}
            <TextInput
              value={(draft as { title?: string } | null)?.title ?? ''}
              onChangeText={(t) => set({ title: t })}
              placeholder={isEvent ? 'Event' : 'Reminder'}
              placeholderTextColor={cl.ink38}
              accessibilityLabel="Title"
              style={{
                fontSize: 21,
                color: cl.ink,
                paddingVertical: 10,
                borderBottomWidth: HAIRLINE,
                borderBottomColor: cl.ruleFaint,
              }}
            />

            {ev ? (
              <>
                <ToggleRow
                  icon={<Clock size={17} color={cl.ink48} strokeWidth={2} />}
                  label="All day"
                  value={ev.allDay}
                  onChange={(v) => set({ allDay: v })}
                />
                <PickerRow
                  label="Starts"
                  value={formatWhen(ev.startsAt, ev.allDay)}
                  onPress={() => setPicker(picker === 'start' ? null : 'start')}
                  open={picker === 'start'}
                >
                  <DateTimePicker
                    value={new Date(ev.startsAt)}
                    mode={ev.allDay ? 'date' : 'datetime'}
                    display="spinner"
                    onChange={(_e, d) => d && set({ startsAt: d.toISOString() })}
                  />
                </PickerRow>
                {!ev.allDay ? (
                  <PickerRow
                    label="Ends"
                    value={ev.endsAt ? formatWhen(ev.endsAt, false) : 'Not set'}
                    onPress={() => setPicker(picker === 'end' ? null : 'end')}
                    open={picker === 'end'}
                  >
                    <DateTimePicker
                      // An event with no end yet opens the picker an hour after
                      // the start, which is the answer somebody is about to give.
                      value={new Date(ev.endsAt ?? new Date(ev.startsAt).getTime() + 3600_000)}
                      mode="datetime"
                      display="spinner"
                      onChange={(_e, d) => d && set({ endsAt: d.toISOString() })}
                    />
                  </PickerRow>
                ) : null}
              </>
            ) : rem ? (
              <PickerRow
                label="Starts on"
                value={rem.startsOn ? formatDay(rem.startsOn) : 'Today'}
                onPress={() => setPicker(picker === 'startsOn' ? null : 'startsOn')}
                open={picker === 'startsOn'}
              >
                <DateTimePicker
                  value={dayToDate(rem.startsOn) ?? new Date()}
                  mode="date"
                  display="spinner"
                  onChange={(_e, d) => d && set({ startsOn: dateToDay(d) })}
                />
              </PickerRow>
            ) : null}

            {/* HOW OFTEN. The same control for both, because "every weekend
                until Sunday" means the same thing on either. */}
            <ChoiceRow
              icon={<RepeatIcon size={17} color={cl.ink48} strokeWidth={2} />}
              label={repeatLabel}
              open={showRepeat}
              onPress={() => setShowRepeat((v) => !v)}
            >
              {REPEAT_CHOICES.map((c) => (
                <OptionRow
                  key={c.value}
                  label={c.label}
                  selected={(draft as { repeat?: Repeat } | null)?.repeat === c.value}
                  onPress={() => {
                    set({ repeat: c.value });
                    setShowRepeat(false);
                  }}
                />
              ))}
            </ChoiceRow>

            {/* WHICH DAYS, only for weekly, because the database only allows
                them there. See reminderPatchFrom. */}
            {rem && rem.repeat === 'weekly' ? (
              <WeekdayPicker
                days={rem.repeatDays ?? []}
                onChange={(days) => set({ repeatDays: days })}
              />
            ) : null}

            {(draft as { repeat?: Repeat } | null)?.repeat !== 'none' ? (
              <PickerRow
                label="Until"
                value={
                  (draft as { repeatUntil?: string | null } | null)?.repeatUntil
                    ? formatDay((draft as { repeatUntil: string }).repeatUntil)
                    : 'Forever'
                }
                onPress={() => setPicker(picker === 'until' ? null : 'until')}
                open={picker === 'until'}
              >
                <DateTimePicker
                  value={
                    dayToDate((draft as { repeatUntil?: string | null } | null)?.repeatUntil ?? null) ??
                    new Date()
                  }
                  mode="date"
                  display="spinner"
                  onChange={(_e, d) => d && set({ repeatUntil: dateToDay(d) })}
                />
                <Pressable
                  onPress={() => set({ repeatUntil: null })}
                  accessibilityRole="button"
                  accessibilityLabel="Repeat forever"
                  style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, paddingVertical: 8 })}
                >
                  <CText t="metaSm" color={cl.goldDeep}>
                    Keep going forever
                  </CText>
                </Pressable>
              </PickerRow>
            ) : null}

            {/* THE NUDGE. Minutes before for an event, a time of day for a
                reminder: there is no instant to count backwards from on a
                reminder, which is the same rule as everywhere else here. */}
            {ev ? (
              <ChoiceRow
                icon={<Clock size={17} color={cl.ink48} strokeWidth={2} />}
                label={`Notification: ${notifyLabel}`}
                open={showNotify}
                onPress={() => setShowNotify((v) => !v)}
              >
                {NOTIFY_CHOICES.map((c) => (
                  <OptionRow
                    key={c.label}
                    label={c.label}
                    selected={ev.notifyMinutesBefore === c.minutes}
                    onPress={() => {
                      set({ notifyMinutesBefore: c.minutes });
                      setShowNotify(false);
                    }}
                  />
                ))}
              </ChoiceRow>
            ) : rem ? (
              <PickerRow
                label="Remind me at"
                value={rem.notifyAtLocal ?? 'No notification'}
                onPress={() => setPicker(picker === 'notifyAt' ? null : 'notifyAt')}
                open={picker === 'notifyAt'}
              >
                <DateTimePicker
                  value={timeToDate(rem.notifyAtLocal)}
                  mode="time"
                  display="spinner"
                  onChange={(_e, d) => d && set({ notifyAtLocal: dateToTime(d) })}
                />
                <Pressable
                  onPress={() => set({ notifyAtLocal: null })}
                  accessibilityRole="button"
                  accessibilityLabel="No notification"
                  style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, paddingVertical: 8 })}
                >
                  <CText t="metaSm" color={cl.goldDeep}>
                    Do not notify me
                  </CText>
                </Pressable>
              </PickerRow>
            ) : null}

            <FieldRow
              icon={<MapPin size={17} color={cl.ink48} strokeWidth={2} />}
              label="Location"
              value={(draft as { place?: string } | null)?.place ?? ''}
              placeholder="Add a place"
              onChange={(t) => set({ place: t })}
            />

            <FieldRow
              label="Description"
              value={(draft as { description?: string } | null)?.description ?? ''}
              placeholder="Add a note"
              multiline
              onChange={(t) => set({ description: t })}
            />

            {/* WHO IT IS WITH, shown and not editable. The patch endpoint has no
                contact field, and a control that cannot save is worse than a
                line of text that tells you what Amber knows. */}
            {subject?.personName ? (
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 10,
                  paddingVertical: 14,
                  borderTopWidth: HAIRLINE,
                  borderTopColor: cl.ruleFaint,
                }}
              >
                <User size={17} color={cl.ink48} strokeWidth={2} />
                <CText t="body" color={cl.ink}>
                  {subject.personName}
                </CText>
              </View>
            ) : null}

            {/* NOTHING TO DELETE ON SOMETHING THAT DOES NOT EXIST YET. The
                delete would 404, and offering it on a blank form reads as a way
                to discard the draft -- which is what Close already is. */}
            {isNew ? null : (
            <Pressable
              onPress={() => void remove()}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel={isEvent ? 'Delete event' : 'Delete reminder'}
              style={({ pressed }) => ({
                opacity: busy ? 0.5 : pressed ? 0.6 : 1,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 10,
                paddingVertical: 16,
                marginTop: 6,
                borderTopWidth: HAIRLINE,
                borderTopColor: cl.ruleFaint,
              })}
            >
              <Trash2 size={17} color="#B4562E" strokeWidth={2} />
              <CText t="body" color="#B4562E">
                {isEvent ? 'Delete event' : 'Delete reminder'}
              </CText>
            </Pressable>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

// ── rows ─────────────────────────────────────────────────────────────────────

function FieldRow({
  icon,
  label,
  value,
  placeholder,
  multiline,
  onChange,
}: {
  icon?: React.ReactNode;
  label: string;
  value: string;
  placeholder: string;
  multiline?: boolean;
  onChange: (t: string) => void;
}) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: multiline ? 'flex-start' : 'center',
        gap: 10,
        paddingVertical: 12,
        borderTopWidth: HAIRLINE,
        borderTopColor: cl.ruleFaint,
      }}
    >
      {icon ?? <View style={{ width: 17 }} />}
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={cl.ink38}
        accessibilityLabel={label}
        multiline={multiline}
        style={{ flex: 1, fontSize: 16, color: cl.ink, minHeight: multiline ? 44 : undefined }}
      />
    </View>
  );
}

function ToggleRow({
  icon,
  label,
  value,
  onChange,
}: {
  icon?: React.ReactNode;
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        paddingVertical: 10,
        borderTopWidth: HAIRLINE,
        borderTopColor: cl.ruleFaint,
      }}
    >
      {icon ?? <View style={{ width: 17 }} />}
      <CText t="body" color={cl.ink} style={{ flex: 1 }}>
        {label}
      </CText>
      <Switch value={value} onValueChange={onChange} accessibilityLabel={label} />
    </View>
  );
}

/** A row that reveals a native picker under itself when tapped. */
function PickerRow({
  label,
  value,
  open,
  onPress,
  children,
}: {
  label: string;
  value: string;
  open: boolean;
  onPress: () => void;
  children: React.ReactNode;
}) {
  return (
    <View style={{ borderTopWidth: HAIRLINE, borderTopColor: cl.ruleFaint }}>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={label}
        style={({ pressed }) => ({
          opacity: pressed ? 0.6 : 1,
          flexDirection: 'row',
          alignItems: 'center',
          paddingVertical: 14,
          gap: 10,
        })}
      >
        <View style={{ width: 17 }} />
        <CText t="body" color={cl.ink} style={{ flex: 1 }}>
          {label}
        </CText>
        <CText t="body" color={open ? cl.goldDeep : cl.ink48}>
          {value}
        </CText>
      </Pressable>
      {open ? <View style={{ paddingBottom: 6 }}>{children}</View> : null}
    </View>
  );
}

/** A row that reveals a list of choices under itself. */
function ChoiceRow({
  icon,
  label,
  open,
  onPress,
  children,
}: {
  icon?: React.ReactNode;
  label: string;
  open: boolean;
  onPress: () => void;
  children: React.ReactNode;
}) {
  return (
    <View style={{ borderTopWidth: HAIRLINE, borderTopColor: cl.ruleFaint }}>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={label}
        style={({ pressed }) => ({
          opacity: pressed ? 0.6 : 1,
          flexDirection: 'row',
          alignItems: 'center',
          paddingVertical: 14,
          gap: 10,
        })}
      >
        {icon ?? <View style={{ width: 17 }} />}
        <CText t="body" color={cl.ink} style={{ flex: 1 }}>
          {label}
        </CText>
      </Pressable>
      {open ? <View style={{ paddingBottom: 6 }}>{children}</View> : null}
    </View>
  );
}

function OptionRow({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => ({
        opacity: pressed ? 0.6 : 1,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        paddingVertical: 10,
        paddingLeft: 27,
      })}
    >
      <CText t="body" color={selected ? cl.goldDeep : cl.ink} style={{ flex: 1 }}>
        {label}
      </CText>
      {selected ? <Check size={16} color={cl.goldDeep} strokeWidth={2.4} /> : null}
    </Pressable>
  );
}

const DAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Sun..Sat, 0-indexed to match Date#getDay() and the server's repeat_days. */
function WeekdayPicker({
  days,
  onChange,
}: {
  days: number[];
  onChange: (days: number[]) => void;
}) {
  return (
    <View
      style={{
        flexDirection: 'row',
        gap: 8,
        paddingVertical: 12,
        paddingLeft: 27,
        borderTopWidth: HAIRLINE,
        borderTopColor: cl.ruleFaint,
      }}
    >
      {DAY_LETTERS.map((letter, i) => {
        const on = days.includes(i);
        return (
          <Pressable
            key={DAY_NAMES[i]}
            onPress={() =>
              onChange(on ? days.filter((d) => d !== i) : [...days, i].sort((a, b) => a - b))
            }
            accessibilityRole="checkbox"
            accessibilityState={{ checked: on }}
            accessibilityLabel={DAY_NAMES[i]}
            style={({ pressed }) => ({
              opacity: pressed ? 0.6 : 1,
              width: 34,
              height: 34,
              borderRadius: 17,
              alignItems: 'center',
              justifyContent: 'center',
              borderWidth: HAIRLINE,
              borderColor: on ? cl.goldDeep : cl.ruleFaint,
              backgroundColor: on ? cl.goldDeep : 'transparent',
            })}
          >
            <CText t="metaSm" color={on ? '#FFFFFF' : cl.ink48}>
              {letter}
            </CText>
          </Pressable>
        );
      })}
    </View>
  );
}

// ── formatting ───────────────────────────────────────────────────────────────

function formatWhen(iso: string, allDay: boolean): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Not set';
  return d.toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    ...(allDay ? {} : { hour: 'numeric', minute: '2-digit' }),
  });
}

/**
 * "Sat, Sep 12" from a YYYY-MM-DD, built from the parts.
 *
 * new Date("2026-09-12") is UTC midnight, which is the 11th in every American
 * timezone. The same one-line bug has now been fixed three times in this
 * codebase, so the date never goes through a parser here.
 */
function formatDay(day: string): string {
  const d = dayToDate(day);
  return d
    ? d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
    : day;
}

function dayToDate(day: string | null): Date | null {
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const [y, m, d] = day.split('-').map(Number);
  const local = new Date(y, m - 1, d);
  return Number.isNaN(local.getTime()) ? null : local;
}

function dateToDay(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function timeToDate(hhmm: string | null): Date {
  const now = new Date();
  if (!hhmm || !/^\d{2}:\d{2}/.test(hhmm)) return now;
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date(now);
  d.setHours(h, m, 0, 0);
  return d;
}

function dateToTime(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}
