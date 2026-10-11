import Foundation
import Testing

@testable import KyberKit

/// Panels kept off the window they are about (bd_2026-Code-0l9).
@Suite("Occlusion")
@MainActor
struct OcclusionTests {
    @Test("how much of a window a card hides")
    func covered() {
        let window = CGRect(x: 0, y: 0, width: 100, height: 100)
        #expect(Occlusion.covered(window, by: CGRect(x: 50, y: 0, width: 100, height: 100)) == 0.5)
        #expect(Occlusion.covered(window, by: CGRect(x: 200, y: 0, width: 10, height: 10)) == 0)
        #expect(Occlusion.hidesAll(window, by: CGRect(x: -10, y: -10, width: 130, height: 130)))
        #expect(!Occlusion.hidesAll(window, by: CGRect(x: 20, y: -10, width: 130, height: 130)))
    }

    @Test("the least covering corner wins, and the preferred one wins a tie")
    func leastCovering() {
        let window = CGRect(x: 0, y: 0, width: 100, height: 100)
        let far = CGRect(x: 500, y: 0, width: 50, height: 50)
        #expect(Occlusion.leastCovering(
            [(.topRight, far), (.topLeft, far.offsetBy(dx: 100, dy: 0))], window: window) == .topRight)
        #expect(Occlusion.leastCovering(
            [(.topRight, window), (.topLeft, far)], window: window) == .topLeft)
    }

    private func open(_ model: OverlayModel, _ line: String) throws -> OverlaySurface {
        for text in [line, "c s Screen title=\"X\"", "r s"] {
            model.apply(try #require(try LineParser.parse(text)))
        }
        let id = LineParser.tokenize(line)[1]
        return try #require(model.surfaces.first { $0.id == id })
    }

    @Test("with no `at=`, a surface avoids a window filling the right of the screen")
    func defaultCornerMoves() throws {
        let screen = try #require(OverlayWindow.active).frame
        let model = OverlayModel()
        // An editor on the right two thirds.
        let window = CGRect(
            x: screen.width / 3, y: 0, width: screen.width * 2 / 3, height: screen.height)
        model.describe(frontWindow: window)
        let surface = try open(model, "@ answer w=380")
        #expect(surface.region == .topLeft || surface.region == .bottomLeft)
        #expect(Occlusion.covered(window, by: model.frame(of: surface)) < 0.05)
        #expect(!surface.regionAsked)
    }

    @Test("an empty screen keeps the old default corner")
    func noWindowNoChange() throws {
        let model = OverlayModel()
        #expect(try open(model, "@ answer w=380").region == .topRight)
    }

    @Test("an explicit `at=` is kept when it leaves the window visible")
    func askedCornerKept() throws {
        let screen = try #require(OverlayWindow.active).frame
        let model = OverlayModel()
        model.describe(frontWindow: CGRect(
            x: screen.width / 3, y: 0, width: screen.width * 2 / 3, height: screen.height))
        let surface = try open(model, "@ answer at=topRight w=380")
        #expect(surface.region == .topRight)
        #expect(surface.regionAsked)
    }

    @Test("no surface is drawn over the whole of the window in front")
    func neverHidesAll() throws {
        let screen = try #require(OverlayWindow.active).frame
        let model = OverlayModel()
        let probe = try open(model, "@ probe at=topRight w=380")
        let card = model.frame(of: probe)
        model.close("probe")
        // A small dialog exactly where a top-right card lands.
        let dialog = CGRect(x: card.minX + 40, y: card.minY + 10, width: 200, height: 80)
        model.describe(frontWindow: dialog)
        let surface = try open(model, "@ answer at=topRight w=380")
        let frame = model.frame(of: surface)
        #expect(!Occlusion.hidesAll(dialog, by: frame))
        #expect(!frame.intersects(dialog))
        #expect(frame.maxX <= screen.width)
    }
}
