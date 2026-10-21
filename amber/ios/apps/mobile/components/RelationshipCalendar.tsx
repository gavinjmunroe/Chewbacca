import type { DiscoveryPerson } from './WebDiscoverySheet';
import { readDeviceEvents } from '../lib/deviceCalendar';
import { DailyReflectionFeed } from './DailyReflectionFeed';
import type { MedhaContactFull } from '../lib/contacts';
import type { SearchPerson } from './PeopleSearchExperience';
import { DailyDigest } from './DailyDigest';
import { FloatingAccent } from './FloatingAccent';
import { QuickEventSheet, type QuickEvent } from './QuickEventSheet';
import Animated, { FadeIn, useReducedMotion } from 'react-native-reanimated';
import { EventDetail } from './EventDetail';
import * as Haptics from 'expo-haptics';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ChevronDown } from 'lucide-react-native';
import { cl } from '../lib/classical';
import { callMedhaId } from '../lib/medhaId';
import {
  buildAgenda,
  dayBounds,
  fromAmberEvent,
  fromDeviceEvent,
  fromReminder,
  timeRange,
  type AgendaItem,
  type AmberEvent,
  type AmberReminder,
} from '../lib/agenda';

const EMPTY_SAMPLE_EVENTS: { title: string; startsAt: string; endsAt: string }[] = [];

