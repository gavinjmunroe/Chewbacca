import Foundation
import Testing

@testable import KyberKit

/// The event lines the display sends, against the shared fixture both sides
/// read (`tests/fixtures/hud-events.json`). This side checks Swift emits
/// exactly the recorded lines and can read its own values back;
/// `tests/test_hud_events.py` checks every Python reader gets the same values
/// out of those same lines. A row id or a typed message must never become a
/// second key or a second line.
@Suite("Event fixture")
struct EventFixtureTests {
    struct Case: Codable {
        var name: String
        var value: String
        var row_line: String?
        var send_line: String?
    }

    struct Fixture: Codable {
        var about: String
        var cases: [Case]
    }

    static let url = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent().deletingLastPathComponent()
        .deletingLastPathComponent().deletingLastPathComponent()
        .appendingPathComponent("tests/fixtures/hud-events.json")

    static func rowLine(_ value: String) -> String {
        OutboundEvent.rowAction(name: "reply", row: value, surface: "messages").line
    }

    static func sendLine(_ value: String) -> String {
        OutboundEvent.sendTo(surface: "s-abc", text: value).line
    }

    /// Swift's own reading of an event line: words, then key=value with
    /// each value one JSON token. Nil if anything is left over.
    static func fields(_ line: String) -> [String: JSON]? {
        var out: [String: JSON] = [:]
        for token in LineParser.tokenize(line) where token.contains("=") {
            guard let (key, raw) = LineParser.splitPair(token),
                  let value = JSONDecoding.parse(raw), out[key] == nil
            else { return nil }
            out[key] = value
        }
        return out
    }

    @Test("Swift emits exactly the recorded lines, and reads its own values back")
    func roundTrip() throws {
        var fixture = try JSONDecoder().decode(Fixture.self, from: Data(contentsOf: Self.url))
        if ProcessInfo.processInfo.environment["HUD_FIXTURE_RECORD"] == "1" {
            for i in fixture.cases.indices {
                fixture.cases[i].row_line = Self.rowLine(fixture.cases[i].value)
                fixture.cases[i].send_line = Self.sendLine(fixture.cases[i].value)
            }
            let encoder = JSONEncoder()
            encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
            try (encoder.encode(fixture) + Data("\n".utf8)).write(to: Self.url)
            return
        }
        for c in fixture.cases {
            let row = Self.rowLine(c.value)
            let send = Self.sendLine(c.value)
            #expect(row == c.row_line, "\(c.name)")
            #expect(send == c.send_line, "\(c.name)")
            for line in [row, send] {
                for breaker in ["\n", "\r", "\u{2028}", "\u{2029}", "\u{85}"] {
                    #expect(!line.contains(breaker), "\(c.name): a raw line break in \(line.debugDescription)")
                }
            }
            let rowFields = try #require(Self.fields(row), "\(c.name)")
            #expect(rowFields == ["row": .string(c.value), "surface": .string("messages")], "\(c.name)")
            let sendFields = try #require(Self.fields(send), "\(c.name)")
            #expect(sendFields == ["row": .string("s-abc"), "surface": .string("s-abc"),
                                   "text": .string(c.value)], "\(c.name)")
        }
    }

    /// The encoding before 2026-10-04, kept to show what the fixture catches:
    /// bare unless it held whitespace, a quote or a backslash.
    static func legacy(_ s: String) -> String {
        let risky = s.isEmpty || s.contains { $0.isWhitespace || $0 == "\"" || $0 == "\\" }
        guard risky else { return s }
        let data = (try? JSONSerialization.data(withJSONObject: s, options: [.fragmentsAllowed])) ?? Data()
        return String(decoding: data, as: UTF8.self)
    }

    @Test("the old encoding fails the fixture: an id of true or 42 came back as a bool or a number")
    func legacyFails() throws {
        let fixture = try JSONDecoder().decode(Fixture.self, from: Data(contentsOf: Self.url))
        let broken = fixture.cases.filter { c in
            let old = "e action reply row=\(Self.legacy(c.value)) surface=messages"
            return Self.fields(old)?["row"] != .string(c.value)
        }.map(\.name)
        #expect(broken.contains("word true"))
        #expect(broken.contains("number-looking"))
        #expect(broken.contains("plain graph id"), "a bare id was not even JSON")
    }

    @MainActor
    @Test("an action name that is not a word is refused, not sent")
    func unsafeActionRefused() {
        let store = SurfaceStore()
        store.surfaceID = "messages"
        var sent: [String] = []
        store.onEvent = { sent.append($0.line) }
        store.fireRow(#"reply surface="evil""#, row: "x")
        store.fire("go row=x", from: "b")
        #expect(sent.allSatisfy { $0.hasPrefix("! ") }, "\(sent)")
        #expect(sent.count == 2)
        #expect(OutboundEvent.word("a b=\"c\"") == "a_b__c_")
    }
}
