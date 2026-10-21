/**
 * WHAT IS ON A DAY, FROM THREE PLACES AT ONCE.
 *
 *   THE DEVICE CALENDAR   your real meetings, from iCloud or Google, through
 *                         expo-calendar. This is where a location and a
 *                         conference link actually exist.
 *   AMBER'S OWN EVENTS    plans Amber heard you make. "Coffee with Mina at
 *                         ten" said out loud is an event row, and until now
 *                         nothing ever showed it back to you.
 *   SCHEDULED REMINDERS   a reminder with a time. One without a time is a note
 *                         to self and belongs in Notes & Journal instead.
 *
 * THE MERGE IS PURE, AND THAT IS THE POINT OF THIS FILE. Reading a calendar
 * needs a permission and a device; reading events needs a server. Neither can
 * be tested. Deciding what a day looks like -- what order, what counts as the
 * same meeting twice, what "virtual" is allowed to mean -- is arithmetic, and
 * all of it is here where a test can reach it.
 */

export type AgendaSource = 'device' | 'amber' | 'reminder';

/**
 * WHEN A LOCAL DAY STARTS AND WHEN IT STOPS, as two instants.
 *
 * Everything downstream is an instant -- the calendar query, the server window,
 * the filter in buildAgenda -- and a "day" is not one. It is a pair, it depends
 * on where the person is standing, and on two days a year it is not 24 hours
 * long.
 *
 * BUILT BY ASKING FOR THE NEXT CALENDAR DAY AT MIDNIGHT, not by adding
 * 86,400,000. On the spring-forward day the local day is 23 hours and adding a
 * fixed day lands an hour into the next one, so the last hour of Sunday would
 * appear on Monday as well; in the autumn it is 25 hours and the last hour of
 * the day would appear nowhere at all. `new Date(y, m, d + 1)` asks the calendar
 * rather than the clock, and the calendar is what the person means.
 *
 * Half-open: [start, end). The next day's start is this day's end, so midnight
 * belongs to exactly one of them.
 */
export function dayBounds(day: Date): { start: number; end: number } {
  const y = day.getFullYear();
  const m = day.getMonth();
  const d = day.getDate();
  return {
    start: new Date(y, m, d, 0, 0, 0, 0).getTime(),
    end: new Date(y, m, d + 1, 0, 0, 0, 0).getTime(),
  };
}

export type AgendaPerson = {
  contactId: string | null;
  amberId: string | null;
  name: string | null;
  avatarUrl: string | null;
};

