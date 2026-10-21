import { useEffect, useRef, useState } from 'react';
import { callMedhaId } from './medhaId';
import { readDeviceEvents } from './deviceCalendar';
import { listConversations, type ConversationSummary } from './conversations';
import { getNetworkFeed, type FeedItem } from './noteShares';
import {
  buildAgenda,
  fromAmberEvent,
  fromDeviceEvent,
  fromReminder,
  type AgendaItem,
  type AmberEvent,
  type AmberReminder,
} from './agenda';
import { progressiveDay } from './progressiveDay';
type DayData = {
  device: AgendaItem[];
  amber: AgendaItem[];
  reminders: AgendaItem[];
  conversations: ConversationSummary[];
  friends: FeedItem[];
};
const empty = (): DayData => ({
  device: [],
  amber: [],
  reminders: [],
  conversations: [],
  friends: [],
});
export function useCalendarDay(
  start: number,
  end: number,
  sample: boolean,
  revision: number,
  retry: number,
  eventsOnly = false,
) {
  const rangeKey = `${start}:${end}:${eventsOnly}`;
  // Component lifetime is scoped to the authenticated screen; nothing survives logout.
  const cache = useRef(new Map<string, { data: DayData; at: number; revision: number }>());
  const [state, setState] = useState({ key: rangeKey, data: empty(), busy: !sample, error: '' });
  const previousRetry = useRef(retry);
  useEffect(() => {
    if (sample) return;
    let current = true;
    const abort = new AbortController();
    const cached = cache.current.get(rangeKey);
    const forced = previousRetry.current !== retry;
    previousRetry.current = retry;
    setState({ key: rangeKey, data: cached?.data ?? empty(), busy: !cached, error: '' });
    if (cached && cached.revision === revision && Date.now() - cached.at < 60000 && !forced) return;
    const window = { from: new Date(start), to: new Date(end) };
    const transport = { signal: abort.signal, timeoutMs: 12000, retries: 0 };
    // One agenda request supplies both events and reminders.
    const agenda = callMedhaId<{ events: AmberEvent[]; reminders: AmberReminder[] }>({
      path: `/v1/me/agenda?from=${encodeURIComponent(window.from.toISOString())}&to=${encodeURIComponent(window.to.toISOString())}`,
      requireAuth: true,
      ...transport,
    }).then((result) => {
      if (!result.ok) throw Error('agenda');
      return result.data;
    });
    void progressiveDay<DayData>({
      initial: cached?.data ?? empty(),
      active: () => current,
      sources: {
        device: async () =>
          (await readDeviceEvents(window.from, window.to, true))
            .map(fromDeviceEvent)
            .filter((v): v is AgendaItem => !!v),
        amber: async () =>
          ((await agenda).events ?? []).map(fromAmberEvent).filter((v): v is AgendaItem => !!v),
        reminders: async () =>
          ((await agenda).reminders ?? []).map(fromReminder).filter((v): v is AgendaItem => !!v),
        conversations: async () => {
          if (eventsOnly) return [];
          const r = await listConversations(window, transport);
          if (!r.ok) throw Error('notes');
          return r.data.conversations;
        },
        friends: async () => {
          if (eventsOnly) return [];
          const r = await getNetworkFeed(100, window, transport);
          if (!r.ok) throw Error('shared');
          return r.data.items;
        },
      },
      publish: (data) => {
        setState((old) => ({ ...old, key: rangeKey, data }));
        // Retain fast sections even if a slower request is cancelled by date navigation.
        cache.current.set(rangeKey, { data, at: 0, revision });
        while (cache.current.size > 14) cache.current.delete(cache.current.keys().next().value!);
      },
      failed: () =>
        setState((old) => ({
          ...old,
          error:
            'Some items could not refresh. Showing available plans and recordings. Tap to retry.',
        })),
      settled: (key) => {
        if (key === 'amber') setState((old) => ({ ...old, busy: false }));
      },
    }).then((result) => {
      if (!current) return;
      if (result.ok) {
        cache.current.delete(rangeKey);
        cache.current.set(rangeKey, { data: result.data, at: Date.now(), revision });
        while (cache.current.size > 14) cache.current.delete(cache.current.keys().next().value!);
      }
      setState((old) => ({ ...old, busy: false }));
    });
    return () => {
      current = false;
      abort.abort();
    };
  }, [start, end, rangeKey, sample, revision, retry, eventsOnly]);
  const cached = cache.current.get(rangeKey);
  const visible =
    state.key === rangeKey ? state : { data: cached?.data ?? empty(), busy: !cached, error: '' };
  const { device, amber, reminders, conversations, friends } = visible.data;
  return {
    events: buildAgenda({ device, amber, reminders, dayStart: start, dayEnd: end }),
    conversations,
    friends,
    busy: visible.busy,
    error: visible.error,
  };
}
