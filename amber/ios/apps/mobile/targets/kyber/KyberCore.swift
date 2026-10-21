import Foundation

// KYBER'S LOGIC, WITH NO UIKIT AND NO NETWORK.
//
// Everything here is a pure function so it can be compiled and run on a Mac
// with plain `swiftc` (scripts/kyberCoreTest.swift, run by scripts/kyber.test.mts).
// A keyboard extension cannot be unit tested any other way without a simulator
// and a hand enabling it in Settings, so whatever can be decided without a
// screen is decided here.

// MARK: - Answer text

enum KyberText {
    /// The chat answer carries `[[p:CONTACT_ID]]` markers where the app draws a
    /// tappable chip. Text inserted into somebody else's chat cannot carry a
    /// chip, so each marker becomes the person's name, and a marker for someone
    /// the answer never named is dropped rather than leaking an id.
    static func resolveMarkers(_ text: String, names: [String: String]) -> String {
        guard let re = try? NSRegularExpression(pattern: #"\[\[p:([^\]]+)\]\]"#) else { return text }
        let ns = text as NSString
        var out = ""
        var cursor = 0
        for m in re.matches(in: text, range: NSRange(location: 0, length: ns.length)) {
            out += ns.substring(with: NSRange(location: cursor, length: m.range.location - cursor))
            let id = ns.substring(with: m.range(at: 1))
            out += names[id] ?? ""
            cursor = m.range.location + m.range.length
        }
        out += ns.substring(from: cursor)
        // A dropped marker can leave "with  and" or a space before a comma.
        return out
            .replacingOccurrences(of: #"[ \t]{2,}"#, with: " ", options: .regularExpression)
            .replacingOccurrences(of: #" ([,.;:!?])"#, with: "$1", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// Markdown the chat renders (bold, headers, bullets) arrives in a text
    /// field as literal asterisks. Strip it to what a person would type.
    static func plain(_ markdown: String) -> String {
        var s = markdown
        s = s.replacingOccurrences(of: #"\*\*([^*]+)\*\*"#, with: "$1", options: .regularExpression)
        s = s.replacingOccurrences(of: #"(?m)^#{1,6}\s*"#, with: "", options: .regularExpression)
        s = s.replacingOccurrences(of: #"(?m)^\s*[-*]\s+"#, with: "- ", options: .regularExpression)
        s = s.replacingOccurrences(of: #"\[([^\]]+)\]\((https?://[^)]+)\)"#, with: "$1 ($2)", options: .regularExpression)
        return s
    }
}

// MARK: - Server-sent events

/// One `event:` / `data:` frame from POST /v1/chat. Mirrors handleFrame in
/// lib/chat.ts so the keyboard and the app read the stream the same way.
struct SSEFrame: Equatable {
    let event: String
    let data: [String: Any]

    static func == (a: SSEFrame, b: SSEFrame) -> Bool {
        a.event == b.event && NSDictionary(dictionary: a.data).isEqual(to: b.data)
    }
}

struct SSEParser {
    private var buffer = ""

    /// Feed raw bytes as they arrive; get back every frame they completed.
    mutating func feed(_ chunk: String) -> [SSEFrame] {
        buffer += chunk.replacingOccurrences(of: "\r\n", with: "\n")
        var frames: [SSEFrame] = []
        while let range = buffer.range(of: "\n\n") {
            let raw = String(buffer[buffer.startIndex..<range.lowerBound])
            buffer.removeSubrange(buffer.startIndex..<range.upperBound)
            if let f = SSEParser.parse(raw) { frames.append(f) }
        }
        return frames
    }

    static func parse(_ raw: String) -> SSEFrame? {
        var event = ""
        var dataLines: [String] = []
        for line in raw.split(separator: "\n", omittingEmptySubsequences: false) {
            if line.hasPrefix(":") { continue }
            if line.hasPrefix("event:") { event = line.dropFirst(6).trimmingCharacters(in: .whitespaces) }
            else if line.hasPrefix("data:") { dataLines.append(String(line.dropFirst(5))) }
        }
        guard !event.isEmpty else { return nil }
        let joined = dataLines.joined(separator: "\n").trimmingCharacters(in: .whitespaces)
        if joined.isEmpty { return SSEFrame(event: event, data: [:]) }
        guard let d = joined.data(using: .utf8),
              let obj = try? JSONSerialization.jsonObject(with: d) as? [String: Any] else { return nil }
        return SSEFrame(event: event, data: obj)
    }
}

// MARK: - Session

enum KyberJWT {
    /// The access token's `exp`, or nil when it is not a JWT we can read.
    static func expiry(_ token: String) -> Date? {
        let parts = token.split(separator: ".")
        guard parts.count >= 2 else { return nil }
        var b64 = parts[1].replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        while b64.count % 4 != 0 { b64 += "=" }
        guard let data = Data(base64Encoded: b64),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let exp = obj["exp"] as? Double else { return nil }
        return Date(timeIntervalSince1970: exp)
    }

    /// Same 60 s skew as lib/sessionRefresh.ts. An unreadable token fails open
    /// (not expired), so a format we do not know is still tried.
    static func needsRefresh(_ token: String, now: Date = Date()) -> Bool {
        guard let exp = expiry(token) else { return false }
        return exp.timeIntervalSince(now) <= 60
    }
}

// MARK: - Free time

struct Busy: Equatable {
    let start: Date
    let end: Date
}

struct FreeWindow: Equatable {
    let start: Date
    let end: Date
    /// True when the window runs to the end of the waking day, which reads
    /// better as "after 7pm" than as "7–10pm".
    let openEnded: Bool
}

enum KyberFree {
    /// The waking day a group chat plans inside. Guessed, never measured: 9am
    /// to 10pm is when friends text "when are you free". Change it if a real
    /// person's day says otherwise.
    static let dayStartHour = 9
    static let dayEndHour = 22
    /// A gap shorter than this is not something you can offer a friend.
    static let minimumMinutes = 45

    static func windows(on day: Date, busy: [Busy], now: Date, calendar: Calendar = .current) -> [FreeWindow] {
        let startOfDay = calendar.startOfDay(for: day)
        guard let dayStart = calendar.date(byAdding: .hour, value: dayStartHour, to: startOfDay),
              let dayEnd = calendar.date(byAdding: .hour, value: dayEndHour, to: startOfDay) else { return [] }
        // Today starts at the next half hour, so "free 2–4" is never offered at 3:40.
        var cursor = max(dayStart, roundUpToHalfHour(now, calendar: calendar))
        guard cursor < dayEnd else { return [] }

        let blocks = busy
            .filter { $0.end > cursor && $0.start < dayEnd }
            .sorted { $0.start < $1.start }

        var out: [FreeWindow] = []
        for b in blocks {
            if b.start > cursor { append(&out, cursor, min(b.start, dayEnd), dayEnd) }
            cursor = max(cursor, b.end)
            if cursor >= dayEnd { break }
        }
        if cursor < dayEnd { append(&out, cursor, dayEnd, dayEnd) }
        return out
    }

    private static func append(_ out: inout [FreeWindow], _ s: Date, _ e: Date, _ dayEnd: Date) {
        guard e.timeIntervalSince(s) >= Double(minimumMinutes * 60) else { return }
        out.append(FreeWindow(start: s, end: e, openEnded: e >= dayEnd))
    }

    static func roundUpToHalfHour(_ d: Date, calendar: Calendar = .current) -> Date {
        let c = calendar.dateComponents([.year, .month, .day, .hour, .minute], from: d)
        let minute = c.minute ?? 0
        var base = calendar.date(from: DateComponents(year: c.year, month: c.month, day: c.day, hour: c.hour)) ?? d
        if minute == 0 && calendar.component(.second, from: d) == 0 { return base }
        base = base.addingTimeInterval(minute < 30 ? 1800 : 3600)
        return base
    }

    /// "3pm", "5:30pm". Times inside one range share a meridiem: "3–5:30pm".
    static func clock(_ d: Date, meridiem: Bool = true, calendar: Calendar = .current) -> String {
        let h = calendar.component(.hour, from: d)
        let m = calendar.component(.minute, from: d)
        let h12 = h % 12 == 0 ? 12 : h % 12
        let body = m == 0 ? "\(h12)" : String(format: "%d:%02d", h12, m)
        return meridiem ? body + (h < 12 ? "am" : "pm") : body
    }

    static func label(_ w: FreeWindow, calendar: Calendar = .current) -> String {
        if w.openEnded { return "after \(clock(w.start, calendar: calendar))" }
        let sameHalf = (calendar.component(.hour, from: w.start) < 12) == (calendar.component(.hour, from: w.end) < 12)
        return "\(clock(w.start, meridiem: !sameHalf, calendar: calendar))–\(clock(w.end, calendar: calendar))"
    }

    /// The line that goes into the chat: "I'm free today 3–5:30pm and after 7pm,
    /// tomorrow 9am–12pm."
    static func sentence(today: [FreeWindow], tomorrow: [FreeWindow], calendar: Calendar = .current) -> String {
        func join(_ ws: [FreeWindow]) -> String {
            let labels = ws.prefix(3).map { label($0, calendar: calendar) }
            if labels.count <= 1 { return labels.first ?? "" }
            return labels.dropLast().joined(separator: ", ") + " and " + labels.last!
        }
        var parts: [String] = []
        if !today.isEmpty { parts.append("today " + join(today)) }
        if !tomorrow.isEmpty { parts.append("tomorrow " + join(tomorrow)) }
        if parts.isEmpty { return "I'm booked up today and tomorrow, what about later this week?" }
        return "I'm free " + parts.joined(separator: ", ") + "."
    }
}

// MARK: - Split

struct SplitResult: Equatable {
    let total: Decimal
    let each: Decimal
    /// Cents that do not divide evenly, carried by the first `remainder` people.
    let remainderCents: Int
}

enum KyberSplit {
    /// Splits to the cent and says who pays the odd cents, because "$33.33
    /// each" on a $100 bill leaves somebody a penny short and the group chat
    /// always notices.
    static func split(amount: Decimal, people: Int, tipPercent: Int) -> SplitResult? {
        guard people >= 1, amount > 0 else { return nil }
        let tip = amount * Decimal(tipPercent) / 100
        let totalCents = NSDecimalNumber(decimal: (amount + tip) * 100)
            .rounding(accordingToBehavior: NSDecimalNumberHandler(roundingMode: .plain, scale: 0, raiseOnExactness: false, raiseOnOverflow: false, raiseOnUnderflow: false, raiseOnDivideByZero: false))
            .intValue
        let eachCents = totalCents / people
        return SplitResult(
            total: Decimal(totalCents) / 100,
            each: Decimal(eachCents) / 100,
            remainderCents: totalCents - eachCents * people
        )
    }

    static func money(_ d: Decimal) -> String {
        let f = NumberFormatter()
        f.numberStyle = .currency
        f.currencyCode = "USD"
        f.locale = Locale(identifier: "en_US")
        return f.string(from: NSDecimalNumber(decimal: d)) ?? "$\(d)"
    }

    static func sentence(_ r: SplitResult, people: Int, tipPercent: Int, what: String = "") -> String {
        let label = what.trimmingCharacters(in: .whitespaces)
        var s = label.isEmpty ? "" : "\(label): "
        s += "\(money(r.total)) total"
        if tipPercent > 0 { s += " with \(tipPercent)% tip" }
        s += ", \(money(r.each)) each (\(people) ways)"
        if r.remainderCents > 0 {
            s += r.remainderCents == 1 ? ", one of us covers the extra cent" : ", \(r.remainderCents) of us add a cent"
        }
        return s
    }
}

// MARK: - The circle graph, for intros

/// One edge of the bipartite person-circle graph: this contact is in this circle.
struct Membership: Equatable {
    let circleId: String
    let contactId: String
}

struct BridgeCandidate: Equatable {
    let contactId: String
    /// Circles the two already share. Zero means the intro creates an edge the
    /// graph does not have, which is the intro worth making.
    let sharedCircles: Int
    /// How many circles the candidate is in: a well-connected bridge first.
    let reach: Int
}

enum KyberGraph {
    /// Who to introduce `person` to, best first.
    ///
    /// An intro between two people who already sit in the same circle is an
    /// intro between people who probably know each other. The useful one closes
    /// a structural hole: someone from a different part of the graph. So the
    /// ranking walks person -> circles -> co-members and puts people with NO
    /// shared circle first, then fewest shared, then the ones in the most
    /// circles, then the order the caller gave (favorites order).
    static func bridges(for person: String, pool: [String], memberships: [Membership]) -> [BridgeCandidate] {
        var circlesOf: [String: Set<String>] = [:]
        for m in memberships { circlesOf[m.contactId, default: []].insert(m.circleId) }
        let mine = circlesOf[person] ?? []
        var seen = Set<String>()
        let ranked = pool.enumerated().compactMap { (i, id) -> (BridgeCandidate, Int)? in
            guard id != person, seen.insert(id).inserted else { return nil }
            let theirs = circlesOf[id] ?? []
            return (BridgeCandidate(contactId: id, sharedCircles: mine.intersection(theirs).count, reach: theirs.count), i)
        }
        return ranked.sorted { a, b in
            if a.0.sharedCircles != b.0.sharedCircles { return a.0.sharedCircles < b.0.sharedCircles }
            if a.0.reach != b.0.reach { return a.0.reach > b.0.reach }
            return a.1 < b.1
        }.map { $0.0 }
    }

    static func firstName(_ name: String) -> String {
        name.split(separator: " ").first.map(String.init) ?? name
    }

    /// The double-opt-in style intro most people actually send in a group chat.
    static func introSentence(_ a: (name: String, about: String?), _ b: (name: String, about: String?)) -> String {
        let fa = firstName(a.name), fb = firstName(b.name)
        var s = "\(fa), meet \(fb)"
        if let about = b.about, !about.isEmpty { s += " (\(about))" }
        s += ". \(fb), meet \(fa)"
        if let about = a.about, !about.isEmpty { s += " (\(about))" }
        s += ". I think you two should talk, I'll let you take it from here!"
        return s
    }
}

// MARK: - What /v1/reminders/parse saved

struct KSaved: Identifiable, Equatable {
    let id = UUID()
    let title: String
    /// Nil for an untimed reminder, which Amber shows on its day list.
    let when: Date?

    static func == (a: KSaved, b: KSaved) -> Bool { a.title == b.title && a.when == b.when }
}

enum KyberParse {
    static func iso(_ s: String) -> Date? {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = f.date(from: s) { return d }
        f.formatOptions = [.withInternetDateTime]
        return f.date(from: s)
    }

    /// The parse route SAVES what it finds: a timed item becomes a calendar
    /// event under `events` (title, startsAtISO, eventId), an untimed one a
    /// reminder row under `reminders` (title, fireAtISO, reminderId). Only an
    /// entry carrying its id was actually written. Kyber once read `reminders`
    /// alone and POSTed each again, which reported "nothing saved" for every
    /// timed reminder and doubled the untimed ones.
    static func savedItems(_ parsed: [String: Any]) -> [KSaved] {
        var out: [KSaved] = []
        for e in (parsed["events"] as? [[String: Any]]) ?? [] {
            guard e["eventId"] != nil, let title = (e["title"] as? String)?.trimmingCharacters(in: .whitespaces), !title.isEmpty,
                  let when = (e["startsAtISO"] as? String).flatMap(iso) else { continue }
            out.append(KSaved(title: title, when: when))
        }
        for r in (parsed["reminders"] as? [[String: Any]]) ?? [] {
            guard r["reminderId"] is String, let title = (r["title"] as? String)?.trimmingCharacters(in: .whitespaces), !title.isEmpty else { continue }
            out.append(KSaved(title: title, when: (r["fireAtISO"] as? String).flatMap(iso)))
        }
        return out
    }
}
