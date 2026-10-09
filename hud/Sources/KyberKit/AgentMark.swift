import AppKit
import QuartzCore
import SwiftUI
import simd

/// The agent's mark on the Clay HUD: a wireframe icosahedron that turns only
/// while clay-build is acting, and a stipple globe that turns once on the
/// done card and then rests. Gavin's pick, 2026-10-09, from the OS1 and
/// Dither mockups (`look-v2.html`): Jev's analog feel with wireframe 3D.
///
/// The solids are projected here, in plain arithmetic, and the turn is a
/// stepped keyframe animation of a layer's path. That runs in the render
/// server: a SwiftUI `repeatForever` re-renders the full-screen overlay at
/// display rate, which cost 21 points of CPU on 2026-10-05 (hud/CLAUDE.md).
public enum Wireframe {
    public enum Kind: String, Sendable, CaseIterable { case ico, globe }

    /// Tilt about x before the turn about y, so the solid reads as a solid
    /// and not as a flat hexagon. Guessed by eye, never measured.
    static let tilt = 0.35
    static let phi = (1 + 5.0.squareRoot()) / 2

    /// Twelve vertices at (0, ±1, ±φ), (±1, ±φ, 0), (±φ, 0, ±1), and an edge
    /// between every pair at distance 2.
    static func icosahedron() -> (vertices: [SIMD3<Double>], edges: [(Int, Int)]) {
        var vertices: [SIMD3<Double>] = []
        for a in [-1.0, 1.0] {
            for b in [-phi, phi] {
                vertices.append(SIMD3(0, a, b))
                vertices.append(SIMD3(a, b, 0))
                vertices.append(SIMD3(b, 0, a))
            }
        }
        var edges: [(Int, Int)] = []
        for i in vertices.indices {
            for j in vertices.indices where j > i
            && abs(simd_distance(vertices[i], vertices[j]) - 2) < 1e-9 {
                edges.append((i, j))
            }
        }
        return (vertices, edges)
    }

    /// Evenly spread points on a unit sphere (a Fibonacci lattice), the dots
    /// of the stipple.
    static func globePoints(count: Int) -> [SIMD3<Double>] {
        let golden = Double.pi * (3 - 5.0.squareRoot())
        return (0..<count).map { i in
            let y = 1 - (Double(i) + 0.5) / Double(count) * 2
            let ring = (1 - y * y).squareRoot()
            let theta = golden * Double(i)
            return SIMD3(cos(theta) * ring, y, sin(theta) * ring)
        }
    }

    static func rotate(_ point: SIMD3<Double>, turn: Double) -> SIMD3<Double> {
        let (c, s) = (cos(turn), sin(turn))
        let turned = SIMD3(c * point.x + s * point.z, point.y, -s * point.x + c * point.z)
        let (ct, st) = (cos(tilt), sin(tilt))
        return SIMD3(turned.x, ct * turned.y - st * turned.z, st * turned.y + ct * turned.z)
    }

    /// The globe's near side at this turn. A stipple shows only what faces
    /// the viewer; the far dots would fill the disc and lose the sphere.
    static func visible(_ points: [SIMD3<Double>], turn: Double) -> [SIMD3<Double>] {
        points.map { rotate($0, turn: turn) }.filter { $0.z > 0 }
    }

    /// `count` frames of one full turn, each a path inside a `size` square
    /// with a top-left origin.
    static func frames(kind: Kind, count: Int, size: CGFloat) -> [CGPath] {
        (0..<count).map { i in
            let turn = 2 * Double.pi * Double(i) / Double(count)
            return kind == .ico ? icoPath(turn: turn, size: size) : globePath(turn: turn, size: size)
        }
    }

    private static func project(
        _ point: SIMD3<Double>, radius: Double, size: CGFloat, inset: Double
    ) -> CGPoint {
        let half = Double(size) / 2
        let reach = half - inset
        return CGPoint(x: half + point.x / radius * reach, y: half - point.y / radius * reach)
    }

    private static func icoPath(turn: Double, size: CGFloat) -> CGPath {
        let (vertices, edges) = icosahedron()
        let radius = (1 + phi * phi).squareRoot()
        let points = vertices.map { project(rotate($0, turn: turn), radius: radius, size: size, inset: 0.5) }
        let path = CGMutablePath()
        for (a, b) in edges {
            path.move(to: points[a])
            path.addLine(to: points[b])
        }
        return path
    }

