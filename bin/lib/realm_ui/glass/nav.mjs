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
