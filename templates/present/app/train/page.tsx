"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SCRIPT, LABEL, ROWS, BEATS, CAMERA, GROUND, SLOT } from "@/lib/beats";
import { SCENES as DRAWINGS } from "@/lib/scenes";
import {
  PLAN,
  TOTAL_MIN,
  COLD_CARDS,
  CHAIN_CARDS,
  QA_CARDS,
  SCENES,
  RESCUE,
  rescue,
  sized,
  minutesUntilEnd,
  type Phase,
} from "@/lib/plan";

// The morning block, driven rather than listed.
//
// Stance: one-voltage. One accent on near-black, no gradient, no second
// colour, no shadow. What it refuses is the list: at 6:30 a page of nine
// numbered exercises is a page he reads instead of a thing he does, which is
// exactly the failure the whole block exists to avoid. So one phase fills the
// screen, the clock moves it on, and the only scrolling is inside a phase that
// genuinely has parts.
//
// It also refuses to grade him. Nothing here scores or congratulates. It
// records which scenes he had to read, and hands those back as the next
// repair round, because that is the only output the next twenty minutes need.
//
// The run phases listen on the same BroadcastChannel the talk already posts
// to, so a run times itself from his real first and last click instead of
// asking him to work a stopwatch while speaking.

const CH = "talk";
const SAVE = "bisc-train-v2";
const LAST = ROWS.length - 1;

type Saved = {
  phase: number;
  startedAt: number | null;
  weak: string[];
  runs: number[];
  /** Phase keys and minutes, fixed when he starts. The plan is sized to the
   *  time between the start and the end, and re-sizing it every tick would move
   *  the finish line under him as he worked. */
  keys: string[];
  mins: number[];
};
const BLANK: Saved = {
  phase: 0,
  startedAt: null,
  weak: [],
  runs: [],
  keys: [],
  mins: [],
};

function load(): Saved {
  if (typeof window === "undefined") return BLANK;
  try {
    const raw = window.localStorage.getItem(SAVE);
    if (!raw) return BLANK;
    const saved: Saved = { ...BLANK, ...JSON.parse(raw) };
    // A block he started before a phase existed names only the old phases, so
    // resuming it silently drops the new one. 2026-11-06: he had a run saved
    // from before the teaching round was added, and a reload put him straight
    // back on "Run one" with the chain unreachable from anywhere in the app.
    // Any saved plan that does not match today's phases starts over, which
    // costs one tap and never hides a round from him.
    const known = new Set(PLAN.map((p) => p.key));
    const fits =
      saved.keys.length > 0 &&
      saved.keys.length === saved.mins.length &&
      saved.keys.every((k) => known.has(k)) &&
      PLAN.filter((p) => saved.keys.includes(p.key)).length === saved.keys.length &&
      saved.keys[0] === PLAN[0].key;
    return fits ? saved : BLANK;
  } catch {
    return BLANK;
  }
}

const mmss = (s: number) =>
  `${Math.floor(Math.max(0, s) / 60)}:${String(Math.floor(Math.max(0, s) % 60)).padStart(2, "0")}`;

