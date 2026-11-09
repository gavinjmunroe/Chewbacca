import AppKit
import QuartzCore
import SwiftUI

/// Kyber's mark on the home panel: a small liquid orb that changes shape,
/// turns its colours round and breathes. Asked for on 2026-10-11: "the top
/// left icon next to kyber needs to be morphing and look animated and alive".
///
/// It is the one thing on the panel that moves while idle, on purpose and at
/// his request. Every motion is a Core Animation layer animation, run by the
/// render server, so no SwiftUI view re-renders for it (hud/CLAUDE.md, motion
/// rule 6: a SwiftUI `repeatForever` cost 21 points of CPU on 2026-10-05).
public enum Blob {
    /// The shapes it moves between, as each lobe's reach from the centre.
    /// Every shape has the same six lobes, so Core Animation can morph one
    /// path into the next point by point. Drawn by eye, never measured.
    static let shapes: [[Double]] = [
        [1.00, 0.86, 0.97, 0.84, 0.95, 0.88],
        [0.87, 0.99, 0.85, 0.96, 0.86, 0.98],
        [0.95, 0.84, 0.99, 0.90, 0.83, 0.97],
        [0.86, 0.96, 0.89, 0.99, 0.92, 0.85],
    ]

    /// A closed, smooth outline through the lobes, inside a `size` square:
    /// a Catmull-Rom curve as cubic Béziers, one per lobe.
    static func path(_ reach: [Double], size: CGFloat) -> CGPath {
        let half = Double(size) / 2
        let points = reach.indices.map { i -> CGPoint in
            let angle = 2 * Double.pi * Double(i) / Double(reach.count) - Double.pi / 2
            let r = half * reach[i]
            return CGPoint(x: half + cos(angle) * r, y: half + sin(angle) * r)
        }
        let count = points.count
        let path = CGMutablePath()
        path.move(to: points[0])
        for i in 0..<count {
            let p0 = points[(i - 1 + count) % count], p1 = points[i]
            let p2 = points[(i + 1) % count], p3 = points[(i + 2) % count]
            path.addCurve(
                to: p2,
                control1: CGPoint(x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6),
                control2: CGPoint(x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6))
        }
        path.closeSubpath()
        return path
    }

    static func frames(size: CGFloat) -> [CGPath] { shapes.map { path($0, size: size) } }

    /// The palette swept round the orb: the HUD's own state hues (accent,
    /// good, warn, bad), so the mark is made of the colours the glass already
    /// means. No violet-to-blue (claude-design-kit's refusals).
    static let palette: [NSColor] = [
        NSColor(HUD.accent), NSColor(HUD.good), NSColor(HUD.warn), NSColor(HUD.bad),
    ]
}

/// The mark, still in a snapshot and under Reduce Motion.
struct HomeMark: View {
    let size: CGFloat
    @Environment(\.hudOffscreen) private var offscreen
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        Group {
            if offscreen || reduceMotion {
                Path(Blob.path(Blob.shapes[0], size: size))
                    .fill(AngularGradient(colors: (Blob.palette + [Blob.palette[0]]).map(Color.init),
                                          center: .center))
            } else {
                HomeMarkLayer(size: size)
            }
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }
}

private struct HomeMarkLayer: NSViewRepresentable {
    let size: CGFloat

    func makeNSView(context: Context) -> HomeMarkView { HomeMarkView(size: size) }

    func updateNSView(_ view: HomeMarkView, context: Context) { view.show(size: size) }
}

/// A glow behind, and a colour field masked to the blob in front: the blob
/// morphs, the colours turn and drift, and the whole mark breathes.
final class HomeMarkView: NSView {
    /// Everything, so the breath scales one layer about its middle; the
    /// view's own backing layer belongs to AppKit.
    private let mark = CALayer()
    private let glow = CAShapeLayer()
    private let body = CALayer()
    private let shape = CAShapeLayer()
    private let colours = CAGradientLayer()
    private let sheen = CAGradientLayer()
    private var shownSize: CGFloat = 0

    private static let keys = ["kyber.home.morph", "kyber.home.turn", "kyber.home.drift", "kyber.home.breathe"]
    /// Seconds for each motion, chosen apart so the four never line up into
    /// a visible loop. Guessed, never measured.
    static let morphPeriod: CFTimeInterval = 7
    static let turnPeriod: CFTimeInterval = 11
    static let driftPeriod: CFTimeInterval = 13
    static let breathPeriod: CFTimeInterval = 2.8
    /// A 16-point mark has no need of 120 Hz; thirty frames is smooth at
    /// that size and a quarter of ProMotion's work. Guessed.
    private static let frameRate = CAFrameRateRange(minimum: 15, maximum: 30, preferred: 30)

