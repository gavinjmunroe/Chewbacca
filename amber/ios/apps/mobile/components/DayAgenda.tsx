import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { CakeSlice, CalendarDays, Check, Coffee, Plane, Plus, Video } from 'lucide-react-native';
import { Pressable } from './Pressable';
import { Avatar } from './Avatar';
import { CText } from './classical';
import { HAIRLINE, cl } from '../lib/classical';
import { hFont, hc } from '../lib/homeSurface';
import {
  carriedFromLabel,
  clockTime,
  placeLine,
  timeRange,
  type AgendaItem,
  type AgendaKind,
} from '../lib/agenda';
import { agendaKey, useDayAgenda } from '../lib/agendaApi';
import { setReminderDone } from '../lib/reminders';
import { toast } from '../lib/toast';
import { calendarAccess, type CalendarAccess } from '../lib/deviceCalendar';

/**
 * WHAT IS ON THE DAY, AT THE TOP OF YOU.
 *
 * "A calendar section with the daily scheduled items. And if you press on a
 *  previous day it shows you what you had that day."
 * "It should be a nice card format rather than this kind of list format."
 *
 * THE SHAPE IS THE MOCKUP'S: the time in a gutter down the left, outside the
 * card, and the thing itself as a warm card with a thick rounded bar on its
 * leading edge. The first attempt was a table -- a time column, a title, a
 * hairline between rows -- which is a list of rows rather than a day.
 *
 * The day being shown comes from the strip in the header, which already told
 * the notes below which day they belong to. This is the same date read by a
 * second thing, so tapping July 6 gives you July 6's meetings above July 6's
 * notes and there is no second date-picker to keep in step.
 */