export type AgendaItem = {
  people?: { contactId: string; name: string | null }[];
  /** Unique within a day. Prefixed by source so two stores cannot collide. */
  key: string;
  source: AgendaSource;
  provider?: 'google' | 'microsoft' | 'capture';
  title: string;
  /** Epoch ms. Always present: an item with no time is not on the day. */
  startsAt: number;
  /** Epoch ms, or null for a point in time like a reminder. */
  endsAt: number | null;
  allDay: boolean;
  /** Who it is with, when anybody is. */
  withPerson: AgendaPerson | null;
  /** A physical place, when there is one. */
  location: string | null;
  /** A joinable link, when the invite carries one. */
  meetingUrl: string | null;
  /**
   * WHETHER IT IS VIRTUAL, AND null MEANS NOBODY SAID.
   *
   * Three states, not two. A conference link means virtual; a physical place
   * with no link means in person; neither means Amber was not told, and
   * guessing "in person" there would put a confident wrong word on somebody's
   * screen. The UI shows nothing for null rather than picking.
   */
  virtual: boolean | null;
  /** A reminder that has been ticked off. */
  done: boolean;
  /**
   * A REMINDER THAT WAS DUE BEFORE TODAY AND IS STILL NOT DONE.
   *
   *   "Reminders that should persist across days are anything with an open tag
   *    that didn't get completed. If it's something like 'text mom about the
   *    trip' and that wasn't completed, then that should persist."
   *
   * It is on the day you are looking at, but its `startsAt` is the instant it
   * was originally due -- which is in the past, possibly by weeks. Two things
   * depend on knowing that:
   *
   *   - buildAgenda drops anything outside the day's window, which would throw
   *     every one of these away;
   *   - the row must not print a clock time, because "3 PM" on a reminder from
   *     last Tuesday is simply a wrong fact on the screen.
   *
   * Only ever true of `source: 'reminder'`. A meeting does not carry over -- it
   * happened, or it did not, and either way it is over. That is the distinction
   * he drew: "if it's a meeting where it's like 'meeting Joe at 10 am' and it's
   * a 30-minute meeting, then that doesn't need a check mark because that'll
   * just be done."
   */
  carriedOver: boolean;
  /**
   * WHAT SORT OF THING IT IS, for the icon on the card. See `agendaKind`.
   */
  kind: AgendaKind;
  /**
   * The color the phone's own calendar app draws this in, when it came from
   * there. Amber has no opinion about what color somebody's Work calendar is
   * and inventing one makes the day look like a different app's day -- so the
   * card's edge is the calendar's own color, and null falls back to gold.
   */
  accent: string | null;
  /**
   * WHAT THE EDITOR OPENS ON, and only ever set for Amber's own events.
   *
   * The editor could have defaulted these, and that is precisely the problem: a
   * weekly event would open reading "Does not repeat" and a described one would
   * open blank. Both are wrong facts on the screen, and both are one keystroke
   * away from being saved as true. A device event leaves them null because
   * nothing here can edit one anyway.
   */
  detail: AgendaEditableDetail | null;
};

/** The fields only an Amber-owned event carries, for the editor. */
export type AgendaEditableDetail = {
  description: string | null;
  place: string | null;
  repeat: 'none' | 'daily' | 'weekdays' | 'weekends' | 'weekly' | 'monthly';
  repeatUntil: string | null;
  notifyMinutesBefore: number | null;
};

/**
 * THE ICON ON A DAY CARD.
 *
 * "With icons, birthdays have the little birthday cake icon, and so on and so
 *  forth."
 *
 * A NAME, NOT A COMPONENT, so this stays in a .ts file a test can load -- the
 * card maps the name to a glyph. The set is small on purpose: every entry has
 * to be a thing somebody would recognize instantly, because a wrong icon is a
 * confident claim about somebody's own day.
 */
export type AgendaKind = 'birthday' | 'travel' | 'meal' | 'video' | 'reminder' | 'event';

/** Anything with an http(s) URL in it is a link somebody can join. */
const URL_RE = /https?:\/\/[^\s<>"']+/i;

/**
 * The hosts that mean "this meeting happens on a screen".
 *
 * A LIST, NOT A GUESS. Any URL at all in a calendar event is often just the
 * restaurant's website, and calling dinner "virtual" because the invite linked
 * a menu is worse than saying nothing. These are the ones that are only ever a
 * meeting.
 */
const CONFERENCE_HOSTS = [
  'meet.google.com',
  'zoom.us',
  'teams.microsoft.com',
  'teams.live.com',
  'webex.com',
  'whereby.com',
  'meet.jit.si',
  'around.co',
  'gather.town',
  'chime.aws',
  'bluejeans.com',
  'discord.gg',
  'facetime.apple.com',
];

/** The first joinable meeting link in any of these strings, or null. */
export function meetingUrlFrom(...fields: (string | null | undefined)[]): string | null {
  for (const field of fields) {
    if (typeof field !== 'string' || field.length === 0) continue;
    const m = URL_RE.exec(field);
    if (!m) continue;
    const url = m[0].replace(/[).,;]+$/, '');
    let host = '';
    try {
      host = new URL(url).hostname.toLowerCase();
    } catch {
      continue;
    }
    if (CONFERENCE_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) return url;
  }
  return null;
}

