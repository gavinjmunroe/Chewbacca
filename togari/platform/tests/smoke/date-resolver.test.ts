/**
 * Date/time phrase resolver tests.
 *
 * resolveDatePhrases is the deterministic pre-processor that turns
 * natural-language date/time phrases into [date: YYYY-MM-DD] and
 * [time: HH:MM] markers in user text BEFORE the LLM parser runs. The
 * goal is to remove date-math hallucination from the LLM ("next
 * Tuesday" off by one). All math is anchored to the requester's
 * timezone via Intl.DateTimeFormat.
 *
 * The function takes an optional `now: Date` arg so tests can pin
 * the reference instant deterministically.
 */

import { describe, it, expect } from 'vitest';
import { resolveDatePhrases } from '../../src/core/identity/date-resolver';

const ET = 'America/New_York';

// Reference instants used across the tests. All are anchored at noon
// UTC (so they fall on a single day in ET regardless of DST).
const FRI_MAY_8_2026  = new Date('2026-05-08T17:00:00Z'); // Fri 13:00 ET
const TUE_MAY_12_2026 = new Date('2026-05-12T17:00:00Z'); // Tue 13:00 ET
const WED_MAY_13_2026 = new Date('2026-05-13T17:00:00Z'); // Wed 13:00 ET

describe('date-resolver — weekday phrases', () => {
  it('"next tuesday" on Fri May 8 2026 ET → 2026-05-12', () => {
    const { rewritten, replacements } = resolveDatePhrases(
      'schedule a meeting with Kevin next Tuesday',
      ET,
      FRI_MAY_8_2026,
    );
    expect(rewritten).toContain('[date: 2026-05-12]');
    expect(replacements.some(r => r.resolved === '[date: 2026-05-12]')).toBe(true);
  });

  it('bare "tuesday" on Fri May 8 2026 → 2026-05-12 (next future Tuesday)', () => {
    const { rewritten } = resolveDatePhrases('meeting Tuesday at 3pm', ET, FRI_MAY_8_2026);
    expect(rewritten).toContain('[date: 2026-05-12]');
  });

  it('"tuesday" on Tuesday → today (May 12)', () => {
    const { rewritten } = resolveDatePhrases('lunch Tuesday', ET, TUE_MAY_12_2026);
    expect(rewritten).toContain('[date: 2026-05-12]');
  });

  it('"tuesday" on Wednesday → 6 days later (May 19)', () => {
    const { rewritten } = resolveDatePhrases('lunch Tuesday', ET, WED_MAY_13_2026);
    expect(rewritten).toContain('[date: 2026-05-19]');
  });

  it('"this coming monday" on Fri May 8 → upcoming Monday (May 11)', () => {
    const { rewritten } = resolveDatePhrases(
      'follow up this coming Monday',
      ET,
      FRI_MAY_8_2026,
    );
    expect(rewritten).toContain('[date: 2026-05-11]');
  });

  it('"monday next week" on Fri May 8 → +7 from upcoming Monday (May 18)', () => {
    const { rewritten } = resolveDatePhrases('demo monday next week', ET, FRI_MAY_8_2026);
    expect(rewritten).toContain('[date: 2026-05-18]');
  });

  it('"next week\'s monday" on Fri May 8 → May 18', () => {
    const { rewritten } = resolveDatePhrases("next week's monday lunch", ET, FRI_MAY_8_2026);
    expect(rewritten).toContain('[date: 2026-05-18]');
  });

  it('"by friday" preserves the "by" prefix and resolves the deadline', () => {
    const { rewritten } = resolveDatePhrases(
      'have Sagar finish the deck by Friday',
      ET,
      FRI_MAY_8_2026,
    );
    // Today (Fri May 8) is Friday, so by-friday includes today
    expect(rewritten).toMatch(/by \[date: 2026-05-08\]/);
  });
});

describe('date-resolver — weekday + ordinal combos', () => {
  it('"wednesday the 23rd" on Fri May 8 2026 → 2026-09-23 (next Wed-23)', () => {
    const { rewritten } = resolveDatePhrases(
      'block Wednesday the 23rd',
      ET,
      FRI_MAY_8_2026,
    );
    // May 23 = Sat, Jun 23 = Tue, Jul 23 = Thu, Aug 23 = Sun, Sep 23 = Wed
    expect(rewritten).toContain('[date: 2026-09-23]');
  });

  it('"tuesday the 12th" on Fri May 8 2026 → 2026-05-12 (Tue)', () => {
    const { rewritten } = resolveDatePhrases('Tuesday the 12th', ET, FRI_MAY_8_2026);
    expect(rewritten).toContain('[date: 2026-05-12]');
  });

  it('does NOT also resolve the bare weekday inside "wednesday the 23rd"', () => {
    const { replacements } = resolveDatePhrases(
      'Wednesday the 23rd',
      ET,
      FRI_MAY_8_2026,
    );
    // Exactly one replacement, not two
    expect(replacements).toHaveLength(1);
    expect(replacements[0].resolved).toBe('[date: 2026-09-23]');
  });
});

