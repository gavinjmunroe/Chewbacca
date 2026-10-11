import OSLog
import SwiftUI

/// A row grows into its card and the card goes back into the row.
///
/// Caleb, 2026-10-10: "I want shit morphing into each other ... in a way thats
/// tasteful and intentional and actually serves the UX". Before this, pressing
/// an agent tile or a meeting row redrew the panel with a detail block that
/// simply appeared under the list: the eye had to find it and work out which
/// row it belonged to. Material's container transform answers both at once:
/// the thing the detail lives in starts as the row that was pressed and
/// travels into place, so where it came from is never a question.
///
/// The timing is Material's, read from MaterialContainerTransform.java on
/// 2026-10-11: one container interpolates from the source's bounds to its
/// own, the content arrives over the first quarter (`DEFAULT_ENTER_THRESHOLDS`,
/// fade 0 to 0.25) and leaves between 0.60 and 0.90 of the way back
/// (`DEFAULT_RETURN_THRESHOLDS`).
///
/// The look is not Material's. Caleb, 2026-10-11 01:17: "The future of UX
/// does not look like macos", and a grey frosted box growing out of a grey
/// row is a nicer macOS window. What travels here is light: a lit outline in
/// the HUD's accent lifts off the row, stretches into the card's place and
/// goes out as it lands, and the card itself is content on the glass with a
/// lit edge, no box. The light exists only while something is changing.
///
/// Why it is drawn at the surface's root and not on the card: the first
/// version moved the card itself, offset up out of its own slot toward the
/// row. The log showed every frame of the flight with the right numbers
/// (p 0.007 to 0.93, window y -101 to -7) and the 60 fps recording showed
/// nothing above the slot. A layer over the whole surface has no slot to be
/// clipped by.
///
/// Protocol: `c card Stack from=@/<pointer>` is a card in the same surface,
/// drawn while the pointer names a row id; `@ <surface> from=<surface>/<row>`
/// opens a separate surface that grows out of that row (SurfaceEntrance).

/// Where each keyed row was last drawn, and the flights in the air.
@MainActor
@Observable
final class RowAnchors {
    static let shared = RowAnchors()

    /// The coordinate space every surface's content measures in, so a card
    /// and its row agree while the surface itself is still sliding in or is
    /// being dragged.
    nonisolated static let space = "hud.surface"

    nonisolated static let log = Logger(subsystem: "kyber", category: "morph")

    // Frames are read once, when a card opens or closes: nothing redraws
    // because a row moved.
    @ObservationIgnored private var local: [String: CGRect] = [:]
    @ObservationIgnored private var screen: [String: CGRect] = [:]
    @ObservationIgnored private var born: [String: Date] = [:]
    /// The last row pressed on each surface, where it was when pressed.
    @ObservationIgnored private var pressed: [String: (row: String, frame: CGRect, at: Date)] = [:]

    /// How long a press is the origin of the card it asked for. The daemon
    /// answers an Open in a fetch (Anarlog reads took 0.00 to 0.05 s on
    /// 2026-10-05; a Granola-sized meeting list is one file read), so five
    /// seconds covers a slow answer without letting an old press decide a
    /// card a refresh opened later. Guessed, never measured.
    nonisolated static let pressWindow: TimeInterval = 5

    /// The light currently travelling. Observed: the layer that draws it is
    /// the one view that redraws when a flight starts or lands.
    private(set) var flights: [Flight] = []

    nonisolated static func key(surface: String, row: String) -> String { "\(surface)/\(row)" }

    func report(surface: String, row: String, local rect: CGRect, screen global: CGRect) {
        guard !surface.isEmpty, !row.isEmpty else { return }
        let key = Self.key(surface: surface, row: row)
        local[key] = rect
        screen[key] = global
        if born[surface] == nil { born[surface] = Date() }
    }

    /// A row was pressed: keep where it was, at the moment of the press.
    func press(surface: String, row: String, at moment: Date = Date()) {
        guard let frame = local[Self.key(surface: surface, row: row)] else { return }
        pressed[surface] = (row, frame, moment)
    }

    /// Where a card opened for `row` starts its light. The pressed row's
    /// frame when this card is the answer to that press: the person's eye is
    /// on the row they pressed, and the list may have moved under it before
    /// the answer landed. Otherwise wherever that row is drawn now. Never a
    /// different row's frame: the light and the card must name the same row,
    /// or the eye is sent to the wrong place (Caleb's 2026-10-11 screenshot).
    func origin(surface: String, row: String, now: Date = Date()) -> CGRect? {
        if let hit = pressed[surface], hit.row == row, now.timeIntervalSince(hit.at) <= Self.pressWindow {
            return hit.frame
        }
        return local(surface: surface, row: row)
    }

