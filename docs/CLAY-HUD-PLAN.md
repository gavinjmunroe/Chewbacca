# Clay HUD Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `clay-build "<who>" --count 50` drives the Clay tab in Chewie's Chrome through Find People to a 50-row emailable table. Kyber draws the cursor, a bracket, one beside-note and a strip while it works, and shows an approval card before either credit spend.

**Architecture:** A Python runner reads a recipe (data, next to the Clay map). It acts on the page through `chewie web eval` and reads Clay through `chewbacca clay`. It draws on Kyber over `~/.bob/hud.sock`. Kyber gains three small primitives: `near=` placement, a bottom lane that clears the hyper bar, and a `Mark` component (icosahedron and stipple globe, as layer keyframes). Everything else reuses existing lines: `m`, `a`, `@`, `c`, `Status`, `Button`.

**Tech Stack:**
- Python 3 stdlib only: bin/lib modules and an extensionless bin script
- Swift 6 / SwiftUI / Core Animation (KyberKit), tested with swift-testing
- One plain-JS finder, tested with `node --test`

**Spec:** `docs/CLAY-HUD.md` on `feat/clay-hud` (worktree `~/wt-clay-hud`). Task 0 corrects the parts exploration proved wrong. Read both before starting.

**Execution:** subagent-driven is recommended. There are 17 tasks across Swift, Python and JS. Tasks 7 to 12 depend on each other's exact signatures, and a mistake shipped in the runner spends a client's credits, so a fresh reviewer per task is worth the cost. Native execution also works if speed matters more.

## Context

Gavin wants a Kyber layer over Clay so that a client's operator who has never used Clay can say "find me 50 fintech VC partners in Clay", watch it get built on the real page, approve every credit spend, and end on a card showing what they got and what it cost. With that, the Clay service can be contracted out to operators who have never seen Clay.

Gavin approved the design on 2026-10-09: the narrated driver, the OS1 look for acting and approving, Dither for done, and the v2 mockup with the paused and failed states.

## What exploration changed in the spec

Task 0 writes these into `docs/CLAY-HUD.md`:

1. **`chewie web eval` drives Chewie's own Chrome** (`mac/bridge/web.js:148-209`, a debug-port Chrome on a copied profile), not Gavin's everyday Chrome.
   - The Clay tab lives in that window.
   - Step 0 counts Clay tabs through the debug port's `/json/list`.
   - If none is open, it opens one, which is the only time a URL is passed.
   - `chrome-js` (AppleScript) was rejected for three reasons: it does not await promises, it swallows page errors, and the Apple Events toggle switched itself off on 2026-09-23.
2. **The target bracket is an `m` marker**, not `chrome=bracket`. A failed step uses a new `tone=miss`, which draws a red dashed bracket.
3. **Button events arrive as `e <action> <component> surface="<s>"`.** Every action is named `clay-*`. Stopping arrives as `e stop run` or `x`. After `x` nothing is redrawn.
4. **The strip is an ordinary surface**: `@ clay-strip at=bottom chrome=window`. Bottom-centre surfaces now clear the hyper bar's lane, so no new verb is needed.
5. **`tools/clay_fixture_check.py` checks CSV exports, not selectors.**
   - Saved Clay pages would put lead data into a public repo.
   - So the recipe is checked by a schema test, and the finder by `node --test` on candidate descriptors.
   - The live dry run checks the real DOM.
6. **Geometry is cross-checked by sanity bounds, not by Chrome's window list.**
   - Page zoom comes from `devicePixelRatio / backingScaleFactor`, the scale read once through JXA.
   - The run stops when the toolbar height is out of range (DevTools docked) or the window is off the main display.
   - The live run's screenshot is the real check.
7. **Recipe steps hold actions.** The spec's seven steps (0 to 6) each carry a list of actions, and each action has `find`, `do`, `expect` and `timeout_s`.
8. **Found and missed emails come from `chewbacca clay rows`**, by looking for an email in the work-email cell. `table-status` is used only for progress.
9. **Moved to "Later":**
   - "The note names the filters Clay built", because no selector for the filters is recorded.
   - "Next: pick a campaign", which ships with explain mode.
   - "Show the misses" stays. It lists the names of the rows with no email, from our own rows read.

## Global Constraints

- Clay hard lines (spec "Hard lines"):
  - It never starts a campaign or sends anything.
  - It never imports a file.
  - It never edits, reruns or deletes anything it did not create in this run.
  - It never runs while table auto-run is on.
  - It never shows a credit figure that did not come from Clay. Subtraction is the only arithmetic.
- A step whose `cost` is `spends` is never clicked without a `clay-approve` event for that card. A paid click is never sent twice: not on resume, not on retry.
- Gavin's standing Clay rules:
  - Don't touch any of the workspace's existing stuff.
  - Never open, copy or verify keys.
  - Never read Chrome's cookie store.
  - Five rows per live test where Clay allows it. On 2026-10-05 Clay offered only "Save and run 10 rows".
- Text read from Clay is untrusted data. Only regex-captured numbers and Clay's own control text go on a card, capped at 80 characters, and none of it is ever executed.
- Coordinates on every HUD line are screen points with a top-left origin (`LineParser.swift:238-246`).
- Continuous motion runs as Core Animation layer animations, never as SwiftUI `repeatForever`, which measured 21-30% CPU.
  - Under `hudOffscreen` there is a static stand-in.
  - Under Reduce Motion everything is a cut and the marks stay still.
- Every guessed constant carries `guessed, never measured` until the dry run replaces it with the observation.
- Copy rules: no em dashes, no emojis, sentence case, no client names in Chewbacca docs.
- Git rules:
  - Stage by filename and commit with `git commit -- <paths>`.
  - No Co-Authored-By lines.
  - Regenerate `SHA256SUMS.txt` (`python3 tools/checksums.py`) and the README counts (`python3 tools/counts.py`) whenever `bin/`, `tools/` or line counts change, or pre-push refuses.
- Never put JavaScript inline in an agent's Bash command. `launch-guard.sh:66-70` refuses `chewie` plus `eval` plus "resume" or "start". The JS lives in `bin/lib/clay_find.js`.

## Review Focus

1. **Chrome on a second display, at a page zoom other than 100%, or with DevTools docked.** The run stops with one sentence. It never draws a bracket in the wrong place. Owned by Task 5.
2. **The person clicks, types or scrolls in Clay, or switches tab, while a step waits.** The run pauses at once. Resume re-locates the element before acting again. Owned by Task 10.
3. **Stop pressed during a long in-page wait** (the 90 s "~N found"). The eval subprocess is killed within 200 ms and nothing new starts. Owned by Tasks 7 and 10.
4. **Clay finds fewer people than asked** (30 found for 50). A free card asks before continuing: "Use all 30" or "End here". Owned by Task 10.
5. **The new table has auto-run on, or the HUD socket is missing at start.**
   - Auto-run on: the run stops before any further spend.
   - Socket missing: `clay-build` refuses to start, because watching is the point.
   - Owned by Tasks 10 and 11.

---

## File map

| File | Does one thing |
| --- | --- |
| `hud/Sources/KyberKit/Spec.swift` | `Near` value; `Op.surface` gains `near:` |
| `hud/Sources/KyberKit/LineParser.swift` | parses `near=x,y,w,h side=right\|left` on `@` |
| `hud/Sources/KyberKit/OverlayModel.swift` | places `near` surfaces beside their target; bottom lane clears the bar |
| `hud/Sources/KyberKit/AgentMark.swift` (new) | `Mark` component: wireframe icosahedron and stipple globe |
| `hud/Sources/KyberKit/SurfaceView.swift` | dispatches `case "Mark"` |
| `hud/Sources/KyberKit/Markers.swift`, `OverlayView.swift` | `tone=miss`: red, dashed |
| `hud/Tests/KyberKitTests/NearTests.swift`, `AgentMarkTests.swift`, `ClayStatesTests.swift` (new) | tests |
| `bin/lib/clay_geometry.py` (new) | page rect to screen points; sanity problems |
| `bin/lib/clay_find.js` (new) | in-page locate, act, wait; pure `pick` for tests |
| `bin/lib/clay_recipe.py` (new) | loads and validates the recipe, fills `{sentence}` and `{count}` |
| `library/maps/app.clay.com/recipes/find-people-table.json` (new) | the run, as data |
| `bin/lib/clay_page.py` (new) | `chewie web eval` driver with a stop-aware subprocess |
| `bin/lib/clay_reads.py` (new) | `chewbacca clay` credits, table, columns, rows, table-status |
| `bin/lib/clay_hud.py` (new) | socket client and the line builders for every state |
| `bin/lib/clay_run.py` (new) | the runner state machine |
| `bin/clay-build` (new) | CLI, lock, tab board, wiring |
| `bin/lib/clay_route.py` (new) | voice: `parse` and `perform`, mirroring `bin/lib/opener.py` |
| `bin/hud-listen` | `clay_request` fast path; `clay-` event passthrough |
| `tests/test_clay_*.py`, `tests/test_clay_find.mjs` (new) | tests |
| `tests/run.sh`, `setup.sh`, `SHA256SUMS.txt`, `README.md` | registration |

---

### Task 0: Branch ready, spec corrected

**Files:**
- Merge: `feat/window-chrome` (f89ddf31)
- Modify: `docs/CLAY-HUD.md`
- Create: `docs/CLAY-HUD-PLAN.md`, a copy of this plan

- [ ] **Step 1: Confirm Caleb's work is already in.**
  Run `cd ~/wt-clay-hud && git merge-base --is-ancestor 8355265a HEAD && git merge-base --is-ancestor ecea9fc6 HEAD && echo ok`. Expected: `ok`. This was verified 2026-10-09, but re-check after any fetch.
- [ ] **Step 2: Merge window chrome.**
  Run `git merge --no-ff feat/window-chrome -m "chore: bring window chrome into the clay hud branch"`. Expected: no conflicts, which was verified earlier.
- [ ] **Step 3: Build and test the HUD.**
  Run `cd hud && swift build && swift test 2>&1 | tail -5`. Expected: all pass.
- [ ] **Step 4: Rewrite the spec where it is wrong.**
  - Apply items 1 to 9 of "What exploration changed" to `docs/CLAY-HUD.md`:
    - "What Kyber gets"
    - "The recipe"
    - "Geometry"
    - "States on the glass"
    - "Tests"
    - "Later"
  - Then run `slop-check docs/CLAY-HUD.md --issues` and `ai-scan docs/CLAY-HUD.md`, and fix anything they flag above 10.
