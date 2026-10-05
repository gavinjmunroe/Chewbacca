import AppKit
import SwiftUI

/// The frame's strip over the menu bar, for `MenuBarStripWindow`: the same
/// field as the main glass, drawing only the strip.
@MainActor
public struct MenuBarStripView: View {
    let model: OverlayModel

    public init(model: OverlayModel) { self.model = model }

    public var body: some View {
        PresenceField(presence: model.presence, amplitude: model.amplitude, menuBarOnly: true)
    }
}

/// Everything drawn on the glass.
///
/// Surfaces are laid out by region rather than by coordinate, because an agent
/// asking for "the calendar top left" does not know the size of the display and
/// should not have to. Several in the same region stack downward with an offset
/// so they read as a column rather than as one panel that failed to update.
@MainActor
public struct OverlayView: View {
    let model: OverlayModel

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    public init(model: OverlayModel) { self.model = model }

    /// How much of the bottom of the display the Dock is using.
    static var bottomInset: CGFloat {
        guard let screen = OverlayWindow.active else { return 0 }
        return screen.visibleFrame.minY - screen.frame.minY
    }

    /// Where the pill is drawn, for the field to draw its body: centred, and
    /// `pillLift` above the Dock, the same placement the pill's own frame
    /// uses below. Nil while it is down or has not been measured yet.
    private var pillFrame: CGRect? {
        guard model.pill.phase != .hidden, !model.chatOpen,
              model.pillSize.width > 0, let screen = OverlayWindow.active
        else { return nil }
        let size = model.pillSize
        return CGRect(
            x: (screen.frame.width - size.width) / 2,
            y: screen.frame.height - Self.bottomInset - PillView.pillLift - size.height,
            width: size.width, height: size.height)
    }

    public var body: some View {
        ZStack {
            // The glass itself is deliberately nothing. Any background here,
            // even at low opacity, tints the entire display.
            Color.clear

            // The other half of the presence surface, at the size peripheral
            // vision can actually see. It obeys the line above: the shader
            // returns an empty alpha everywhere except the edge, so the middle
            // of the display comes back genuinely untouched.
            //
            // Under everything. This is the state of the assistant rather than
            // content, and content wins any pixel they both want.
            PresenceField(
                presence: model.presence, amplitude: model.amplitude,
                agent: model.agentCursor?.point, pill: pillFrame)
                .zIndex(0)

            // Marks sit under the panels: a panel is something the person
            // asked for, a mark is something the assistant added, and when they
            // overlap the answer should not be hidden by the annotation.
            ForEach(model.markers) { marker in
                MarkerView(marker: marker, screenHeight: 0)
                    .transition(.opacity)
            }
            .zIndex(1)

            // The agent's pointer sits over panels: it is the one thing on
            // the glass that says where the agent's hands are right now.
            if let cursor = model.agentCursor {
                AgentCursorView(cursor: cursor)
                    .transition(.opacity)
                    .zIndex(9000)
            }

            // The ring, bottom right, above everything.
            //
            // It is the one thing on the glass that is always present, so it
            // gets the corner least likely to hold work: the Dock is along the
            // bottom on most machines but the far right of it is usually empty,
            // and the eye finds a fixed point far faster than a moving one.
            PresenceRing(presence: model.presence, amplitude: model.amplitude)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomTrailing)
                // Above the Dock, not behind it.
                //
                // The window covers the whole display including the Dock, so a
                // plain bottom-trailing alignment put the one element that is
                // always on screen in the one place it could never be seen.
                .padding(.trailing, 22)
                .padding(.bottom, Self.bottomInset + 14)
                // One presence object at a time. The pill carries the same
                // ring at its leading edge, and a spinner in the corner doing
                // the same dance as the one in the pill reads as a bug. The
                // conversation panel carries it too.
                .opacity(model.pill.phase == .hidden && !model.chatOpen ? 1 : 0)
                .zIndex(9999)

            // The pill, bottom centre, where every subtitle on every screen
            // the person has ever watched lives. Above every surface, under
            // the ring. Gone while the conversation panel is up: the panel
            // is the pill grown, and it stands where the pill stood.
            if model.pill.phase != .hidden {
                PillView(
                    state: model.pill, presence: model.presence, amplitude: model.amplitude,
                    clock: model.clock, onCancel: { model.cancelRun() },
                    onExpand: { model.openChat() })
                    .background {
                        // Measured on the glass itself, inside the width cap,
                        // so the hit rectangle is the capsule and not the
                        // 440pt frame around it.
                        GeometryReader { proxy in
                            Color.clear.onChange(of: proxy.size, initial: true) { _, size in
                                model.report(pillSize: size)
                            }
                        }
                    }
                    .frame(maxWidth: PillView.maxWidth)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom)
                    .padding(.bottom, Self.bottomInset + PillView.pillLift)
                    .transition(.asymmetric(
                        insertion: .modifier(
                            active: SurfaceEntrance(progress: 0, from: .bottom),
                            identity: SurfaceEntrance(progress: 1, from: .bottom)),
                        removal: .opacity.combined(with: .scale(scale: 0.96))))
                    // While the conversation panel is up the pill stays in
                    // the tree and is only hidden: the panel is the pill
                    // grown, so the pill goes the instant the panel's glass
                    // stands where it stood, and comes back only once the
                    // panel has folded back into it (0.26 s, `conceal`).
                    // Removing it with a fade, as until 2026-10-04, left a
                    // moment where both or neither were on screen.
                    .opacity(model.chatOpen ? 0 : 1)
                    .allowsHitTesting(!model.chatOpen)
                    .animation(
                        model.chatOpen ? nil : .easeOut(duration: 0.06).delay(0.24),
                        value: model.chatOpen)
                    .zIndex(9998)
            }