    /// The row's frame inside its surface, for a card in the same surface.
    func local(surface: String, row: String) -> CGRect? {
        local[Self.key(surface: surface, row: row)]
    }

    /// The row's frame on the glass, for a surface opened from it.
    func screen(of reference: String) -> CGRect? {
        screen[reference]
    }

    /// How long this surface has had rows on the glass. A card that appears
    /// with the surface itself must not also fly out of a row: that would be
    /// two motions for one cause (motion rule 1).
    func age(of surface: String) -> TimeInterval {
        born[surface].map { Date().timeIntervalSince($0) } ?? 0
    }

    func launch(_ flight: Flight) {
        flights.removeAll { $0.surface == flight.surface && $0.returning == flight.returning }
        flights.append(flight)
        Self.log.info(
            "flight on \(flight.surface, privacy: .public): \(flight.returning ? "back" : "out", privacy: .public) \("\(flight.source)", privacy: .public) to \("\(flight.target)", privacy: .public)")
    }

    func land(_ id: UUID) {
        flights.removeAll { $0.id == id }
    }

    func forget(surface: String) {
        born[surface] = nil
        pressed[surface] = nil
        let prefix = surface + "/"
        local = local.filter { !$0.key.hasPrefix(prefix) }
        screen = screen.filter { !$0.key.hasPrefix(prefix) }
        flights.removeAll { $0.surface == surface }
    }
}

/// One trip of light between a row and its card, in the surface's space.
struct Flight: Identifiable, Equatable {
    let id = UUID()
    let surface: String
    /// Where it starts and where it lands. Out: row to card. Back: card to row.
    let source: CGRect
    let target: CGRect
    let returning: Bool
}

extension EnvironmentValues {
    /// The surface a view is drawn in, so a row can say whose row it is.
    @Entry var hudSurfaceID: String = ""
}

/// Report a keyed row's frame. Put on the row's outermost view.
struct RowAnchor: ViewModifier {
    let row: String
    @Environment(\.hudSurfaceID) private var surface

    private struct Frames: Equatable {
        var local: CGRect
        var screen: CGRect
    }

    func body(content: Content) -> some View {
        content.onGeometryChange(for: Frames.self) { proxy in
            Frames(local: proxy.frame(in: .named(RowAnchors.space)), screen: proxy.frame(in: .global))
        } action: { frames in
            RowAnchors.shared.report(surface: surface, row: row, local: frames.local, screen: frames.screen)
        }
    }
}

extension View {
    func rowAnchor(_ row: String) -> some View { modifier(RowAnchor(row: row)) }
}

/// The interpolation, as pure functions the drawing and the tests share.
enum ContainerTransform {
    struct Pose: Equatable {
        /// Where the light is, relative to the target's top-left.
        var window: CGRect
        /// How bright the travelling light is.
        var containerOpacity: Double
        /// The card's content.
        var contentOpacity: Double
    }

    /// Material's enter fade: content in over the first quarter.
    static let enterFade = 0.0...0.25
    /// Material's return fade, as fractions of the way back.
    static let returnFade = 0.60...0.90
    /// The light comes up over the first slice, so it lifts off the row
    /// rather than appearing on it. Guessed, never measured.
    static let containerFade = 0.12
    /// The tile's own corner, so the row and the light are one shape.
    static let radius: CGFloat = 12

    static func ramp(_ x: Double, _ range: ClosedRange<Double>) -> Double {
        let t = min(max((x - range.lowerBound) / (range.upperBound - range.lowerBound), 0), 1)
        return t * t * (3 - 2 * t)
    }

    static func pose(progress p: Double, source: CGRect?, target: CGRect?,
                     returning: Bool, reduced: Bool) -> Pose {
        let content = returning ? 1 - ramp(1 - p, returnFade) : ramp(p, enterFade)
        guard !reduced, let source, let target, target.width > 0, target.height > 0 else {
            // A fade: no row to grow from, or no travel wanted.
            let size = target?.size ?? .zero
            return Pose(window: CGRect(origin: .zero, size: size),
                        containerOpacity: p, contentOpacity: p)
        }
        func mix(_ a: CGFloat, _ b: CGFloat) -> CGFloat { a + (b - a) * CGFloat(p) }
        let window = CGRect(
            x: mix(source.minX - target.minX, 0), y: mix(source.minY - target.minY, 0),
            width: mix(source.width, target.width), height: mix(source.height, target.height))
        return Pose(window: window, containerOpacity: min(1, p / containerFade), contentOpacity: content)
    }