- [ ] **Step 5: Copy the plan in.**
  Run `cp ~/.claude/plans/lets-start-the-build-staged-sedgewick.md docs/CLAY-HUD-PLAN.md`, then fix the relative links (`python3 tools/linkcheck.py docs/CLAY-HUD-PLAN.md`).
- [ ] **Step 6: Commit.**
  `git add docs/CLAY-HUD.md docs/CLAY-HUD-PLAN.md && git commit -m "docs: clay hud plan, and the spec corrected to what the code allows" -- docs/CLAY-HUD.md docs/CLAY-HUD-PLAN.md`

---

### Task 1: `near=` placement

**Files:**
- Modify:
  - `hud/Sources/KyberKit/Spec.swift` (Op.surface at about :214)
  - `LineParser.swift:202-222`
  - `OverlayModel.swift`, at OverlaySurface :6-77, `open` :914-964, `relayout` :1010-1032 and `origin` :1064-1114
  - every `.surface(` match: `SocketServer.swift`, `SessionTests.swift`, `ParserTests.swift`
- Test: `hud/Tests/KyberKitTests/NearTests.swift`

**Interfaces:**
- Produces:
  - the `@ <id> near=<x>,<y>,<w>,<h> [side=right|left] ...` line
  - `Near { target: CGRect; side: Near.Side }`
  - `OverlayModel.besideOrigin(target:side:size:bounds:gap:) -> CGPoint` (top-left)
  - `OverlaySurface.near: Near?`
- Rules:
  - A later `@ id at=<region>` clears `near`.
  - `@ id` with neither keeps it.
  - Near surfaces are not in any region column and never fold.

- [ ] **Step 1: Write the failing tests**

```swift
import CoreGraphics
import Testing
@testable import KyberKit

@Suite("Near placement")
struct NearTests {
    @Test("near and side parse")
    func parses() throws {
        let op = try LineParser.parse(#"@ clay-note near=100,200,80,30 side=left chrome=window w=300"#)
        guard case let .surface(id, _, width, _, chrome, _, near) = op else {
            Issue.record("not a surface: \(op)"); return
        }
        #expect(id == "clay-note")
        #expect(width == 300)
        #expect(chrome == .window)
        #expect(near == Near(target: CGRect(x: 100, y: 200, width: 80, height: 30), side: .left))
    }

    @Test("a bad near is ignored, not a crash", arguments: ["1,2,3", "a,b,c,d", "1,2,0,4", "1,2,3,-4"])
    func badNear(raw: String) throws {
        let op = try LineParser.parse("@ n near=\(raw)")
        guard case let .surface(_, _, _, _, _, _, near) = op else { Issue.record("\(op)"); return }
        #expect(near == nil)
    }

    let screen = CGRect(x: 18, y: 43, width: 1476, height: 900)
    let size = CGSize(width: 300, height: 140)

    @Test("right of the target when there is room")
    func right() {
        let point = OverlayModel.besideOrigin(
            target: CGRect(x: 400, y: 300, width: 120, height: 32), side: .right,
            size: size, bounds: screen, gap: 12)
        #expect(point == CGPoint(x: 532, y: 300))
    }

    @Test("flips left when the right edge would cut it off")
    func flips() {
        let target = CGRect(x: 1300, y: 300, width: 120, height: 32)
        let point = OverlayModel.besideOrigin(target: target, side: .right, size: size, bounds: screen, gap: 12)
        #expect(point.x == 1300 - 12 - 300)
        #expect(!CGRect(origin: point, size: size).intersects(target))
    }

    @Test("goes below when neither side fits, and never covers the target")
    func below() {
        let wide = CGRect(x: 30, y: 200, width: 1440, height: 40)
        let point = OverlayModel.besideOrigin(target: wide, side: .right, size: size, bounds: screen, gap: 12)
        #expect(point.y == wide.maxY + 12)
        #expect(!CGRect(origin: point, size: size).intersects(wide))
    }

    @Test("clamped vertically inside the screen")
    func clamped() {
        let low = CGRect(x: 400, y: 900, width: 120, height: 32)
        let point = OverlayModel.besideOrigin(target: low, side: .right, size: size, bounds: screen, gap: 12)
        #expect(point.y + size.height <= screen.maxY)
    }
}
```

- [ ] **Step 2: Run them to verify they fail.**
  Run `cd hud && swift test --filter NearTests`. Expected: a compile failure (`Near` is undefined).
- [ ] **Step 3: Implement**

`Spec.swift`, placed beside `Chrome`:

```swift
/// A surface placed beside a rectangle on the screen rather than in a region.
/// The Clay HUD's note sits in the gutter next to the control being pressed,
/// never over it, so the person can see both at once.
public struct Near: Sendable, Equatable {
    public enum Side: String, Sendable { case right, left }
    public var target: CGRect
    public var side: Side

    public init(target: CGRect, side: Side) {
        self.target = target
        self.side = side
    }

    /// `x,y,w,h` in screen points, top-left origin. Nil unless all four are
    /// finite and the size is positive.
    public static func parse(_ raw: String) -> CGRect? {
        let parts = raw.split(separator: ",").compactMap { Double($0) }
        guard parts.count == 4, parts.allSatisfy(\.isFinite), parts[2] > 0, parts[3] > 0
        else { return nil }
        return CGRect(x: parts[0], y: parts[1], width: parts[2], height: parts[3])
    }
}
```

Add `near: Near?` as the last associated value of `Op.surface`, and update all 9 `.surface(` sites. In the `@` case of `LineParser`:

```swift
var target: CGRect?
var side = Near.Side.right
// inside the loop:
if key == "near" { target = Near.parse(value) }
if key == "side" { side = Near.Side(rawValue: value) ?? .right }
// return:
return .surface(id: tokens[1], region: region, width: width, urgency: urgency,
                chrome: chrome, life: life, near: target.map { Near(target: $0, side: side) })
```

Update the protocol comment at `LineParser.swift:13` to list `[near=x,y,w,h side=right]`.

`OverlayModel`:
- Add `public var near: Near?` to `OverlaySurface`, and add it to `==`.
- `open(...)` takes `near: Near?`. On an existing surface: `if let near { existing.near = near } else if region != nil { existing.near = nil }`. A new surface gets `near: near`.
- `relayout()`: skip `near != nil` surfaces both when assigning slots and when folding.

```swift
/// Gap between a beside-note and its target. Guessed, never measured: the
/// approved mockup (look-v2.html) used 12 to 16 px at 1x.
static let nearGap: CGFloat = 12

/// Top-left corner for a surface of `size` beside `target`, inside `bounds`.
/// Right (or left) if it fits, the other side if not, below and then above
/// if neither does. Never overlapping the target, because the target is what
/// the person needs to see being pressed.
static func besideOrigin(
    target: CGRect, side: Near.Side, size: CGSize, bounds: CGRect, gap: CGFloat
) -> CGPoint {
    let right = target.maxX + gap
    let left = target.minX - gap - size.width
    let fitsRight = right + size.width <= bounds.maxX
    let fitsLeft = left >= bounds.minX
    let clampY = { (y: CGFloat) in min(max(y, bounds.minY), bounds.maxY - size.height) }
    let clampX = { (x: CGFloat) in min(max(x, bounds.minX), bounds.maxX - size.width) }
    switch (side, fitsRight, fitsLeft) {
    case (.right, true, _), (.left, true, false):
        return CGPoint(x: right, y: clampY(target.minY))
    case (.left, _, true), (.right, false, true):
        return CGPoint(x: left, y: clampY(target.minY))
    default:
        let below = target.maxY + gap
        let y = below + size.height <= bounds.maxY ? below : target.minY - gap - size.height
        return CGPoint(x: clampX(target.minX), y: clampY(y))
    }
}
```

In `origin(for:)`, right after the insets are computed:

```swift
if let near = surface.near {
    let height = drawnHeight(surface)
    let bounds = CGRect(
        x: leftInset + margin, y: topInset + margin,
        width: full.width - leftInset - rightInset - 2 * margin,
        height: full.height - topInset - bottomInset - 2 * margin)
    let topLeft = Self.besideOrigin(
        target: near.target, side: near.side,
        size: CGSize(width: surface.width, height: height), bounds: bounds, gap: Self.nearGap)
    let centre = CGPoint(x: topLeft.x + surface.width / 2, y: topLeft.y + height / 2)
    let drag = dragBounds(centre: centre, width: surface.width, height: height, screen: screen)
    return CGPoint(
        x: centre.x + Self.resist(surface.drag.width, within: drag.x),
        y: centre.y + Self.resist(surface.drag.height, within: drag.y))
}
```

`frames` already calls `origin`, so the hit region follows.

- [ ] **Step 4: Run all HUD tests.**
  Run `swift test 2>&1 | tail -5`. Expected: all pass, including the 9 updated call sites.
- [ ] **Step 5: Commit.**
  `git commit -m "feat: kyber surfaces can sit beside a rectangle with near=" -- <the files above>`

---

### Task 2: Bottom-centre surfaces clear the hyper bar

**Files:**
- Modify: `hud/Sources/KyberKit/OverlayModel.swift`, `origin(for:)`
- Test: `hud/Tests/KyberKitTests/NearTests.swift`, adding a suite `BarLaneTests`

**Interfaces:**
- Produces: `OverlayModel.barLane(pillHeight: CGFloat) -> CGFloat`, applied when `surface.region == .bottom && surface.near == nil`. The strip in Task 9 relies on it.

- [ ] **Step 1: Write the failing test**

```swift
@Suite("Bar lane")
struct BarLaneTests {
    @Test("reserves the pill's lift, its height and a gap; a hidden pill still reserves")
    func lane() {
        #expect(OverlayModel.barLane(pillHeight: 0)
            == PillView.pillLift + OverlayModel.pillReserve + OverlayModel.stackGap)
        #expect(OverlayModel.barLane(pillHeight: 60)
            == PillView.pillLift + 60 + OverlayModel.stackGap)
    }
}
```

- [ ] **Step 2: Run it.** `swift test --filter BarLaneTests` should FAIL.
- [ ] **Step 3: Implement**

```swift
/// Height kept for the hyper bar even while it is hidden, so a bottom
/// surface does not jump when the bar appears. Guessed, never measured:
/// replace it with the bar's measured height from the dry run screenshot.
static let pillReserve: CGFloat = 44

static func barLane(pillHeight: CGFloat) -> CGFloat {
    PillView.pillLift + max(pillHeight, pillReserve) + stackGap
}
```

