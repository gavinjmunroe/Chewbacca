"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { animate, useMotionValue, useMotionValueEvent, useReducedMotion } from "motion/react";
import { BEATS, BIG, CAMERA, GROUND, LABEL, ORDER, SLOT, type SceneKey, type State } from "@/lib/beats";
import { SCENES } from "@/lib/scenes";

type Stop =
  | { kind: "scene"; name: SceneKey; beat: number }
  | { kind: "cover" | "three" | "refs"; name: string; beat: null };

// The running order comes from the script, not from this file. It used to be
// a hardcoded list of one talk's scene names, so the first generated app did
// not type-check: 'Type "repair" is not assignable to SceneKey'.

// One flat list of stops, so a key press always does exactly one thing.
const STOPS: Stop[] = (ORDER as string[]).flatMap((name): Stop[] =>
  name in BEATS
    ? BEATS[name as SceneKey].map((_, beat) => ({ kind: "scene" as const, name: name as SceneKey, beat }))
    : [{ kind: name as "cover" | "three" | "refs", name, beat: null as null }],
);

const mix = (a: State, b: State, f: number): State => {
  const o: State = {};
  for (const k in a) o[k] = a[k] + ((b[k] ?? a[k]) - a[k]) * f;
  return o;
};

// One line per scene, no uppercase kicker above it. An uppercase eyebrow over
// every heading is one of the named generated-page tells, and it was sitting
// on all 38 frames (Caleb, 2026-11-05: "looks like claude made it").
// The line a scene opens on, big, before the figure takes the screen. One
// talk's lines used to be hardcoded here; now it falls back to the scene's
// own label from the script, and a sharper line per scene is an edit away.
const HEAD: Record<string, string> = { ...LABEL };

