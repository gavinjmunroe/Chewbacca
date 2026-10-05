import AppKit
import SwiftUI
import Testing

@testable import KyberKit

/// Surfaces as an OS's windows: how they arrive, how they change, where they
/// go when a corner fills up, how big their targets are, and what a row's
/// button says up the socket. The rules are in hud/CLAUDE.md under "Motion
/// that means something".
@Suite("Surface motion")
@MainActor
struct SurfaceMotionTests {
    // MARK: 1. Entry and exit

    @Test("a summoned surface starts on the hyper bar, small, and lands in place")
    func summonedEntrance() {
        let toBar = CGSize(width: -300, height: 420)
        let start = SurfaceEntrance(progress: 0, from: .topRight, summon: toBar).pose
        #expect(start.offset == toBar, "it does not start at the bar")
        #expect(start.scale < 0.5, "it does not grow out of the bar")
        #expect(start.opacity == 0)
        let end = SurfaceEntrance(progress: 1, from: .topRight, summon: toBar).pose
        #expect(end == .init(opacity: 1, blur: 0, scale: 1, offset: .zero))
    }

    @Test("a surface nobody summoned comes in from its own edge")
    func regionEntrance() {
        let start = SurfaceEntrance(progress: 0, from: .bottomLeft).pose
        #expect(start.offset.width < 0, "bottom left should come from the left")
        #expect(start.offset.height > 0, "bottom left should come up from below")
    }

