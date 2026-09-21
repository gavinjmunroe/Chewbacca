# Data table

Compiled from research/09 (Cleveland & McGill, Few, table formatting),
research/07 (ARIA APG grid vs table), research/08 (TanStack source),
research/02 (loading and empty states).

## Table or grid: the choice that decides your keyboard

**These are different ARIA patterns and picking wrong breaks tab order.**

| | `table` | `grid` |
|---|---|---|
| Keyboard | **none.** Every focusable child is its own tab stop | **one tab stop for the whole thing**, arrows move between cells |
| Use when | read-only, few controls per row | cells are editable or every row has controls |
| Failure if wrong | a 50-row table with 3 buttons each is **150 tab stops** | a read-only grid traps arrow keys for no reason |

**Default to `table`.** Switch to `grid` only when the tab-stop count becomes
absurd, which is the actual trigger.

Grid keyboard, when you need it: arrows move one cell and stop at edges,
`Home`/`End` first/last in row, `Ctrl+Home`/`Ctrl+End` first/last in grid,
`Enter` or an alphanumeric enters the cell widget, `F2` toggles edit mode,
`Esc` restores grid navigation.

## Numbers

| Rule | Value |
|---|---|
| Figures | `font-variant-numeric: tabular-nums lining-nums` |
| Integers | right-aligned |
| Reals | aligned on the decimal separator |
| Text | left-aligned |
| **Anything** | **never centred.** Ragged edges force you to add rules to compensate |
| Significant figures | consistent **within a column**, which is what makes right-alignment actually align |
| Units | in the header, **once**. Per-cell only when units vary within the column |
| Precision | never more than the decision needs. `$3.8M`, not `$3,848,305.93` |

## Column sizing

Defaults from TanStack source: `size: 150`, `minSize: 20`,
`maxSize: MAX_SAFE_INTEGER`.

**Size a fixed-length column to its content.** A year column is 4 characters, a
CVV is 4, a postcode is its national maximum. Baymard found oversized fields
made subjects question whether they had misread the label, and rated the effect
on usability "surprisingly big."

Variable columns with a standard average share one width. **The normal boundary
is 18 to 33 characters.**

## States, all seven

| State | Behaviour |
|---|---|
| **Loading** | **Show nothing under 2s.** Skeleton from 2-10s. Percent-done bar above 10s |
| **Empty** | Say which of the three it is: loading, error, or genuinely no data. Forward-looking heading, "Create your first invoice", never "You haven't added any invoices yet". **No jokes**, they read as mockery to someone already stuck |
| **Error** | Adjacent to the source, never colour alone, **preserve any input**, say what to do next |
| **One row** | Do not render a table chrome heavier than its content |
| **Many** | Virtualize. TanStack's real default `overscan` is **1**, not the 5 every example passes |
| **Too many** | Paginate or filter, and say the total |
| **Offline** | Say the data is stale and when it was fetched |

**The most common bug, named by Raycast as their most frequent extension
defect: rendering the empty list before data arrives, which flashes "No
results" during the fetch.** Check the loading flag first, always.

## Sorting and selection

Sort indicator goes in the header with `aria-sort`. **Sort by value, not
alphabetically**, unless the category has an inherent order.

Selection is tri-state: `getIsAllRowsSelected`, `getIsSomeSelected`
(indeterminate), none. The header checkbox is indeterminate when some rows are
selected, and that state must be set as a property, not a class.

## Sticky headers

**Not a library concern.** `position: sticky` on `<th>`. But it creates the
2.4.11 Focus Not Obscured failure: a focused row scrolled under the sticky
header is **entirely hidden**, which fails WCAG at AA. Fix with
`scroll-padding-top` equal to the header height.

## The failure mode

**A table that works in the demo and dies at 10,000 rows**, because nothing was
virtualized and the tab-stop count went to five figures. Decide `table` vs
`grid` and virtualization **before** writing the first row, not after.

## Sources

research/09 (Few's pitfalls, number formatting), research/07 (APG grid and
table patterns, WCAG 2.4.11), research/08 (TanStack Table and Virtual source
constants), research/02 (NN/g loading thresholds, Raycast's empty-list bug).
