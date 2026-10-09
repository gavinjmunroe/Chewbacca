import AppKit
import SwiftUI
import Testing

@testable import KyberKit

/// Every state clay-build draws, rendered from the exact lines it sends.
///
/// The fixtures are written by `python3 bin/lib/clay_hud.py --print <state>`
/// and `tests/test_clay_hud.py` fails when the builders drift from them, so
/// what renders here is what a run puts on the glass. A component the
/// renderer does not know is dropped without a word, which is why each
/// surface must cover a real share of its frame on both grounds.
///
/// Set `HUD_SNAPSHOT_DIR` to keep the PNGs and look at them.
/// Outside the suite: a main-actor static cannot be a test argument.
private let clayStates = ["acting", "approve", "paused", "failed", "done"]

@Suite("Clay states")
@MainActor
struct ClayStatesTests {
    /// The repository's tests/fixtures/clay-hud, found from this file.
    private static let fixtures = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent().deletingLastPathComponent()
        .deletingLastPathComponent().deletingLastPathComponent()
        .appendingPathComponent("tests/fixtures/clay-hud")

    struct Drawn {
        let id: String
        let width: CGFloat
        let chrome: Chrome?
        let lines: [String]
    }

    /// Each `@` with the component lines that follow it, up to the next `@`.
    private func surfaces(_ state: String) throws -> [Drawn] {
        let text = try String(
            contentsOf: Self.fixtures.appendingPathComponent("\(state).lines"), encoding: .utf8)
        var drawn: [Drawn] = []
        var current: (id: String, width: CGFloat, chrome: Chrome?, lines: [String])?
        for line in text.split(separator: "\n").map(String.init) {
            if line.hasPrefix("@ ") {
                if let current { drawn.append(Drawn(id: current.id, width: current.width,
                                                    chrome: current.chrome, lines: current.lines)) }
                guard case let .surface(id, _, width, _, chrome, _, _) = try LineParser.parse(line) else {
                    Issue.record("not a surface: \(line)")
                    continue
                }
                current = (id, CGFloat(width ?? 300), chrome, [])
            } else if ["c ", "> ", "r ", "d "].contains(where: line.hasPrefix) {
                current?.lines.append(line)
            }
        }
        if let current { drawn.append(Drawn(id: current.id, width: current.width,
                                            chrome: current.chrome, lines: current.lines)) }
        return drawn
    }

    private func store(_ lines: [String]) throws -> SurfaceStore {
        let store = SurfaceStore()
        for line in lines {
            if let op = try LineParser.parse(line) { store.apply([op]) }
        }
        return store
    }