    /// Dot sizes in points, nearer dots larger. Guessed by eye, never
    /// measured.
    private static let dotFar = 0.7
    private static let dotNear = 1.5

    private static func globePath(turn: Double, size: CGFloat) -> CGPath {
        let path = CGMutablePath()
        for point in visible(globePoints(count: 220), turn: turn) {
            let dot = dotFar + (dotNear - dotFar) * point.z
            let centre = project(point, radius: 1, size: size, inset: dotNear / 2)
            path.addRect(CGRect(x: centre.x - dot / 2, y: centre.y - dot / 2, width: dot, height: dot))
        }
        return path
    }
}

/// `c <id> Mark kind=ico|globe [spin=true] [size=18]`.
///
/// Still in a snapshot, under Reduce Motion, and whenever `spin` is off: the
/// mark turns only while the agent is acting, so a still mark means waiting.
struct AgentMarkView: View {
    let kind: Wireframe.Kind
    let spin: Bool
    let size: CGFloat
    @Environment(\.hudOffscreen) private var offscreen
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        Group {
            if offscreen || reduceMotion || !spin {
                still
            } else {
                MarkLayer(kind: kind, size: size)
            }
        }
        .frame(width: size, height: size)
        .accessibilityElement()
        .accessibilityLabel(kind == .globe ? "Done" : (spin ? "Working" : "Waiting"))
    }

    @ViewBuilder private var still: some View {
        let path = Path(Wireframe.frames(kind: kind, count: 1, size: size)[0])
        if kind == .ico {
            path.stroke(HUD.ink, lineWidth: 1)
        } else {
            path.fill(HUD.ink)
        }
    }
}

private struct MarkLayer: NSViewRepresentable {
    let kind: Wireframe.Kind
    let size: CGFloat

    func makeNSView(context: Context) -> MarkLayerView { MarkLayerView(kind: kind, size: size) }

    func updateNSView(_ view: MarkLayerView, context: Context) { view.show(kind: kind, size: size) }
}

/// One shape layer whose path steps through the frames: the RingLayerView
/// pattern (PresenceRing.swift), keyed so a change of kind replaces the turn
/// rather than stacking a second one.
final class MarkLayerView: NSView {
    private let shape = CAShapeLayer()
    private var shownKind: Wireframe.Kind?
    private var shownSize: CGFloat = 0

    private static let key = "kyber.mark.turn"
    /// Seconds per turn. Guessed, never measured: slow enough to read as
    /// working rather than as loading. The globe turns once, quicker.
    private static let icoPeriod: CFTimeInterval = 6
    private static let globePeriod: CFTimeInterval = 2.4
    /// Twelve frames a second, stepped: the analog feel of the Jev reference
    /// rather than a smooth spin.
    private static let fps = 12.0

    init(kind: Wireframe.Kind, size: CGFloat) {
        super.init(frame: NSRect(x: 0, y: 0, width: size, height: size))
        wantsLayer = true
        layer?.addSublayer(shape)
        show(kind: kind, size: size)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    /// The paths are drawn with a top-left origin.
    override var isFlipped: Bool { true }

    // A mark is never a target: clicks pass to whatever is under it.
    override func hitTest(_ point: NSPoint) -> NSView? { nil }

    override func viewDidChangeBackingProperties() {
        super.viewDidChangeBackingProperties()
        shape.contentsScale = window?.backingScaleFactor ?? 2
    }

    func show(kind: Wireframe.Kind, size: CGFloat) {
        guard kind != shownKind || size != shownSize else { return }
        shownKind = kind
        shownSize = size
        let period = kind == .ico ? Self.icoPeriod : Self.globePeriod
        let frames = Wireframe.frames(kind: kind, count: Int(period * Self.fps), size: size)
        let ink = NSColor(HUD.ink).cgColor

        CATransaction.begin()
        CATransaction.setDisableActions(true)
        shape.frame = CGRect(x: 0, y: 0, width: size, height: size)
        shape.path = frames[0]
        if kind == .ico {
            shape.strokeColor = ink
            shape.fillColor = nil
            shape.lineWidth = 1
        } else {
            shape.fillColor = ink
            shape.strokeColor = nil
        }
        shape.removeAnimation(forKey: Self.key)
        let turn = CAKeyframeAnimation(keyPath: "path")
        turn.values = frames
        turn.calculationMode = .discrete
        turn.duration = period
        turn.repeatCount = kind == .ico ? .infinity : 1
        shape.add(turn, forKey: Self.key)
        CATransaction.commit()
    }
}
