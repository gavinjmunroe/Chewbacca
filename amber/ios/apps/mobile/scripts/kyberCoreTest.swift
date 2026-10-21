import Foundation

// Compiled together with targets/kyber/KyberCore.swift and run on the Mac by
// scripts/kyber.test.mts. Exit 1 on the first failed check.

var failures = 0
func check(_ ok: Bool, _ what: String, file: StaticString = #file, line: UInt = #line) {
    if !ok { failures += 1; print("FAIL line \(line): \(what)") }
}

var cal = Calendar(identifier: .gregorian)
cal.timeZone = TimeZone(identifier: "America/Los_Angeles")!
func at(_ day: Int, _ h: Int, _ m: Int = 0) -> Date {
    cal.date(from: DateComponents(year: 2026, month: 10, day: day, hour: h, minute: m))!
}

// Markers become names; unknown ids vanish without leaving a gap.
check(KyberText.resolveMarkers("Ask [[p:a1]] and [[p:b2]].", names: ["a1": "Jake Lin", "b2": "Semyon"]) == "Ask Jake Lin and Semyon.", "markers resolve")
check(KyberText.resolveMarkers("Talk to [[p:zz]], he knows.", names: [:]) == "Talk to, he knows.", "unknown marker dropped, no space before comma")
check(KyberText.plain("**Jake** knows\n## Why\n* robotics") == "Jake knows\nWhy\n- robotics", "markdown flattened")

// SSE frames split across chunks reassemble.
var parser = SSEParser()
check(parser.feed("event: token\ndata: {\"te").isEmpty, "partial frame waits")
let frames = parser.feed("xt\":\"hi\"}\n\n: ping\n\nevent: complete\ndata: {}\n\n")
check(frames.count == 2, "two frames, comment ignored (got \(frames.count))")
check(frames.first?.event == "token" && (frames.first?.data["text"] as? String) == "hi", "token payload")

// JWT expiry with the 60 s skew.
func jwt(exp: Double) -> String {
    let body = try! JSONSerialization.data(withJSONObject: ["exp": exp])
    let b64 = body.base64EncodedString().replacingOccurrences(of: "=", with: "").replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_")
    return "e30.\(b64).sig"
}
let now = Date(timeIntervalSince1970: 1_800_000_000)
check(KyberJWT.needsRefresh(jwt(exp: 1_800_000_030), now: now), "30 s left needs refresh")
check(!KyberJWT.needsRefresh(jwt(exp: 1_800_000_600), now: now), "10 min left is fine")
check(!KyberJWT.needsRefresh("not-a-jwt", now: now), "unreadable token fails open")

// Free windows: 2:10pm now, class 3-4:15, dinner 6:30-8.
let today = KyberFree.windows(on: at(5, 12), busy: [Busy(start: at(5, 15), end: at(5, 16, 15)), Busy(start: at(5, 18, 30), end: at(5, 20))], now: at(5, 14, 10), calendar: cal)
check(today.count == 2, "a 30-min gap before class is too short to offer (got \(today.count))")
check(today.map { KyberFree.label($0, calendar: cal) } == ["4:15–6:30pm", "after 8pm"], "labels: \(today.map { KyberFree.label($0, calendar: cal) })")
let tomorrow = KyberFree.windows(on: at(6, 12), busy: [Busy(start: at(6, 12), end: at(6, 22))], now: at(5, 14, 10), calendar: cal)
check(tomorrow.map { KyberFree.label($0, calendar: cal) } == ["9am–12pm"], "cross-meridiem label: \(tomorrow.map { KyberFree.label($0, calendar: cal) })")
check(KyberFree.sentence(today: today, tomorrow: tomorrow, calendar: cal) == "I'm free today 4:15–6:30pm and after 8pm, tomorrow 9am–12pm.", "sentence: \(KyberFree.sentence(today: today, tomorrow: tomorrow, calendar: cal))")
check(KyberFree.windows(on: at(5, 12), busy: [], now: at(5, 22, 30), calendar: cal).isEmpty, "nothing offered after the day ends")
check(KyberFree.sentence(today: [], tomorrow: [], calendar: cal).hasPrefix("I'm booked"), "empty sentence")

// Split to the cent.
let r = KyberSplit.split(amount: 100, people: 3, tipPercent: 0)!
check(r.each == Decimal(string: "33.33")! && r.remainderCents == 1, "100/3 leaves one cent")
check(KyberSplit.sentence(r, people: 3, tipPercent: 0) == "$100.00 total, $33.33 each (3 ways), one of us covers the extra cent", KyberSplit.sentence(r, people: 3, tipPercent: 0))
let t = KyberSplit.split(amount: 84, people: 4, tipPercent: 18)!
check(t.total == Decimal(string: "99.12")! && t.each == Decimal(string: "24.78")! && t.remainderCents == 0, "84 + 18% over 4")
check(KyberSplit.split(amount: 0, people: 2, tipPercent: 0) == nil, "zero amount refused")

// The bridge ranking walks person -> circle -> co-member.
let edges = [
    Membership(circleId: "work", contactId: "me-a"), Membership(circleId: "work", contactId: "colleague"),
    Membership(circleId: "church", contactId: "pastor"), Membership(circleId: "baseball", contactId: "pastor"),
    Membership(circleId: "church", contactId: "friend"),
]
let ranked = KyberGraph.bridges(for: "me-a", pool: ["colleague", "friend", "me-a", "pastor", "friend"], memberships: edges).map(\.contactId)
check(ranked == ["pastor", "friend", "colleague"], "bridges first, most-reached first, self and dupes removed: \(ranked)")
check(KyberGraph.introSentence(("Jake Lin", "runs an AI agency"), ("Semyon K", nil)) == "Jake, meet Semyon. Semyon, meet Jake (runs an AI agency). I think you two should talk, I'll let you take it from here!", "intro sentence")

// Remind reads both halves of the parse response, and only what was stored.
let parsed: [String: Any] = [
    "events": [["title": "Call mom", "startsAtISO": "2026-10-05T01:00:00.000Z", "eventId": "ev_1"],
               ["title": "Not stored", "startsAtISO": "2026-10-05T02:00:00Z"]],
    "reminders": [["title": "Find a deep work spot", "fireAtISO": NSNull(), "reminderId": "rem_1"],
                  ["title": "Unsaved", "fireAtISO": "2026-10-05T03:00:00Z", "reminderId": NSNull()]],
]
let savedNow = KyberParse.savedItems(parsed)
check(savedNow.map(\.title) == ["Call mom", "Find a deep work spot"], "timed event and untimed reminder both read, unsaved ones skipped: \(savedNow.map(\.title))")
check(savedNow.first?.when == KyberParse.iso("2026-10-05T01:00:00Z") && savedNow.last?.when == nil, "event time parsed, untimed has none")
check(KyberParse.savedItems(["reminders": []]).isEmpty, "empty response saves nothing")

if failures > 0 { print("\(failures) failed"); exit(1) }
print("kyber core: all checks passed")
