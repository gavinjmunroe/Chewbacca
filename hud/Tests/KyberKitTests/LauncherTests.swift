import AppKit
import SwiftUI
import Testing

@testable import KyberKit

/// Segmented lanes, avatars and the launcher rail: the pieces an OS-shaped
/// surface needs beyond lists and numbers. Each sends the same row-action
/// line as a row's button, so `bin/kyber-surfaces` reads one format.
@Suite("Launcher")
@MainActor
struct LauncherTests {
    private func height(_ view: some View) -> CGFloat {
        NSHostingView(rootView: view.frame(width: 360)).fittingSize.height
    }

    @Test("a lane press writes the lane and sends the row-action line")
    func segmentedSends() {
        let store = SurfaceStore()
        store.surfaceID = "tasks"
        var sent: [String] = []
        store.onEvent = { sent.append($0.line) }
        let node = ComponentNode(
            id: "lanes", type: "Segmented",
            props: ["value": .binding(DataBinding(pointer: "/lane"))])
        SurfaceView(store: store).segmentedPick(node, [:])("cooking")
        #expect(store.spec.data["lane"] == .string("cooking"))
        #expect(sent.contains("e action select row=cooking surface=tasks"))
    }

    @Test("lanes parse from strings or objects, with counts")
    func segmentedOptions() {
        let options = SegmentedView.options([
            .object(["id": .string("ready"), "label": .string("Ready"), "count": .number(17)]),
            .string("Cooking"),
        ])
        #expect(options.map(\.id) == ["ready", "Cooking"])
        #expect(options[0].count == "17")
        #expect(options[1].count == nil)
    }

    @Test("lanes are 44 points tall")
    func segmentedTarget() {
        let view = SegmentedView(
            options: [.init(id: "a", label: "Ready", count: "17")], selected: "a", onPick: { _ in })
        #expect(height(view) >= HitTarget.minimum)
    }

    @Test("an avatar is two initials at most, and the same colour for the same name")
    func avatarInitials() {
        #expect(AvatarView.initials("Sam Lee") == "SL")
        #expect(AvatarView.initials("ava") == "A")
        #expect(AvatarView.initials("Mac & Cheese") == "MC")
        #expect(AvatarView.initials("Mary Jane Watson") == "MJ")
        #expect(AvatarView.hue("Sam Lee") == AvatarView.hue("Sam Lee"))
    }

    @Test("rail badges come from /badges/<id>, and zero shows none")
    func railBadges() {
        let data: [String: JSON] = ["badges": .object(["tasks": .number(14), "mail": .number(0)])]
        let entries = RailView.entries([
            .object(["id": .string("tasks"), "label": .string("Tasks"), "open": .bool(true)]),
            .object(["id": .string("mail")]),
        ], data: data)
        #expect(entries.map(\.badge) == ["14", nil])
        #expect(entries.map(\.isOpen) == [true, false])
        #expect(entries[1].label == "Mail")
    }

    @Test("a 0 or 1 inside JSON stays a number, and true and false stay bools")
    func jsonZeroIsNotFalse() throws {
        let op = try #require(try LineParser.parse(#"d /badges {"mail":0,"tasks":1,"x":false,"y":true}"#))
        guard case .data(_, let value) = op, let object = value?.objectValue else {
            Issue.record("not a data op")
            return
        }
        #expect(object["mail"] == .number(0))
        #expect(object["tasks"] == .number(1))
        #expect(object["x"] == .bool(false))
        #expect(object["y"] == .bool(true))
    }

    @Test("a badge is a whole number above zero, capped at 9+, or nothing")
    func badgeRules() {
        #expect(RailView.badgeCount(.number(3)) == 3)
        #expect(RailView.badgeCount(.string("12")) == 12)
        for hidden: JSON? in [.number(0), .number(-2), .number(2.5), .string("no"),
                              .bool(false), .bool(true), .null, nil, .string("error")] {
            #expect(RailView.badgeCount(hidden) == nil, "\(String(describing: hidden)) drew a badge")
        }
        #expect(RailView.badgeText(4) == "4")
        #expect(RailView.badgeText(14) == "9+")
    }