In `origin(for:)`:

```swift
let lane = surface.region == .bottom ? Self.barLane(pillHeight: pillSize.height) : 0
let bottomY = full.height - bottomInset - margin - lane
```

`bin/hud:361`'s demo `@ ring at=bottom` moves up with it, which is intended: nothing belongs under the bar. Make the visibility of `PillView.pillLift` `internal` if it is `private`.

- [ ] **Step 4:** `swift test` passes.
- [ ] **Step 5: Commit.** `feat: bottom surfaces sit above the hyper bar instead of under it`

---

### Task 3: The `Mark` component

**Files:**
- Create: `hud/Sources/KyberKit/AgentMark.swift`
- Modify: `hud/Sources/KyberKit/SurfaceView.swift`, adding `case "Mark"` near :107
- Test: `hud/Tests/KyberKitTests/AgentMarkTests.swift`

**Interfaces:**
- Produces:
  - the line `c <id> Mark kind=ico|globe [spin=true] [size=18]`
  - `Wireframe.icosahedron() -> (vertices: [SIMD3<Double>], edges: [(Int, Int)])`
  - `Wireframe.frames(kind:count:size:) -> [CGPath]`
  - `AgentMarkView`
- Motion:
  - `ico`: 72 discrete frames over 6 s, repeating while `spin=true`.
  - `globe`: 48 frames over 2.4 s, played once, then resting on frame 0.
  - Both durations are guessed.
  - Discrete 12 fps keyframes give the stepped analog feel from the Jev reference, and they run in the render server with no app CPU.

- [ ] **Step 1: Write the failing tests**

```swift
import CoreGraphics
import simd
import Testing
@testable import KyberKit

@Suite("Agent mark")
struct AgentMarkTests {
    @Test("an icosahedron: 12 vertices, 30 edges, every edge the same length")
    func icosahedron() {
        let (vertices, edges) = Wireframe.icosahedron()
        #expect(vertices.count == 12)
        #expect(edges.count == 30)
        let lengths = edges.map { simd_distance(vertices[$0.0], vertices[$0.1]) }
        #expect(lengths.allSatisfy { abs($0 - 2) < 1e-9 })
    }

    @Test("every frame stays inside its box", arguments: [Wireframe.Kind.ico, .globe])
    func inside(kind: Wireframe.Kind) {
        let frames = Wireframe.frames(kind: kind, count: 12, size: 20)
        #expect(frames.count == 12)
        for path in frames {
            #expect(CGRect(x: 0, y: 0, width: 20, height: 20).insetBy(dx: -0.5, dy: -0.5)
                .contains(path.boundingBoxOfPath))
        }
    }

    @Test("the globe shows only its near side")
    func nearSide() {
        let all = Wireframe.globePoints(count: 220)
        let shown = Wireframe.visible(all, turn: 0)
        #expect(shown.count > 80 && shown.count < 140)
    }
}
```

- [ ] **Step 2:** `swift test --filter AgentMarkTests` FAILS (`Wireframe` is undefined).
- [ ] **Step 3: Implement**

`AgentMark.swift`:
- **`enum Wireframe`:**
  - `Kind { ico, globe }`.
  - `icosahedron()` uses vertices `(0, ±1, ±φ)`, `(±1, ±φ, 0)` and `(±φ, 0, ±1)`. The edges are the vertex pairs at distance 2.
  - `globePoints(count:)` is a Fibonacci sphere.
  - `visible(_:turn:)` keeps the points with rotated `z > 0`.
- **`frames(kind:count:size:)`:**
  - Rotate about y by `2π·i/count`, after a fixed 0.35 rad tilt about x.
  - Project orthographically, scaled to `size/2` over the radius (`√(1+φ²)` for ico, 1 for globe), centred at `size/2`.
  - ico: one `move`/`addLine` per edge.
  - globe: a 1.2 pt square per visible point.
- **`struct AgentMarkView: View`:**
  - It holds `kind`, `spin` and `size`, and reads `@Environment(\.hudOffscreen)` and `@Environment(\.accessibilityReduceMotion)`.
  - When offscreen, under reduced motion, or with `spin == false`, it draws `Path(frames[0])` (stroke 1 pt for ico, fill for globe) in the window chrome's body ink. Use the ink token `SurfaceView` uses for window chrome text after the Task 0 merge.
  - Otherwise it draws `MarkLayerView`.
- **`MarkLayerView: NSViewRepresentable`:**
  - The `NSView` hosts a `CAShapeLayer`. Its model `path` is `frames[0]`.
  - `updateNSView` removes the `"turn"` animation, then adds `CAKeyframeAnimation(keyPath: "path")` with `values = frames`, `calculationMode = .discrete`, the duration above, `repeatCount = kind == .ico ? .infinity : 1` and `isRemovedOnCompletion = true`.
  - This is the RingLayerView pattern (`PresenceRing.swift:187-325`).
- Give it an accessibility label: "Working" while it spins, "Done" for the globe, hidden otherwise.

In `SurfaceView.render`:

```swift
case "Mark":
    return AnyView(AgentMarkView(
        kind: Wireframe.Kind(rawValue: p["kind"]?.stringValue ?? "ico") ?? .ico,
        spin: p["spin"] == .bool(true),
        size: CGFloat(p["size"]?.doubleValue ?? 18)))
```

- [ ] **Step 4:** `swift test` passes.
- [ ] **Step 5: Commit.** `feat: a Mark component, a wireframe icosahedron that turns while acting and a stipple globe for done`

---

### Task 4: `tone=miss`, the failed bracket

**Files:**
- Modify:
  - `hud/Sources/KyberKit/OverlayView.swift:829-835` (`HUD.tone`) and `HUD.spoken`
  - `Markers.swift`, `MarkerView.brackets` and `Brackets`
- Test: `hud/Tests/KyberKitTests/ParserTests.swift`

- [ ] **Step 1: Write the failing tests** (added to `ParserTests` or a new `@Suite`)

```swift
@Test("tone=miss parses, reads as bad, and dashes")
func miss() throws {
    let op = try LineParser.parse("m clay-target 10 20 80 30 tone=miss life=300")
    guard case let .mark(_, rect, _, tone, life) = op else { Issue.record("\(op)"); return }
    #expect(rect == CGRect(x: 10, y: 20, width: 80, height: 30))
    #expect(tone == "miss")
    #expect(life == 300)
    #expect(HUD.tone("miss") == HUD.bad)
    #expect(Marker.isDashed(tone: "miss"))
    #expect(!Marker.isDashed(tone: "bad"))
}
```

- [ ] **Step 2:** It FAILS.
- [ ] **Step 3: Implement.**
  - Add `"miss"` to the bad case of `HUD.tone`.
  - Make `HUD.spoken("miss")` return `"expected here, not found"`.
  - Add `static func isDashed(tone: String?) -> Bool { tone == "miss" }` on `Marker`.
  - `Brackets` takes `dashed: Bool` and strokes with `StrokeStyle(lineWidth: <existing>, dash: dashed ? [4, 3] : [])`.
  - `MarkerView` passes `Marker.isDashed(tone: marker.tone)`.
- [ ] **Step 4:** `swift test` passes.
- [ ] **Step 5: Commit.** `feat: a dashed red marker for where an expected control was not found`

---

### Task 5: Geometry

**Files:**
- Create: `bin/lib/clay_geometry.py`
- Test: `tests/test_clay_geometry.py`

**Interfaces:**
- Produces:
  - `Rect(x, y, w, h)` and `Window(screen_x, screen_y, outer_w, outer_h, inner_w, inner_h, dpr)`, both frozen dataclasses
  - `Display(width, height, scale)`
  - `Window.from_page(d: dict) -> Window`, whose keys match `frame()` in clay_find.js
  - `to_screen(rect: Rect, win: Window, display: Display) -> Rect`
  - `problem(win, display) -> str | None`
  - `read_display(run=subprocess.run) -> Display`

- [ ] **Step 1: Write the failing test**

```python
import sys, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "bin" / "lib"))
from clay_geometry import Display, Rect, Window, problem, to_screen

RETINA = Display(1512, 982, 2.0)

def win(**kw):
    base = dict(screen_x=0, screen_y=38, outer_w=1512, outer_h=944,
                inner_w=1512, inner_h=857, dpr=2.0)
    base.update(kw)
    return Window(**base)

class Geometry(unittest.TestCase):
    def test_retina_at_100(self):
        self.assertEqual(to_screen(Rect(100, 200, 80, 30), win(), RETINA), Rect(100, 325, 80, 30))

    def test_zoom_125(self):
        w = win(dpr=2.5, inner_w=1209.6, inner_h=685.6)
        got = to_screen(Rect(100, 200, 80, 30), w, RETINA)
        self.assertAlmostEqual(got.x, 125); self.assertAlmostEqual(got.y, 38 + 87 + 250)
        self.assertAlmostEqual(got.w, 100); self.assertAlmostEqual(got.h, 37.5)
        self.assertIsNone(problem(w, RETINA))

    def test_non_retina(self):
        d = Display(1920, 1080, 1.0)
        self.assertEqual(to_screen(Rect(10, 10, 5, 5), win(dpr=1.0), d), Rect(10, 135, 5, 5))

    def test_devtools_docked_stops(self):
        self.assertIn("DevTools", problem(win(inner_h=500), RETINA))

    def test_second_display_stops(self):
        self.assertIn("main display", problem(win(screen_x=1600), RETINA))
        self.assertIn("main display", problem(win(screen_x=-900), RETINA))

if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2:** `python3 tests/test_clay_geometry.py` FAILS (ImportError).
- [ ] **Step 3: Implement**

```python
"""Page rectangles to screen points, for drawing on Clay.

Chrome reports a control's place in CSS pixels inside the page. Kyber draws in
screen points from the top-left of the main display. The two differ by the
window's position, the toolbar above the page, and page zoom.
"""
from __future__ import annotations

import subprocess
from dataclasses import dataclass

# Chrome's toolbar on macOS, tabs plus omnibox, with or without the bookmarks
# bar. Guessed, never measured: the dry run replaces this with what it read.
# Outside it, something is docked (DevTools at the bottom) and every y is off.
TOOLBAR_RANGE = (40.0, 160.0)


@dataclass(frozen=True)
class Rect:
    x: float
    y: float
    w: float
    h: float


