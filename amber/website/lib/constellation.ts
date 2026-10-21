/**
 * DISTANCE MEANS ONE THING: HOW CLOSE YOU ACTUALLY ARE.
 *
 * Three layouts preceded this one and each failed the same way -- by making
 * position carry two meanings at once. The first put shared employers into
 * packed islands, so a dot's position said both "you rarely speak" and "works
 * at PWC", and the ring drawn around an island asserted membership for whoever
 * happened to land inside it. That is not a rendering bug that can be patched
 * out; it is what happens when a picture claims more than the data says.
 *
 * SO GROUPS LEFT THE LAYOUT. A shared company or school is now a COLOR on the
 * rim of a dot and a chip in the legend, and clicking the chip lights its
 * members wherever they are. Color can say "these seven" without saying
 * anything at all about "and nobody else near them", which is exactly the
 * property a ring does not have. It also handles the thing islands could not:
 * one person in three groups gets three arcs, rather than being filed under
 * whichever one the layout picked first.
 *
 * WHAT IS LEFT IS ONE AXIS, and it is the axis worth having. Near the center is
 * who you talk to. Far out is who you do not.
 *
 *   THE LIVE FIELD holds everybody with real interaction history, ordered by
 *   it. Rank sets the radius, not the raw score, because on a real book the
 *   scores bunch -- a few hundred people share a floor value to three decimal
 *   places, and mapping that directly is how the first version drew a clock
 *   face. Rank cannot bunch.
 *
 *   THE QUIET FIELD is everybody else, in a band far enough out that there is
 *   visible empty space between it and the people you deal with. No spokes are
 *   drawn to it. Its distance is the statement.
 *
 * BOTH FIELDS ARE PHYLLOTAXIS -- position n at n x 137.5 degrees, radius by
 * area rather than by index, which is how a sunflower keeps its density even
 * from the middle to the rim. The golden angle never repeats, so no two dots
 * share a spoke and no ring can form. Nothing has to be checked against
 * anything else, so there is no collision pass and no randomness: the same
 * data draws the same picture every time it is opened.
 */

import type { GraphNode, NetworkGroup } from "./amber";

export type PlacedNode = GraphNode & {
  x: number;
  y: number;
  r: number;
  /** Two letters at most, drawn inside the dot. */
  initials: string;
  /** In the outer band: no recent contact, no spoke drawn. */
  quiet: boolean;
};

/** 137.507...deg, the angle that never lines up with itself. */
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/** Below this tie strength somebody is in the quiet field. */
export const QUIET_BELOW = 0.17;

/** How far the first dot sits from the center, leaving the owner room. */
const INNER_GAP = 340;
/** Clear space between the people you deal with and the ones you do not. */
const QUIET_GAP = 1100;

/**
 * Area each dot is given, which is what sets the gap between neighbours.
 * Roughly spacing squared: a point every sqrt(area) units in each direction.
 *
 * Generous on purpose. The canvas is infinite and the screen is not, so the
 * only cost of spreading out is a smaller starting zoom -- and a field with
 * air in it can carry a name beside a dot, which a tight one cannot. The first
 * version packed tightly and then had to pile twenty labels on top of each
 * other in the middle.
 */
const LIVE_AREA = 178 * 178;
const QUIET_AREA = 250 * 250;

/**
 * THE PEOPLE YOU ACTUALLY TALK TO GET A ROOM OF THEIR OWN.
 *
 * One continuous spiral gave your closest eight people exactly as much space
 * each as your hundred-and-fiftieth, so the part of the picture you came to
 * look at was the most crowded part of it. Density was uniform by
 * construction, and uniform density is the one thing a network is not.
 *
 * So the live field is two tiers now. The first `INNER_CIRCLE` dots are laid
 * out at `CLOSE_AREA` -- nearly three times the room -- and the rest begin
 * `TIER_GAP` further out, with their area easing back down to `LIVE_AREA`
 * over `DENSITY_RAMP` places so there is no visible cliff where one ends and
 * the other starts.
 *
 * THIS ASSERTS NOTHING NEW. Radius already meant strength; the tier is the
 * same axis, read at a glance instead of inferred from a gradient. That is
 * the whole difference between this and the grouped layouts that failed:
 * those made position carry a second meaning, and this makes it carry the
 * first one louder.
 */