export default function Train() {
  const [s, setS] = useState<Saved>(BLANK);
  const [now, setNow] = useState(0);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setS(load());
    setNow(Date.now());
    setReady(true);
  }, []);
  useEffect(() => {
    if (!ready) return;
    try {
      window.localStorage.setItem(SAVE, JSON.stringify(s));
    } catch {}
  }, [s, ready]);
  useEffect(() => {
    const i = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(i);
  }, []);

  // The plan he actually started, not the one on paper.
  const plan: Phase[] = s.keys.length
    ? s.keys.map((k, i) => ({
        ...(PLAN.find((p) => p.key === k) as Phase),
        min: s.mins[i],
      }))
    : PLAN;
  const total = plan.reduce((a, p) => a + p.min, 0);
  const phase = plan[Math.min(s.phase, plan.length - 1)];
  const spent = plan.slice(0, s.phase).reduce((a, p) => a + p.min, 0);
  const phaseEnd = s.startedAt
    ? s.startedAt + (spent + phase.min) * 60000
    : null;
  const blockEnd = s.startedAt ? s.startedAt + total * 60000 : null;
  const leftInPhase = phaseEnd
    ? Math.round((phaseEnd - now) / 1000)
    : phase.min * 60;
  const leftInBlock = blockEnd
    ? Math.round((blockEnd - now) / 1000)
    : TOTAL_MIN * 60;

  const next = useCallback(
    (weak?: string[]) =>
      setS((p) => ({
        ...p,
        phase: Math.min(p.phase + 1, p.keys.length - 1),
        startedAt: p.startedAt ?? Date.now(),
        weak: weak ?? p.weak,
      })),
    [],
  );

  const start = (rescueMode = false) => {
    const now = new Date();
    const { plan: sp } = sized(now);
    const use = rescueMode ? rescue(now) : sp;
    setS({
      ...BLANK,
      phase: 0,
      startedAt: Date.now(),
      keys: use.map((p) => p.key),
      mins: use.map((p) => p.min),
    });
  };

  if (!ready)
    return (
      <main style={{ background: "var(--canvas)" }} className="h-screen" />
    );

  if (s.startedAt === null) return <Opening onStart={start} />;

  return (
    <main
      className="flex min-h-screen flex-col px-5 py-5 sm:px-8"
      style={{ background: "var(--canvas)", color: "var(--ink)" }}
    >
      <Header
        phase={s.phase}
        count={plan.length}
        total={total}
        title={phase.title}
        leftInPhase={leftInPhase}
        leftInBlock={leftInBlock}
      />

      <div className="mx-auto w-full max-w-[680px] flex-1 pb-10 pt-7">
        <h1 className="text-[34px] font-black leading-[1.05] tracking-tight sm:text-[42px]">
          {phase.title}
        </h1>
        <p
          className="mt-2.5 text-[16px] leading-snug"
          style={{ color: "var(--label)" }}
        >
          {phase.why}
        </p>
        {phase.aid && (
          <p
            className="mt-1.5 font-mono text-[13px]"
            style={{ color: "var(--ink-subtle)" }}
          >
            on screen: {phase.aid}
          </p>
        )}

        <div className="mt-7">
          {phase.kind === "chain" && <Chain onDone={() => next()} />}
          {phase.kind === "cold" && <Cold onDone={() => next()} />}
          {phase.kind === "run" && (
            <Run
              label={phase.title}
              onDone={(secs, weak) =>
                setS((p) => ({
                  ...p,
                  phase: p.phase + 1,
                  weak,
                  runs: [...p.runs, secs],
                }))
              }
            />
          )}
          {phase.kind === "fix" && (
            <Fix weak={s.weak} onDone={() => next([])} />
          )}
          {phase.kind === "qa" && <Quiz onDone={() => next()} />}
          {phase.kind === "bookend" && <Bookend onDone={() => next()} />}
          {phase.kind === "wrap" && <Wrap runs={s.runs} onReset={start} />}
        </div>
      </div>
    </main>
  );
}

/* ------------------------------------------------------------------ */

