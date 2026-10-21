import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { CalendarSyncSheet } from './CalendarSyncSheet';
import { EventDetail } from './EventDetail';
import { useCalendarDay } from '../lib/useCalendarDay';
import { dayBounds, timeRange, type AgendaItem } from '../lib/agenda';
import { cl } from '../lib/classical';

/** Reads existing events only. Account authorization and sync remain explicit. */
export function PlanEvents({
  day,
  sample,
  revision,
  query,
  onAddMemo,
  onOpenPerson,
}: {
  onAddMemo?: (context: import('../lib/memoContext').MemoContext) => void;
  onOpenPerson?: (id: string) => void;
  day: Date;
  sample: boolean;
  revision: number;
  query: string;
}) {
  const [retry, setRetry] = useState(0);
  const [connections, setConnections] = useState(false);
  const [selected, setSelected] = useState<AgendaItem | null>(null);
  const { start, end } = dayBounds(day);
  const { events, busy, error } = useCalendarDay(start, end, sample, revision, retry, true);
  const rows = events.filter((item) =>
    `${item.title} ${item.location ?? ''}`.toLowerCase().includes(query.trim().toLowerCase()),
  );
  return (
    <View style={{ gap: 10 }}>
      <View style={s.heading}>
        <Text style={s.label}>
          {day.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
        </Text>
        {!sample && (
          <Pressable
            accessibilityRole="button"
            onPress={() => setConnections(true)}
            style={s.button}
          >
            <Text style={s.action}>Calendars</Text>
          </Pressable>
        )}
      </View>
      {busy && (
        <ActivityIndicator
          size="small"
          color={cl.goldDeep}
          accessibilityLabel="Refreshing calendar events"
        />
      )}
      {!!error && (
        <Pressable
          accessibilityRole="button"
          onPress={() => setRetry((v) => v + 1)}
          style={s.button}
        >
          <Text accessibilityRole="alert" style={s.caption}>
            {error}
          </Text>
        </Pressable>
      )}
      {rows.map((item) => (
        <View key={item.key} style={{ gap: 2 }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Open event: ${item.title}`}
            onPress={() => setSelected(item)}
            style={[s.event, { borderLeftColor: item.accent || cl.goldDeep }]}
          >
            <Text style={s.caption}>
              {timeRange(item)} ·{' '}
              {item.provider === 'google'
                ? 'Google Calendar'
                : item.provider === 'microsoft'
                  ? 'Outlook'
                  : item.source === 'device'
                    ? 'Apple Calendar'
                    : item.source === 'reminder'
                      ? 'Reminder'
                      : 'Amber'}
            </Text>
            <Text style={s.title}>{item.title}</Text>
            <Text style={s.caption}>
              {[
                'Your calendar',
                ...new Set(
                  [item.withPerson?.name, ...(item.people || []).map((p) => p.name)].filter(
                    Boolean,
                  ),
                ),
              ].join(' · ')}
            </Text>
            {!!item.location && <Text style={s.caption}>{item.location}</Text>}
          </Pressable>

        </View>
      ))}
      {!busy && !error && !rows.length && (
        <Text style={s.caption}>
          {sample
            ? 'Connect your calendars after signing in.'
            : query.trim()
              ? 'No matching events on this day.'
              : 'No events on this day. Choose another date or connect a calendar.'}
        </Text>
      )}
      <CalendarSyncSheet
        googleOnly
        visible={connections}
        onClose={() => setConnections(false)}
        onConnected={() => setRetry((v) => v + 1)}
      />
      <EventDetail
        onOpenPerson={onOpenPerson}
        onAddMemo={
          onAddMemo
            ? () => {
                if (selected) {
                  const item = selected;
                  setSelected(null);
                  onAddMemo({
                    kind: 'plan',
                    label: item.title,
                    id: item.key,
                    place: item.location || undefined,
                  });
                }
              }
            : undefined
        }
        item={selected}
        onClose={() => setSelected(null)}
      />
    </View>
  );
}
const s = StyleSheet.create({
  heading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  button: { minHeight: 44, padding: 10, justifyContent: 'center' },
  label: { fontFamily: 'Outfit_500Medium', fontSize: 15, color: cl.ink },
  action: { fontFamily: 'Outfit_500Medium', fontSize: 13, color: cl.goldDeep },
  caption: { fontFamily: 'Outfit_400Regular', fontSize: 12, lineHeight: 18, color: cl.ink62 },
  title: { fontFamily: 'Newsreader_500Medium', fontSize: 23, lineHeight: 29, color: cl.ink },
  event: {
    padding: 16,
    gap: 5,
    borderRadius: 18,
    backgroundColor: cl.groundGold,
    borderLeftWidth: 3,
  },
});