            // The terminal strip, directly under the pill and standing on
            // its own when the pill is down: the tab can be running while
            // the assistant is dormant, and that is when the strip matters.
            if let strip = model.terminal, !model.chatOpen {
                TerminalStripView(strip: strip, onFocus: { model.focusTerminal() })
                    .frame(maxWidth: PillView.maxWidth)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom)
                    // The pill sits at bottomInset + pillLift (14) from the
                    // bottom and is about 40pt tall; this 22pt strip at
                    // bottomInset - 8 ends where the pill begins.
                    .padding(.bottom, Self.bottomInset - 8)
                    .transition(.opacity)
                    .zIndex(9998)
            }

            ForEach(model.surfaces, id: \.viewID) { surface in
                card(surface)
            }
        }
        .animation(Motion.smooth(reduced: reduceMotion), value: model.revision)
        .environment(\.hudEnergy, model.presence.energy)
        .task {
            // The screen behind the pill, for its lens and its ink. Only
            // while the pill is up; nothing is sampled otherwise.
            await BackdropSampler.shared.follow { [model] in model.pillFrame }
        }
        .ignoresSafeArea()
    }

    private func card(_ surface: OverlaySurface) -> some View {
        let centre = model.origin(for: surface)
        // From the card's resting centre to where it was summoned from, so it
        // grows out of the hyper bar and goes back into it.
        let summon = surface.summonedFrom.map {
            CGSize(width: $0.x - centre.x, height: $0.y - centre.y)
        }
        return SurfaceCard(
                    surface: surface,
                    onDismiss: { model.dismiss(surface.id) },
                    onDrag: { model.move(surface.id, by: $0) },
                    onSettle: { model.settle(surface.id, at: $0) },
                    onGrab: { model.raise(surface.id) },
                    onUnfold: { model.unfold(surface.id) },
                    screenFrame: {
                        let height = model.drawnHeight(surface)
                        return CGRect(
                            x: centre.x - surface.width / 2, y: centre.y - height / 2,
                            width: surface.width, height: height)
                    }())
                    .frame(width: surface.width)
                    .background {
                        GeometryReader { proxy in
                            Color.clear.onChange(of: proxy.size.height, initial: true) { _, height in
                                model.report(height: height, for: surface.id)
                            }
                        }
                    }
                    // `.position` and not `.position(0,0).offset(...)`.
                    //
                    // `.offset` is a visual transform: it moves what you see and
                    // leaves the hit region where the view was laid out. Every
                    // card was therefore drawn in its corner while hit-testing at
                    // the top-left of the screen, so nothing on any surface could
                    // be clicked and dragging could never start. `.position`
                    // moves the layout itself, which is what was wanted.
                    .position(centre)
                    .transition(SurfaceEntrance.transition(
                        region: surface.region, summon: summon, reduced: reduceMotion))
                    .zIndex(Double(surface.depth))
    }
}