export function DayAgenda({
  day,
  noteVersion,
  onOpenItem,
  onAddEvent,
  onConnectCalendars,
}: {
  day: Date;
  /** Bumps when a note is captured, so "coffee with Mina at ten" appears. */
  noteVersion?: number;
  onOpenItem: (item: AgendaItem) => void;
  /**
   * Open the editor on a blank event for this day.
   *
   *   "there should be an add event manually for calendar button that opens up
   *    that UI for making a calendar event"
   *
   * Optional so the section still renders anywhere that has no editor mounted,
   * and the row is simply absent there rather than tapping into nothing.
   */
  onAddEvent?: () => void;
  /**
   * Open the calendar-connecting sheet. Offered here only while NOTHING is
   * connected; once one calendar is in, the offer moves to Settings and this
   * section goes back to being a day.
   */
  onConnectCalendars?: () => void;
}) {
  const qc = useQueryClient();
  const { data, isLoading, isFetched } = useDayAgenda(day, noteVersion);
  const items = data ?? [];

  /**
   * TICKING A REMINDER OFF.
   *
   *   "Have a little checkbox for each reminder, and if that's checked, then
   *    that goes away."
   *
   * OWNED HERE, not handed down from HomePage, because everything it needs is
   * here: the day whose query key it has to touch, and the cache. Plumbing it
   * through a prop would put the day in two places.
   *
   * OPTIMISTIC AND THEN INVALIDATED, which is two steps for a reason. The strike
   * has to land under the thumb -- a checkbox that waits on Railway before it
   * looks checked is a checkbox you tap twice. The invalidate is what makes it
   * actually go away: the server stops carrying a done reminder forward, so the
   * refetch is where a carried-over row leaves the day for good.
   *
   * A FAILED WRITE PUTS THE TICK BACK. A reminder that looks done and is not is
   * worse than one that would not tick.
   */
  const toggleDone = useCallback(
    async (item: AgendaItem) => {
      if (item.source !== 'reminder') return;
      const reminderId = item.key.replace(/^reminder:/, '');
      const next = !item.done;
      const key = agendaKey(day);
      const paint = (done: boolean) =>
        qc.setQueryData<AgendaItem[]>(key, (prev) =>
          (prev ?? []).map((i) => (i.key === item.key ? { ...i, done } : i)),
        );
      paint(next);
      const ok = await setReminderDone(reminderId, next);
      if (!ok) {
        paint(item.done);
        toast.error('Could not save that.');
        return;
      }
      void qc.invalidateQueries({ queryKey: ['agenda'] });
    },
    [day, qc],
  );

  /**
   * THE PERMISSION IS OFFERED, NOT TAKEN.
   *
   * iOS shows the calendar sheet exactly once. A prompt that appears because
   * somebody opened a tab is a prompt they dismiss without reading, and the
   * feature is then gone for good on that phone. So this READS the state, which
   * never prompts, and the asking happens inside the sheet the offer opens.
   */
  const [access, setAccess] = useState<CalendarAccess | null>(null);
  const refreshAccess = useCallback(() => {
    void calendarAccess().then(setAccess);
  }, []);
  useEffect(() => {
    let alive = true;
    void calendarAccess().then((a) => {
      if (alive) setAccess(a);
    });
    return () => {
      alive = false;
    };
  }, []);
  // Re-read whenever the day settles: connecting a calendar in the sheet
  // invalidates the agenda, and this is how the offer disappears afterwards
  // without the section needing to be told about it.
  useEffect(() => {
    if (isFetched) refreshAccess();
  }, [isFetched, refreshAccess, data]);

  return (
    <View style={{ gap: 0 }}>
      {isLoading && !isFetched ? (
        <CText t="metaSm" color={cl.ink38} style={{ paddingVertical: 16, paddingLeft: 2 }}>
          Loading your day…
        </CText>
      ) : items.length === 0 ? (
        <EmptyDay
          nothingConnected={access !== 'granted'}
          onConnect={
            onConnectCalendars
              ? () => {
                  onConnectCalendars();
                  void qc.invalidateQueries({ queryKey: ['agenda'] });
                }
              : undefined
          }
        />
      ) : (
        items.map((item, i) => (
          <AgendaRow
            key={item.key}
            item={item}
            onPress={() => onOpenItem(item)}
            onToggleDone={toggleDone}
            last={i === items.length - 1}
          />
        ))
      )}

      {/* THE WAY ONTO THE CALENDAR THAT DOES NOT GO THROUGH A PARSER.
          Until now the only way an event existed was that somebody said a time
          out loud and the capture pipeline understood it. That is the good path
          and it stays the default, but being the ONLY path made one parser a
          single point of failure for the whole calendar -- when two migrations
          turned out to be unapplied, every write threw and there was no other
          door. Shown on a full day and an empty one alike, because the day you
          most want to add to is the empty one. */}
      {onAddEvent ? (
        <Pressable
          onPress={onAddEvent}
          accessibilityRole="button"
          accessibilityLabel="Add an event"
          style={({ pressed }) => ({
            opacity: pressed ? 0.6 : 1,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 9,
            paddingVertical: 13,
            borderTopWidth: items.length > 0 ? HAIRLINE : 0,
            borderTopColor: cl.ruleFaint,
          })}
        >
          <Plus size={16} color={cl.goldKicker} strokeWidth={2.2} />
          <CText t="body" color={cl.ink48}>
            Add an event
          </CText>
        </Pressable>
      ) : null}
    </View>
  );
}

/**
 * A DAY WITH NOTHING ON IT, WHICH IS MOST DAYS.
 *
 * TWO DIFFERENT SILENCES, and they must not read the same. A day that is empty
 * because nothing is scheduled is a quiet day. A day that is empty because no
 * calendar has ever been connected is a day the app cannot see, and printing
 * "nothing on this day" there is a claim Amber has no right to make -- it is
 * exactly the wrongness of an app telling somebody their Tuesday is free when
 * their Tuesday is full.
 */
function EmptyDay({
  nothingConnected,
  onConnect,
}: {
  nothingConnected: boolean;
  onConnect?: () => void;
}) {
  if (nothingConnected && onConnect) {
    return (
      <Pressable
        onPress={onConnect}
        accessibilityRole="button"
        accessibilityLabel="Sync your calendars"
        style={({ pressed }) => ({
          opacity: pressed ? 0.7 : 1,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          paddingVertical: 17,
          paddingHorizontal: 16,
          borderRadius: 18,
          borderWidth: 1,
          borderStyle: 'dashed',
          borderColor: cl.gold40,
        })}
      >
        <CalendarDays size={19} color={cl.goldDeep} strokeWidth={2} />
        <View style={{ flex: 1 }}>
          <CText t="listTitle" color={cl.ink}>
            Sync your calendars
          </CText>
          <CText t="metaSm" color={cl.ink48} style={{ marginTop: 2 }}>
            Google, Outlook, iCloud — as many as you like.
          </CText>
        </View>
      </Pressable>
    );
  }
  return (
    <View style={{ alignItems: 'center', paddingVertical: 28, gap: 8 }}>
      <CalendarDays size={20} color={cl.ink32} strokeWidth={1.7} />
      <CText t="metaSm" color={cl.ink38}>
        Nothing on this day.
      </CText>
    </View>
  );
}