function Opening({ onStart }: { onStart: (rescueMode?: boolean) => void }) {
  // The clock is read once, on mount, so the opening screen does not
  // renumber itself while he is reading it.
  const [at] = useState(() => new Date());
  const { plan, total, have, short } = sized(at);
  const late = have < TOTAL_MIN;
  const clock = at.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
  const quick = rescue(at);
  const rescueMin = quick.reduce((a, p) => a + p.min, 0);

  return (
    <main
      className="flex min-h-screen flex-col justify-center px-6 py-10"
      style={{ background: "var(--canvas)", color: "var(--ink)" }}
    >
      <div className="mx-auto w-full max-w-[640px]">
        <p
          className="font-mono text-[12px] font-bold uppercase tracking-[0.18em]"
          style={{ color: "var(--accent-hover)" }}
        >
          {total} minutes{late ? `, it is ${clock}` : ""}
        </p>
        <h1 className="mt-3 text-[40px] font-black leading-[1.03] tracking-tight sm:text-[52px]">
          Say it before
          <br />
          you read it.
        </h1>
        <p
          className="mt-5 text-[17px] leading-relaxed"
          style={{ color: "var(--label)" }}
        >
          Re-reading the script is the part that feels like preparing and
          changes nothing. Every round below makes you produce the words first
          and check after. Three full runs, each with less on screen, and the
          repair rounds only touch what actually broke.
        </p>
        {late && (
          <p
            className="mt-4 rounded-xl border px-4 py-3 text-[15px] leading-snug"
            style={{
              borderColor: "var(--hairline-strong)",
              background: "var(--surface-1)",
            }}
          >
            {have > 0
              ? `${have} minutes left, so every round below is already shortened to land on time.`
              : "Past the end. Whatever you do now comes out of the walk over, so keep it to the quick round."}
          </p>
        )}
        <ol className="mt-6 flex flex-col gap-1.5">
          {plan.map((p, i) => (
            <li
              key={p.key}
              className="flex items-baseline gap-3 text-[15px]"
              style={{ color: "var(--ink-tertiary)" }}
            >
              <span
                className="font-mono text-[13px]"
                style={{ color: "var(--ink-subtle)" }}
              >
                {String(p.min).padStart(2)}m
              </span>
              <span>{p.title}</span>
              {i === 0 && (
                <span
                  className="font-mono text-[12px]"
                  style={{ color: "var(--accent-hover)" }}
                >
                  first
                </span>
              )}
            </li>
          ))}
        </ol>
        <button
          onClick={() => onStart(false)}
          className="mt-8 w-full rounded-2xl px-6 py-5 text-[20px] font-black tracking-tight transition-transform duration-[120ms] ease-out active:scale-[0.97]"
          style={{ background: "var(--accent)", color: "var(--canvas)" }}
        >
          Start the clock
        </button>
        {/* Under half an hour the shape stops being three runs plus repairs.
            Offering the cut version is honest; letting him start a 75 minute
            block at 7:20 and discover the problem at 7:50 is not. */}
        {short && (
          <button
            onClick={() => onStart(true)}
            className="mt-2.5 w-full rounded-2xl border px-6 py-4 text-[17px] font-bold tracking-tight transition-transform duration-[120ms] ease-out active:scale-[0.97]"
            style={{
              borderColor: "var(--hairline-strong)",
              color: "var(--ink)",
            }}
          >
            Just learn it, {rescueMin} minutes
          </button>
        )}
        <p
          className="mt-3 text-center text-[14px]"
          style={{ color: "var(--ink-subtle)" }}
        >
          Open the talk in another window first. Speak out loud, not in your
          head.
        </p>
      </div>
    </main>
  );
}

function Header({
  phase,
  count,
  total,
  title,
  leftInPhase,
  leftInBlock,
}: {
  phase: number;
  count: number;
  total: number;
  title: string;
  leftInPhase: number;
  leftInBlock: number;
}) {
  const over = leftInPhase < 0;
  return (
    <div className="mx-auto w-full max-w-[680px]">
      <div
        className="flex items-baseline gap-4 font-mono text-[13px]"
        style={{ color: "var(--label)" }}
      >
        <span>
          {phase + 1} / {count}
        </span>
        <span className="truncate" style={{ color: "var(--ink-subtle)" }}>
          {title}
        </span>
        <span
          className="ml-auto"
          style={{ color: over ? "var(--cut)" : "var(--accent-hover)" }}
        >
          {over ? `${mmss(-leftInPhase)} over` : mmss(leftInPhase)}
        </span>
      </div>
      <div
        className="mt-2.5 h-[3px] w-full overflow-hidden rounded-full"
        style={{ background: "var(--surface-2)" }}
      >
        <div
          className="h-full rounded-full transition-[width] duration-500 ease-out"
          style={{
            width: `${Math.max(0, Math.min(100, 100 - (leftInBlock / (total * 60)) * 100))}%`,
            background: "var(--accent)",
          }}
        />
      </div>
    </div>
  );
}

function Big({
  children,
  onClick,
  tone = "accent",
}: {
  children: React.ReactNode;
  onClick: () => void;
  tone?: "accent" | "quiet";
}) {
  const accent = tone === "accent";
  return (
    <button
      onClick={onClick}
      className="w-full rounded-2xl border px-5 py-4 text-[17px] font-bold tracking-tight transition-transform duration-[120ms] ease-out active:scale-[0.97]"
      style={
        accent
          ? {
              background: "var(--accent)",
              color: "var(--canvas)",
              borderColor: "var(--accent)",
            }
          : {
              background: "transparent",
              color: "var(--ink)",
              borderColor: "var(--hairline-strong)",
            }
      }
    >
      {children}
    </button>
  );
}