/// How a surface arrives.
///
/// It slides in from whichever edge it is anchored to, so a panel in the bottom
/// right comes up from the bottom right. Movement that agrees with position
/// reads as the thing arriving; movement that fights it reads as a glitch.
///
/// Blur on entry does most of the work: it is what makes something feel like it
/// resolved into place rather than being pasted there.
nonisolated struct SurfaceEntrance: ViewModifier, Animatable {
    var progress: Double
    let from: Region
    /// From the card's centre to the point it was summoned from. Set, the
    /// card grows out of that point (Material's container transform, done
    /// with a scale and a travel because the hyper bar is not a view in this
    /// tree); nil, it comes in from its region's edge.
    var summon: CGSize?
    /// How much of the way back to the source it is drawn at progress 0.
    /// One on the way in. Less on the way out, so an exit is quieter than
    /// the entrance it mirrors.
    var reach: Double = 1
    /// Reduce Motion: opacity only, nothing travels or scales.
    var reduced = false

    var animatableData: Double {
        get { progress }
        set { progress = newValue }
    }

    /// Where the card is drawn at `progress`: one function, so the drawing
    /// and the tests read the same numbers.
    struct Pose: Equatable {
        var opacity: Double
        var blur: Double
        var scale: Double
        var offset: CGSize
    }

    var pose: Pose {
        let rest = 1 - progress
        if reduced {
            return Pose(opacity: progress, blur: 0, scale: 1, offset: .zero)
        }
        if let summon {
            return Pose(
                opacity: progress, blur: 6 * rest,
                scale: 1 - Self.summonShrink * rest * reach,
                offset: CGSize(
                    width: summon.width * rest * reach,
                    height: summon.height * rest * reach))
        }
        let travel = 26.0 * rest * reach
        let anchor = from.anchor
        return Pose(
            opacity: progress, blur: 9 * rest,
            scale: 1 - 0.06 * rest * reach,
            offset: CGSize(
                width: travel * (anchor.x - 0.5) * 2,
                height: travel * (0.5 - anchor.y) * 2))
    }

    func body(content: Content) -> some View {
        let pose = pose
        return content
            .opacity(pose.opacity)
            .blur(radius: pose.blur)
            .scaleEffect(pose.scale)
            .offset(pose.offset)
    }

    /// How small a summoned card starts: 0.45 of its size, about the hyper
    /// bar's own height against a 120-point card. Tuned against the eye
    /// on 2026-10-04.
    static let summonShrink = 0.55

    /// The entrance rides the overlay's own `Motion.smooth` spring, and the
    /// exit is shorter and quieter: 160 ms, accelerating away, and only a
    /// third of the way back to where it came from. Material puts desktop
    /// transitions at 150 to 200 ms and entering over exiting; Carlton's
    /// design.md says exits are shorter and quieter than entrances.
    ///
    /// The insertion carries no animation of its own. With `arrive` attached
    /// to it, a screen recording on 2026-10-04 (60 fps, read at 20) showed a
    /// new card held blurred at half opacity for about 600 ms and then snap
    /// sharp: the attached spring and the overlay's revision spring fought
    /// over the same insertion. Without it the same card settled in three
    /// frames. The removal has nothing to fight and keeps its own.
    static func transition(region: Region, summon: CGSize?, reduced: Bool) -> AnyTransition {
        func at(_ progress: Double, reach: Double) -> SurfaceEntrance {
            SurfaceEntrance(
                progress: progress, from: region, summon: summon, reach: reach, reduced: reduced)
        }
        let leave: Animation = reduced ? .easeOut(duration: 0.1) : depart
        return .asymmetric(
            insertion: .modifier(active: at(0, reach: 1), identity: at(1, reach: 1)),
            removal: .modifier(
                active: at(0, reach: departReach), identity: at(1, reach: departReach))
                .animation(leave))
    }

    /// A spring with no bounce whose perceived duration is 280 ms, for the
    /// parts of a composed entrance (`Stagger`). A spring rather than an ease
    /// so a part interrupted mid-flight bends instead of restarting.
    static let arriveDuration = 0.28
    static let departDuration = 0.16
    /// Of the way back to its source a leaving card travels.
    static let departReach = 0.35
    static let arrive = Animation.spring(duration: arriveDuration, bounce: 0)
    static let depart = Animation.easeIn(duration: departDuration)
}

/// One surface: the material, the light, the edge.
///
/// This reads as a heads-up display rather than a settings panel, and the
/// difference is almost entirely light. A HUD is dark so the content glows off
/// it, it has a bright hairline along the top where the light source would be,
/// and it sits in its own pool of shadow so it is unmistakably *above* the work
/// rather than part of it.
///
/// Everything stays under about fifteen percent opacity, because this floats
/// over somebody's real screen and a HUD that fights the work is a HUD that gets
/// turned off.
struct SurfaceCard: View {
    let surface: OverlaySurface
    let onDismiss: () -> Void
    let onDrag: (CGSize) -> Void
    /// Where the hand let go, thrown on a little by its speed. The model
    /// clamps it to the screen.
    var onSettle: (CGSize) -> Void = { _ in }
    let onGrab: () -> Void
    /// A click on a folded card's title opens it.
    var onUnfold: () -> Void = {}

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var hovering = false
    @State private var lit = false
    /// Where the card is on the screen, top-left origin, for measuring the
    /// ground under it. Zero in snapshots, which skips the measurement.
    var screenFrame: CGRect = .zero
    @State private var ground: Double?
    private var groundKey: [Int] {
        [screenFrame.minX, screenFrame.minY, screenFrame.width, screenFrame.height]
            .map { Int(($0 / 24).rounded()) }
    }
    /// Where the drag stood when the current gesture began: read from the
    /// surface, not kept here, because a settle can move it after release
    /// and a copy kept here made the next drag jump by the difference.
    @State private var start: CGSize?