    init(size: CGFloat) {
        super.init(frame: NSRect(x: 0, y: 0, width: size, height: size))
        wantsLayer = true
        layer?.addSublayer(mark)
        mark.addSublayer(glow)
        mark.addSublayer(body)
        body.addSublayer(colours)
        body.addSublayer(sheen)
        body.mask = shape
        colours.type = .conic
        colours.startPoint = CGPoint(x: 0.5, y: 0.5)
        colours.endPoint = CGPoint(x: 0.5, y: 0)
        sheen.type = .radial
        sheen.colors = [NSColor.white.withAlphaComponent(0.7).cgColor, NSColor.white.withAlphaComponent(0).cgColor]
        sheen.startPoint = CGPoint(x: 0.32, y: 0.28)
        sheen.endPoint = CGPoint(x: 0.85, y: 0.85)
        show(size: size)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    override var isFlipped: Bool { true }

    // Never a target: a press on it drags the panel like the strip around it.
    override func hitTest(_ point: NSPoint) -> NSView? { nil }

    override func viewDidChangeBackingProperties() {
        super.viewDidChangeBackingProperties()
        let scale = window?.backingScaleFactor ?? 2
        for part in [mark, glow, body, shape, colours, sheen] { part.contentsScale = scale }
    }

    func show(size: CGFloat) {
        guard size != shownSize else { return }
        shownSize = size
        let frames = Blob.frames(size: size)
        let bounds = CGRect(x: 0, y: 0, width: size, height: size)
        let palette = Blob.palette.map(\.cgColor)

        CATransaction.begin()
        CATransaction.setDisableActions(true)
        for part in [mark, glow, body, shape, sheen] { part.frame = bounds }
        // Larger than the orb, so turning it never shows a corner.
        colours.frame = bounds.insetBy(dx: -size * 0.3, dy: -size * 0.3)
        colours.colors = palette + [palette[0]]
        shape.path = frames[0]
        glow.path = frames[0]
        glow.fillColor = NSColor(HUD.accent).withAlphaComponent(0.35).cgColor
        glow.shadowColor = NSColor(HUD.accent).cgColor
        glow.shadowOpacity = 0.9
        glow.shadowRadius = size * 0.22
        glow.shadowOffset = .zero
        for part in [glow, shape, colours, mark] {
            for key in Self.keys { part.removeAnimation(forKey: key) }
        }

        let morph = CAKeyframeAnimation(keyPath: "path")
        morph.values = frames + [frames[0]]
        morph.keyTimes = (0...frames.count).map { NSNumber(value: Double($0) / Double(frames.count)) }
        morph.timingFunctions = Array(repeating: CAMediaTimingFunction(name: .easeInEaseOut), count: frames.count)
        morph.duration = Self.morphPeriod
        shape.add(Self.forever(morph), forKey: Self.keys[0])
        glow.add(Self.forever(morph), forKey: Self.keys[0])

        let turn = CABasicAnimation(keyPath: "transform.rotation.z")
        turn.fromValue = 0
        turn.toValue = 2 * Double.pi
        turn.duration = Self.turnPeriod
        colours.add(Self.forever(turn), forKey: Self.keys[1])

        // The sweep's colours step round by one each quarter, so the hue
        // drifts as well as turns.
        let drift = CAKeyframeAnimation(keyPath: "colors")
        drift.values = palette.indices.map { start in
            let turned = palette.indices.map { palette[($0 + start) % palette.count] }
            return turned + [turned[0]]
        } + [palette + [palette[0]]]
        drift.duration = Self.driftPeriod
        drift.calculationMode = .linear
        colours.add(Self.forever(drift), forKey: Self.keys[2])

        let breathe = CABasicAnimation(keyPath: "transform.scale")
        breathe.fromValue = 0.92
        breathe.toValue = 1.04
        breathe.duration = Self.breathPeriod
        breathe.autoreverses = true
        breathe.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
        mark.add(Self.forever(breathe), forKey: Self.keys[3])
        CATransaction.commit()
    }

    private static func forever(_ animation: CAAnimation) -> CAAnimation {
        animation.repeatCount = .infinity
        animation.isRemovedOnCompletion = false
        animation.preferredFrameRateRange = frameRate
        return animation
    }
}
