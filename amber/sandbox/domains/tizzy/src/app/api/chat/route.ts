import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { demoData } from '@/components/shared/demoData';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── Compute live context from demoData ──────────────────────────────────────
function buildCoachContext() {
  const { user, sessions, weeklyStats } = demoData;

  const joinDate = new Date(user.joinDate);
  const latestSessionDate = new Date(sessions[0].date);
  const weeksActive = Math.max(1, Math.floor(
    (latestSessionDate.getTime() - joinDate.getTime()) / (7 * 24 * 60 * 60 * 1000)
  ));

  // Avg metrics over last 5 sessions
  const last5 = sessions.slice(0, 5);
  const avg = (key: keyof typeof sessions[0]['metrics']) =>
    Math.round(last5.reduce((s, sess) => s + sess.metrics[key], 0) / last5.length);

  const avgMetrics = {
    speechClarity: avg('speechClarity'),
    paceConsistency: avg('paceConsistency'),
    vocalVariety: avg('vocalVariety'),
    turnTaking: avg('turnTaking'),
  };

  const metricLabels: Record<string, string> = {
    speechClarity: 'Vocal Clarity',
    paceConsistency: 'Speaking Pace',
    vocalVariety: 'Vocal Range',
    turnTaking: 'Conversational Flow',
  };

  const sorted = Object.entries(avgMetrics).sort((a, b) => b[1] - a[1]);
  const bestSkill = { key: sorted[0][0], label: metricLabels[sorted[0][0]], val: sorted[0][1] };
  const focusArea = { key: sorted[sorted.length - 1][0], label: metricLabels[sorted[sorted.length - 1][0]], val: sorted[sorted.length - 1][1] };

  // Best single session (highest avg score)
  const bestSession = [...sessions].sort((a, b) => {
    const scoreA = Object.values(a.metrics).reduce((s, v) => s + v, 0) / 4;
    const scoreB = Object.values(b.metrics).reduce((s, v) => s + v, 0) / 4;
    return scoreB - scoreA;
  })[0];
  const bestSessionScore = Math.round(Object.values(bestSession.metrics).reduce((s, v) => s + v, 0) / 4);
  const bestSessionDate = new Date(bestSession.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  const hoursCoached = Math.round((user.totalMinutesCoached ?? 0) / 60);
  const firstName = user.name.split(' ')[0];

  return {
    firstName,
    weeksActive,
    totalSessions: user.totalSessions ?? sessions.length,
    sessionsThisWeek: weeklyStats.sessionsThisWeek,
    weeklyGoal: weeklyStats.weeklyGoal,
    minutesThisWeek: weeklyStats.minutesThisWeek ?? weeklyStats.totalMinutes,
    currentStreak: user.currentStreak,
    longestStreak: user.longestStreak ?? user.currentStreak,
    hoursCoached,
    avgMetrics,
    bestSkill,
    focusArea,
    bestSessionScore,
    bestSessionDate,
    bestSessionEnv: bestSession.environment,
  };
}

function buildSystemPrompt(): string {
  const c = buildCoachContext();
  return `You are Tizzy's AI conversation coach: warm, direct, and grounded in the user's real data.

Tizzy is a wearable pendant that provides real-time haptic feedback to help people improve social communication skills.

Current user context:
- User: ${c.firstName}, ${c.weeksActive} weeks active, ${c.totalSessions} total sessions
- This week: ${c.sessionsThisWeek} of ${c.weeklyGoal} sessions, ${c.minutesThisWeek} minutes coached
- Current streak: ${c.currentStreak} days (longest ever: ${c.longestStreak} days)
- All-time: ${c.hoursCoached} hours coached across ${c.totalSessions} sessions
- Recent avg metrics (last 5 sessions): Vocal Clarity ${c.avgMetrics.speechClarity}%, Speaking Pace ${c.avgMetrics.paceConsistency}%, Vocal Range ${c.avgMetrics.vocalVariety}%, Conversational Flow ${c.avgMetrics.turnTaking}%
- Best skill: ${c.bestSkill.label} (${c.bestSkill.val}%, highest recent metric)
- Primary focus area: ${c.focusArea.label} (${c.focusArea.val}%, biggest lever for growth)
- Best ever session: ${bestSessionScore(c)}% avg (${c.bestSessionEnv}, ${c.bestSessionDate})

Coaching philosophy:
- Be specific and actionable. Always reference their actual numbers.
- Keep responses to 2-4 sentences max. Dense, useful, no filler.
- Be encouraging without being hollow. Reference specific progress.
- Never use emojis. Never say "great question."
- Treat the user as a capable adult making real progress.
- When asked for a tip, give one concrete micro-action they can try today.
- Reference that Tizzy passively captures conversations throughout the day — the data comes from passive pendant recording, not just coached sessions.

Common topics to address:
- Conversational Flow: counting strategy, eye contact, waiting for the full pause
- Speaking Pace: the "10% slower" rule, breathing anchor, post-excitement recalibration
- Vocal Clarity: projecting slightly, consonant crispness, sentence completion
- Vocal Range: pitch variation on questions, energy matching, emphasis
- Streaks: habit formation, what the data shows about consistent practice
- Social anxiety: grounding before speaking, the "plant and face" technique`;
}

function bestSessionScore(c: ReturnType<typeof buildCoachContext>) {
  return c.bestSessionScore;
}

// ── Smart fallback bank (built from live demoData) ──────────────────────────
function buildFallbackBank() {
  const c = buildCoachContext();
  return [
    {
      keys: ['turn', 'listen', 'interrupt', 'space', 'wait', 'respond', 'flow', 'conversational'],
      content: `Your Conversational Flow is at ${c.avgMetrics.turnTaking}%, your current growth edge. The research-backed technique: after someone finishes, count silently to 2 before responding. This deliberate pause trains your nervous system to default to attentive responses rather than reactive ones.`,
    },
    {
      keys: ['pace', 'slow', 'fast', 'speed', 'rush', 'hurry', 'quick'],
      content: `Your Speaking Pace score of ${c.avgMetrics.paceConsistency}% reflects WPM variance — you accelerate on familiar topics. The fix: anchor your breath. Take one measured breath before responding on topics you know well. It physically slows your onset speed.`,
    },
    {
      keys: ['streak', 'habit', 'consistent', 'practice', 'daily', 'keep'],
      content: `${c.currentStreak} days in a row is real momentum — your longest streak is ${c.longestStreak} days, which means you know you can sustain this. Your baseline metrics improve roughly 4% per consistent week. Even a 10-minute capture counts.`,
    },
    {
      keys: ['vocal', 'range', 'tone', 'voice', 'pitch', 'flat', 'monotone', 'variety'],
      content: `Vocal Range is at ${c.avgMetrics.vocalVariety}% in your recent captures${c.bestSkill.key === 'vocalVariety' ? " and it's your strongest metric" : ''}. To push it further: let your pitch rise at the end of questions. It sounds natural and signals genuine curiosity.`,
    },
    {
      keys: ['clarity', 'clear', 'understand', 'heard', 'crisp', 'vocal clarity'],
      content: `You hit ${c.bestSessionScore}% in your best capture (${c.bestSessionEnv}, ${c.bestSessionDate}). Recent Vocal Clarity avg is ${c.avgMetrics.speechClarity}%. To keep it high: finish your sentences completely before pausing. Trailing off mid-thought is the most common clarity drop and it's fully fixable.`,
    },
    {
      keys: ['social', 'event', 'party', 'crowd', 'stranger', 'new people', 'nervous'],
      content: `Noisy environments will hit your Vocal Clarity score — that's expected. With ${c.totalSessions} captures under your belt, you have real reps to draw on. In loud settings: plant your feet, face the person directly, and speak about 15% louder than feels necessary.`,
    },
    {
      keys: ['session', 'record', 'start', 'today', 'tip', 'help', 'advice', 'what should'],
      content: `For today's captures, focus on one thing: the pause. After someone finishes speaking, don't jump in immediately. Let 1.5 seconds pass. Your ${c.focusArea.label.toLowerCase()} score will jump, and it'll feel natural within 20 minutes of practice.`,
    },
    {
      keys: ['hi', 'hello', 'hey', 'what', 'how', 'progress', 'doing'],
      content: `You're ${c.weeksActive} weeks in with a ${c.currentStreak}-day streak and ${c.totalSessions} total captures. Recent metrics: ${c.bestSkill.label} ${c.bestSkill.val}% (your strength), ${c.focusArea.label} ${c.focusArea.val}% (your growth edge). What do you want to work on today?`,
    },
  ];
}

function pickFallback(messages: { role: string; content: string }[]): string {
  const lastUser = messages.filter(m => m.role === 'user').pop()?.content?.toLowerCase() ?? '';
  const bank = buildFallbackBank();
  let best = bank[bank.length - 1];
  let bestScore = 0;
  for (const entry of bank) {
    const score = entry.keys.filter(k => lastUser.includes(k)).length;
    if (score > bestScore) {
      bestScore = score;
      best = entry;
    }
  }
  return best.content;
}

export async function POST(req: NextRequest) {
  const { messages } = await req.json();
  const apiMessages = (messages as { role: string; content: string }[]).map(m => ({
    role: m.role as 'user' | 'assistant',
    content: m.content,
  }));

  const SYSTEM_PROMPT = buildSystemPrompt();

  try {
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 200,
      temperature: 0.7,
      system: SYSTEM_PROMPT,
      messages: apiMessages,
    }, { signal: AbortSignal.timeout(15000) });

    const content = message.content[0].type === 'text'
      ? message.content[0].text
      : null;

    if (content) return NextResponse.json({ content });
  } catch {
    // fall through to static fallbacks
  }

  // Smart keyword-routed static fallbacks (always match current demoData)
  return NextResponse.json({ content: pickFallback(messages) });
}