    /// The height of a Screen's title line, which is all a folded card
    /// shows: 13pt semibold rounded lays out at 16. With the card's 14 above
    /// and below, a folded card is 44, the target floor.
    static let titleLine: CGFloat = 16

    /// Whether this surface is a launcher rail: its Screen holds a Rail.
    private var isRail: Bool { surface.isRail }

    /// The Screen's title, for the folded card and the close button's name.
    private var title: String {
        let store = surface.store
        guard let root = store.spec.root, let node = store.spec.elements[root] else { return "" }
        return store.resolved(node)["title"]?.display ?? ""
    }

    var body: some View {
        // Never taller than the screen.
        //
        // A surface that overflows does not merely look wrong, it centres itself
        // off both edges and hides its own title, which is how the first
        // dashboard lost its heading and its top chart at once. `ViewThatFits`
        // takes the plain layout when it fits and swaps in a scrolling one when
        // it does not, so a short panel is still sized to its content.
        ViewThatFits(in: .vertical) {
            SurfaceView(store: surface.store)
            ScrollView(.vertical, showsIndicators: false) {
                SurfaceView(store: surface.store)
            }
            .scrollBounceBehavior(.basedOnSize)
            // A dissolve at the bottom edge, and only on the version that
            // overflows: a panel that fits wears no band, because a fade says
            // something is under it (Carlton's design.md).
            .mask {
                VStack(spacing: 0) {
                    Color.black
                    LinearGradient(
                        colors: [.black, .clear], startPoint: .top, endPoint: .bottom)
                        .frame(height: 22)
                }
            }
        }
            .frame(maxHeight: surface.maxHeight)
            // Hug the content vertically.
            //
            // The overlay proposes the whole screen to every surface, and
            // `.position` keeps proposing it, so without this a card with four
            // lines in it draws as a full-height slab with its content floating
            // in the middle. `fixedSize` tells the card to take its ideal height
            // and ignore the offer.
            .fixedSize(horizontal: false, vertical: true)
            // Folding is this one card getting shorter, never a second view
            // swapped in. The first fold (2026-10-04) was an if/else between
            // the panel and a title-only view, and Caleb: "it feels like a
            // diff version of the tab is chunkily loading in, no smooth
            // transition". Now the frame closes over the content to the
            // title's line, the title never leaves the hierarchy, and the
            // body fades out first and back in after the card has started
            // to open (`SurfaceView` reads `hudFolded`).
            .frame(height: surface.compact ? Self.titleLine : nil, alignment: .top)
            .clipped()
            .environment(\.hudFolded, surface.compact)
            // A rail brings its own capsule and sits flush in its lane.
            .padding(.horizontal, isRail ? 0 : 16)
            .padding(.vertical, isRail ? 0 : 14)
            .frame(maxWidth: .infinity, alignment: isRail ? .center : .leading)
            .modifier(SurfaceChrome(
                chrome: surface.chrome, lit: lit, urgency: surface.urgency, ground: ground))
            // Measure what is under the card when it lands or moves, in
            // 24-point steps so a growing card does not capture every frame.
            .task(id: groundKey) {
                guard screenFrame.width > 0 else { return }
                try? await Task.sleep(for: .milliseconds(400))
                guard !Task.isCancelled else { return }
                ground = await BackdropSampler.shared.ground(under: screenFrame)
            }
            .overlay {
                if surface.compact {
                    FoldedTitle(title: title, onUnfold: onUnfold)
                        .transition(.opacity)
                }
            }
            .overlay(alignment: .topTrailing) {
                // The X stays 18 points to look at and is 44 to hit, and it
                // never vanishes entirely: a hover-only close is no close at
                // all without fine pointer control (bd_2026-Code-cnr). It
                // names what it closes, as a destructive action should.
                // A launcher rail is chrome, not a panel: it has no X, and
                // one peeked over its corner on the first screenshot.
                if !isRail {
                    CloseButton(
                        action: onDismiss, help: title.isEmpty ? "Close" : "Close \(title)",
                        hit: HitTarget.minimum)
                        .opacity(hovering ? 1 : 0.35)
                }
            }
            // The fold is a spring so a click mid-fold reverses from where
            // the card is; `snappy` is 0.28 s, settled by about 250 ms.
            .animation(Motion.snappy(reduced: reduceMotion), value: surface.compact)
            // No grow while dragged. It was a 1.02 scale, and any scale
            // that is not 1 resamples every glyph on the card: the text went
            // soft the moment a press moved four points (2026-09-22).
            .onHover { hovering = $0 }
            .animation(Motion.hover(reduced: reduceMotion), value: hovering)
            // Drag to move. The gesture sits on the whole card and is
            // `simultaneous` so it does not swallow taps on the controls inside:
            // a HUD you can rearrange is worth much more than one you cannot,
            // and a HUD whose buttons stopped working would be worth nothing.
            .simultaneousGesture(
                DragGesture(minimumDistance: 4, coordinateSpace: .global)
                    .onChanged { value in
                        let from = start ?? surface.drag
                        if start == nil {
                            start = from
                            onGrab()
                        }
                        // One to one with the hand. Every move bumps the
                        // model's revision, and the overlay springs every
                        // revision, so without this the card trailed the
                        // pointer by a 0.38 second spring: a panel on a
                        // rubber band (found 2026-09-22). Direct manipulation
                        // is never animated; only the release is.
                        var instant = Transaction()
                        instant.disablesAnimations = true
                        withTransaction(instant) {
                            onDrag(CGSize(
                                width: from.width + value.translation.width,
                                height: from.height + value.translation.height))
                        }
                    }
                    .onEnded { value in
                        let from = start ?? surface.drag
                        start = nil
                        // Carried a fifth of the way to where its speed was
                        // taking it: enough that a flick feels thrown, not
                        // so much that it flies off. Guessed, never measured.
                        let carry = 0.2
                        let thrown = CGSize(
                            width: value.translation.width
                                + (value.predictedEndTranslation.width - value.translation.width) * carry,
                            height: value.translation.height
                                + (value.predictedEndTranslation.height - value.translation.height) * carry)
                        withAnimation(Motion.smooth(reduced: reduceMotion)) {
                            onSettle(CGSize(
                                width: from.width + thrown.width,
                                height: from.height + thrown.height))
                        }
                    })
            .task {
                // The hairline strikes just after the card lands, so arriving
                // reads as powering on rather than appearing.
                try? await Task.sleep(for: .milliseconds(50))
                withAnimation(Motion.fade(0.28, reduced: reduceMotion)) { lit = true }
            }
            // Force dark regardless of the system appearance: a light HUD over a
            // dark desktop is a white rectangle, and there is no version of that
            // which looks like anything but a bug.
            .environment(\.colorScheme, .dark)
    }
}

