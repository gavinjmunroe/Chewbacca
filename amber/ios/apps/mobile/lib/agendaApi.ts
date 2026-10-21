/**
 * FETCHING A DAY. The transport half of lib/agenda.ts.
 *
 * Split for the reason every transport file in lib/ is split: the arithmetic is
 * in agenda.ts where a test can run it, and the part that needs a server and a
 * permission is here where it cannot be tested at all. Nothing in this file
 * makes a decision -- it asks two sources for the same window and hands both to
 * `buildAgenda`.
 *
 * ONE QUERY KEY PER DAY, keyed by the local day rather than by the instants, so
 * that scrolling back to yesterday and forward to today does not refetch what
 * is already cached, and so a note captured today invalidates today.
 */
import { useEffect, useRef } from 'react';
import { InteractionManager } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { callMedhaId } from './medhaId';
import { dayKey } from './calendarStrip';
import { readDeviceEvents } from './deviceCalendar';
import {
  buildAgenda,
  dayBounds,
  fromAmberEvent,
  fromDeviceEvent,
  fromReminder,
  type AgendaItem,
  type AmberEvent,
  type AmberReminder,
} from './agenda';

/** The raw halves, before the merge. */
export type AgendaResponse = { events: AmberEvent[]; reminders: AmberReminder[] };

/** GET /v1/me/agenda. Two instants, because a day is a timezone question. */
export async function fetchAgenda(from: Date, to: Date): Promise<AgendaResponse> {
  // ONE TEMPLATE, WITH THE ENCODING WRITTEN INTO IT. lib/apiContract.test.mts
  // reads these paths out of the source to check that every route is absolute
  // and every interpolated value is escaped -- so a path assembled with `+`, or
  // one that interpolates an already-built `q`, is a path it cannot verify. It
  // refuses both, which is the point: an unreadable path is one nobody checks
  // again.
  const res = await callMedhaId<AgendaResponse>({
    path: `/v1/me/agenda?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`,
    method: 'GET',
    requireAuth: true,
  });
  return {
    events: res.ok && Array.isArray(res.data?.events) ? res.data.events : [],
    reminders: res.ok && Array.isArray(res.data?.reminders) ? res.data.reminders : [],
  };
}

/**
 * Everything on one local day, from all three sources, in the order it happens.
 *
 * THE TWO READS RUN TOGETHER AND EACH DEGRADES ALONE. The calendar is a native
 * call that can hang on a syncing account and the server is a network call that
 * can fail; serializing them makes the day as slow as the slower one, and
 * letting either one reject makes a missing calendar into a missing day.
 */
export async function loadDay(day: Date): Promise<AgendaItem[]> {
  const { start, end } = dayBounds(day);
  const from = new Date(start);
  const to = new Date(end);
  const [device, mine] = await Promise.all([
    readDeviceEvents(from, to).catch(() => []),
    fetchAgenda(from, to).catch((): AgendaResponse => ({ events: [], reminders: [] })),
  ]);
  return buildAgenda({
    device: device.map(fromDeviceEvent).filter((i): i is AgendaItem => i !== null),
    amber: mine.events.map(fromAmberEvent).filter((i): i is AgendaItem => i !== null),
    reminders: mine.reminders.map(fromReminder).filter((i): i is AgendaItem => i !== null),
    dayStart: start,
    dayEnd: end,
  });
}

/** The query key for one day, so a caller can invalidate the day it changed. */
export function agendaKey(day: Date): readonly [string, string] {
  return ['agenda', dayKey(day)] as const;
}

/**
 * The day, as a query.
 *
 * `noteVersion` is threaded in so that saying "coffee with Mina at ten" out
 * loud puts the event on the day without a pull-to-refresh -- capture writes
 * the event row server-side, and the day is stale the moment it does. It is a
 * REFETCH TRIGGER, NOT PART OF THE KEY: putting it in the key makes every
 * capture a cache miss, and the whole agenda blanks and repopulates every time
 * somebody finishes speaking. That mistake is already documented on the
 * reminders query in HomePage.
 */
export function useDayAgenda(day: Date, noteVersion = 0) {
  const query = useQuery({
    queryKey: agendaKey(day),
    queryFn: () => loadDay(day),
    staleTime: 60_000,
  });

  // Skips the first run -- useQuery has already fetched on mount, and a second
  // request in the same breath is the stutter this pattern exists to avoid.
  const seen = useRef(noteVersion);
  const refetch = query.refetch;
  useEffect(() => {
    if (seen.current === noteVersion) return;
    seen.current = noteVersion;
    // After the interactions: this fires as a capture is finishing, while the
    // recorder is dismissing and the optimistic note card is animating in.
    const handle = InteractionManager.runAfterInteractions(() => {
      void refetch();
    });
    return () => handle.cancel();
  }, [noteVersion, refetch]);

  return query;
}
