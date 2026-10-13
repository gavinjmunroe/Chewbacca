// Getting around the glass, for Realm on the Chewbacca glass.
//
// Realm is Carlton Aikins' agent workspace (github.com/31Carlton7/realm); his
// renderer runs unmodified and this file is part of our layer over it
// (bin/lib/realm_ui/glass). Pure, so node --test holds it.
//
// Caleb's first live open, 2026-10-12 3:38pm: "Bro wtf is this ux I can't
// navigate anything???" The glass had opened straight into a 2-day-old
// Gemini session that died on sign-in, and the only ways out were Escape
// (invisible), a small x over his desktop icons, and grey Transcript and
// Reply words. These are the rules that make that open impossible; the
// spec is skills/hud/SKILL.md, "Getting around".

/** No tile picked. Every opening starts here, so a stray Return (or a
 *  sentence to the talk key) can't open whichever tile happened to be
 *  first. */
export const NO_PICK = -1;
/** Tiles per row in the field (glass.css, .glass-tiles). */
export const COLS = 3;

/** What every opening of the glass shows: the tiles, nothing focused,
 *  nothing picked. Never the agent that was up last time. */
export const opening = () =>
  Object.freeze({ mode: "tiles", focus: null, picked: NO_PICK });

/** One key on the tiles. Arrows pick (the first press picks the first
 *  tile); Return opens only a tile he picked. */
export function tileKey(picked, n, key, cols = COLS) {
  if (!n) return { picked: NO_PICK, open: false, handled: false };
  const move = {
    ArrowRight: 1,
    ArrowLeft: -1,
    ArrowDown: cols,
    ArrowUp: -cols,
  }[key];
  if (move) {
    const next = picked < 0 ? 0 : Math.min(n - 1, Math.max(0, picked + move));
    return { picked: next, open: false, handled: true };
  }
  if (key === "Enter") {
    const open = picked >= 0 && picked < n;
    return { picked, open, handled: open };
  }
  return { picked, open: false, handled: false };
}

/** Whether the tiles can be drawn yet. Until every tab's state is in, the
 *  only tiles drawable are realm's own sessions, so drawing early showed
 *  the one dead Gemini session alone, first and picked (10/12 3:38pm). */
export function tilesReady({ listed, faulted, needTruth, truthAsked }) {
  return Boolean(listed && !faulted && (!needTruth || truthAsked));
}

// The most realm-run sessions whose recent events are read when the list
// arrives. Twelve covers the nine tiles plus a few; each read is one
// sessions.events call (max 4.8 ms for 400 events at load 16, 10/11).
export const SEED_MAX = 12;
// Events read back per session: enough for the end of a turn and its error.
export const SEED_EVENTS = 120;

/** Realm's own sessions (no Claude Code tab behind them) whose tile would
 *  otherwise only know realm's status word: "ended" hid a turn that died on
 *  sign-in. Newest first, at most SEED_MAX, each once per event seq. */
export function toSeed(
  sessions,
  agents = {},
  seeded = new Set(),
  max = SEED_MAX,
) {
  return sessions
    .filter((s) => !s.providerSessionId && (s.lastEventSeq ?? 0) > 0)
    .filter(
      (s) => !agents[s.id]?.turn && !seeded.has(`${s.id}:${s.lastEventSeq}`),
    )
    .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
    .slice(0, max);
}

/** What the glass does when his own frame moves focus: a row in his
 *  sidebar, his palette, his New session, a rail page. Before 10/12 his
 *  frame was hidden, so only our buttons moved the glass; now his are on
 *  screen in every mode and each press of his lands somewhere visible.
 *
 *  `before`/`after` are the session his focused pane showed before and
 *  after the change (null for none). `known` says whether `after` is an
 *  agent the glass already lists. `page` is whether one of his rail pages
 *  (Library, Code review...) is up, `pageBefore` whether it was.
 *
 *  `pressed` says whether he pressed something in his frame just now.
 *
 *  Returns null when nothing should move, else the mode and focus to take.
 *  Only a CHANGE of his focus that HE made counts. His store fires on every
 *  event, and on boot it restores the last layout by itself: the first
 *  build of this, 10/12 4:45pm, followed that restore and opened the glass
 *  straight into the dead Gemini session, the 3:38pm bug again. */
export function followHis({ mode, before, after, known, page, pageBefore, pressed }) {
  if (!pressed) return null;
  if (page && !pageBefore && mode !== "work") return { mode: "work", focus: null, keep: true };
  if (!after || after === before) return null;
  if (!known) return { mode: "work", focus: after, keep: false };
  return { mode: mode === "work" ? "work" : "story", focus: after, keep: false };
}

/** A press on one of his sidebar's session rows that didn't move his
 *  focus. Only the row his app already marks as showing (data-active) can
 *  mean "this one": that is the restored session, pressed on purpose. Any
 *  other row that didn't move his focus (an imported tab still opening, a
 *  profile switch in flight, a ⌘-click that opens beside) is never
 *  guessed at: the review of 10/12 found the first version opened whatever
 *  his layout had restored, the dead Gemini "Hello", on such a press. */
export function followRow({ mode, rowActive, focused, known, current }) {
  if (!rowActive || !focused) return null;
  if (mode !== "tiles" && focused === current) return null;
  if (!known) return { mode: "work", focus: focused, keep: false };
  return { mode: mode === "work" ? "work" : "story", focus: focused, keep: false };
}

/** The labeled buttons the glass bar shows in each mode. One press each to
 *  every agent, another agent (his sidebar), and a new one, from any state
 *  (skills/hud/SKILL.md, "Getting around"). */
export function barButtons(mode, focused) {
  const out = ["All agents"];
  if (focused && mode !== "tiles") out.push("Story", "Transcript");
  out.push("New agent", "Close");
  return out;
}
