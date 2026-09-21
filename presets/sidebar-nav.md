# Sidebar navigation

Compiled from research/15 (Hick, menu search, Fitts), research/07 (ARIA APG,
landmarks), research/02 (command palette as the expert path).

## Do not split it into categories to "reduce choice"

**Hick's law formally argues the opposite of how it gets cited.** For 32 items:

```
one page:            RL = a + 5b
4 random pages:      RL = 2.5a + 7.5b
4 categorized pages: RL = 2a + 5b
```

> *"the optimal strategy according to Hick's law consists of displaying all the
> items at once on the same page, contrary to the design principle that choices
> should be categorized."*

Categorize when the items **genuinely fall into groups the user already holds**,
not to shorten a list.

And the measured slope in real HCI tasks is **4 to 32 ms/bit**, against Hick's
own ~156. *"In practice, reaction time can usually be treated as a constant."*

## Search cost is LINEAR until positions are stable

| Condition | Model |
|---|---|
| **Unfamiliar, or items reorder** | **linear, ~80 to 125 ms per item** |
| Stable positions, previously selected | logarithmic |

**A nav that reorders by recency or frequency never leaves the linear
regime**, because learnability is zero when nothing stays put. That is the
argument against adaptive menus, and it is measured rather than aesthetic.

**So: fix the positions.** A slightly worse order that never moves beats a
better order that does.

## Keyboard

A sidebar of links is **not** a composite widget. Every link is its own tab
stop, which is correct and needs no roving tabindex.

Use `<nav>` with a unique `aria-label` when there is more than one. Mark the
current item with **`aria-current="page"`**, not just a class.

If it is a tree, then it *is* composite: one tab stop, `Right` opens a node or
moves to the first child, `Left` closes or moves to the parent, `*` expands all
siblings at the level, and **`aria-level`, `aria-setsize` and `aria-posinset`
are required when the DOM is virtualized.**

## The expert path is a different mechanism

Marking menus measured **3.5x faster** than menu selection, and CommandMaps
were significantly faster for experienced users at **no cost to novices**.

**So pair the sidebar with `Cmd+K`.** Recognition for the first week, recall
forever after. See `ux-preset command-palette`.

## Screen edges

The edge bonus is real for mouse and **bounded**: roughly 100 to 300 ms, and
only near-orthogonal approach. It **disappears at a parallel approach angle**,
and the formal "infinite width" justification is wrong under the best-fitting
Fitts model.

**On touch it inverts.** Increasing the gap from the edge decreased both
movement time and error rate; at 4mm targets mean error was **23.71%**. Make
edge targets **12mm or larger**.

## States

Collapsed, expanded, active item, **nested active** (parent must show its child
is active when collapsed), loading (skeleton the labels, never collapse the
width), empty (a workspace with no projects), and **overflow** when the list is
longer than the viewport.

## The failure mode

**A sidebar that is perfect at 8 items and unusable at 80**, because nothing
was designed for overflow and the active item now scrolls out of view. Decide
the overflow behaviour at 8, not at 80.
