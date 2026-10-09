import Foundation
import Testing

@testable import KyberKit

/// The rim editor's values: what they mean for each state, what survives a
/// hand-edited file, and that the two gains reach the pixels.
@Suite("Rim tuning")
struct RimTuningTests {
    @Test("the defaults are the rim as shipped")
    func defaults() {
        let tuning = RimTuning()
        for state in [Presence.attentive, .hearing, .thinking, .acting, .done, .attention, .failed] {
            #expect(tuning.depth(of: state.field) == state.field.rest)
        }
        #expect(tuning.corner == Double(PresenceFieldRenderer.innerCorner))
    }

    @Test("thickness sets listening and every state keeps its proportion")
    func proportional() {
        var tuning = RimTuning()
        tuning.thickness = RimTuning().thickness * 2
        for state in [Presence.hearing, .thinking, .acting, .attention, .failed] {
            #expect(abs(tuning.depth(of: state.field) - state.field.rest * 2) < 1e-9)
        }
        // Dormant stays nothing at any size: zero is the one depth that draws
        // no pixels.
        #expect(tuning.depth(of: Presence.dormant.field) == 0)
    }

    @Test("a hand-edited file cannot draw a rim the editor could not make")
    func clamps() {
        var wild = RimTuning()
        wild.thickness = 500
        wild.frost = -1
        wild.tint = .nan
        wild.edge = 9
        wild.corner = -3
        let safe = wild.clamped()
        #expect(safe.thickness == RimTuning.thicknessRange.upperBound)
        #expect(safe.frost == 0)
        #expect(safe.tint == RimTuning.tintRange.lowerBound)
        #expect(safe.edge == RimTuning.edgeRange.upperBound)
        #expect(safe.corner == 0)
    }

    @Test("a file missing a key keeps the default for it")
    func partialFile() throws {
        let tuning = try JSONDecoder().decode(RimTuning.self, from: Data(#"{"thickness":14}"#.utf8))
        #expect(tuning.thickness == 14)
        #expect(tuning.frost == RimTuning().frost)
        #expect(tuning.corner == RimTuning().corner)
    }

    @Test("what is saved is what comes back, and a broken file is the defaults")
    @MainActor
    func roundTrip() throws {
        let folder = FileManager.default.temporaryDirectory
            .appendingPathComponent("rim-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: folder) }
        let file = folder.appendingPathComponent("rim.json")

        let tuner = RimTuner(file: file)
        #expect(tuner.tuning == RimTuning())
        tuner.tuning.thickness = 12
        tuner.tuning.edge = 1.5
        tuner.save()
        #expect(RimTuner(file: file).tuning == tuner.tuning)

        try Data("not json".utf8).write(to: file)
        #expect(RimTuner(file: file).tuning == RimTuning())
    }

    @Test("`rim` opens the editor, and `rim key=value` sets values by name")
    func verb() throws {
        #expect(try LineParser.parse("rim") == .editRim)
        #expect(try LineParser.parse("rim thickness=12 frost=0.4")
            == .tuneRim(["thickness": 12, "frost": 0.4]))
        // A bare number, an unknown name and a non-number are refused, so a
        // typo comes back as a problem instead of doing nothing.
        #expect(throws: LineParseError.self) { try LineParser.parse("rim 12") }
        #expect(throws: LineParseError.self) { try LineParser.parse("rim width=12") }
        #expect(throws: LineParseError.self) { try LineParser.parse("rim thickness=thick") }
        #expect(throws: LineParseError.self) { try LineParser.parse("rim thickness=nan") }
    }

    @Test("values set by name are clamped like the sliders")
    func settingByName() {
        let next = RimTuning().setting(["thickness": 12, "corner": 99])
        #expect(next.thickness == 12)
        #expect(next.corner == RimTuning.cornerRange.upperBound)
        #expect(next.frost == RimTuning().frost)
    }

    /// The Tint and Edge light sliders reach the shader: clear at zero,
    /// brighter above one. Read two pixels in from the left edge, where the
    /// glass is and the cut line is not, and on the cut line itself.
    @Test("the tint and edge gains change what is drawn")
    func gains() throws {
        let width = 1280, height = 800, y = height / 2
        let rest = Int(Presence.attentive.field.rest)
        func alpha(_ pixels: [UInt8], x: Int) -> Int { Int(pixels[(y * width + x) * 4 + 3]) }
        guard let shipped = try FieldRenderTests.draw(background: -1, { $0.travel = 0 }),
              let clear = try FieldRenderTests.draw(
                  background: -1, { $0.travel = 0; $0.washGain = 0; $0.edgeGain = 0 }),
              let heavy = try FieldRenderTests.draw(
                  background: -1, { $0.travel = 0; $0.washGain = 2; $0.edgeGain = 2 })
        else { return }
        #expect(alpha(clear, x: 2) < alpha(shipped, x: 2))
        #expect(alpha(heavy, x: 2) > alpha(shipped, x: 2))
        #expect(alpha(clear, x: rest - 1) < alpha(shipped, x: rest - 1))
    }
}
