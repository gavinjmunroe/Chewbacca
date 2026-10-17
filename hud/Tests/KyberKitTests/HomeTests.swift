import AppKit
import SwiftUI
import Testing

@testable import KyberKit

/// The desktop home panel: its feed, its words, crossing to-dos off, and the
/// third-of-the-screen promise ("this whole thing shouldnt take up more than
/// 33% of my screen", 2026-10-11) however it is resized. Set
/// `HUD_SNAPSHOT_DIR` to keep the rendered PNG.
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
           {"id": "task:people:c", "title": "Ask Colby to edit the film", "detail": "for Colby Cluff", "day": "",
            "overdue": false, "person": "person:c"},
           {"id": "task:r", "title": "Do Reagan's stuff", "detail": "for Reagan Popoff", "day": "", "overdue": false,
            "person": "person:r", "agent": {"state": "drafted", "text": "yo whats left on ur end for the site",
            "why": "asks what he still needs", "to": "Reagan Popoff", "finishes": true}},
           {"id": "backlog:1", "title": "GTM engineering for Jonah", "detail": "Backlog", "day": "2026-10-09",
            "overdue": true},
           {"id": "task:bank", "title": "Call the bank", "detail": "", "day": "", "overdue": false,
            "done": true, "reopen": false}
         ],
         "todoCount": 7,
         "projects": [
           {"id": "project:Social media consult", "title": "Social media consult", "detail": "Round 3 ideas",
            "at": "2026-10-10T15:38:00-05:00", "path": "/x/oakley"},
           {"id": "project:Chewb", "title": "Chewb", "detail": "Home panel on the desktop",
            "at": "2026-10-11T09:55:00-05:00", "path": "/x/Chewbacca"},
           {"id": "project:Music prod agent", "title": "Music prod agent", "detail": "", "at": "",
            "path": "/x/loyola-studio"}
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
        #expect(feed.todos[3].overdue)
        #expect(feed.todos[4].done && !feed.todos[4].reopen)
        #expect(feed.todos[1].person == "person:c" && feed.todos[1].agent == nil)
        #expect(feed.todos[2].agent == HomeAgent(state: .drafted, text: "yo whats left on ur end for the site",
                                                 why: "asks what he still needs", to: "Reagan Popoff",
                                                 finishes: true))
        #expect(feed.projects[0].path == "/x/oakley")
        #expect(feed.failed == ["calendar"])
    }

    /// A feed from an older daemon, or one with a list missing, still draws.
    @Test func decodesAFeedWithKeysMissing() throws {
        let feed = try HomeFeed.decode(Data(#"{"todos": [{"id": "t", "title": "One"}]}"#.utf8))
        #expect(feed.calendar.isEmpty)
        #expect(feed.todoCount == 1)
        #expect(!feed.todos[0].done && feed.todos[0].reopen)
        #expect(feed.todos[0].day.isEmpty)
    }

    /// An agent state from a newer daemon draws as no state, never as a
    /// feed that fails to read.
    @Test func anUnknownAgentStateIsDropped() throws {
        let feed = try HomeFeed.decode(Data(
            #"{"todos": [{"id": "t", "title": "One", "person": "person:p", "agent": {"state": "thinking"}}]}"#.utf8))
        #expect(feed.todos[0].agent == nil && feed.todos[0].person == "person:p")
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

    /// Resized, it keeps his size, held inside the display's third, and the
    /// content no longer decides the height.
    @Test(arguments: [
        CGSize(width: 480, height: 640),
        CGSize(width: 2000, height: 2000),
        CGSize(width: 10, height: 10),
    ])
    func resizedStaysInsideAThird(_ asked: CGSize) {
        let display = Self.laptop
        let frame = HomeLayout.frame(content: 300, topLeft: nil, size: asked, displays: [display])
        #expect(frame.width <= display.frame.width / 3 + 0.5)
        #expect(frame.width * frame.height <= display.frame.width * display.frame.height / 3 + 1)
        #expect(frame.width >= HomeLayout.minimum.width && frame.height >= HomeLayout.minimum.height)
        #expect(display.visible.contains(frame))
    }

    @Test func resizedIsHisSize() {
        let frame = HomeLayout.frame(content: 300, topLeft: nil, size: CGSize(width: 420, height: 560),
                                     displays: [Self.laptop])
        #expect(frame.size == CGSize(width: 420, height: 560))
    }

    final class Calls { var made: [[String]] = [] }

    /// Crossing off strikes at once and waits before writing anything, so a
    /// second press inside the wait is a clean take-back, and a press left
    /// alone is written exactly once. That wait is the only undo a reminder
    /// has.
    @Test func crossingOffWaitsBeforeWriting() async throws {
        let open = HomeRow(id: "task:a", title: "A")
        let calls = Calls()
        let model = HomeModel(feed: HomeFeed(), now: Self.now, grace: .milliseconds(60)) { arguments, done in
            calls.made.append(arguments)
            done(0, "")
        }
        model.toggle(open)
        #expect(model.isDone(open))
        model.toggle(open)
        #expect(!model.isDone(open))
        try await Task.sleep(for: .milliseconds(250))
        #expect(calls.made.isEmpty)

        model.toggle(open)
        try await Task.sleep(for: .milliseconds(250))
        #expect(calls.made == [["home", "--done", "task:a"]])
        #expect(model.pending.isEmpty && model.notice == nil)
    }

    /// A refused write says why on the panel, and so does a Kyber that cannot
    /// find kyber-surfaces, instead of leaving a row struck that nothing
    /// recorded.
    @Test func aRefusedCrossOffSaysSo() async throws {
        let row = HomeRow(id: "task:b", title: "B", done: true, reopen: true)
        let model = HomeModel(feed: HomeFeed(), now: Self.now, grace: .milliseconds(10)) { _, done in
            done(2, "No deliverable named 'B' in span-1412.yml.\n")
        }
        model.toggle(row)
        try await Task.sleep(for: .milliseconds(100))
        #expect(model.notice == "No deliverable named 'B' in span-1412.yml.")
        #expect(model.isDone(row))

        let open = HomeRow(id: "task:c", title: "C")
        let lost = HomeModel(feed: HomeFeed(), now: Self.now, grace: .milliseconds(10))
        lost.toggle(open)
        try await Task.sleep(for: .milliseconds(100))
        #expect(!lost.isDone(open))
        #expect(lost.notice?.contains("kyber-surfaces") == true)
    }

    /// Handle, send and drop each run their one command, say so on the row
    /// while it runs, take no second press meanwhile, and say why on the
    /// panel when refused. Send only ever runs on its own press.
    @Test func agentPressesRunTheirCommands() async throws {
        let row = HomeRow(id: "task:r", title: "Do Reagan's stuff", person: "person:r")
        let calls = Calls()
        var finish: (@MainActor (Int32, String) -> Void)?
        let model = HomeModel(feed: HomeFeed(), now: Self.now) { arguments, done in
            calls.made.append(arguments)
            finish = done
        }
        model.handle(row)
        #expect(model.agentPress[row.id] == "starting")
        model.handle(row)
        model.send(row)
        #expect(calls.made == [["home", "--handle", "task:r"]])
        finish?(0, "")
        #expect(model.agentPress[row.id] == nil && model.notice == nil)

        model.send(row)
        #expect(model.agentPress[row.id] == "sending")
        finish?(2, "That draft is not in the queue any more. Press handle for a new one.\n")
        #expect(model.notice == "That draft is not in the queue any more. Press handle for a new one.")
        model.drop(row)
        finish?(0, "")
        #expect(calls.made == [["home", "--handle", "task:r"], ["home", "--send", "task:r"],
                               ["home", "--drop", "task:r"]])
        #expect(model.agentPress.isEmpty && model.notice == nil)
    }

    /// Typing a to-do runs `home --add` once with the words on one line, shows
    /// them as adding until it returns, and an empty field just closes.
    @Test func addingRunsItsCommand() async throws {
        let calls = Calls()
        var finish: (@MainActor (Int32, String) -> Void)?
        let model = HomeModel(feed: HomeFeed(), now: Self.now) { arguments, done in
            calls.made.append(arguments)
            finish = done
        }
        model.compose()
        model.add()
        #expect(!model.isComposing && calls.made.isEmpty)

        model.compose()
        model.draft = "  Pick up\n the suit "
        model.add()
        #expect(model.adding == "Pick up the suit" && !model.isComposing)
        model.compose()
        model.add()
        #expect(calls.made == [["home", "--add", "Pick up the suit"]])
        finish?(0, "")
        #expect(model.adding == nil && model.draft.isEmpty && model.notice == nil)
    }

    /// A refused add says why and gives the words back in an open field.
    @Test func aRefusedAddKeepsTheWords() {
        let model = HomeModel(feed: HomeFeed(), now: Self.now) { _, done in
            done(2, "Reminders access denied\n")
        }
        model.compose()
        model.draft = "Call the bank"
        model.add()
        #expect(model.notice == "Reminders access denied")
        #expect(model.isComposing && model.draft == "Call the bank" && model.adding == nil)
    }

    /// The panel takes the keys only while the field is open, so a press on
    /// it at any other time leaves them with the app he was in.
    @Test func takesTheKeysOnlyToType() {
        let model = HomeModel(feed: HomeFeed(), now: Self.now)
        let window = HomeWindow(model: model) { _, _ in }
        #expect(!window.canBecomeKey)
        model.compose()
        #expect(window.canBecomeKey)
        model.cancelCompose()
        #expect(!window.canBecomeKey)
    }

    /// Reminders can complete a reminder and never reopen one, so a row it
    /// finished cannot be put back from the panel.
    @Test func aRowItsAppFinishedStaysDone() {
        let finished = HomeRow(id: "task:r", title: "R", done: true, reopen: false)
        let model = HomeModel(feed: HomeFeed(), now: Self.now)
        #expect(!model.canToggle(finished))
        model.toggle(finished)
        #expect(model.isDone(finished))
        #expect(model.canToggle(HomeRow(id: "task:l", title: "L", done: true, reopen: true)))
    }

    @Test func headlineIsTheDay() {
        let line = HomeWords.dateLine(Self.now, calendar: Self.chicago)
        #expect(line.day == "Sunday")
        #expect(line.date.contains("11"))
    }

    /// The worst ground behind the panel's words, as sRGB: the tint over
    /// the blur of a white wallpaper. The blur alone over white is about
    /// 0.66, worked back from the glass's own measurement (Glass.swift,
    /// `wash(over:)`: this material under a 0.34 black wash over a white
    /// page came to L 0.12 to 0.16). Modelled from that, never measured on
    /// the panel itself.
    static let worstGround: Double = {
        let blurOverWhite = 0.66
        let tint = 26.0 / 255
        return HomeGlass.tintOpacity * tint + (1 - HomeGlass.tintOpacity) * blurOverWhite
    }()

    typealias RGB = (r: Double, g: Double, b: Double)

    /// A colour laid over a ground, alpha and all. A colour that will not
    /// convert is an issue, never a stand-in that passes.
    static func over(_ color: Color, _ ground: RGB) -> RGB {
        guard let c = NSColor(color).usingColorSpace(.sRGB) else {
            Issue.record("\(color) has no sRGB form")
            return ground
        }
        let a = Double(c.alphaComponent)
        return (a * Double(c.redComponent) + (1 - a) * ground.r,
                a * Double(c.greenComponent) + (1 - a) * ground.g,
                a * Double(c.blueComponent) + (1 - a) * ground.b)
    }

    static func contrast(_ ink: Color, on ground: RGB) -> Double {
        let drawn = over(ink, ground)
        let text = AgentPalette.luminance(drawn.r, drawn.g, drawn.b)
        let back = AgentPalette.luminance(ground.r, ground.g, ground.b)
        return (max(text, back) + 0.05) / (min(text, back) + 0.05)
    }

    /// Every colour a word is drawn in holds 4.5:1 on the glass over a white
    /// wallpaper, at rest and on a hovered row, a word on a prominent
    /// capsule holds it on the capsule, and the ring and grip hold the 3:1 a
    /// control needs.
    @Test func inkHoldsOnTheGlass() {
        let ground: RGB = (Self.worstGround, Self.worstGround, Self.worstGround)
        let hovered = Self.over(HomeInk.hover, ground)
        let words: [(String, Color)] = [
            ("primary", HomeInk.primary), ("secondary", HomeInk.secondary), ("bad", HomeInk.bad),
            ("warn", HUD.warn), ("good", HUD.good), ("accent", HUD.accent), ("running", HUD.running),
            ("needs you", HUD.needsYou),
        ]
        for (name, ink) in words {
            for (state, back) in [("at rest", ground), ("hovered", hovered)] {
                let ratio = Self.contrast(ink, on: back)
                #expect(ratio >= 4.5, "\(name) \(state): \(ratio)")
            }
        }
        for ink in [HUD.needsYou, HUD.accent] {
            let capsule = Self.over(ink.opacity(HomeVerb.tint), ground)
            let ratio = Self.contrast(ink, on: capsule)
            #expect(ratio >= 4.5, "\(ink) on its capsule: \(ratio)")
        }
        #expect(Self.contrast(HomeInk.control, on: ground) >= 3)
        // The opacity survives the trip to NSColor, or every ratio above is
        // for a word drawn opaque.
        let alpha = NSColor(HomeInk.secondary).usingColorSpace(.sRGB)?.alphaComponent ?? 1
        #expect(abs(alpha - 0.7) < 0.01)
    }

    /// On the desktop, under every app window, and it stays there.
    @Test func sitsOnTheDesktop() {
        let window = HomeWindow(model: HomeModel(feed: HomeFeed(), now: Self.now)) { _, _ in }
        #expect(window.level == HomeWindow.desktopLevel)
        #expect(window.level < .normal)
        #expect(window.collectionBehavior.contains(.stationary))
        #expect(window.collectionBehavior.contains(.canJoinAllSpaces))
        #expect(!window.canBecomeKey)
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
        try Self.keep(image, as: "home.png")

        // A to-do on its way to Reminders, where the field was.
        let adding = HomeModel(feed: feed, now: Self.now) { _, _ in }
        adding.compose()
        adding.draft = "Pick up the suit"
        adding.add()
        let pending = ImageRenderer(content: HomeView(model: adding, width: limit.width, scrolls: false)
            .environment(\.hudOffscreen, true).padding(24).background(Color(red: 0.3, green: 0.36, blue: 0.3))
            .frame(width: limit.width + 48).fixedSize(horizontal: false, vertical: true))
        pending.scale = 2
        try Self.keep(try #require(pending.nsImage), as: "home-adding.png")

        // Chosen lists, with nothing of Kyber's: shorter than all three.
        for (lists, name) in [([HomeSection.todos], "home-todos.png"),
                              ([HomeSection.todos, .projects], "home-todos-projects.png")] {
            let chosen = ImageRenderer(content: HomeView(
                model: HomeModel(feed: feed, now: Self.now), width: limit.width, scrolls: false, lists: lists)
                .environment(\.hudOffscreen, true).padding(24).background(Color(red: 0.3, green: 0.36, blue: 0.3))
                .frame(width: limit.width + 48).fixedSize(horizontal: false, vertical: true))
            chosen.scale = 2
            let drawn = try #require(chosen.nsImage)
            #expect(drawn.size.height > 100)
            #expect(drawn.size.height < image.size.height)
            try Self.keep(drawn, as: name)
        }
    }

    /// With some lists left off, the footer names a failed source only when
    /// a shown list is read from it.
    @Test func chosenListsNameOnlyTheirFailures() {
        let failed = ["calendar", "mail", "reminders", "whatsapp"]
        #expect(HomeView.shownFailures(failed, lists: [.todos]) == ["reminders"])
        #expect(HomeView.shownFailures(failed, lists: [.todos, .projects]) == ["reminders"])
        #expect(HomeView.shownFailures(failed, lists: [.projects]) == [])
        #expect(HomeView.shownFailures(failed, lists: [.calendar, .todos]) == ["calendar", "reminders"])
        #expect(HomeView.shownFailures(failed, lists: nil) == failed)
    }

    /// The default is read by name, so a renamed key would silently bring
    /// every list back; a misspelt or repeated name is left out.
    @Test func chosenListsAreAPerMacDefault() {
        #expect(HomeWindow.listsKey == "hud.home.lists")
        #expect(HomeWindow.lists(from: ["todos", "projects"]) == [.todos, .projects])
        #expect(HomeWindow.lists(from: ["projects", "todo", "projects", "todos"]) == [.projects, .todos])
        #expect(HomeWindow.lists(from: ["todo"]) == nil)
        #expect(HomeWindow.lists(from: []) == nil)
        #expect(HomeWindow.lists(from: nil) == nil)
        #expect(HomeView(model: HomeModel(feed: HomeFeed(), now: Self.now)).lists == nil)
        #expect(HomeView(model: HomeModel(feed: HomeFeed(), now: Self.now), lists: []).lists == nil)
        #expect(HomeView(model: HomeModel(feed: HomeFeed(), now: Self.now), lists: [.todos, .todos]).lists == [.todos])
        // A size dragged for three lists never opens on one, nor one
        // choice's size on another.
        #expect(HomeWindow.sizeKey(lists: nil) == "hud.home.size")
        #expect(HomeWindow.sizeKey(lists: [.todos]) == "hud.home.size.todos")
        #expect(HomeWindow.sizeKey(lists: [.todos, .projects]) == "hud.home.size.todos.projects")
    }

    /// The to-dos' plus is in the top strip, which is drawn before any feed
    /// is read. Pressed then, it took the keys with no field to type in, so
    /// it waits for the list.
    @Test func thePlusWaitsForTheList() {
        let reading = HomeView(model: HomeModel(path: URL(fileURLWithPath: "/dev/null/none"), refresher: nil),
                               lists: [.todos, .projects])
        #expect(reading.feed == nil)
        #expect(HomeView(model: HomeModel(feed: HomeFeed(), now: Self.now), lists: [.todos]).feed != nil)
    }

    static func keep(_ image: NSImage, as name: String) throws {
        if let dir = ProcessInfo.processInfo.environment["HUD_SNAPSHOT_DIR"],
           let tiff = image.tiffRepresentation,
           let png = NSBitmapImageRep(data: tiff)?.representation(using: .png, properties: [:]) {
            let url = URL(fileURLWithPath: dir).appendingPathComponent(name)
            try? FileManager.default.createDirectory(
                at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            try png.write(to: url)
        }
    }
}
