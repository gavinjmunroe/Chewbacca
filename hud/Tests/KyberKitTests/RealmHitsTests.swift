import AppKit
import SwiftUI
import Testing

@testable import KyberKit

/// Carlton's language on the glass (RealmTokens.swift), the search rows that
/// use it (HitsView.swift), and the File editor's line jump (FileView.swift).
@Suite("Realm tokens and hits")
@MainActor
struct RealmHitsTests {
    /// The glass's worst ground, as AgentTilesTests holds it.
    static let glass = 0.087

    private func luminance(_ color: Color) -> Double {
        let c = NSColor(color).usingColorSpace(.sRGB)!
        return AgentPalette.luminance(Double(c.redComponent), Double(c.greenComponent), Double(c.blueComponent))
    }

    private func ratio(_ a: Double, _ b: Double) -> Double { (max(a, b) + 0.05) / (min(a, b) + 0.05) }

    @Test("the matched-character ink holds 4.5:1 on the glass's worst ground")
    func accentInkContrast() {
        #expect(ratio(luminance(Realm.accentInk), Self.glass) >= 4.5)
        // His own --accent-ink did not, which is why it was lifted.
        #expect(ratio(AgentPalette.luminance(0.493, 0.753, 1.0), Self.glass) < 4.5)
        // A lit edge is a graphic: 3:1.
        #expect(ratio(luminance(Realm.accent), Self.glass) >= 3)
    }

    @Test("the type ladder has no rung under his 11 point floor, and titles track tighter")
    func typeLadder() {
        let rungs = [Realm.Size.tiny, Realm.Size.caption, Realm.Size.small, Realm.Size.body,
                     Realm.Size.reading, Realm.Size.large, Realm.Size.titleXS, Realm.Size.titleS]
        #expect(rungs.min() == 11)
        #expect(rungs == rungs.sorted())
        #expect(Realm.tracking(Realm.Size.titleS) < Realm.tracking(Realm.Size.body))
    }

    @Test("nested radii are concentric")
    func concentric() {
        #expect(Realm.Radius.inside(Realm.Radius.card, padding: 4) == Realm.Radius.control)
        #expect(Realm.Radius.inside(Realm.Radius.chip, padding: 9) == 0)
    }

    @Test("hits parse segments, drop empty rows and keep ids")
    func parse() {
        let rows = HitRow.parse([
            .object(["id": .string("f1:0"), "kind": .string("file"), "where": .string("bin/lib"),
                     "segments": .array([.object(["text": .string("agents"), "match": .bool(true)]),
                                         .object(["text": .string(".py"), "match": .bool(false)])]),
                     "selected": .bool(true)]),
            .object(["id": .string("f1:1"), "segments": .array([])]),
            .string("not a row"),
            .object(["id": .string("g1:0"), "kind": .string("line"),
                     "segments": .array([.object(["text": .string("import realm_client")])])]),
        ])
        #expect(rows.map(\.id) == ["f1:0", "g1:0"])
        #expect(rows[0].plain == "agents.py" && rows[0].selected && rows[0].place == "bin/lib")
        #expect(rows[0].runs.map(\.match) == [true, false])
        #expect(rows[1].isLine && !rows[1].selected)
    }

    @Test("a hit draws its matched run in the accent ink and the rest in ink")
    func attributedRuns() {
        let row = HitRow(id: "f", kind: "file", runs: [.init(text: "ag", match: true), .init(text: "ents", match: false)],
                         place: "", selected: false)
        let runs = Array(row.attributed(size: 13, mono: false).runs)
        #expect(runs.count == 2)
        #expect(runs[0].foregroundColor == Realm.accentInk)
        #expect(runs[1].foregroundColor == Realm.ink)
    }

    @Test("an empty answer draws nothing, not a caption over no rows")
    func emptyDrawsNothing() {
        let view = HitsView(caption: "Files", rows: [], onOpen: nil)
        let host = NSHostingView(rootView: view.frame(width: 300))
        host.layoutSubtreeIfNeeded()
        #expect(host.fittingSize.height < 1)
    }

    @Test("a line number finds its line, and a line past the end finds nothing")
    func lineRange() {
        let text = "one\ntwo\nthree"
        #expect(CodeEditor.range(ofLine: 1, in: text) == NSRange(location: 0, length: 3))
        #expect(CodeEditor.range(ofLine: 2, in: text) == NSRange(location: 4, length: 3))
        #expect(CodeEditor.range(ofLine: 3, in: text) == NSRange(location: 8, length: 5))
        #expect(CodeEditor.range(ofLine: 4, in: text) == nil)
        #expect(CodeEditor.range(ofLine: 0, in: text) == nil)
    }
}
