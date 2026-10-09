import AppKit
import SwiftUI

/// The frosted half of the rim: whatever is behind the edge of the screen,
/// blurred by the window server, cut to the band the presence field draws its
/// light on.
///
/// Asked for on 2026-10-09 as "more glassmorphic". A shader cannot do this
/// part: it only ever sees its own drawable, never the screen behind the
/// window, so a drawn wash over a sharp desktop reads as a tint, not glass.
/// `NSVisualEffectView` blurs what is really behind it, on the window server,
/// with no frame clock in this process, so a rim holding still costs nothing.
///
/// The material was picked from four tried side by side over the desktop the
/// same day: `.hudWindow` in the light appearance keeps the colour of what is
/// behind and lifts it a little. In the dark appearance it smoked the edge
/// nearly black, and `.popover` went milky, the white frame again.
struct RimGlass: NSViewRepresentable {
    /// Points from the screen's edge inward. Zero takes the glass away.
    let depth: CGFloat
    /// The inner edge's corner radius, in points.
    var corner: CGFloat = PresenceFieldRenderer.innerCorner
    /// How much of the blur to take, 0 to 1. See `RimTuning.frost`, which
    /// carries the measurement behind the default.
    var frost: CGFloat = RimTuning().frost

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func makeNSView(context: Context) -> RimGlassView { RimGlassView() }

    func updateNSView(_ view: RimGlassView, context: Context) {
        view.set(depth: depth, corner: corner, frost: frost, animated: !reduceMotion)
    }
}

final class RimGlassView: NSView {
    private let blur = NSVisualEffectView()
    private let cut = CAShapeLayer()
    private var depth: CGFloat = 0
    private var corner = PresenceFieldRenderer.innerCorner

    /// How long the glass takes to come in and to go, matching the field's
    /// own ramps (`PresenceFieldRenderer.arrival` going away, the shader's
    /// 0.45 s depth ramp coming in), so the frosting and the light arrive
    /// and leave together. Between two live states the field eases on a
    /// 0.35 s chase, which is about 86% of the way there at the same 0.45.
    private static let arrival: CFTimeInterval = 0.45

    init() {
        super.init(frame: .zero)
        wantsLayer = true
        blur.material = .hudWindow
        blur.appearance = NSAppearance(named: .aqua)
        blur.blendingMode = .behindWindow
        blur.state = .active
        addSubview(blur)
        // On this view's layer rather than on the effect view's: AppKit owns
        // the effect view's own mask for `maskImage`.
        cut.fillRule = .evenOdd
        layer?.mask = cut
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("not used")
    }

    override func layout() {
        super.layout()
        blur.frame = bounds
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        cut.frame = bounds
        cut.path = Self.band(in: bounds, depth: depth, corner: corner)
        CATransaction.commit()
    }

    func set(depth next: CGFloat, corner round: CGFloat, frost: CGFloat, animated: Bool) {
        if blur.alphaValue != frost { blur.alphaValue = frost }
        guard next != depth || round != corner else { return }
        let from = cut.presentation()?.path ?? cut.path
        // A corner change is the editor's slider, under the person's hand: it
        // follows the hand rather than easing after it. And a path animation
        // between two different corner radii does not interpolate cleanly.
        let easing = animated && round == corner
        depth = next
        corner = round
        let to = Self.band(in: bounds, depth: next, corner: round)
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        cut.path = to
        CATransaction.commit()
        guard easing, let from, !bounds.isEmpty else { return }
        let move = CABasicAnimation(keyPath: "path")
        move.fromValue = from
        move.toValue = to
        move.duration = next == 0 ? PresenceFieldRenderer.arrival : Self.arrival
        move.timingFunction = CAMediaTimingFunction(name: next == 0 ? .easeIn : .easeOut)
        cut.add(move, forKey: "depth")
    }

    /// The band, as the region between the screen's edge and a rounded
    /// rectangle `depth` in, filled even-odd. The same outline the shader
    /// draws to: its inner edge turns on the same `corner` the shader is given.
    ///
    /// No glass is the inner rectangle pushed out past the edge rather than
    /// an empty path, so going away and coming back are one animation of the
    /// same shape: a path animation between two paths built differently
    /// does not interpolate, it jumps.
    static func band(in rect: CGRect, depth: CGFloat, corner: CGFloat) -> CGPath {
        let inset = depth > 0 ? depth : -corner
        let path = CGMutablePath()
        path.addRect(rect)
        path.addRoundedRect(
            in: rect.insetBy(dx: inset, dy: inset), cornerWidth: corner, cornerHeight: corner)
        return path
    }
}
