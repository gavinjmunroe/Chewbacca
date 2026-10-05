import CoreGraphics
import Foundation

/// What the panel sends back up the socket.
///
/// The format is the mirror image of Kyber Lines and deliberately just as small.
/// An agent that can parse what it sent can parse what comes back, and a person
/// debugging this can read it in a terminal.
///
///     e <action> <componentId> [key=value ...]     a control was used
///     v <pointer> <json>                           a bound value changed
///     x                                            the panel was dismissed
///     h <json string>                              something was said to it
///     h <json string> via=typed                    something was typed to it
///     g <x> <y> <w> <h>                            a region was pointed at
///     ! <json string>                              something you sent was wrong
///     v! <json string>                             the display's version
///
/// Values echo the same encoding as inbound props, so `label="Send it"` means
/// the same thing in both directions.
public enum OutboundEvent: Sendable, Equatable {
    case action(name: String, component: ComponentID, payload: [String: JSON])
    case value(pointer: String, value: JSON)
    case dismissed
    /// A spoken request, wake word already removed. Always a quoted JSON string,
    /// never bare: an utterance has spaces in it and a listener splitting on
    /// whitespace would otherwise take the first word and drop the sentence.
    case heard(String)
    /// A request typed into the conversation panel rather than spoken. The
    /// same `h` line with `via=typed` after the string, so a listener that
    /// reads the string alone still gets the request, and one that reads
    /// the flag can answer in writing instead of out loud.
    case typed(String)
    /// A region of the screen the person pointed at, in points with a top-left
    /// origin. Deixis: this is what makes "what is this" mean something.
    case region(CGRect)
    /// Something pointed at while the talk key was held: the element under the
    /// pointer, or a dragged region, numbered as it is drawn on the glass.
    /// Backlog 117. `pt` and one JSON object, so a listener that does not know
    /// the line skips it whole.
    case pointed(PointedElement)
    /// The crop of a mark, once it is on disk: `pc` and one JSON object with
    /// the hold, the number and the path. Later than its `pt` by the time
    /// ScreenCaptureKit takes, so it carries the hold to be matched by.
    case cropped(hold: Int, number: Int, path: String)
    /// What happened when the agent asked to press a pointed element.
    case pressed(number: Int, outcome: PressOutcome)
    /// Something the sender got wrong.
    ///
    /// Nothing used to go back. A misspelled component, a dropped prop, a line
    /// that failed to parse: all of it was swallowed, and the sender saw
    /// success. That is the failure mode that makes every other bug here hard
    /// to find, because the first thing you learn is that silence means
    /// nothing at all.
    case problem(String)
    /// What this build is, so a client can tell before it relies on something.
    case version(String)
    /// The talk key went down or came up. Sent the moment it happens, before
    /// any words exist, so the bridge can stop talking while the person is
    /// still drawing breath rather than when their sentence arrives: "it
    /// keeps talking over me when I try to speak" (2026-09-20). A listener
    /// that does not know the line ignores it.
    case talkKey(down: Bool)
    /// A button on one row of a List, Table or Events was pressed.
    ///
    /// `e action <name> row=<id> surface=<surface>`, exactly: the contract
    /// with `bin/kyber-surfaces`, which reads the row as an opaque id (a
    /// graph node like `thread:abc123`) and the surface as the panel it
    /// opened. Both are bare unless they hold a space or a quote, then
    /// JSON-quoted. Not `.action`, whose second word is a component id and
    /// whose encoding quotes a colon.
    case rowAction(name: String, row: String, surface: String?)
    /// What the person typed into the conversation panel while it was
    /// addressed to a surface (`to`): `e action send row=<surface>
    /// surface=<surface> text="<json>"`. The socket hands it only to the
    /// client that drew that surface, never to every listener.
    case sendTo(surface: String, text: String)
    /// The person closed a surface with its X: `e closed <surface>
    /// surface=<surface>`, to its owner only, so a daemon stops redrawing
    /// it instead of bringing it back.
    case closed(surface: String)

