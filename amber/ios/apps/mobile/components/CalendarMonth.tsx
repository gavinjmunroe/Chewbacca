import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { ChevronLeft, ChevronRight, Menu, CalendarDays } from 'lucide-react-native';
import { monthDates, moveCalendarMonth } from '../lib/calendarNavigation';
import { dayKey, isSameDay, getWeekDates } from '../lib/calendarStrip';
import { yearProgress } from '../lib/yearProgress';
import { Pressable } from './Pressable';
import { cl } from '../lib/classical';
export function CalendarMonth({ day, onChange }: { day: Date; onChange: (date: Date) => void }) {
  const [month, setMonth] = useState(day);
  const [expanded, setExpanded] = useState(true);
  useEffect(() => setMonth(day), [day]);
  const dates = useMemo(
    () => (expanded ? monthDates(month) : getWeekDates(day)),
    [month, day, expanded],
  );
  const displayMonth = expanded ? month : day;
  const today = new Date();
  const year = yearProgress(today);
  return (
    <View style={{ gap: 18 }}>
      <View style={s.calendar}>
        <View style={s.header}>
          <View style={{ flex: 1 }}>
            <Text style={s.eyebrow}>{displayMonth.getFullYear()} · YOUR PLANS</Text>
            <Text style={s.month}>
              {displayMonth.toLocaleDateString(undefined, { month: 'long' })}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={expanded ? 'Show selected week' : 'Expand month calendar'}
            accessibilityState={{ expanded }}
            onPress={() => {
              setExpanded(!expanded);
              if (expanded) setMonth(day);
            }}
            style={s.arrow}
          >
            {expanded ? (
              <Menu size={20} color={cl.ink} />
            ) : (
              <CalendarDays size={20} color={cl.ink} />
            )}
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Go to today"
            onPress={() => onChange(new Date())}
            style={s.today}
          >
            <Text style={s.todayText}>Today</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Previous month"
            onPress={() => {
              setExpanded(true);
              setMonth((m) => moveCalendarMonth(m, -1));
            }}
            style={s.arrow}
          >
            <ChevronLeft size={20} color={cl.ink} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Next month"
            onPress={() => {
              setExpanded(true);
              setMonth((m) => moveCalendarMonth(m, 1));
            }}
            style={s.arrow}
          >
            <ChevronRight size={20} color={cl.ink} />
          </Pressable>
        </View>
        <View style={s.week}>
          {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((label, i) => (
            <Text key={i} style={s.weekday}>
              {label}
            </Text>
          ))}
        </View>
        <View style={s.grid}>
          {dates.map((date) => {
            const selected = isSameDay(day, date);
            return (
              <View key={dayKey(date)} style={s.cell}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  accessibilityLabel={date.toLocaleDateString(undefined, {
                    weekday: 'long',
                    month: 'long',
                    day: 'numeric',
                    year: 'numeric',
                  })}
                  onPress={() => {
                    onChange(date);
                    setExpanded(false);
                  }}
                  style={({ pressed }) => [
                    s.date,
                    selected && s.selected,
                    pressed && { opacity: 0.55 },
                  ]}
                >
                  <Text
                    style={[
                      s.number,
                      date.getMonth() !== displayMonth.getMonth() && { color: cl.ink32 },
                      selected && { color: cl.card },
                    ]}
                  >
                    {date.getDate()}
                  </Text>
                  {isSameDay(today, date) && (
                    <View style={[s.dot, selected && { backgroundColor: cl.card }]} />
                  )}
                </Pressable>
              </View>
            );
          })}
        </View>
      </View>
      <View style={s.year} accessibilityLabel={`${year.remaining} days left in ${year.year}`}>
        <View style={s.yearHeading}>
          <Text style={s.remaining}>
            {year.remaining}
            <Text style={s.yearLabel}> days left in {year.year}</Text>
          </Text>
          <Text style={s.percent}>{Math.round(year.fraction * 100)}%</Text>
        </View>
        <View style={s.track}>
          <View style={[s.fill, { width: `${year.fraction * 100}%` }]} />
        </View>
      </View>
    </View>
  );
}
const s = StyleSheet.create({
  calendar: {
    padding: 12,
    borderRadius: 28,
    backgroundColor: cl.card,
    borderColor: cl.cardHairline,
    borderWidth: 1,
  },
  header: { flexDirection: 'row', alignItems: 'center', paddingLeft: 6, paddingBottom: 12 },
  eyebrow: { fontFamily: 'Outfit_500Medium', fontSize: 10, letterSpacing: 1.3, color: cl.ink62 },
  month: { fontFamily: 'Newsreader_500Medium', fontSize: 28, color: cl.ink, marginTop: 3 },
  today: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 8 },
  todayText: { fontFamily: 'Outfit_500Medium', fontSize: 12, color: cl.goldDeep },
  arrow: { width: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  week: { flexDirection: 'row', marginBottom: 6 },
  weekday: {
    width: `${100 / 7}%`,
    textAlign: 'center',
    fontFamily: 'Outfit_500Medium',
    fontSize: 11,
    color: cl.ink62,
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: `${100 / 7}%`, minHeight: 44 },
  date: {
    minHeight: 44,
    margin: 1,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selected: { backgroundColor: cl.goldDeep },
  number: { fontFamily: 'Outfit_500Medium', fontSize: 16, color: cl.ink },
  dot: {
    position: 'absolute',
    bottom: 4,
    width: 3,
    height: 3,
    borderRadius: 2,
    backgroundColor: cl.goldDeep,
  },
  year: { paddingHorizontal: 8, gap: 8, paddingBottom: 6 },
  yearHeading: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  remaining: { fontFamily: 'Newsreader_500Medium', fontSize: 28, color: cl.ink },
  yearLabel: { fontFamily: 'Outfit_400Regular', fontSize: 13, color: cl.ink62 },
  percent: { fontFamily: 'Outfit_500Medium', fontSize: 11, color: cl.goldDeep },
  track: { height: 4, borderRadius: 2, backgroundColor: cl.groundGold, overflow: 'hidden' },
  fill: { height: 4, backgroundColor: cl.goldDeep, borderRadius: 2 },
});