/// The target over a surface folded to its title because its region ran
/// out of room.
///
/// The whole folded card is the target, 44 points tall, and a click opens it
/// back up; the region then folds whatever is now least recently used. It
/// draws no title of its own: the card's own title is still there, because
/// folding only shortens the card (see `SurfaceCard`). Just a chevron, left
/// of the close button, saying there is more.
struct FoldedTitle: View {
    let title: String
    let onUnfold: () -> Void

    var body: some View {
        Button(action: onUnfold) {
            Image(systemName: "chevron.down")
                .font(.system(size: 9, weight: .semibold))
                .foregroundStyle(HUD.accent.opacity(0.8))
                .padding(.trailing, HitTarget.minimum)
                .frame(
                    maxWidth: .infinity, maxHeight: .infinity,
                    alignment: .trailing)
                .frame(minHeight: HitTarget.minimum)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(title.isEmpty ? "Folded surface" : "\(title), folded")
        .accessibilityHint("Opens it")
    }
}

/// The three ways a surface can meet the screen.
///
/// Split out of `SurfaceCard` because it is the part that varies, and because a
/// `@ViewBuilder` switch over three chromes inside the card's own body put the
/// same exponential type-checking cost back that splitting `SurfaceView` had
/// just removed.
struct SurfaceChrome: ViewModifier {
    let chrome: Chrome
    let lit: Bool
    /// How thick the glass is and what pools in it. See `Urgency.thickness`.
    var urgency: Urgency = .normal
    /// How light the screen under the card measured, or nil. Thickens the
    /// wash over a light page. See `Urgency.wash(over:)`.
    var ground: Double?

    /// The wash's colour: a cool near-black rather than black, which over
    /// a busy screen reads as frosted glass and not as a grey hole. The
    /// blue-white of the OPAL desktop, pushed dark enough to hold text.
    static let frost = Color(red: 0.035, green: 0.055, blue: 0.10)

    func body(content: Content) -> some View {
        switch chrome {
        case .card: return AnyView(card(content))
        case .bare: return AnyView(bare(content))
        case .bracket: return AnyView(bracket(content))
        }
    }

