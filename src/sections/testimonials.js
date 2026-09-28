/* Section D: the testimonial carousel.

   THE ERROR THIS FILE EXISTS TO FIX: the previous build let the track run full
   bleed, so at 2560 wide it showed seven cards edge to edge and the section
   stopped agreeing with every other block on the page. The reference keeps the
   row inside the same content column as the headline above it. So the column
   is declared once, in `.tst-col` as `min(var(--maxw), 100%)` centred, and the
   scrolling row lives inside an `overflow: hidden` viewport nested in it.
   Nothing here can escape the column, at any viewport width.

   Card width is DERIVED, not chosen. Measured on the reference: cards sit
   between 340 and 356px wide with three of them visible in a 1200px column.
   1200 - 3x352 - 2x16 of gap = 112px left over, which is why each edge card
   shows a 56px sliver: the leftovers, split. Change the column width and the
   same arithmetic re-derives the card, which is what `layout()` does.

   The row is a RING, not a strip with two ends. Each card is placed at a
   signed slot relative to the active index, modulo the item count, so the slot
   left of the window and the slot right of it are always occupied by a real
   card. That is what makes the faded edges read as "the row continues" rather
   than as "the row ran out". A card that wraps from one end of the ring to the
   other would otherwise slide the whole width of the window on its way round,
   so a wrapping card is moved with its transition suppressed for that frame.

   Renders the carousel machinery only. The section's label and headline belong
   to the page shell, so putting them here would print them twice. */

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

/* Reference gap between cards, read off their track. The card width in
   `layout()` is solved against this, so it is load-bearing rather than taste. */
const GAP = 16;

/* Their step transition. `lemma-cl-entry` ships as
   cubic-bezier(.33,1,.68,1) and 450ms is the second most common duration in
   their stylesheet after 220ms, which is too fast to read across 350px. */
const STEP_MS = 450;
const STEP_EASE = "cubic-bezier(.33,1,.68,1)";

const initials = name =>
  name.split(/\s+/).slice(0, 2).map(w => w[0]).join("").toUpperCase();

export function render() {
  const cards = ITEMS.map((t, i) => `
      <figure class="tst-card" data-i="${i}" role="group"
              aria-roledescription="testimonial" aria-label="${i + 1} of ${ITEMS.length}">
        <header class="tst-head">
          <span class="tst-avatar" aria-hidden="true">${initials(t.name)}</span>
          <span class="tst-who">
            <span class="tst-name">${t.name}</span>
            <span class="tst-meta">
              <svg class="tst-mark" viewBox="0 0 10 10" width="8" height="8" aria-hidden="true">
                <path d="M5 0 10 2.6 5 5.2 0 2.6z" fill="currentColor"/>
                <path d="M0 5.6 5 8.2 10 5.6" fill="none" stroke="currentColor" stroke-width="1"/>
              </svg>
              <span class="tst-co">${t.company}</span>
              <span class="tst-handle">${t.handle}</span>
            </span>
          </span>
        </header>
        <blockquote class="tst-quote">${t.quote}</blockquote>
      </figure>`).join("");

  const dots = ITEMS.map((t, i) => `
        <button class="tst-dot" type="button" data-i="${i}"
                aria-label="Show testimonial ${i + 1}, ${t.name}"><i></i></button>`).join("");

  /* THE HEADING. Theirs carries an h2 reading "What teams tell us." and
     ours had none at all, which is why the section walk could not see this
     section: it finds sections from headings, so a section without one is
     invisible to every measurement in docs/. Centred, matching theirs. */
  return `
    <div class="tst-col">
      <div class="tst-head-block">
        <div class="label">Testimonials</div>
        <h2 class="tst-title">What teams tell us.</h2>
      </div>
      <button class="tst-arrow tst-prev" type="button" aria-label="Previous testimonial">&larr;</button>
      <div class="tst-viewport" tabindex="0" role="region"
           aria-roledescription="carousel" aria-label="Testimonials">
        <div class="tst-track">${cards}</div>
      </div>
      <button class="tst-arrow tst-next" type="button" aria-label="Next testimonial">&rarr;</button>
      <div class="tst-dots" role="tablist" aria-label="Choose a testimonial">${dots}</div>
    </div>`;
}

export function mount(root) {
  const col = root.querySelector(".tst-col");
  const viewport = root.querySelector(".tst-viewport");
  const cards = [...root.querySelectorAll(".tst-card")];
  const dots = [...root.querySelectorAll(".tst-dot")];
  if (!col || !viewport || !cards.length) return;

  const N = cards.length;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  let index = 0, step = 0, peek = 0;
  const lastSlot = new Map();

  /* Solve the card width from the column, never the other way round. The
     column is whatever the page gives it, capped at --maxw by the CSS, so
     reading it back is the only way the arithmetic stays true at 2560. */
  function layout() {
    const style = getComputedStyle(root);
    const visible = Math.max(1, parseInt(style.getPropertyValue("--tst-visible"), 10) || 3);
    peek = parseFloat(style.getPropertyValue("--tst-peek")) || 0;
    const w = viewport.clientWidth;
    const card = (w - (visible - 1) * GAP - 2 * peek) / visible;
    step = card + GAP;
    root.style.setProperty("--tst-card", `${card.toFixed(2)}px`);
    place(false);
  }

  /* Signed slot on the ring: 0 is the first fully visible card, -1 is the
     sliver on the left, `visible` is the sliver on the right. */
  const slotOf = i => {
    const r = ((i - index) % N + N) % N;
    return r <= N / 2 ? r : r - N;
  };

  function place(animate) {
    for (const cardEl of cards) {
      const s = slotOf(+cardEl.dataset.i);
      const was = lastSlot.get(cardEl);
      /* A card crossing the seam of the ring travels the whole window on its
         way round. Suppress its transition for that one frame instead. */
      const wrapped = was !== undefined && Math.abs(s - was) > 1;
      cardEl.style.transition = (!animate || wrapped || reduced.matches) ? "none"
        : `transform ${STEP_MS}ms ${STEP_EASE}`;
      cardEl.style.transform = `translate3d(${(peek + s * step).toFixed(2)}px,0,0)`;
      cardEl.setAttribute("aria-hidden", s < 0 || s > 2 ? "true" : "false");
      lastSlot.set(cardEl, s);
    }
    dots.forEach((d, k) => {
      const on = k === index;
      d.classList.toggle("on", on);
      d.setAttribute("aria-selected", on ? "true" : "false");
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
  const onKey = e => {
    if (e.key === "ArrowLeft") { onPrev(); e.preventDefault(); }
    if (e.key === "ArrowRight") { onNext(); e.preventDefault(); }
  };

  root.querySelector(".tst-prev").addEventListener("click", onPrev);
  root.querySelector(".tst-next").addEventListener("click", onNext);
  root.querySelector(".tst-dots").addEventListener("click", onDot);
  viewport.addEventListener("keydown", onKey);

  const ro = new ResizeObserver(layout);
  ro.observe(viewport);
  layout();

  return () => {
    ro.disconnect();
    root.querySelector(".tst-prev").removeEventListener("click", onPrev);
    root.querySelector(".tst-next").removeEventListener("click", onNext);
    root.querySelector(".tst-dots").removeEventListener("click", onDot);
    viewport.removeEventListener("keydown", onKey);
  };
}
