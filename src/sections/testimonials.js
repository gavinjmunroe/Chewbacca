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
  let index = 0, step = 0, start = 0, width = 0, card = 0;
  const lastSlot = new Map();

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
    const r = ((i - index) % N + N) % N;
    return r <= N / 2 ? r : r - N;
  };

  function place(animate) {
    for (const cardEl of cards) {
      const s = slotOf(+cardEl.dataset.i);
      const was = lastSlot.get(cardEl);
      const wrapped = was !== undefined && Math.abs(s - was) > 1;
      /* Only the slide duration is set here. The hover lift and border in
         testimonials.css ride the same transition list, and an inline
         `transition` would have overwritten them. */
      cardEl.style.setProperty("--tst-move",
        (!animate || wrapped || reduced.matches) ? "0ms" : `${STEP_MS}ms`);
      const x = start + s * step;
      cardEl.style.transform = `translate3d(${x.toFixed(2)}px,0,0)`;
      /* Only a card wholly inside the window is announced. */
      const whole = x >= -0.5 && x + card <= width + 0.5;
      cardEl.setAttribute("aria-hidden", whole ? "false" : "true");
      lastSlot.set(cardEl, s);
    }
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

  function go(to) {
    index = ((to % N) + N) % N;
    place(true);
  }

  const onPrev = () => go(index - 1);
  const onNext = () => go(index + 1);
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

  const ro = new ResizeObserver(layout);
  ro.observe(viewport);
  layout();

  return () => {
    ro.disconnect();
    prev.removeEventListener("click", onPrev);
    next.removeEventListener("click", onNext);
    dotRow.removeEventListener("click", onDot);
    stage.removeEventListener("keydown", onKey);
  };
}
