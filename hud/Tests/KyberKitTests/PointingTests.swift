import CoreGraphics
import Foundation
import Testing
@testable import KyberKit

/// Backlog 117, point and say. What can be checked without a screen: telling a
/// click from a drag, what goes up the socket, what the agent may press.
@Suite("Pointing")
struct PointingTests {
    @Test("a trackpad click that drifts a few points is still a click")
    func clickSlop() {
        let gesture = PointGesture.classify(from: CGPoint(x: 100, y: 100), to: CGPoint(x: 104, y: 97))
        #expect(gesture == .click(CGPoint(x: 100, y: 100)))
    }

    @Test("a drag up and to the left still makes a positive rectangle")
    func dragNormalised() {
        let gesture = PointGesture.classify(from: CGPoint(x: 300, y: 200), to: CGPoint(x: 100, y: 50))
        #expect(gesture == .drag(CGRect(x: 100, y: 50, width: 200, height: 150)))
    }

    @Test("between a click and a region is neither, so nothing is marked")
    func ambiguous() {
        #expect(PointGesture.classify(from: .zero, to: CGPoint(x: 10, y: 10)) == nil)
        #expect(PointGesture.classify(from: .zero, to: CGPoint(x: 200, y: 3)) == nil)
    }

    @Test("send, pay and delete stay the person's, on whole words only")
    func irreversible() {
        #expect(PressOutcome.refusal(for: ["Send"]) == .refused("Send"))
        #expect(PressOutcome.refusal(for: ["Delete message"]) == .refused("Delete message"))
        #expect(PressOutcome.refusal(for: ["Pay now"]) == .refused("Pay now"))
        #expect(PressOutcome.refusal(for: ["Move to Trash"]) == .refused("Move to Trash"))
        #expect(PressOutcome.refusal(for: ["Reply"]) == .refused("Reply"))
        #expect(PressOutcome.refusal(for: ["Sending options"]) == nil)
        #expect(PressOutcome.refusal(for: ["Open in new tab"]) == nil)
    }

    @Test("every label is read, so help text saying Send still refuses")
    func everyLabel() {
        #expect(PressOutcome.refusal(for: ["Done", "Send the message"]) == .refused("Send the message"))
    }

    @Test("an icon-only control is refused, because that is how Send is drawn")
    func unnamed() {
        #expect(PressOutcome.refusal(for: []) == .refused("an unnamed control"))
        #expect(PressOutcome.refusal(for: ["  "]) == .refused("an unnamed control"))
    }

    @Test("press parses one positive number and nothing else")
    func pressLine() throws {
        #expect(try LineParser.parse("press 2") == .press(number: 2, hold: nil))
        #expect(try LineParser.parse("press 2 hold=7") == .press(number: 2, hold: 7))
        #expect(throws: LineParseError.self) { try LineParser.parse("press 2 now") }
        #expect(throws: LineParseError.self) { try LineParser.parse("press") }
        #expect(throws: LineParseError.self) { try LineParser.parse("press 0") }
        #expect(throws: LineParseError.self) { try LineParser.parse("press two") }
    }

    @Test("a pointed element goes up as pt and one JSON object, empty fields left out")
    func pointedLine() throws {
        let element = PointedElement(
            number: 1, role: "AXButton", name: "Open", app: "Google Chrome",
            url: "https://example.com/a", frame: CGRect(x: 10.4, y: 20.6, width: 80, height: 24))
        let line = OutboundEvent.pointed(element).line
        #expect(line.hasPrefix("pt {"))
        let object = try #require(
            JSONSerialization.jsonObject(with: Data(line.dropFirst(3).utf8)) as? [String: Any])
        #expect(object["n"] as? Int == 1)
        #expect(object["name"] as? String == "Open")
        #expect(object["url"] as? String == "https://example.com/a")
        #expect(object["frame"] as? [Int] == [10, 21, 80, 24])
        #expect(object["crop"] == nil)
        #expect(object["dom_classes"] == nil)
    }

    @Test("a crop goes up on its own line, with the hold it belongs to")
    func croppedLine() {
        #expect(OutboundEvent.cropped(hold: 4, number: 2, path: "/tmp/p2.png").line
            == #"pc {"crop":"/tmp/p2.png","hold":4,"n":2}"#)
    }

    @MainActor
    @Test("a press naming an older hold is stale and presses nothing")
    func staleHold() {
        let store = PointedStore()
        store.begin()
        store.keep(1, element: nil, words: ["Open"], frame: .zero)
        #expect(store.press(1, hold: store.hold + 1).0 == .stale)
        #expect(store.press(1, hold: store.hold).0 == .failed)
        #expect(store.press(9, hold: nil).0 == .unknown)
    }

    @Test("a press reports its outcome, and a refusal names what it refused")
    func pressedLine() {
        #expect(OutboundEvent.pressed(number: 1, outcome: .pressed).line == "pr 1 pressed")
        #expect(OutboundEvent.pressed(number: 3, outcome: .unknown).line == "pr 3 unknown")
        #expect(OutboundEvent.pressed(number: 1, outcome: .stale).line == "pr 1 stale")
        #expect(OutboundEvent.pressed(number: 2, outcome: .refused("Send")).line
            == #"pr 2 refused name="Send""#)
    }
}
