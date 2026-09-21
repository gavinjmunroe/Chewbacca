# The product-UX canon

Researched 2026-09-20. Every number is quoted from a primary source where one
exists, and marked `[UNVERIFIED]` where the trail ran out. The unverified marks
are load-bearing: several figures that circulate constantly (Apple's "300ms",
Warp's "5ms input latency", Amazon's "100ms costs 1% of sales") do not trace to
anything published, and shipping them as fact is how a generator states a
confident wrong number.

## 1. Response-time budgets

| Rule | Number | Source |
|---|---|---|
| 0.1s is the limit for "reacting instantaneously". Below it the user feels they caused the outcome. | **100ms** | [NN/g](https://www.nngroup.com/articles/response-times-3-important-limits/) |
| 1.0s is the limit for uninterrupted flow of thought. | **1,000ms** | same |
| 10s is the limit for keeping attention on the dialogue. | **10,000ms** | same |
| **CORRECTION, 2026-09-20: this triad is Nielsen 1993, not Miller 1968.** Miller's paper does not contain it. See [research/15](15-hci-foundations.md). | | |
| Complete a transition initiated by user input within 100ms. | **100ms** | [web.dev RAIL](https://web.dev/articles/rail) |
| Budget only 50ms of that for your own handling. The other 50ms is reserved, because idle work runs in 50ms chunks and input can queue behind one. | **50/50 split** | same |
| Hold p75 Interaction to Next Paint at or below 200ms. 200-500ms needs improvement, above 500ms is poor. | **200 / 500ms** | [web.dev INP](https://web.dev/articles/inp) |
| Doherty threshold: keep response under 400ms. Doherty and Thadani, IBM Systems Journal, 1982. | **400ms** | [lawsofux](https://lawsofux.com/doherty-threshold/) |
| **State the caveat when citing 400ms.** At least one published teardown argues the threshold as quoted is not what the paper says. | | [flashover.blog](https://www.flashover.blog/posts/dohertys-threshold-is-a-lie/) |

### Superhuman's applied budget

100ms hard ceiling, 50ms target: "under 100ms always, less than 50ms whenever possible."
Attributed to Paul Buchheit. Source: [blog.superhuman.com](https://blog.superhuman.com/superhuman-is-built-for-speed/)

**The most copyable measurement rule in the corpus:** measure *percentage of
events under 100ms*, not percentile latency. Percentiles hide the shape of the
distribution; a pass/fail bucket count does not. Bucket every interaction into
`<50ms` fast, `<100ms` ok, `<1000ms` slow, `>1000ms` terrible. Optimize
variance, not the mean. Use `performance.now()` (±100µs) not `new Date()`
(±1ms), because at a 100ms budget 1ms of clock error is 1% of the budget.
Source: [blog.superhuman.com](https://blog.superhuman.com/performance-metrics-for-blazingly-fast-web-apps/)

The Amazon "100ms = 1% of sales" and Google "500ms = 20% traffic" figures are
repeated by Superhuman and everyone else. Neither traces to a published paper.
**[UNVERIFIED at source]**, folklore grade.

## 2. Frame budgets

Produce each animation frame in **10ms or less**, not 16ms. The 60fps budget is
16.66ms and the browser needs roughly 6ms of it. Treat a missed frame as a
defect. Source: [web.dev RAIL](https://web.dev/articles/rail)

Warp targets 60fps at 4K/8K with a measured **1.9ms** average redraw. Their own
benchmark page states it **does not measure input latency**, so the widely
circulated "Warp achieves 5ms input latency" is **[UNVERIFIED]** and should not
be repeated. Source: [docs.warp.dev](https://docs.warp.dev/terminal/comparisons/performance/)

## 3. Local-first and optimistic UI

This is the mechanism behind "no spinners, ever". It is an architecture
decision, not a loading-state decision.

### Linear's sync engine

Canonical write-up is a community reverse-engineering, not Linear's own blog:
[wzhudev/reverse-linear-sync-engine](https://github.com/wzhudev/reverse-linear-sync-engine)

- Put the database on the client. Hydrate an in-memory observable pool (MobX)
  from IndexedDB at boot. Route every UI query to the pool, never the network.
- **Never let a client operation write directly to the local database.** Mutate
  the in-memory model immediately; write to IndexedDB only after the server
  accepts. On rejection, `rollback()` reverts memory and there is nothing to
  unwind on disk.
- Maintain a global monotonic `lastSyncId`; on websocket handshake compare
  local against server and request missing deltas.
- Delta packets are typed with one character: `I` insert, `U` update, `A`
  archive, `D` delete, `C` covering, `V` unarchive, `G`/`S` sync-group change.
- Five load strategies per model: `instant`, `lazy`, `partial`,
  `explicitlyRequested`, `local`. Do not load everything eagerly.
- Five transaction queues: created, queued, executing, persistedTransactionsEnqueue,
  completedButUnsynced. **A transaction is not done when the server 200s. It is
  done when the matching delta arrives.**
- Persist unsent transactions before dispatch and replay on restart.
- Known unsolved problem in this design: no incremental transaction counter, so
  a non-idempotent transaction resent after restart can double-execute. Design
  idempotency keys in from the start.
- Linear's first lines of code were the sync engine, before product. Tuomas
  Artman: *"Literally the first lines of code that I wrote was the sync engine."*
  You cannot retrofit this. [Pragmatic Engineer](https://newsletter.pragmaticengineer.com/p/linear-move-fast-with-little-process)

### Figma's multiplayer, when local-first is not enough

Source: [madebyevan.com](https://madebyevan.com/figma/how-figmas-multiplayer-technology-works/)

- Do not reach for Operational Transforms unless building a text editor: "very
  complicated and hard to implement correctly."
- Do not implement full CRDTs if you have a central server. They are for
  decentralized systems and carry unavoidable overhead.
- Use last-writer-wins registers per property.
- Apply local changes immediately and **discard incoming server changes that
  conflict with unacknowledged local changes**, or conflicting edits flicker.
- The client may never reject a server change. The server is the authority.
- Undo invariant: undo a lot, copy something, redo to the present, and the
  document must not have changed.

### Optimistic UI rules

- **Write the rollback path before the optimistic path.**
- Never roll back silently: "a silent rollback looks like a broken button
  rather than a rejected request." Surface an inline error on revert.
- Do not use optimistic UI where a false success is costly: payments,
  destructive operations, irreversible sends.
- Optimistic UI is not a fix for a bad flow.

### Notion's measured cache win

WASM SQLite in the browser: **20% faster page navigation** overall, 28%
Australia, 31% China, 33% India. The worse the network, the bigger the win.
**They race SQLite against the network**, because on slow-disk devices the
cache can lose. Source: [notion.com](https://www.notion.com/blog/how-we-sped-up-notion-in-the-browser-with-wasm-sqlite)

## 4. Command palettes

Bind to `Cmd+K`. Bind `?` to a searchable shortcut list. Use bare single
letters for object mutation in a list context and reserve modifiers for global
actions. Use a `G`-prefixed two-key chord for navigation (`G I` inbox, `G P`
projects), which gives a large namespace without modifiers.

### Superhuman's 14 rules

Source: [blog.superhuman.com](https://blog.superhuman.com/how-to-build-a-remarkable-command-palette/)

1. Same shortcut from everywhere in the app.
2. Make the shortcut a toggle: it closes as well as opens.
3. Restore focus to the previously focused element on close.
4. One palette, one key. Never Cmd+K for some actions and Cmd+P for others.
5. Every action in the app must be reachable from it.
6. Fuzzy match, so "lnik" finds "link". Ignore case.
7. Give every command aliases, and score against title and aliases, taking the **max**.
8. Give every command a default score before typing; score 0 filters it out.
9. Give every command a scale multiplier, >1 boosts and <1 demotes.
10. Give commands a `follow` list so a lesser command always ranks below its parent.
11. Adapt ordering by usage over time.
12. Show 5 commands, with the fifth **intentionally cut off** to signal scroll.
13. Give every command an icon.
14. Show, hide and boost based on current context.

### Retool's design rules

Source: [retool.com](https://retool.com/blog/designing-the-command-palette)

- **Do not make the user choose between search mode and action mode.** Retool
  explicitly rejected VSCode's dual-mode design: users had to decide upfront.
- Add a "Top result" section above the categories.
- Hierarchical scope (global to app to component) with deletable context pills.
- Keep the palette open after an action; it is a power-user surface.
- Shipped 90+ app actions; editing a nested text input went to 6 seconds,
  "over 2x faster than the original flow."

### Accessibility, non-negotiable

Source: [W3C APG combobox](https://www.w3.org/WAI/ARIA/apg/patterns/combobox/)

Keep **DOM focus on the input**. Move assistive-technology focus with
`aria-activedescendant`. Never move real focus to the options. `Down`/`Up` move
and select; `Enter` accepts and closes; `Escape` closes and returns focus.
Trap focus in the dialog while open.

## 5. Motion, with the actual numbers

### Material 3 durations (verified against Flutter's `Durations` class)

| Token | ms | Token | ms |
|---|---|---|---|
| short1 | 50 | long1 | 450 |
| short2 | 100 | long2 | 500 |
| short3 | 150 | long3 | 550 |
| short4 | 200 | long4 | 600 |
| medium1 | 250 | extraLong1 | 700 |
| medium2 | 300 | extraLong2 | 800 |
| medium3 | 350 | extraLong3 | 900 |
| medium4 | 400 | extraLong4 | 1000 |

Source: [api.flutter.dev](https://api.flutter.dev/flutter/material/Durations-class.html).
The M3 spec page is JS-rendered and could not be fetched; a third-party Rust
port disagrees on long4 and above, so the Flutter values are the ones to use.

### Material 3 easing

| Token | cubic-bezier |
|---|---|
| standard | `cubic-bezier(0.2, 0, 0, 1)` |
| standard accelerate | `cubic-bezier(0.3, 0, 1, 1)` |
| standard decelerate | `cubic-bezier(0, 0, 0, 1)` |
| emphasized decelerate | `cubic-bezier(0.05, 0.7, 0.1, 1)` |
| emphasized accelerate | `cubic-bezier(0.2, 0, 1, 1)` |
| legacy (M2 standard) | `cubic-bezier(0.4, 0, 0.2, 1)` |

M3's `emphasized` is specified as a three-point cubic, not a single
cubic-bezier. CSS implementations approximate it. **[PARTIALLY VERIFIED]**

### Material 2, the origin of the "200-300ms" rule

Source: [m1.material.io](https://m1.material.io/motion/duration-easing.html)

| Case | ms |
|---|---|
| Mobile standard | **300** |
| Mobile large/complex | **375** |
| Element **entering** | **225** |
| Element **leaving** | **195** |
| Ceiling before motion feels slow | **400** |
| Tablet | mobile × 1.3 (390) |
| Wearable | mobile × 0.7 (210) |
| Desktop standard | **150-200** |

Three rules worth copying verbatim:
- **Exits are faster than entrances.** 195 out, 225 in. Leaving should not cost
  the user time.
- **Scale duration to screen size, not to taste.**
- "Elements quickly accelerate and slowly decelerate." Asymmetric easing. Never
  `linear`, never symmetric `ease-in-out` for an entrance.

| M2 curve | cubic-bezier | Use |
|---|---|---|
| Standard | `cubic-bezier(0.4, 0.0, 0.2, 1)` | on-screen to on-screen |
| Deceleration | `cubic-bezier(0.0, 0.0, 0.2, 1)` | entering |
| Acceleration | `cubic-bezier(0.4, 0.0, 1, 1)` | leaving |
| Sharp | `cubic-bezier(0.4, 0.0, 0.6, 1)` | temporary, may return |

### IBM Carbon, the most machine-readable scale published

Source: [Carbon motion](https://v10.carbondesignsystem.com/guidelines/motion/overview/)

| Token | ms | Use |
|---|---|---|
| fast-01 | **70** | button, toggle |
| fast-02 | **110** | fade |
| moderate-01 | **150** | small expansion |
| moderate-02 | **240** | expansion, system communication |
| slow-01 | **400** | large expansion, notifications |
| slow-02 | **700** | background dimming |

Productive standard `cubic-bezier(0.2, 0, 0.38, 0.9)`, entrance
`cubic-bezier(0, 0, 0.38, 0.9)`, exit `cubic-bezier(0.2, 0, 1, 0.9)`.
Expressive standard `cubic-bezier(0.4, 0.14, 0.3, 1)`, entrance
`cubic-bezier(0, 0, 0.3, 1)`, exit `cubic-bezier(0.4, 0.14, 1, 1)`.

**Carbon's rule, stated exactly:** "the larger the change in distance
(traveled) or size (scaling) of the element, the longer the animation takes."
Duration is a function of distance, not a constant.

### Apple

Apple's HIG publishes **no millisecond values**. Every "Apple says 300ms" claim
found traced to third-party blogs. **[UNVERIFIED]** What Apple does say: "make
motion optional", never make motion the only channel for important information,
and avoid gratuitous animation.

WCAG **2.3.3 Animation from Interactions** is Level **AAA**, so it is not
required by ADA, Section 508 or EN 301 549, which reference AA. Implement with
`prefers-reduced-motion` regardless.

## 6. Loading states

Source: [NN/g skeleton screens](https://www.nngroup.com/articles/skeleton-screens/)

| Duration | What to show |
|---|---|
| **under 2s** | **nothing.** An indicator "won't make a difference to the users' experience." |
| **2-10s** | spinner for a single module, skeleton screen for a full-page load |
| **over 10s** | percent-done progress bar. "Anything above 10 seconds requires an explicit estimation of duration." |

Never use frame-display skeletons (outlines with no content shape). Reserve
skeletons for full-page loads.

**Do not render an empty list before data arrives** or you flash a "No results"
state. Raycast names this as the single most common extension bug.
Source: [developers.raycast.com](https://developers.raycast.com/basics/prepare-an-extension-for-store)

The "waits with feedback feel 11-15% faster" figure is attributed to NN/g in
secondary sources and was not located in an NN/g article. **[UNVERIFIED]**

## 7. Empty states

Source: [NN/g empty states](https://www.nngroup.com/articles/empty-state-interface-design/)

1. **Communicate system status.** Say which of the three it is: loading, error,
   or genuinely no data.
2. **Teach something.** Empty states are "pull revelations" and are more
   memorable than a forced tutorial.
3. **Offer a direct path to the key task.**

Copy rules. Write the heading forward-looking: "Create your first product"
beats "You haven't added any products yet."
([Polaris](https://polaris.shopify.com/components/empty-state)) Lead every
button with a strong verb. **No jokes**: NN/g's research on no-results pages
found humor "reads as mockery to someone who is already stuck."

Shopify publishes the only pixel values in the corpus: center with
`paddingBlock="large-400"`, cap text at `maxInlineSize="450px"`, cap the
illustration at `200x200px`, one primary action, 40px of white space above when
nested in other content.

## 8. Error states

NN/g's 13 guidelines, in four groups.
Source: [NN/g error messages](https://www.nngroup.com/articles/error-message-guidelines/)

**Visibility.** Adjacent to the source. Noticeable and redundant, never colour
alone. Scale the UI to impact: toast for low, modal for high. Do not show
errors prematurely.

**Communication.** Human-readable, no codes as the primary message. Concise and
precise; generic messages are a defect. Constructive: say what to do next.
Positive tone, no blame, **no humor** (it goes stale on repeat).

**Efficiency.** Detect predictable mistakes early. **Preserve the user's
input**, never make them re-enter. Offer the suggested fix. Educate concisely.

**Special case.** For total unavoidable failure only, novelty is permitted.

Stripe's applied version: attach **two links to every API error**, one to the
request log and one to the relevant doc, plus spell-check suggestions for
mistyped parameter names.

## 9. Docs as an interface

Source: [Stripe](https://docs.stripe.com/get-started/api-request), [stripe.dev](https://stripe.dev/blog/how-api-changes-flow-into-stripes-developer-products)

- Three columns: stable nav left, prose centre, runnable code right.
- **Inject the reader's own test API key into every code sample when signed
  in.** Only they see the values. This removes the copy-paste-and-hunt step.
- Ship a shared sample test key so a signed-out reader can run anything.
- One click switches every sample on the page to another language.
- Generate docs, SDKs, CLI, mock servers and changelog from **one OpenAPI
  artifact**. Parameterize on variant, phase and version.
- Show a diff preview before release.
- Run **friction logs**: have a team use a new thing and document every point
  of friction before release.

## 10. Process rules that produce this

Karri Saarinen's 10 rules ([Figma](https://www.figma.com/blog/karri-saarinens-10-rules-for-crafting-products-that-stand-out/)),
the operative ones:

- "For quality, you need a team that views the spec as the baseline, not the
  finish line."
- "The best design is opinionated." Design for someone particular.
- "The simplest way to increase quality is to reduce scope."
- "Data can be a crutch." A/B tests do not produce surprise.

From [linear.app/now/why-is-quality-so-rare](https://linear.app/now/why-is-quality-so-rare):
zero-bugs policy fixed within **7 days**, teams of **3-5**, no half-baked public
releases. Their definition: craft is "the deliberate attention put into making
something excellent, not because someone is checking, but because it matters to
the maker." The diagnosis: "Technology makes it faster to build, but harder to
care."

## 11. Raycast's enforceable UX contract

Source: [developers.raycast.com](https://developers.raycast.com/basics/prepare-an-extension-for-store)

Name commands `<verb> <noun>` or bare `<noun>`. **Drop articles**: "Search
Emoji", not "Search an Emoji". Title Case every action. Append an ellipsis to
any action opening a submenu. **If any action in a list has an icon, all of
them must.** Never build a custom navigation stack.

## 12. What could not be verified

- Apple HIG publishes no millisecond values.
- Linear's own blog does not contain the sync-engine detail; the canonical
  source is a community reverse-engineering plus conference talks.
- Warp's input-latency number.
- Vercel Geist's numeric tokens. Recoverable: appending `.md` to any Geist doc
  URL returns a Markdown version with real values.
- **Arc, Things 3, Craft and Height have no published design or engineering
  writing.** They are in the canon by reputation, not documentation.
- Amazon's 100ms/1% and Google's 500ms/20%.