/**
 * WHICH ICON A THING ON THE DAY GETS.
 *
 * THE ONLY STRUCTURAL SIGNAL IS THE BIRTHDAY CALENDAR, and it is the one worth
 * having: iOS keeps birthdays in a calendar of its own (`CalendarType.BIRTHDAYS`),
 * populated from the address book, so "this is a birthday" is a fact the phone
 * already knows rather than something read out of a title. Everything reached
 * that way is right every time.
 *
 * THE REST ARE WORDS, AND THEY ARE DELIBERATELY FEW. Matching titles is
 * guessing, and a confident wrong icon on somebody's own day is worse than a
 * plain one -- so each list below is short, unambiguous, and falls through to
 * `event` rather than reaching. A meeting called "Coffee chat with the Stripe
 * team" gets a cup, which is fine; one called "Sync" gets the default, which is
 * also fine. What must not happen is "Deposition" getting a wine glass.
 *
 * A CONFERENCE LINK OUTRANKS THE WORDS, because it is a fact and they are a
 * guess: whatever "Coffee with Mina" is called, if it carries a Zoom link then
 * what you are about to do is open a laptop.
 */
const KIND_WORDS: { kind: AgendaKind; words: string[] }[] = [
  // Only ever a birthday, in any calendar.
  { kind: 'birthday', words: ['birthday', 'bday'] },
  // A flight or a train is the one thing on a day you cannot be late for, and
  // these words do not mean anything else on a calendar.
  { kind: 'travel', words: ['flight', 'airport', 'train', 'depart', 'landing', 'boarding'] },
  // Eating with somebody, which is most of what a relationship calendar holds.
  { kind: 'meal', words: ['coffee', 'lunch', 'dinner', 'breakfast', 'brunch', 'drinks', 'tea'] },
];

export function agendaKind(input: {
  title?: string | null;
  source?: AgendaSource;
  meetingUrl?: string | null;
  calendarType?: string | null;
}): AgendaKind {
  // The phone says so. Nothing below can overrule a fact.
  if (input?.calendarType === 'birthdays') return 'birthday';
  const t = titleKey(input?.title ?? '');
  // ...but a birthday named as one is still a birthday, whatever calendar it is
  // sitting in, and people do put them in their main calendar.
  if (t && KIND_WORDS[0]!.words.some((w) => t.includes(w))) return 'birthday';
  if (input?.meetingUrl) return 'video';
  if (input?.source === 'reminder') return 'reminder';
  for (const row of KIND_WORDS.slice(1)) {
    if (t && row.words.some((w) => t.includes(w))) return row.kind;
  }
  return 'event';
}

/**
 * Virtual, in person, or not known.
 *
 * A link wins over a place, because a hybrid invite carries both and the link
 * is the part that changes what you do. A place with no link is in person. Bare
 * is null -- see the note on the field.
 */
export function virtualnessOf(location: string | null, meetingUrl: string | null): boolean | null {
  if (meetingUrl) return true;
  if (location && location.trim().length > 0) {
    // A location that is ITSELF a conference link, which is what Google Calendar
    // does when somebody pastes the link into the location field.
    return meetingUrlFrom(location) ? true : false;
  }
  return null;
}

/**
 * TWO ENTRIES FOR ONE MEETING, WHICH IS THE COMMON CASE AND NOT AN EDGE ONE.
 *
 * You tell Amber "coffee with Mina at ten" AND the invite is in your calendar.
 * Both are true and both are correct; showing both means the day says you have
 * two coffees. So near-identical items collapse, and the DEVICE one survives:
 * it carries the real location, the real end time and the real conference link,
 * while Amber's carries the person it is with. The survivor takes the person
 * from the one it absorbs, so nothing is lost by collapsing.
 *
 * "Near-identical" is a start within this many minutes, plus a title that
 * matches once punctuation and case are stripped. Titles are typed by two
 * different systems and will never be equal byte for byte.
 */
const SAME_MEETING_MINUTES = 30;

