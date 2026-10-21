/**
 * Horoscope derivation from birthday.
 * Ported from amber-ios/services/app/src/util/horoscope.ts
 */

const SIGNS = [
  { sign: "Capricorn",   symbol: "\u2651", element: "Earth", modality: "Cardinal",  startMonth: 12, startDay: 22, endMonth: 1,  endDay: 19, dateRange: "Dec 22 - Jan 19" },
  { sign: "Aquarius",    symbol: "\u2652", element: "Air",   modality: "Fixed",     startMonth: 1,  startDay: 20, endMonth: 2,  endDay: 18, dateRange: "Jan 20 - Feb 18" },
  { sign: "Pisces",      symbol: "\u2653", element: "Water", modality: "Mutable",   startMonth: 2,  startDay: 19, endMonth: 3,  endDay: 20, dateRange: "Feb 19 - Mar 20" },
  { sign: "Aries",       symbol: "\u2648", element: "Fire",  modality: "Cardinal",  startMonth: 3,  startDay: 21, endMonth: 4,  endDay: 19, dateRange: "Mar 21 - Apr 19" },
  { sign: "Taurus",      symbol: "\u2649", element: "Earth", modality: "Fixed",     startMonth: 4,  startDay: 20, endMonth: 5,  endDay: 20, dateRange: "Apr 20 - May 20" },
  { sign: "Gemini",      symbol: "\u264A", element: "Air",   modality: "Mutable",   startMonth: 5,  startDay: 21, endMonth: 6,  endDay: 20, dateRange: "May 21 - Jun 20" },
  { sign: "Cancer",      symbol: "\u264B", element: "Water", modality: "Cardinal",  startMonth: 6,  startDay: 21, endMonth: 7,  endDay: 22, dateRange: "Jun 21 - Jul 22" },
  { sign: "Leo",         symbol: "\u264C", element: "Fire",  modality: "Fixed",     startMonth: 7,  startDay: 23, endMonth: 8,  endDay: 22, dateRange: "Jul 23 - Aug 22" },
  { sign: "Virgo",       symbol: "\u264D", element: "Earth", modality: "Mutable",   startMonth: 8,  startDay: 23, endMonth: 9,  endDay: 22, dateRange: "Aug 23 - Sep 22" },
  { sign: "Libra",       symbol: "\u264E", element: "Air",   modality: "Cardinal",  startMonth: 9,  startDay: 23, endMonth: 10, endDay: 22, dateRange: "Sep 23 - Oct 22" },
  { sign: "Scorpio",     symbol: "\u264F", element: "Water", modality: "Fixed",     startMonth: 10, startDay: 23, endMonth: 11, endDay: 21, dateRange: "Oct 23 - Nov 21" },
  { sign: "Sagittarius", symbol: "\u2650", element: "Fire",  modality: "Mutable",   startMonth: 11, startDay: 22, endMonth: 12, endDay: 21, dateRange: "Nov 22 - Dec 21" },
];

/**
 * Derive horoscope sign from a birthday string (ISO date).
 * @param {string} birthday - ISO date string (e.g. "1995-03-15")
 * @returns {{ sign: string, symbol: string, element: string, modality: string, dateRange: string }}
 */
export function deriveHoroscope(birthday) {
  const date = new Date(birthday);
  const month = date.getUTCMonth() + 1; // 1-indexed
  const day = date.getUTCDate();

  for (const s of SIGNS) {
    // Handle Capricorn which wraps around year boundary
    if (s.startMonth > s.endMonth) {
      if (
        (month === s.startMonth && day >= s.startDay) ||
        (month === s.endMonth && day <= s.endDay)
      ) {
        return { sign: s.sign, symbol: s.symbol, element: s.element, modality: s.modality, dateRange: s.dateRange };
      }
    } else {
      if (
        (month === s.startMonth && day >= s.startDay) ||
        (month === s.endMonth && day <= s.endDay) ||
        (month > s.startMonth && month < s.endMonth)
      ) {
        return { sign: s.sign, symbol: s.symbol, element: s.element, modality: s.modality, dateRange: s.dateRange };
      }
    }
  }

  // Fallback (should never reach here with valid dates)
  return { sign: "Unknown", symbol: "?", element: "Unknown", modality: "Unknown", dateRange: "" };
}
