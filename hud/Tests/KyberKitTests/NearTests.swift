import CoreGraphics
import Testing
@testable import KyberKit

/// A surface placed beside a rectangle on the screen: the Clay HUD's note,
/// which sits in the gutter next to the control being pressed and must never
/// cover it.
@Suite("Near placement")
struct NearTests {
    @Test("near and side parse")
    func parses() throws {
        let op = try LineParser.parse(#"@ clay-note near=100,200,80,30 side=left chrome=window w=300"#)
        guard case let .surface(id, _, width, _, chrome, _, near) = op else {
            Issue.record("not a surface: \(op)")
            return
        }
        #expect(id == "clay-note")
        #expect(width == 300)
        #expect(chrome == .window)
        #expect(near == Near(target: CGRect(x: 100, y: 200, width: 80, height: 30), side: .left))
    }

    @Test("side defaults to right")
    func defaultSide() throws {
        let op = try LineParser.parse("@ n near=1,2,3,4")
        guard case let .surface(_, _, _, _, _, _, near) = op else {
            Issue.record("not a surface: \(op)")
            return
        }
        #expect(near?.side == .right)
    }

    @Test("a bad near is ignored, not a crash", arguments: ["1,2,3", "a,b,c,d", "1,2,0,4", "1,2,3,-4"])
    func badNear(raw: String) throws {
        let op = try LineParser.parse("@ n near=\(raw)")
        guard case let .surface(_, _, _, _, _, _, near) = op else {
            Issue.record("not a surface: \(op)")
            return
        }
        #expect(near == nil)
    }

    let screen = CGRect(x: 18, y: 43, width: 1476, height: 900)
    let size = CGSize(width: 300, height: 140)

    @Test("right of the target when there is room")
    func right() {
        let point = OverlayModel.besideOrigin(
            target: CGRect(x: 400, y: 300, width: 120, height: 32), side: .right,
            size: size, bounds: screen, gap: 12)
        #expect(point == CGPoint(x: 532, y: 300))
    }

    @Test("flips left when the right edge would cut it off")
    func flips() {
        let target = CGRect(x: 1300, y: 300, width: 120, height: 32)
        let point = OverlayModel.besideOrigin(
            target: target, side: .right, size: size, bounds: screen, gap: 12)
        #expect(point.x == CGFloat(1300 - 12 - 300))
        #expect(!CGRect(origin: point, size: size).intersects(target))
    }

    @Test("goes below when neither side fits, and never covers the target")
    func below() {
        let wide = CGRect(x: 30, y: 200, width: 1440, height: 40)
        let point = OverlayModel.besideOrigin(
            target: wide, side: .right, size: size, bounds: screen, gap: 12)
        #expect(point.y == wide.maxY + 12)
        #expect(!CGRect(origin: point, size: size).intersects(wide))
    }

    @Test("goes above when neither side nor below fits")
    func above() {
        let wideLow = CGRect(x: 30, y: 820, width: 1440, height: 40)
        let point = OverlayModel.besideOrigin(
            target: wideLow, side: .right, size: size, bounds: screen, gap: 12)
        #expect(point.y == wideLow.minY - 12 - size.height)
        #expect(!CGRect(origin: point, size: size).intersects(wideLow))
    }

    @Test("clamped vertically inside the screen")
    func clamped() {
        let low = CGRect(x: 400, y: 900, width: 120, height: 32)
        let point = OverlayModel.besideOrigin(
            target: low, side: .right, size: size, bounds: screen, gap: 12)
        #expect(point.y + size.height <= screen.maxY)
    }
}

/// A bottom-centre surface (the Clay strip) sits above the hyper bar, never
/// under it.
@Suite("Bar lane")
struct BarLaneTests {
    @Test("reserves the pill's lift, its height and a gap; a hidden pill still reserves")
    func lane() {
        #expect(OverlayModel.barLane(pillHeight: 0)
            == PillView.pillLift + OverlayModel.pillReserve + OverlayModel.stackGap)
        #expect(OverlayModel.barLane(pillHeight: 60)
            == PillView.pillLift + 60 + OverlayModel.stackGap)
    }
}

/// Where clay-build expected a control and did not find it: red and dashed,
/// so it never reads as "this is it".
@Suite("Miss tone")
struct MissToneTests {
    @Test("tone=miss parses, reads as bad, and dashes")
    func miss() throws {
        let op = try LineParser.parse("m clay-target 10 20 80 30 tone=miss life=300")
        guard case let .mark(_, rect, _, tone, life) = op else {
            Issue.record("not a mark: \(op)")
            return
        }
        #expect(rect == CGRect(x: 10, y: 20, width: 80, height: 30))
        #expect(tone == "miss")
        #expect(life == 300)
        #expect(HUD.tone("miss") == HUD.bad)
        #expect(HUD.spoken("miss") == "expected here, not found")
        #expect(Marker.isDashed(tone: "miss"))
        #expect(!Marker.isDashed(tone: "bad"))
        #expect(!Marker.isDashed(tone: nil))
    }
}
