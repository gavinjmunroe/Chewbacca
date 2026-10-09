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

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func makeNSView(context: Context) -> RimGlassView { RimGlassView() }

    func updateNSView(_ view: RimGlassView, context: Context) {
        view.set(depth: depth, animated: !reduceMotion)
    }
}

final class RimGlassView: NSView {
    private let blur = NSVisualEffectView()
    private let cut = CAShapeLayer()
    private var depth: CGFloat = 0

    /// How long the glass takes to come in and to go, matching the field's
    /// own ramps (`PresenceFieldRenderer.arrival` going away, the shader's
    /// 0.45 s depth ramp coming in), so the frosting and the light arrive
    /// and leave together. Between two live states the field eases on a
    /// 0.35 s chase, which is about 86% of the way there at the same 0.45.
    private static let arrival: CFTimeInterval = 0.45

    /// How much of the frosting to take. At full strength, measured on
    /// screen on 2026-10-09 over the forest wallpaper, the rim came out
    /// about (146, 158, 137) over leaves at (43, 57, 31): three times
    /// brighter than what was behind it, a milky line rather than glass.
    private static let frost: CGFloat = 0.55

    init() {
        super.init(frame: .zero)
        wantsLayer = true
        blur.material = .hudWindow
        blur.appearance = NSAppearance(named: .aqua)
        blur.blendingMode = .behindWindow
        blur.state = .active
        blur.alphaValue = Self.frost
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
        cut.path = Self.band(in: bounds, depth: depth)
        CATransaction.commit()
    }

    func set(depth next: CGFloat, animated: Bool) {
        guard next != depth else { return }
        let from = cut.presentation()?.path ?? cut.path
        depth = next
        let to = Self.band(in: bounds, depth: next)
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        cut.path = to
        CATransaction.commit()
        guard animated, let from, !bounds.isEmpty else { return }
        let move = CABasicAnimation(keyPath: "path")
        move.fromValue = from
        move.toValue = to
        move.duration = next == 0 ? PresenceFieldRenderer.arrival : Self.arrival
        move.timingFunction = CAMediaTimingFunction(name: next == 0 ? .easeIn : .easeOut)
        cut.add(move, forKey: "depth")
    }

    /// The band, as the region between the screen's edge and a rounded
    /// rectangle `depth` in, filled even-odd. The same outline the shader
    /// draws to: its inner edge turns on `PresenceFieldRenderer.innerCorner`.
    ///
    /// No glass is the inner rectangle pushed out past the edge rather than
    /// an empty path, so going away and coming back are one animation of the
    /// same shape: a path animation between two paths built differently
    /// does not interpolate, it jumps.
    static func band(in rect: CGRect, depth: CGFloat) -> CGPath {
        let corner = PresenceFieldRenderer.innerCorner
        let inset = depth > 0 ? depth : -corner
        let path = CGMutablePath()
        path.addRect(rect)
        path.addRoundedRect(
            in: rect.insetBy(dx: inset, dy: inset), cornerWidth: corner, cornerHeight: corner)
        return path
    }
}