    @Test("selected fills the well and counts as open")
    func railSelected() {
        let entries = RailView.entries(
            [.object(["id": .string("tasks"), "selected": .bool(true)])], data: [:])
        #expect(entries[0].isSelected)
        #expect(entries[0].isOpen)
    }

    @Test("the rail draws on its own glass, over light and dark")
    func railDraws() {
        let entries = RailView.entries([
            .object(["id": .string("today"), "symbol": .string("sun.max")]),
            .object(["id": .string("tasks"), "symbol": .string("checklist"), "selected": .bool(true)]),
        ], data: ["badges": .object(["tasks": .number(14)])])
        let view = RailView(entries: entries, onOpen: { _ in }).environment(\.hudOffscreen, true)
        let size = NSHostingView(rootView: view).fittingSize
        // Two 38-point wells, 8 apart, inside 10 above and below and 7 beside: 104 by 52.
        #expect(abs(size.height - 104) < 2, "rail is \(size.height) tall")
        #expect(abs(size.width - 52) < 2, "rail is \(size.width) wide")
    }

    @Test("the rail reads over a light and a dark ground", arguments: [0.97, 0.09])
    func railOverGrounds(level: Double) throws {
        let entries = RailView.entries([
            .object(["id": .string("today"), "symbol": .string("sun.max")]),
            .object(["id": .string("tasks"), "symbol": .string("checklist"), "selected": .bool(true)]),
            .object(["id": .string("mail"), "symbol": .string("envelope"), "open": .bool(true)]),
        ], data: ["badges": .object(["tasks": .number(14), "mail": .number(3)])])
        let view = ZStack {
            Color(white: level)
            RailView(entries: entries, onOpen: { _ in })
        }
        .frame(width: 120, height: 200)
        .environment(\.hudOffscreen, true)
        let renderer = ImageRenderer(content: view)
        renderer.scale = 2
        let image = try #require(renderer.cgImage)
        let rep = NSBitmapImageRep(cgImage: image)
        // The capsule must separate from the ground: the pixel in the rail's
        // middle, between wells, differs from the ground by a clear margin.
        let ground = try #require(rep.colorAt(x: 4, y: 4)?.brightnessComponent)
        let rail = try #require(rep.colorAt(x: 120, y: 200)?.brightnessComponent)
        #expect(abs(ground - rail) > 0.15, "rail \(rail) vs ground \(ground)")
        if let dir = ProcessInfo.processInfo.environment["HUD_SNAPSHOT_DIR"],
           let png = rep.representation(using: .png, properties: [:]) {
            try png.write(to: URL(fileURLWithPath: dir).appendingPathComponent("rail-\(level).png"))
        }
    }

    @Test("a rail owns its lane: never folded, never counted in its region's column")
    func railOwnsLane() throws {
        let model = OverlayModel()
        for line in [
            "@ rail at=right w=52 chrome=bare", "c s Screen", "r s",
            #"c r Rail items=[{"id":"tasks"}]"#, "> s r",
        ] {
            model.apply(try #require(try LineParser.parse(line)))
        }
        model.report(height: 700, for: "rail")
        for name in ["a", "b"] {
            model.apply(try #require(try LineParser.parse("@ \(name) at=right")))
            model.report(height: 330, for: name)
        }
        let rail = try #require(model.surfaces.first { $0.id == "rail" })
        #expect(rail.isRail)
        #expect(!rail.compact)
        // a and b fit in 764 without the rail's 700 counted against them.
        #expect(model.surfaces.filter(\.compact).isEmpty)
    }

    @Test("a rail press sends `e action open row=<surface>`")
    func railOpens() {
        let store = SurfaceStore()
        store.surfaceID = "rail"
        var sent: [String] = []
        store.onEvent = { sent.append($0.line) }
        store.fireRow("open", row: "tasks")
        #expect(sent == ["e action open row=tasks surface=rail"])
    }
}
