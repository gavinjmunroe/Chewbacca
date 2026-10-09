import Foundation
import Observation
import os

/// The rim's look, as set in the rim editor ("Edit the rim" in the menu, or
/// `rim` on the socket).
///
/// Asked for on 2026-10-09, after two rounds of "too big" and "a bit thicker"
/// went through a rebuild each: "create something so i can size and edit
/// it". Every number the eye judges is here, and nothing else is, so the
/// editor can never offer a knob the rim ignores.
public struct RimTuning: Codable, Equatable, Sendable {
    /// How deep the rim sits while listening, in points. Every other state
    /// keeps its proportion to it (see `depth(of:)`), so thinking stays
    /// thinner than acting at any size.
    public var thickness: Double = RimTuning.listening
    /// How much of the window server's blur to take, 0 to 1. At 1, measured
    /// on screen on 2026-10-09 over the forest wallpaper, the rim came out
    /// about (146, 158, 137) over leaves at (43, 57, 31): three times
    /// brighter than what was behind it, a milky line rather than glass.
    /// 0.55 read as glass.
    public var frost: Double = 0.55
    /// The white wash the shader lays over the blur, as a multiple of its
    /// own. 0 is clear glass, 1 the look shipped on 2026-10-09.
    public var tint: Double = 1
    /// The lit inner edge, as a multiple of the shader's own brightness.
    public var edge: Double = 1
    /// The radius the inner edge turns its corners on, in points.
    public var corner: Double = Double(PresenceFieldRenderer.innerCorner)

    public init() {}

    /// The listening depth the state table was written against. Every
    /// state's `rest` is divided by it, so the table keeps its proportions
    /// and only the person's thickness sets the size.
    static let listening = Presence.attentive.field.rest

    /// The editor's ranges. Thickness stops at 2, under which the 2 point
    /// cut line is the whole rim, and at 40, past which it is the titanium
    /// frame he called "way too big" again (58 points at the top).
    public static let thicknessRange: ClosedRange<Double> = 2...40
    public static let frostRange: ClosedRange<Double> = 0...1
    public static let tintRange: ClosedRange<Double> = 0...3
    public static let edgeRange: ClosedRange<Double> = 0...3
    public static let cornerRange: ClosedRange<Double> = 0...40

    /// How deep a state draws, in points. The one place a state's depth
    /// becomes the person's: the glass and the shader both call it, so the
    /// frosting and the light cannot come apart.
    func depth(of style: PresenceFieldStyle) -> Double {
        style.rest * thickness / Self.listening
    }

    /// The names `rim key=value` on the socket takes, one per slider.
    public static let keys = ["thickness", "frost", "tint", "edge", "corner"]

    /// These values set by name, clamped like the editor's sliders. A name
    /// not in `keys` is ignored; the parser has already refused it.
    public func setting(_ values: [String: Double]) -> RimTuning {
        var next = self
        for (key, value) in values {
            switch key {
            case "thickness": next.thickness = value
            case "frost": next.frost = value
            case "tint": next.tint = value
            case "edge": next.edge = value
            case "corner": next.corner = value
            default: break
            }
        }
        return next.clamped()
    }

    /// Every value inside its range, so a hand-edited file cannot draw a
    /// rim the editor could not have made.
    public func clamped() -> RimTuning {
        var next = self
        next.thickness = Self.clamp(thickness, Self.thicknessRange)
        next.frost = Self.clamp(frost, Self.frostRange)
        next.tint = Self.clamp(tint, Self.tintRange)
        next.edge = Self.clamp(edge, Self.edgeRange)
        next.corner = Self.clamp(corner, Self.cornerRange)
        return next
    }

    private static func clamp(_ value: Double, _ range: ClosedRange<Double>) -> Double {
        guard value.isFinite else { return range.lowerBound }
        return min(max(value, range.lowerBound), range.upperBound)
    }

    private enum CodingKeys: String, CodingKey { case thickness, frost, tint, edge, corner }

    /// A file missing a key keeps the default for it, so a value added later
    /// does not throw away every value already saved.
    public init(from decoder: Decoder) throws {
        let keys = try decoder.container(keyedBy: CodingKeys.self)
        let fallback = RimTuning()
        thickness = try keys.decodeIfPresent(Double.self, forKey: .thickness) ?? fallback.thickness
        frost = try keys.decodeIfPresent(Double.self, forKey: .frost) ?? fallback.frost
        tint = try keys.decodeIfPresent(Double.self, forKey: .tint) ?? fallback.tint
        edge = try keys.decodeIfPresent(Double.self, forKey: .edge) ?? fallback.edge
        corner = try keys.decodeIfPresent(Double.self, forKey: .corner) ?? fallback.corner
    }
}

/// The tuning the rim draws with, kept in `~/.bob/rim.json`.
///
/// A file of the person's own rather than a default in the repo: the
/// defaults in `RimTuning` are what everyone gets, and this is one Mac's
/// taste on top of them.
@MainActor
@Observable
public final class RimTuner {
    public static let shared = RimTuner()

    public var tuning: RimTuning {
        didSet {
            guard tuning != oldValue else { return }
            scheduleSave()
        }
    }
    /// The state the editor is showing, while it is open. The rim draws this
    /// instead of the real presence, and nothing else sees it: going through
    /// the model would start the pill's clock on a preview of `thinking`.
    public var preview: Presence?

    @ObservationIgnored let file: URL
    private static let log = Logger(subsystem: "kyber", category: "rim")
    @ObservationIgnored private var saving: Task<Void, Never>?

    init(file: URL = RimTuner.defaultFile) {
        self.file = file
        tuning = Self.load(from: file)
    }

    public static var defaultFile: URL {
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".bob/rim.json")
    }

    static func load(from file: URL) -> RimTuning {
        guard let data = try? Data(contentsOf: file),
              let tuning = try? JSONDecoder().decode(RimTuning.self, from: data)
        else { return RimTuning() }
        return tuning.clamped()
    }

    public func reset() { tuning = RimTuning() }

    /// Written a quarter second after the last change, so dragging a slider
    /// writes the file once rather than sixty times a second.
    private func scheduleSave() {
        saving?.cancel()
        saving = Task { @MainActor [weak self] in
            try? await Task.sleep(for: .milliseconds(250))
            guard !Task.isCancelled, let self else { return }
            self.save()
        }
    }

    func save() {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        do {
            try FileManager.default.createDirectory(
                at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
            try encoder.encode(tuning).write(to: file, options: .atomic)
        } catch {
            Self.log.error("rim tuning not saved to \(self.file.path, privacy: .public): \(error.localizedDescription, privacy: .public)")
        }
    }
}