describe('date-resolver — month/day forms', () => {
  it('"the 23rd" on May 8 2026 → 2026-05-23 (this month\'s upcoming 23rd)', () => {
    const { rewritten } = resolveDatePhrases('reminder the 23rd', ET, FRI_MAY_8_2026);
    expect(rewritten).toContain('[date: 2026-05-23]');
  });

  it('"the 5th" on May 8 2026 → 2026-06-05 (this month\'s 5th already passed)', () => {
    const { rewritten } = resolveDatePhrases('block the 5th', ET, FRI_MAY_8_2026);
    expect(rewritten).toContain('[date: 2026-06-05]');
  });

  it('"may 13" on May 8 2026 → 2026-05-13 (this year, future)', () => {
    const { rewritten } = resolveDatePhrases('may 13 demo', ET, FRI_MAY_8_2026);
    expect(rewritten).toContain('[date: 2026-05-13]');
  });

  it('"may 13 2027" with explicit year → 2027-05-13', () => {
    const { rewritten } = resolveDatePhrases('may 13 2027 plan', ET, FRI_MAY_8_2026);
    expect(rewritten).toContain('[date: 2027-05-13]');
  });

  it('"13 may" → 2026-05-13', () => {
    const { rewritten } = resolveDatePhrases('on 13 may', ET, FRI_MAY_8_2026);
    expect(rewritten).toContain('[date: 2026-05-13]');
  });
});

describe('date-resolver — relative day words', () => {
  it('"tomorrow at 3pm" on Fri May 8 → date 2026-05-09 + time 15:00', () => {
    const { rewritten } = resolveDatePhrases('tomorrow at 3pm', ET, FRI_MAY_8_2026);
    expect(rewritten).toContain('[date: 2026-05-09]');
    expect(rewritten).toContain('[time: 15:00]');
  });

  it('"9:05pm tonight" → today\'s date + [time: 21:05]', () => {
    const { rewritten } = resolveDatePhrases('text John 9:05pm tonight', ET, FRI_MAY_8_2026);
    expect(rewritten).toContain('[date: 2026-05-08]');
    expect(rewritten).toContain('[time: 21:05]');
  });

  it('"yesterday" → today - 1 day', () => {
    const { rewritten } = resolveDatePhrases('logged yesterday', ET, FRI_MAY_8_2026);
    expect(rewritten).toContain('[date: 2026-05-07]');
  });

  it('UTC at 3am the next day still resolves "today" to ET\'s today', () => {
    // 2026-05-09 03:00 UTC = 2026-05-08 23:00 ET (Friday night)
    const lateFridayUtc = new Date('2026-05-09T03:00:00Z');
    const { rewritten } = resolveDatePhrases('do this today', ET, lateFridayUtc);
    expect(rewritten).toContain('[date: 2026-05-08]');
  });
});

describe('date-resolver — time formats', () => {
  it('"noon" → [time: 12:00]', () => {
    const { rewritten } = resolveDatePhrases('lunch at noon', ET, FRI_MAY_8_2026);
    expect(rewritten).toContain('[time: 12:00]');
  });

  it('"midnight" → [time: 00:00]', () => {
    const { rewritten } = resolveDatePhrases('cron at midnight', ET, FRI_MAY_8_2026);
    expect(rewritten).toContain('[time: 00:00]');
  });

  it('"3pm est" strips the TZ abbreviation', () => {
    const { rewritten } = resolveDatePhrases('call at 3pm est', ET, FRI_MAY_8_2026);
    expect(rewritten).toContain('[time: 15:00]');
    expect(rewritten).not.toMatch(/est/i);
  });

  it('"11:45am" → [time: 11:45]', () => {
    const { rewritten } = resolveDatePhrases('sync 11:45am', ET, FRI_MAY_8_2026);
    expect(rewritten).toContain('[time: 11:45]');
  });

  it('24h format "15:00" passes through as [time: 15:00]', () => {
    const { rewritten } = resolveDatePhrases('block 15:00', ET, FRI_MAY_8_2026);
    expect(rewritten).toContain('[time: 15:00]');
  });

  it('"12pm" → [time: 12:00], "12am" → [time: 00:00]', () => {
    expect(
      resolveDatePhrases('at 12pm', ET, FRI_MAY_8_2026).rewritten,
    ).toContain('[time: 12:00]');
    expect(
      resolveDatePhrases('at 12am', ET, FRI_MAY_8_2026).rewritten,
    ).toContain('[time: 00:00]');
  });
});

describe('date-resolver — pass-through and safety', () => {
  it('preserves text that has no date/time phrases', () => {
    const { rewritten, replacements } = resolveDatePhrases(
      'add Kyle from Exa to partnerships',
      ET,
      FRI_MAY_8_2026,
    );
    expect(rewritten).toBe('add Kyle from Exa to partnerships');
    expect(replacements).toHaveLength(0);
  });

  it('does not match weekdays inside other words', () => {
    const { rewritten } = resolveDatePhrases(
      'fridayitis is not a real condition',
      ET,
      FRI_MAY_8_2026,
    );
    expect(rewritten).toBe('fridayitis is not a real condition');
  });

  it('skips numeric slash dates ("5/13" — out of scope)', () => {
    const { rewritten } = resolveDatePhrases('on 5/13 we meet', ET, FRI_MAY_8_2026);
    expect(rewritten).toBe('on 5/13 we meet');
  });
});
