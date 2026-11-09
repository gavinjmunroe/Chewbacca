import CoreGraphics
import Foundation
import Testing
@testable import KyberKit

/// A row grows into its card and the card shrinks back into the row.
@Suite("Container transform")
struct ContainerTransformTests {
    let row = CGRect(x: 12, y: 40, width: 180, height: 60)
    let card = CGRect(x: 12, y: 180, width: 356, height: 300)

    @Test("at 0 the card's window is exactly the row, at 1 exactly the card")
    func endpoints() {
        let start = ContainerTransform.pose(progress: 0, source: row, target: card, returning: false, reduced: false)
        // The window is relative to the card's own top-left.
        #expect(start.window == CGRect(x: 0, y: -140, width: 180, height: 60))
        #expect(start.contentOpacity == 0)
        #expect(start.containerOpacity == 0)
        let end = ContainerTransform.pose(progress: 1, source: row, target: card, returning: false, reduced: false)
        #expect(end.window == CGRect(origin: .zero, size: card.size))
        #expect(end.contentOpacity == 1)
        #expect(end.containerOpacity == 1)
    }

    @Test("content arrives over Material's first quarter, then holds")
    func enterFade() {
        let p = { (x: Double) in
            ContainerTransform.pose(progress: x, source: row, target: card, returning: false, reduced: false)
        }
        #expect(p(0.125).contentOpacity > 0.3 && p(0.125).contentOpacity < 0.7)
        #expect(p(0.25).contentOpacity == 1)
        #expect(p(0.6).contentOpacity == 1)
        // The window is still growing while the content is already readable.
        #expect(p(0.6).window.height < card.height)
    }

    @Test("on the way back the content stays readable through 60 percent of the shrink")
    func returnFade() {
        let back = { (x: Double) in
            ContainerTransform.pose(progress: x, source: row, target: card, returning: true, reduced: false)
        }
        #expect(back(0.5).contentOpacity == 1)  // 50% of the way back
        #expect(back(0.4).contentOpacity == 1)  // 60%
        #expect(back(0.1).contentOpacity == 0)  // 90%
        #expect(back(0).window.size == row.size)
    }

    @Test("Reduce Motion and a missing row both mean a fade, nothing travels")
    func fadeOnly() {
        for pose in [
            ContainerTransform.pose(progress: 0.5, source: row, target: card, returning: false, reduced: true),
            ContainerTransform.pose(progress: 0.5, source: nil, target: card, returning: false, reduced: false),
        ] {
            #expect(pose.window.origin == .zero)
            #expect(pose.contentOpacity == 0.5)
        }
    }

    @Test("@ from=<surface>/<row> parses; a value with no row is ignored")
    func parsesFrom() throws {
        guard case let .surface(id, _, _, _, _, _, _, from) =
            try LineParser.parse(#"@ agent at=right from=agents/s1"#) else {
            Issue.record("not a surface")
            return
        }
        #expect(id == "agent")
        #expect(from == "agents/s1")
        guard case let .surface(_, _, _, _, _, _, _, none) = try LineParser.parse("@ agent from=agents") else {
            Issue.record("not a surface")
            return
        }
        #expect(none == nil)
    }

    @Test("a card grown from a row starts the row's width, clamped")
    func startScale() {
        #expect(SurfaceEntrance.startScale(rowWidth: 190, cardWidth: 380) == 0.5)
        #expect(SurfaceEntrance.startScale(rowWidth: 20, cardWidth: 400) == 0.2)
        #expect(SurfaceEntrance.startScale(rowWidth: 600, cardWidth: 400) == 1)
        let entering = SurfaceEntrance(progress: 0, from: .right, summon: .zero, startScale: 0.5)
        #expect(entering.pose.scale == 0.5)
        let rest = SurfaceEntrance(progress: 1, from: .right, summon: .zero, startScale: 0.5)
        #expect(rest.pose.scale == 1)
    }

    @Test("rows report into their surface and a closed surface forgets them")
    @MainActor
    func anchors() {
        let a = RowAnchors.shared
        a.report(surface: "t-anchors", row: "s1", local: row, screen: row.offsetBy(dx: 100, dy: 100))
        #expect(a.local(surface: "t-anchors", row: "s1") == row)
        #expect(a.screen(of: "t-anchors/s1") == row.offsetBy(dx: 100, dy: 100))
        a.forget(surface: "t-anchors")
        #expect(a.local(surface: "t-anchors", row: "s1") == nil)
        #expect(a.age(of: "t-anchors") == 0)
    }
}

