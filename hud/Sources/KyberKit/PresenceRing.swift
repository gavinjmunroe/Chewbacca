import AppKit
import QuartzCore
import SwiftUI

/// Is it there, is it listening, is it working, is it stuck.
///
/// Built to the spec in `the-jarvis-problem.md` §7.1, which makes the case
/// better than this comment can: presence is a designable surface and it is
/// empty in every shipping assistant. You cannot tell whether the thing is
/// alive, so you develop the habit of assuming it is not.
///
/// The vocabulary is deliberately tiny, and the constraint that matters is that
/// each state has a **distinct motion signature identifiable in peripheral
/// vision**. Six states that all pulse are one state. Someone should know it is
/// thinking without looking directly at it.
public enum Presence: String, Sendable, CaseIterable {
    /// Running, not listening, nothing in flight. Static and nearly invisible.
    case dormant
    /// Listening for address. Bright and still: listening is the resting
    /// state of a session, and nothing moves while idle.
    case attentive
    /// Hearing speech directed at it. Thickness tracks amplitude.
    case hearing
    /// Saying something out loud. Thickness tracks its own voice, exactly as
    /// `hearing` tracks the person's: the same signature on both sides of the
    /// exchange, because the ask on 2026-09-19 was for the reply to "make the
    /// same talking effect" as the request. Set from outside, by the bridge,
    /// from the level of the audio it is playing.
    case speaking
    /// A request is in flight. One arc, rotating.
    case thinking
    /// Executing something. Arc segments stepping, one per completed action.
    case acting
    /// The thing it was executing finished, and nothing is in flight. Holds
    /// until the next request rather than dropping straight back to `dormant`:
    /// someone who looked away for ten seconds still gets to find out it
    /// worked, and a state that clears itself the instant it arrives is a
    /// state nobody ever sees.
    case done
    /// Wants to say something, or is blocked on you. Two pulses, then hold.
    case attention
    /// An action failed in a way that may have left something in a bad state.
    /// The only state that is ever red.
    case failed

    /// The two states a voice drives, the person's and its own. Both are set
    /// from outside at the rate the level arrives, and both draw the same way.
    var voiced: Bool { self == .hearing || self == .speaking }

    /// Colour carries meaning here and nothing else. No branding, no theming.
    var tint: Color {
        switch self {
        case .acting, .done: return HUD.good
        case .attention: return HUD.warn
        case .failed: return HUD.bad
        default: return HUD.accent
        }
    }

    /// How long the ring may stay in this state before it is lying.
    ///
    /// An indefinite spinner is forbidden: a request that has been "thinking"
    /// for eight seconds with nothing else on screen has failed to communicate,
    /// whatever it is actually doing. Nil means the state can hold forever,
    /// which is only true of the ones that are not claiming progress.
    var patience: Duration? {
        switch self {
        case .thinking: return .seconds(8)
        case .acting: return .seconds(30)
        default: return nil
        }
    }
}

/// The mark: an asterisk.
///
/// Gavin, 2026-09-23, looking at the green ring: "i hate how it looks, can you
/// make it a * symbol and just have it pulsate and change color and spin when
/// thinking." So the mark is six arms from one centre, and the states keep
/// their motion signatures on it: still when dormant, attentive or done,
/// swelling with the voice, and spinning while it works. Thinking adds a pulse
/// and a slow walk around the colour wheel, because it is the one state that
/// has to be readable from the corner of an eye.
///
/// Every continuous motion runs on Core Animation, in the render server, and
/// none of it touches SwiftUI. Until 2026-10-05 the breath, spin, pulse and
/// hue walk were SwiftUI `repeatForever` animations, on the assumption that
/// SwiftUI hands those to Core Animation. On macOS it does not: the hosting
/// view re-rendered the whole full-screen overlay at display rate for as long
/// as one ran. Measured that day on Caleb's Mac, glass cleared, `ps` each
/// second over 10 s: `attentive` cost 30.6% CPU with the breath and 9.2% with
/// the ring held still on the same build, and flipping the state back to
/// `dormant` left it at 17.3%, because SwiftUI does not stop a repeating
/// animation when the value driving it changes. Here every animation is a
/// `CABasicAnimation` under a named key and is removed by that key when the
/// state changes, so a state that does not move costs nothing at all.
struct PresenceRing: View {
    let presence: Presence
    /// 0 to 1, only read in `.hearing` and `.speaking`. Voice amplitude.
    let amplitude: Double

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.hudOffscreen) private var offscreen

    static let size: CGFloat = 16

    var body: some View {
        Group {
            if offscreen {
                // `ImageRenderer` cannot draw an `NSViewRepresentable`, so a
                // snapshot gets the same mark, still, at its resting pose.
                Asterisk(arms: 6)
                    .stroke(presence.tint, style: StrokeStyle(
                        lineWidth: RingLook.lineWidth(presence, amplitude), lineCap: .round))
                    .scaleEffect(RingLook.scale(presence, amplitude))
                    .opacity(RingLook.opacity(presence))
                    .shadow(color: presence.tint.opacity(RingLook.glow(presence)), radius: 6)
            } else {
                RingLayer(presence: presence, amplitude: amplitude, reduceMotion: reduceMotion)
            }
        }
        .frame(width: Self.size, height: Self.size)
        .allowsHitTesting(false)
        .accessibilityElement()
        .accessibilityLabel("Chewbacca \(presence.rawValue)")
    }
}

