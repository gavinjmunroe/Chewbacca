"use client";

import { useEffect, useState } from "react";
import { BEATS } from "@/lib/beats";
import { COLD, QA } from "@/lib/drill";

// Template: an operate surface, used standing up at 9:50am and again at 10:04.
// Mode: Operate, so scanability beats prose. Stance: the talk's own hand.
// What it refuses: doc shape. The first version of this was a markdown file of
// numbered headings and bullets and Caleb called it slop, correctly. A sheet
// you read is worse than a tool you use, so the checks tick and persist, the
// clock counts down on its own, and the thing most likely to cost him points
// is the loudest element on the page.

const LAB = { h: 10, m: 0 }; // Fri 10:00am, ZHS 258

const CHECKS = [
  ["charge", "Laptop charged"],
  ["zoom", "Zoom updated, not just installed"],
  ["attire", "Lab attire on"],
  ["poll", "Debate Topics Poll submitted"],
  ["share", "Two-window share tested"],
  // "One timed run-through, out loud" used to live here as a line to tick.
  // /train does that round properly now, with the clock and the repair loop,
  // so a checkbox claiming the same thing is a second place to call it done
  // without having done it.
  ["train", "The 6:30 block, finished"],
];

const MARKS = [
  ["2:30", "beat 10", "guide tested"],
  ["5:00", "beat 18", "sloppy crew picked"],
  ["7:00", "beat 26", "into the lab"],
  ["9:00", "beat 36", "no cancers"],
];

function useCountdown() {
  const [txt, setTxt] = useState<string | null>(null);
  const [late, setLate] = useState(false);
  useEffect(() => {
    const tick = () => {
      const now = new Date();
      const t = new Date(now);
      t.setHours(LAB.h, LAB.m, 0, 0);
      let d = t.getTime() - now.getTime();
      if (d < -45 * 60 * 1000) d += 86400000; // after the lab, count to the next day
      setLate(d < 0);
      const a = Math.abs(d);
      const hrs = Math.floor(a / 3600000);
      const min = Math.floor((a % 3600000) / 60000);
      setTxt(hrs > 0 ? `${hrs}h ${min}m` : `${min}m`);
    };
    tick();
    const i = setInterval(tick, 20000);
    return () => clearInterval(i);
  }, []);
  return { txt, late };
}

