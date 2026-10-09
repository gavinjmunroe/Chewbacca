# Command palette

Compiled from research/02 (Superhuman's 14 rules, Retool), research/08 (cmdk
source), research/07 (W3C combobox pattern).

## The 14 rules, from Superhuman

1. **Same shortcut from everywhere.** `Cmd+K`.
2. **The shortcut is a toggle**: it closes as well as opens.
3. **Restore focus** to the previously focused element on close.
4. **One palette, one key.** Never `Cmd+K` for some actions and `Cmd+P` for
   others.
5. **Every action in the app reachable from it.**
6. **Fuzzy match**, so "lnik" finds "link".
7. Every command has **aliases**, scored against title and aliases taking the
   **max**.
8. Every command has a **default score** before typing; score 0 filters it out.
9. Every command has a **scale multiplier**.
10. A **`follow` list**, so a lesser command always ranks below its parent.
11. **Adapt ordering by usage** over time.
12. **Show 5, with the fifth intentionally cut off** to signal scroll.
13. Every command has an **icon**.
14. **Show, hide and boost by context.**

## And Retool's, which contradict the obvious design

**Do not make the user choose between search mode and action mode.** Retool
explicitly rejected VSCode's dual-mode design because users had to decide
upfront. One surface, sections inside it, plus a **"Top result"** above the
categories.

**Keep the palette open after an action.** It is a power-user surface.

## Accessibility, non-negotiable

**DOM focus stays on the input. Always.** Move assistive-technology focus with
`aria-activedescendant`. **Never move real focus to the options.**

`Down`/`Up` move and select, `Enter` accepts and closes, `Esc` closes and
returns focus. Trap focus while open.

`role="combobox"`, `aria-expanded`, `aria-controls`, `aria-activedescendant`,
`aria-autocomplete="list"`.

**VoiceOver mis-announces `aria-activedescendant` changes**, so React Aria
announces focus, count and selection manually through a live region. If iOS
matters, you need that too.

## Typeahead buffer

The libraries disagree and it is worth knowing the range: **1000ms** (React
Aria, Radix), **750ms** (Base UI), **350ms** (Zag).

Two semantics everyone shares: **repeated characters normalize** (pressing
"aaa" cycles items starting with "a"), and search **wraps from the current
item**, not from the top.

**Space appends to the buffer when a search is in progress.** React Aria
handles this in the **capture phase** so no bubble handler treats it as a
selection.

## Scoring

cmdk's constants, which document their own reasoning:

```
SCORE_CONTINUE_MATCH      = 1
SCORE_SPACE_WORD_JUMP     = 0.9    // space-separated word starts beat...
SCORE_NON_SPACE_WORD_JUMP = 0.8    // ...slashes, brackets, hyphens
SCORE_CHARACTER_JUMP      = 0.17
SCORE_TRANSPOSITION       = 0.1    // "ouch" beats "curtain" for "uc"
PENALTY_SKIPPED           = 0.999  // "bad" beats "bard" for "bd"
PENALTY_CASE_MISMATCH     = 0.9999 // "HTML" beats "haml" for "HM"
PENALTY_NOT_COMPLETE      = 0.99   // "html" beats "html5" for "html"
```

**Exact prefix matches must beat fuzzy matches, always.** Otherwise fuzzy
ranking makes the obvious query worse.

## Motion: none

**This is the clearest case of the frequency rule.** An interaction seen 100+
times a day gets **no animation at all**. Raycast ships no open/close
animation, and that is correct rather than lazy.

## States

Empty query (show recents or top commands, never a blank box), no results
(offer the closest match or a create action), loading async results (keep the
input responsive and never block typing), error.

## The failure mode

**A palette that is beautiful and unreachable**, because the shortcut only
works on one screen. Rule 1 is rule 1 for a reason.