/// The resting look of each state, shared by the live layer and the snapshot.
enum RingLook {
    static func voice(_ presence: Presence, _ amplitude: Double) -> Double {
        presence.voiced ? min(max(amplitude, 0), 1) : 0
    }

    static func lineWidth(_ presence: Presence, _ amplitude: Double) -> CGFloat {
        switch presence {
        case .attention, .failed: return 2.4
        default: return 2.0 + 1.2 * voice(presence, amplitude)
        }
    }

    /// The scale a state rests at. The moving states pulse around 1.
    static func scale(_ presence: Presence, _ amplitude: Double) -> CGFloat {
        switch presence {
        case .hearing, .speaking: return 1 + 0.3 * voice(presence, amplitude)
        default: return 1
        }
    }

    static func opacity(_ presence: Presence) -> Double {
        presence == .dormant ? 0.3 : 1
    }

    static func glow(_ presence: Presence) -> Double {
        switch presence {
        case .dormant: return 0
        case .attention, .failed: return 0.7
        default: return 0.45
        }
    }

    /// Thinking turns steadily; acting turns faster, so something being done
    /// to the machine reads differently from something being considered.
    /// Nil for a state that does not turn.
    static func spinPeriod(_ presence: Presence) -> Double? {
        switch presence {
        case .thinking: return 2.4
        case .acting: return 1.0
        default: return nil
        }
    }
}

/// The asterisk as a `CAShapeLayer`, so its motion lives in the render server.
private struct RingLayer: NSViewRepresentable {
    let presence: Presence
    let amplitude: Double
    let reduceMotion: Bool

    func makeNSView(context: Context) -> RingLayerView { RingLayerView() }

    func updateNSView(_ view: RingLayerView, context: Context) {
        view.apply(presence: presence, amplitude: amplitude, reduceMotion: reduceMotion)
    }
}

final class RingLayerView: NSView {
    /// Carries the scale: the resting one, the voice and the pulse.
    private let scaler = CALayer()
    /// Carries the turn and the stroke.
    private let mark = CAShapeLayer()

    private var shown: Presence?
    private var shownReduced = false

    private enum Key {
        static let spin = "kyber.spin"
        static let pulse = "kyber.pulse"
        static let hue = "kyber.hue"
        static let beat = "kyber.beat"
        static let all = [spin, pulse, hue, beat]
    }