export const INNER_CIRCLE = 8;
const CLOSE_AREA = 300 * 300;
const DENSITY_RAMP = 24;
const TIER_GAP = 200;

/**
 * Initials that a person would recognize as themselves.
 *
 * Two tokens give two letters. One token gives one. A name that is an email
 * address or a phone number gives its first alphanumeric character rather than
 * an "@", because a dot labelled "@" is worse than a dot labelled nothing.
 */
export function initialsOf(name: string): string {
  const raw = String(name ?? "").trim();
  // A contact whose name is an email address should initial from the person,
  // not the mail host: "jose@example.com" is J, not JC.
  const source = raw.includes("@") ? raw.slice(0, raw.indexOf("@")) : raw;
  const cleaned = source.replace(/[^\p{L}\p{N}\s'-]/gu, " ").trim();
  if (!cleaned) return "?";
  const tokens = cleaned.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return "?";
  // A name with no letters in it is a phone number somebody saved without one.
  // "1" beats "19", which reads as a pair of initials and is not one.
  if (!/\p{L}/u.test(cleaned)) return tokens[0].slice(0, 1);
  if (tokens.length === 1) return tokens[0].slice(0, 1).toUpperCase();
  const first = tokens[0].slice(0, 1);
  const last = tokens[tokens.length - 1].slice(0, 1);
  return (first + last).toUpperCase();
}

/**
 * Dot radius.
 *
 * Big enough that initials inside it are readable rather than a smudge, which
 * is the whole reason a dot is worth having: at these sizes a contact says who
 * it is at a glance instead of on a click. Quiet dots are smaller but not
 * tiny -- they still carry their initials once you zoom in on them.
 */
export function dotRadius(n: GraphNode, rank = Infinity): number {
  if (n.kind === "owner") return 96;
  if (n.strength < QUIET_BELOW) return 40;
  // The inner tier has the room, so it gets the size. Capped below the owner
  // on purpose: you are still the biggest thing in your own network.
  if (rank < INNER_CIRCLE) return 48 + n.strength * 40;
  return 34 + n.strength * 36;
}

/**
 * The biggest a dot may get before it touches its neighbour.
 *
 * Spreading the field further out does NOT make dots look bigger, because the
 * opening zoom follows the extent -- everything scales together and the
 * picture is identical. What changes how substantial a node looks is its size
 * RELATIVE to the gap, and that has a hard ceiling: phyllotaxis puts
 * neighbours about 0.9*sqrt(area) apart, so two dots collide once a radius
 * passes 0.45 of that. Exported so a test can hold the ratio rather than a
 * comment promising it.
 */
export const maxRadiusFor = (area: number) => 0.45 * 0.9 * Math.sqrt(area);

/**
 * THE GAP TWO DOTS MUST LEAVE BETWEEN THEM.
 *
 * "There is still overlap. There does not need to be." The geometry test said
 * otherwise, and both were right: it asserted `distance >= r1 + r2`, which is
 * the condition for two circles to TOUCH. Two dots sharing a tangent line have
 * not overlapped by any definition a test can fault, and they read as one
 * smudge. A spacing rule that permits tangency is not a spacing rule.
 */
export const MIN_CLEARANCE = 24;
export const LIVE_SPACING_AREA = LIVE_AREA;
export const QUIET_SPACING_AREA = QUIET_AREA;
export const CLOSE_SPACING_AREA = CLOSE_AREA;

/**
 * A HUE PER GROUP, FOR ANY NUMBER OF GROUPS.
 *
 * A fixed palette runs out -- a real book has two dozen companies and schools
 * in it -- and the moment it wraps, two chips are the same color and the
 * legend is lying. Stepping the hue by the golden angle never wraps onto a
 * hue it has already used, so the twenty-fifth group is as distinguishable as
 * the second. Saturation and lightness are held where they read on the dark
 * ground; only the hue moves.
 */
export function groupColor(index: number): string {
  const hue = (index * 137.508) % 360;
  const lightness = 62 + ((index % 3) - 1) * 6;
  return `hsl(${hue.toFixed(1)} 58% ${lightness}%)`;
}

/**
 * THE KEY MUST NEVER BE EMPTY WHILE THE DOTS ARE COLORED.
 *
 * The arcs on a dot are drawn from that node's own `groupKeys`; the key is
 * built from the separate `groups` list. A server that sends one without the
 * other produces a screen full of colors and nothing to read them by, which is
 * worse than no color at all -- and that is exactly what shipped.
 *
 * So the key is derived rather than trusted. When the list is there it is
 * used; when it is not, the groups are reconstructed from the nodes, which
 * already carry everything needed: the contacts hold the membership and the
 * hub nodes hold the label and the count. Either way the key describes the
 * same thing the arcs do, because both now come from the same field.
 */
export function resolveGroups(
  nodes: GraphNode[],
  groups: NetworkGroup[] = [],
): NetworkGroup[] {
  if (groups.length > 0) return groups;

  const members = new Map<string, string[]>();
  for (const n of nodes) {
    if (n.kind !== "contact") continue;
    for (const k of n.groupKeys ?? []) {
      const list = members.get(k);
      if (list) list.push(n.id);
      else members.set(k, [n.id]);
    }
  }
  const labels = new Map<string, string>();
  for (const n of nodes) {
    if (n.kind !== "organization" && n.kind !== "domain") continue;
    labels.set(n.id.slice(n.id.indexOf(":") + 1), n.name);
  }

  return [...members.entries()]
    .map(([key, memberIds]) => ({
      key,
      id: key,
      label: labels.get(key) ?? key,
      // Server-generated keys are prefixed so they cannot collide with a real
      // company's; that prefix is also how a category is recognized here.
      kind: (key.startsWith("__") ? "category" : "organization") as NetworkGroup["kind"],
      memberCount: memberIds.length,
      memberIds,
    }))
    .sort(
      (a, b) =>
        (a.kind === "category" ? 0 : 1) - (b.kind === "category" ? 0 : 1) ||
        b.memberCount - a.memberCount ||
        a.label.localeCompare(b.label),
    );
}

/** Group key to color, in the order the server sent them (biggest first). */
export function groupColors(groups: NetworkGroup[]): Map<string, string> {
  const out = new Map<string, string>();
  groups.forEach((g, i) => out.set(g.key, groupColor(i)));
  return out;
}

/** Radius of the nth dot in a field that starts at `r0` and gives each dot `area`. */
function radiusAt(index: number, r0: number, area: number): number {
  return Math.sqrt(r0 * r0 + index * area);
}

/** Room given to the dot at this rank in the live field. */
function areaForRank(rank: number): number {
  if (rank < INNER_CIRCLE) return CLOSE_AREA;
  const eased = Math.max(0, 1 - (rank - INNER_CIRCLE) / DENSITY_RAMP);
  return LIVE_AREA + (CLOSE_AREA - LIVE_AREA) * eased;
}

/**
 * Every live dot's distance from the center, in rank order.
 *
 * Area varies per rank, so radius is a running total rather than a closed
 * form: r(n)^2 = INNER_GAP^2 + sum of the areas before n. Same property as
 * before -- each dot keeps the room it was given, and no dot is placed by
 * looking at where another one landed, so the picture is still identical on
 * every reload.
 */
export function liveRadii(count: number): number[] {
  const out: number[] = [];
  let squared = INNER_GAP * INNER_GAP;
  for (let rank = 0; rank < count; rank += 1) {
    out.push(Math.sqrt(squared) + (rank >= INNER_CIRCLE ? TIER_GAP : 0));
    squared += areaForRank(rank);
  }
  return out;
}

export function buildConstellation(
  nodes: GraphNode[],
): { placed: PlacedNode[]; quietStart: number } {
  const owner = nodes.find((n) => n.kind === "owner");
  const contacts = nodes.filter((n) => n.kind === "contact");

  // Strongest first; name then id so the arrangement is byte-identical on
  // every reload. Two people with the same strength must not swap places
  // between renders, or the graph appears to move on its own.
  const order = (a: GraphNode, b: GraphNode) =>
    b.strength - a.strength || a.name.localeCompare(b.name) || a.id.localeCompare(b.id);

  const live = contacts.filter((n) => n.strength >= QUIET_BELOW).sort(order);
  const quiet = contacts.filter((n) => n.strength < QUIET_BELOW).sort(order);

  const placed: PlacedNode[] = [];
  if (owner) {
    placed.push({ ...owner, x: 0, y: 0, r: dotRadius(owner), initials: "", quiet: false });
  }

  const radii = liveRadii(live.length);
  live.forEach((n, i) => {
    const r = radii[i];
    const a = i * GOLDEN_ANGLE;
    placed.push({
      ...n,
      x: Math.cos(a) * r,
      y: Math.sin(a) * r,
      r: dotRadius(n, i),
      initials: initialsOf(n.name),
      quiet: false,
    });
  });

  const liveEdge = radii.length ? radii[radii.length - 1] : INNER_GAP;
  const quietStart = liveEdge + QUIET_GAP;

  // THE OUTER FIELD IS ONE BAND AGAIN.
  //
  // It was briefly arranged into arcs by where each contact came from -- apple
  // here, google there, seams for people in both. The reasoning held up and it
  // looked wrong: a ring chopped into labelled wedges reads as a chart about
  // provenance, and nobody opens their own network to study which address book
  // a name arrived in. The origins are still on every node and still named in
  // the hover card, so the fact is one line away without being the shape of
  // the whole picture.
  quiet.forEach((n, i) => {
    const r = radiusAt(i, quietStart, QUIET_AREA);
    // Offset so the outer band's spiral does not line up with the inner one's,
    // which would read as spokes running through the empty gap.
    const a = i * GOLDEN_ANGLE + Math.PI / 4;
    placed.push({
      ...n,
      x: Math.cos(a) * r,
      y: Math.sin(a) * r,
      r: dotRadius(n),
      initials: initialsOf(n.name),
      quiet: true,
    });
  });

  return { placed, quietStart };
}

/** The bounding radius of everything placed. */
export function extentOf(placed: PlacedNode[]): number {
  let max = 200;
  for (const p of placed) max = Math.max(max, Math.hypot(p.x, p.y) + p.r);
  return max;
}

/**
 * THE VIEW OPENS ON THE PEOPLE YOU KNOW, NOT ON THE WHOLE BOOK.
 *
 * Fitting all 966 contacts on a screen means a zoom at which every dot is a
 * few pixels and no name can be drawn beside it without colliding with three
 * others -- which is the jumble in the middle, and no amount of spacing fixes
 * it, because spreading further out only zooms further away.
 *
 * So the first view frames the live field: everyone with real interaction
 * history, at a zoom where a dot is big enough to hold its initials and a name
 * fits under it. The quiet field is still there, one scroll out. Somebody
 * opening their network wants to see the people in it, and the people they
 * never speak to are exactly the ones that can wait for a deliberate zoom.
 */
export function liveExtentOf(placed: PlacedNode[]): number {
  let max = 0;
  for (const p of placed) {
    if (p.quiet) continue;
    max = Math.max(max, Math.hypot(p.x, p.y) + p.r);
  }
  // A book with nobody live in it still has to frame something.
  return max > 0 ? max : Math.min(extentOf(placed), INNER_GAP * 3);
}
