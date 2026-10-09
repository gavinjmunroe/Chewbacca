/* The hero intro: the copy and the six plates, before the logo wall.

   Rebuilt 2026-10-03 from their shipped component (function C in chunk 768,
   the plate component k beside it, the copy component v) instead of from
   scroll samples. The previous version fitted seven exit travels off scroll
   samples and assigned them to plates by vertical order, marked as a choice.
   The source says each plate carries its own parallaxSpeed, and the copy
   travels 380px on the same curve. Measured after: every plate top was 96px
   high on ours, every travel was short by a factor of about five at 150px of
   scroll (45px against their 259px).

   Two clocks drive it, and they are different kinds of time:

     load   a TIMED 2200ms clock from mount. Plates wipe open top-down and the
            copy rises in. It never reverses.
     exit   the scene's own progress N, so it reverses when you scroll back.
*/

/* Positions are percentages of a centred box at most 1480 wide and one
   viewport tall, sizes are pixels. Read straight off their plate props at
   >= 768 wide. `load` is when the plate's wipe starts on the load clock and
   `speed` is how far it leaves upward over the exit. */
export const PLATE_LAYOUT = [
  { left: 8, top: 9, w: 282, h: 202, load: 0.24, speed: 420, z: 15 },
  { left: 83, top: 15, w: 158, h: 220, load: 0.22, speed: 500, z: 10 },
  { left: 71, top: 18, w: 202, h: 202, load: 0.3, speed: 360, z: 15 },
  { left: 6, top: 48, w: 176, h: 202, load: 0.24, speed: 240, z: 10 },
  { left: 14.5, top: 56, w: 202, h: 211, load: 0.34, speed: 300, z: 20 },
  { left: 73, top: 50, w: 229, h: 202, load: 0.32, speed: 200, z: 10 },
];

/* 2200ms is their load clock (`(now - start) / 2200`); a wipe takes 0.35 of
   it, so 770ms, and each copy line rises over 0.18 of it from 12px below. */
const LOAD_MS = 2200;
const WIPE = 0.35;
const RISE = 0.18;
const RISE_PX = 12;
/* Copy line starts on the load clock, in reading order: pill, headline line
   one, headline line two, lede, buttons. */
const COPY_STARTS = [0.02, 0.04, 0.1, 0.18, 0.24];

/* The exit spans 0.055 of the scene's progress, the same span their intro
   opacity ramp uses, so the copy and plates finish leaving exactly as they
   reach zero opacity. The copy rides 380px on top of a fixed -32px lift. */
const EXIT_SPAN = 0.055;
const COPY_TRAVEL = 380;

const clamp = (v) => Math.max(0, Math.min(1, v));
const easeOut3 = (t) => 1 - Math.pow(1 - t, 3);
const smooth = (t) => t * t * (3 - 2 * t);

export function mountIntro(hero) {
  const plates = [...hero.querySelectorAll(".plate")];
  const wrap = hero.querySelector(".wrap");
  const copy = wrap
    ? [
        wrap.querySelector(".backed"),
        ...wrap.querySelectorAll("h1 .ln"),
        wrap.querySelector("p"),
        wrap.querySelector(".hero-cta"),
      ].filter(Boolean)
    : [];
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

  let load = reduced ? 1 : 0;
  let exitE = 0;
  let fade = 1;

  const paint = () => {
    /* Plates dim to 0.6 until the load clock is past 0.55, then come up to
       full over the next 0.3 on a smoothstep: the set arrives as one object
       rather than six. */
    const lift = 0.6 + 0.4 * smooth(clamp((load - 0.55) / 0.3));
    plates.forEach((el, i) => {
      const L = PLATE_LAYOUT[i];
      if (!L) return;
      const open = 100 * easeOut3(clamp((load - L.load) / WIPE));
      const clip = `polygon(0% 0%, 100% 0%, 100% ${open.toFixed(2)}%, 0% ${open.toFixed(2)}%)`;
      el.style.clipPath = clip;
      el.style.webkitClipPath = clip;
      el.style.opacity = (lift * fade).toFixed(3);
      el.style.transform = exitE
        ? `translate3d(0, ${(-L.speed * exitE).toFixed(2)}px, 0)`
        : "";
    });
    copy.forEach((el, i) => {
      const n = easeOut3(clamp((load - COPY_STARTS[i]) / RISE));
      el.style.opacity = n.toFixed(3);
      el.style.transform = `translateY(${((1 - n) * RISE_PX).toFixed(2)}px)`;
    });
    if (wrap) wrap.style.opacity = fade.toFixed(3);
    if (wrap)
      wrap.style.transform = exitE
        ? `translate3d(0, ${(-COPY_TRAVEL * exitE).toFixed(2)}px, 0)`
        : "";
  };

  if (!reduced) {
    const t0 = performance.now();
    const tick = (now) => {
      load = Math.min(1, (now - t0) / LOAD_MS);
      paint();
      if (load < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
  paint();

  /* Called by the scene every frame with its followed progress N. The ramp
     is applied TWICE, as theirs does: once on the whole intro and again on
     each plate and on the copy, so what you see is the square of it. Read
     off their page at 150px of scroll: plate opacity 0.727 inside a wrapper
     at 0.727. A single ramp left ours visibly brighter all the way out. */
  return function exit(N) {
    const e = easeOut3(clamp(N / EXIT_SPAN));
    if (e === exitE && N > 0) return;
    exitE = e;
    const op = clamp(1 - N / EXIT_SPAN);
    fade = op;
    hero.style.opacity = op.toFixed(3);
    hero.style.visibility = op <= 0 ? "hidden" : "";
    paint();
  };
}