export default function Talk() {
  const [at, setAt] = useState(0);
  const [scale, setScale] = useState(1);
  const reduced = useReducedMotion();
  const t = useMotionValue(0);
  const [tv, setTv] = useState(0);
  useMotionValueEvent(t, "change", (v) => setTv(v));
  const atRef = useRef(0);

  const chan = useRef<BroadcastChannel | null>(null);
  useEffect(() => {
    chan.current = new BroadcastChannel("talk");
    return () => chan.current?.close();
  }, []);

  const go = useCallback(
    (n: number) => {
      const next = Math.max(0, Math.min(STOPS.length - 1, n));
      atRef.current = next;
      setAt(next);
      chan.current?.postMessage(next);
      const stop = STOPS[next];
      if (stop.beat === null) return;
      // A jump between scenes should cut, not animate across unrelated beats.
      if (reduced || Math.abs(t.get() - stop.beat) > 2.5) t.jump(stop.beat);
      else animate(t, stop.beat, { type: "spring", stiffness: 170, damping: 26, restDelta: 0.001 });
    },
    [reduced, t],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = e.key;
      if (["ArrowRight", " ", "PageDown", "ArrowDown", "Enter"].includes(k)) {
        e.preventDefault();
        go(atRef.current + 1);
      } else if (["ArrowLeft", "PageUp", "ArrowUp", "Backspace"].includes(k)) {
        e.preventDefault();
        go(atRef.current - 1);
      } else if (k === "Home") go(0);
      else if (k === "End") go(STOPS.length - 1);
      else if (k.toLowerCase() === "f") document.documentElement.requestFullscreen?.();
    };
    const onClick = () => go(atRef.current + 1);
    // Centring by transform, not by layout. A grid clamps an item wider than
    // its container to the start edge instead of overflowing both ways, which
    // pushed the whole talk 300px off the right of Caleb's screen (2026-11-05).
    const fit = () => setScale(Math.min(window.innerWidth / 1600, window.innerHeight / 900));
    document.body.style.overflow = "hidden"; // the talk is a fixed stage; /run scrolls
    addEventListener("keydown", onKey);
    addEventListener("click", onClick);
    addEventListener("resize", fit);
    fit();
    const ping = setInterval(() => chan.current?.postMessage(atRef.current), 1000);
    return () => {
      clearInterval(ping);
      removeEventListener("keydown", onKey);
      removeEventListener("click", onClick);
      removeEventListener("resize", fit);
      document.body.style.overflow = "";
    };
  }, [go]);

  const stop = STOPS[at];
  const isScene = stop.kind === "scene";
  const big = isScene ? BIG[`${stop.name}:${stop.beat}`] : undefined;

  let scene = null;
  if (isScene) {
    const beats = BEATS[stop.name];
    const i = Math.max(0, Math.min(beats.length - 1, Math.floor(tv)));
    const f = Math.max(0, Math.min(1, tv - i));
    const s = mix(beats[i].s, (beats[i + 1] ?? beats[i]).s, f);
    // The camera rides the same interpolation as the drawing, so the frame
    // opens out as elements arrive instead of sitting wide on beat one.
    const cam = CAMERA[stop.name];
    const c0 = cam[i], c1 = cam[i + 1] ?? cam[i];
    const box = c0.map((v, k) => v + (c1[k] - v) * f);
    const Scene = SCENES[stop.name];
    const [x, y, w, h] = SLOT[stop.name] ?? SLOT.default;
    const head = HEAD[stop.name];
    // A scene opens on its own title, full size, with the drawing already
    // moving behind it. One beat later the title steps aside and the figure
    // takes the screen. Every slide carrying the same small heading in the
    // same corner is what made 38 frames read as one template.
    const open = Math.max(0, 1 - tv * 1.6); // 1 on beat 0, gone by beat ~0.6
    scene = (
      <>
        <svg viewBox="0 0 1600 900" className="absolute inset-0 h-full w-full"
          style={{ opacity: big ? 0.16 : 1, transition: "opacity .42s var(--ease)" }}>
          <svg data-scene={stop.name} x={x} y={y} width={w} height={h}
            viewBox={box.map((v) => v.toFixed(1)).join(" ")} preserveAspectRatio="xMidYMid meet">
            <Scene s={s} />
          </svg>
        </svg>

        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[300px]"
          style={{ background: "linear-gradient(to top, var(--canvas) 26%, transparent)" }} />
        {/* The scene's line, big, only while the scene opens. It used to
            shrink and park in the top-left for the rest of the scene, where
            it duplicated the job of the cue below it. */}
        <div
          className="pointer-events-none absolute left-[72px] right-[72px] bottom-[78px] font-black tracking-[-0.03em]"
          style={{ fontSize: "72px", lineHeight: 1.08, opacity: open, maxWidth: "1280px" }}
        >
          {head}
        </div>

        <div
          className="say absolute inset-x-[72px] bottom-[78px] max-w-[1360px] text-[52px] font-bold leading-[1.18] tracking-[-0.015em]"
          style={{ opacity: 1 - open }}
        >
          {beats[stop.beat].cue}
        </div>
        {big && (
          <div className="absolute inset-0 grid place-content-center text-center">
            <div className="text-[300px] font-black leading-[0.84] tracking-[-0.05em]" style={{ color: big.tone }}>
              {big.n}
            </div>
            <div className="mt-[26px] text-[34px] font-semibold" style={{ color: "var(--ink-subtle)" }}>
              {big.u}
            </div>
          </div>
        )}
      </>
    );
  }

  return (
    <div
      id="stage"
      data-at={at + 1}
      data-total={STOPS.length}
      className="fixed left-1/2 top-1/2 h-[900px] w-[1600px] overflow-hidden"
      style={{
        transformOrigin: "50% 50%",
        transform: `translate(-50%, -50%) scale(${scale})`,
        background: GROUND[stop.name] ?? GROUND.cover,
        transition: "background .6s var(--ease)",
      }}
    >
      {/* No progress bar either. It told the room how much was left, which
          is the same job as the counter, and he has both in the notes window.
          What is left on the stage is the figure and one line. */}
      {scene}

      {stop.kind === "cover" && (
        <div className="absolute inset-0 flex flex-col px-[90px] py-[96px]">
          <div className="mb-[26px] text-[20px] font-extrabold uppercase tracking-[0.16em]"
            style={{ color: "var(--accent-hover)" }}>BISC 101 lab presentation</div>
          <h1 className="max-w-[1250px] text-[118px] font-black leading-[0.98] tracking-[-0.035em]">
            Cutting one switch
          </h1>
          <div className="mt-[34px] max-w-[1050px] text-[34px] font-semibold" style={{ color: "var(--ink-subtle)" }}>
            How CRISPR-Cas9 works, and how it became the first approved gene-editing
            therapy for sickle cell disease.
          </div>
          <div className="mt-auto text-[27px] font-bold" style={{ color: "var(--ink-subtle)" }}>
            Caleb Newton · Fall 2026
          </div>
        </div>
      )}

      {/* Three equal columns is the shape that lost a blind comparison in
          this project ("every card is identical except the number"). One
          claim carries the slide; the caveat and the direction sit under it
          at a weight that reads second. */}
      {stop.kind === "three" && (
        <div className="absolute inset-0 flex flex-col justify-center px-[90px]">
          <div className="text-[21px] font-extrabold uppercase tracking-[0.16em]"
            style={{ color: "var(--accent-hover)" }}>Why it matters</div>
          <h2 className="mt-[26px] max-w-[1340px] text-[86px] font-black leading-[1.02] tracking-[-0.032em]">
            They never fixed the broken gene. They found a switch that makes it
            stop mattering.
          </h2>
          <div className="mt-[64px] flex max-w-[1240px] gap-[80px]">
            <p className="flex-1 text-[27px] font-semibold leading-[1.35]" style={{ color: "var(--ink-subtle)" }}>
              It is not finished. The conditioning is high-dose chemotherapy and
              the cells are edited in a lab, so a specialized hospital is the
              real ceiling on who can get it.
            </p>
            <p className="flex-1 text-[27px] font-semibold leading-[1.35]" style={{ color: "var(--ink-subtle)" }}>
              What is being pushed now is editing inside the body, and base
              editors that change one letter without cutting both strands.
            </p>
          </div>
        </div>
      )}

      {stop.kind === "refs" && (
        <div className="absolute inset-0 flex flex-col px-[90px] py-[78px]">
          <h2 className="text-[54px] font-black tracking-[-0.02em]">References</h2>
          <ul className="mt-[34px] flex flex-col gap-[16px]">
            {[
              ["Jinek M, et al.", "A programmable dual-RNA-guided DNA endonuclease in adaptive bacterial immunity. Science. 2012;337(6096):816-21."],
              ["Nishimasu H, et al.", "Crystal structure of Cas9 in complex with guide RNA and target DNA. Cell. 2014;156(5):935-49."],
              ["Bauer DE, et al.", "An erythroid enhancer of BCL11A subject to genetic variation determines fetal hemoglobin level. Science. 2013;342(6155):253-7."],
              ["Canver MC, et al.", "BCL11A enhancer dissection by Cas9-mediated in situ saturating mutagenesis. Nature. 2015;527(7577):192-7."],
              ["Frangoul H, et al.", "CRISPR-Cas9 gene editing for sickle cell disease and β-thalassemia. NEJM. 2021;384(3):252-60."],
              ["Frangoul H, et al.", "Exagamglogene autotemcel for severe sickle cell disease. NEJM. 2024;390(18):1649-62."],
              ["U.S. Food and Drug Administration.", "FDA approves first gene therapies to treat patients with sickle cell disease. Press release, December 8, 2023."],
            ].map(([a, b]) => (
              <li key={b} className="text-[21px] leading-[1.34]" style={{ color: "var(--ink-subtle)" }}>
                <b style={{ color: "var(--ink)" }}>{a}</b> {b}
              </li>
            ))}
          </ul>
          <div className="mt-auto text-[19px]" style={{ color: "var(--label)" }}>
            Image: OpenStax College, sickle cell SEM, CC BY 3.0. Structure: RCSB PDB 4OO8.
          </div>
        </div>
      )}
    </div>
  );
}
