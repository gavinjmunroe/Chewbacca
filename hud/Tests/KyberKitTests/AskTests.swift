import Foundation
import Testing

@testable import KyberKit

/// `ask=` on a Screen: double-clicking the card takes its request into the
/// conversation. The verse card is the first sender (2026-10-16: "If I double
/// click on them I want it to go into chat w the hud and chewbs where I can
/// talk abt the verse").
@Suite("Ask from a card")
@MainActor
struct AskTests {
    final class Box { var asked: [String] = []; var events: [String] = [] }

    private func model(_ lines: [String]) throws -> (OverlayModel, Box) {
        let model = OverlayModel()
        let box = Box()
        model.onAsk = { box.asked.append($0) }
        model.onEvent = { box.events.append($0.line) }
        for line in lines {
            model.apply(try #require(try LineParser.parse(line)))
        }
        return (model, box)
    }

    private let verse = [
        "@ verse at=top w=480 urgency=ambient",
        "c s Screen title=\"PHILIPPIANS 4:11\" ask=\"Let's talk abt Philippians 4:11: For I have learned, in whatsoever state I am, therewith to be content.\"",
        "c t Text value=\"For I have learned, in whatsoever state I am, therewith to be content.\"",
        "> s t",
        "r s",
    ]

    @Test("The Screen keeps its ask, verse reference and text intact")
    func parses() throws {
        let (model, _) = try model(verse)
        let store = try #require(model.surfaces.first { $0.id == "verse" }).store
        let screen = try #require(store.spec.elements["s"])
        #expect(store.resolved(screen)["ask"]?.display
            == "Let's talk abt Philippians 4:11: For I have learned, in whatsoever state I am, therewith to be content.")
    }

    @Test("A double-click's ask goes to the conversation and opens the panel, never up as an event")
    func doubleClickAsks() throws {
        let (model, box) = try model(verse)
        let store = try #require(model.surfaces.first { $0.id == "verse" }).store
        #expect(!model.chatOpen)
        store.ask("Let's talk abt Philippians 4:11: For I have learned")
        #expect(box.asked == ["Let's talk abt Philippians 4:11: For I have learned"])
        #expect(model.chatOpen)
        #expect(box.events.isEmpty)
        // The card stays: talking about it isn't closing it.
        #expect(model.surfaces.contains { $0.id == "verse" })
    }

    @Test("An empty ask does nothing")
    func emptyAsk() throws {
        let (model, box) = try model(verse)
        let store = try #require(model.surfaces.first { $0.id == "verse" }).store
        store.ask("   ")
        #expect(box.asked.isEmpty)
        #expect(!model.chatOpen)
    }
}
