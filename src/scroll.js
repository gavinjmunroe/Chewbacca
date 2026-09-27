/* The scroll system.

   The replica had none of this. Zero scroll-linked motion anywhere, while
   38.1% of the reference's 9,133 measurable elements move at a rate strictly
   between pinned and normal flow. That is the single largest gap between the
   two pages and it is why theirs reads as depth and ours reads as a sheet.

   I also spent a day claiming the reference had no parallax at all. That came
   from an instrument that sampled 26 elements out of 9,133 and read each
   one's OWN transform, while the reference animates containers, so a
   parallaxing child honestly reports `transform: none`. Two compounding
   errors, and the lesson is in both halves: check an instrument's coverage
   before believing a negative, and measure the observable (an element's rect
   against the scroll offset) rather than the implementation.

   ONE MAPPING, AT THE DOOR. Every layer's position comes from a single
   progress value computed once per frame. Six alignment bugs in one morning
   on another project all traced to two independent paths from an input to a
   pixel; the fix there and here is to compute the mapping once and let
   everything read it.
*/

/* Lenis runs on the reference, so the scroll position a layer reacts to is a
   FOLLOWER of the real one rather than the real one. Sampling their transform
   30ms after a jump caught that follower mid-flight, which is why an
   instantaneous rate near a scroll jump was untrustworthy and the saturation
   distances were not.

   `cur += (target - cur) * k` covers 1 - (1-k)^n of the distance after n
   frames. At k = 0.1 that is 65% in 10 frames and 99% in 44, which is about
   three quarters of a second to settle: present enough to feel like weight,
   short enough not to feel broken. */
const LERP = 0.1;

/* The hero's exit, measured off the reference: seven layers each travelling a
   FIXED distance over the same window, under one shared opacity ramp.

       500  420  412  360  240  117  78   px

   Fixed distances rather than fixed rates is the whole trick. Every layer
   starts and finishes together, so nothing straggles, and the different
   distances are what read as depth. A per-layer RATE would have them finish
   at different times and the group would come apart. */
const HERO_TRAVEL = [500, 420, 412, 360, 240, 117, 78];

/* Their layers stop moving at 576px of scroll and the shared opacity reaches
   zero at 552. Both measured; the ramp finishing first is deliberate, so the
   last of the travel happens on something already invisible and the scene
   does not appear to halt. */
const HERO_END = 576;
const FADE_END = 552;

const layers = [];
let target = 0,
  cur = 0,
  raf = 0,
  running = false;

/* WHICH PLATE GETS WHICH DISTANCE IS A CHOICE, not a measurement. The
   reference's seven travels are measured; the mapping from travel to specific
   plate is not, because their layers are not labelled. Ordering by the plate's
   own vertical position puts the lower plates on the longer travels, so the
   scene opens downward as it leaves. Marked as a choice so nobody later reads
   it as recovered. */
export function registerHero(root) {
  const plates = [...root.querySelectorAll(".plate")];
  const copy = root.querySelector(".hero-copy") || root.querySelector(".wrap");

  const ordered = plates
    .map((el) => ({ el, y: el.getBoundingClientRect().top + window.scrollY }))
    .sort((a, b) => b.y - a.y)
    .map((o) => o.el);

  // The centre column takes 412, the reference's middle value, so the type
  // sits between the plates in depth rather than in front of or behind all
  // of them.
  const order = copy
    ? [...ordered.slice(0, 3), copy, ...ordered.slice(3)]
    : ordered;

  order.forEach((el, i) => {
    const travel = HERO_TRAVEL[i] ?? HERO_TRAVEL[HERO_TRAVEL.length - 1];
    el.style.willChange = "transform, opacity";
    layers.push({ el, travel });
  });
}

function frame() {
  cur += (target - cur) * LERP;
  // Stop the loop once the follower has effectively arrived. A rAF that never
  // idles is a battery cost with nothing on screen to show for it, and it is
  // the reason `will-change` is not left on permanently either.
  const settled = Math.abs(target - cur) < 0.1;
  if (settled) cur = target;

  const p = Math.min(Math.max(cur / HERO_END, 0), 1);
  const o = 1 - Math.min(Math.max(cur / FADE_END, 0), 1);

  for (const L of layers) {
    L.el.style.transform = `translate3d(0, ${(-L.travel * p).toFixed(2)}px, 0)`;
    L.el.style.opacity = o.toFixed(3);
  }

  if (settled) {
    running = false;
    // Released once idle: a permanently promoted layer is a permanently
    // allocated compositor layer.
    for (const L of layers)
      if (p === 0 || p === 1) L.el.style.willChange = "auto";
    return;
  }
  raf = requestAnimationFrame(frame);
}

function kick() {
  target = window.scrollY;
  if (running) return;
  running = true;
  for (const L of layers) L.el.style.willChange = "transform, opacity";
  raf = requestAnimationFrame(frame);
}

/* Reveal on arrival, for everything below the hero.

   SCROLL-LINKED AND ONE-SHOT ARE DIFFERENT THINGS and a downward-only capture
   cannot tell them apart. The reference uses both: the hero stack tracks
   scroll and reverses, while section entrances fire once and hold. Getting
   this backwards makes a page feel either inert or jittery, so it is recorded
   per section rather than guessed.

   These are one-shot: fire on arrival, hold, and do not replay on the way
   back up. */
export function registerReveals(root = document) {
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        e.target.classList.add("in");
        io.unobserve(e.target);
      }
    },
    { threshold: 0.12, rootMargin: "0px 0px -8% 0px" },
  );

  for (const el of root.querySelectorAll("[data-reveal]")) io.observe(el);
}

export function startScroll() {
  // The figures are information, so under reduced motion they stay where they
  // are at full opacity. Only the movement goes.
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
    document
      .querySelectorAll("[data-reveal]")
      .forEach((el) => el.classList.add("in"));
    return;
  }
  addEventListener("scroll", kick, { passive: true });
  addEventListener("resize", kick, { passive: true });
  kick();
}