/* --- phase: the chain --------------------------------------------- */

// Teaching, not testing, so both halves show at once and the only control is
// forward. Thirteen short cards beat one page of prose: he gets the same
// argument, but he cannot skim past a link without touching it.
// The same drawing he will stand next to at 10:00, frozen at the beat the
// card is about. Rendered from BEATS and CAMERA, so the teaching cannot drift
// away from the talk: change a beat and this changes with it.
function Figure({ scene, beat }: { scene: keyof typeof BEATS; beat: number }) {
  const b = BEATS[scene];
  const i = Math.max(0, Math.min(b.length - 1, beat));
  const Scene = DRAWINGS[scene];
  const box = CAMERA[scene][i] ?? CAMERA[scene][0];
  return (
    <div
      className="overflow-hidden rounded-2xl border"
      style={{ borderColor: "var(--hairline)", background: GROUND[scene] ?? "var(--surface-1)" }}
    >
      <svg
        viewBox={box.map((v) => v.toFixed(1)).join(" ")}
        preserveAspectRatio="xMidYMid meet"
        className="block h-[244px] w-full sm:h-[300px]"
      >
        <Scene s={b[i].s} />
      </svg>
    </div>
  );
}

function Chain({ onDone }: { onDone: () => void }) {
  const [i, setI] = useState(0);
  const card = CHAIN_CARDS[i];
  const last = i === CHAIN_CARDS.length - 1;
  return (
    <div>
      <div className="flex items-center gap-1.5">
        {CHAIN_CARDS.map((_, n) => (
          <span
            key={n}
            className="h-[3px] flex-1 rounded-full transition-colors duration-200"
            style={{ background: n <= i ? "var(--accent)" : "var(--surface-2)" }}
          />
        ))}
      </div>
      <p className="mt-3 font-mono text-[13px]" style={{ color: "var(--ink-subtle)" }}>
        {i + 1} of {CHAIN_CARDS.length}
      </p>
      {card.scene !== undefined && card.beat !== undefined && (
        <div className="mt-3">
          <Figure scene={card.scene} beat={card.beat} />
        </div>
      )}
      <p className="mt-5 text-[27px] font-black leading-tight tracking-tight sm:text-[31px]">
        {card.t}
      </p>
      <p className="mt-2.5 text-[18px] leading-relaxed" style={{ color: "var(--label)" }}>
        {card.body}
      </p>
      {/* The plain-words line. A term gets one the moment it first appears,
          because the version without these is where he stopped following. */}
      {card.note ? (
        <p
          className="mt-3.5 border-t pt-3.5 text-[16px] leading-relaxed"
          style={{ borderColor: "var(--hairline)", color: "var(--ink-subtle)" }}
        >
          {card.note}
        </p>
      ) : null}
      <div className="mt-4 flex flex-col gap-2">
        <Big onClick={() => (last ? onDone() : setI(i + 1))}>
          {last ? "Got the story, start drilling" : "Then what"}
        </Big>
        {i > 0 && (
          <Big tone="quiet" onClick={() => setI(i - 1)}>
            Back one
          </Big>
        )}
      </div>
    </div>
  );
}

/* --- phase: nine facts ------------------------------------------- */

function Cold({ onDone }: { onDone: () => void }) {
  const [i, setI] = useState(0);
  const [shown, setShown] = useState(false);
  const card = COLD_CARDS[i];
  const last = i === COLD_CARDS.length - 1;

  const step = () => {
    if (!shown) return setShown(true);
    if (last) return onDone();
    setI(i + 1);
    setShown(false);
  };

  return (
    <div>
      <p
        className="font-mono text-[13px]"
        style={{ color: "var(--ink-subtle)" }}
      >
        {i + 1} of {COLD_CARDS.length}
      </p>
      <div
        className="mt-3 flex min-h-[180px] flex-col justify-center rounded-2xl border px-6 py-8"
        style={{
          borderColor: "var(--hairline)",
          background: "var(--surface-1)",
        }}
      >
        <p className="font-mono text-[30px] font-black tracking-tight sm:text-[38px]">
          {card[0]}
        </p>
        <p
          className="mt-4 text-[19px] leading-snug transition-opacity duration-200 ease-out"
          style={{ color: shown ? "var(--ink)" : "transparent" }}
        >
          {shown ? card[1] : "hidden"}
        </p>
      </div>
      <div className="mt-4">
        <Big onClick={step}>
          {!shown ? "I said it, show me" : last ? "Done" : "Next"}
        </Big>
      </div>
      {!shown && (
        <p
          className="mt-3 text-center text-[14px]"
          style={{ color: "var(--ink-subtle)" }}
        >
          Out loud. A sentence, not the word back.
        </p>
      )}
    </div>
  );
}

