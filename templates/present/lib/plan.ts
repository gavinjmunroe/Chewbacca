import { COLD, QA, CHAIN } from "@/lib/drill";
import { ORDER } from "@/lib/beats";

// The morning block, 6:30 to 8:00 at full length, as a plan rather than a page of advice.
//
// The design rule the whole thing is built on: rehearsal that feels like
// studying does not work. Re-reading a script is the thing that feels like
// preparation and changes nothing, because recognising a sentence is not the
// same as producing it. Every phase below is retrieval first: say it, THEN
// look. The script is a check, never the prompt.
//
// The other rule is full runs over fragments. Transitions between scenes are
// where a talk actually falls apart, and practising scene 4 twenty times never
// rehearses the seam into scene 5. So three complete runs, each with less on
// screen than the last, with repair rounds in between aimed only at what
// actually broke.
//
// Durations are minutes and they sum to 75. If he starts late the page scales
// them rather than silently running past the end, because the lab is at 10:00 and
// the rest of the morning is already spoken for.

export type Phase = {
  key: string;
  kind: "chain" | "cold" | "run" | "fix" | "qa" | "bookend" | "wrap";
  title: string;
  why: string;
  min: number;
  /** what is allowed on screen during this phase, said plainly */
  aid: string;
};

export const PLAN: Phase[] = [
  {
    key: "chain",
    kind: "chain",
    title: "The whole thing, once",
    why: "Every card is the real figure from your talk, frozen at that moment, with one line and any new word explained. You cannot recall something you never understood, so this comes before the drilling.",
    min: 5,
    aid: "Read it. Nothing to say yet.",
  },
  {
    key: "cold",
    kind: "cold",
    title: "Nine facts, out loud",
    why: 'Understanding of Topic is 4 points and the wording is "in own words". Say each one before you look.',
    min: 4,
    aid: "Nothing. Say it, then reveal.",
  },
  {
    key: "run1",
    kind: "run",
    title: "Run one, script allowed",
    why: "A full run, not scenes. The seams between scenes are where talks break.",
    min: 12,
    aid: "The notes window, full script.",
  },
  {
    key: "fix1",
    kind: "fix",
    title: "Repair what broke",
    why: "Only the scenes you had to read. Say each one again with the script, then once without.",
    min: 8,
    aid: "The script for those scenes only.",
  },
  {
    key: "run2",
    kind: "run",
    title: "Run two, cues only",
    why: "Same run, script hidden. This is the first rep that proves anything.",
    min: 12,
    aid: "Cue words only. No sentences.",
  },
  {
    key: "qa",
    kind: "qa",
    title: "Questions, cold and shuffled",
    why: "Response to Questions is a point, and the order in the room will not be the order on the page.",
    min: 10,
    aid: "The question. Answer out loud, then check.",
  },
  {
    key: "fix2",
    kind: "fix",
    title: "Second repair",
    why: "Whatever broke in run two. Shorter than the first repair on purpose.",
    min: 8,
    aid: "The script for those scenes only.",
  },
  {
    key: "run3",
    kind: "run",
    title: "Run three, the real thing",
    why: "Nothing but the talk window. If this one lands you are done.",
    min: 12,
    aid: "Nothing. Share-the-window conditions.",
  },
  {
    key: "bookend",
    kind: "bookend",
    title: "Open and close, three times each",
    why: "Nerves hit hardest in the first thirty seconds and the last. These two are worth owning word for word.",
    min: 5,
    aid: "The two blocks, then hidden.",
  },
  {
    key: "wrap",
    kind: "wrap",
    title: "Pack and go",
    why: "The points you can lose before you say a word.",
    min: 4,
    aid: "",
  },
];

export const TOTAL_MIN = PLAN.reduce((a, p) => a + p.min, 0);

/**
 * The block finishes here. 9:58 is not about the talk, which is at 10:00: the
 * morning after it is already committed, so a block that runs long eats
 * something else rather than the walk to ZHS. The page states the time and
 * not a reason, because what comes next on a given morning is his to know
 * and a page that names the wrong commitment is worse than one that names
 * none.
 */