@dataclass(frozen=True)
class Window:
    screen_x: float
    screen_y: float
    outer_w: float
    outer_h: float
    inner_w: float
    inner_h: float
    dpr: float

    @classmethod
    def from_page(cls, d: dict) -> "Window":
        return cls(*(float(d[k]) for k in (
            "screen_x", "screen_y", "outer_w", "outer_h", "inner_w", "inner_h", "dpr")))


@dataclass(frozen=True)
class Display:
    width: float
    height: float
    scale: float


def _zoom(win: Window, display: Display) -> float:
    return win.dpr / display.scale


def _toolbar(win: Window, display: Display) -> float:
    return win.outer_h - win.inner_h * _zoom(win, display)


def to_screen(rect: Rect, win: Window, display: Display) -> Rect:
    z = _zoom(win, display)
    return Rect(win.screen_x + rect.x * z, win.screen_y + _toolbar(win, display) + rect.y * z,
                rect.w * z, rect.h * z)


def problem(win: Window, display: Display) -> str | None:
    """Why drawing now would land in the wrong place, as a sentence for the
    person, or None."""
    if (win.screen_x < 0 or win.screen_y < 0
            or win.screen_x + win.outer_w > display.width + 1
            or win.screen_y + win.outer_h > display.height + 1):
        return "Move the Clay window onto the main display, then press Try again."
    low, high = TOOLBAR_RANGE
    if not low <= _toolbar(win, display) <= high:
        return "Close DevTools or any panel docked in the Clay window, then press Try again."
    return None


_JXA = ('ObjC.import("AppKit"); var s = $.NSScreen.screens.objectAtIndex(0);'
        'JSON.stringify([s.frame.size.width, s.frame.size.height, s.backingScaleFactor])')


def read_display(run=subprocess.run) -> Display:
    """The main display's size and backing scale. JXA needs no permission."""
    import json
    proc = run(["osascript", "-l", "JavaScript", "-e", _JXA],
               capture_output=True, text=True, timeout=10)
    if proc.returncode != 0:
        raise RuntimeError(f"could not read the display: {proc.stderr.strip()}")
    width, height, scale = json.loads(proc.stdout)
    return Display(float(width), float(height), float(scale))
```

The second-display test in Step 1 relies on the first check. `screen_x=1600` is off a 1512-wide display, and `-900` is negative.

- [ ] **Step 4:** The test passes. Also run `python3 -c 'import sys; sys.path.insert(0,"bin/lib"); import clay_geometry as g; print(g.read_display())'`. It prints the real display, a read-only check.
- [ ] **Step 5: Commit.** `feat: clay geometry, page rectangles to screen points with zoom and a sanity stop`

---

### Task 6: Recipe, finder and validation

**Files:**
- Create:
  - `library/maps/app.clay.com/recipes/find-people-table.json`
  - `bin/lib/clay_find.js`
  - `bin/lib/clay_recipe.py`
- Test: `tests/test_clay_recipe.py`, `tests/test_clay_find.mjs`

**Interfaces:**
- Produces:
  - `clay_recipe.Action(find: tuple[dict, ...], do: str, value: str, enter: bool, expect: dict, timeout_s: float, approve: str)`
  - `clay_recipe.Step(id, title, note, holds, surface, cost, actions: tuple[Action, ...])`
  - `load(path: Path = DEFAULT) -> tuple[Step, ...]`, which raises `RecipeError("<step id>: <why>")`
  - `fill(text: str, values: dict) -> str`, which raises `KeyError` on an unknown placeholder
  - `clay_find.js` page functions: `locate(alts)`, `act(found, action)`, `waitFor(expect, ms)`, `frame()`, `armTakeover()`, and pure `pick(candidates, alt)` / `matches(text, alt)` exported under node
- Vocabularies:
  - `do`: one of `click`, `type`, `check`, `open-submenu`.
  - `expect`: exactly one of `url` (substring of href), `text` (substring of body text), `text_re` (regex on body text, returns group 1), `css` (a visible match).

- [ ] **Step 1: Write the recipe** (selectors from `MAP.md:184-194`; an unrecorded one carries `"unverified": true` until the dry run)

```json
{
  "schema": 1,
  "recorded": "2026-10-05",
  "source": "library/maps/app.clay.com/MAP.md, Find People to emailable table",
  "steps": [
    {"id": "check", "title": "CHECK", "surface": "read", "cost": "free",
     "note": "Reading your Clay balance.", "holds": "Nothing is touched yet.", "actions": []},
    {"id": "find", "title": "FIND PEOPLE", "surface": "ui", "cost": "free",
     "note": "Asking Clay's people search for {sentence}.", "holds": "Nothing is saved yet.",
     "actions": [
       {"find": [{"css": "button", "text": "Find leads"}], "do": "click",
        "expect": {"text": "Search directly"}, "timeout_s": 10},
       {"find": [{"css": "button", "text": "People"}], "do": "click",
        "expect": {"url": "/chats/"}, "timeout_s": 15},
       {"find": [{"css": "[role=tab]", "text": "Chat"}, {"css": "button", "text": "Chat"}], "do": "click",
        "expect": {"css": "textarea"}, "timeout_s": 10},
       {"find": [{"css": "textarea", "placeholder": "I'm looking for"}, {"css": "textarea"}],
        "do": "type", "value": "{sentence}", "enter": true,
        "expect": {"text_re": "~([\\d,]+) found"}, "timeout_s": 90}
     ]},
    {"id": "count", "title": "COUNT", "surface": "ui", "cost": "free",
     "note": "Keeping {count} people and saving them to a new table.", "holds": "No credits yet.",
     "actions": [
       {"find": [{"css": "button", "text": "Continue"}], "do": "click",
        "expect": {"css": "input[value=custom]"}, "timeout_s": 15},
       {"find": [{"css": "input[value=custom]"}], "do": "check",
        "expect": {"css": "input[type=number]"}, "timeout_s": 5},
       {"find": [{"css": "input[type=number]"}], "do": "type", "value": "{count}",
        "expect": {"css": "input[value=table]"}, "timeout_s": 5},
       {"find": [{"css": "input[value=table]"}], "do": "check",
        "expect": {"css": "input[value=table]"}, "timeout_s": 5},
       {"find": [{"css": "button", "text": "Save"}], "do": "click",
        "expect": {"text": "Work email"}, "timeout_s": 20}
     ]},
    {"id": "test", "title": "TEST RUN", "surface": "approve", "cost": "spends",
     "note": "Finding work emails for the first rows only.", "holds": "Waits for you before any credit is spent.",
     "actions": [
       {"find": [{"css": "label", "text": "Work email", "match": "contains"},
                 {"css": "[role=checkbox]", "text": "Work email", "match": "contains"}],
        "do": "check", "unverified": true, "expect": {"text_re": "(Save and run \\d+ rows)"}, "timeout_s": 5},
       {"find": [{"css": "button", "text_re": "^Save and run \\d+ rows$"}], "do": "click",
        "approve": "test", "expect": {"url": "/tables/"}, "timeout_s": 30}
     ]},
    {"id": "read", "title": "READ THE TEST", "surface": "read", "cost": "free",
     "note": "Reading what the test found and what it cost.", "holds": "Nothing runs while this reads.",
     "actions": []},
    {"id": "rest", "title": "THE REST", "surface": "approve", "cost": "spends",
     "note": "Opening the run menu on the work email column.", "holds": "Waits for you before any credit is spent.",
     "actions": [
       {"find": [{"css": "button", "text": "Find work email", "match": "contains"}], "do": "click",
        "expect": {"css": "[role=menuitem]"}, "timeout_s": 10},
       {"find": [{"css": "[role=menuitem]", "text": "Run column", "match": "prefix"}], "do": "open-submenu",
        "expect": {"text_re": "(Run \\d+ empty or out-of-date rows[^\\n]{0,40})"}, "timeout_s": 10},
       {"find": [{"css": "[role=menuitem]", "text_re": "^Run \\d+ empty or out-of-date rows"}], "do": "click",
        "approve": "rest", "expect": {"text": "Find work email"}, "timeout_s": 15}
     ]},
    {"id": "done", "title": "DONE", "surface": "read", "cost": "free",
     "note": "Counting what you got.", "holds": "Nothing else will run.", "actions": []}
  ]
}
```

- [ ] **Step 2: Write the failing Python test**

```python
import json, sys, tempfile, unittest
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "bin" / "lib"))
import clay_recipe

class Recipe(unittest.TestCase):
    def test_shipped_recipe_loads(self):
        steps = clay_recipe.load()
        self.assertEqual([s.id for s in steps], ["check", "find", "count", "test", "read", "rest", "done"])

    def test_every_paid_step_ends_on_its_one_approval(self):
        for step in clay_recipe.load():
            approvals = [a for a in step.actions if a.approve]
            if step.cost == "spends":
                self.assertEqual(len(approvals), 1, step.id)
                self.assertIs(step.actions[-1], approvals[0], step.id)
            else:
                self.assertEqual(approvals, [], step.id)

    def bad(self, mutate):
        data = json.loads(clay_recipe.DEFAULT.read_text())
        mutate(data)
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f:
            json.dump(data, f)
        with self.assertRaises(clay_recipe.RecipeError):
            clay_recipe.load(Path(f.name))

    def test_refuses_a_paid_click_without_approval(self):
        self.bad(lambda d: d["steps"][3]["actions"][1].pop("approve"))

    def test_refuses_an_unknown_do(self):
        self.bad(lambda d: d["steps"][1]["actions"][0].update(do="drag"))

    def test_refuses_two_expect_kinds(self):
        self.bad(lambda d: d["steps"][1]["actions"][0]["expect"].update(url="/x"))

    def test_refuses_type_without_value(self):
        self.bad(lambda d: d["steps"][1]["actions"][3].pop("value"))

    def test_refuses_an_em_dash_in_copy(self):
        self.bad(lambda d: d["steps"][1].update(note="Asking Clay " + chr(0x2014) + " now"))

    def test_fill(self):
        self.assertEqual(clay_recipe.fill("for {sentence}.", {"sentence": "VC partners"}), "for VC partners.")
        with self.assertRaises(KeyError):
            clay_recipe.fill("{nope}", {})

if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 3: Write the failing node test** (`tests/test_clay_find.mjs`)

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { pick, matches } = require("../bin/lib/clay_find.js");

const c = (text, extra = {}) => ({ index: extra.index ?? 0, text, placeholder: "", visible: true, ...extra });