/* --- phase: a timed run ------------------------------------------- */

function Run({
  label,
  onDone,
}: {
  label: string;
  onDone: (secs: number, weak: string[]) => void;
}) {
  const [t0, setT0] = useState<number | null>(null);
  const [at, setAt] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [finished, setFinished] = useState<number | null>(null);
  const [weak, setWeak] = useState<string[]>([]);
  const t0Ref = useRef<number | null>(null);

  useEffect(() => {
    const c = new BroadcastChannel(CH);
    c.onmessage = (e) => {
      const n = Number(e.data);
      if (Number.isNaN(n)) return;
      setAt(n);
      // A run starts at the beginning and ends at the end. Starting on any
      // n > 0 meant that arriving at this phase with the talk window still
      // parked on the last stop set the clock and finished the run from the
      // same message, so run two showed a finished 0:00 before he had said a
      // word. Only a low stop starts it, which is also what a real run does.
      if (t0Ref.current === null && n <= 2) {
        t0Ref.current = Date.now();
        setT0(t0Ref.current);
        return;
      }
      if (n >= LAST && t0Ref.current !== null) {
        setFinished(Math.round((Date.now() - t0Ref.current) / 1000));
      }
    };
    return () => c.close();
  }, []);

  useEffect(() => {
    if (t0 === null || finished !== null) return;
    const i = setInterval(
      () => setElapsed(Math.round((Date.now() - t0) / 1000)),
      500,
    );
    return () => clearInterval(i);
  }, [t0, finished]);

  if (finished !== null) {
    const band =
      finished < 8 * 60
        ? "under 8, slow down"
        : finished > 10 * 60
          ? "over 10, tighten"
          : "inside 8 to 10";
    const good = finished >= 8 * 60 && finished <= 10 * 60;
    return (
      <div>
        <p className="font-mono text-[52px] font-black tracking-tight">
          {mmss(finished)}
        </p>
        <p
          className="mt-1 text-[17px] font-bold"
          style={{ color: good ? "var(--accent-hover)" : "var(--cut)" }}
        >
          {band}
        </p>
        <p className="mt-6 text-[17px] leading-snug">
          Which scenes did you have to read? Tap them. Those are the only ones
          the next round touches.
        </p>
        <div className="mt-4 flex flex-col gap-1.5">
          {SCENES.filter((k) => SCRIPT[k]).map((k) => {
            const on = weak.includes(k);
            return (
              <button
                key={k}
                onClick={() =>
                  setWeak(on ? weak.filter((w) => w !== k) : [...weak, k])
                }
                className="flex items-center gap-3 rounded-xl border px-4 py-3 text-left text-[16px] transition-transform duration-[120ms] ease-out active:scale-[0.98]"
                style={{
                  borderColor: on ? "var(--accent)" : "var(--hairline)",
                  background: on ? "var(--surface-2)" : "var(--surface-1)",
                  color: on ? "var(--ink)" : "var(--ink-tertiary)",
                }}
              >
                <span
                  className="h-[9px] w-[9px] shrink-0 rounded-full"
                  style={{
                    background: on ? "var(--accent)" : "var(--hairline-strong)",
                  }}
                />
                {LABEL[k]}
              </button>
            );
          })}
        </div>
        <div className="mt-5">
          <Big onClick={() => onDone(finished, weak)}>
            {weak.length === 0
              ? "Nothing broke, carry on"
              : `Repair ${weak.length}`}
          </Big>
        </div>
      </div>
    );
  }

  return (
    <div>
      <p className="font-mono text-[52px] font-black tracking-tight">
        {t0 === null ? "0:00" : mmss(elapsed)}
      </p>
      <p className="mt-1 text-[16px]" style={{ color: "var(--label)" }}>
        {t0 === null
          ? "Starts on your first click in the talk window."
          : `stop ${at + 1} of ${ROWS.length}, stops when you reach the last one`}
      </p>
      <div
        className="mt-6 rounded-2xl border px-5 py-5 text-[16px] leading-relaxed"
        style={{
          borderColor: "var(--hairline)",
          background: "var(--surface-1)",
          color: "var(--label)",
        }}
      >
        {label.includes("one") &&
          "Full run, start to finish. Do not stop to fix a sentence. Let the bad bits be bad and note them at the end."}
        {label.includes("two") &&
          "Same run with the notes window closed. You will stall. Stalling is the measurement, not the failure."}
        {label.includes("three") &&
          "Exactly how it will go at 10. Stand up, talk to the far wall, no notes window at all."}
      </div>
      <div className="mt-5">
        <Big tone="quiet" onClick={() => onDone(elapsed, [])}>
          Skip the timer, move on
        </Big>
      </div>
    </div>
  );
}