    /// Glass, a lit rim, and its own pool of shadow.
    ///
    /// The recipe is Plynn's capsule, because that is the one on this machine
    /// people actually like. Three things make it, and only one of them is the
    /// blur: real Liquid Glass where the OS has it, a rim light that is bright
    /// along the top *and comes back* along the bottom, and a soft sheen across
    /// the upper half.
    ///
    /// The bottom half of that rim is the part worth copying. A border that
    /// only fades out reads as a decal; one that returns underneath reads as an
    /// edge with thickness behind it.
    ///
    /// The one number that does not carry over is the tint. The capsule is
    /// 168 points wide and tints black at 0.18, which is plenty at that size.
    /// A four-hundred-point card at 0.18 over a white document is the grey mud
    /// this project already shipped once, so the wash stays heavier here and
    /// the snapshot tests are what keep it honest.
    private func card(_ content: Content) -> some View {
        content
            // Before the slab, so the accent leans with the glass it is
            // printed on instead of hanging still above a tilted card.
            .overlay(alignment: .top) {
                // The accent, kept to a short segment rather than the full
                // width, so it reads as a light source and not as a rule.
                LinearGradient(
                    colors: [.clear, HUD.accent.opacity(0.9), .clear],
                    startPoint: .leading, endPoint: .trailing)
                    .frame(height: 1)
                    .padding(.horizontal, 28)
                    .opacity(lit ? 1 : 0)
            }
            .modifier(GlassSlab(
                shape: shape, glow: urgency.glow, rim: 0.73, thickness: urgency.thickness
            ) {
                ZStack {
                    VisualEffect(material: .hudWindow, blending: .behindWindow)
                    // 0.55 shipped; 0.41 was "25% more glassy" on 2026-09-19;
                    // 0.34 is "more translucent" on 2026-09-22, with the
                    // bevel and the outer hairline now holding the edge that
                    // the wash used to. Urgency moves it either side. The
                    // snapshot tests over a white ground are what say
                    // whether it is still a card.
                    SurfaceChrome.frost.opacity(urgency.wash(over: ground))
                        .animation(Motion.fade(0.3, reduced: false), value: ground)
                }
            })
    }

    /// The corner radius every surface shares.
    ///
    /// Named once so a card, a bracket and the command bar cannot drift apart,
    /// which is how a set of panels stops looking like one product.
    static let radius: CGFloat = 16

    private var shape: RoundedRectangle {
        RoundedRectangle(cornerRadius: SurfaceChrome.radius, style: .continuous)
    }

    /// Nothing behind it.
    ///
    /// The legibility problem a background solves has to be solved some other
    /// way, and the way is a halo: two black shadows on the content itself. A
    /// shadow follows the alpha of what it is applied to, so this darkens the
    /// screen in the shape of the glyphs and the strokes and nowhere else. A
    /// figure keeps its own outline instead of arriving inside a slab.
    private func bare(_ content: Content) -> some View {
        content
            // Five passes, tight to wide. Three was not enough over a white
            // document: the tight ones draw the outline that separates a glyph
            // from the page, and the wide ones darken enough ground around the
            // figure that it stops competing with the text underneath it.
            //
            // This is the honest limit of doing it without reading the screen.
            // A real heads-up display measures the luminance behind itself and
            // flips its ink; doing that here means capturing what is below the
            // window, which costs a screen-recording permission that a panel
            // this small has no business asking for yet.
            // Two tight passes and nothing wide.
            //
            // Five stacked shadows out to a 22-point radius did hold contrast
            // and looked like a smudge: a grey cloud around the figure, with
            // the page still readable through it. Contrast is the drawing's own
            // job now (shapes fill near-black, free text carries a plate), so
            // this only has to draw the outline that keeps a bright stroke off
            // a bright background.
            // Three passes: an outline, a hold, and enough spread to pull a
            // title off a page of dense text.
            //
            // Two was right for a figure that carries its own fill and wrong
            // for a line of type, which has nothing behind it at all. A title
            // over a paragraph was legible only because I already knew what it
            // said.
            .shadow(color: .black.opacity(0.9), radius: 0.5)
            .shadow(color: .black.opacity(0.7), radius: 2)
            .shadow(color: .black.opacity(0.5), radius: 6)
    }