test("exact text, whitespace collapsed", () => {
  assert.deepEqual(pick([c("Find  leads\n", { index: 3 })], { text: "Find leads" }), { ok: true, index: 3 });
});
test("invisible candidates never match", () => {
  assert.deepEqual(pick([c("Save", { visible: false })], { text: "Save" }), { ok: false, reason: "missing" });
});
test("two visible matches is ambiguous, never a guess", () => {
  const got = pick([c("Save", { index: 1 }), c("Save", { index: 2 })], { text: "Save" });
  assert.equal(got.reason, "ambiguous");
});
test("prefix, contains and regex", () => {
  assert.ok(matches("Run column >", { text: "Run column", match: "prefix" }));
  assert.ok(matches("Find work email (7)", { text: "Find work email", match: "contains" }));
  assert.ok(matches("Save and run 10 rows", { text_re: "^Save and run \\d+ rows$" }));
  assert.ok(!matches("Save", { text: "Save and run", match: "prefix" }));
});
test("placeholder narrows", () => {
  const got = pick([c("", { placeholder: "Search" }), c("", { index: 5, placeholder: "I'm looking for..." })],
                   { placeholder: "I'm looking for" });
  assert.deepEqual(got, { ok: true, index: 5 });
});
test("no text constraint matches any visible candidate", () => {
  assert.deepEqual(pick([c("", { index: 7 })], { css: "input[value=custom]" }), { ok: true, index: 7 });
});
```

- [ ] **Step 4: Run both.** `python3 tests/test_clay_recipe.py` and `node --test tests/test_clay_find.mjs` FAIL.
- [ ] **Step 5: Implement `bin/lib/clay_find.js`**

```js
// Locates and presses one control on the Clay page for clay-build. Plain
// script on purpose: clay_page.py inlines this file into a single
// `chewie web eval` expression, and tests/test_clay_find.mjs loads it under
// node, where only the pure functions at the top run.

function normalise(text) { return String(text == null ? "" : text).replace(/\s+/g, " ").trim(); }

function matches(text, alt) {
  const t = normalise(text);
  if (alt.text_re !== undefined) return new RegExp(alt.text_re).test(t);
  if (alt.text === undefined) return true;
  const want = normalise(alt.text);
  if (alt.match === "prefix") return t.startsWith(want);
  if (alt.match === "contains") return t.includes(want);
  return t === want;
}

// One visible match or a reason. Two matches stop the run rather than
// pressing whichever came first in the DOM.
function pick(candidates, alt) {
  const hits = candidates.filter((c) => c.visible && matches(c.text, alt)
    && (alt.placeholder === undefined || normalise(c.placeholder).startsWith(normalise(alt.placeholder))));
  if (hits.length === 0) return { ok: false, reason: "missing" };
  if (hits.length > 1) return { ok: false, reason: "ambiguous", count: hits.length };
  return { ok: true, index: hits[0].index };
}

function describe(el, index) {
  const r = el.getBoundingClientRect();
  const s = getComputedStyle(el);
  return { index, text: el.innerText || el.value || el.getAttribute("aria-label") || "",
    placeholder: el.getAttribute("placeholder") || "",
    visible: r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none",
    rect: { x: r.x, y: r.y, w: r.width, h: r.height } };
}

function locate(alts) {
  const tried = [];
  for (const alt of alts) {
    const els = Array.from(document.querySelectorAll(alt.css));
    const got = pick(els.map(describe), alt);
    tried.push({ css: alt.css, text: alt.text || alt.text_re || "", result: got.ok ? "ok" : got.reason });
    if (got.ok) {
      const el = els[got.index];
      el.scrollIntoView({ block: "nearest", inline: "nearest" });
      return { ok: true, el, rect: describe(el, got.index).rect, text: normalise(describe(el, 0).text).slice(0, 80), tried };
    }
  }
  return { ok: false, tried };
}

function frame() {
  return { screen_x: window.screenX, screen_y: window.screenY, outer_w: window.outerWidth,
    outer_h: window.outerHeight, inner_w: window.innerWidth, inner_h: window.innerHeight,
    dpr: window.devicePixelRatio, href: location.href };
}

function setValue(el, value) {
  const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

// Presses are synthetic (isTrusted false), so the takeover listener below
// never mistakes clay-build's own press for the person's.
function act(found, action) {
  const el = found.el;
  if (action.do === "click") el.click();
  if (action.do === "check" && !el.checked && el.getAttribute("aria-checked") !== "true") el.click();
  if (action.do === "type") {
    el.focus();
    setValue(el, action.value);
    if (el.value !== action.value) return { ok: false, reason: "value did not stick" };
    if (action.enter) el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, bubbles: true }));
  }
  if (action.do === "open-submenu") {
    el.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
    el.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", code: "ArrowRight", bubbles: true }));
  }
  return { ok: true };
}

function expectMet(expect) {
  if (expect.url !== undefined) return { ok: location.href.includes(expect.url) };
  if (expect.text !== undefined) return { ok: document.body.innerText.includes(expect.text) };
  if (expect.text_re !== undefined) {
    const m = new RegExp(expect.text_re).exec(document.body.innerText);
    return m ? { ok: true, captured: (m[1] || m[0]).slice(0, 80) } : { ok: false };
  }
  const el = document.querySelector(expect.css);
  return { ok: !!el && el.getBoundingClientRect().width > 0 };
}

function armTakeover() {
  const state = window.__clayBuild = window.__clayBuild || { took: false, armed: false };
  if (!state.armed) {
    for (const type of ["pointerdown", "keydown", "wheel"]) {
      window.addEventListener(type, (e) => { if (e.isTrusted) state.took = true; }, { capture: true, passive: true });
    }
    state.armed = true;
  }
  return state;
}

function waitFor(expect, timeoutMs) {
  const state = armTakeover();
  const started = Date.now();
  return new Promise((resolve) => {
    const tick = () => {
      if (state.took || document.visibilityState === "hidden") return resolve({ ok: false, reason: "takeover" });
      const met = expectMet(expect);
      if (met.ok) return resolve(met);
      if (Date.now() - started > timeoutMs) return resolve({ ok: false, reason: "timeout" });
      setTimeout(tick, 250);
    };
    tick();
  });
}

if (typeof module !== "undefined") module.exports = { normalise, matches, pick };
```

- [ ] **Step 6: Implement `bin/lib/clay_recipe.py`.**
  - Use frozen dataclasses for `Step` and `Action`.
  - `DEFAULT = ROOT / "library/maps/app.clay.com/recipes/find-people-table.json"`.
  - `load()` checks every rule the tests pin, and raises `RecipeError(f"{step_id}: {why}")`:
    - the step ids, in the order the test lists
    - the `surface` and `cost` enums
    - a non-empty `find` list, each entry having `css`
    - `do` from the vocabulary
    - `type` needs a `value`
    - exactly one expect kind
    - `timeout_s` greater than 0
    - the approval rules
    - `title` uppercase and at most 16 characters
    - `note` and `holds` at most 140 characters, with no em dash or en dash
  - `fill` is `text.format_map(_Strict(values))`, where `_Strict.__missing__` raises `KeyError`.
- [ ] **Step 7:** Both tests pass.
- [ ] **Step 8: Commit.** `feat: the find-people recipe as data, with a validated schema and a tested finder`

---

### Task 7: Page driver

**Files:**
- Create: `bin/lib/clay_page.py`
- Test: `tests/test_clay_page.py`

**Interfaces:**
- Consumes: `clay_find.js`, `Window.from_page`, `Rect`, `clay_recipe.Action`
- Produces:
  - `PageError(Exception)`: its message is a sentence for the person, plus `.tried`
  - `Stopped(Exception)`
  - `Found(rect: Rect, window: Window, href: str, text: str)`
  - `Page(spawn=subprocess.Popen, chewie=CHEWIE, frame="app.clay.com", poll_s=0.1)`, with these methods:
    - `.window() -> tuple[Window, str]`, returning the window and its href
    - `.locate(alts) -> Found`, which raises `PageError` when the element is missing or ambiguous
    - `.act(action: Action) -> Found`
    - `.wait(expect: dict, timeout_s: float, should_stop) -> str | None`, which returns the captured text, raises `Paused` on takeover, `PageError` on timeout, and `Stopped` when `should_stop()` is true
    - `.resume()`, which clears the takeover flag
  - `Paused(Exception)`
  - `clay_targets(port: int, fetch=urllib.request.urlopen) -> list[dict]`
- How `_eval` works:
  - It builds `(async () => { <clay_find.js>; return JSON.stringify(await (async () => { <body> })()); })()`.
  - It runs `[chewie, "web", "eval", expr]` with `CHEWIE_WEB_FRAME=app.clay.com`.
  - It polls `should_stop()` every `poll_s`. On stop it kills the process and raises `Stopped`.
  - It kills the process at `timeout_s + 5` and raises `PageError("Chrome stopped answering.")`.
  - A non-zero exit raises `PageError` carrying the stderr text without its `chewie web: ` prefix.

- [ ] **Step 1: Write the failing tests**, with a fake Popen:

```python
class FakeProc:
    def __init__(self, out="", code=0, never=False):
        self.out, self.code, self.never, self.killed = out, code, never, False
    def poll(self):
        return None if self.never and not self.killed else self.code
    def communicate(self, timeout=None):
        return self.out, "chewie web: no tab matching app.clay.com" if self.code else ""
    def kill(self):
        self.killed = True
    def wait(self, timeout=None):
        return self.code

