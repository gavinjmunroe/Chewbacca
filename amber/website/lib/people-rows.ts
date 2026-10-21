/**
 * A PERSON AS A ROW, WITH THE REASON THEY ARE IN THE LIST.
 *
 * Four rounds went into making a field of 966 dots defensible, and the thing
 * that finally broke it was a card carrying the single word "Alex" sitting in
 * the owner's closest circle. A graph has to draw every contact somewhere, and
 * position makes a claim about all of them at once, so one unearned dot is
 * indistinguishable from a real friend until you click it.
 *
 * A RANKED ROW HAS TO JUSTIFY ITSELF. Every row here carries a `reason` --
 * what actually puts this person at this rank -- built only from fields the
 * server sent. When there is nothing to say, it says there is nothing to say,
 * which is a row somebody can dismiss in a glance rather than a dot they have
 * to investigate. That is the whole reason the list replaced the graph as the
 * first thing on the page.
 *
 * NO REASON IS EVER INVENTED. Every branch below reads a field. There is no
 * "probably" and no adjective the data did not earn, because the failure this
 * replaced was a label saying "spoke" about a number that meant "was CC'd".
 *
 * PURE. Nodes and groups in, rows out.
 */

import type { GraphNode, NetworkGroup } from "./amber";
import { initialsOf } from "./constellation";
import { sinceLabel } from "./relationship-label";

export type PersonRow = {
  id: string;
  name: string;
  initials: string;
  /** Title, company, city — whatever of those exist, in that order. */
  subtitle: string | null;
  /** The groups this person belongs to, for the colored chips. */
  groups: { key: string; label: string }[];
  /** "emailed 3 weeks ago", or null when nothing was ever recorded. */
  lastContact: string | null;
  /** Why this person is at this rank. Never empty. */
  reason: string;
  /** Other names this one row stands for, when cards were folded. */
  aliases: string[];
  entity: "person" | "place";
  strength: number;
};

const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"}`;

/**
 * Why this person ranks where they do.
 *
 * Ordered by how much the fact actually says about the relationship: real
 * exchanges first, then when you last spoke, then the shared context that is
 * the only thing left on a cold card, then the admission that there is
 * nothing. A search hit's own explanation wins over all of it, because when
 * somebody has typed a query the useful answer is what matched.
 */
export function reasonFor(
  node: GraphNode,
  groups: NetworkGroup[],
  now: number = Date.now(),
): string {
  const matched = String((node as { why?: string }).why ?? "").trim();
  if (matched) return matched;

  const count = Number(node.count90d ?? 0);
  if (count > 0) return `${plural(count, "exchange")} in the last 90 days`;

  const last = sinceLabel(node.lastAt, node.lastChannel, now);
  if (last) return last;

  const named = (node.groupKeys ?? [])
    .map((k) => groups.find((g) => g.key === k))
    .filter((g): g is NetworkGroup => Boolean(g) && g!.kind !== "category");
  if (named.length > 0) {
    const g = named[0];
    // "5 others" rather than "6 people", because the owner is asking what this
    // person shares with the REST of the book, not how big the group is.
    const others = Math.max(0, g.memberCount - 1);
    return others > 0
      ? `at ${g.label}, with ${plural(others, "other")} in your contacts`
      : `at ${g.label}`;
  }

  if (node.entity === "place") return "a business or place in your contacts";
  return "no recorded contact — nothing but a name on file";
}

export function subtitleFor(node: GraphNode): string | null {
  const bits = [node.title, node.company, node.city].map((v) => String(v ?? "").trim());
  const kept = bits.filter(Boolean);
  return kept.length > 0 ? kept.join(" · ") : null;
}

export function toRow(
  node: GraphNode,
  groups: NetworkGroup[],
  now: number = Date.now(),
): PersonRow {
  return {
    id: node.id,
    name: node.name,
    initials: initialsOf(node.name),
    subtitle: subtitleFor(node),
    groups: (node.groupKeys ?? [])
      .map((k) => groups.find((g) => g.key === k))
      .filter((g): g is NetworkGroup => Boolean(g))
      .map((g) => ({ key: g.key, label: g.label })),
    lastContact: sinceLabel(node.lastAt, node.lastChannel, now),
    reason: reasonFor(node, groups, now),
    aliases: node.aliases ?? [],
    entity: node.entity === "place" ? "place" : "person",
    strength: node.strength,
  };
}

/**
 * The list, ranked.
 *
 * With no query this is the address book by closeness, which is now
 * contact_scores talking rather than this client guessing. With a query it is
 * whatever the server matched, in the server's order, because the server ranked
 * on fields the client never received.
 *
 * Businesses and places sink below people unless they matched a query. They are
 * real contacts worth keeping and they are not who somebody means by "my
 * closest", and 43 of them at the top of a list is the same noise the graph had.
 */
export function rankPeople(
  nodes: GraphNode[],
  groups: NetworkGroup[],
  { matchedIds = null, now = Date.now() }: { matchedIds?: Set<string> | null; now?: number } = {},
): PersonRow[] {
  const people = nodes.filter((n) => n.kind === "contact");
  const searching = matchedIds !== null;
  const shown = searching ? people.filter((n) => matchedIds!.has(n.id)) : people;

  const ranked = shown.slice().sort((a, b) => {
    if (!searching) {
      const ap = a.entity === "place" ? 1 : 0;
      const bp = b.entity === "place" ? 1 : 0;
      if (ap !== bp) return ap - bp;
    }
    return b.strength - a.strength || a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
  });

  return ranked.map((n) => toRow(n, groups, now));
}