    public var line: String {
        switch self {
        case .sendTo(let surface, let text):
            let name = OutboundEvent.opaque(surface)
            return "e action send row=\(name) surface=\(name) text=\(OutboundEvent.jsonString(text))"

        case .closed(let surface):
            let name = OutboundEvent.opaque(surface)
            return "e closed \(name) surface=\(name)"

        case .rowAction(let name, let row, let surface):
            var line = "e action \(name) row=\(OutboundEvent.opaque(row))"
            if let surface { line += " surface=\(OutboundEvent.opaque(surface))" }
            return line

        case .action(let name, let component, let payload):
            let props = payload
                .sorted { $0.key < $1.key }
                .map { "\($0.key)=\(OutboundEvent.encode($0.value))" }
                .joined(separator: " ")
            return "e \(name) \(component)\(props.isEmpty ? "" : " " + props)"

        case .value(let pointer, let value):
            return "v \(pointer) \(OutboundEvent.encode(value))"

        case .dismissed:
            return "x"

        case .talkKey(let down):
            return down ? "k down" : "k up"

        case .heard(let text):
            return "h \(OutboundEvent.jsonString(text))"

        case .typed(let text):
            return "h \(OutboundEvent.jsonString(text)) via=typed"

        case .problem(let text):
            return "! \(OutboundEvent.jsonString(text))"

        case .version(let text):
            return "v! \(OutboundEvent.jsonString(text))"

        case .pointed(let element):
            return "pt \(element.json)"

        case .cropped(let hold, let number, let path):
            let object: [String: Any] = ["hold": hold, "n": number, "crop": path]
            let data = (try? JSONSerialization.data(
                withJSONObject: object, options: [.sortedKeys, .withoutEscapingSlashes])) ?? Data()
            return "pc \(String(decoding: data, as: UTF8.self))"

        case .pressed(let number, let outcome):
            if case .refused(let name) = outcome {
                return "pr \(number) refused name=\(OutboundEvent.jsonString(name))"
            }
            return "pr \(number) \(outcome.word)"

        case .region(let rect):
            // Whole points. Sub-pixel precision in a gesture made with a hand
            // is noise, and it makes the line harder to read in a terminal.
            return "g \(Int(rect.minX)) \(Int(rect.minY)) "
                + "\(Int(rect.width)) \(Int(rect.height))"
        }
    }

    /// Bare words stay bare, because quoting every enum value costs bytes and
    /// reads worse, and the inbound parser already accepts both.
    static func encode(_ value: JSON) -> String {
        switch value {
        case .string(let s):
            let bare = !s.isEmpty
                && s.allSatisfy { $0.isLetter || $0.isNumber || $0 == "-" || $0 == "_" }
                && !["true", "false", "null"].contains(s)
            return bare ? s : jsonString(s)
        case .number(let n):
            return n == n.rounded() && abs(n) < 1e15 ? String(Int(n)) : String(n)
        case .bool(let b): return b ? "true" : "false"
        case .null: return "null"
        case .array, .object:
            guard let data = try? JSONSerialization.data(withJSONObject: value.foundationValue),
                  let text = String(data: data, encoding: .utf8)
            else { return "null" }
            return text
        }
    }

    /// An id passed through untouched: bare unless it is empty or holds
    /// whitespace, a quote or a backslash, which would split or break the
    /// line, and JSON-quoted then.
    /// Whether a line must reach only the surface's owner and is dropped
    /// when there is none, rather than broadcast. A typed message and a
    /// close are both private: broadcast, hud-listen would hand "the user
    /// pressed send" with the message to its model as a fresh request.
    public static func isPrivate(_ line: String) -> Bool {
        line.hasPrefix("e action send ") || line.hasPrefix("e closed ")
    }

    /// The `surface=` a line names, unquoted, or nil.
    public static func surface(in line: String) -> String? {
        guard let range = line.range(of: " surface=") else { return nil }
        let rest = line[range.upperBound...]
        if rest.hasPrefix("\"") {
            let token = LineParser.tokenize(String(rest)).first ?? ""
            if case .string(let s)? = JSONDecoding.parse(token) { return s }
            return nil
        }
        return rest.split(separator: " ").first.map(String.init)
    }

    static func opaque(_ s: String) -> String {
        let unsafe = s.isEmpty || s.contains { $0.isWhitespace || $0 == "\"" || $0 == "\\" }
        return unsafe ? jsonString(s) : s
    }

    static func jsonString(_ s: String) -> String {
        guard let data = try? JSONSerialization.data(
            withJSONObject: s, options: [.fragmentsAllowed]),
              let text = String(data: data, encoding: .utf8)
        else { return "\"\"" }
        return text
    }
}

extension JSON {
    /// Back to Foundation types, for serialising arrays and objects.
    var foundationValue: Any {
        switch self {
        case .string(let s): return s
        case .number(let n): return n
        case .bool(let b): return b
        case .null: return NSNull()
        case .array(let a): return a.map(\.foundationValue)
        case .object(let o): return o.mapValues(\.foundationValue)
        }
    }
}