class PageTests(unittest.TestCase):
    def page(self, proc, seen=None):
        def spawn(argv, **kw):
            if seen is not None: seen.append((argv, kw["env"]["CHEWIE_WEB_FRAME"]))
            return proc
        return clay_page.Page(spawn=spawn, chewie="chewie", poll_s=0.01)

    def test_locate_maps_the_answer(self):
        out = json.dumps({"ok": True, "rect": {"x": 1, "y": 2, "w": 3, "h": 4}, "text": "Find leads",
                          "frame": {"screen_x": 0, "screen_y": 38, "outer_w": 1512, "outer_h": 944,
                                    "inner_w": 1512, "inner_h": 857, "dpr": 2, "href": "https://app.clay.com/x"}})
        seen = []
        found = self.page(FakeProc(out), seen).locate([{"css": "button", "text": "Find leads"}])
        self.assertEqual(found.rect, clay_geometry.Rect(1, 2, 3, 4))
        self.assertEqual(seen[0][0][:3], ["chewie", "web", "eval"])
        self.assertEqual(seen[0][1], "app.clay.com")
        self.assertEqual(len(seen[0][0]), 4)  # no URL argument, which would open a new tab

    def test_missing_is_a_sentence(self):
        out = json.dumps({"ok": False, "tried": [{"css": "button", "text": "Continue", "result": "missing"}]})
        with self.assertRaises(clay_page.PageError) as caught:
            self.page(FakeProc(out)).locate([{"css": "button", "text": "Continue"}])
        self.assertIn("Continue", str(caught.exception))

    def test_stop_kills_a_hanging_eval_fast(self):
        proc = FakeProc(never=True)
        started = time.monotonic()
        with self.assertRaises(clay_page.Stopped):
            self.page(proc).wait({"text": "~"}, 90, should_stop=lambda: time.monotonic() - started > 0.05)
        self.assertTrue(proc.killed)
        self.assertLess(time.monotonic() - started, 0.3)

    def test_takeover_pauses(self):
        with self.assertRaises(clay_page.Paused):
            self.page(FakeProc(json.dumps({"ok": False, "reason": "takeover"}))).wait({"text": "x"}, 5, lambda: False)

    def test_chewie_failure_surfaces_its_reason(self):
        with self.assertRaises(clay_page.PageError) as caught:
            self.page(FakeProc("", code=1)).locate([{"css": "button"}])
        self.assertIn("no tab matching", str(caught.exception))

    def test_clay_targets_counts_pages_only(self):
        body = json.dumps([{"type": "page", "url": "https://app.clay.com/a"},
                           {"type": "iframe", "url": "https://app.clay.com/b"},
                           {"type": "page", "url": "https://example.com"}]).encode()
        fetch = lambda url, timeout: io.BytesIO(body)
        self.assertEqual(len(clay_page.clay_targets(9333, fetch=fetch)), 1)
```

Imports are `io, json, sys, time, unittest`, with `bin/lib` on the path, then `clay_page` and `clay_geometry`.

- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Implement.**
  - `CHEWIE = shutil.which("chewie") or str(ROOT / "mac" / "bin" / "chewie")`.
  - `FIND_JS` is read once from `Path(__file__).with_name("clay_find.js")`.
  - `locate` body: `const f = locate(ALTS); return {ok: f.ok, rect: f.rect, text: f.text, tried: f.tried, frame: frame()};`
  - `act` body: `armTakeover(); const f = locate(ALTS); if (!f.ok) return {ok:false, tried:f.tried}; const r = act(f, ACTION); return Object.assign(r, {rect: f.rect, text: f.text, frame: frame()});`
  - `wait` body: `return await waitFor(EXPECT, MS);`
  - `resume` body: `armTakeover().took = false; return {ok: true};`
  - Insert the JSON with `json.dumps`. A located element's message is `f"Couldn't find {text or css} on the page."`, or for ambiguous ones `f"Found {n} matches for {text}, so it stopped instead of guessing."`
  - `clay_targets` GETs `http://127.0.0.1:{port}/json/list` and keeps `type == "page"` with `app.clay.com` in the url.
  - The port is `int(os.environ.get("CHEWIE_CDP_PORT", "9333"))`, matching `web.js:86-95` for the Default profile.
- [ ] **Step 4:** The tests pass.
- [ ] **Step 5: Commit.** `feat: clay page driver over chewie web eval, stop-aware and never opening a tab`

---

### Task 8: Clay reads

**Files:**
- Create: `bin/lib/clay_reads.py`
- Test: `tests/test_clay_reads.py`

**Interfaces:**
- Produces:
  - `ReadError(Exception)`
  - `Reads(run=subprocess.run, root=ROOT)`, with these methods:
    - `.credits(ws: str) -> float`, reading `data["balance"]`
    - `.auto_run(table: str) -> bool`, reading `data["tableSettings"]["AUTO_RUN_ON"]`, true when the value is truthy
    - `.email_field(table: str) -> str`: the column named exactly "Find work email", otherwise the first whose lowercased name contains "work email"; raises `ReadError` when there is none
    - `.progress(ws, table, field) -> Progress(done: int, running: int, queued: int, errors: int)`, from `table-status`
    - `.emails(table, field) -> Tally(rows: int, found: int, missing_names: tuple[str, ...])`, from `rows`, paging with `after=` until a short page
  - `has_email(cell) -> bool`, which searches a cell recursively for `[^@\s]+@[^@\s]+\.[a-z]{2,}`
  - `ids_from_href(href) -> tuple[str | None, str | None]`, returning `(ws, table)` from `/workspaces/(\d+)/` and `/tables/(t_[A-Za-z0-9]+)`
- It runs `node <root>/bin/chewbacca-clay <op> k=v ...` with a 30 s timeout, and parses one JSON line.
  - On `ok: false` it raises `ReadError(reason)`.
  - Status keys are matched case-insensitively:
    - done: `success|succeeded|complete|completed`
    - running: `running`
    - queued: `queued|pending`
    - errors: `error|failed`

- [ ] **Step 1: Write the failing tests.** They use a fake `run` that returns `CompletedProcess(args, 0, json.dumps(payload), "")`, keyed by op. Cover:
  - credits parsing
  - `auto_run` true and false
  - `email_field` exact, fallback and missing
  - `progress` with mixed-case keys
  - `has_email` on a str, a nested dict, a list, and a non-email
  - `emails` across two pages, with the names of misses
  - `ids_from_href`
  - `ok: false` raising `ReadError` with the reason
  - an argv check: `run` received `["node", ".../bin/chewbacca-clay", "credits", "ws=1372623"]`
- [ ] **Steps 2 to 4:** Watch the tests fail, implement, then watch them pass.
- [ ] **Step 5: Add a fixture-mode integration case.**
  - Set `CHEWBACCA_CLAY_FIXTURES=<tmp>` holding `api-anything/creditBalance.json` with `{"ok": true, "class": "ok", "tier": 1, "ms": 120, "data": {"balance": 1234.5, "actionExecutionBalance": 0}}`.
  - Use the shape from `tests/test_chewbacca_clay.py:18`, with the real `subprocess.run`.
  - `Reads().credits("1372623") == 1234.5`.
- [ ] **Step 6: Commit.** `feat: clay reads for the build, credits, auto-run, progress and found emails`

---

### Task 9: HUD client and the five states

**Files:**
- Create: `bin/lib/clay_hud.py`
- Test: `tests/test_clay_hud.py`
- Fixtures: `hud/Tests/KyberKitTests/Fixtures/clay/<state>.lines`, generated by `python3 bin/lib/clay_hud.py --print <state>`

**Interfaces:**
- Consumes: `hud_events.listen_line()` and `hud_events.event()`, `clay_geometry.Rect`
- Surfaces and ids:
  - surfaces: `clay-note`, `clay-card`, `clay-strip`
  - marker: `clay-target`
  - cursor: `a`
- Every action is prefixed `clay-`: `clay-stop`, `clay-approve`, `clay-decline`, `clay-resume`, `clay-end`, `clay-retry`, `clay-show`, `clay-close`, `clay-misses`
- Pure builders, each returning `list[str]`:
  - `acting(step_title, n, total, note, holds, target: Rect, elapsed_s)`
  - `approve(title, rows: list[str], go_label, go_hint, no_hint, target: Rect, elapsed_s, n, total)`
  - `ask_short(found: int, count: int, target: Rect)`: the free "Use all N" or "End here" card
  - `paused(n, total, elapsed_s)`
  - `failed(n, total, expected: str, target: Rect | None, can_retry: bool, elapsed_s)`
  - `done(rows, found, missing_names, spent, auto_run: bool, elapsed_s, show_misses=False)`
  - `clear()`
  - `strip(state, n, total, verb, elapsed_s)`, used by each of the above
- `class Hud(path=None, connect=_connect)`, with these methods:
  - `.open()`: connects, sends `listen_line()`, and starts a reader thread
  - `.send(lines)`: thread-safe; a no-op once dismissed
  - `.next_event(timeout_s) -> dict | None`: returns `{"name": "clay-approve", ...}`, `{"name": "stop"}` for `e stop run`, or `{"name": "dismissed"}` for `x`
  - `.dismissed: bool`
  - `.close()`: sends `clear()` unless dismissed
- `open()` raises `HudMissing` when the socket is absent.
- It stays subscribed for the whole run. That is acceptable because the strip's Stop is live the whole time, but it means hud-listen is not restarted by Kyber during a run (`bin/call-watch:131-134`).

The line shapes the builders emit, acting:

```
@ clay-note near=X,Y,W,H side=right chrome=window w=300
c s Screen title="FIND PEOPLE"
c mk Mark kind=ico spin=true size=18
c body Text value="Asking Clay's people search for fintech VC partners."
c hold Text value="Nothing is saved yet." tone=muted
> s mk body hold
r s
@ clay-strip at=bottom chrome=window w=560
c s Screen title="CLAY-BUILD"
c row Stack direction=horizontal gap=10
c mk Mark kind=ico spin=true size=14
c ticks Text value="■■□□□□"
c verb Text value="Find people · 2/6"
c time Text value="0:42"
c stop Button label="Stop" action=clay-stop
> row mk ticks verb time stop
> s row
r s
m clay-target X Y W H life=300
a CX CY act=true
```

- **approve:** `@ clay-card near=... urgency=alert chrome=window w=300`.
  - It has `Status level=warning message="Waiting on you"` in the strip, and a `Mark kind=ico spin=false`.
  - Each row is a `Text`.
  - `Button action=clay-approve variant=primary`, with a muted `Text` under it naming what it touches and whether it can be undone. Then `Button label="Not now" action=clay-decline`, with its own muted line.
  - It sends `- clay-note`, so only one window shows in the gutter.
- **paused:** `a off`, `u clay-target`.
  - The note is re-addressed with no `near`, so it stays where it was. Title "PAUSED". Body "You have the page." Hold "Nothing spent."
  - Buttons Resume (`clay-resume`) and End here (`clay-end`).
  - Strip `Status level=warning message="Paused"` with a Resume button.
- **failed:** `a off`, plus `m clay-target ... tone=miss life=300` when there is a rect.
  - Note title "STOPPED AT n/6". Body is the expected sentence. Hold "Nothing spent."
  - Buttons Try again (only when `can_retry`), Show me where (only with a rect), End here.
  - Strip `Status level=error message="Stopped at n/6"`.
- **done:** `a off`, `u clay-target`, `- clay-note`.
  - `@ clay-card at=right chrome=window w=320`, with `Mark kind=globe spin=true size=40`.
  - Text rows: people, work emails found, misses, credits spent, auto-run state.
  - Buttons Show the misses (`clay-misses`) and Close (`clay-close`). With `show_misses`, the first 9 names, then "+N more".
  - Strip `Status level=success message="<found>/<rows> emails · <spent> cr"`, with a Close button.

