import Foundation
import Testing

@testable import KyberKit

/// The rim's one light, moved between states. "Make it creative and cohesive
/// and fluid between all actions" (2026-10-09) is checked here as numbers:
/// nothing jumps, nothing turns back, and each state ends where it says.
@Suite("Rim light")
struct RimLightTests {
    /// A MacBook Pro 14's 1512 by 982 points.
    static let aspect = 1512.0 / 982.0
    static let frame = 1.0 / 60

    /// Laps between two positions the short way round.
    static func apart(_ a: Double, _ b: Double) -> Double {
        let d = (a - b).truncatingRemainder(dividingBy: 1)
        return min(abs(d), 1 - abs(d))
    }

    /// Runs a state for `seconds`, easing the drift toward the state's the
    /// way the renderer does, and hands each frame's positions to `watch`.
    static func run(
        _ rig: inout LightRig, _ state: Presence, seconds: Double, drift: inout Double,
        watch: ([LightRig.Slot]) -> Void = { _ in }
    ) {
        let style = state.field
        for _ in 0..<Int(seconds / frame) {
            drift += (style.drift - drift) * (1 - exp(-frame / 0.5))
            rig.step(style.light, glow: style.glow, drift: drift, aspect: aspect, dt: frame)
            watch(rig.slots)
        }
    }

    static func listening() -> LightRig {
        var rig = LightRig()
        rig.place(.corners, glow: 0, aspect: aspect)
        return rig
    }

    @Test("listening rests in the two top corners and stops, so the view can park")
    func rests() {
        var rig = Self.listening()
        var drift = 0.5
        Self.run(&rig, .attentive, seconds: 2, drift: &drift)
        let corners = LightRig.anchors(for: .corners, aspect: Self.aspect) ?? []
        for (slot, corner) in zip(rig.slots, corners) {
            #expect(Self.apart(slot.pos, corner) < 1e-4)
        }
        #expect(rig.settled(glow: Presence.attentive.field.glow))
    }

    @Test("talking pours the light down both sides to the hyper bar, and back up")
    func pours() {
        var rig = Self.listening()
        var drift = 0.5
        var firstMoves: [Double]?
        Self.run(&rig, .hearing, seconds: 2, drift: &drift) { slots in
            if firstMoves == nil { firstMoves = slots.map(\.vel) }
        }
        // The top-right light goes clockwise, down the right side, and the
        // top-left one the other way, down the left.
        #expect((firstMoves?[0] ?? 0) > 0)
        #expect((firstMoves?[2] ?? 0) < 0)
        let bar = LightRig.anchors(for: .bar, aspect: Self.aspect)?[0] ?? -1
        for slot in rig.slots { #expect(Self.apart(slot.pos, bar) < 1e-3) }

        firstMoves = nil
        Self.run(&rig, .attentive, seconds: 3, drift: &drift) { slots in
            if firstMoves == nil { firstMoves = slots.map(\.vel) }
        }
        #expect((firstMoves?[0] ?? 0) < 0)
        #expect((firstMoves?[2] ?? 0) > 0)
        #expect(rig.settled(glow: Presence.attentive.field.glow))
    }

    @Test("thinking leaves from where the light was and laps in under three seconds")
    func circles() {
        var rig = Self.listening()
        var drift = 0.5
        Self.run(&rig, .hearing, seconds: 1.5, drift: &drift)
        let from = rig.slots[0].pos
        Self.run(&rig, .thinking, seconds: Self.frame, drift: &drift)
        #expect(Self.apart(rig.slots[0].pos, from) < 0.005)
        Self.run(&rig, .thinking, seconds: 3, drift: &drift)
        // 0.12 laps a second per unit of drift, at thinking's 3.2.
        #expect(abs(rig.slots[0].vel - 0.384) < 0.02)
        #expect(!rig.settled(glow: 1))
    }

    @Test("acting splits one light into three, evenly spaced, and done closes them up")
    func splits() {
        var rig = Self.listening()
        var drift = 0.5
        Self.run(&rig, .thinking, seconds: 2, drift: &drift)
        Self.run(&rig, .acting, seconds: 3, drift: &drift)
        let p = rig.slots.map(\.pos)
        #expect(abs(Self.apart(p[0], p[1]) - 1.0 / 3) < 0.01)
        #expect(abs(Self.apart(p[0], p[2]) - 1.0 / 3) < 0.01)
        #expect(abs(Self.apart(p[1], p[2]) - 1.0 / 3) < 0.01)

        Self.run(&rig, .done, seconds: 3, drift: &drift)
        let q = rig.slots.map(\.pos)
        #expect(Self.apart(q[0], q[1]) < 0.005)
        #expect(Self.apart(q[0], q[2]) < 0.005)
    }

    @Test("a light slowing to rest carries on round rather than turning back")
    func carriesOn() {
        var rig = Self.listening()
        var drift = 0.5
        Self.run(&rig, .thinking, seconds: 2, drift: &drift)
        // Only when its corner is within reach going forward; past that it
        // takes the short way, which `errand` covers.
        let corners = LightRig.anchors(for: .corners, aspect: Self.aspect) ?? []
        for (slot, corner) in zip(rig.slots, corners) {
            let coast = slot.pos + slot.vel / LightRig.omega
            let ahead = corner + (coast - corner).rounded(.up) - slot.pos
            #expect(ahead <= LightRig.furthestAhead, "set-up: a corner is \(ahead) laps ahead")
        }
        var last = rig.slots.map(\.pos)
        var backwards = 0
        Self.run(&rig, .attentive, seconds: 3, drift: &drift) { slots in
            for i in slots.indices where slots[i].pos < last[i] - 1e-9 { backwards += 1 }
            last = slots.map(\.pos)
        }
        #expect(backwards == 0)
        #expect(rig.settled(glow: Presence.attentive.field.glow))
    }

    @Test("failed stops the light where it is, without turning back")
    func stops() {
        var rig = Self.listening()
        var drift = 0.5
        Self.run(&rig, .thinking, seconds: 2, drift: &drift)
        let at = rig.slots[0].pos
        Self.run(&rig, .failed, seconds: 2, drift: &drift)
        #expect(rig.slots[0].pos >= at)
        // It coasts about a seventh of its speed further, a few percent of a lap.
        #expect(rig.slots[0].pos - at < 0.08)
        #expect(rig.settled(glow: 1))
    }

    /// The whole errand at sixty frames a second. The fastest a light should
    /// ever move is the pour to the bar, which peaks under a lap a second;
    /// a frame that moves one further than 0.03 of a lap (about 150 points)
    /// is a jump, not motion.
    @Test("a whole errand, listening to done and back, never jumps")
    func errand() {
        var rig = Self.listening()
        var drift = 0.5
        var last = rig.slots.map(\.pos)
        var worst = 0.0
        let watch: ([LightRig.Slot]) -> Void = { slots in
            // Round the rim, not in unwrapped laps: renumbering a light's
            // lap when the orbit starts moves nothing on screen.
            for i in slots.indices { worst = max(worst, Self.apart(slots[i].pos, last[i])) }
            last = slots.map(\.pos)
        }
        for (state, seconds) in [
            (Presence.attentive, 1.0), (.hearing, 1.2), (.thinking, 1.5), (.acting, 2.0),
            (.thinking, 0.6), (.acting, 1.0), (.done, 2.0), (.attentive, 2.0),
            (.attention, 1.0), (.hearing, 0.4), (.failed, 1.0),
        ] {
            Self.run(&rig, state, seconds: seconds, drift: &drift, watch: watch)
        }
        #expect(worst < 0.03, "a light moved \(worst) of a lap in one frame")
    }
}
