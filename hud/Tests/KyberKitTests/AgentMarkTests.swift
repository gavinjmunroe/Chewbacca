import CoreGraphics
import simd
import Testing
@testable import KyberKit

/// The agent's mark: a wireframe icosahedron while it acts, a stipple globe
/// when it is done. The geometry is checked here; the motion is a layer
/// keyframe animation and is looked at, not asserted.
@Suite("Agent mark")
struct AgentMarkTests {
    @Test("an icosahedron: 12 vertices, 30 edges, every edge the same length")
    func icosahedron() {
        let (vertices, edges) = Wireframe.icosahedron()
        #expect(vertices.count == 12)
        #expect(edges.count == 30)
        let lengths = edges.map { simd_distance(vertices[$0.0], vertices[$0.1]) }
        #expect(lengths.allSatisfy { abs($0 - 2) < 1e-9 })
    }

    @Test("every frame stays inside its box", arguments: [Wireframe.Kind.ico, .globe])
    func inside(kind: Wireframe.Kind) {
        let frames = Wireframe.frames(kind: kind, count: 12, size: 20)
        #expect(frames.count == 12)
        let box = CGRect(x: 0, y: 0, width: 20, height: 20).insetBy(dx: -0.5, dy: -0.5)
        for path in frames {
            #expect(box.contains(path.boundingBoxOfPath))
        }
    }

    @Test("frames differ, so the turn is visible")
    func turns() {
        let frames = Wireframe.frames(kind: .ico, count: 12, size: 20)
        #expect(frames[0] != frames[3])
    }

    @Test("the globe shows only its near side")
    func nearSide() {
        let all = Wireframe.globePoints(count: 220)
        #expect(all.count == 220)
        let shown = Wireframe.visible(all, turn: 0)
        #expect(shown.count > 80 && shown.count < 140)
    }

    @Test("Mark parses as a component")
    func parses() throws {
        let op = try LineParser.parse("c mk Mark kind=globe spin=true size=40")
        guard case let .component(node) = op else {
            Issue.record("not a component: \(op)")
            return
        }
        #expect(node.type == "Mark")
        #expect(node.props["kind"] == .literal(.string("globe")))
    }
}