/* --- phase: repair ------------------------------------------------ */

function Fix({ weak, onDone }: { weak: string[]; onDone: () => void }) {
  const [i, setI] = useState(0);
  const [hidden, setHidden] = useState(false);
  const list = weak.length ? weak : [];

  if (list.length === 0)
    return (
      <div>
        <p className="text-[19px] leading-snug">
          Nothing marked, so there is nothing to repair. Take the minutes back
          and go straight on.
        </p>
        <div className="mt-5">
          <Big onClick={onDone}>Next round</Big>
        </div>
      </div>
    );

  const k = list[Math.min(i, list.length - 1)];
  const last = i >= list.length - 1;

  return (
    <div>
      <p
        className="font-mono text-[13px]"
        style={{ color: "var(--ink-subtle)" }}
      >
        {i + 1} of {list.length} · {LABEL[k]}
      </p>
      <div
        className="mt-3 rounded-2xl border px-5 py-5 text-[17px] leading-relaxed"
        style={{
          borderColor: "var(--hairline)",
          background: "var(--surface-1)",
          color: hidden ? "transparent" : "var(--ink)",
        }}
      >
        {SCRIPT[k]}
      </div>
      <div className="mt-4 flex flex-col gap-2">
        {!hidden ? (
          <Big onClick={() => setHidden(true)}>Read it once, now hide it</Big>
        ) : (
          <Big
            onClick={() => {
              if (last) return onDone();
              setI(i + 1);
              setHidden(false);
            }}
          >
            {last ? "Repaired, next round" : "Said it blind, next scene"}
          </Big>
        )}
        {hidden && (
          <Big tone="quiet" onClick={() => setHidden(false)}>
            Show it again
          </Big>
        )}
      </div>
      <p
        className="mt-3 text-center text-[14px]"
        style={{ color: "var(--ink-subtle)" }}
      >
        {hidden
          ? "Say the whole scene with nothing on screen."
          : "Once through, out loud, then hide it."}
      </p>
    </div>
  );
}

/* --- phase: questions --------------------------------------------- */

function Quiz({ onDone }: { onDone: () => void }) {
  // Shuffled once per mount: the order in the room will not be the page order,
  // and an answer that only arrives in sequence has not been learned.
  const deck = useMemo(() => {
    const d = [...QA_CARDS];
    for (let i = d.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [d[i], d[j]] = [d[j], d[i]];
    }
    return d;
  }, []);
  const [i, setI] = useState(0);
  const [shown, setShown] = useState(false);
  const card = deck[i];
  const last = i === deck.length - 1;

  return (
    <div>
      <p
        className="font-mono text-[13px]"
        style={{ color: "var(--ink-subtle)" }}
      >
        {i + 1} of {deck.length}
      </p>
      <p className="mt-3 text-[25px] font-bold leading-snug tracking-tight sm:text-[29px]">
        {card[0]}
      </p>
      {shown && (
        <div
          className="mt-5 rounded-2xl border px-5 py-5 text-[17px] leading-relaxed"
          style={{
            borderColor: "var(--hairline)",
            background: "var(--surface-1)",
          }}
        >
          {card[1]}
        </div>
      )}
      <div className="mt-5 flex flex-col gap-2">
        {!shown ? (
          <Big onClick={() => setShown(true)}>I answered it, show me</Big>
        ) : (
          <Big
            onClick={() => {
              if (last) return onDone();
              setI(i + 1);
              setShown(false);
            }}
          >
            {last ? "Done with questions" : "Next question"}
          </Big>
        )}
        <Big tone="quiet" onClick={onDone}>
          Enough questions, move on
        </Big>
      </div>
      {!shown && (
        <p
          className="mt-3 text-center text-[14px]"
          style={{ color: "var(--ink-subtle)" }}
        >
          Full sentences, out loud. Say where it comes from.
        </p>
      )}
    </div>
  );
}

