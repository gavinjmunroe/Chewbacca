import AppKit
import SwiftUI
import Testing

@testable import KyberKit

/// The desktop home panel: its feed, its words, and the third-of-the-screen
/// promise ("this whole thing shouldnt take up more than 33% of my screen",
/// 2026-10-11). Set `HUD_SNAPSHOT_DIR` to keep the rendered PNG.
@Suite("Home")
@MainActor
struct HomeTests {
    /// The shape `bin/lib/home_feed.py` writes, microseconds and all.
    static let feedJSON = """
        {"at": "2026-10-11T10:02:20.197104-05:00",
         "calendar": [
           {"id": "event:a", "title": "Membership Class", "detail": "", "at": "2026-10-11T13:00:00-05:00",
            "end": "2026-10-11T15:00:00-05:00", "allDay": false},
           {"id": "day:2026-10-11", "title": "6 due", "detail": "SPAN 1412", "at": "2026-10-11T22:59:00-05:00",
            "end": "", "count": 6},
           {"id": "event:b", "title": "Call with Bill", "detail": "", "at": "2026-10-12T09:00:00-05:00",
            "end": "2026-10-12T09:30:00-05:00", "allDay": false}
         ],
         "todos": [
           {"id": "assignment:q6", "title": "SPAN 1412 Quiz, Ch. 6", "detail": "SPAN 1412", "day": "2026-10-11",
            "overdue": false},
           {"id": "task:r", "title": "Do Reagan's stuff", "detail": "Reminders", "day": "", "overdue": false},
           {"id": "backlog:1", "title": "GTM engineering for Jonah", "detail": "Backlog", "day": "2026-10-09",
            "overdue": true}
         ],
         "todoCount": 7,
         "people": [
           {"id": "person:finn", "title": "Finn", "detail": "you coming tonight?", "at": "2026-10-11T08:00:00-05:00",
            "known": true},
           {"id": "thread:imessage:+15550100", "title": "(555) 010-0000", "detail": "Following up on the quote",
            "at": "2026-10-08T12:00:00-05:00", "known": false}
         ],
         "peopleCount": 2,
         "projects": [
           {"id": "repo:/x/firm-foundation", "title": "Firm Foundation", "detail": "Fix the audit promise",
            "at": "2026-10-10T23:21:00-05:00", "path": "/x/firm-foundation"},
           {"id": "repo:/x/Chewbacca", "title": "Chewbacca", "detail": "Home panel on the desktop",
            "at": "2026-10-11T09:55:00-05:00", "path": "/x/Chewbacca"}
         ],
         "failed": ["calendar"]}
        """