export const END = { h: 9, m: 58 };

export function minutesUntilEnd(now: Date): number {
  const end = new Date(now);
  end.setHours(END.h, END.m, 0, 0);
  return Math.round((end.getTime() - now.getTime()) / 60000);
}

/**
 * The plan sized for the time he actually has.
 *
 * A block written for 6:30 that silently runs to 8:05 when he starts at 6:50
 * is worse than no plan, because the thing it eats is the walk to ZHS. So a
 * late start shortens every round rather than pushing the end, and the floor
 * is two minutes so a squeezed phase is still a phase and not a flash.
 *
 * Below about 30 minutes the shape stops being three runs plus repairs, so
 * `short` says so and the page offers the one run that still fits.
 */
export function sized(now: Date): {
  plan: Phase[];
  total: number;
  have: number;
  short: boolean;
} {
  const have = minutesUntilEnd(now);
  if (have >= TOTAL_MIN)
    return { plan: PLAN, total: TOTAL_MIN, have, short: false };
  // Past the end the first version fell into the branch above and handed back the
  // full 75-minute plan, which is the exact lie this function exists to stop:
  // at 7:50 it told him he had the whole block. Past the end everything sits
  // at the floor and the rescue round is offered, because by then the minutes
  // are coming out of the walk to ZHS.
  if (have <= 0) {
    const floor = PLAN.map((p) => ({ ...p, min: 2 }));
    return { plan: floor, total: floor.length * 2, have, short: true };
  }
  // The two-minute floor can push the sum back above the time he has: at 7:20
  // the rounds totalled 27 while the box underneath said 25 left, which is
  // the page promising more than the clock allows. So once everything is at
  // its floor, rounds come off the end of this order until it fits. Nothing
  // here touches run two, the questions or run three, which are the rounds
  // that actually change how the talk goes.
  const SACRIFICE = ["fix2", "run1", "bookend", "fix1"];
  const scale = have / TOTAL_MIN;
  // The chain gets a four-minute floor while everything else gets two. At a
  // 7:45 start the even floor gave it 2:00 for thirteen cards, about nine
  // seconds each, and this is the one round where reading takes what it takes.
  // Squeezing the understanding to buy another minute of drilling is backwards.
  let plan = PLAN.map((p) => ({
    ...p,
    min: Math.max(p.key === "chain" ? 4 : 2, Math.round(p.min * scale)),
  }));
  const sum = (ps: Phase[]) => ps.reduce((a, p) => a + p.min, 0);
  for (const key of SACRIFICE) {
    if (sum(plan) <= have) break;
    plan = plan.filter((p) => p.key !== key);
  }
  return { plan, total: sum(plan), have, short: have < 30 };
}

/**
 * When there is almost no time: the rounds that still earn their minutes.
 *
 * Rewritten 2026-11-06 at 9:26, when he said "im literally gonna hv to learn
 * the stuff from 9:45to 9:58". Thirteen minutes does not rehearse anything, so
 * the old rescue, which was a run and the questions, was the wrong three
 * things entirely. In thirteen minutes the only goal is understanding the
 * figures well enough to talk off them, so it is the chain, the nine facts,
 * and the pack-and-go list.
 */
export const RESCUE = ["chain", "cold", "wrap"];

/** Share of a rescue block each round gets. The chain is most of it. */
const RESCUE_SHARE: Record<string, number> = { chain: 0.62, cold: 0.3, wrap: 0.08 };

/** The rescue rounds, scaled to fill the minutes he actually has. */
export function rescue(now: Date): Phase[] {
  const have = Math.max(6, minutesUntilEnd(now));
  const picked = PLAN.filter((p) => RESCUE.includes(p.key));
  return picked.map((p) => ({
    ...p,
    min: Math.max(1, Math.round(have * (RESCUE_SHARE[p.key] ?? 1 / picked.length))),
  }));
}

/** The scenes a repair round can target, in talk order. */
export const SCENES = ORDER as string[];

export const COLD_CARDS = COLD;
export const CHAIN_CARDS = CHAIN;
export const QA_CARDS = QA;