    init() {
        super.init(frame: NSRect(x: 0, y: 0, width: PresenceRing.size, height: PresenceRing.size))
        wantsLayer = true
        layer?.masksToBounds = false
        mark.fillColor = nil
        mark.lineCap = .round
        mark.shadowOffset = .zero
        // SwiftUI drew this glow at radius 6. A layer's radius blurs wider for
        // the same number; 4 is guessed by eye, never measured.
        mark.shadowRadius = 4
        scaler.addSublayer(mark)
        layer?.addSublayer(scaler)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    // The ring is never a target: clicks pass to whatever is under it.
    override func hitTest(_ point: NSPoint) -> NSView? { nil }

    override func layout() {
        super.layout()
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        scaler.frame = bounds
        mark.frame = scaler.bounds
        mark.path = Asterisk(arms: 6).path(in: mark.bounds).cgPath
        CATransaction.commit()
    }

    override func viewDidChangeBackingProperties() {
        super.viewDidChangeBackingProperties()
        let scale = window?.backingScaleFactor ?? 2
        scaler.contentsScale = scale
        mark.contentsScale = scale
    }

    func apply(presence: Presence, amplitude: Double, reduceMotion: Bool) {
        let changed = presence != shown || reduceMotion != shownReduced
        let previous = shown
        shown = presence
        shownReduced = reduceMotion

        // The resting values. A voice level arrives many times a second and
        // gets the short ease it had in SwiftUI; a state change fades.
        CATransaction.begin()
        CATransaction.setAnimationDuration(changed ? (reduceMotion ? 0.1 : 0.35) : 0.06)
        let tint = NSColor(presence.tint).cgColor
        mark.strokeColor = tint
        mark.shadowColor = tint
        mark.shadowOpacity = Float(RingLook.glow(presence))
        mark.lineWidth = RingLook.lineWidth(presence, amplitude)
        mark.opacity = Float(RingLook.opacity(presence))
        let rest = RingLook.scale(presence, amplitude)
        scaler.transform = CATransform3DMakeScale(rest, rest, 1)
        CATransaction.commit()

        guard changed else { return }
        restart(from: previous, to: presence, reduced: reduceMotion)
    }

    private func restart(from previous: Presence?, to presence: Presence, reduced: Bool) {
        let period = RingLook.spinPeriod(presence)
        // Only stop the turn and the pulse when the next state does not turn,
        // so going from thinking to acting keeps spinning from where it is
        // instead of snapping back to zero.
        let turning = period != nil && previous.flatMap(RingLook.spinPeriod) != nil
        let angle = (mark.presentation()?.value(forKeyPath: "transform.rotation.z") as? Double) ?? 0
        for key in Key.all where !(turning && !reduced && (key == Key.spin || key == Key.pulse)) {
            mark.removeAnimation(forKey: key)
            scaler.removeAnimation(forKey: key)
        }
        guard !reduced else { return }

        switch presence {
        case .thinking, .acting:
            if let period, mark.animation(forKey: Key.spin) == nil || previous.flatMap(RingLook.spinPeriod) != period {
                let spin = CABasicAnimation(keyPath: "transform.rotation.z")
                // AppKit layers are not flipped, so positive is anticlockwise.
                // Negative keeps the clockwise turn SwiftUI drew.
                let start = turning ? angle : 0
                spin.fromValue = start
                spin.toValue = start - 2 * Double.pi
                spin.duration = period
                spin.repeatCount = .infinity
                spin.isRemovedOnCompletion = false
                mark.add(spin, forKey: Key.spin)
            }
            if scaler.animation(forKey: Key.pulse) == nil {
                let pulse = CABasicAnimation(keyPath: "transform.scale")
                pulse.fromValue = 0.86
                pulse.toValue = 1.14
                pulse.duration = 0.6
                pulse.autoreverses = true
                pulse.repeatCount = .infinity
                pulse.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
                pulse.isRemovedOnCompletion = false
                scaler.add(pulse, forKey: Key.pulse)
            }
            if presence == .thinking {
                let hue = CAKeyframeAnimation(keyPath: "strokeColor")
                hue.values = Self.hueWheel(from: NSColor(presence.tint), steps: 12)
                hue.duration = 3
                hue.repeatCount = .infinity
                hue.isRemovedOnCompletion = false
                mark.add(hue, forKey: Key.hue)
            }
        case .attention, .failed:
            // Two pulses, then hold. A thing that pulses forever is a thing
            // people learn to ignore. Four 0.24 s steps, as before.
            let beat = CAKeyframeAnimation(keyPath: "transform.scale")
            beat.values = [1, 1.25, 1, 1.25, 1]
            beat.keyTimes = [0, 0.25, 0.5, 0.75, 1]
            beat.duration = 0.96
            beat.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
            scaler.add(beat, forKey: Key.beat)
        default:
            // Dormant, attentive, hearing, speaking and done hold still. The
            // voiced two move only with the level that arrives from outside.
            break
        }
    }

    /// The tint walked once round the colour wheel, ending where it began.
    static func hueWheel(from colour: NSColor, steps: Int) -> [CGColor] {
        let rgb = colour.usingColorSpace(.sRGB) ?? colour
        var hue: CGFloat = 0, saturation: CGFloat = 0, brightness: CGFloat = 0, alpha: CGFloat = 0
        rgb.getHue(&hue, saturation: &saturation, brightness: &brightness, alpha: &alpha)
        return (0...steps).map { step in
            let turned = (hue + CGFloat(step) / CGFloat(steps)).truncatingRemainder(dividingBy: 1)
            return NSColor(hue: turned, saturation: saturation, brightness: brightness, alpha: alpha).cgColor
        }
    }
}

/// Arms from the centre to the edge, evenly spaced, the first pointing up.
struct Asterisk: Shape {
    let arms: Int

    func path(in rect: CGRect) -> Path {
        var path = Path()
        let centre = CGPoint(x: rect.midX, y: rect.midY)
        // Inset by half the widest stroke so round caps are not clipped.
        let radius = min(rect.width, rect.height) / 2 - 1.6
        for arm in 0..<arms {
            let angle = Double(arm) / Double(arms) * 2 * .pi - .pi / 2
            path.move(to: centre)
            path.addLine(to: CGPoint(x: centre.x + radius * cos(angle),
                                     y: centre.y + radius * sin(angle)))
        }
        return path
    }
}