export function RelationshipCalendar({
  sample = false,
  web = false,
  query = '',
  sampleEvents = EMPTY_SAMPLE_EVENTS,
  revision = 0,
  onSampleEvent,
  onSearchItemsChange,
  contacts,
  activity,
  intent = '',
  onAddSample,
  onIntentChange,
  onOpenPerson,
}: {
  contacts?: MedhaContactFull[];
  activity?: string;
  intent?: string;
  onAddSample?: (person: DiscoveryPerson) => void;
  onIntentChange?: (value: string) => Promise<void>;
  onOpenPerson?: (id: string) => void;
  sample?: boolean;
  web?: boolean;
  query?: string;
  sampleEvents?: { title: string; startsAt: string; endsAt: string }[];
  revision?: number;
  onSearchItemsChange?: (items: SearchPerson[]) => void;
  onSampleEvent?: (event: QuickEvent) => void;
}) {
  const [mode, setMode] = useState<'feed' | 'agenda'>('feed');
  const searchingWeb = web && query.trim().length > 0;
  const reduced = useReducedMotion();
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState<QuickEvent[]>([]);
  const allSampleEvents = useMemo(() => [...sampleEvents, ...added], [sampleEvents, added]);
  const edge = useRef({ offset: 0, bottom: 0, peak: 0, committed: false });
  const touch = useRef({ x: 0, y: 0, top: true, bottom: true });
  const [selected, setSelected] = useState<AgendaItem | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [day, setDay] = useState(() => new Date());
  const [items, setItems] = useState<AgendaItem[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (sample) return;
    let current = true;
    const { start, end } = dayBounds(day);
    setLoading(true);
    setError('');
    setItems([]);
    void (async () => {
      try {
        const device = await readDeviceEvents(new Date(start), new Date(end));
        if (current)
          setItems(
            buildAgenda({
              device: device.map(fromDeviceEvent).filter((v): v is AgendaItem => v !== null),
              amber: [],
              reminders: [],
              dayStart: start,
              dayEnd: end,
            }),
          );
        const res = await callMedhaId<{ events: AmberEvent[]; reminders: AmberReminder[] }>({
          path: `/v1/me/agenda?from=${encodeURIComponent(new Date(start).toISOString())}&to=${encodeURIComponent(new Date(end).toISOString())}`,
          method: 'GET',
          requireAuth: true,
        });
        if (!current) return;
        if (!res.ok || !Array.isArray(res.data.events) || !Array.isArray(res.data.reminders)) {
          setError('Could not load your Amber calendar. Please try again.');
          return;
        }
        setItems(
          buildAgenda({
            device: device.map(fromDeviceEvent).filter((v): v is AgendaItem => v !== null),
            amber: res.data.events.map(fromAmberEvent).filter((v): v is AgendaItem => v !== null),
            reminders: res.data.reminders
              .map(fromReminder)
              .filter((v): v is AgendaItem => v !== null),
            dayStart: start,
            dayEnd: end,
          }),
        );
      } catch {
        if (current) setError('Could not load your Amber calendar. Please try again.');
      } finally {
        if (current) setLoading(false);
      }
    })();
    return () => {
      current = false;
    };
  }, [day, sample, retry, revision]);
  const searchItems = useMemo(
    () =>
      sample
        ? [
            { id: 'sample-coffee', name: 'Coffee with Maya', detail: '10:00–10:30 AM · café' },
            { id: 'sample-walk', name: 'A walk with Alex', detail: '5:30–6:00 PM · park' },
            ...allSampleEvents
              .filter((event) => new Date(event.startsAt).toDateString() === day.toDateString())
              .map((event, i) => ({
                id: `sample-${i}`,
                name: event.title,
                detail: new Date(event.startsAt).toLocaleTimeString([], {
                  hour: 'numeric',
                  minute: '2-digit',
                }),
              })),
          ]
        : items.map((item) => ({
            id: item.key,
            name: item.title,
            detail: [day.toLocaleDateString(), timeRange(item), item.location]
              .filter(Boolean)
              .join(' · '),
          })),
    [sample, allSampleEvents, day, items],
  );
  useEffect(() => {
    onSearchItemsChange?.(searchItems);
  }, [onSearchItemsChange, searchItems]);
  const matches = (title: string, location = '') =>
    `${title} ${location}`.toLowerCase().includes(query.trim().toLowerCase());
  const noMatches =
    query.trim() &&
    (sample
      ? !matches('Coffee with Maya', 'café') &&
        !matches('A walk with Alex', 'park') &&
        !allSampleEvents.some(
          (event) =>
            new Date(event.startsAt).toDateString() === day.toDateString() &&
            matches(event.title, 'Added in preview'),
        )
      : items.length > 0 && !items.some((item) => matches(item.title, item.location ?? '')));
  const move = (offset: number) => {
    setDay((value) => new Date(value.getFullYear(), value.getMonth(), value.getDate() + offset));
    void Haptics.selectionAsync().catch(() => {});
  };
  return (
    <View style={s.screen}>
      <View style={s.heading}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Choose calendar date"
          accessibilityHint="Swipe up or down in the agenda to change days"
          accessibilityActions={[
            { name: 'increment', label: 'Next day' },
            { name: 'decrement', label: 'Previous day' },
          ]}
          onAccessibilityAction={(event) =>
            move(event.nativeEvent.actionName === 'increment' ? 1 : -1)
          }
          accessibilityState={{ expanded: pickerOpen }}
          onPress={() => setPickerOpen((value) => !value)}
          style={{ flex: 1, flexDirection: 'row', alignItems: 'center', minHeight: 44 }}
        >
          <Text style={s.title}>
            {day.toLocaleDateString(undefined, {
              weekday: 'short',
              month: 'short',
              day: 'numeric',
            })}
          </Text>
          <ChevronDown size={18} color={cl.ink} />
        </Pressable>
        <Pressable accessibilityRole="button" onPress={() => setDay(new Date())} style={s.button}>
          <Text style={s.text}>Today</Text>
        </Pressable>
      </View>
      {pickerOpen && (
        <DateTimePicker
          value={day}
          mode="date"
          display="inline"
          onChange={(_, date) => {
            if (date) setDay(date);
            setPickerOpen(false);
          }}
        />
      )}

      <View style={{ flexDirection: 'row', gap: 12, marginVertical: 8 }}>
        {(['feed', 'agenda'] as const).map((value) => (
          <Pressable
            key={value}
            accessibilityRole="button"
            accessibilityState={{ selected: (query.trim() ? 'agenda' : mode) === value }}
            onPress={() => setMode(value)}
            style={[
              s.button,
              {
                paddingHorizontal: 18,
                borderRadius: 22,
                backgroundColor:
                  (query.trim() ? 'agenda' : mode) === value ? cl.groundGold : cl.card,
              },
            ]}
          >
            <Text style={s.text}>{value === 'feed' ? 'Your network' : 'Schedule'}</Text>
          </Pressable>
        ))}
      </View>
      {mode === 'feed' && !query.trim() ? (
        <DailyReflectionFeed
          onAddSample={onAddSample}
          day={day}
          events={searchItems}
          query={query}
          activity={intent}
          intent={intent}
          onIntentChange={onIntentChange}
          sample={sample}
        />
      ) : searchingWeb ? (
        <DailyDigest key={day.toDateString() + query} day={day} query={query} sample={sample} />
      ) : (
        <>
          <Text style={s.caption}>
            {sample
              ? 'Sample schedule · not connected to a calendar'
              : 'Amber events, reminders, and calendars you have allowed on this device'}
          </Text>
          <Animated.View entering={reduced ? undefined : FadeIn.duration(180)} style={{ flex: 1 }}>
            <ScrollView
              alwaysBounceVertical
              contentContainerStyle={[s.list, { flexGrow: 1 }]}
              scrollEventThrottle={16}
              onTouchStart={(event) => {
                touch.current = {
                  x: event.nativeEvent.pageX,
                  y: event.nativeEvent.pageY,
                  top: edge.current.offset <= 1,
                  bottom: edge.current.offset >= edge.current.bottom - 1,
                };
                edge.current.peak = 0;
                edge.current.committed = false;
              }}
              onTouchEnd={(event) => {
                const dy = event.nativeEvent.pageY - touch.current.y;
                const dx = event.nativeEvent.pageX - touch.current.x;
                if (
                  !edge.current.committed &&
                  Math.abs(dy) > 80 &&
                  Math.abs(dy) > Math.abs(dx) * 1.5 &&
                  ((dy > 0 && touch.current.top) || (dy < 0 && touch.current.bottom))
                ) {
                  edge.current.committed = true;
                  move(dy > 0 ? -1 : 1);
                }
              }}
              onScroll={(event) => {
                const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
                edge.current.offset = contentOffset.y;
                edge.current.bottom = Math.max(0, contentSize.height - layoutMeasurement.height);
                const overscroll =
                  contentOffset.y < 0
                    ? contentOffset.y
                    : Math.max(0, contentOffset.y - edge.current.bottom);
                if (Math.abs(overscroll) > Math.abs(edge.current.peak))
                  edge.current.peak = overscroll;
              }}
              onScrollEndDrag={() => {
                if (!edge.current.committed && Math.abs(edge.current.peak) > 45) {
                  edge.current.committed = true;
                  move(edge.current.peak < 0 ? -1 : 1);
                }
              }}
            >
              <Text style={s.caption}>
                {query.trim()
                  ? `Results for “${query.trim()}” · this day`
                  : 'Pull down for the previous day · pull up for the next'}
              </Text>
              {loading && (
                <ActivityIndicator color={cl.goldDeep} accessibilityLabel="Loading calendar" />
              )}
              {error ? (
                <>
                  <Text accessibilityRole="alert" style={s.text}>
                    {error}
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => setRetry((value) => value + 1)}
                    style={s.button}
                  >
                    <Text style={s.text}>Try again</Text>
                  </Pressable>
                </>
              ) : null}
              {sample ? (
                <>
                  {[
                    { title: 'Coffee with Maya', time: '10:00–10:30 AM', place: 'café' },
                    { title: 'A walk with Alex', time: '5:30–6:00 PM', place: 'park' },
                    ...allSampleEvents
                      .filter(
                        (event) => new Date(event.startsAt).toDateString() === day.toDateString(),
                      )
                      .map((event) => ({
                        title: event.title,
                        time: new Date(event.startsAt).toLocaleTimeString([], {
                          hour: 'numeric',
                          minute: '2-digit',
                        }),
                        place: 'Added in preview',
                      })),
                  ]
                    .filter((item) =>
                      `${item.title} ${item.place}`
                        .toLowerCase()
                        .includes(query.trim().toLowerCase()),
                    )
                    .map((item) => (
                      <View key={item.title} style={s.event}>
                        <Text style={s.time}>{item.time}</Text>
                        <Text style={s.eventTitle}>{item.title}</Text>
                        <Text style={s.caption}>Sample event · {item.place}</Text>
                      </View>
                    ))}
                </>
              ) : (
                items
                  .filter((item) =>
                    `${item.title} ${item.location ?? ''}`
                      .toLowerCase()
                      .includes(query.trim().toLowerCase()),
                  )
                  .map((item) => (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Open ${item.title}`}
                      onPress={() => setSelected(item)}
                      key={item.key}
                      style={s.event}
                    >
                      <Text style={s.time}>{timeRange(item)}</Text>
                      <Text style={s.eventTitle}>{item.title}</Text>
                      <Text style={s.caption}>
                        {item.source === 'reminder'
                          ? 'Amber reminder'
                          : item.source === 'device'
                            ? 'Device calendar'
                            : 'Amber event'}
                        {item.location ? ` · ${item.location}` : ''}
                      </Text>
                    </Pressable>
                  ))
              )}
              {!loading && !error && noMatches ? (
                <Text style={s.text}>No matching events on this day.</Text>
              ) : null}
              {!sample && !loading && !error && !items.length && (
                <Text style={s.text}>
                  No saved Amber events or scheduled reminders for this day.
                </Text>
              )}
            </ScrollView>
          </Animated.View>
        </>
      )}
      {!searchingWeb && (
        <FloatingAccent
          kind="add"
          onPress={() => {
            void Haptics.selectionAsync().catch(() => {});
            setAdding(true);
          }}
        />
      )}
      {adding && (
        <QuickEventSheet
          day={day}
          sample={sample}
          onClose={() => setAdding(false)}
          onSaved={(event) => {
            if (sample) {
              if (onSampleEvent) onSampleEvent(event);
              else setAdded((value) => [...value, event]);
            } else setRetry((value) => value + 1);
          }}
        />
      )}
      <EventDetail item={selected} onClose={() => setSelected(null)} />
    </View>
  );
}
const s = StyleSheet.create({
  screen: { flex: 1, paddingHorizontal: 24 },
  heading: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 12,
  },
  title: { fontFamily: 'Newsreader_500Medium', fontSize: 28, color: cl.ink, flex: 1 },
  button: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 8,
  },
  days: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 18,
  },
  text: { fontFamily: 'Outfit_400Regular', fontSize: 15, lineHeight: 23, color: cl.ink },
  caption: {
    fontFamily: 'Outfit_400Regular',
    fontSize: 11,
    lineHeight: 17,
    color: cl.ink62,
    marginVertical: 10,
  },
  list: { paddingVertical: 18, paddingBottom: 72, gap: 16 },
  event: {
    backgroundColor: cl.groundGold,
    borderLeftWidth: 3,
    borderLeftColor: cl.goldDeep,
    borderRadius: 14,
    padding: 16,
  },
  time: { fontFamily: 'Outfit_400Regular', fontSize: 12, color: cl.ink62 },
  eventTitle: { fontFamily: 'Outfit_500Medium', fontSize: 18, color: cl.ink, marginTop: 8 },
});