/** The glyph for each kind. The name is decided in lib/agenda; this draws it. */
function KindIcon({ kind, color }: { kind: AgendaKind; color: string }) {
  const size = 14;
  const w = 2.1;
  if (kind === 'birthday') return <CakeSlice size={size} color={color} strokeWidth={w} />;
  if (kind === 'travel') return <Plane size={size} color={color} strokeWidth={w} />;
  if (kind === 'meal') return <Coffee size={size} color={color} strokeWidth={w} />;
  if (kind === 'video') return <Video size={size} color={color} strokeWidth={w} />;
  if (kind === 'reminder') return <Check size={size} color={color} strokeWidth={w} />;
  return <CalendarDays size={size} color={color} strokeWidth={w} />;
}

/**
 * One thing on the day: the time in the gutter, the card beside it.
 *
 * THE CARD'S EDGE IS THE CALENDAR'S OWN COLOR when it came from the phone, so
 * a day looks the way the person's own calendar app has taught them it looks.
 * Amber has no business deciding that Work is orange. Anything Amber itself
 * knows has no calendar behind it and takes the page's gold.
 */
function AgendaRow({
  item,
  onPress,
  onToggleDone,
  last,
}: {
  item: AgendaItem;
  onPress: () => void;
  onToggleDone?: (item: AgendaItem) => void;
  last: boolean;
}) {
  const accent = item.accent ?? hc.tan;
  const where = placeLine(item);
  const who = item.withPerson?.name?.trim() || null;
  /**
   * WHICH ROWS GET A CHECKBOX, AND WHY IT IS NOT ALL OF THEM.
   *
   *   "If it's a meeting where it's like 'meeting Joe at 10 am' and it's a
   *    30-minute meeting, then that doesn't need a check mark because that'll
   *    just be done."
   *
   * A meeting is a fact about the day: it happened at ten, and at half past ten
   * it is over whether or not anybody ticked anything. A reminder is a thing you
   * still owe, and it is only over when you say so. So the box is the difference
   * between the two kinds of row, not a control bolted onto every row -- and a
   * checkbox on a calendar event would be asking a question with no answer.
   */
  const checkable = item.source === 'reminder' && !!onToggleDone;
  /**
   * A CARRIED-OVER REMINDER MUST NOT PRINT A CLOCK TIME. Its startsAt is when it
   * was originally due, which is in the past -- so "3 PM" on it reads as an
   * appointment this afternoon, which is simply a wrong fact on the screen.
   */
  const carriedLabel = item.carriedOver ? carriedFromLabel(item.startsAt, Date.now()) : null;
  // THE TIME RANGE LEADS THE SUBTITLE and everything else is optional. The
  // rendering's row is a title over "10 AM – 10:30 AM" and nothing more; a
  // place and a person still join it when there is one, because a meeting whose
  // location you cannot see is a meeting you have to open.
  const sub = [carriedLabel ?? timeRange(item), who, where].filter(Boolean).join(' · ');

  return (
    <View>
      <View style={{ flexDirection: 'row', alignItems: 'stretch', gap: 10 }}>
        {/* The gutter. Aligned to the card's first line rather than centered, so
            a column of times reads as a column whatever height the cards are. */}
        <View style={{ width: 58, paddingTop: 15 }}>
          <Text allowFontScaling={false} style={agenda.gutter}>
            {carriedLabel ? 'OPEN' : item.allDay ? 'ALL DAY' : clockTime(item.startsAt)}
          </Text>
        </View>

        <Pressable
          onPress={onPress}
          accessibilityRole="button"
          accessibilityLabel={`${item.title}, ${carriedLabel ?? timeRange(item)}`}
          style={({ pressed }) => ({
            flex: 1,
            opacity: pressed ? 0.75 : 1,
            marginBottom: 14,
            borderRadius: 10,
            overflow: 'hidden',
            flexDirection: 'row',
            // A WASH of the accent rather than the accent itself: the card is a
            // surface text sits on, and a saturated fill would turn a day into a
            // column of color swatches.
            backgroundColor: withAlpha(accent, 0.16),
          })}
        >
          {/* The bar on the leading edge, full height, so a two-line card reads
              as one object rather than as text beside a dash. */}
          <View style={{ width: 4, backgroundColor: accent }} />
          <View style={{ flex: 1, paddingHorizontal: 16, paddingVertical: 14, gap: 4 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
              {/*
                ONLY A BIRTHDAY GETS A GLYPH.
                Every kind used to carry one -- a coffee cup, a plane, a camera --
                and the rendering has none: the title says "Coffee with Mina", so
                a cup beside it is the same fact drawn twice, twelve points to the
                left. A birthday is the exception because the title is usually
                just a name, and "Mina Chen" with a cake beside it says something
                the words do not.
              */}
              {item.kind === 'birthday' ? (
                <KindIcon kind="birthday" color={item.done ? hc.inkFaint : hc.ink} />
              ) : null}
              <Text
                numberOfLines={1}
                style={[
                  agenda.title,
                  {
                    flex: 1,
                    color: item.done ? hc.inkFaint : hc.ink,
                    textDecorationLine: item.done ? 'line-through' : 'none',
                  },
                ]}
              >
                {item.title}
              </Text>
              {item.withPerson?.name ? (
                <Avatar
                  name={item.withPerson.name}
                  url={item.withPerson.avatarUrl ?? undefined}
                  size={24}
                />
              ) : null}
              {/*
                THE BOX IS ITS OWN PRESSABLE INSIDE THE CARD'S PRESSABLE, which
                needs the hitSlop to be honest about: at 20pt it is under the 44pt
                Apple asks for, and an under-sized target nested in a larger one
                that does something ELSE is the worst version of a small target --
                miss it and you open the reminder instead of ticking it. The slop
                takes it past 44 in every direction; it is asymmetric on the right
                because there is card padding there and nothing to steal from on
                the left, where the title is.
              */}
              {checkable ? (
                <Pressable
                  onPress={() => onToggleDone?.(item)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: item.done }}
                  accessibilityLabel={item.done ? `Mark ${item.title} as not done` : `Mark ${item.title} as done`}
                  hitSlop={{ top: 14, bottom: 14, left: 12, right: 16 }}
                  style={({ pressed }) => ({ opacity: pressed ? 0.55 : 1 })}
                >
                  <View
                    style={[
                      agenda.box,
                      item.done
                        ? { backgroundColor: hc.ink, borderColor: hc.ink }
                        : { borderColor: withAlpha(accent, 0.75) },
                    ]}
                  >
                    {item.done ? <Check size={13} color={hc.bg} strokeWidth={3} /> : null}
                  </View>
                </Pressable>
              ) : null}
            </View>
            {sub ? (
              <Text numberOfLines={1} style={agenda.sub}>
                {sub}
              </Text>
            ) : null}
          </View>
        </Pressable>
      </View>

      {/* THE HAIRLINE RUNS THE WHOLE WIDTH, gutter included, which is what makes
          the times read as a column rather than as loose labels. Not after the
          last one: a rule under the final row is a line under nothing. */}
      {last ? null : <View style={agenda.rule} />}
    </View>
  );
}

const agenda = StyleSheet.create({
  box: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 1.75,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gutter: {
    fontFamily: hFont.medium,
    fontSize: 12.5,
    letterSpacing: 0.3,
    color: hc.inkMuted,
  },
  title: {
    fontFamily: hFont.semibold,
    fontSize: 16.5,
    lineHeight: 21,
    letterSpacing: -0.1,
  },
  sub: {
    fontFamily: hFont.regular,
    fontSize: 13.5,
    lineHeight: 18,
    color: hc.inkMuted,
  },
  rule: { height: 1, backgroundColor: hc.rule, marginBottom: 14 },
});

/**
 * A hex color at an opacity, as an rgba string.
 *
 * The accent comes from somebody's own calendar and can be any color at all,
 * so the wash has to be derived rather than picked from a palette. Anything
 * this cannot parse is returned untouched: a color string we do not recognize
 * is still a valid color to the platform, and an unpainted card is better than
 * one painted `NaN`.
 */
function withAlpha(hex: string, alpha: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}
