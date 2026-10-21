export interface HoroscopeResult {
  sign: string;
  symbol: string;
  element: string;
  modality: string;
  dateRange: string;
}

const SIGNS: { sign: string; symbol: string; element: string; modality: string; startMonth: number; startDay: number; endMonth: number; endDay: number; dateRange: string }[] = [
  { sign: 'Capricorn',   symbol: '♑', element: 'Earth', modality: 'Cardinal',  startMonth: 12, startDay: 22, endMonth: 1,  endDay: 19, dateRange: 'Dec 22 – Jan 19' },
  { sign: 'Aquarius',    symbol: '♒', element: 'Air',   modality: 'Fixed',     startMonth: 1,  startDay: 20, endMonth: 2,  endDay: 18, dateRange: 'Jan 20 – Feb 18' },
  { sign: 'Pisces',      symbol: '♓', element: 'Water', modality: 'Mutable',   startMonth: 2,  startDay: 19, endMonth: 3,  endDay: 20, dateRange: 'Feb 19 – Mar 20' },
  { sign: 'Aries',       symbol: '♈', element: 'Fire',  modality: 'Cardinal',  startMonth: 3,  startDay: 21, endMonth: 4,  endDay: 19, dateRange: 'Mar 21 – Apr 19' },
  { sign: 'Taurus',      symbol: '♉', element: 'Earth', modality: 'Fixed',     startMonth: 4,  startDay: 20, endMonth: 5,  endDay: 20, dateRange: 'Apr 20 – May 20' },
  { sign: 'Gemini',      symbol: '♊', element: 'Air',   modality: 'Mutable',   startMonth: 5,  startDay: 21, endMonth: 6,  endDay: 20, dateRange: 'May 21 – Jun 20' },
  { sign: 'Cancer',      symbol: '♋', element: 'Water', modality: 'Cardinal',  startMonth: 6,  startDay: 21, endMonth: 7,  endDay: 22, dateRange: 'Jun 21 – Jul 22' },
  { sign: 'Leo',         symbol: '♌', element: 'Fire',  modality: 'Fixed',     startMonth: 7,  startDay: 23, endMonth: 8,  endDay: 22, dateRange: 'Jul 23 – Aug 22' },
  { sign: 'Virgo',       symbol: '♍', element: 'Earth', modality: 'Mutable',   startMonth: 8,  startDay: 23, endMonth: 9,  endDay: 22, dateRange: 'Aug 23 – Sep 22' },
  { sign: 'Libra',       symbol: '♎', element: 'Air',   modality: 'Cardinal',  startMonth: 9,  startDay: 23, endMonth: 10, endDay: 22, dateRange: 'Sep 23 – Oct 22' },
  { sign: 'Scorpio',     symbol: '♏', element: 'Water', modality: 'Fixed',     startMonth: 10, startDay: 23, endMonth: 11, endDay: 21, dateRange: 'Oct 23 – Nov 21' },
  { sign: 'Sagittarius', symbol: '♐', element: 'Fire',  modality: 'Mutable',   startMonth: 11, startDay: 22, endMonth: 12, endDay: 21, dateRange: 'Nov 22 – Dec 21' },
];

export function deriveHoroscope(birthday: string): HoroscopeResult {
  const date = new Date(birthday);
  const month = date.getUTCMonth() + 1; // 1-indexed
  const day = date.getUTCDate();

  for (const s of SIGNS) {
    // Handle Capricorn which wraps around year boundary
    if (s.startMonth > s.endMonth) {
      if ((month === s.startMonth && day >= s.startDay) || (month === s.endMonth && day <= s.endDay)) {
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
  return { sign: 'Unknown', symbol: '?', element: 'Unknown', modality: 'Unknown', dateRange: '' };
}
