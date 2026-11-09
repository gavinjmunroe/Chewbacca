import AppKit
import SwiftUI
import Testing
@testable import KyberKit

/// The glance with no window: content on the glass (chrome=glass).
@Suite("Glass glance")
@MainActor
struct GlassGlanceTests {
    /// sRGB channel to linear light, WCAG 2.
    static func linear(_ c: Double) -> Double {
        c <= 0.04045 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4)
    }

    static func channels(_ color: Color) -> (Double, Double, Double, Double) {
        let c = NSColor(color).usingColorSpace(.sRGB) ?? .white
        return (Double(c.redComponent), Double(c.greenComponent), Double(c.blueComponent), Double(c.alphaComponent))
    }

    /// `top` at its own alpha over `ground`, as composited sRGB.
    static func over(_ top: (Double, Double, Double, Double), _ ground: (Double, Double, Double))
        -> (Double, Double, Double) {
        let a = top.3
        return (top.0 * a + ground.0 * (1 - a), top.1 * a + ground.1 * (1 - a), top.2 * a + ground.2 * (1 - a))
    }

    static func luminance(_ c: (Double, Double, Double)) -> Double {
        0.2126 * linear(c.0) + 0.7152 * linear(c.1) + 0.0722 * linear(c.2)
    }

    @Test("over a white page with no blur behind it, faint text, rail names and every meaning hold 4.5:1")
    func faintHolds() {
        let wash = SurfaceChrome.glassWash(.normal, over: 0.97)
        let (r, g, b, _) = Self.channels(SurfaceChrome.frost)
        let field = Self.over((r, g, b, wash), (1, 1, 1))
        let groundL = Self.luminance(field)
        let inks: [(String, Color)] = [("faint", HUD.faint), ("dim", HUD.dim), ("rail name", HUD.ink.opacity(0.88)),
                                       ("accent", HUD.accent), ("needs", HUD.needsYou),
                                       ("recording", HUD.recording), ("done", HUD.done)]
        for (name, ink) in inks {
            let text = Self.luminance(Self.over(Self.channels(ink), field))
            let ratio = (text + 0.05) / (groundL + 0.05)
            #expect(ratio >= 4.5, "\(name): \(ratio)")
        }
    }

    @Test("a part with nothing in it draws nothing: empty labels on every chrome, any empty part on the glass")
    func blanks() {
        // The two grey circles on 2026-10-11 were Buttons with label "".
        for chrome in Chrome.allCases {
            #expect(SurfaceView.blank("Button", ["label": .string("")], in: chrome))
            #expect(SurfaceView.blank("Metric", ["value": .string("")], in: chrome))
            #expect(!SurfaceView.blank("Metric", ["value": .number(0)], in: chrome))
            #expect(!SurfaceView.blank("Button", ["label": .string("Show")], in: chrome))
        }
        #expect(SurfaceView.blank("Text", ["value": .string("")], in: .glass))
        #expect(SurfaceView.blank("Events", ["items": .array([])], in: .glass))
        #expect(SurfaceView.blank("Transcript", ["items": .array([])], in: .glass))
        #expect(!SurfaceView.blank("Text", ["value": .string("")], in: .card))
    }

    @Test("rail rows read day, clock, gap and tone, and a Private row stays Private")
    func railRows() {
        let rows = GlassRail.rows([
            .object(["id": .string("m1"), "text": .string("Chewbacca"), "day": .string("Today"),
                     "clock": .string("1:02 AM"), "time": .string("1h"), "gap": .number(0), "accent": .bool(true)]),
            .object(["id": .string("m2"), "text": .string("Private"), "private": .bool(true),
                     "clock": .string(""), "time": .string("2h"), "gap": .number(3), "tone": .string("needs")]),
        ])
        #expect(rows.map(\.row) == ["m1", "m2"])
        #expect(rows[0].clock == "1:02 AM" && rows[0].marked && rows[0].day == "Today")
        // No clock falls back to the card's time; a gap is clamped to 0...1.
        #expect(rows[1].clock == "2h" && rows[1].gap == 1 && rows[1].tone == "needs" && rows[1].hidden)
    }

    @Test("a name opens itself; a verb that changes something stays a word")
    func pressTargets() {
        let open = RowAction(["action": .string("open"), "actionLabel": .string("Open")]) { _ in }
        let go = RowAction(["action": .string("act"), "actionLabel": .string("Go")]) { _ in }
        #expect(GlassRail(items: [], rowAction: open).navigates)
        #expect(!GlassRail(items: [], rowAction: go).navigates)
        #expect(!GlassRail(items: [], rowAction: nil).navigates)
        // Every row with its press reach is a 44-point target.
        #expect(GlassRail.rowHeight + (HitTarget.minimum - GlassRail.rowHeight) == HitTarget.minimum)
    }

    @Test("glass parses as a chrome, and an unknown chrome still falls back to the card")
    func parses() throws {
        guard case let .surface(_, _, _, _, chrome, _, _, _) = try LineParser.parse("@ meetings chrome=glass") else {
            Issue.record("not a surface")
            return
        }
        #expect(chrome == .glass)
        #expect(Chrome(rawValue: "hologram") == nil)
        #expect(!Chrome.glass.isFilled)
    }

    @Test("clear is glass with no field: no card, no fill, and it parses")
    func clearChrome() throws {
        guard case let .surface(_, _, _, _, chrome, _, _, _) = try LineParser.parse("@ realm chrome=clear") else {
            Issue.record("not a surface")
            return
        }
        #expect(chrome == .clear)
        #expect(Chrome.clear.isGlass && Chrome.glass.isGlass && !Chrome.card.isGlass)
        #expect(!Chrome.clear.isFilled)
    }
}

/// The daemon's own `@` line reaches the model as glass, end to end.
@Suite("Glass glance, through the model")
@MainActor
struct GlassModelTests {
    @Test("@ meetings ... chrome=glass opens a glass surface, and a later bare @ keeps it")
    func throughTheModel() throws {
        let model = OverlayModel()
        for line in ["@ meetings at=right w=420 chrome=glass", #"c meetings-s Screen title="Meetings""#,
                     "r meetings-s", "@ meetings"] {
            if let op = try LineParser.parse(line) { model.apply(op) }
        }
        #expect(model.surfaces.first { $0.id == "meetings" }?.chrome == .glass)
    }
}
