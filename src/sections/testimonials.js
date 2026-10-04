/* Section D: the testimonial carousel.

   Geometry read off theirs at 1440 (lower-brief/p_ref2.txt):

     section      1280 box, padding 128/64, content 1152 at x=144
     heading      768 centred, eyebrow then h2 16px under it, 48 below
     viewport     1152 wide, overflow hidden, 12px of vertical room each side
                  for the card border, pulled back up by a -12 margin
     cards        basis 1/3 of a track 16px wider than the viewport, so the
                  step is (1152 + 16) / 3 = 389.33 and a card is 373.33
     resting x    the first whole card sits 227px into the viewport, which
                  leaves a 208px sliver on the left and 147 on the right:
                  two whole cards and two partial ones, as in lo_ref_1.png
     arrows       32px circles 48px outside the viewport, centred on the cards

   The row is a RING, not a strip with two ends. Each card is placed at a
   signed slot relative to the active index, modulo the item count, so both
   slivers are always real cards. A card that wraps from one end of the ring
   to the other would otherwise slide the whole width of the window on its
   way round, so a wrapping card moves with its transition suppressed. */

export const MOUNT = "#testimonials";

/* OUR OWN copy. Every name, company and handle below is invented for this
   study. No real person's words and no real company's endorsement appear in
   this repo, which the spec requires and which is also the only honest way to
   ship a replica. Twelve items because the reference carries twelve dots. */
const ITEMS = [
  { name: "Dana Okonjo",     company: "Thornhall",    handle: "@dokonjo",
    quote: "Our agent passed every test we wrote and still refunded an order twice. We only saw the second refund because the trace was sitting there flagged." },
  { name: "Marcus Ilves",    company: "Pellbrook",    handle: "@m_ilves",
    quote: "Logs told us what the agent said. This tells us what it was supposed to say and did not." },
  { name: "Priya Raghavan",  company: "Quillhaus",    handle: "@praghavan",
    quote: "We were reading maybe forty runs a day by hand. Volume passed eleven thousand a week in March and hand review stopped being a plan." },
  { name: "Tobias Lund",     company: "Kitewright",   handle: "@tlund",
    quote: "The failure we cared about was a tool call that silently returned nothing. Nothing crashed, so nothing paged us." },
  { name: "Ama Serwaa",      company: "Marrowfield",  handle: "@amaserwaa",
    quote: "Grouping the repeats is the part that changed my week. Nine hundred bad runs collapsed into four real issues." },
  { name: "Ivan Petrosyan",  company: "Solder & Co",  handle: "@ipetro",
    quote: "Setup was one key and one prompt pasted into our coding agent. First real finding landed before I had finished the standup." },
  { name: "Noor Haddad",     company: "Tenspoke",     handle: "@noorhaddad",
    quote: "I stopped guessing which prompt change caused the regression. The span tree shows the hop where the context went missing." },
  { name: "Gabriel Mensah",  company: "Brightmoor",   handle: "@gmensah",
    quote: "Our support agent invented a policy that sounded exactly like ours. That is the failure mode nobody writes a test for." },
  { name: "Hana Ishikawa",   company: "Odeon Labs",   handle: "@hishikawa",
    quote: "Retrieval was returning the right documents and the model was ignoring two of them. We had been tuning the wrong half for a month." },
  { name: "Luca Ferretti",   company: "Trelliswork",  handle: "@lferretti",
    quote: "The thing I did not expect: most of our bad runs were one tool timing out, not the model being wrong." },
  { name: "Sade Adeyemi",    company: "Northmark",    handle: "@sadeadeyemi",
    quote: "Two engineers used to split trace review on Mondays. Now nobody does it and we catch more." },
  { name: "Emil Varga",      company: "Casswell",     handle: "@evarga",
    quote: "An agent that fails loudly is easy. Ours failed politely, in full sentences, for nine days." },
];

/* Gap between cards, their pl-4 gutter. Step and card width derive from it. */
const GAP = 16;

