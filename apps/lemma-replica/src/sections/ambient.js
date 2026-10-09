/* The two ambient loops that belong to the page chrome rather than to a
   section: the hiring banner's orbit icon and the scroll cue at the foot of
   the hero pin. Mounted once with root = document.body, because the banner
   and the hero pin are both in index.html and neither has a section module.

   Read off their bundle 2026-10-03; mechanism learned, code our own. */

const REDUCED = matchMedia("(prefers-reduced-motion: reduce)");
const SVG_NS = "http://www.w3.org/2000/svg";

/* ---- 1. banner orbit ----------------------------------------------------

   Theirs (chunk 9815, the loader component; keyframes in their CSS
   7e81a651): a Lissajous curve drawn twice in a 100x100 box at 16px. The
   back copy sits at opacity .2 as a track. The front copy carries
   pathLength 100 and dasharray "32 68", and `loader-orbit` runs its
   stroke-dashoffset from 0 to -100 over 2.4s linear, so one 32-unit stroke
   chases round the figure and the icon reads as changing shape frame to
   frame. That is what the idle sweep saw: the bbox at x 668..684, y 69..83.

   Their curve parameters, each a default prop of that component: x
   frequency 3, y frequency 2, x phase pi/2, radius 40 about the centre 50,
   140 segments. Stroke width 8, round caps and joins. */
const LISSAJOUS = {
  fx: 3,
  fy: 2,
  phase: Math.PI / 2,
  r: 40,
  c: 50,
  steps: 140,
};
/* 2.4s per lap, their `duration` default and the same 2.4s as the cue. */
const ORBIT_S = 2.4;

function lissajous({ fx, fy, phase, r, c, steps }) {
  const pts = [];
  for (let k = 0; k <= steps; k++) {
    const a = (k / steps) * Math.PI * 2;
    pts.push(
      `${(c + r * Math.sin(fx * a + phase)).toFixed(2)} ${(c + r * Math.sin(fy * a)).toFixed(2)}`,
    );
  }
  return `M${pts.join(" L")}Z`;
}

function mountOrbit(root) {
  const host = root.querySelector(".banner .bmark");
  if (!host) return () => {};
  const d = lissajous(LISSAJOUS);
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 100 100");
  svg.setAttribute("fill", "none");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  for (const front of [false, true]) {
    const p = document.createElementNS(SVG_NS, "path");
    p.setAttribute("d", d);
    p.setAttribute("pathLength", "100");
    p.setAttribute("stroke", "currentColor");
    p.setAttribute("stroke-width", "8");
    p.setAttribute("stroke-linecap", "round");
    p.setAttribute("stroke-linejoin", "round");
    if (front) {
      p.setAttribute("stroke-dasharray", "32 68");
      p.setAttribute("class", "amb-orbit-run");
    } else {
      p.setAttribute("opacity", "0.2");
    }
    svg.appendChild(p);
  }
  host.textContent = "";
  host.appendChild(svg);
  host.classList.add("amb-orbit");
  host.style.setProperty("--amb-orbit-s", `${ORBIT_S}s`);

  /* The banner is fixed, so it is offscreen only once dismissed or scrolled
     away by a layout change. Pause the loop then; a CSS animation keeps its
     own position while paused, which is the bank. */
  const io = new IntersectionObserver((entries) => {
    const on = entries[entries.length - 1].isIntersecting;
    host.classList.toggle("amb-paused", !on);
  });
  io.observe(host);
  return () => io.disconnect();
}

/* ---- 2. hero scroll cue --------------------------------------------------

   Theirs (chunk 768, the hero component, the div after the
   `e78158c3f36e4cd6` style tag): a 96px band across the bottom of the
   sticky pin, z-index 40, pointer-events none, filled with
     linear-gradient(to bottom, #F2F2F2 at 0 -> .6 at 55% -> 1 at 100%)
   and pulsing its opacity .5 -> 1 -> .5 on `lemma-scroll-pulse`, 2.4s
   ease-in-out infinite. It is the page bottom dissolving into the
   background, which is the cue that there is more below.

   WHEN it shows, from the same line: opacity is
     loadProgress >= 1 ? max(0, 1 - 150 * N) : 0
   with a 500ms ease-out transition, where loadProgress is their 2200ms
   intro clock from mount and N is the hero's scroll progress (offset
   "start start" to "end end"). So it fades in as the intro finishes and is
   gone by N = 1/150: 66px of scroll on a 1200vh pin at 900 tall
   ((10800 - 900) / 150). It is NOT visible across the whole run. The idle
   sweep listed it at every position because getAnimations() counts the
   pulse on an element sitting at opacity 0; it only paints at the top.

   Under reduced motion theirs drops the pulse and keeps the band and its
   scroll fade. Ours does the same. */
const INTRO_MS = 2200;
const FADE_PER_N = 150;

function mountCue(root) {
  const run = root.querySelector("#hero");
  const pin = run && run.querySelector(".hs-pin");
  if (!pin) return () => {};
  const cue = document.createElement("div");
  cue.className = "amb-cue";
  cue.setAttribute("aria-hidden", "true");
  cue.innerHTML = '<div class="amb-cue-fill"></div>';
  pin.appendChild(cue);

  let loaded = false;
  let raf = 0;
  const progress = () => {
    const span = run.offsetHeight - innerHeight;
    if (span <= 0) return 0;
    return Math.min(1, Math.max(0, -run.getBoundingClientRect().top / span));
  };
  const update = () => {
    raf = 0;
    const op = loaded ? Math.max(0, 1 - FADE_PER_N * progress()) : 0;
    cue.style.opacity = op.toFixed(3);
    /* Nothing pulses while it cannot be seen. Theirs keeps the animation
       running at opacity 0; pausing costs nothing and saves the frames. */
    cue.classList.toggle("amb-paused", op === 0);
  };
  const onScroll = () => {
    if (!raf) raf = requestAnimationFrame(update);
  };
  const timer = setTimeout(() => {
    loaded = true;
    update();
  }, INTRO_MS);
  update();
  addEventListener("scroll", onScroll, { passive: true });
  addEventListener("resize", onScroll, { passive: true });
  return () => {
    clearTimeout(timer);
    if (raf) cancelAnimationFrame(raf);
    removeEventListener("scroll", onScroll);
    removeEventListener("resize", onScroll);
    cue.remove();
  };
}

export function mount(root = document.body) {
  const stops = [mountOrbit(root), mountCue(root)];
  /* Reduced motion is read by the stylesheet; this class lets a change of
     the setting mid-session take effect without a reload. */
  const syncReduced = () =>
    root.classList.toggle("amb-reduced", REDUCED.matches);
  syncReduced();
  REDUCED.addEventListener("change", syncReduced);
  return () => {
    stops.forEach((s) => s());
    REDUCED.removeEventListener("change", syncReduced);
  };
}