/// The light that travels between a row and its card.
@Suite("Container transform, the flight")
@MainActor
struct FlightTests {
    let row = CGRect(x: 12, y: 40, width: 180, height: 60)
    let card = CGRect(x: 12, y: 180, width: 356, height: 300)

    @Test("the light starts on the row and lands on the card, in the surface's space")
    func frames() {
        let out = Flight(surface: "s", source: row, target: card, returning: false)
        #expect(ContainerTransform.frame(of: out, at: 0) == row)
        #expect(ContainerTransform.frame(of: out, at: 1) == card)
        let back = Flight(surface: "s", source: card, target: row, returning: true)
        #expect(ContainerTransform.frame(of: back, at: 1) == row)
    }

    @Test("it is lit only in flight: dark on the row, dark once landed")
    func glow() {
        #expect(ContainerTransform.glow(at: 0) == 0)
        #expect(ContainerTransform.glow(at: 0.4) == 1)
        #expect(ContainerTransform.glow(at: 1) == 0)
    }

    @Test("a new flight out replaces the last one on that surface; a closed surface drops its flights")
    func launching() {
        let anchors = RowAnchors.shared
        anchors.launch(Flight(surface: "t-flight", source: row, target: card, returning: false))
        anchors.launch(Flight(surface: "t-flight", source: row, target: card, returning: false))
        #expect(anchors.flights.filter { $0.surface == "t-flight" }.count == 1)
        anchors.forget(surface: "t-flight")
        #expect(anchors.flights.filter { $0.surface == "t-flight" }.isEmpty)
    }

    @Test("the light starts on the pressed row's frame, even when the list moved before the card opened")
    func originIsThePressedRow() {
        let anchors = RowAnchors.shared
        let a = CGRect(x: 12, y: 40, width: 300, height: 44)
        let b = CGRect(x: 12, y: 84, width: 300, height: 44)
        let c = CGRect(x: 12, y: 128, width: 300, height: 44)
        for (id, frame) in [("a", a), ("b", b), ("c", c)] {
            anchors.report(surface: "t-press", row: id, local: frame, screen: frame)
        }
        let store = SurfaceStore()
        store.surfaceID = "t-press"
        store.fireRow("open", row: "c")
        // The answer redraws the list (a row above arrives) before the card
        // opens: c is now drawn one row lower.
        anchors.report(surface: "t-press", row: "c", local: c.offsetBy(dx: 0, dy: 44), screen: c)
        #expect(anchors.origin(surface: "t-press", row: "c") == c)
        // Another row's card never starts from the pressed row.
        #expect(anchors.origin(surface: "t-press", row: "b") == b)
        // The flight it launches starts exactly there.
        let card = CGRect(x: 12, y: 230, width: 356, height: 200)
        let flight = Flight(surface: "t-press", source: anchors.origin(surface: "t-press", row: "c")!,
                            target: card, returning: false)
        #expect(ContainerTransform.frame(of: flight, at: 0) == c)
        // An old press does not decide a card a refresh opened later.
        anchors.press(surface: "t-press", row: "a", at: Date().addingTimeInterval(-60))
        #expect(anchors.origin(surface: "t-press", row: "a") == a)
        anchors.forget(surface: "t-press")
    }

    @Test("the light stretches off its row: the source edge holds, so it never sits row-sized on a neighbour")
    func stretches() {
        let row = CGRect(x: 12, y: 84, width: 300, height: 44)
        let card = CGRect(x: 12, y: 230, width: 356, height: 200)
        let out = Flight(surface: "s", source: row, target: card, returning: false)
        for step in 0...30 {
            let p = Double(step) / 100
            #expect(ContainerTransform.frame(of: out, at: p).minY == row.minY)
        }
        for step in 1..<100 {
            let light = ContainerTransform.frame(of: out, at: Double(step) / 100)
            #expect(light.height >= row.height)
        }
        let back = Flight(surface: "s", source: card, target: row, returning: true)
        #expect(ContainerTransform.frame(of: back, at: 0.2).maxY == card.maxY)
        #expect(ContainerTransform.frame(of: back, at: 1) == row)
    }
}