    @Test("every state has its note or card and the strip", arguments: clayStates)
    func shapes(state: String) throws {
        let drawn = try surfaces(state)
        let ids = Set(drawn.map(\.id))
        #expect(ids.contains("clay-strip"), "\(state) has no strip")
        #expect(!ids.isDisjoint(with: ["clay-note", "clay-card"]), "\(state) has no note or card")
        for surface in drawn {
            #expect(surface.chrome == .window, "\(state) \(surface.id) is not a window")
            if surface.id == "clay-note" { #expect(surface.width <= 300) }
        }
    }

    @Test("every surface of every state draws, on both grounds", arguments: clayStates)
    func draws(state: String) throws {
        for surface in try surfaces(state) {
            let store = try store(surface.lines)
            for ground in SnapshotGround.allCases {
                let size = CGSize(width: surface.width + 80, height: 420)
                let drawn = coverage("clay-\(state)-\(surface.id)", size: size, ground: ground) {
                    SurfaceCard(
                        surface: OverlaySurface(
                            id: surface.id, store: store, region: .center, width: surface.width,
                            slot: 0, depth: 0, chrome: .window),
                        onDismiss: {}, onDrag: { _ in }, onGrab: {})
                        .frame(width: surface.width)
                }
                #expect(drawn > 0.05, "\(state) \(surface.id) covered only \(drawn) over \(ground)")
            }
        }
    }

    /// The strip's words and its Stop button share one line. Top-aligned, the
    /// button's 44-point target pushed its capsule 15 points below the words
    /// (the first render of the acting strip, 2026-10-09).
    @Test("the strip's words sit level with its button")
    func stripIsLevel() throws {
        guard let strip = try surfaces("acting").first(where: { $0.id == "clay-strip" }) else {
            Issue.record("no strip")
            return
        }
        let store = try store(strip.lines)
        let size = CGSize(width: strip.width + 80, height: 420)
        guard let image = render(
            ZStack {
                SnapshotGround.dark.color
                SurfaceCard(
                    surface: OverlaySurface(
                        id: strip.id, store: store, region: .center, width: strip.width,
                        slot: 0, depth: 0, chrome: .window),
                    onDismiss: {}, onDrag: { _ in }, onGrab: {})
                    .frame(width: strip.width)
            }
            .frame(width: size.width, height: size.height)
            .ignoresSafeArea()
            .environment(\.colorScheme, .dark)
            .environment(\.hudOffscreen, true))
        else {
            Issue.record("no render")
            return
        }
        // The verb ("Find people · 2/6") and the Stop label, by where the
        // acting strip draws them across a 560-point card.
        guard let words = brightMiddle(image, from: 0.30, to: 0.50),
              let button = brightMiddle(image, from: 0.69, to: 0.77)
        else {
            Issue.record("nothing bright where the words and the button belong")
            return
        }
        #expect(abs(words - button) < 6, "words centre at \(words) px, button at \(button) px")
    }

    /// The middle row of the white type between two fractions of the width.
    private func brightMiddle(_ rep: NSBitmapImageRep, from: Double, to: Double) -> Double? {
        var rows: [Int] = []
        for y in 0..<rep.pixelsHigh {
            for x in Int(Double(rep.pixelsWide) * from)..<Int(Double(rep.pixelsWide) * to) {
                if let c = rep.colorAt(x: x, y: y)?.usingColorSpace(.deviceRGB),
                   c.redComponent + c.greenComponent + c.blueComponent > 2.4 {
                    rows.append(y)
                    break
                }
            }
        }
        guard let top = rows.first, let bottom = rows.last else { return nil }
        return Double(top + bottom) / 2
    }

    // MARK: Rendering, as SnapshotTests does it

    enum SnapshotGround: String, CaseIterable {
        case light, dark

        var color: Color {
            self == .light
                ? Color(red: 0.97, green: 0.97, blue: 0.96)
                : Color(red: 0.09, green: 0.10, blue: 0.12)
        }
    }

    private var keepDirectory: URL? {
        guard let path = ProcessInfo.processInfo.environment["HUD_SNAPSHOT_DIR"] else { return nil }
        let url = URL(fileURLWithPath: path)
        try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        return url
    }

    private func coverage(
        _ name: String, size: CGSize, ground: SnapshotGround, @ViewBuilder _ content: () -> some View
    ) -> Double {
        let bare = render(ground.color.frame(width: size.width, height: size.height).ignoresSafeArea())
        let over = render(
            ZStack {
                ground.color
                content()
            }
            .frame(width: size.width, height: size.height)
            .ignoresSafeArea()
            .environment(\.colorScheme, .dark)
            .environment(\.hudOffscreen, true)
        )
        guard let bare, let over else { return 0 }
        if let directory = keepDirectory, let png = over.representation(using: .png, properties: [:]) {
            try? png.write(to: directory.appendingPathComponent("\(name)-\(ground.rawValue).png"))
        }
        return difference(bare, over)
    }

    private func render(_ view: some View) -> NSBitmapImageRep? {
        let renderer = ImageRenderer(content: view)
        renderer.scale = 2
        guard let data = renderer.nsImage?.tiffRepresentation else { return nil }
        return NSBitmapImageRep(data: data)
    }

    private func difference(_ a: NSBitmapImageRep, _ b: NSBitmapImageRep) -> Double {
        guard a.pixelsWide == b.pixelsWide, a.pixelsHigh == b.pixelsHigh else { return 1 }
        var changed = 0
        var total = 0
        for y in stride(from: 0, to: a.pixelsHigh, by: 4) {
            for x in stride(from: 0, to: a.pixelsWide, by: 4) {
                total += 1
                guard let left = a.colorAt(x: x, y: y), let right = b.colorAt(x: x, y: y) else { continue }
                let delta = abs(left.redComponent - right.redComponent)
                    + abs(left.greenComponent - right.greenComponent)
                    + abs(left.blueComponent - right.blueComponent)
                if delta > 0.02 { changed += 1 }
            }
        }
        return total == 0 ? 0 : Double(changed) / Double(total)
    }
}