function titleKey(t: string): string {
  return t
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Do these two describe the same meeting?
 *
 * Deliberately narrow. Collapsing two things that are NOT the same meeting
 * hides a commitment, which is far worse than showing one twice -- so a shared
 * title alone is not enough, and neither is a shared time.
 */
export function sameMeeting(a: AgendaItem, b: AgendaItem): boolean {
  if (a.source === b.source) return false;
  const ka = titleKey(a.title);
  const kb = titleKey(b.title);
  if (ka.length === 0 || kb.length === 0) return false;
  if (ka !== kb && !ka.includes(kb) && !kb.includes(ka)) return false;
  return Math.abs(a.startsAt - b.startsAt) <= SAME_MEETING_MINUTES * 60_000;
}

/** Which of two descriptions of one meeting to keep. */
function preferred(a: AgendaItem, b: AgendaItem): AgendaItem {
  const winner = a.source === 'device' ? a : b.source === 'device' ? b : a;
  const loser = winner === a ? b : a;
  return {
    ...winner,
    // Whatever the survivor lacks and the other one has.
    withPerson: winner.withPerson ?? loser.withPerson,
    people: winner.people?.length ? winner.people : loser.people,
    location: winner.location ?? loser.location,
    meetingUrl: winner.meetingUrl ?? loser.meetingUrl,
    endsAt: winner.endsAt ?? loser.endsAt,
    virtual:
      winner.virtual !== null
        ? winner.virtual
        : virtualnessOf(winner.location ?? loser.location, winner.meetingUrl ?? loser.meetingUrl),
    accent: winner.accent ?? loser.accent,
    /**
     * THE KIND IS RE-DERIVED FROM THE MERGED ROW, not taken from the survivor.
     * The device entry usually wins and usually has the blander title ("Mina
     * Cho"), while the one it absorbs is the one somebody said out loud
     * ("coffee with Mina") -- so keeping the winner's kind throws away the only
     * copy of the sentence that knew this was coffee.
     */
    kind: agendaKind({
      title: `${winner.title} ${loser.title}`,
      source: winner.source,
      meetingUrl: winner.meetingUrl ?? loser.meetingUrl,
      calendarType: winner.kind === 'birthday' || loser.kind === 'birthday' ? 'birthdays' : null,
    }),
  };
}

/**
 * One day, in the order it happens.
 *
 * ALL-DAY ITEMS FIRST, then by start time, then by title so the order is total
 * and two things at nine o'clock do not swap places between renders. A done
 * reminder sinks below everything else at the same instant: it is still on the
 * day, and it is not what you are looking for.
 */
export function sortAgenda(items: AgendaItem[]): AgendaItem[] {
  return [...items].sort((a, b) => {
    /**
     * CARRIED-OVER FIRST, ABOVE EVEN THE ALL-DAY ROW.
     *
     * "There should be a reminder at the top of the calendar every single day."
     *
     * Sorting these by their own startsAt would work by accident -- a reminder
     * from last Tuesday is earlier than everything today, so it would land at
     * the top anyway -- and would break the moment two of them arrived from
     * different days and interleaved with today's early meetings. It is a rank,
     * so it is written as one.
     */
    if (a.carriedOver !== b.carriedOver) return a.carriedOver ? -1 : 1;
    if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
    if (a.done !== b.done) return a.done ? 1 : -1;
    return a.startsAt - b.startsAt || a.title.localeCompare(b.title) || a.key.localeCompare(b.key);
  });
}

/**
 * The day, from all three sources.
 *
 * Items outside [dayStart, dayEnd) are dropped rather than trusted: a calendar
 * query is asked for a range and returns what it likes at the edges, and an
 * event from tomorrow on today's list is the kind of wrong that makes somebody
 * stop reading the screen.
 */
export function buildAgenda({
  device = [],
  amber = [],
  reminders = [],
  dayStart,
  dayEnd,
}: {
  device?: AgendaItem[];
  amber?: AgendaItem[];
  reminders?: AgendaItem[];
  dayStart: number;
  dayEnd: number;
}): AgendaItem[] {
  const all = [...device, ...amber, ...reminders].filter(
    (i) =>
      i &&
      Number.isFinite(i.startsAt) &&
      // A CARRIED-OVER REMINDER IS DELIBERATELY OUTSIDE THE WINDOW, and it is
      // the one thing this filter must not throw away. Its startsAt is when it
      // was originally due -- last Tuesday, or three weeks ago -- and the whole
      // point is that it is still on your plate today. Everything else is held
      // to the window as before, because an event from tomorrow on today's list
      // is the kind of wrong that makes somebody stop reading the screen.
      (i.carriedOver ||
        // An all-day item is stamped at midnight and belongs to the day it opens.
        (i.startsAt >= dayStart && i.startsAt < dayEnd)),
  );

  const kept: AgendaItem[] = [];
  for (const item of all) {
    const dupeAt = kept.findIndex((k) => sameMeeting(k, item));
    if (dupeAt >= 0) kept[dupeAt] = preferred(kept[dupeAt]!, item);
    else kept.push(item);
  }
  return sortAgenda(kept);
}

// ── turning each source into an AgendaItem ──────────────────────────────────

/** An expo-calendar event. Only the fields this needs, so a test can build one. */
export type DeviceEvent = {
  id: string;
  title?: string | null;
  startDate?: string | Date | null;
  endDate?: string | Date | null;
  allDay?: boolean | null;
  location?: string | null;
  notes?: string | null;
  url?: string | null;
  /** The calendar it came from: its own color, and what sort it is. */
  calendarColor?: string | null;
  calendarType?: string | null;
};

const ms = (v: string | Date | null | undefined): number => {
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'string') return new Date(v).getTime();
  return Number.NaN;
};

