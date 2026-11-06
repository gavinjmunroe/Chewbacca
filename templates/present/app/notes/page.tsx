"use client";

import { useEffect, useState } from "react";
import { SCRIPT, LABEL, ROWS } from "@/lib/beats";
import { QPREP } from "@/lib/drill";

// The presenter window. Caleb keeps this on his laptop and shares only the
// talk window on Zoom, so the room sees a short cue and he sees the words.
//
// It shows the WHOLE block for the scene he is in, not just the current
// beat's prompt. The prompts on their own total 614 words, which is 4.4
// minutes against an 8-to-10-minute requirement, so a presenter reading only
// those would come in at half time and lose Time/Preparedness.


// Where he should be by this stop, so a glance says ahead or behind.
const PACE = ["0:00","0:35","0:50","1:05","1:20","1:35","1:55","2:20","2:40","3:00","3:15",
  "3:30","3:45","4:00","4:20","4:35","4:50","5:05","5:20","5:40","5:55","6:10","6:25",
  "6:40","6:55","7:10","7:25","7:40","7:55","8:05","8:15","8:25","8:35","8:45","8:55",
  "9:05","9:15","9:25"];

export default function Notes() {
  const [at, setAt] = useState(0);
  // The clock is his, not the app's. It used to start itself on the first
  // broadcast, so a window left open while four other people presented showed
  // "491s ahead, slow down" before he had said a word. 2026-11-06, in the
  // room: "The timer shouldn't start until I click start and I should hv the
  // ability to restart/pause".
  const [runMs, setRunMs] = useState(0); // banked time from previous runs
  const [since, setSince] = useState<number | null>(null); // when this run began
  const [now, setNow] = useState(0);
  useEffect(() => {
    const c = new BroadcastChannel("talk");
    c.onmessage = (e) => {
      const n = Number(e.data);
      setAt(n);
    };
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => { c.close(); clearInterval(t); };
  }, []);

  const row = ROWS[at] ?? ROWS[0];
  const next = ROWS[at + 1];
  const running = since !== null;
  const ms = runMs + (running && now ? now - since : 0);
  const elapsed = Math.max(0, Math.floor(ms / 1000));
  const mmss = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, "0")}`;
  const target = PACE[Math.min(at, PACE.length - 1)];
  const [tm, ts] = target.split(":").map(Number);
  // Drift only means something once he has actually started talking.
  const drift = runMs || running ? elapsed - (tm * 60 + ts) : 0;
  const live = runMs > 0 || running;
  const startPause = () =>
    running ? (setRunMs((p) => p + (Date.now() - since)), setSince(null)) : setSince(Date.now());
  const reset = () => { setRunMs(0); setSince(null); };
  const isLast = at >= ROWS.length - 1;

  return (
    <main className="h-screen w-screen overflow-y-auto p-9" style={{ background: "var(--canvas)" }}>
      <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1 font-mono text-[14px]"
        style={{ color: "var(--label)" }}>
        <span>{at + 1} / {ROWS.length}</span>
        <span style={{ color: "var(--ink)" }}>{LABEL[row.scene]}</span>
        {row.beat !== null && <span>beat {row.beat + 1} of {row.beats}</span>}
        <span className="ml-auto">presenter view · keep this window off the share</span>
      </div>

      <div className="mt-4 flex items-center gap-4">
        <div className="font-mono text-[30px] font-bold tabular-nums">{mmss}</div>
        <button onClick={startPause}
          className="rounded-lg px-4 py-1.5 text-[15px] font-bold transition-transform duration-[120ms] ease-out active:scale-[0.97]"
          style={running
            ? { background: "transparent", color: "var(--ink)", border: "1px solid var(--hairline-strong)" }
            : { background: "var(--accent)", color: "var(--canvas)" }}>
          {running ? "Pause" : live ? "Resume" : "Start"}
        </button>
        {live && (
          <button onClick={reset}
            className="rounded-lg px-3.5 py-1.5 text-[15px] font-bold transition-transform duration-[120ms] ease-out active:scale-[0.97]"
            style={{ background: "transparent", color: "var(--ink-subtle)", border: "1px solid var(--hairline)" }}>
            Restart
          </button>
        )}
        {live && (
          <span className="font-mono text-[15px]" style={{ color: "var(--label)" }}>target {target}</span>
        )}
        {live && Math.abs(drift) > 25 && (
          <span className="font-mono text-[15px] font-bold"
            style={{ color: drift > 0 ? "var(--cut)" : "var(--paired)" }}>
            {drift > 0 ? `${drift}s behind, speed up` : `${-drift}s ahead, slow down`}
          </span>
        )}
      </div>

      {/* What the room is looking at, first, because he is narrating a drawing
          he is not looking at. This window used to show only what to SAY, so
          the one thing he could not check was whether his words matched the
          picture behind him. */}
      <div className="mt-5 flex items-baseline gap-3">
        <span className="font-mono text-[13px] uppercase tracking-widest shrink-0"
          style={{ color: "var(--label)" }}>on screen</span>
        <span className="text-[26px] font-black leading-tight tracking-[-0.02em]"
          style={{ color: "var(--pam)" }}>{row.see || row.cue || LABEL[row.scene]}</span>
      </div>


      {next && (
        <div className="mt-6 flex items-baseline gap-3 border-t pt-4"
          style={{ borderColor: "var(--hairline)" }}>
          <span className="font-mono text-[13px] uppercase tracking-widest shrink-0"
            style={{ color: "var(--label)" }}>next click</span>
          <span className="text-[19px] font-semibold" style={{ color: "var(--ink-subtle)" }}>
            {next.see || next.cue || LABEL[next.scene]}
          </span>
        </div>
      )}

      {/* Bullets ARE the page. It used to lead with the beat's full sentence
          and tuck these underneath, and he said twice that he wanted points to
          talk from rather than a line to recite: "BRO ITS STILL SENTENCES PLZ
          MAKE IT BULLET POINTS". The sentence moved in with the script, one
          tap away for when he loses the thread. */}
      {row.fill.length > 0 && (
        <ul className="mt-6 flex flex-col gap-3">
          {row.fill.map((f) => (
            <li key={f} className="flex gap-4 text-[30px] font-semibold leading-tight tracking-[-0.01em]">
              <span className="shrink-0" style={{ color: "var(--accent-hover)" }}>&bull;</span>
              <span>{f}</span>
            </li>
          ))}
        </ul>
      )}

      {/* The last stop is where he takes questions, so the window stops being
          a script and becomes the one thing worth glancing at mid-answer. Each
          line is the spine of a full answer, short enough to read in the two
          seconds after someone asks. */}
      {isLast && (
        <div className="mt-7 border-t pt-5" style={{ borderColor: "var(--hairline)" }}>
          <div className="font-mono text-[13px] uppercase tracking-widest"
            style={{ color: "var(--label)" }}>if they ask</div>
          <div className="mt-3 grid gap-x-10 gap-y-2.5 md:grid-cols-2">
            {QPREP.map(([q, a]) => (
              <div key={q} className="flex flex-col">
                <span className="text-[17px] font-black tracking-tight" style={{ color: "var(--pam)" }}>{q}</span>
                <span className="text-[17px] leading-snug" style={{ color: "var(--ink-tertiary)" }}>{a}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* The whole scene block stays, underneath, for pace. The per-beat lines
          on their own run 4.4 minutes against an 8-to-10 requirement. */}
      <details className="mt-6">
        <summary className="cursor-pointer font-mono text-[13px] uppercase tracking-widest"
          style={{ color: "var(--label)" }}>the sentence, and the whole scene</summary>
        {row.say && (
          <p className="mt-3 max-w-[1150px] text-[21px] leading-[1.45]"
            style={{ color: "var(--ink)" }}
            dangerouslySetInnerHTML={{ __html: row.say }} />
        )}
        <p className="mt-3 max-w-[1150px] text-[20px] leading-[1.5]"
          style={{ color: "var(--ink-tertiary)" }}>
          {SCRIPT[row.scene]}
        </p>
      </details>
    </main>
  );
}
