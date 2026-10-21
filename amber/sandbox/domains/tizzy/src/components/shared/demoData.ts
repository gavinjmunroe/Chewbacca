/**
 * demoData.ts
 *
 * Programmatically generates ~2000 sessions spanning 2025-01-08 to 2026-02-23,
 * then derives all summary statistics from the generated array. No static session
 * array; no Math.random() — all pseudo-randomness is seeded and deterministic.
 */

import { DemoData, Session, WeeklyHistoryEntry } from './types';

// ─────────────────────────────────────────────────────────────────────────────
// 1. Static content pools
// ─────────────────────────────────────────────────────────────────────────────

const ENVIRONMENTS = [
  'Study Group', 'Class Discussion', 'Team Meeting', 'Coffee Chat',
  'Phone Call', 'Lunch Conversation', 'Dorm Room Chat', 'Library Study',
  'Seminar', 'Office Hours', 'Club Meeting', 'Job Interview Prep',
  'Friend Meetup', 'Dinner Conversation', 'Lab Partner Chat',
  'Tutoring Session', 'Campus Event', 'Group Project', 'Zoom Call',
  'Gym Chat', 'Commute Call', 'Morning Standup', 'Networking Event',
  'Study Hall', 'Coffee Shop Chat', 'TA Session', 'Research Meeting',
];

const WHAT_WENT_WELL_POOL = [
  'Maintained consistent speaking pace throughout',
  'Strong turn-taking rhythm with minimal interruptions',
  'Vocal range was expressive and engaging',
  'Clear articulation and projection throughout',
  'Good recovery after awkward pauses',
  'Asked effective follow-up questions',
  'Matched energy level of conversation partner',
  'Initiated topic changes smoothly',
  'Held eye contact during key moments',
  'Projected confidence with steady volume',
  'Finished sentences cleanly without trailing off',
  'Paused meaningfully before complex responses',
  'Showed active listening with brief affirmations',
  'Kept pace relaxed even on familiar topics',
];

const AREAS_FOR_GROWTH_POOL = [
  'Speaking pace spiked on familiar topics',
  'A few trailing sentences reduced clarity',
  'Vocal tone stayed flat during technical explanations',
  'Response timing was slightly rushed in first half',
  'Interrupted twice — both times in moments of excitement',
  'Vocal range dropped during longer explanations',
  'Pace accelerated noticeably when nervous',
  'A few filler sounds (uh, um) clustered near the start',
  'Could project more on complex vocabulary words',
];