All `value=` strings go through `json.dumps`, which is how call-watch quotes them. Ticks are `"■" * n + "□" * (total - n)`.

- [ ] **Step 1: Write the failing tests**
  - Every builder's lines parse as HUD lines: each starts with one of `@ c > r m u a -`, and no line holds a raw newline.
  - `acting` contains `near=` with the rect's integers and `a <cx> <cy> act=true`.
  - `approve` sends `- clay-note`, and its buttons carry `clay-approve` and `clay-decline`.
  - `failed(can_retry=False)` has no `clay-retry`, and `failed(target=None)` has no `m clay-target`.
  - `done(show_misses=True)` with 12 names lists 9 and "+3 more".
  - Event reading, against a `socketpair`:
    - `e clay-approve go surface="clay-card"` becomes name `clay-approve`
    - `e stop run` becomes `stop`
    - `x` becomes `dismissed`, after which `send` writes nothing
    - `e ks-send x` is ignored
  - `Hud.open()` against a missing path raises `HudMissing`.
  - Quoting: a note holding a `"` survives as JSON.
- [ ] **Steps 2 to 4:** Watch the tests fail, then implement, adding `if __name__ == "__main__": --print <state>`, which writes a representative state's lines to stdout, and watch them pass.
- [ ] **Step 5: Write the fixtures.**
  `for s in acting approve paused failed done; do python3 bin/lib/clay_hud.py --print $s > hud/Tests/KyberKitTests/Fixtures/clay/$s.lines; done`
- [ ] **Step 6: Commit.** `feat: clay hud client, one builder per state and a socket that stops on x`

---

### Task 10: The runner

**Files:**
- Create: `bin/lib/clay_run.py`
- Test: `tests/test_clay_run.py`

**Interfaces:**
- Consumes: everything from Tasks 5 to 9
- Produces:
  - `Outcome(state: str, line: str, spent: float | None)`. `state` is one of `done|dry-run|stopped|declined|failed`.
  - `Run(sentence, count, dry_run, steps, page, reads, hud, board, display, clock=time.monotonic, approve_wait_s=300, close_wait_s=1800).go() -> Outcome`
  - `board` is any object with `.note(text: str)`.

Behaviour, in order:
1. **check:**
   - Read the window and href.
   - Stop on `problem(win, display)`.
   - Read `ws` from the href, otherwise `$CLAY_WORKSPACE_ID`, otherwise `1372623`.
   - Record `balance_before = reads.credits(ws)`.
   - A signed-out href (`/login`, `/signin`, `/sign-up`) fails with "Sign in to Clay in this window, then press Try again."
2. **Each action:**
   1. Check for events without blocking:
      - `stop`, `dismissed`, `clay-stop` or `clay-end` raise `Stopped`.
      - Stop after `dismissed` never draws again.
   2. `found = page.locate(...)`, then convert it with `to_screen`.
   3. Send `acting(...)`, then sleep `GLIDE_S = 0.3`. That is guessed and never measured: the 300 ms glide in the spec.
   4. If `action.approve` is empty, call `page.act(action)`.
   5. `captured = page.wait(...)`.
3. **After find:** parse `captured` as an int with the commas removed. If it is below `count`, show `ask_short`:
   - `clay-approve` makes `count = found`.
   - `clay-decline` stops with "Ended. Nothing was saved."
4. **Approval actions:**
   1. Locate the control and draw `approve(...)` at its rect.
   2. The rows come from Clay's own text:
      - the button text, or the captured "Run N ... rows" line
      - "Balance now X cr"
      - for "rest", also "Test found F of R for S cr", where S is `before - after_test`
   3. In a dry run: draw the card with only Close, holding "Dry run. Nothing was pressed." Wait for `clay-close` or `x` (60 s), then return `Outcome("dry-run", "Stopped at the first approval card. Nothing spent.", 0.0)`.
   4. Otherwise wait for an event up to `approve_wait_s`:
      - `clay-approve` calls `page.act(action)`, marking `paid_sent[action] = True` before the call.
      - `clay-decline`, a timeout, `stop` or `dismissed` return `declined`, "Not now. Nothing spent." The test card always reads "Nothing spent". The rest card reads "Stopped after the test. Spent S cr."
5. **read (step 4):**
   - Get `ws` and `table` from the href.
   - If `reads.auto_run(table)` is true, move to the paused state with "Table auto-run is on. Turn it off in Clay's table settings, then press Resume." Resume re-reads it.
   - `field = email_field(table)`.
   - Poll `progress` every 3 s until `running + queued == 0` (timeout 120 s, guessed). The strip shows `done/rows`.
   - Then `emails(...)`, and `after_test = credits(ws)`.
6. **rest (step 5):**
   - After its approved click, poll `progress` the same way (timeout 600 s, guessed). The strip verb is `"<done>/<count> rows"`.
7. **done:** `balance_end` and `emails(...)`.
   - Send `done(...)`.
   - Handle `clay-misses` by re-sending with `show_misses=True`.
   - `clay-close`, `dismissed` or `close_wait_s` end the run with `Outcome("done", f"{found} of {rows} have work emails. Spent {before - end:.1f} credits.", before - end)`.
8. **Pauses:**
   - `Paused` from `page.wait` draws `paused`.
   - `clay-resume` calls `page.resume()`, then retries the current action from locate.
   - A spends action with `paid_sent` set skips `act` and only waits.
   - `clay-end`, `stop` or `dismissed` stop.
9. **Failures:**
   - `PageError` and `ReadError` draw `failed(...)`, with `can_retry = step.cost == "free"`.
   - `clay-retry` retries the action. `clay-show` re-sends the marker with `life=12` and the cursor on it.
   - Anything else returns `failed`, carrying the sentence.
10. **Notes:** `board.note(f"step {n} of 6: {title}")` once per step, and the strip time re-sent once a second from a daemon thread while acting.

- [ ] **Step 1: Write the failing tests.** Use fakes: `FakePage` scripted per call, `FakeReads`, `FakeHud` (a recorded list of sent lines plus a queue of scripted events), and `FakeBoard`. One test per line below:
  - **Dry run:** it reaches the test card and returns `dry-run`. `FakePage.acted` contains no action with `approve`. No line contains `clay-approve`.
  - **Approval required:** with a `clay-decline` event at the test card, it returns `declined`, and the paid click is never acted.
  - **A full run:**
    - With `clay-approve` twice, `acted` has the two approved clicks exactly once each.
    - `Outcome.spent == before - end`.
    - The done line reads "9 of 10".
  - **A short count:** found 30 for count 50 shows the `ask_short` card. `clay-approve` types `30` into the number input.
  - **Stop:** `stop` while `page.wait` is pending raises through. `Outcome.state == "stopped"`, and no `acting` lines follow the stop.
  - **x:** with `dismissed`, nothing is sent after it, not even `clear()`.
  - **Takeover:**
    - `Paused` on the type action, then `clay-resume`, re-locates and acts once more on the free step.
    - `Paused` after the approved rest click, then `clay-resume`, does not act the paid click again.
  - **Missing element:**
    - On "Continue" it draws `failed` with `clay-retry`, then `clay-retry` succeeds.
    - On the paid test button there is no `clay-retry`.
  - **Auto-run on:** it pauses before the rest card, and no `rest` action is acted until Resume reads false.
  - **Geometry problem at check:** it fails with the DevTools sentence and acts nothing.
- [ ] **Steps 2 to 4:** Watch the tests fail, implement, then watch them pass.
- [ ] **Step 5: Commit.** `feat: clay build runner, approvals before every spend, stop and takeover at any step`

---

### Task 11: `bin/clay-build`

**Files:**
- Create: `bin/clay-build`, extensionless with a python shebang, putting `bin/lib` on `sys.path` the way `bin/call-watch` does
- Test: `tests/test_clay_build.py`

**Interfaces:**
- CLI: `clay-build "<who>" --count N [--dry-run] [--recipe PATH]`. `N` is in 1..500, a bound set by the 2026-10-05 live pull of 500 people in about 2 minutes. Nothing larger has been driven.
- Exits:
  - 0: done or dry-run
  - 1: failed
  - 2: usage
  - 3: refused (lock held, or the HUD missing)
  - 4: stopped or declined
- Lock: `~/.chewbacca/clay-build.lock`, under `$CHEWBACCA_HOME` when set. It copies `bin/hud-listen:4088-4102`: `flock(LOCK_EX|LOCK_NB)` with the pid written inside. It is exposed as `acquire(path) -> (fd | None, holder_pid: str)`.
- Board:
  - `[ROOT/bin/tabs, "register", "--session", f"clay-build-{pid}", "--runtime", "clay-build", "--cwd", ROOT, f"clay-build: {who} x{N}"]`
  - `note --session ...` per step
  - `end --session ...` in `finally`
  - Each call has a 5 s timeout. A failure is written to stderr and the run continues, because the board is visibility, not the guard.
- Start order:
  1. lock
  2. HUD open (`HudMissing` exits 3 with "Kyber isn't running, and this run is meant to be watched.")
  3. Clay tabs:
     - 0 tabs: open one with `chewie web eval "1" https://app.clay.com/`. This is the only URL ever passed, and only when no Clay tab exists.
     - 2 or more: fail with "Two Clay tabs are open in Chewie's Chrome. Close one, then run it again."
  4. display
  5. recipe
  6. `Run.go()`
- Last line on stdout: the outcome as JSON, `{"state","line","spent"}`.

- [ ] **Step 1: Write the failing tests.**
  - **Lock:** a subprocess acquires the lock and sleeps. While it is alive, `acquire` returns `(None, <its pid>)`. After it is killed, `acquire` returns an fd.
  - **CLI usage:** `--count 0` and `--count 501` exit 2. A missing `who` exits 2.
  - **HUD missing:** with `BOB_HUD_SOCKET=<tmp>/none` and `CHEWBACCA_HOME=<tmp>`, it exits 3 and stderr says "Kyber isn't running".
  - **Lock held:** with the lock held by a child and `CHEWBACCA_HOME=<tmp>`, it exits 3 and names the pid.
- [ ] **Steps 2 to 4:** Watch the tests fail, implement, then watch them pass.
- [ ] **Step 5: Commit.** `feat: clay-build, one locked run at a time, on the tab board`

---

### Task 12: Voice route