export function fromDeviceEvent(e: DeviceEvent): AgendaItem | null {
  const startsAt = ms(e?.startDate);
  if (!Number.isFinite(startsAt)) return null;
  const endsAtRaw = ms(e?.endDate);
  const location = (e?.location ?? '').trim() || null;
  const meetingUrl = meetingUrlFrom(e?.url, e?.location, e?.notes);
  return {
    key: `device:${e.id}`,
    source: 'device',
    // A calendar entry with no title is real and common. "Busy" is what every
    // other calendar calls it, rather than an empty row.
    title: (e?.title ?? '').trim() || 'Busy',
    startsAt,
    endsAt: Number.isFinite(endsAtRaw) ? endsAtRaw : null,
    allDay: Boolean(e?.allDay),
    withPerson: null,
    location,
    meetingUrl,
    virtual: virtualnessOf(location, meetingUrl),
    done: false,
    // A meeting does not carry over. It happened, or it did not.
    carriedOver: false,
    kind: agendaKind({
      title: e?.title,
      source: 'device',
      meetingUrl,
      calendarType: e?.calendarType ?? null,
    }),
    // Nothing here can edit a row that belongs to iCloud or a work Exchange:
    // deviceCalendar.ts asks for read permission only. See isEditable.
    detail: null,
    accent: (e?.calendarColor ?? '').trim() || null,
  };
}

/** An event row from GET /v1/me/agenda. */
export type AmberEvent = {
  people?: { contactId: string; name: string | null }[];
  provider?: 'google' | 'microsoft' | 'capture';
  id: string;
  title?: string | null;
  startsAt?: string | null;
  endsAt?: string | null;
  withPerson?: {
    contactId?: string | null;
    amberId?: string | null;
    name?: string | null;
    avatarUrl?: string | null;
  } | null;
  place?: { name?: string | null; city?: string | null } | null;
  // The editor's fields. See AgendaItem.detail.
  description?: string | null;
  allDay?: boolean | null;
  repeat?: string | null;
  repeatUntil?: string | null;
  notifyMinutesBefore?: number | null;
  /** The place as free text, which is NOT the resolved `place` row above. */
  placeText?: string | null;
};