const MICRO_GOAL_POOL: Array<{
  text: string;
  description: string;
  difficulty: 'easy' | 'medium' | 'hard';
}> = [
  {
    text: 'Pause before answering questions',
    description: 'Before you reply, take one silent breath and count to 2. Signals confidence.',
    difficulty: 'easy',
  },
  {
    text: 'Let your voice lift at the end of questions',
    description: 'When asking a question, let your pitch rise slightly. Invites elaboration.',
    difficulty: 'medium',
  },
  {
    text: 'Finish every sentence completely',
    description: 'No trailing off. Complete the thought, then pause. Most common clarity drop.',
    difficulty: 'easy',
  },
  {
    text: 'Speak 10% slower on familiar topics',
    description: 'When you know the material well, slow down deliberately. Expertise shows in content, not speed.',
    difficulty: 'medium',
  },
  {
    text: 'Match the energy of the room',
    description: 'Mirror the conversational energy of others before adding your own. Creates connection.',
    difficulty: 'hard',
  },
  {
    text: 'Vary pitch on emphasis words',
    description: 'Pick the key word in each sentence and let your pitch rise slightly on it.',
    difficulty: 'medium',
  },
  {
    text: 'Count to 1.5 before responding',
    description: 'One-and-a-half seconds of deliberate pause before responding. Builds conversational flow.',
    difficulty: 'easy',
  },
  {
    text: 'Project toward the far wall',
    description: 'Imagine speaking to someone 10ft behind your conversation partner. Improves projection without shouting.',
    difficulty: 'medium',
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// 2. Deterministic pseudo-random helpers (no Math.random())
// ─────────────────────────────────────────────────────────────────────────────

/** Seeded pseudo-random in [0, 1). Same seed always returns same value. */
function seededRand(seed: number): number {
  const x = Math.sin(seed + 1) * 10000;
  return x - Math.floor(x);
}

/** Pick one element from arr using a seeded index. */
function pick<T>(arr: T[], seed: number): T {
  return arr[Math.floor(seededRand(seed) * arr.length)];
}

/** Pick n distinct elements from arr using successive seeds. */
function pickN<T>(arr: T[], n: number, seed: number): T[] {
  const result: T[] = [];
  const used = new Set<number>();
  for (let i = 0; i < n && result.length < arr.length; i++) {
    let idx = Math.floor(seededRand(seed + i * 7) * arr.length);
    while (used.has(idx)) idx = (idx + 1) % arr.length;
    used.add(idx);
    result.push(arr[idx]);
  }
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Session generator
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns an S-curve progress value between 0 and 1 given a fractional
 * position along the timeline. Skill growth is slow at first, fast in the
 * middle, and tapers off as habits solidify.
 */
function sCurveProgress(pct: number): number {
  if (pct < 0.3) return pct * 1.2;
  if (pct < 0.7) return 0.36 + (pct - 0.3) * 1.6;
  return 1.0 - (1.0 - pct) * 0.5;
}

/**
 * Returns the expected base metric score for a given day index.
 * Range: 42 (day 0) → 82 (day totalDays).
 */
function baseProgress(dayIndex: number, totalDays: number): number {
  const pct = dayIndex / totalDays;
  return 42 + sCurveProgress(pct) * 40;
}

function generateSessions(): Session[] {
  const sessions: Session[] = [];

  const startDate = new Date('2025-01-08T08:00:00');
  const endDate   = new Date('2026-02-23T23:00:00');
  const totalDays = Math.floor(
    (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)
  );

  let sessionIndex = 0;

  for (let day = 0; day <= totalDays; day++) {
    const date = new Date(startDate);
    date.setDate(date.getDate() + day);

    // Sessions per day: ramps from ~3 early to ~6 later as habit forms
    const dayRamp = Math.min(1, day / 90);
    const baseSessions = 3 + Math.floor(dayRamp * 4);
    const noisySessions =
      baseSessions + Math.floor(seededRand(day * 13 + 7) * 3) - 1;
    const sessionsToday = Math.max(2, Math.min(9, noisySessions));

    // Baseline metric score for this day
    const dayBase = baseProgress(day, totalDays);

    for (let s = 0; s < sessionsToday; s++) {
      const seed = day * 100 + s;

      // Per-session noise on top of the daily baseline
      const sessionNoise = (seededRand(seed) - 0.5) * 16; // ±8 points
      const sessionBase = Math.max(28, Math.min(97, dayBase + sessionNoise));

      // Four metrics evolve at slightly different rates
      const clarity = Math.round(
        Math.max(25, Math.min(98, sessionBase + (seededRand(seed + 1) - 0.5) * 12))
      );
      const pace = Math.round(
        Math.max(25, Math.min(98, sessionBase + (seededRand(seed + 2) - 0.5) * 12))
      );
      const range = Math.round(
        Math.max(25, Math.min(98, sessionBase + (seededRand(seed + 3) - 0.5) * 10))
      );
      // Conversational flow is the lagging metric — kept slightly lower
      const flow = Math.round(
        Math.max(25, Math.min(98, sessionBase - 4 + (seededRand(seed + 4) - 0.5) * 14))
      );

      // Distribute sessions from 8 am to 10 pm across the day
      const hourStart = 8;
      const hourEnd   = 22;
      const hour   = hourStart + Math.floor((s / sessionsToday) * (hourEnd - hourStart));
      const minute = Math.floor(seededRand(seed + 5) * 60);

      const sessionDate = new Date(date);
      sessionDate.setHours(hour, minute, 0, 0);

      // Duration: 8–32 minutes, weighted toward 12–20
      const duration = 8 + Math.floor(seededRand(seed + 6) * 25);

      const env           = pick(ENVIRONMENTS, seed + 7);
      const wellItems     = pickN(WHAT_WENT_WELL_POOL, 2, seed + 8);
      const growthItems   = pickN(AREAS_FOR_GROWTH_POOL, 2, seed + 9);
      const microGoalTmpl = pick(MICRO_GOAL_POOL, seed + 10);
      const microGoalPct  = Math.round(seededRand(seed + 11) * 80 + 10); // 10–90 %

      const avgScore = Math.round((clarity + pace + range + flow) / 4);

      // Only mark a handful of milestone sessions as favorites
      const isFavorite =
        avgScore >= 88 && seededRand(seed + 12) < 0.15 ? true : undefined;

      sessions.push({
        id: String(sessionIndex + 1),
        date: sessionDate.toISOString(),
        duration,
        environment: env,
        favorite: isFavorite,
        summary: `Tizzy captured this ${env.toLowerCase()} conversation. ${
          avgScore >= 80
            ? 'Strong session overall.'
            : avgScore >= 65
            ? 'Solid progress with room to grow.'
            : 'Early-stage session — consistent practice building habits.'
        }`,
        metrics: {
          speechClarity:   clarity,
          paceConsistency: pace,
          vocalVariety:    range,
          turnTaking:      flow,
        },
        insights: {
          whatWentWell:   wellItems,
          areasForGrowth: growthItems,
          microGoal: {
            ...microGoalTmpl,
            progress: microGoalPct,
          },
        },
      });

      sessionIndex++;
    }
  }

  // Return newest first so the UI default list view shows the most recent sessions
  return sessions.reverse();
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Derived statistics helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Group sessions by ISO week and return history array sorted oldest → newest. */
function computeWeeklyHistory(sessions: Session[]): WeeklyHistoryEntry[] {
  const weeks: Map<string, { sessions: Session[]; weekStart: Date }> = new Map();

  for (const sess of sessions) {
    const d   = new Date(sess.date);
    const day = d.getDay();
    // Shift to Monday of the same week
    const diff   = d.getDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(d);
    monday.setDate(diff);
    monday.setHours(0, 0, 0, 0);
    const key = monday.toISOString().slice(0, 10);

    if (!weeks.has(key)) weeks.set(key, { sessions: [], weekStart: monday });
    weeks.get(key)!.sessions.push(sess);
  }

  const sorted = Array.from(weeks.entries()).sort((a, b) =>
    a[0].localeCompare(b[0])
  );

  return sorted.map(([, { sessions: wSessions, weekStart }]) => {
    const avgScore = Math.round(
      wSessions.reduce((sum, s) => {
        return (
          sum +
          (s.metrics.speechClarity +
            s.metrics.paceConsistency +
            s.metrics.vocalVariety +
            s.metrics.turnTaking) /
            4
        );
      }, 0) / wSessions.length
    );
    const minutesCoached = wSessions.reduce((sum, s) => sum + s.duration, 0);
    const weekLabel = weekStart.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    });
    return {
      week: `Week of ${weekLabel}`,
      sessions: wSessions.length,
      avgScore,
      minutesCoached,
    };
  });
}

/** Sessions that fall within the week of Feb 17–23, 2026 (most recent full week). */
function getSessionsThisWeek(sessions: Session[]): Session[] {
  const weekStart = new Date('2026-02-17T00:00:00');
  const weekEnd   = new Date('2026-02-24T00:00:00');
  return sessions.filter(s => {
    const d = new Date(s.date);
    return d >= weekStart && d < weekEnd;
  });
}

/** Sessions that fall within the week of Feb 10–16, 2026. */
function getSessionsPreviousWeek(sessions: Session[]): Session[] {
  const weekStart = new Date('2026-02-10T00:00:00');
  const weekEnd   = new Date('2026-02-17T00:00:00');
  return sessions.filter(s => {
    const d = new Date(s.date);
    return d >= weekStart && d < weekEnd;
  });
}

type MetricSnapshot = {
  speechClarity: number;
  paceConsistency: number;
  vocalVariety: number;
  turnTaking: number;
};

/** Compute average of all four metrics across a session array. */
function avgMetrics(sessions: Session[]): MetricSnapshot {
  if (!sessions.length) {
    return { speechClarity: 0, paceConsistency: 0, vocalVariety: 0, turnTaking: 0 };
  }
  return {
    speechClarity:   Math.round(sessions.reduce((s, sess) => s + sess.metrics.speechClarity,   0) / sessions.length),
    paceConsistency: Math.round(sessions.reduce((s, sess) => s + sess.metrics.paceConsistency, 0) / sessions.length),
    vocalVariety:    Math.round(sessions.reduce((s, sess) => s + sess.metrics.vocalVariety,    0) / sessions.length),
    turnTaking:      Math.round(sessions.reduce((s, sess) => s + sess.metrics.turnTaking,      0) / sessions.length),
  };
}

const METRIC_LABELS: Record<keyof MetricSnapshot, string> = {
  speechClarity:   'Vocal Clarity',
  paceConsistency: 'Speaking Pace',
  vocalVariety:    'Vocal Range',
  turnTaking:      'Conversational Flow',
};

/** Returns the display label for the highest-scoring metric. */
function bestMetric(metrics: MetricSnapshot): string {
  const best = (Object.keys(metrics) as Array<keyof MetricSnapshot>).reduce(
    (a, b) => (metrics[b] > metrics[a] ? b : a)
  );
  return METRIC_LABELS[best];
}

/** Returns the display label for the lowest-scoring metric. */
function worstMetric(metrics: MetricSnapshot): string {
  const worst = (Object.keys(metrics) as Array<keyof MetricSnapshot>).reduce(
    (a, b) => (metrics[b] < metrics[a] ? b : a)
  );
  return METRIC_LABELS[worst];
}

/** Returns the id of the session with the highest average metric score. */
function findBestSession(sessions: Session[]): string {
  return sessions.reduce((best, s) => {
    const avgA =
      (best.metrics.speechClarity + best.metrics.paceConsistency +
        best.metrics.vocalVariety + best.metrics.turnTaking) / 4;
    const avgB =
      (s.metrics.speechClarity + s.metrics.paceConsistency +
        s.metrics.vocalVariety + s.metrics.turnTaking) / 4;
    return avgB > avgA ? s : best;
  }, sessions[0]).id;
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. Generate data and build the export (runs once at module load)
// ─────────────────────────────────────────────────────────────────────────────

const ALL_SESSIONS = generateSessions();

const THIS_WEEK  = getSessionsThisWeek(ALL_SESSIONS);
const PREV_WEEK  = getSessionsPreviousWeek(ALL_SESSIONS);

const THIS_WEEK_METRICS = avgMetrics(THIS_WEEK);
const PREV_WEEK_METRICS = avgMetrics(PREV_WEEK);

const TOTAL_MINUTES  = ALL_SESSIONS.reduce((sum, s) => sum + s.duration, 0);
const WEEKLY_HISTORY = computeWeeklyHistory(ALL_SESSIONS);

// ─────────────────────────────────────────────────────────────────────────────
// 6. Public utility — re-exported for convenience
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Formats an ISO date string into a human-readable short label,
 * e.g. "Feb 23" or "Today" / "Yesterday".
 */
export function formatDate(dateStr: string): string {
  const d     = new Date(dateStr);
  const today = new Date();
  const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);

  const normalize = (dt: Date) => {
    const n = new Date(dt);
    n.setHours(0, 0, 0, 0);
    return n.getTime();
  };

  const dn = normalize(d);
  if (dn === normalize(today))     return 'Today';
  if (dn === normalize(yesterday)) return 'Yesterday';

  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export const demoData: DemoData = {
  user: {
    name: 'Alex Chen',
    initials: 'AC',
    email: 'alex.chen@usc.edu',
    joinDate: '2025-01-08',
    currentStreak: 18,
    longestStreak: 31,
    totalMinutesCoached: TOTAL_MINUTES,
    totalSessions: ALL_SESSIONS.length,
    // Passive recorder goal: ~5 auto-captured conversations per day × 7 days
    weeklyGoal: 35,
  },
  device: {
    connected: true,
    battery: 87,
    status: 'ready',
  },
  sessions: ALL_SESSIONS,
  weeklyStats: {
    conversations:       THIS_WEEK.length,
    totalMinutes:        TOTAL_MINUTES,
    streak:              18,
    bestSkill:           bestMetric(THIS_WEEK_METRICS),
    focusArea:           worstMetric(THIS_WEEK_METRICS),
    sessionsThisWeek:    THIS_WEEK.length,
    weeklyGoal:          35,
    minutesThisWeek:     THIS_WEEK.reduce((sum, s) => sum + s.duration, 0),
    bestSession:         findBestSession(ALL_SESSIONS.slice(0, 50)),
    previousWeekMetrics: PREV_WEEK_METRICS,
    weeklyHistory:       WEEKLY_HISTORY,
  },
};