    /// Where a flight's light is at `p`, in the surface's space.
    ///
    /// It stretches, it does not slide. The edge facing the target leads and
    /// the edge on the source lets go late, so for the first `holdBack` of
    /// the trip the light is still anchored on the row it came from and is
    /// never a row-sized box sitting on a neighbour. The 2026-10-11
    /// recording had the old sliding box pass over the next row at exactly
    /// that row's size, and it read as the light lifting off the wrong row.
    static func frame(of flight: Flight, at p: Double) -> CGRect {
        let s = flight.source, t = flight.target
        let lead = ramp(min(1, p / (1 - holdBack)), 0...1)
        let trail = ramp(max(0, (p - holdBack) / (1 - holdBack)), 0...1)
        func mix(_ a: CGFloat, _ b: CGFloat, _ k: Double) -> CGFloat { a + (b - a) * CGFloat(k) }
        let down = t.midY >= s.midY
        let top = mix(s.minY, t.minY, down ? trail : lead)
        let bottom = mix(s.maxY, t.maxY, down ? lead : trail)
        let left = mix(s.minX, t.minX, p), right = mix(s.maxX, t.maxX, p)
        return CGRect(x: left, y: top, width: max(0, right - left), height: max(0, bottom - top))
    }

    /// The share of the trip the source edge holds still. Guessed, never
    /// measured; 0.3 keeps the light on its row for the first frames of a
    /// 0.42 s spring at 60 Hz, which is where the eye looks for the cause.
    static let holdBack = 0.3

    /// The light's brightness: up as it lifts, out as it lands, so nothing
    /// is lit once the change is over (motion rule 6).
    static func glow(at p: Double) -> Double {
        min(1, p / containerFade) * (1 - ramp(p, 0.7...1.0))
    }

    /// Out on a spring with no bounce, back shorter. Material gives the
    /// transform 500 ms in and 400 ms back (m3_sys_motion_duration_long2 and
    /// medium4) on a phone; Apple asks for brevity in anything frequent and
    /// Emil Kowalski puts UI motion under 300 ms. A card opened from a row is
    /// less frequent than a hover and more than a page, so it sits between.
    /// Guessed from those three, never measured on the glass.
    static let openDuration = 0.42
    static let closeDuration = 0.30

    @MainActor
    static func open(reduced: Bool) -> Animation {
        reduced ? .easeOut(duration: 0.15) : .spring(duration: openDuration, bounce: 0)
    }

    @MainActor
    static func close(reduced: Bool) -> Animation {
        reduced ? .easeOut(duration: 0.12) : .spring(duration: closeDuration, bounce: 0)
    }

    /// One frame at 60 Hz, rounded up. A flight's 0 must be drawn before it
    /// springs to 1: started in the same pass, the spring had nothing to
    /// spring from (the 60 fps recording on 2026-10-11).
    static let firstFrameMs = 17
}