    @Test("the entrance is under 300 ms and the exit shorter and quieter")
    func exitIsQuieter() {
        #expect(SurfaceEntrance.arriveDuration < 0.3)
        #expect(SurfaceEntrance.departDuration < SurfaceEntrance.arriveDuration)
        let toBar = CGSize(width: 0, height: 400)
        let leaving = SurfaceEntrance(
            progress: 0, from: .top, summon: toBar, reach: SurfaceEntrance.departReach).pose
        #expect(abs(leaving.offset.height) < abs(toBar.height) / 2,
                "an exit travelled as far as the entrance")
    }

    @Test("under Reduce Motion nothing travels or scales, it only fades")
    func reduceMotionFades() {
        for progress in [0.0, 0.5] {
            let pose = SurfaceEntrance(
                progress: progress, from: .top, summon: CGSize(width: 90, height: 90),
                reduced: true).pose
            #expect(pose.offset == .zero)
            #expect(pose.scale == 1)
            #expect(pose.opacity == progress)
        }
    }

    @Test("`-` takes the surface off the glass")
    func closeRemoves() throws {
        let model = OverlayModel()
        model.apply(try #require(try LineParser.parse("@ demo at=right")))
        #expect(model.surfaces.map(\.id) == ["demo"])
        model.apply(try #require(try LineParser.parse("- demo")))
        #expect(model.surfaces.isEmpty)
    }

    // MARK: 2. Live values

    @Test("a row that was already there keeps its identity when one is added above it")
    func rowsKeepIdentity() {
        let before = RowKeys.keys([.string("Sam"), .string("Ava")])
        let after = RowKeys.keys([.string("Jo"), .string("Sam"), .string("Ava")])
        #expect(Set(before).isSubset(of: Set(after)))
        // By id when there is one: a row whose text changes is the same row.
        let a = RowKeys.keys([.object(["id": .string("t1"), "text": .string("hi")])])
        let b = RowKeys.keys([.object(["id": .string("t1"), "text": .string("hi again")])])
        #expect(a == b)
    }

    @Test("two identical rows are still two rows")
    func duplicateRows() {
        let keys = RowKeys.keys([.string("ok"), .string("ok"), .string("ok")])
        #expect(Set(keys).count == 3)
    }

    @Test("a `d` that adds an event re-keys nothing that was already there")
    func eventsNoLongerRebuild() throws {
        // Events keyed every row with a fresh UUID until 2026-10-04, so any
        // change rebuilt every row. Keyed by content, the old rows survive.
        let first: [JSON] = [.object(["time": .string("9:00"), "text": .string("Standup")])]
        let second = [.object(["time": .string("9:30"), "text": .string("Review")])] + first
        #expect(RowKeys.keys(second).contains(RowKeys.keys(first)[0]))
    }

    // MARK: 3. Tiling

    @Test("a full region folds its least recently touched surface, never the newest")
    func planFoldsOldest() {
        let column: [(id: String, height: CGFloat, touched: Int)] = [
            ("old", 300, 1), ("mid", 300, 2), ("new", 300, 3),
        ]
        #expect(OverlayModel.plan(column, capacity: 2000).isEmpty)
        #expect(OverlayModel.plan(column, capacity: 700) == ["old"])
        #expect(OverlayModel.plan(column, capacity: 400) == ["old", "mid"])
        // Even when nothing else would fit, the newest stays open.
        #expect(!OverlayModel.plan(column, capacity: 10).contains("new"))
    }

    @Test("a bottom corner stacks upward instead of drawing over itself")
    func bottomStacksUp() {
        let column: [(slot: Int, height: CGFloat)] = [(0, 100), (1, 80)]
        let first = OverlayModel.columnTop(
            slot: 0, column: column, anchorY: 0, top: 40, bottom: 900)
        let second = OverlayModel.columnTop(
            slot: 1, column: column, anchorY: 0, top: 40, bottom: 900)
        #expect(first + 100 == 900, "the first does not sit on the bottom edge")
        #expect(second + 80 <= first, "the second overlaps the first")
        // And a top corner still grows downward.
        let topSecond = OverlayModel.columnTop(
            slot: 1, column: column, anchorY: 1, top: 40, bottom: 900)
        #expect(topSecond >= 40 + 100)
    }

    @Test("opening a third tall panel in a corner folds the first; touching it swaps")
    func modelFoldsAndUnfolds() throws {
        let model = OverlayModel()
        for name in ["a", "b", "c"] {
            model.apply(try #require(try LineParser.parse("@ \(name) at=right")))
            model.report(height: 330, for: name)
        }
        func folded() -> [String] { model.surfaces.filter(\.compact).map(\.id) }
        #expect(folded() == ["a"])
        model.unfold("a")
        #expect(folded() == ["b"])
        // A `d` to the folded panel keeps it folded: data is not attention.
        model.apply(try #require(try LineParser.parse("d /n 3")))
        #expect(folded() == ["b"])
        // Re-addressing it with `@` is: it opens, and the least recent folds.
        model.apply(try #require(try LineParser.parse("@ b")))
        #expect(folded() == ["c"], "re-addressing b should count as touching it")
    }

    @Test("folding is the same card getting shorter: 44 points, title kept")
    func foldIsOneCard() {
        let store = SurfaceStore()
        store.apply([
            .component(ComponentNode(
                id: "s", type: "Screen", props: ["title": .literal(.string("MAIL"))],
                children: ["l"])),
            .component(ComponentNode(
                id: "l", type: "List",
                props: ["items": .literal(.array((1...8).map { .string("Row \($0)") }))])),
            .root(id: "s"),
        ])
        func card(_ compact: Bool) -> CGFloat {
            var surface = OverlaySurface(
                id: "m", store: store, region: .right, width: 380, slot: 0, depth: 1)
            surface.compact = compact
            return height(
                SurfaceCard(surface: surface, onDismiss: {}, onDrag: { _ in }, onGrab: {})
                    .environment(\.hudOffscreen, true))
        }
        let open = card(false)
        let folded = card(true)
        #expect(abs(folded - OverlayModel.foldedHeight) < 1, "folded card is \(folded)pt")
        #expect(open > folded + 100)
    }

    @Test("the conversation panel's words wait for the glass, which is never hidden")
    func chatWordsWait() {
        #expect(GrowFromPill.contentOpacity(0) == 0)
        #expect(GrowFromPill.contentOpacity(1) == 1)
    }

    // MARK: 4. Hit targets

    private func height(_ view: some View) -> CGFloat {
        let host = NSHostingView(rootView: view.frame(width: 300))
        return host.fittingSize.height
    }

    @Test("every control is at least 44 points tall")
    func hitTargets() throws {
        #expect(HitTarget.minimum >= 44)
        #expect(height(Button("Go") {}.buttonStyle(HUDButtonStyle(primary: true))) >= 44)
        #expect(height(HUDField(placeholder: "Note", text: .constant(""))) >= 44)
        #expect(height(FoldedTitle(title: "MAIL", onUnfold: {})) >= 44)
        let action = try #require(RowAction(["action": .string("reply")]) { _ in })
        #expect(height(RowActionButton(action: action, row: "t1")) >= 44)
        #expect(height(CloseButton(action: {}, hit: HitTarget.minimum)) >= 44)
    }

    @Test("a Select's whole row opens it, at 44 points")
    func selectIsTall() {
        let store = SurfaceStore()
        store.apply([
            .component(ComponentNode(id: "s", type: "Screen", props: ["title": .literal(.string("T"))],
                                     children: ["pick"])),
            .component(ComponentNode(
                id: "pick", type: "Select",
                props: [
                    "label": .literal(.string("Status")),
                    "value": .binding(DataBinding(pointer: "/status")),
                    "options": .literal(.array([.string("Todo"), .string("Done")])),
                ])),
            .root(id: "s"),
        ])
        // Title, label and the 44-point menu row, with their spacing.
        #expect(height(SurfaceView(store: store).environment(\.hudOffscreen, true)) >= 44 + 13 + 14)
    }

    // MARK: 5. Row actions

    @Test("a row's button sends the action, the component, the row id and the surface")
    func rowActionLine() throws {
        let store = SurfaceStore()
        store.surfaceID = "messages"
        var sent: [String] = []
        store.onEvent = { sent.append($0.line) }
        // The closure a row's button calls, built the way the renderer
        // builds it for an Events with `action=reply`.
        let props: [String: JSON] = ["action": .string("reply")]
        let action = try #require(SurfaceView(store: store).rowAction(props, "threads"))
        action.send("thread:abc123")
        action.send("thread with spaces")
        // The contract with bin/kyber-surfaces, byte for byte.
        #expect(sent == [
            "e action reply row=thread:abc123 surface=messages",
            "e action reply row=\"thread with spaces\" surface=messages",
        ])
    }

    @Test("every surface action names its surface, so two panels' ids cannot collide")
    func actionsNameTheirSurface() throws {
        let model = OverlayModel()
        var sent: [String] = []
        model.onEvent = { sent.append($0.line) }
        model.apply(try #require(try LineParser.parse("@ mail at=left")))
        let store = try #require(model.surfaces.first?.store)
        store.fire("archive", from: "go")
        #expect(sent == ["e archive go surface=mail"])
    }

    @Test("a row with no id is named by its content, quoted when it has spaces")
    func rowFallsBackToContent() {
        let items: [JSON] = [.string("Bring the charger")]
        let key = RowKeys.keys(items)[0]
        #expect(RowKeys.id(of: items[0]) == nil)
        #expect(key == "Bring the charger")
        let event = OutboundEvent.rowAction(name: "done", row: key, surface: "todo")
        #expect(event.line == "e action done row=\"Bring the charger\" surface=todo")
    }

    @Test("a List, Table and Events with an action draw a button per row",
          arguments: ["List", "Table", "Events"])
    func repeatersDraw(type: String) {
        let rows: JSON = .array([
            .object(["id": .string("t1"), "text": .string("Sam: lunch?"), "name": .string("Sam")]),
            .object(["id": .string("t2"), "text": .string("Ava: notes"), "name": .string("Ava")]),
        ])
        var props: [String: PropValue] = [
            "action": .literal(.string("reply")),
            "actionLabel": .literal(.string("Reply")),
        ]
        if type == "Table" {
            props["rows"] = .literal(rows)
            props["columns"] = .literal(.array([.object(["field": .string("name")])]))
        } else {
            props["items"] = .literal(rows)
        }
        let store = SurfaceStore()
        store.apply([
            .component(ComponentNode(id: "s", type: "Screen", children: ["x"])),
            .component(ComponentNode(id: "x", type: type, props: props)),
            .root(id: "s"),
        ])
        // Two rows of 44-point targets: the repeater drew a button on each.
        #expect(height(SurfaceView(store: store).environment(\.hudOffscreen, true)) >= 88)
    }
}
