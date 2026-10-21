import { getWeekDates } from './calendarStrip';

export function moveCalendarDay(day: Date, days: number): Date {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate() + days, 12);
}
export function moveCalendarMonth(month: Date, months: number): Date {
  return new Date(month.getFullYear(), month.getMonth() + months, 1, 12);
}
/** Six complete local-time weeks keep the expanded calendar stable while browsing. */
export function monthDates(month: Date): Date[] {
  const first = getWeekDates(new Date(month.getFullYear(), month.getMonth(), 1, 12))[0];
  return Array.from({ length: 42 }, (_, index) => moveCalendarDay(first, index));
}
export function selectedWeekIndex(day: Date, month: Date): number {
  if (day.getFullYear() !== month.getFullYear() || day.getMonth() !== month.getMonth()) return 0;
  return Math.floor(
    (new Date(month.getFullYear(), month.getMonth(), 1).getDay() + day.getDate() - 1) / 7,
  );
}

/** Local midnights, including 23/25-hour DST days; upcoming is a rolling 30-day window. */
export function calendarWindow(
  day: Date,
  mode: 'day' | 'upcoming',
): { start: number; end: number } {
  const y = day.getFullYear(),
    m = day.getMonth(),
    d = day.getDate();
  return {
    start: new Date(y, m, d).getTime(),
    end: new Date(y, m, d + (mode === 'day' ? 1 : 30)).getTime(),
  };
}