    static var chicago: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "America/Chicago")!
        return calendar
    }

    static let now = HomeWords.date("2026-10-11T10:05:00-05:00")!

    @Test func decodesTheFeedTheDaemonWrites() throws {
        let feed = try HomeFeed.decode(Data(Self.feedJSON.utf8))
        #expect(feed.calendar.count == 3)
        #expect(feed.calendar[1].count == 6)
        #expect(feed.todoCount == 7)
        #expect(feed.todos[2].overdue)
        #expect(feed.people[1].known == false)
        #expect(feed.projects[0].path == "/x/firm-foundation")
        #expect(feed.failed == ["calendar"])
    }

    /// A feed from an older daemon, or one with a list missing, still draws.
    @Test func decodesAFeedWithKeysMissing() throws {
        let feed = try HomeFeed.decode(Data(#"{"todos": [{"id": "t", "title": "One"}]}"#.utf8))
        #expect(feed.calendar.isEmpty)
        #expect(feed.todoCount == 1)
        #expect(feed.todos[0].known)
        #expect(feed.todos[0].day.isEmpty)
    }

    /// Python's isoformat writes microseconds, which ISO8601DateFormatter
    /// refuses outright; a feed whose `at` would not parse would read as stale.
    @Test func readsPythonTimestamps() {
        #expect(HomeWords.date("2026-10-11T10:02:20.197104-05:00") != nil)
        #expect(HomeWords.date("2026-10-11T21:00:00Z") != nil)
        #expect(HomeWords.date("") == nil)
        #expect(HomeWords.date("not a date") == nil)
    }

    @Test func agesAreShort() {
        let now = Self.now
        #expect(HomeWords.age(now.addingTimeInterval(-20), now: now) == "now")
        #expect(HomeWords.age(now.addingTimeInterval(-25 * 60), now: now) == "25m")
        #expect(HomeWords.age(now.addingTimeInterval(-3 * 3600), now: now) == "3h")
        #expect(HomeWords.age(now.addingTimeInterval(-2 * 86_400), now: now) == "2d")
        #expect(HomeWords.age(now.addingTimeInterval(-21 * 86_400), now: now) == "3w")
        // A clock a little ahead of the feed never says a negative age.
        #expect(HomeWords.age(now.addingTimeInterval(30), now: now) == "now")
    }

    /// Only what is close gets a countdown.
    @Test func untilIsOnlyForWhatIsClose() {
        let now = Self.now
        let soon = now.addingTimeInterval(25 * 60)
        #expect(HomeWords.until(start: soon, end: nil, now: now) == "in 25m")
        #expect(HomeWords.until(start: now.addingTimeInterval(3 * 3600), end: nil, now: now) == nil)
        let started = now.addingTimeInterval(-600)
        #expect(HomeWords.until(start: started, end: now.addingTimeInterval(600), now: now) == "now")
        #expect(HomeWords.until(start: started, end: now.addingTimeInterval(-60), now: now) == nil)
    }

    @Test func dueWords() {
        let calendar = Self.chicago
        let now = Self.now
        #expect(HomeWords.due(HomeRow(id: "a", title: "A", day: "2026-10-11"), now: now, calendar: calendar) == "today")
        #expect(HomeWords.due(HomeRow(id: "b", title: "B", day: "2026-10-12"), now: now, calendar: calendar) == "tomorrow")
        #expect(HomeWords.due(HomeRow(id: "c", title: "C", day: "2026-10-10"), now: now, calendar: calendar) == "late")
        #expect(HomeWords.due(HomeRow(id: "d", title: "D", overdue: true), now: now, calendar: calendar) == "late")
        #expect(HomeWords.due(HomeRow(id: "e", title: "E"), now: now, calendar: calendar).isEmpty)
    }

    /// Never more than a third of the width, nor a third of the area, on
    /// every screen shape it is likely to meet.
    @Test(arguments: [
        CGSize(width: 1512, height: 982),   // his MacBook Pro, 2026-10-11
        CGSize(width: 1440, height: 900),
        CGSize(width: 1280, height: 800),
        CGSize(width: 1024, height: 640),
        CGSize(width: 1920, height: 1080),
        CGSize(width: 2560, height: 1440),
        CGSize(width: 1080, height: 1920),  // a monitor turned on its side
    ])
    func staysInsideAThird(_ screen: CGSize) {
        let frame = CGRect(origin: .zero, size: screen)
        let visible = CGRect(x: 0, y: 70, width: screen.width, height: screen.height - 70 - 25)
        let limit = HomeLayout.limit(screen: frame, visible: visible)
        #expect(limit.width <= screen.width / 3 + 0.5)
        #expect(limit.width * limit.height <= screen.width * screen.height / 3 + 1)
        #expect(limit.height <= visible.height)
        #expect(limit.width > 0 && limit.height > 0)
    }

    static let laptop = HomeDisplay(
        frame: CGRect(x: 0, y: 0, width: 1512, height: 982),
        visible: CGRect(x: 0, y: 70, width: 1512, height: 982 - 70 - 33))
    /// A smaller display to the laptop's right.
    static let side = HomeDisplay(
        frame: CGRect(x: 1512, y: 0, width: 1280, height: 800),
        visible: CGRect(x: 1512, y: 0, width: 1280, height: 775))

    /// As tall as the content, so a quieter feed shrinks it again.
    @Test func followsTheContentDown() {
        let tall = HomeLayout.frame(content: 600, topLeft: nil, displays: [Self.laptop])
        let short = HomeLayout.frame(content: 240, topLeft: nil, displays: [Self.laptop])
        #expect(tall.height == 600)
        #expect(short.height == 240)
        #expect(tall.maxY == short.maxY)
    }

    /// Content past the limit is capped (and scrolls), never past a third.
    @Test func capsAtTheLimit() {
        let display = Self.laptop
        let limit = HomeLayout.limit(screen: display.frame, visible: display.visible)
        let frame = HomeLayout.frame(content: 5000, topLeft: nil, displays: [display])
        #expect(frame.height == limit.height)
        #expect(frame.width * frame.height <= display.frame.width * display.frame.height / 3 + 1)
    }

    /// Dragged to a smaller display, it takes that display's limit and stays
    /// wholly on it.
    @Test func usesTheDisplayItIsOn() {
        let corner = CGPoint(x: 2600, y: 700)
        let frame = HomeLayout.frame(content: 5000, topLeft: corner, displays: [Self.laptop, Self.side])
        let limit = HomeLayout.limit(screen: Self.side.frame, visible: Self.side.visible)
        #expect(frame.height == limit.height)
        #expect(Self.side.visible.contains(frame))
    }

    /// A corner saved near the bottom moves up rather than hanging off.
    @Test func staysOnTheDisplay() {
        let corner = CGPoint(x: 40, y: 200)
        let frame = HomeLayout.frame(content: 500, topLeft: corner, displays: [Self.laptop])
        #expect(Self.laptop.visible.contains(frame))
        #expect(frame.height == 500)
        #expect(frame.minX == 40)
    }

    /// A corner on a display that is gone goes back to the default.
    @Test func forgetsACornerOnAMissingDisplay() {
        let frame = HomeLayout.frame(content: 300, topLeft: CGPoint(x: 2600, y: 700), displays: [Self.laptop])
        let corner = HomeLayout.defaultTopLeft(visible: Self.laptop.visible)
        #expect(frame.minX == corner.x && frame.maxY == corner.y)
    }

    /// Drawn with a full feed, it is a real panel. Kept as a PNG when
    /// HUD_SNAPSHOT_DIR is set.
    @Test func renders() throws {
        let feed = try HomeFeed.decode(Data(Self.feedJSON.utf8))
        let limit = HomeLayout.limit(screen: Self.laptop.frame, visible: Self.laptop.visible)
        let view = HomeView(model: HomeModel(feed: feed, now: Self.now), width: limit.width, scrolls: false)
            .environment(\.hudOffscreen, true)
        let backed = ZStack(alignment: .topLeading) {
            LinearGradient(
                colors: [Color(red: 0.23, green: 0.30, blue: 0.22), Color(red: 0.62, green: 0.66, blue: 0.58)],
                startPoint: .topLeading, endPoint: .bottomTrailing)
            view.padding(24)
        }
        .frame(width: limit.width + 48)
        .fixedSize(horizontal: false, vertical: true)

        let renderer = ImageRenderer(content: backed)
        renderer.scale = 2
        let image = try #require(renderer.nsImage)
        #expect(image.size.height - 48 > 200)

        if let dir = ProcessInfo.processInfo.environment["HUD_SNAPSHOT_DIR"],
           let tiff = image.tiffRepresentation,
           let png = NSBitmapImageRep(data: tiff)?.representation(using: .png, properties: [:]) {
            let url = URL(fileURLWithPath: dir).appendingPathComponent("home.png")
            try? FileManager.default.createDirectory(
                at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            try png.write(to: url)
        }
    }
}
