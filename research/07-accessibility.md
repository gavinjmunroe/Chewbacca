# Accessibility

Researched 2026-09-20 from 57 primary-source fetches: the WCAG 2.2
Recommendation, the ARIA Authoring Practices Guide, WAI-ARIA 1.2, the WebAIM
Million, the WebAIM Screen Reader Survey, and the actual legal instruments.

**This is the domain where a generator can be checked rather than judged**, so
it is written as a checklist first and a reference second.

## Start here: what actually breaks

[WebAIM Million](https://webaim.org/projects/million/), February 2026,
**1,000,000 home pages analysed**.

- **95.9% have detected WCAG failures** (up from 94.8%)
- **56.1 average errors per page** (up 10.1% in a year)

**Six categories are 96% of all detected errors.** Ranked:

| Rank | Failure | 2026 | 2025 |
|---|---|---|---|
| 1 | **Low contrast text** | **83.9%** | 79.1% |
| 2 | Missing alt text | 53.1% | 55.5% |
| 3 | Missing form labels | 51.0% | 48.2% |
| 4 | Empty links | 46.3% | 45.4% |
| 5 | Empty buttons | 30.6% | 29.6% |
| 6 | Missing document language | 13.5% | 15.8% |

**If a generator checks one thing, check contrast.** It is on five sixths of
the web and it got worse by 4.8 points in a year.

Structure data worth knowing: only **46.1% of pages have a `<main>`**, **41.8%
skip heading levels**, and 18.1% have multiple `<h1>`.

## The generator checklist, ordered by expected yield

### Tier 1, the six that are 96% of errors

1. Every text pair **4.5:1**, or **3:1** at 18pt/24px or 14pt-bold/18.5px.
   **Not rounded**: 4.499:1 fails.
2. Every `<img>` has `alt`; decorative gets `alt=""`. Meaningful `<svg>` gets a
   name; decorative gets `aria-hidden="true"`.
3. Every control has a programmatic label. **Never placeholder-only.**
4. No empty `<a>`. Icon-only links get a name.
5. No empty `<button>`. Icon-only buttons get a name.
6. `<html lang>` present and correct.

### Tier 2, structure, which drives 71.6% of screen-reader navigation

7. One `<h1>`, no skipped levels.
8. `<main>` present.
9. Landmarks, all content inside one, **seven or fewer**, duplicates uniquely
   labelled.
10. Skip link, first in tab order, visible on focus.
11. Real lists and tables with `<th scope>`, not divs.

### Tier 3, keyboard and focus

12. Everything interactive reachable by keyboard. **Never `tabindex` > 0.**
13. Visible focus at **3:1**, via `:focus-visible` with a `@supports`
    fallback. Never a bare `outline: none`.
14. Nothing focused entirely covered by a sticky header or cookie banner.
15. Every widget follows its APG keyboard table below.
16. Modals: focus in, trapped, `Esc` closes, **focus returns to the trigger**,
    rest of page inert.

### Tier 4, ARIA discipline

17. Native element wherever one exists.
18. No `aria-hidden="true"` on or containing anything focusable.
19. Every IDREF resolves.
20. Accessible name **contains** the visible label text.
21. No ARIA menu roles on site navigation.
22. Live regions exist in the DOM **before** their content.

### Tier 5, the WCAG 2.2 additions no default tool checks

23. Pointer targets **24x24 CSS px**, or spaced so 24px circles on their
    centres do not intersect.
24. Every drag has a single-pointer alternative.
25. Help mechanisms in the same relative DOM order across pages.
26. No re-asking for information already given (passwords excepted).
27. **Auth allows paste and password managers.**

### Tier 6, responsive and preference

28. Reflow at **320 x 256 CSS px**, no two-dimensional scrolling.
29. Text to **200%**.
30. Survives line-height 1.5, paragraph 2x, letter 0.12x, word 0.16x.
31. Honours `prefers-reduced-motion`; nothing flashes 3x/second; no autoplay
    over 5s without a pause control.
32. Colour is never the sole signal.

## WCAG 2.2, the numbers that matter

Recommendation since 5 October 2023. **55 criteria at A/AA: 31 A, 24 AA.**
That is 2.1's 50, plus 6 new, minus 4.1.1 Parsing, **which was removed as
obsolete.** Anything still reporting a 4.1.1 failure is testing against 2.0/2.1.

**The six new in 2.2:** 3.2.6 Consistent Help (A), 3.3.7 Redundant Entry (A),
2.4.11 Focus Not Obscured (AA), 2.5.7 Dragging Movements (AA), 2.5.8 Target
Size Minimum (AA), 3.3.8 Accessible Authentication (AA).

| Criterion | The number |
|---|---|
| 1.4.3 Contrast | **4.5:1**, large text **3:1**. Large = 18pt/24px, or 14pt bold/18.5px |
| 1.4.4 Resize Text | **200%** |
| 1.4.10 Reflow | **320 CSS px** wide, **256** tall |
| 1.4.11 Non-text Contrast | **3:1** for UI boundaries, states, focus rings, meaningful graphics |
| 1.4.12 Text Spacing | line 1.5x, paragraph 2x, letter 0.12x, word 0.16x |
| 2.2.1 Timing Adjustable | adjust to 10x, warn with 20s, extend 10 times |
| 2.2.2 Pause Stop Hide | anything auto-starting over **5 seconds** |
| 2.3.1 Flashes | **3 per second** |
| 2.5.8 Target Size | **24 x 24 CSS px** (AAA 2.5.5 is 44x44) |
| 1.4.2 Audio Control | autoplay over **3 seconds** needs a control |

**1.4.13 Content on Hover or Focus** is the one people miss: a hover popup must
be **dismissible** without moving the pointer, **hoverable** (the pointer can
enter it), and **persistent** until dismissed.

## ARIA

### The four rules

**First Rule, quoted:** *"If you can use a native HTML element or attribute
with the semantics and behavior you require already built in, instead of
re-purposing an element and adding an ARIA role, state or property to make it
accessible, then do so."*

Second: do not change native semantics. Third: all interactive ARIA controls
must work with the keyboard. Fourth: never `role="presentation"` or
`aria-hidden="true"` on a **focusable** element.

The widely quoted "fifth rule" about accessible names **is not in the W3C
document.** It is true as a 4.1.2 requirement, just not numbered.

### The data that should make you cautious

From WebAIM Million 2026:

- **Pages with ARIA average 59.1 errors. Pages without average 42.0.**
- 133.6 million ARIA attributes detected, **over 133 per page**, up 27% in a
  year and **6x since 2019**.
- `aria-hidden="true"`: **23.3 per page, up 250% since 2020.**
- `tabindex`: 30.4 per page, **up ~300% since 2020**.
- **ARIA menus on 5.7% of pages, and 22% of those introduced barriers.**

WebAIM's own caveat, which matters for honesty: *"This does not necessarily
mean that ARIA introduced these errors (these pages were also more complex),
but pages typically had significantly more errors when more ARIA was present."*

### Focus management, the five rules that generalize

1. **Opens over the page** (modal, alert dialog): focus in, trap Tab, `Esc`
   closes, **return focus to the trigger**.
2. **Opens in place** (disclosure, accordion, tooltip, non-modal popover):
   **do not move focus.** `aria-expanded` carries the state.
3. **Composite widgets** (tabs, menubar, toolbar, listbox, grid, tree,
   radiogroup) are **one tab stop**, arrow keys inside, via roving tabindex or
   `aria-activedescendant`.
4. **Static containers** (table, accordion, link list) keep every focusable
   child in the tab sequence. **This is the whole difference between a table
   and a grid.**
5. **Deleting the focused element strands focus on `<body>`.** Move it
   deliberately.

### Keyboard by pattern, the ones that get built most

| Pattern | Keys | Focus |
|---|---|---|
| **Dialog** | Tab wraps inside, `Esc` closes | In on open, trapped, **back to trigger** on close |
| **Combobox** | `Down` opens, `Alt+Down` opens without moving, `Esc` dismisses, `Enter` accepts | **DOM focus stays on the input**, `aria-activedescendant` tracks the option |
| **Tabs** | `Left`/`Right` wrap, `Home`/`End` optional | Roving tabindex, active tab `0` and the rest `-1`. Automatic activation only when panels are preloaded |
| **Menu / Menubar** | Tab enters the menubar, arrows move within, `Esc` closes and **returns focus** | One tab stop |
| **Accordion** | `Enter`/`Space` toggles | **No roving tabindex, no trap.** Header button wrapped in a heading, and the only element in it |
| **Disclosure** | `Enter`/`Space` | Focus stays on the trigger |
| **Slider** | arrows step, `Home`/`End` min/max, `PageUp`/`PageDown` larger | Required: `aria-valuenow`, `aria-valuemin`, `aria-valuemax` |
| **Radio Group** | arrows move **and check**, wrapping | Roving tabindex, whole group is one tab stop |
| **Carousel** | buttons **do not move focus**, so they can be pressed repeatedly | Auto-rotation **stops on focus and on hover**. `aria-live="off"` while rotating |
| **Tooltip** | `Esc` dismisses | Focus stays on trigger. **APG flags this pattern as unfinished, without task force consensus** |

### Live regions, and when they silently fail

`off` (default), `polite` (waits for a pause), `assertive` (interrupts).
Implicit: `alert` is assertive, `status` and `log` are polite, `timer` and
`marquee` are off.

Four ways they break:

- **The container was injected at the same moment as its text.** Nothing is
  announced. **Render the empty container on load.**
- **`role="alert"` present at page load is never announced.** Only dynamically
  rendered alerts are.
- **`assertive` for anything non-urgent** interrupts mid-sentence.
- **`display:none` content is not announced** even inside a live region.

## Screen readers

[WebAIM Survey #10](https://webaim.org/projects/screenreadersurvey10/),
Dec 2023 to Jan 2024, 1,539 responses. Self-selected, so directional.

**JAWS 40.5%, NVDA 37.7%, VoiceOver 9.7%.** Windows is 86.1% of desktop.
**91.3% also use a mobile screen reader**, and mobile is 70.6% iOS.

Test matrix, the top pairs: JAWS+Chrome 24.7%, NVDA+Chrome 21.3%, JAWS+Edge
11.4%, NVDA+Firefox 10.0%, VoiceOver+Safari 7.0%.

**How they navigate a long page:**

| Method | Share |
|---|---|
| **Headings** | **71.6%** |
| Find | 13.6% |
| Sequentially | 6.4% |
| Links | 4.8% |
| **Landmarks** | **3.7%** |

**Headings are the navigation surface.** Landmarks are worth shipping and are
much weaker than the discourse suggests. A clean non-skipping heading outline
buys more than any ARIA work on the page.

Two behaviours that change implementation:

- **JAWS and NVDA use a virtual buffer.** Content injected without a live
  region may never be spoken. VoiceOver is closer to a direct DOM walk.
- **VoiceOver on iOS has no Tab key.** Swipe order is DOM order and `tabindex`
  does not reorder it. Anything depending on Tab has no mobile equivalent.

## What automated testing actually catches

Two numbers circulate and **they are not in conflict**, they count different
units:

| Source | Figure | Unit |
|---|---|---|
| [GDS tool audit](https://alphagov.github.io/accessibility-tool-audit/) (2018) | best tool found **40%** | distinct barrier **types**, 142 injected |
| [Deque](https://www.deque.com/automated-accessibility-testing-coverage/) | **57.38%** | issue **instances**, 13,000+ pages |

Instance-weighted is higher because the automatable rules are exactly the ones
that fail most: contrast, alt, labels, empty controls. Deque also found
automation reaches only **16 of 50 WCAG 2.1 AA criteria**.

**Automation catches 0% of:** Focus Order, Meaningful Sequence, Focus Visible.
Together roughly 13% of all issues.

**axe-core 4.10 ships exactly one WCAG 2.2 rule** (`target-size`) **and it is
disabled by default.** So a default axe run is completely silent on 2.4.11,
2.5.7, 3.2.6, 3.3.7 and 3.3.8. Tiers 5 and 6 above must be checked another way.

## Legal, compressed

**Target WCAG 2.2 AA and every row below is satisfied**, because 2.2 is a
superset of 2.1 AA and 2.0 AA (it only removed 4.1.1).

| Where | Standard | When |
|---|---|---|
| US federal (Section 508) | WCAG **2.0** AA | in force |
| US state and local (DOJ ADA Title II rule) | WCAG **2.1** AA | **26 Apr 2027** (50k+ population), 2028 (smaller) |
| US private sector | no codified standard, case law cites 2.0/2.1 AA | ongoing |
| EU public sector (2016/2102) | EN 301 549 | in force since 2019-2021 |
| **EU private sector (European Accessibility Act)** | EN 301 549 | **applies since 28 June 2025** |
| EN 301 549 | v3.2.1 cites WCAG 2.1 AA; **v4.1.1 cites 2.2 AA** | v4.1.1 published Sep 2026, binding once cited in the Official Journal, scheduled **30 Nov 2026** |
| Ontario AODA | WCAG **2.0** AA | since 1 Jan 2021 |

The EAA has a **microenterprise exemption**: under 10 employees and under
2M euro turnover.

## Open items

- **Apple's HIG accessibility page is JS-rendered** and returned no body. The
  44x44pt minimum came from search snippets. **[PARTIALLY VERIFIED]**
- **Android's 48x48dp** is Material guidance and was not found on Android's own
  accessibility page. **[UNVERIFIED against a primary Android source]**
- Survey #11 may exist by now; these shares are from #10.
