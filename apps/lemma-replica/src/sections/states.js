/* Keyboard operation for the pinned feature panels.

   THE ONE CROSS-CUTTING MODULE. Every other section module queries only
   inside its own mount root; this one is mounted on document.body, because
   the thing it serves (the four feature blocks in #demoText and the panel
   stack in #demoStage) is written by app.js, not by a section module, and
   the rule is that nobody edits app.js but its owner.

   What theirs does: nothing. The four text blocks are plain content that
   scrolls past one sticky panel, and a keyboard user reaches the panels only
   by scrolling the page. Ours keeps that and adds a tab stop per block:

     Tab / Shift+Tab     land on a block; the page scrolls that block to the
                         viewport centre, which is exactly where app.js's
                         nearest-centre test switches its panel in, with the
                         same 500ms crossfade a scroll produces.
     ArrowDown/PageDown  next block      ArrowUp/PageUp  previous block
     Home / End          first / last block

   Nothing here touches the panel classes. app.js decides which panel is on
   from the scroll position, so moving the scroll position is the whole
   interface, and the two can never disagree about which panel is showing. */

const KEYS_NEXT = new Set(["ArrowDown", "PageDown"]);
const KEYS_PREV = new Set(["ArrowUp", "PageUp"]);

export function mount(root) {
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const text = root.querySelector("#demoText");
  if (!text) return () => {};

  let blocks = [];
  const cleanups = [];

  /* Centre of the block on the centre of the viewport: app.js picks the block
     whose centre is nearest the viewport's, so this lands the matching panel
     with no threshold to miss. */
  function centre(block) {
    const r = block.getBoundingClientRect();
    const top = window.scrollY + r.top + r.height / 2 - window.innerHeight / 2;
    window.scrollTo({ top, behavior: reduced.matches ? "auto" : "smooth" });
  }

  function go(to) {
    const k = Math.max(0, Math.min(blocks.length - 1, to));
    blocks[k].focus({ preventScroll: true });
    centre(blocks[k]);
  }

  function onKey(e) {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const i = blocks.indexOf(e.target);
    if (i < 0) return;
    if (KEYS_NEXT.has(e.key)) go(i + 1);
    else if (KEYS_PREV.has(e.key)) go(i - 1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(blocks.length - 1);
    else return;
    e.preventDefault();
  }

  /* Tab moves focus first and the browser scrolls the block only as far as
     it needs to show it, which can leave it off centre and the previous
     panel showing. Re-centre on every focus that arrives from outside. */
  function onFocus(e) {
    if (blocks.includes(e.target)) centre(e.target);
  }

  function wire() {
    blocks = [...text.querySelectorAll(".feat-block")];
    if (!blocks.length) return false;
    blocks.forEach((b, i) => {
      b.tabIndex = 0;
      b.setAttribute("role", "group");
      const h = b.querySelector("h2");
      if (h) {
        if (!h.id) h.id = `feat-h-${i}`;
        b.setAttribute("aria-labelledby", h.id);
      }
      b.setAttribute(
        "aria-roledescription",
        `feature ${i + 1} of ${blocks.length}`,
      );
    });
    text.addEventListener("keydown", onKey);
    text.addEventListener("focusin", onFocus);
    cleanups.push(() => {
      text.removeEventListener("keydown", onKey);
      text.removeEventListener("focusin", onFocus);
    });
    return true;
  }

  /* app.js fills #demoText before the section modules mount, so this is
     normally immediate. If the order ever changes, wait for the blocks
     instead of silently wiring nothing. */
  if (!wire()) {
    const mo = new MutationObserver(() => {
      if (wire()) mo.disconnect();
    });
    mo.observe(text, { childList: true });
    cleanups.push(() => mo.disconnect());
  }

  return () => cleanups.forEach((f) => f());
}