**Files:**
- Create: `bin/lib/clay_route.py`
- Modify `bin/hud-listen`:
  - `FAST_PATHS` (:1271), adding `"clay_request": "clay"` immediately before `"genui_request"`
  - `fast_path()` (:1287-1342), adding the same branch in the same order
  - `Listener.ask` (:2364-2415), calling `self.clay_request(said, typed)` immediately before `genui_request`
  - a new method `clay_request`, mirroring `open_request` (:2644-2680) line for line with `opener` swapped for `clay_route`
  - the e-line handling (:1839-1848), adding `elif action.startswith("clay-"): pass`, with a comment saying clay-build owns these
- Test: `tests/test_clay_route.py`; rows in `tests/test_fast_path.py` TABLE

**Interfaces:**
- `Command(who: str, count: int | None)` and `Outcome(ok: bool, line: str)`, the same shape as opener
- `parse(said) -> Command | None` matches only these shapes:
  - `clay[,:] <find|get|pull|build> ...`
  - `<find|get|pull> [me] [N] <who> (in|on|from|with|using) clay`
  - `build [me] a list of [N] <who>`
- Count words ten, twenty, ..., hundred map to numbers. Lead-ins are stripped as in `opener._norm`, copied rather than imported, because it is private.
- `perform(command, spawn=_spawn, lock_held=_lock_held) -> Outcome`:
  - count None: `Outcome(False, "Say it with a number, like: find me 50 fintech VC partners in Clay.")`
  - lock held: `Outcome(False, "Clay is already being driven by another run.")`
  - otherwise it spawns `bin/clay-build who --count N` detached (`start_new_session=True`, output to `~/.chewbacca/logs/clay-build.log`) and returns `Outcome(True, "On it.")`, following the feedback memory "voice says on it"

- [ ] **Step 1: Write the failing tests.**
  - **Parses:**
    - "find me 50 fintech VC partners in Clay" gives ("fintech VC partners", 50)
    - "Clay, find 20 seed investors in Austin" gives ("seed investors in Austin", 20)
    - "build a list of fifty fintech VC partners with work emails" gives (..., 50)
    - "okay so find me fintech VC partners in clay" gives count None
  - **Refuses:**
    - "find me a coffee shop"
    - "open clay"
    - "what is clay"
    - "build a website"
  - **perform:** with a fake spawn, the argv is `[.../bin/clay-build, "fintech VC partners", "--count", "50"]`. A held lock does not spawn.
  - **TABLE rows** in `test_fast_path.py`: the three positives map to `"clay"`, and "open clay" still maps to whatever it maps to today. Run the test first to read the current value.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** Run `python3 tests/test_clay_route.py && python3 tests/test_fast_path.py && python3 tests/test_opener.py`. All PASS, and `tests/voice_cases.py` still passes.
- [ ] **Step 5: Commit.** `feat: say find me N people in Clay and clay-build starts, with no model turn`

---

### Task 13: Snapshots of the five states

**Files:**
- Create: `hud/Tests/KyberKitTests/ClayStatesTests.swift`
- Modify: `hud/Package.swift`, adding `resources: [.copy("Fixtures")]` to the test target if it has none. Otherwise read the files from `#filePath`'s directory, which is simpler and the recommended route.

- [ ] **Step 1: Write the test.**
  - For each of `acting approve paused failed done`, read `Fixtures/clay/<state>.lines`.
  - For each `@` surface, group the following lines until the next `@`.
  - Build a `SurfaceStore` through the same `store(lines)` approach `SnapshotTests` uses (`SnapshotTests.swift:126-131`). Copy the helper; it is private.
  - Render `SurfaceCard(... chrome: .window ...)` with the existing `coverage` approach on both grounds.
  - Expect more than 0.05 coverage, and that the note card is at most 300 wide.
  - With `HUD_SNAPSHOT_DIR` set, the PNGs are kept.
- [ ] **Step 2:** Run `swift test --filter ClayStatesTests`. It passes once Tasks 1, 3, 4 and 9 are done, and it fails first if run before the fixtures exist.
- [ ] **Step 3: Look at them.**
  Run `HUD_SNAPSHOT_DIR=/tmp/clay-snap swift test --filter ClayStatesTests`, then Read each PNG. Check them against `look-v2.html`:
  - black title strip
  - Departure Mono titles
  - square corners
  - no glass on content windows
  - one CTA per card
- [ ] **Step 4: Commit.** `test: snapshot every clay hud state from the lines clay-build actually sends`

---

### Task 14: Registration, install, gates

- [ ] **Step 1: Register the tests.** Add to the "gtme" group in `tests/run.sh` (:399-421):

```
  check "clay geometry maps page rects to screen points and stops on a bad window" python3 "$ROOT/tests/test_clay_geometry.py"
  check "the clay recipe validates, and paid steps end on their approval" python3 "$ROOT/tests/test_clay_recipe.py"
  check "the clay finder picks one visible control or stops" node --test "$ROOT/tests/test_clay_find.mjs"
  check "the clay page driver never opens a tab and stops fast" python3 "$ROOT/tests/test_clay_page.py"
  check "clay reads parse credits, progress and found emails" python3 "$ROOT/tests/test_clay_reads.py"
  check "the clay hud draws every state and goes quiet on x" python3 "$ROOT/tests/test_clay_hud.py"
  check "clay-build asks before every spend and stops at once" python3 "$ROOT/tests/test_clay_run.py"
  check "clay-build holds one lock and refuses without Kyber" python3 "$ROOT/tests/test_clay_build.py"
  check "the clay voice route parses only clay requests" python3 "$ROOT/tests/test_clay_route.py"
```

- [ ] **Step 2: Put the CLI on the PATH.** Add `clay-build` to both `link_tool` lists in `setup.sh` (:962, :1052).
- [ ] **Step 3: Gates.** Run:
  - `bash tests/run.sh gtme`
  - `bash tests/run.sh hud`
  - `bash tests/run.sh pytest`
  - `bash tests/undefined_names.sh`
  - `python3 tools/checksums.py`
  - `python3 tools/counts.py`
  - `code-slop --issues`
  - `slop-check docs/CLAY-HUD.md --issues`

  All must pass.
- [ ] **Step 4: Install Kyber yourself.** Run `hud/scripts/install.sh`, which trashes the old app and relaunches, then `echo 'version' | nc -U ~/.bob/hud.sock` to check the socket answers.
- [ ] **Step 5: Smoke test the new lines on the real glass, with no Clay involved.**
  - Send `@ t near=600,400,120,32 chrome=window w=300` plus a `c`/`r` pair, `@ s at=bottom chrome=window w=560`, a `Mark` and `m x 600 400 120 32 tone=miss`.
  - `peekaboo image --mode screen --path /tmp/clay-smoke.png`, then Read it. Expect:
    - the note right of the dashed bracket
    - the strip above the bar
    - the icosahedron turning, checked with two shots 0.5 s apart
  - Clear the glass with `-`.
- [ ] **Step 6: Commit** the registrations, `SHA256SUMS.txt` and the README counts. `chore: register clay-build tests, tool link, checksums and counts`

---

### Task 15: Live dry run

This needs Gavin's attention once. The dry run draws on his screen for about two minutes and uses Chewie's Chrome window, so ask him in one line when it can run (memory: don't hijack his screen). Signing in to Clay in that window, if it is signed out, is his step.

- [ ] **Step 1: Run it.** `clay-build "fintech VC partners with work emails" --count 50 --dry-run`. It spends nothing, and it stops at the test card.
- [ ] **Step 2: Watch the whole run as evidence.** Take `peekaboo image --mode screen` shots at each step and Read them. Check:
  - The bracket sits on the control within 4 pt.
  - The note never covers it.
  - The card says only what Clay said.
- [ ] **Step 3: Measure and write the evidence in.**
  - In the recipe, give each action a measured `timeout_s` with a `"measured"` string (for example `"~N found after 11 s on 2026-10-10; 3x"`), and drop `"unverified"` once its selector has worked.
  - `TOOLBAR_RANGE`, `GLIDE_S`, `nearGap` and `pillReserve` get comments with the values observed.
  - Update the spec's "Numbers still to measure".
- [ ] **Step 4: Repair the recipe.** For every action that missed, read the live DOM with one `chewie web eval` of `JSON.stringify([...document.querySelectorAll('button,[role=menuitem],[role=tab],label,input')].map(e=>[e.tagName,e.innerText?.slice(0,40),e.getAttribute('value')]))`. Run it through `clay_page.Page._eval` from Python, never inline in Bash, because of the launch-guard. Fix the recipe and rerun the dry run until it reaches the card.
- [ ] **Step 5: Log the session.** Add a dated entry to `library/maps/app.clay.com/MAP.md` (Clay learning-loop memory) with every selector learned and every mistake.
- [ ] **Step 6: Commit.** `fix: clay recipe selectors and timeouts from the 2026-10-xx dry run`

---

### Task 16: Review and land

- [ ] **Step 1: Review.** Dispatch one independent `code-reviewer` over the whole branch diff against `docs/CLAY-HUD.md` and this plan's Global Constraints. Fix substantiated findings and rerun the affected tests.
- [ ] **Step 2: Push and land.** Push `feat/clay-hud` to origin, and let pre-push run. Then, under the standing merge-to-main rule, merge into his main and land on Caleb's main after tests and checksums pass.
- [ ] **Step 3: Update memory.** Update `~/dev/gavin-context/memory/project-clay-hud.md`:
  - status: built, dry run passed on its date
  - next: the first paid run
  - Commit only that file.
- [ ] **Step 4: The first paid run is not part of this plan.** It needs Gavin's word and his pick of which workspace pays: about 30 of roughly 100 monthly credits for 50 rows.

---

## Verification

1. **Hermetic.** These run on every push and in CI:
   - `bash tests/run.sh gtme hud pytest` passes, covering every test above.
   - `swift test` in `hud/` passes, including Near, BarLane, AgentMark, the miss tone and ClayStates.
2. **Glass smoke (Task 14, Step 5).** On the installed Kyber, the screenshot shows:
   - the note beside the target
   - the strip above the bar
   - the dashed red bracket
   - the turning mark
3. **Live dry run (Task 15).** It reaches the test card on the real Clay tab and spends nothing:
   - Credits read before and after are equal.
   - The screenshots show alignment.
   - The measured numbers replace every guess.
4. **Voice.** Saying "find me 50 fintech VC partners in Clay" with nothing running starts `clay-build`, and `~/.chewbacca/logs/clay-build.log` shows it.
   - The run stops at the test card. Press Not now there, and the credits stay unchanged.
   - "open clay" still opens.
