import Foundation
import simd

/// Where the rim's light goes in a state. See `LightRig`.
enum LightPath: Equatable {
    /// At rest in the two top corners, where the glass curves and a light
    /// above it would catch.
    case corners
    /// Gathered above the hyper bar, where the voice ripples leave from.
    case bar
    /// Circling the rim clockwise at the state's drift, `spread` laps apart:
    /// 0 is one light, a third is three evenly spaced.
    case orbit(spread: Double)
    /// Stopped where it was.
    case hold

    var spread: Double {
        if case .orbit(let spread) = self { return spread }
        return 0
    }

    var circles: Bool {
        if case .orbit = self { return true }
        return false
    }
}

/// The rim's light: three points of it, which draw as one wherever they meet.
///
/// Asked for on 2026-10-09: "make it creative and cohesive and fluid between
/// all actions". Before this the rim carried two lights that did not know
/// about each other, a studio light lapping at 0.15 of the drift and a streak
/// at 0.12; the streak went from one to three in a single frame halfway
/// through acting's ease; and the done sweep started from wherever the agent
/// had last been, which was no light anyone had been watching. Now every
/// state is the same light doing something, and every change between two
/// states is that light travelling from one to the other:
///
/// - listening: it rests in the two top corners.
/// - talking: it pours down both sides and gathers above the hyper bar.
/// - thinking: it leaves from wherever it was and circles the rim.
/// - acting: it splits into three, evenly spaced, still circling.
/// - done: the three close up into one, a ring leaves from where they met
///   (`PresenceFieldRenderer`'s sweep), and the one light glides on slowly.
/// - asking for you: it goes back to the corners, bright.
/// - failed: it slows to a stop where it is.
///
/// Every light follows its target on a critically damped spring, so it
/// arrives without overshooting and never turns round, and a target that
/// changes mid-flight bends the path instead of restarting it.
struct LightRig: Equatable {
    struct Slot: Equatable {
        /// Laps from the top-left corner, clockwise, unwrapped: 1.25 is a
        /// quarter of the way round on the second lap. Unwrapped so the
        /// spring always takes the way it was meant to, not the short way
        /// across the 0/1 seam.
        var pos: Double = 0
        /// Laps a second.
        var vel: Double = 0
    }

    private(set) var slots = [Slot](repeating: Slot(), count: 3)
    private(set) var targets: [Double] = [0, 0, 0]
    /// Each light's spring, set when it is aimed: `omega`, or softer for a
    /// long trip (see `topSpeed`).
    private var stiffness = [LightRig.omega, LightRig.omega, LightRig.omega]
    private(set) var path: LightPath?
    /// Where the orbit is, which the lights spring after.
    private var base: Double = 0
    /// How far apart the circling lights are, eased, so three part from one
    /// and close back into it rather than appearing.
    private(set) var spread: Double = 0
    private(set) var glow: Double = 0

    /// How stiff the spring is, per second. Critically damped, a light told
    /// to go somewhere is there in about 4 / omega, a little over half a
    /// second, which is the HUD's own budget for an arrival (hud/CLAUDE.md,
    /// "Frequent motion is short"). Guessed against that, never measured.
    static let omega = 7.0
    /// Parting into three and closing back into one. The rim's depth chases
    /// at 0.35; this is slower so the split reads as its own gesture.
    static let spreadTau = 0.45
    static let glowTau = 0.30
    /// Laps a second per unit of drift. 0.12 is the old streak's speed, so
    /// thinking (drift 3.2) still laps in about 2.6 s.
    static let lapsPerDrift = 0.12
    /// Slower than this, in laps a second, a light is at rest when it picks
    /// which way round to go: done's glide (0.04) counts as rest, acting's
    /// orbit (0.13) does not.
    static let still = 0.1
    /// A moving light carries on round to its spot rather than turning
    /// back, unless that is further than this. A glide from done to the top
    /// corners, carried forward, came out as most of a lap in half a second
    /// at a lap and a half a second: a light racing, not resting.
    static let furthestAhead = 0.6
    /// The fastest a light is sent anywhere, laps a second. A spring that
    /// settles in the same time over any distance is fast over a long one,
    /// so a long trip gets a softer spring instead. 0.8 is about the pour
    /// from a corner to the bar (0.35 of a lap at full stiffness peaks at
    /// 0.35 * 7 / e, 0.9). Worked out, not measured on screen.
    static let topSpeed = 0.8

    /// Where `path` keeps each light, in laps, or nil for a path that keeps
    /// them moving or where they are. `aspect` is width over height.
    static func anchors(for path: LightPath, aspect W: Double) -> [Double]? {
        let lap = 2 * W + 2
        switch path {
        case .corners:
            // Two at the top-right, one at the top-left: they meet and draw
            // as one, so it reads as a light in each corner. Set in along
            // the top edge, about 60 points on a 14 inch MacBook Pro: in the
            // corner itself the display's own rounded corner cut most of it
            // off, and a render had it at 142 over a band of 73 where a
            // person could see only the band.
            let inset = 0.012
            return [W / lap - inset, W / lap - inset, inset]
        case .bar:
            let bar = (W + 1 + 0.5 * W) / lap
            return [bar, bar, bar]
        case .orbit, .hold:
            return nil
        }
    }

