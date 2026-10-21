import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { dayKey, isSameDay } from '../lib/calendarStrip';
import {
  monthDates,
  moveCalendarDay,
  moveCalendarMonth,
  selectedWeekIndex,
} from '../lib/calendarNavigation';
import { cl } from '../lib/classical';
const SPRING = { damping: 26, stiffness: 220, mass: 1 };

export function CalendarDateStrip({ day, onChange }: { day: Date; onChange: (day: Date) => void }) {
  const [expanded, setExpanded] = useState(false);
  const [month, setMonth] = useState(day);
  const reduced = useReducedMotion();
  const { fontScale } = useWindowDimensions();
  const rowHeight = 46 * Math.min(1.5, Math.max(1, fontScale));
  const extra = rowHeight * 5;
  const progress = useSharedValue(0);
  const origin = useSharedValue(0);
  const dates = monthDates(month);
  const week = selectedWeekIndex(day, month);
  useEffect(() => {
    setMonth(day);
  }, [day]);
  const expand = (open: boolean) => {
    if (!open) setMonth(day);
    setExpanded(open);
    progress.value = reduced ? Number(open) : withSpring(Number(open), SPRING);
  };
  const choose = (date: Date) => {
    onChange(date);
    setMonth(date);
    setExpanded(false);
    progress.value = reduced ? 0 : withSpring(0, SPRING);
  };
  const navigate = (direction: number) => {
    if (expanded) setMonth((current) => moveCalendarMonth(current, direction));
    else choose(moveCalendarDay(day, direction * 7));
  };
  const pull = Gesture.Pan()
    .activeOffsetY([-12, 12])
    .failOffsetX([-24, 24])
    .onBegin(() => {
      origin.value = progress.value;
    })
    .onUpdate((event) => {
      progress.value = Math.max(0, Math.min(1, origin.value + event.translationY / extra));
    })
    .onEnd((event) => {
      const open = Math.abs(event.velocityY) > 350 ? event.velocityY > 0 : progress.value > 0.4;
      runOnJS(expand)(open);
    })
    .onFinalize((_, success) => {
      if (!success)
        progress.value = reduced ? Number(expanded) : withSpring(Number(expanded), SPRING);
    });
  const clip = useAnimatedStyle(() => ({ height: rowHeight + extra * progress.value }));
  const grid = useAnimatedStyle(() => ({
    transform: [{ translateY: -week * rowHeight * (1 - progress.value) }],
  }));
  const chevron = useAnimatedStyle(() => ({
    transform: [{ rotate: `${progress.value * 180}deg` }],
  }));
  const today = new Date();
  return (
    <View style={s.root}>
      <View style={s.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={expanded ? 'Collapse calendar' : 'Expand calendar'}
          accessibilityState={{ expanded }}
          accessibilityHint="Pull the date row down to browse a month"
          onPress={() => expand(!expanded)}
          style={s.monthButton}
        >
          <Text style={s.month}>
            {month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
          </Text>
          <Animated.View style={chevron}>
            <ChevronDown size={17} color={cl.ink62} />
          </Animated.View>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Go to today"
          onPress={() => choose(new Date())}
          style={s.control}
        >
          <Text style={s.today}>Today</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Previous ${expanded ? 'month' : 'week'}`}
          onPress={() => navigate(-1)}
          style={s.arrow}
        >
          <ChevronLeft size={20} color={cl.ink} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Next ${expanded ? 'month' : 'week'}`}
          onPress={() => navigate(1)}
          style={s.arrow}
        >
          <ChevronRight size={20} color={cl.ink} />
        </Pressable>
      </View>
      <GestureDetector gesture={pull}>
        <View collapsable={false}>
          <View style={s.weekdays}>
            {dates.slice(0, 7).map((date) => (
              <Text key={date.getDay()} style={s.weekday}>
                {date.toLocaleDateString(undefined, { weekday: 'narrow' })}
              </Text>
            ))}
          </View>
          <Animated.View style={[{ overflow: 'hidden' }, clip]}>
            <Animated.View style={[s.grid, grid]}>
              {dates.map((date, index) => {
                const selected = isSameDay(date, day);
                const visible = expanded || Math.floor(index / 7) === week;
                return (
                  <View
                    key={dayKey(date)}
                    style={{ width: `${100 / 7}%`, height: rowHeight }}
                    accessibilityElementsHidden={!visible}
                    importantForAccessibility={visible ? 'auto' : 'no-hide-descendants'}
                  >
                    <Pressable
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                      accessibilityLabel={date.toLocaleDateString(undefined, {
                        weekday: 'long',
                        month: 'long',
                        day: 'numeric',
                        year: 'numeric',
                      })}
                      onPress={() => choose(date)}
                      style={[s.day, selected && s.selected]}
                    >
                      <Text
                        style={[
                          s.number,
                          date.getMonth() !== month.getMonth() && { color: cl.ink32 },
                          selected && { color: cl.card },
                        ]}
                      >
                        {date.getDate()}
                      </Text>
                      {isSameDay(date, today) && (
                        <View style={[s.dot, selected && { backgroundColor: cl.card }]} />
                      )}
                    </Pressable>
                  </View>
                );
              })}
            </Animated.View>
          </Animated.View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={expanded ? 'Collapse date row' : 'Pull down calendar'}
            onPress={() => expand(!expanded)}
            style={s.handleTarget}
          >
            <View style={s.handle} />
          </Pressable>
        </View>
      </GestureDetector>
    </View>
  );
}
const s = StyleSheet.create({
  root: {
    paddingHorizontal: 12,
    paddingBottom: 2,
    borderBottomWidth: 1,
    borderBottomColor: cl.cardHairline,
  },
  header: { flexDirection: 'row', alignItems: 'center' },
  monthButton: { flex: 1, minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 5 },
  month: { fontFamily: 'Newsreader_500Medium', fontSize: 23, color: cl.ink, flexShrink: 1 },
  today: { fontFamily: 'Outfit_500Medium', fontSize: 12, color: cl.goldDeep },
  control: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  arrow: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  weekdays: { flexDirection: 'row', paddingBottom: 2 },
  weekday: {
    width: `${100 / 7}%`,
    textAlign: 'center',
    fontFamily: 'Outfit_500Medium',
    fontSize: 11,
    color: cl.ink62,
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  day: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 22,
    marginHorizontal: 3,
    marginVertical: 1,
  },
  selected: { backgroundColor: cl.goldDeep },
  number: { fontFamily: 'Outfit_500Medium', fontSize: 17, color: cl.ink },
  dot: {
    position: 'absolute',
    bottom: 4,
    width: 3,
    height: 3,
    borderRadius: 2,
    backgroundColor: cl.goldDeep,
  },
  handleTarget: { height: 20, alignItems: 'center', justifyContent: 'center' },
  handle: { width: 30, height: 3, borderRadius: 2, backgroundColor: cl.warmHairline },
});
