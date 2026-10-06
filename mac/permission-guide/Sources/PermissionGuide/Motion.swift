import AppKit
import QuartzCore

/// Anarlog's motion values: overlay-kit/src/macos/animation.rs for the panel
/// reveal and dismiss, assistant/macos/animation.rs for the chrome.
enum Motion {
    static let appearDuration: TimeInterval = 0.32
    static let dismissDuration: TimeInterval = 0.18
    // The card rises 12 points into place and sinks the same 12 on the way out.
    static let appearTranslateY: CGFloat = -12
    static let repositionDuration: TimeInterval = 0.12
    static let hoverDuration: TimeInterval = 0.16
    static let fadeDuration: TimeInterval = 0.15
    // Under 4 points of movement the card snaps rather than animates, so a
    // Settings window being dragged does not leave it trailing behind.
    static let repositionThreshold: CGFloat = 4

    static var easeOut: CAMediaTimingFunction { CAMediaTimingFunction(name: .easeOut) }

    static func animate(_ duration: TimeInterval, _ body: @escaping () -> Void,
                        completion: (() -> Void)? = nil) {
        NSAnimationContext.runAnimationGroup({ context in
            context.duration = duration
            context.timingFunction = easeOut
            body()
        }, completionHandler: completion)
    }

    static func animateScalar(_ layer: CALayer, keyPath: String, from: CGFloat, to: CGFloat,
                              duration: TimeInterval, key: String) {
        let animation = CABasicAnimation(keyPath: keyPath)
        animation.fromValue = from
        animation.toValue = to
        animation.duration = duration
        animation.timingFunction = easeOut
        layer.add(animation, forKey: key)
    }

    static func animateBackground(_ layer: CALayer, to color: NSColor, duration: TimeInterval) {
        let target = color.cgColor
        let animation = CABasicAnimation(keyPath: "backgroundColor")
        animation.fromValue = layer.backgroundColor
        animation.toValue = target
        animation.duration = duration
        animation.timingFunction = easeOut
        layer.add(animation, forKey: "backgroundColor")
        layer.backgroundColor = target
    }

    static func fade(_ layer: CALayer, from: Float, to: Float, duration: TimeInterval,
                     key: String, completion: (() -> Void)? = nil) {
        let animation = CABasicAnimation(keyPath: "opacity")
        animation.fromValue = from
        animation.toValue = to
        animation.duration = duration
        animation.timingFunction = easeOut
        CATransaction.begin()
        CATransaction.setAnimationDuration(duration)
        CATransaction.setCompletionBlock(completion)
        layer.add(animation, forKey: key)
        layer.opacity = to
        CATransaction.commit()
    }

    /// Fade in while rising. Anarlog's assistant drops overlay-kit's scale and
    /// keeps only the translation, so the card never looks like it is zooming.
    static func reveal(_ panel: NSPanel) {
        animate(appearDuration) { panel.animator().alphaValue = 1 }
        if let layer = panel.contentView?.layer {
            animateScalar(layer, keyPath: "transform.translation.y", from: appearTranslateY, to: 0,
                          duration: appearDuration, key: "permissionRevealTranslate")
        }
    }

    static func dismiss(_ panel: NSPanel, completion: @escaping () -> Void) {
        animate(dismissDuration, { panel.animator().alphaValue = 0 }, completion: completion)
        if let layer = panel.contentView?.layer {
            animateScalar(layer, keyPath: "transform.translation.y", from: 0, to: appearTranslateY,
                          duration: dismissDuration, key: "permissionDismissTranslate")
        }
    }
}

enum Theme {
    /// Anarlog's warm accent, hsl(27 87% 67%) in sRGB. Neutral chrome would
    /// disappear against the System Settings pane the card sits on.
    static let accent = (red: 0.957, green: 0.641, blue: 0.383)

    /// The drag row's fill, tuned per appearance so it reads as a drop source
    /// in both without glaring on a dark desktop (Anarlog's alphas, theme.rs).
    static func dragRowBackground(dark: Bool, hovered: Bool) -> NSColor {
        let alpha: CGFloat
        switch (dark, hovered) {
        case (true, true): alpha = 0.34
        case (true, false): alpha = 0.10
        case (false, true): alpha = 0.55
        case (false, false): alpha = 0.24
        }
        return NSColor(srgbRed: accent.red, green: accent.green, blue: accent.blue, alpha: alpha)
    }

    static func isDark(_ view: NSView) -> Bool {
        view.effectiveAppearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
    }

    /// Layer CGColors are snapshots, so dynamic colors are resolved under the
    /// view's own appearance before they are copied into a layer.
    static func resolving(_ view: NSView, _ body: () -> Void) {
        view.effectiveAppearance.performAsCurrentDrawingAppearance(body)
    }

    static func continuousCorner(_ layer: CALayer, _ radius: CGFloat) {
        layer.cornerRadius = radius
        layer.cornerCurve = .continuous
    }
}
