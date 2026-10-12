// One owner per region of the glass, for Realm on the Chewbacca glass.
//
// Realm is Carlton Aikins' agent workspace (github.com/31Carlton7/realm); his
// renderer runs unmodified and this file is part of our layer over it
// (bin/lib/realm_ui/glass). Daniel Thomas's review, 2026-10-11: like Rust's
// ownership, every region has exactly one component that draws it, and two
// things never draw in the same place. glass.css lays the layer out as a
// grid whose named areas are these regions, so the layout itself can't put
// two of them on one spot; tests/test_realm_regions.mjs holds this table, the
// components and the stylesheet to each other, and skills/hud/SKILL.md
// ("One owner per region") carries the same table for people.
//
// `grid` is the CSS grid the region is an area of (the layer's own, or the
// story's), `area` the area it fills in glass.css; `modes` are the layer
// modes it can be drawn in. The workspace is Carlton's app (#root),
// outside our layer, made narrower by glass.css; the light is the one region
// with no area: it exists only during a morph, over everything, then is gone.
export const REGIONS = Object.freeze([
  {
    id: "notice",
    owner: "Notice",
    grid: "layer",
    area: "notice",
    modes: ["tiles", "story", "work"],
    draws: "a fault no one agent owns (engine down, the talk key lost), with its one fix",
  },
  {
    id: "field",
    owner: "TileField",
    grid: "layer",
    area: "main",
    modes: ["tiles"],
    draws: "the agent tiles, one line each, a count of the rest, and the New agent door",
  },
  {
    id: "story",
    owner: "Story",
    grid: "layer",
    area: "main",
    modes: ["story"],
    draws: "one agent's turn told by the screen, in the five regions below",
  },
  {
    id: "ask",
    owner: "Story",
    grid: "story",
    area: "ask",
    modes: ["story"],
    draws: "what he asked, which agent, how long ago",
  },
  {
    id: "tell",
    owner: "Story",
    grid: "story",
    area: "tell",
    modes: ["story"],
    draws: "the one headline, the beat line from the typed turn, what proved it",
  },
  {
    id: "call",
    owner: "Story",
    grid: "story",
    area: "call",
    modes: ["story"],
    draws: "the one decision waiting on him, or the fault that stopped the story, with its press",
  },
  {
    id: "figure",
    owner: "Story",
    grid: "story",
    area: "figure",
    modes: ["story"],
    draws: "one object for the beat: the turn's file, command or tests, the request, the hunks",
  },
  {
    id: "doors",
    owner: "Story",
    grid: "story",
    area: "doors",
    modes: ["story"],
    draws: "Transcript and Reply, his full workspace one press away",
  },
  {
    id: "stage",
    owner: "Stage",
    grid: "layer",
    area: "main",
    modes: ["work"],
    draws: "the focused agent's current beat as one card, the beats before it one line each",
  },
  {
    id: "workspace",
    owner: "Carlton's app (#root)",
    grid: null,
    area: null,
    modes: ["work"],
    draws: "his conversation, composer and panes, untouched",
  },
  {
    id: "pick",
    owner: "FolderPick",
    grid: null,
    area: null,
    modes: ["work"],
    draws: "Choose folder on the glass, over his new space sheet: his repos and a path field",
  },
  {
    id: "light",
    owner: "Light",
    grid: null,
    area: null,
    modes: ["tiles", "story", "work"],
    draws: "the morph outline between a tile and the story, for 320 ms",
  },
]);
