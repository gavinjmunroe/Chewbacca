import Foundation
import Testing

@testable import KyberKit

/// `glance <surface>`: answers read once (search, a repo card, a note) close
/// when the person clicks on with their work, the same as pressing the X.
/// Before this, only the files card did; the search, repo and notes cards
/// closed on Escape, X or voice only (2026-10-09).
@Suite("Glance")
@MainActor
struct GlanceTests {
    final class Box { var events: [String] = [] }

    private func model(_ lines: [String]) throws -> (OverlayModel, Box) {
        let model = OverlayModel()
        let box = Box()
        model.onEvent = { box.events.append($0.line) }
        for line in lines {
            model.apply(try #require(try LineParser.parse(line)))
        }
        return (model, box)
    }

    private let two = [
        "@ search at=topRight w=320", "c s Screen title=\"SEARCH\"", "r s", "glance search",
        "@ week at=topLeft w=320", "c w Screen title=\"WEEK\"", "r w",
    ]

    @Test("`glance` parses, and takes exactly one name")
    func parses() throws {
        #expect(try LineParser.parse("glance search") == .glance(id: "search"))
        #expect(throws: (any Error).self) { try LineParser.parse("glance") }
        #expect(throws: (any Error).self) { try LineParser.parse("glance a b") }
    }

    @Test("A click off every card takes a glance down and says so; other cards stay")
    func clickAway() throws {
        let (model, box) = try model(two)
        let card = model.frame(of: try #require(model.surfaces.first { $0.id == "search" }))
        let other = model.frame(of: try #require(model.surfaces.first { $0.id == "week" }))
        let away = CGPoint(x: max(card.maxX, other.maxX) + 300, y: max(card.maxY, other.maxY) + 300)
        model.clickedAway(at: away)
        #expect(!model.surfaces.contains { $0.id == "search" })
        #expect(model.surfaces.contains { $0.id == "week" })
        #expect(box.events.contains { $0.hasPrefix("e closed search") })
    }

    @Test("A click on any card keeps the glance: pressing a row isn't done")
    func clickOnACard() throws {
        let (model, box) = try model(two)
        let card = model.frame(of: try #require(model.surfaces.first { $0.id == "search" }))
        let other = model.frame(of: try #require(model.surfaces.first { $0.id == "week" }))
        model.clickedAway(at: CGPoint(x: card.midX, y: card.midY))
        model.clickedAway(at: CGPoint(x: other.midX, y: other.midY))
        #expect(model.surfaces.contains { $0.id == "search" })
        #expect(box.events.isEmpty)
    }

    @Test("Closed or cleared, a name stops being a glance, so a redraw without it stays")
    func forgets() throws {
        let (model, _) = try model(two)
        model.apply(try #require(try LineParser.parse("- search")))
        #expect(!model.glances.contains("search"))
        model.apply(try #require(try LineParser.parse("glance week")))
        model.reset()
        #expect(model.glances.isEmpty)
    }
}