const REPEATS = ['none', 'daily', 'weekdays', 'weekends', 'weekly', 'monthly'] as const;
type RepeatValue = (typeof REPEATS)[number];
const asRepeat = (v: unknown): RepeatValue =>
  typeof v === 'string' && (REPEATS as readonly string[]).includes(v) ? (v as RepeatValue) : 'none';

export function fromAmberEvent(e: AmberEvent): AgendaItem | null {
  const startsAt = ms(e?.startsAt);
  if (!Number.isFinite(startsAt)) return null;
  const endsAtRaw = ms(e?.endsAt);
  const location = e?.place?.name
    ? [e.place.name, e.place.city].filter(Boolean).join(', ')
    : e?.placeText?.trim() || null;
  const meetingUrl = meetingUrlFrom(e?.placeText, e?.description);
  const person = e?.withPerson ?? null;
  return {
    key: `amber:${e.id}`,
    source: 'amber',
    people: e.people,
    provider: e.provider,
    title: (e?.title ?? '').trim() || (person?.name ? `With ${person.name}` : 'Something planned'),
    startsAt,
    endsAt: Number.isFinite(endsAtRaw) ? endsAtRaw : null,
    allDay: e?.allDay === true,
    withPerson: person
      ? {
          contactId: person.contactId ?? null,
          amberId: person.amberId ?? null,
          name: person.name ?? null,
          avatarUrl: person.avatarUrl ?? null,
        }
      : null,
    location,
    // Only recognize an actual supported conference URL supplied in the event.
    meetingUrl,
    virtual: virtualnessOf(location, meetingUrl),
    done: false,
    // A meeting does not carry over. It happened, or it did not.
    carriedOver: false,
    kind: agendaKind({ title: e?.title, source: 'amber', meetingUrl: null, calendarType: null }),
    // Amber's own events have no calendar behind them, so they take the page's
    // gold rather than borrowing a color that means something else.
    accent: null,
    detail:
      e.provider === 'google' || e.provider === 'microsoft'
        ? null
        : {
            description: e?.description ?? null,
            // The TEXT place, which is what the editor writes. The joined place row
            // above is a resolved location and a different column; saving one into
            // the other would move the event somewhere nobody chose.
            place: e?.placeText ?? null,
            repeat: asRepeat(e?.repeat),
            repeatUntil: e?.repeatUntil ?? null,
            notifyMinutesBefore:
              typeof e?.notifyMinutesBefore === 'number' ? e.notifyMinutesBefore : null,
          },
  };
}

/** A scheduled reminder from GET /v1/me/agenda. */
export type AmberReminder = {
  id: string;
  title?: string | null;
  startsAt?: string | null;
  done?: boolean | null;
  /**
   * Set by the server on a reminder that was due before the window it is being
   * returned for and has not been ticked off. See listScheduledReminders in
   * amber_id: it only carries them into the window that contains NOW, so
   * scrolling back to last Tuesday shows last Tuesday and not a pile of
   * everything still open.
   */
  carriedOver?: boolean | null;
};

export function fromReminder(r: AmberReminder): AgendaItem | null {
  const startsAt = ms(r?.startsAt);
  if (!Number.isFinite(startsAt)) return null;
  return {
    key: `reminder:${r.id}`,
    source: 'reminder',
    title: (r?.title ?? '').trim() || 'Reminder',
    startsAt,
    endsAt: null,
    allDay: false,
    withPerson: null,
    location: null,
    meetingUrl: null,
    virtual: null,
    done: Boolean(r?.done),
    carriedOver: Boolean(r?.carriedOver),
    kind: 'reminder',
    accent: null,
    /**
     * A TIMED reminder, which is not what the reminder editor edits.
     *
     * The editor's reminder fields are for the untimed ones at the top of Notes
     * & Journal: a day it starts on, a time of day to be nudged at, no instant
     * to count backwards from. This row already has a due_at. Rather than open
     * an editor whose fields do not describe it, it stays read-only until that
     * editor exists.
     */
    detail: null,
  };
}