/* --- phase: open and close ---------------------------------------- */

function Bookend({ onDone }: { onDone: () => void }) {
  const parts: [string, string][] = [
    ["The open", SCRIPT.cover],
    ["The close", SCRIPT.three],
  ];
  const [i, setI] = useState(0);
  const [reps, setReps] = useState(0);
  const [hidden, setHidden] = useState(false);
  const [title, text] = parts[i];

  const tick = () => {
    const r = reps + 1;
    if (r < 3) {
      setReps(r);
      setHidden(true);
      return;
    }
    if (i === 0) {
      setI(1);
      setReps(0);
      setHidden(false);
      return;
    }
    onDone();
  };

  return (
    <div>
      <p
        className="font-mono text-[13px]"
        style={{ color: "var(--ink-subtle)" }}
      >
        {title} · rep {reps + 1} of 3
      </p>
      <div
        className="mt-3 rounded-2xl border px-5 py-5 text-[17px] leading-relaxed"
        style={{
          borderColor: "var(--hairline)",
          background: "var(--surface-1)",
          color: hidden ? "transparent" : "var(--ink)",
        }}
      >
        {text}
      </div>
      <div className="mt-4">
        <Big onClick={tick}>
          {hidden ? "Said it blind" : "Read it, now hide it"}
        </Big>
      </div>
      <p
        className="mt-3 text-center text-[14px]"
        style={{ color: "var(--ink-subtle)" }}
      >
        These two are the ones worth owning word for word.
      </p>
    </div>
  );
}

/* --- phase: pack and go -------------------------------------------- */

const PACK = [
  "Laptop charged, charger in the bag",
  "Zoom updated, not just installed",
  "Lab attire on",
  "Both windows open, share the TALK one only",
  "Debate Topics Poll, due 5pm",
];

function Wrap({ runs, onReset }: { runs: number[]; onReset: () => void }) {
  const [done, setDone] = useState<number[]>([]);
  const best = runs.length ? runs[runs.length - 1] : null;
  return (
    <div>
      {best !== null && (
        <>
          <p className="font-mono text-[52px] font-black tracking-tight">
            {mmss(best)}
          </p>
          <p className="mt-1 text-[16px]" style={{ color: "var(--label)" }}>
            last run
            {runs.length > 1
              ? `, after ${runs.map((r) => mmss(r)).join(" and ")}`
              : ""}
          </p>
        </>
      )}
      <div className="mt-6 flex flex-col gap-1.5">
        {PACK.map((t, i) => {
          const on = done.includes(i);
          return (
            <button
              key={t}
              onClick={() =>
                setDone(on ? done.filter((d) => d !== i) : [...done, i])
              }
              className="flex items-center gap-3 rounded-xl border px-4 py-3.5 text-left text-[16px] transition-transform duration-[120ms] ease-out active:scale-[0.98]"
              style={{
                borderColor: on ? "var(--accent)" : "var(--hairline)",
                background: "var(--surface-1)",
                color: on ? "var(--ink-subtle)" : "var(--ink)",
                textDecoration: on ? "line-through" : "none",
              }}
            >
              <span
                className="h-[9px] w-[9px] shrink-0 rounded-full"
                style={{
                  background: on ? "var(--accent)" : "var(--hairline-strong)",
                }}
              />
              {t}
            </button>
          );
        })}
      </div>
      <div className="mt-6 flex flex-col gap-2">
        <a
          href="/run"
          className="block w-full rounded-2xl px-5 py-4 text-center text-[17px] font-bold tracking-tight"
          style={{ background: "var(--accent)", color: "var(--canvas)" }}
        >
          Morning sheet
        </a>
        <Big tone="quiet" onClick={() => onReset()}>
          Run the whole block again
        </Big>
      </div>
    </div>
  );
}