    /// Corner brackets, no fill.
    ///
    /// Marks a region rather than covering one, which is what the film's HUD
    /// does around anything it is paying attention to.
    private func bracket(_ content: Content) -> some View {
        content
            // A thin scrim rather than glass. Enough to hold contrast, not
            // enough to read as a window: the brackets are what marks the
            // region, and the fill only has to keep the text off the wallpaper.
            .background {
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .fill(.black.opacity(0.72))
                    .padding(-8)
            }
            .overlay { Brackets(lit: lit) }
    }
}

/// Four corner marks, drawn as one shape so they animate together.
struct Brackets: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let lit: Bool
    /// Nil takes the house accent, which is what a surface's chrome wants. A
    /// marker passes its own, so an outline that means "this is broken" is not
    /// drawn in the same colour as everything that means nothing in particular.
    var tint: Color?

    var body: some View {
        GeometryReader { proxy in
            let size = proxy.size
            let arm: CGFloat = 14
            Path { path in
                for corner in [
                    (CGPoint(x: 0, y: 0), CGSize(width: 1, height: 1)),
                    (CGPoint(x: size.width, y: 0), CGSize(width: -1, height: 1)),
                    (CGPoint(x: 0, y: size.height), CGSize(width: 1, height: -1)),
                    (CGPoint(x: size.width, y: size.height), CGSize(width: -1, height: -1)),
                ] {
                    let (origin, direction) = corner
                    path.move(to: CGPoint(x: origin.x + arm * direction.width, y: origin.y))
                    path.addLine(to: origin)
                    path.addLine(to: CGPoint(x: origin.x, y: origin.y + arm * direction.height))
                }
            }
            // Legible before the strike, brighter after it.
            //
            // At 0.3 a mark was nearly invisible until an async task raised it,
            // which is the same fragility that made markers render as nothing:
            // an appearance that depends on a side effect having fired. The
            // strike is now a flourish on top of something already readable
            // rather than the thing that makes it readable.
            .stroke((tint ?? HUD.accent).opacity(lit ? 1 : 0.75), lineWidth: 1.6)
            .shadow(color: (tint ?? HUD.accent).opacity(0.65), radius: 5)
        }
        .padding(-6)
        .animation(Motion.fade(0.5, reduced: reduceMotion), value: lit)
    }
}

/// Liquid Glass where the OS has it, a translucent material below.
///
/// macOS 26 added the real thing, and it is the reason Plynn's capsule looks
/// like an object rather than a rectangle with a blur behind it. Below 26 the
/// material reads close enough under the same rim light and sheen.
struct LiquidGlass: ViewModifier {
    let shape: RoundedRectangle
    /// The capsule's own number. A light surface passes white at the same
    /// opacity; the default keeps every dark call site as it was.
    var tint: Color = .black.opacity(0.18)
    /// The clear variant: the screen through the glass with only a lens on
    /// it, for the pill. The regular one frosts.
    var clear = false

    func body(content: Content) -> some View {
        // Compiled out below the macOS 26 SDK, not merely skipped at runtime.
        // `#available` guards execution; it does not stop the compiler from
        // needing the symbol, so this target did not build at all against the
        // 15.5 SDK that ships with the Command Line Tools. Xcode 26 carries
        // Swift 6.2, which is what the compiler check is standing in for.
        #if compiler(>=6.2)
        if #available(macOS 26, *) {
            content.glassEffect(
                clear ? .clear : .regular.tint(tint),
                in: shape)
        } else {
            content
        }
        #else
        content
        #endif
    }
}

/// The palette, in one place so a surface and its parts cannot drift apart.
public enum HUD {
    /// Cyan rather than the system accent, which could be anything the person
    /// picked and is usually wrong against a dark translucent card.
    public static let accent = Color(red: 0.42, green: 0.83, blue: 0.96)
    public static let ink = Color.white

    /// Secondary and tertiary text.
    ///
    /// `faint` was 0.38 white, which against this glass is under 3:1 and fails
    /// WCAG AA at the 10 and 11 point sizes it is actually used at. It was
    /// picked because it looked calm, which is not a contrast standard. Raised
    /// to values that clear 4.5:1 against the card's own wash; they still read
    /// as secondary because size and weight do that work too.
    public static let dim = Color.white.opacity(0.78)
    public static let faint = Color.white.opacity(0.62)
    /// The wash behind a card at normal urgency, for glass outside a card
    /// (the rail) to match it exactly.
    public static var cardWash: Double { Urgency.normal.wash }

    /// Warm colours for the two states that mean something, and the house cyan
    /// for everything else.
    ///
    /// Four named tones and no free-form colour prop. A model given a hex field
    /// will use it, and a dashboard whose panels each chose their own colour is
    /// harder to read than one drawn entirely in one.
    public static let good = Color(red: 0.45, green: 0.90, blue: 0.66)
    public static let warn = Color(red: 0.99, green: 0.79, blue: 0.36)
    public static let bad = Color(red: 1.00, green: 0.45, blue: 0.42)