export default function Run() {
  const { txt, late } = useCountdown();
  const [done, setDone] = useState<Record<string, boolean>>({});
  const [openQ, setOpenQ] = useState<number | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    try {
      setDone(JSON.parse(localStorage.getItem("bisc-run") || "{}"));
    } catch {}
  }, []);
  const toggle = (k: string) => {
    const next = { ...done, [k]: !done[k] };
    setDone(next);
    try {
      localStorage.setItem("bisc-run", JSON.stringify(next));
    } catch {}
  };
  const copy = (s: string) => {
    navigator.clipboard?.writeText(s);
    setCopied(s);
    setTimeout(() => setCopied(null), 1400);
  };

  const beats = Object.values(BEATS).reduce((n, b) => n + b.length, 0) + 3;
  const left = CHECKS.filter(([k]) => !done[k]).length;

  return (
    <main className="mx-auto w-full max-w-[720px] px-5 pb-24 pt-9">
      <div className="flex items-baseline justify-between">
        <div
          className="text-[13px] font-extrabold uppercase tracking-[0.18em]"
          style={{ color: "var(--accent-hover)" }}
        >
          BISC 101 lab
        </div>
        <div
          className="font-mono text-[13px]"
          style={{ color: "var(--label)" }}
        >
          ZHS 258
        </div>
      </div>

      <h1 className="mt-3 text-[clamp(38px,9vw,56px)] font-black leading-[1.02] tracking-[-0.03em]">
        {late ? "You're on." : "You present in"}
        {!late && txt && (
          <span className="block" style={{ color: "var(--accent-hover)" }}>
            {txt}
          </span>
        )}
      </h1>
      <p
        className="mt-3 text-[17px] font-semibold"
        style={{ color: "var(--ink-subtle)" }}
      >
        Friday 10:00am. {beats} beats, 8 to 10 minutes, then 2 to 4 of
        questions.
      </p>

      {/* The one thing that can quietly cost him the delivery points. */}
      <section
        className="mt-9 rounded-2xl border p-5"
        style={{ borderColor: "var(--accent)", background: "#11121d" }}
      >
        <div
          className="text-[12px] font-extrabold uppercase tracking-[0.18em]"
          style={{ color: "var(--accent-hover)" }}
        >
          Do not get this wrong
        </div>
        <p className="mt-2.5 text-[21px] font-bold leading-[1.35]">
          Share the <span style={{ color: "var(--accent-hover)" }}>window</span>
          , never the screen. Share the screen and the room reads your script
          off the notes page.
        </p>
      </section>

      {/* The manual says 5 to 10 slides and the talk advances 38 times, so a
          grader counting clicks could read it as 38 slides. One sentence at the
          top removes that reading, and it is cheaper than cutting the builds. */}
      {/* Understanding of Topic is 4 of the 20 points and the rubric wording is
          "explains in own words". These are the facts a grader can test in one
          question, so they are the ones that have to come without the script.
          Everything else he can carry on the page. */}
      <section className="mt-7">
        <Label>Know these without looking</Label>
        <div className="mt-3 flex flex-col gap-1.5">
          {COLD.map(([a, b]) => (
            <div
              key={a}
              className="flex gap-3 rounded-xl border px-3.5 py-2.5"
              style={{
                borderColor: "var(--hairline)",
                background: "var(--surface-1)",
              }}
            >
              <span
                className="shrink-0 font-mono text-[15px] font-bold"
                style={{ color: "var(--accent-hover)" }}
              >
                {a}
              </span>
              <span className="text-[15px]">{b}</span>
            </div>
          ))}
        </div>
        <p className="mt-3 text-[15px]" style={{ color: "var(--label)" }}>
          If one of these needs the script, that is the one to run again.
        </p>
        {/* The sheet is for 9:50. The trainer is for 6:30, and it is the only
            thing on this page that does work rather than describing it. */}
        <a
          href="/train"
          className="mt-4 block w-full rounded-2xl px-5 py-4 text-center text-[17px] font-bold tracking-tight"
          style={{ background: "var(--accent)", color: "var(--canvas)" }}
        >
          Train before the lab
        </a>
      </section>

      <section
        className="mt-7 rounded-2xl border p-5"
        style={{ borderColor: "var(--accent)", background: "var(--surface-1)" }}
      >
        <Label>Say this first</Label>
        <p className="mt-2.5 text-[19px] font-semibold leading-snug">
          &ldquo;Quick note, this is the ten slides I submitted, animated. The
          clicks are builds inside a slide, not new slides.&rdquo;
        </p>
        <p className="mt-2.5 text-[15px]" style={{ color: "var(--label)" }}>
          Then your name and the topic. Nothing plays on its own, so it is not
          an embedded video.
        </p>
      </section>

      <section className="mt-7">
        <Label>Two windows</Label>
        <Url
          label="Share this one"
          href="https://bisc-crispr-talk.up.railway.app"
          note="press f for fullscreen"
          onCopy={copy}
          copied={copied}
        />
        <Url
          label="Keep this one to yourself"
          href="https://bisc-crispr-talk.up.railway.app/notes"
          note="follows the talk, shows your full sentence"
          onCopy={copy}
          copied={copied}
          accent
        />
        <p className="mt-3 text-[15px]" style={{ color: "var(--label)" }}>
          Right arrow or click to advance, left to go back. Close every other
          tab first.
        </p>
      </section>

      <section className="mt-9">
        <Label>Watch the clock</Label>
        <div className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          {MARKS.map(([t, b, what]) => (
            <div
              key={t}
              className="rounded-xl border px-3.5 py-3"
              style={{
                borderColor: "var(--hairline)",
                background: "var(--surface-1)",
              }}
            >
              <div className="font-mono text-[22px] font-bold">{t}</div>
              <div
                className="mt-1 text-[12px] font-bold uppercase tracking-wider"
                style={{ color: "var(--accent-hover)" }}
              >
                {b}
              </div>
              <div
                className="mt-1 text-[13px]"
                style={{ color: "var(--label)" }}
              >
                {what}
              </div>
            </div>
          ))}
        </div>
        <p className="mt-3 text-[15px]" style={{ color: "var(--label)" }}>
          Under 8 minutes or over 10 both cost you on Time and Preparedness.
        </p>
      </section>

      <section className="mt-9">
        <Label>{left === 0 ? "All clear" : `${left} left`}</Label>
        <div className="mt-3 flex flex-col gap-2">
          {CHECKS.map(([k, text]) => (
            <button
              key={k}
              onClick={() => toggle(k)}
              className="flex items-center gap-3 rounded-xl border px-4 py-3.5 text-left transition-colors"
              style={{
                borderColor: done[k] ? "var(--paired)" : "var(--hairline)",
                background: done[k] ? "#0e1a16" : "var(--surface-1)",
              }}
            >
              <span
                className="grid h-[22px] w-[22px] shrink-0 place-items-center rounded-md border text-[13px] font-black"
                style={{
                  borderColor: done[k]
                    ? "var(--paired)"
                    : "var(--hairline-strong)",
                  background: done[k] ? "var(--paired)" : "transparent",
                  color: "#06120e",
                }}
              >
                {done[k] && (
                  <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden>
                    <path
                      d="M2.5 8.5 L6.2 12 L13.5 4.2"
                      fill="none"
                      stroke="#06120e"
                      strokeWidth="2.6"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                )}
              </span>
              <span
                className="text-[17px] font-semibold"
                style={{
                  color: done[k] ? "var(--label)" : "var(--ink)",
                  textDecoration: done[k] ? "line-through" : "none",
                }}
              >
                {text}
              </span>
            </button>
          ))}
        </div>
      </section>

      <section className="mt-9">
        <Label>If they ask</Label>
        <div className="mt-3 flex flex-col gap-1.5">
          {QA.map(([q, a], i) => (
            <div
              key={q}
              className="rounded-xl border"
              style={{
                borderColor: "var(--hairline)",
                background: "var(--surface-1)",
              }}
            >
              <button
                onClick={() => setOpenQ(openQ === i ? null : i)}
                className="flex w-full items-center gap-3 px-4 py-3 text-left"
              >
                <span
                  className="font-mono text-[12px]"
                  style={{ color: "var(--label)" }}
                >
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className="text-[16px] font-semibold">{q}</span>
              </button>
              {openQ === i && (
                <p
                  className="px-4 pb-4 pl-[46px] text-[16px] leading-[1.45]"
                  style={{ color: "var(--ink-subtle)" }}
                >
                  {a}
                </p>
              )}
            </div>
          ))}
        </div>
      </section>

      <section className="mt-9">
        <Label>If the wifi dies</Label>
        <p
          className="mt-2.5 text-[16px] leading-[1.5]"
          style={{ color: "var(--ink-subtle)" }}
        >
          <span style={{ color: "var(--ink)" }}>
            BISC lab presentation - animated.pptx
          </span>{" "}
          in Downloads. Same content, click builds on the three mechanism
          slides, no internet needed.
        </p>
      </section>
    </main>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="text-[12px] font-extrabold uppercase tracking-[0.18em]"
      style={{ color: "var(--label)" }}
    >
      {children}
    </div>
  );
}

function Url({
  label,
  href,
  note,
  onCopy,
  copied,
  accent,
}: {
  label: string;
  href: string;
  note: string;
  onCopy: (s: string) => void;
  copied: string | null;
  accent?: boolean;
}) {
  return (
    <div
      className="mt-3 rounded-xl border p-4"
      style={{
        borderColor: accent ? "var(--accent)" : "var(--hairline)",
        background: "var(--surface-1)",
      }}
    >
      <div className="flex items-center justify-between gap-3">
        <span
          className="text-[13px] font-bold uppercase tracking-wider"
          style={{ color: accent ? "var(--accent-hover)" : "var(--label)" }}
        >
          {label}
        </span>
        <button
          onClick={() => onCopy(href)}
          className="font-mono text-[12px]"
          style={{ color: "var(--label)" }}
        >
          {copied === href ? "copied" : "copy"}
        </button>
      </div>
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className="mt-1.5 block break-all font-mono text-[16px] underline-offset-4 hover:underline"
      >
        {href.replace("https://", "")}
      </a>
      <div className="mt-1.5 text-[14px]" style={{ color: "var(--label)" }}>
        {note}
      </div>
    </div>
  );
}