/* Their step transition: 450ms on cubic-bezier(.33,0,.15,1), read off the
   card's own transition property. */
const STEP_MS = 450;
const STEP_EASE = "cubic-bezier(.33,0,.15,1)";

/* AUTO-SCROLL. Theirs (chunk 1204) installs Embla AutoScroll at `speed: .4`
   with startDelay 0, and states.md measured it at one 389px step per 14.8
   to 15.5s, 25.1 to 26.3px/s. 25.7 is the middle of that. Embla's speed is
   per frame; ours is per millisecond, so a 120Hz screen does not run it
   twice as fast. */
const AUTO_PX_PER_S = 25.7;
/* Theirs stops on pointer enter and on focus inside the carousel region,
   and resumes on leave and blur with play(0). Both edges add
   `transition-transform 450ms ease-out` to the track for 450ms so the stop
   and the restart ease rather than snap. Ours ramps the speed itself over
   the same 450ms on an ease-out, which reads the same and keeps the
   transform written by one hand. */
const AUTO_EASE_MS = 450;
/* A hidden tab pauses rAF; cap the step so the row does not leap on return. */
const AUTO_MAX_DT = 50;

const initials = name =>
  name.split(/\s+/).slice(0, 2).map(w => w[0]).join("").toUpperCase();

const ARROW = d => `
  <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
    <path d="${d}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;

export function render() {
  const cards = ITEMS.map((t, i) => `
      <figure class="tst-card" data-i="${i}" role="group"
              aria-roledescription="testimonial" aria-label="${i + 1} of ${ITEMS.length}">
        <header class="tst-head">
          <span class="tst-avatar" aria-hidden="true">${initials(t.name)}</span>
          <span class="tst-who">
            <span class="tst-name">${t.name}</span>
            <span class="tst-meta">${t.company} &middot; ${t.handle}</span>
          </span>
        </header>
        <blockquote class="tst-quote">${t.quote}</blockquote>
      </figure>`).join("");

  const dots = ITEMS.map((t, i) => `
        <button class="tst-dot" type="button" data-i="${i}"
                aria-label="Show testimonial ${i + 1}, ${t.name}"><i></i></button>`).join("");

  return `
    <div class="tst-col">
      <div class="tst-head-block">
        <p class="tst-eyebrow">Testimonials</p>
        <h2 class="tst-title">What teams tell us.</h2>
      </div>
      <!-- Tab order follows theirs: the slides first, then previous, then
           next, then the dots. Their arrows come after the slide track in
           the DOM; the arrows here are absolutely placed, so moving them
           after the viewport changes the order and not the layout. -->
      <div class="tst-stage" role="region" aria-roledescription="carousel"
           aria-label="Testimonials">
        <div class="tst-viewport" tabindex="0" aria-live="polite"
             aria-label="Testimonials, use the left and right arrow keys to move">
          <div class="tst-track">${cards}</div>
        </div>
        <button class="tst-arrow tst-prev" type="button" aria-label="Previous testimonial">${ARROW("M13 8H3M7 4 3 8l4 4")}</button>
        <button class="tst-arrow tst-next" type="button" aria-label="Next testimonial">${ARROW("M3 8h10M9 4l4 4-4 4")}</button>
      </div>
      <div class="tst-dots" role="group" aria-label="Choose a testimonial">${dots}</div>
    </div>`;
}

export function mount(root) {
  const viewport = root.querySelector(".tst-viewport");
  const cards = [...root.querySelectorAll(".tst-card")];
  const dots = [...root.querySelectorAll(".tst-dot")];
  if (!viewport || !cards.length) return;

  const N = cards.length;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  /* pos is the ring position in cards, fractional while auto-scrolling:
     card i sits at slot i - pos. index is the nearest whole card, which is
     what the dots show (Embla's selectedScrollSnap). */
  let pos = 0, index = 0, step = 0, start = 0, width = 0, card = 0;
  const lastSlot = new Map();
  const lastHidden = new Map();
  let dotsDrawn = false;
  /* A click step owns the transforms for its 450ms; the auto-scroll waits
     it out instead of overwriting the transition on the next frame. */
  let holdUntil = 0;

  /* --tst-basis is the share of (viewport + gap) one step takes, and
     --tst-start where the first card rests as a share of the viewport. Both
     come from CSS so the breakpoints live in one file. */
  function layout() {
    const style = getComputedStyle(root);
    const basis = parseFloat(style.getPropertyValue("--tst-basis")) || 1 / 3;
    const startFrac = parseFloat(style.getPropertyValue("--tst-start")) || 0;
    width = viewport.clientWidth;
    step = (width + GAP) * basis;
    card = step - GAP;
    start = width * startFrac;
    root.style.setProperty("--tst-card", `${card.toFixed(2)}px`);
    place(false);
  }

  const slotOf = i => {
    const r = ((i - pos) % N + N) % N;
    return r <= N / 2 ? r : r - N;
  };

  /* animate: true for a click step (450ms on their curve), false for the
     per-frame auto-scroll write and for layout. */
  function place(animate) {
    for (const cardEl of cards) {
      const s = slotOf(+cardEl.dataset.i);
      const was = lastSlot.get(cardEl);
      const wrapped = was !== undefined && Math.abs(s - was) > 1;
      /* Only the slide duration is set here. The hover lift and border in
         testimonials.css ride the same transition list, and an inline
         `transition` would have overwritten them. */
      const move = (!animate || wrapped || reduced.matches) ? "0ms" : `${STEP_MS}ms`;
      if (cardEl.style.getPropertyValue("--tst-move") !== move)
        cardEl.style.setProperty("--tst-move", move);
      const x = start + s * step;
      cardEl.style.transform = `translate3d(${x.toFixed(2)}px,0,0)`;
      /* Only a card wholly inside the window is announced. Written only on
         change: at 60 writes a second the attribute churn would otherwise
         be constant. */
      const hidden = !(x >= -0.5 && x + card <= width + 0.5);
      if (lastHidden.get(cardEl) !== hidden) {
        cardEl.setAttribute("aria-hidden", hidden ? "true" : "false");
        lastHidden.set(cardEl, hidden);
      }
      lastSlot.set(cardEl, s);
    }
    const near = ((Math.round(pos) % N) + N) % N;
    if (near !== index || animate || !dotsDrawn) {
      index = near;
      dotsDrawn = true;
      dots.forEach((d, k) => {
        const on = k === index;
        d.classList.toggle("on", on);
        /* aria-current, as theirs does. The row is a set of buttons, not a
           tablist: a tablist needs tabpanels and roving focus, and theirs
           gives every dot its own tab stop. */
        if (on) d.setAttribute("aria-current", "true");
        else d.removeAttribute("aria-current");
      });
    }
  }

  function go(to) {
    /* Steps land on whole cards, from wherever auto-scroll had got to. */
    pos = ((to % N) + N) % N;
    holdUntil = performance.now() + STEP_MS;
    place(true);
  }

  const onPrev = () => go(Math.round(pos) - 1);
  const onNext = () => go(Math.round(pos) + 1);
  const onDot = e => {
    const b = e.target.closest(".tst-dot");
    if (b) go(+b.dataset.i);
  };
  /* Theirs listens on the whole carousel region, so the arrow keys step it
     whether focus is on a slide or on either arrow button (read from their
     chunk 1204: ArrowLeft scrollPrev, ArrowRight scrollNext, preventDefault).
     The dots sit outside that region on theirs and ignore the keys. */
  const onKey = e => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key === "ArrowLeft") { onPrev(); e.preventDefault(); }
    if (e.key === "ArrowRight") { onNext(); e.preventDefault(); }
  };

  const prev = root.querySelector(".tst-prev");
  const next = root.querySelector(".tst-next");
  const dotRow = root.querySelector(".tst-dots");
  prev.addEventListener("click", onPrev);
  next.addEventListener("click", onNext);
  dotRow.addEventListener("click", onDot);
  const stage = root.querySelector(".tst-stage");
  stage.addEventListener("keydown", onKey);

  /* ---- auto-scroll ---- */
  let hovered = false, focusIn = false, onScreen = false;
  let ramp = 0;           /* 0..1, linear in time over AUTO_EASE_MS */
  let speed = 0;          /* share of AUTO_PX_PER_S, eased from ramp */
  let raf = 0, last = 0;
  const wantPlay = () => !hovered && !focusIn && !reduced.matches;
  const live = () => onScreen && !document.hidden && !reduced.matches &&
    (wantPlay() || speed > 0);

  function frame(now) {
    raf = 0;
    const dt = last ? Math.min(AUTO_MAX_DT, now - last) : 0;
    last = now;
    /* An ease-out on position, both ways: stopping, the speed falls as
       (1 - t)^2, the derivative of their ease-out curve; starting, it
       rises the mirror way, so the row answers at once and settles in. */
    const up = wantPlay();
    ramp = Math.min(1, Math.max(0, ramp + (up ? 1 : -1) * (dt / AUTO_EASE_MS)));
    speed = up ? 1 - (1 - ramp) * (1 - ramp) : ramp * ramp;
    if (speed > 0 && step > 0 && now >= holdUntil) {
      pos = (pos + (speed * AUTO_PX_PER_S * dt) / 1000 / step) % N;
      place(false);
    }
    if (live()) raf = requestAnimationFrame(frame);
  }
  function update() {
    /* While it moves on its own, polite announcements would read a new
       card every few seconds; the region goes quiet until it stops. */
    viewport.setAttribute("aria-live", wantPlay() && !reduced.matches ? "off" : "polite");
    if (live()) {
      if (!raf) { last = 0; raf = requestAnimationFrame(frame); }
    } else if (raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
  }

  /* Theirs puts these on the carousel region, which holds the slides and
     both arrows but not the dots. */
  const onEnter = () => { hovered = true; update(); };
  const onLeave = () => { hovered = false; update(); };
  const onFocusIn = () => { focusIn = true; update(); };
  const onFocusOut = e => {
    if (stage.contains(e.relatedTarget)) return;
    focusIn = false;
    update();
  };
  const onVis = () => update();
  stage.addEventListener("pointerenter", onEnter);
  stage.addEventListener("pointerleave", onLeave);
  stage.addEventListener("focusin", onFocusIn);
  stage.addEventListener("focusout", onFocusOut);
  document.addEventListener("visibilitychange", onVis);
  /* Under reduced motion theirs never installs the plugin. A change of the
     setting mid-session is honoured here without a reload; stopping snaps
     to the nearest whole card, the finished state. */
  const onReduced = () => {
    if (reduced.matches) { ramp = speed = 0; go(Math.round(pos)); }
    update();
  };
  reduced.addEventListener("change", onReduced);

  /* Offscreen it stops and pos stays where it was: the bank. */
  const io = new IntersectionObserver(entries => {
    onScreen = entries[entries.length - 1].isIntersecting;
    update();
  });
  io.observe(stage);

  const ro = new ResizeObserver(layout);
  ro.observe(viewport);
  layout();
  update();

  return () => {
    if (raf) cancelAnimationFrame(raf);
    io.disconnect();
    ro.disconnect();
    prev.removeEventListener("click", onPrev);
    next.removeEventListener("click", onNext);
    dotRow.removeEventListener("click", onDot);
    stage.removeEventListener("keydown", onKey);
    stage.removeEventListener("pointerenter", onEnter);
    stage.removeEventListener("pointerleave", onLeave);
    stage.removeEventListener("focusin", onFocusIn);
    stage.removeEventListener("focusout", onFocusOut);
    document.removeEventListener("visibilitychange", onVis);
    reduced.removeEventListener("change", onReduced);
  };
}