// ── the words on the card ───────────────────────────────────────────────────

/**
 * WHERE A CARRIED-OVER REMINDER CAME FROM.
 *
 * A clock time is a wrong fact on one of these: "3 PM" on a reminder that was
 * due last Tuesday reads as an appointment this afternoon. What the reader needs
 * is how long it has been waiting, and a weekday is the form people hold that in
 * for the last few days -- "since Tuesday" locates it, "since September 2" makes
 * you count.
 *
 * Past a week the weekday stops being a location and starts being ambiguous (a
 * Tuesday nine days ago is not "Tuesday"), so it becomes a date. Past a year the
 * date needs the year, because "since September 2" on a reminder from 2025 is
 * the same wrong-fact problem one level up.
 *
 * `now` is a parameter rather than read from the clock so this is testable,
 * which for a function whose entire behavior is about elapsed time is the only
 * way it can be.
 */
export function carriedFromLabel(startsAt: number, now: number): string {
  const then = new Date(startsAt);
  if (!Number.isFinite(then.getTime())) return 'Still open';
  // Whole days apart, measured between LOCAL midnights -- not (now - then) /
  // 86400000, which calls 11pm last night and 1am this morning the same day.
  const a = new Date(then.getFullYear(), then.getMonth(), then.getDate()).getTime();
  const b = new Date(
    new Date(now).getFullYear(),
    new Date(now).getMonth(),
    new Date(now).getDate(),
  ).getTime();
  const days = Math.round((b - a) / 86_400_000);
  if (days <= 0) return 'Still open';
  if (days === 1) return 'Since yesterday';
  if (days < 7) return `Since ${then.toLocaleDateString(undefined, { weekday: 'long' })}`;
  const sameYear = then.getFullYear() === new Date(now).getFullYear();
  return `Since ${then.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  })}`;
}

/** "10 AM" / "10:30 AM", in the reader's own locale. */
export function clockTime(at: number): string {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return '';
  return d
    .toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    .replace(':00', '')
    .toUpperCase();
}

/**
 * The time line under a title: "10 AM – 10:30 AM", "4 PM", "All day".
 *
 * An end equal to or before the start is treated as no end at all. Calendars do
 * produce those -- a zero-length event, or a badly imported one -- and
 * "10 AM – 10 AM" is not a range anybody wants to read.
 */
export function timeRange(item: Pick<AgendaItem, 'startsAt' | 'endsAt' | 'allDay'>): string {
  if (item.allDay) return 'All day';
  const start = clockTime(item.startsAt);
  if (item.endsAt == null || item.endsAt <= item.startsAt) return start;
  return `${start} – ${clockTime(item.endsAt)}`;
}

/** "Virtual" / "In person" / nothing, because nothing is a real answer. */
export function placeLine(item: Pick<AgendaItem, 'virtual' | 'location'>): string {
  const where = item.location?.trim();
  if (item.virtual === true)
    return where && !/^https?:/i.test(where) ? `Virtual · ${where}` : 'Virtual';
  if (item.virtual === false) return where ? `In person · ${where}` : 'In person';
  return where ?? '';
}

/**
 * "meet.google.com" out of a full join URL.
 *
 * The detail page prints this under the word Virtual, because the host is the
 * part somebody recognizes -- "oh, it's a Zoom" -- and the rest of a conference
 * URL is forty characters of meeting id that wraps onto three lines and says
 * nothing.
 */
export function meetingHost(url: string | null | undefined): string {
  if (typeof url !== 'string') return '';
  const m = /^https?:\/\/([^/?#]+)/i.exec(url.trim());
  if (!m?.[1]) return url.trim();
  // Ports and credentials are not part of what somebody recognizes, and `www.`
  // is noise on every host that has it.
  return m[1]
    .toLowerCase()
    .replace(/^[^@]*@/, '')
    .replace(/:\d+$/, '')
    .replace(/^www\./, '');
}