    /// A shape for a tone, so meaning does not depend on colour alone.
    ///
    /// Differentiate Without Color is a real setting and colour-blindness is
    /// more common than it is designed for. Good, warn and bad differed only by
    /// hue, which made a red metric and a green one identical to a meaningful
    /// number of people.
    public static func symbol(_ name: String?) -> String? {
        switch name {
        case "good", "positive", "success": return "checkmark.circle.fill"
        case "warn", "warning": return "exclamationmark.triangle.fill"
        case "bad", "negative", "danger", "critical": return "xmark.octagon.fill"
        default: return nil
        }
    }

    /// A word for a tone, for anything that is read aloud rather than seen.
    public static func spoken(_ name: String?) -> String? {
        switch name {
        case "good", "positive", "success": return "good"
        case "warn", "warning": return "warning"
        case "bad", "negative", "danger", "critical": return "critical"
        default: return nil
        }
    }

    public static func tone(_ name: String?) -> Color {
        switch name {
        case "good", "positive", "success": return good
        case "warn", "warning": return warn
        case "bad", "negative", "danger", "critical": return bad
        default: return accent
        }
    }
}

struct CloseButton: View {
    let action: () -> Void
    /// What the X does here. A card is dismissed; the pill discards a
    /// transcript or stops a run, and the tooltip should say which.
    var help: String = "Dismiss"
    /// The square that takes the click. The circle stays 18; a surface card
    /// passes 44 so the target meets the floor without the mark growing.
    var hit: CGFloat = 18
    @State private var hovering = false

    public var body: some View {
        Button(action: action) {
            Image(systemName: "xmark")
                .font(.system(size: 9, weight: .bold))
                .foregroundStyle(.secondary)
                .frame(width: 18, height: 18)
                .background(.quaternary, in: Circle())
                .frame(width: hit, height: hit)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .opacity(hovering ? 1 : 0.75)
        .onHover { hovering = $0 }
        .help(help)
        .accessibilityLabel(help)
    }
}

/// Whether this view tree is being rasterised rather than shown on a screen.
///
/// `ImageRenderer` can draw SwiftUI but not AppKit: an `NSViewRepresentable`
/// has no window to sample and comes out as a red prohibition symbol. That
/// makes every surface built on real vibrancy unreviewable offscreen, which is
/// most of them, and being unreviewable is how a heads-up display ends up
/// shipping something nobody has looked at.
///
/// So the material has a SwiftUI stand-in for that case. It is not identical
/// and it is not pretending to be: it is close enough to judge contrast,
/// spacing and legibility, which are the things a snapshot is for.
struct HUDOffscreenKey: EnvironmentKey {
    static let defaultValue = false
}

extension EnvironmentValues {
    var hudOffscreen: Bool {
        get { self[HUDOffscreenKey.self] }
        set { self[HUDOffscreenKey.self] = newValue }
    }

    /// Whether the surface is folded to its title. The body fades on it; the
    /// title does not.
    var hudFolded: Bool {
        get { self[HUDFoldedKey.self] }
        set { self[HUDFoldedKey.self] = newValue }
    }
}

struct HUDFoldedKey: EnvironmentKey {
    static let defaultValue = false
}

struct VisualEffect: View {
    let material: NSVisualEffectView.Material
    let blending: NSVisualEffectView.BlendingMode
    /// Dark unless asked otherwise. The offscreen stand-in ignores this and
    /// follows the SwiftUI colour scheme instead, which is what a light
    /// surface sets alongside it.
    var appearance: NSAppearance.Name = .darkAqua

    @Environment(\.hudOffscreen) private var offscreen

    var body: some View {
        if offscreen {
            Rectangle().fill(.ultraThinMaterial)
        } else {
            Vibrancy(material: material, blending: blending, appearance: appearance)
        }
    }
}

/// The real thing: AppKit's own blur, sampling the desktop behind the window.
private struct Vibrancy: NSViewRepresentable {
    let material: NSVisualEffectView.Material
    let blending: NSVisualEffectView.BlendingMode
    var appearance: NSAppearance.Name = .darkAqua

    func makeNSView(context: Context) -> NSVisualEffectView {
        let view = NSVisualEffectView()
        // Pin the material. `.environment(\.colorScheme, .dark)` governs
        // SwiftUI only; an AppKit view keeps following the system appearance and
        // turns the glass white for anyone not in dark mode.
        view.appearance = NSAppearance(named: appearance)
        view.material = material
        view.blendingMode = blending
        view.state = .active
        return view
    }

    func updateNSView(_ view: NSVisualEffectView, context: Context) {
        view.appearance = NSAppearance(named: appearance)
        view.material = material
        view.blendingMode = blending
    }
}