    /// Every light where `path` keeps it, already there, for an arrival from
    /// nothing: the rim grows in with its light in place rather than the
    /// light flying in from wherever it was when the rim last went away.
    mutating func place(_ next: LightPath, glow shine: Double, aspect: Double) {
        if let at = Self.anchors(for: next, aspect: aspect) {
            for i in slots.indices { slots[i] = Slot(pos: at[i], vel: 0) }
        } else {
            for i in slots.indices { slots[i].vel = 0 }
        }
        targets = slots.map(\.pos)
        base = slots[0].pos
        spread = next.spread
        glow = shine
        path = next
    }

    /// One frame. `drift` is the eased drift, so the orbit speeds up and
    /// slows down with it rather than with the state.
    mutating func step(
        _ next: LightPath, glow shine: Double, drift: Double, aspect: Double, dt: Double
    ) {
        if next != path { aim(next, aspect: aspect) }
        guard dt > 0 else { return }
        spread += (next.spread - spread) * (1 - exp(-dt / Self.spreadTau))
        glow += (shine - glow) * (1 - exp(-dt / Self.glowTau))
        if next.circles {
            base += Self.lapsPerDrift * drift * dt
            for i in slots.indices { targets[i] = base + Self.offset(i, spread: spread) }
        }
        for i in slots.indices {
            slots[i] = Self.spring(slots[i], to: targets[i], omega: stiffness[i], dt: dt)
        }
        // Back to the first lap now and then, together, so a session left
        // up for days keeps its precision. Shifting every light and target
        // by the same whole number of laps changes nothing on screen.
        if base > 1_000 {
            let laps = base.rounded(.down)
            base -= laps
            for i in slots.indices { slots[i].pos -= laps; targets[i] -= laps }
        }
    }

    private mutating func aim(_ next: LightPath, aspect: Double) {
        let wasCircling = path?.circles ?? false
        path = next
        defer {
            for i in slots.indices {
                let trip = abs(targets[i] - slots[i].pos)
                stiffness[i] = next.circles
                    ? Self.omega
                    : min(Self.omega, exp(1) * Self.topSpeed / max(trip, 1e-6))
            }
        }
        switch next {
        case .orbit:
            guard !wasCircling else { return }
            // The orbit leaves from where the first light is, and each of
            // the others takes the short way to its place behind it.
            base = slots[0].pos
            for i in slots.indices {
                let place = base + Self.offset(i, spread: spread)
                slots[i].pos -= (slots[i].pos - place).rounded()
            }
        case .hold:
            for i in slots.indices { targets[i] = slots[i].pos + slots[i].vel / Self.omega }
        case .corners, .bar:
            guard let at = Self.anchors(for: next, aspect: aspect) else { return }
            for i in slots.indices { targets[i] = Self.reach(at[i], from: slots[i]) }
        }
    }

    /// Where light `i` sits in the orbit, in laps from the first: one ahead
    /// and one behind, so three part from one symmetrically and close back
    /// into it from both sides. At a third they are evenly spaced.
    static func offset(_ i: Int, spread: Double) -> Double {
        switch i {
        case 1: return spread
        case 2: return -spread
        default: return 0
        }
    }

    /// Which lap of `anchor` a light makes for. At rest, the nearest, which
    /// is what pours the corners' light down both sides to the bar and back.
    /// Moving, the first one ahead of where it would coast to, so a light
    /// slowing down to rest carries on round rather than turning back,
    /// unless that is more than `furthestAhead` away.
    static func reach(_ anchor: Double, from slot: Slot) -> Double {
        let nearest = anchor + (slot.pos - anchor).rounded()
        if abs(slot.vel) < still { return nearest }
        let coast = slot.pos + slot.vel / omega
        let ahead = slot.vel > 0
            ? anchor + (coast - anchor).rounded(.up)
            : anchor + (coast - anchor).rounded(.down)
        return abs(ahead - slot.pos) <= furthestAhead ? ahead : nearest
    }

    /// One frame of a critically damped spring toward `target`, solved
    /// exactly rather than stepped, so a long frame cannot overshoot.
    static func spring(_ slot: Slot, to target: Double, omega: Double, dt: Double) -> Slot {
        let x = slot.pos - target
        let k = slot.vel + omega * x
        let decay = exp(-omega * dt)
        return Slot(pos: target + (x + k * dt) * decay, vel: (slot.vel - omega * k * dt) * decay)
    }

    /// Nothing on its way anywhere: the view may park.
    func settled(glow shine: Double) -> Bool {
        guard let path, !path.circles else { return false }
        return abs(glow - shine) < 0.002 && abs(spread - path.spread) < 0.001
            && zip(slots, targets).allSatisfy { abs($0.vel) < 1e-4 && abs($0.pos - $1) < 1e-4 }
    }

    /// For the shader: where each light is in the lap, 0 to 1.
    var positions: SIMD4<Float> {
        SIMD4(
            Float(slots[0].pos - slots[0].pos.rounded(.down)),
            Float(slots[1].pos - slots[1].pos.rounded(.down)),
            Float(slots[2].pos - slots[2].pos.rounded(.down)), 0)
    }

    /// For the shader: laps a second, which sets each light's tail.
    var velocities: SIMD4<Float> {
        SIMD4(Float(slots[0].vel), Float(slots[1].vel), Float(slots[2].vel), 0)
    }
}