/// Draws the flights for one surface, over everything in it.
struct MorphLayer: View {
    let surface: String
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        ZStack(alignment: .topLeading) {
            // Reduce Motion: nothing travels, so nothing is drawn here; the
            // card's content fades in place.
            if !reduceMotion {
                ForEach(RowAnchors.shared.flights.filter { $0.surface == surface }) { flight in
                    FlightView(flight: flight)
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .allowsHitTesting(false)
    }
}

/// One flight: a lit outline that springs from its source to its target and
/// goes out as it lands.
struct FlightView: View {
    let flight: Flight
    @State private var progress = 0.0

    var body: some View {
        Color.clear
            .modifier(FlightLight(progress: progress, flight: flight))
            .task {
                try? await Task.sleep(for: .milliseconds(ContainerTransform.firstFrameMs))
                let duration = flight.returning ? ContainerTransform.closeDuration : ContainerTransform.openDuration
                withAnimation(flight.returning ? ContainerTransform.close(reduced: false)
                                               : ContainerTransform.open(reduced: false)) { progress = 1 }
                // A no-bounce spring is visually done at its duration, and
                // the light is out by then (glow reaches 0 at p 1).
                try? await Task.sleep(for: .milliseconds(Int(duration * 1000) + 60))
                RowAnchors.shared.land(flight.id)
            }
    }
}

nonisolated struct FlightLight: ViewModifier, Animatable {
    var progress: Double
    let flight: Flight

    var animatableData: Double {
        get { progress }
        set { progress = newValue }
    }

    func body(content: Content) -> some View {
        let rect = ContainerTransform.frame(of: flight, at: progress)
        let glow = ContainerTransform.glow(at: progress)
        let shape = RoundedRectangle(cornerRadius: ContainerTransform.radius, style: .continuous)
        return content
            .overlay(alignment: .topLeading) {
                shape
                    .fill(HUD.accent.opacity(0.07 * glow))
                    .overlay(shape.strokeBorder(HUD.accent.opacity(0.85 * glow), lineWidth: 1.25))
                    .shadow(color: HUD.accent.opacity(0.55 * glow), radius: 10)
                    .frame(width: max(rect.width, 1), height: max(rect.height, 1))
                    .offset(x: rect.minX, y: rect.minY)
            }
    }
}

/// A card that opened from a row: its content arrives as the light lands,
/// and a lit edge on its leading side says which card is open.
struct MorphCard<Content: View>: View {
    let surface: String
    let row: String
    /// The card's component id, so its own frame can be found again when it
    /// closes.
    let card: String
    let content: Content

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var shown: Double

    /// A card that appears within this long of its surface is part of the
    /// surface's own arrival and does not fly in from a row. SurfaceEntrance
    /// settles in about 280 ms (three frames at 20 fps in the 2026-10-04
    /// recording); this leaves room for that and the first row reports.
    static var settle: TimeInterval { 0.45 }

    init(surface: String, row: String, card: String, @ViewBuilder content: () -> Content) {
        self.surface = surface
        self.row = row
        self.card = card
        self.content = content()
        // Decided before the first frame, so the hidden start is the card's
        // initial state and not an animated change (an animated jump to
        // hidden rode the surface's own spring on 2026-10-11).
        let flies = RowAnchors.shared.age(of: surface) > Self.settle
            && RowAnchors.shared.origin(surface: surface, row: row) != nil
        _shown = State(initialValue: flies ? 0 : 1)
    }

    var body: some View {
        content
            .opacity(shown)
            .overlay(alignment: .leading) {
                // The open card's mark: one lit line, not a box.
                Capsule()
                    .fill(HUD.accent.opacity(0.9))
                    .frame(width: 2)
                    .shadow(color: HUD.accent.opacity(0.6), radius: 4)
                    .padding(.vertical, 2)
                    .opacity(shown)
            }
            .onGeometryChange(for: CGRect.self) { proxy in
                proxy.frame(in: .named(RowAnchors.space))
            } action: { frame in
                RowAnchors.shared.report(surface: surface, row: "#card:\(card)", local: frame, screen: .zero)
            }
            .task {
                guard shown < 1 else { return }
                try? await Task.sleep(for: .milliseconds(ContainerTransform.firstFrameMs))
                let anchors = RowAnchors.shared
                if !reduceMotion, let from = anchors.origin(surface: surface, row: row),
                   let to = anchors.local(surface: surface, row: "#card:\(card)") {
                    anchors.launch(Flight(surface: surface, source: from, target: to, returning: false))
                }
                // The content lands with the light: in over the back half of
                // the flight, so it is never drawn far from where the light is.
                withAnimation(.easeOut(duration: ContainerTransform.openDuration * 0.5)
                    .delay(reduceMotion ? 0 : ContainerTransform.openDuration * 0.45)) { shown = 1 }
            }
    }
}

/// Where a `from=` card lives in its parent: nothing while no row is open,
/// the card while one is. A different row is a different card, so switching
/// rows sends light back into the old row while the new card flies out of
/// its own.
struct CardSlot<Content: View>: View {
    let surface: String
    let row: String
    let card: String
    @ViewBuilder let content: Content

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        ZStack(alignment: .topLeading) {
            if !row.isEmpty {
                MorphCard(surface: surface, row: row, card: card) {
                    content
                        .padding(.leading, 12)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .id(row)
                // The content leaves fast, Material's return fade; the light
                // carries the rest of the way back.
                .transition(.asymmetric(insertion: .identity,
                                        removal: .opacity.animation(.easeIn(duration: 0.12))))
            }
        }
        .onChange(of: row) { old, _ in
            guard !old.isEmpty, !reduceMotion else { return }
            let anchors = RowAnchors.shared
            if let from = anchors.local(surface: surface, row: "#card:\(card)"),
               let to = anchors.local(surface: surface, row: old) {
                anchors.launch(Flight(surface: surface, source: from, target: to, returning: true))
            }
        }
    }
}
