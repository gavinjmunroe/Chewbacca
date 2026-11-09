import Foundation
import Testing

@testable import KyberKit

/// Marks tied to what they mark (bd_2026-Code-j3m): they follow a scroll or a
/// window move, and go when their element does instead of pointing at
/// whatever took its place.
@Suite("Mark anchors")
@MainActor
struct MarkAnchorTests {
    @Test("fit is intersection over union")
    func fit() {
        let a = CGRect(x: 0, y: 0, width: 10, height: 10)
        #expect(MarkAnchoring.fit(a, a) == 1)
        #expect(MarkAnchoring.fit(a, CGRect(x: 20, y: 0, width: 10, height: 10)) == 0)
        // A mark a few points loose around a button still fits it.
        #expect(MarkAnchoring.fit(a.insetBy(dx: -2, dy: -2), a) >= MarkAnchoring.minimumFit)
        // A word-sized mark inside a long paragraph does not take the paragraph.
        #expect(MarkAnchoring.fit(a, CGRect(x: 0, y: 0, width: 400, height: 60)) < MarkAnchoring.minimumFit)
    }

    @Test("the verdict: stay, follow with the same margins, or go")
    func verdict() {
        let element = CGRect(x: 100, y: 200, width: 80, height: 30)
        let mark = element.insetBy(dx: -4, dy: -4)
        #expect(MarkAnchoring.verdict(mark: mark, anchoredAt: element, now: element, clip: nil) == .stay)
        // Scrolled up 50: the mark goes with it, margins kept.
        #expect(MarkAnchoring.verdict(
            mark: mark, anchoredAt: element, now: element.offsetBy(dx: 0, dy: -50), clip: nil)
            == .move(mark.offsetBy(dx: 0, dy: -50)))
        // Element gone.
        #expect(MarkAnchoring.verdict(mark: mark, anchoredAt: element, now: nil, clip: nil) == .remove)
        // Scrolled out of its scroll area.
        let area = CGRect(x: 0, y: 150, width: 600, height: 300)
        #expect(MarkAnchoring.verdict(
            mark: mark, anchoredAt: element, now: element.offsetBy(dx: 0, dy: -200), clip: area) == .remove)
        // Mostly out counts as out.
        #expect(MarkAnchoring.verdict(
            mark: mark, anchoredAt: element, now: CGRect(x: 100, y: 130, width: 80, height: 30), clip: area)
            == .remove)
    }

    /// An element the test moves by hand.
    final class Fake: MarkAnchorHandle {
        let anchoredAt: CGRect
        var frame: CGRect?
        var clip: CGRect?
        init(_ frame: CGRect) { anchoredAt = frame; self.frame = frame }
        func read() -> (frame: CGRect?, clip: CGRect?) { (frame, clip) }
    }

    @Test("an anchored mark follows its element and goes when it does")
    func follows() {
        let model = OverlayModel()
        var lines: [String] = []
        model.onEvent = { lines.append($0.line) }
        let element = CGRect(x: 100, y: 200, width: 80, height: 30)
        let fake = Fake(element)
        model.resolveAnchor = { _ in fake }
        model.apply(.mark(id: "bug", rect: element, label: "This one", tone: nil, life: 0))
        #expect(model.isAnchored("bug"))

        fake.frame = element.offsetBy(dx: 0, dy: -40)
        model.trackAnchors()
        #expect(model.markers.first?.rect == element.offsetBy(dx: 0, dy: -40))

        fake.frame = nil
        model.trackAnchors()
        #expect(model.markers.isEmpty)
        #expect(lines.contains("e mark.gone bug"))
        #expect(!model.isAnchored("bug"))
    }

    @Test("a mark over nothing its size stays an absolute rectangle")
    func unanchored() {
        let model = OverlayModel()
        model.resolveAnchor = { _ in nil }
        let rect = CGRect(x: 10, y: 10, width: 300, height: 40)
        model.apply(.mark(id: "region", rect: rect, label: "", tone: nil, life: 0))
        #expect(!model.isAnchored("region"))
        model.trackAnchors()
        #expect(model.markers.first?.rect == rect)
    }

    @Test("taking a mark down, or clearing, forgets its anchor")
    func unmarking() {
        let model = OverlayModel()
        let fake = Fake(CGRect(x: 0, y: 0, width: 10, height: 10))
        model.resolveAnchor = { _ in fake }
        model.apply(.mark(id: "a", rect: fake.anchoredAt, label: "", tone: nil, life: 0))
        model.apply(.mark(id: "b", rect: fake.anchoredAt, label: "", tone: nil, life: 0))
        model.apply(.unmark(id: "a"))
        #expect(!model.isAnchored("a") && model.isAnchored("b"))
        model.reset()
        #expect(!model.isAnchored("b"))
    }
}
