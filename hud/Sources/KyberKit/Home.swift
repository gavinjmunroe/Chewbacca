import AppKit
import Combine
import SwiftUI
import os

/// Kyber's home: a glass panel on the desktop with the day in three short
/// lists. What is on next, what to do, and his projects.
///
/// Asked for on 2026-10-11 to replace the battery and clock widgets: "calendar,
/// my to-dos, people to reach out to, the projects im currently working on,
/// all in a minimal way", in the Clay HUD's style but "more glassmorphic so it
/// blends in with my wallpaper", and never more than a third of the screen.
/// The same day's second pass took out the reach-out list, pinned his five
/// projects, set it in his own sites' type, made the mark alive, and let him
/// close it, drag it, resize it and cross to-dos off.
///
/// It sits on the desktop rather than on the glass: below every window, like
/// the widgets it replaces, so it is there when the windows are not and never
/// over work. The rows come from `~/.bob/home-panel.json`, which the surfaces
/// daemon writes after every ingest (`bin/lib/home_feed.py`); this file draws
/// them and sends a cross-off back as `kyber-surfaces home --done <id>`, and
/// a to-do typed on it as `kyber-surfaces home --add <text>`.
/// Only the mark moves while idle (HomeMark.swift).

// MARK: - The feed

/// One row, as `home_feed.py` writes it. Every field but the id and title
/// is optional, so a feed from an older daemon still draws.
public struct HomeRow: Decodable, Equatable, Identifiable, Sendable {
    public let id: String
    public let title: String
    public var detail = ""
    /// When it starts (calendar) or was last committed (projects). ISO 8601.
    public var at = ""
    public var end = ""
    /// The due day of a to-do, `YYYY-MM-DD`, or empty for an undated one.
    public var day = ""
    public var allDay = false
    public var overdue = false
    /// Events stacked into one row, as in "6 due".
    public var count = 0
    /// A project's checkout.
    public var path = ""
    /// A to-do crossed off today, drawn struck through.
    public var done = false
    /// Whether a crossed-off to-do can be put back from the panel: not once
    /// Reminders or the people store has it as finished.
    public var reopen = true
    /// Who a to-do is for, as a graph id, when the walk could tell: the rows
    /// the agent can be handed (bin/lib/home_agent.py).
    public var person = ""
    /// What the agent has done with it, if it was handed over.
    public var agent: HomeAgent?

    enum CodingKeys: String, CodingKey {
        case id, title, detail, at, end, day, allDay, overdue, count, path, done, reopen, person, agent
    }

    public init(id: String, title: String, detail: String = "", at: String = "", end: String = "",
                day: String = "", allDay: Bool = false, overdue: Bool = false, count: Int = 0,
                path: String = "", done: Bool = false, reopen: Bool = true, person: String = "",
                agent: HomeAgent? = nil) {
        self.id = id
        self.title = title
        self.detail = detail
        self.at = at
        self.end = end
        self.day = day
        self.allDay = allDay
        self.overdue = overdue
        self.count = count
        self.path = path
        self.done = done
        self.reopen = reopen
        self.person = person
        self.agent = agent
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        title = try c.decode(String.self, forKey: .title)
        detail = try c.decodeIfPresent(String.self, forKey: .detail) ?? ""
        at = try c.decodeIfPresent(String.self, forKey: .at) ?? ""
        end = try c.decodeIfPresent(String.self, forKey: .end) ?? ""
        day = try c.decodeIfPresent(String.self, forKey: .day) ?? ""
        allDay = try c.decodeIfPresent(Bool.self, forKey: .allDay) ?? false
        overdue = try c.decodeIfPresent(Bool.self, forKey: .overdue) ?? false
        count = try c.decodeIfPresent(Int.self, forKey: .count) ?? 0
        path = try c.decodeIfPresent(String.self, forKey: .path) ?? ""
        done = try c.decodeIfPresent(Bool.self, forKey: .done) ?? false
        reopen = try c.decodeIfPresent(Bool.self, forKey: .reopen) ?? true
        person = try c.decodeIfPresent(String.self, forKey: .person) ?? ""
        // An agent state this build does not know draws as nothing rather
        // than failing the whole feed.
        agent = try? c.decodeIfPresent(HomeAgent.self, forKey: .agent)
    }
}

/// A to-do handed to the agent: working on it, a text drafted and waiting
/// on his send, his to do (a payment, a call), or failed. The text is only
/// ever sent by his press on send.
public struct HomeAgent: Decodable, Equatable, Sendable {
    public enum State: String, Decodable, Sendable { case working, drafted, yours, failed }
    public let state: State
    public var text = ""
    public var why = ""
    /// Who the draft was queued for, as the run recorded it. The row's own
    /// "for <name>" is recomputed every pass and can name someone else.
    public var to = ""
    /// Send also crosses the to-do off, which Reminders and the people store
    /// cannot take back, so the press says so in its own word.
    public var finishes = false

    enum CodingKeys: String, CodingKey { case state, text, why, to, finishes }

    public init(state: State, text: String = "", why: String = "", to: String = "", finishes: Bool = false) {
        self.state = state
        self.text = text
        self.why = why
        self.to = to
        self.finishes = finishes
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        state = try c.decode(State.self, forKey: .state)
        text = try c.decodeIfPresent(String.self, forKey: .text) ?? ""
        why = try c.decodeIfPresent(String.self, forKey: .why) ?? ""
        to = try c.decodeIfPresent(String.self, forKey: .to) ?? ""
        finishes = (try? c.decodeIfPresent(Bool.self, forKey: .finishes)) ?? false
    }
}

public struct HomeFeed: Decodable, Equatable, Sendable {
    public var at = ""
    public var calendar: [HomeRow] = []
    /// Open to-dos first, then today's crossed-off ones.
    public var todos: [HomeRow] = []
    /// How many are still open, shown or not.
    public var todoCount = 0
    public var projects: [HomeRow] = []
    /// Sources the last ingest could not read, so an empty list is never
    /// mistaken for a clear day.
    public var failed: [String] = []

    enum CodingKeys: String, CodingKey {
        case at, calendar, todos, todoCount, projects, failed
    }

    public init() {}

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        at = try c.decodeIfPresent(String.self, forKey: .at) ?? ""
        calendar = try c.decodeIfPresent([HomeRow].self, forKey: .calendar) ?? []
        todos = try c.decodeIfPresent([HomeRow].self, forKey: .todos) ?? []
        todoCount = try c.decodeIfPresent(Int.self, forKey: .todoCount) ?? todos.filter { !$0.done }.count
        projects = try c.decodeIfPresent([HomeRow].self, forKey: .projects) ?? []
        failed = try c.decodeIfPresent([String].self, forKey: .failed) ?? []
    }

    public static func decode(_ data: Data) throws -> HomeFeed {
        try JSONDecoder().decode(HomeFeed.self, from: data)
    }
}

// MARK: - Words

/// How a row's times are worded. Worded here, at draw time, rather than in
/// the feed, so a feed written five minutes ago never says "in 5m" about
/// something that has started.
public enum HomeWords {
    /// Python's isoformat writes microseconds ("16:02:20.197104-06:00"),
    /// which ISO8601DateFormatter refuses, so the fraction is dropped first.
    public static func date(_ text: String) -> Date? {
        guard !text.isEmpty else { return nil }
        let whole = text.replacingOccurrences(
            of: #"\.\d+"#, with: "", options: .regularExpression)
        let parser = ISO8601DateFormatter()
        parser.formatOptions = [.withInternetDateTime]
        return parser.date(from: whole)
    }

    /// A due day, `YYYY-MM-DD`, at the start of that day where the person is.
    public static func day(_ text: String, calendar: Calendar = .current) -> Date? {
        let parts = text.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return nil }
        return calendar.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2]))
    }

    /// "1:00 PM", in the person's own clock style.
    public static func clock(_ date: Date, calendar: Calendar = .current) -> String {
        let format = DateFormatter()
        format.calendar = calendar
        format.timeZone = calendar.timeZone
        format.dateStyle = .none
        format.timeStyle = .short
        return format.string(from: date)
    }

    /// "now", "12m", "3h", "2d", "3w": how long something has been so.
    public static func age(_ date: Date, now: Date) -> String {
        let seconds = max(0, now.timeIntervalSince(date))
        switch seconds {
        case ..<60: return "now"
        case ..<3600: return "\(Int(seconds / 60))m"
        case ..<86_400: return "\(Int(seconds / 3600))h"
        case ..<(86_400 * 14): return "\(Int(seconds / 86_400))d"
        default: return "\(Int(seconds / (86_400 * 7)))w"
        }
    }

    /// Only for what is close: "now" while it runs, "in 25m" within the hour,
    /// nothing otherwise. A countdown on everything is noise.
    public static func until(start: Date, end: Date?, now: Date) -> String? {
        if start <= now { return (end.map { now < $0 } ?? true) ? "now" : nil }
        let minutes = Int(start.timeIntervalSince(now) / 60)
        return minutes < 60 ? "in \(max(1, minutes))m" : nil
    }

    /// "Today", "Tomorrow", a weekday this week, then "Oct 20".
    public static func dayName(_ date: Date, now: Date, calendar: Calendar = .current) -> String {
        let from = calendar.startOfDay(for: now)
        let to = calendar.startOfDay(for: date)
        let days = calendar.dateComponents([.day], from: from, to: to).day ?? 0
        if days == 0 { return "Today" }
        if days == 1 { return "Tomorrow" }
        let format = DateFormatter()
        format.calendar = calendar
        format.timeZone = calendar.timeZone
        format.setLocalizedDateFormatFromTemplate(days > 1 && days < 7 ? "EEE" : "MMMd")
        return format.string(from: date)
    }

    /// A to-do's due word: "late", then the day.
    public static func due(_ row: HomeRow, now: Date, calendar: Calendar = .current) -> String {
        if row.overdue { return "late" }
        guard let date = day(row.day, calendar: calendar) else { return "" }
        if calendar.startOfDay(for: date) < calendar.startOfDay(for: now) { return "late" }
        return dayName(date, now: now, calendar: calendar).lowercased()
    }

    /// "late" as "Late": a word drawn alone on the panel starts with a
    /// capital, as Apple sets a label. Only the first letter, so "in 25m"
    /// stays "In 25m" where `capitalized` would touch every word.
    public static func sentence(_ word: String) -> String {
        word.prefix(1).uppercased() + word.dropFirst()
    }

    /// "Sunday" and "October 11", the panel's headline.
    public static func dateLine(_ now: Date, calendar: Calendar = .current) -> (day: String, date: String) {
        let format = DateFormatter()
        format.calendar = calendar
        format.timeZone = calendar.timeZone
        format.setLocalizedDateFormatFromTemplate("EEEE")
        let day = format.string(from: now)
        format.setLocalizedDateFormatFromTemplate("MMMMd")
        return (day, format.string(from: now))
    }
}

// MARK: - Size

/// How big the panel may be on a screen: "this whole thing shouldnt take up
/// more than 33% of my screen" (2026-10-11), held as both a third of the
/// width and a third of the area, whichever is tighter, however it is
/// resized.
public enum HomeLayout {
    /// The column until he resizes it. At 14-point SF Pro about 35 letters
    /// fit beside a to-do's due word and longer titles take a second line.
    /// Guessed, never measured against use.
    public static let width: CGFloat = 340
    /// The smallest it can be dragged to: a short title with its due word on
    /// one line, and the top of two lists. Guessed.
    public static let minimum = CGSize(width: 260, height: 200)
    /// From the screen's usable edge, the menu bar and Dock already out.
    public static let margin: CGFloat = 24
    public static let shareOfScreen: CGFloat = 1.0 / 3.0

    /// The widest it may be on a display.
    public static func widest(screen: CGRect, visible: CGRect) -> CGFloat {
        max(0, min(floor(screen.width * shareOfScreen), visible.width - margin * 2))
    }

    /// The tallest it may be at this width: a third of the area, and on the
    /// usable part of the display.
    public static func tallest(width: CGFloat, screen: CGRect, visible: CGRect) -> CGFloat {
        let byArea = floor(screen.width * screen.height * shareOfScreen / max(width, 1))
        return max(0, min(byArea, visible.height - margin * 2))
    }

    /// The default column's limit on a display of this frame and usable
    /// (`visibleFrame`) area.
    public static func limit(screen: CGRect, visible: CGRect) -> CGSize {
        let width = min(Self.width, widest(screen: screen, visible: visible))
        return CGSize(width: width, height: tallest(width: width, screen: screen, visible: visible))
    }

    /// Where it goes with nothing remembered: the top left, where the widgets
    /// it replaces sat. Returned as the window's top-left corner.
    public static func defaultTopLeft(visible: CGRect) -> CGPoint {
        CGPoint(x: visible.minX + margin, y: visible.maxY - margin)
    }

    /// The window's frame, with its top-left corner where it was dragged to
    /// (nil for the default), on the display that corner is on, moved only as
    /// far as it takes to sit wholly on it. With no `size` it is the default
    /// width and as tall as the content; with one (he resized it) it is that
    /// size. Either way it is held inside that display's third. `displays`
    /// starts with the main one, which takes a corner on no display.
    public static func frame(content: CGFloat, topLeft: CGPoint?, size: CGSize? = nil,
                             displays: [HomeDisplay]) -> CGRect {
        guard let main = displays.first else { return .zero }
        let display = topLeft.flatMap { corner in
            displays.first { $0.visible.insetBy(dx: -1, dy: -1).contains(corner) }
        }
        let on = display ?? main
        let corner = display == nil ? defaultTopLeft(visible: on.visible) : topLeft ?? .zero
        let width = min(max(size?.width ?? Self.width, minimum.width), widest(screen: on.frame, visible: on.visible))
        let wanted = size.map { max($0.height, minimum.height) } ?? max(ceil(content), 1)
        let height = min(wanted, tallest(width: width, screen: on.frame, visible: on.visible))
        let left = min(max(corner.x, on.visible.minX), on.visible.maxX - width)
        let top = max(min(corner.y, on.visible.maxY), on.visible.minY + height)
        return CGRect(x: left, y: top - height, width: width, height: height)
    }
}

/// A display, as AppKit reports it: the whole frame and the part not under
/// the menu bar or the Dock.
public struct HomeDisplay: Equatable, Sendable {
    public var frame: CGRect
    public var visible: CGRect

    public init(frame: CGRect, visible: CGRect) {
        self.frame = frame
        self.visible = visible
    }
}

// MARK: - The model

@MainActor
public final class HomeModel: ObservableObject {
    public enum State: Equatable {
        case waiting
        case ready(HomeFeed)
        case unreadable
    }

    @Published public private(set) var state: State = .waiting
    /// Ticks once a minute so "in 25m" and "2d" stay true between feeds.
    @Published public private(set) var now = Date()
    /// To-dos crossed off or put back on the panel that the feed does not
    /// show yet: true crossed, false put back.
    @Published public private(set) var pending: [String: Bool] = [:]
    /// What a refused or failed cross-off said, shown under the lists until
    /// the next one.
    @Published public private(set) var notice: String?

    public static var defaultPath: URL {
        let bob = ProcessInfo.processInfo.environment["BOB_DIR"].map { URL(fileURLWithPath: $0) }
            ?? FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".bob")
        // Not home.json: that is the weather location quick.py reads.
        return bob.appendingPathComponent("home-panel.json")
    }

    /// A feed older than this says how old it is. The daemon writes every
    /// minute with a panel open and every five idle (INGEST_IDLE_S), so
    /// fifteen is three missed writes. Guessed, never measured.
    public static let staleAfter: TimeInterval = 15 * 60
    /// How often the file is looked at. A stat every few seconds costs
    /// nothing, and a finished reminder leaves within one daemon pass plus
    /// this. Guessed, never measured.
    static let checkEvery: TimeInterval = 5
    /// Past this age the panel asks for a feed itself, so it never depends
    /// on which surfaces daemon is running: on 2026-10-11 the live one was an
    /// older branch's build, started 2026-10-08, that writes no home feed.
    /// The daemon's idle pass is five minutes; this is one more.
    static let refreshAfter: TimeInterval = 6 * 60
    /// How long a cross-off waits before it is written anywhere, so a second
    /// press takes a misclick back with nothing to undo. Reminders can
    /// complete and never reopen, so this is the only undo it has. Guessed,
    /// never measured.
    static let graceAfter: Duration = .seconds(4)

    private let path: URL
    private let grace: Duration
    /// Runs `kyber-surfaces` for a cross-off; a test hands in its own.
    private let writer: ((_ arguments: [String], _ done: @escaping @MainActor (Int32, String) -> Void) -> Void)?
    /// Ids whose write is running, which a press waits out.
    private var writing: Set<String> = []
    private let refresher: URL?
    private var modified: Date?
    private var timer: Timer?
    private var lastTick = Date.distantPast
    private var isRefreshing = false
    private var lastRefresh = Date.distantPast
    private var waiting: [String: Task<Void, Never>] = [:]
    private static let log = Logger(subsystem: "kyber", category: "home")

    public init(path: URL = HomeModel.defaultPath, refresher: URL? = HomeModel.surfacesCommand) {
        self.path = path
        self.refresher = refresher
        grace = Self.graceAfter
        writer = nil
    }

    /// For tests and snapshots: a feed in hand, no file, and cross-offs
    /// handed to `writer` after `grace`.
    init(feed: HomeFeed, now: Date, grace: Duration = HomeModel.graceAfter,
         writer: ((_ arguments: [String], _ done: @escaping @MainActor (Int32, String) -> Void) -> Void)? = nil) {
        path = URL(fileURLWithPath: "/dev/null")
        refresher = nil
        state = .ready(feed)
        self.now = now
        self.grace = grace
        self.writer = writer
    }

    /// `kyber-surfaces` beside the hud-listen Kyber starts, so the panel's
    /// feed and the voice come from the same checkout.
    public static var surfacesCommand: URL? {
        let link = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".local/bin/hud-listen")
        let command = link.resolvingSymlinksInPath().deletingLastPathComponent()
            .appendingPathComponent("kyber-surfaces")
        return FileManager.default.isExecutableFile(atPath: command.path) ? command : nil
    }

    public func start() {
        reload(force: true)
        refreshIfStale()
        timer?.invalidate()
        timer = Timer.scheduledTimer(withTimeInterval: Self.checkEvery, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.tick() }
        }
    }

    public func stop() {
        timer?.invalidate()
        timer = nil
    }

    private func tick() {
        reload(force: false)
        refreshIfStale()
        let current = Date()
        if current.timeIntervalSince(lastTick) >= 60 {
            lastTick = current
            now = current
        }
    }

    /// `kyber-surfaces home --write`, at most once per `refreshAfter`, when
    /// the file is missing or older than that.
    private func refreshIfStale() {
        guard refresher != nil, !isRefreshing else { return }
        let age = modified.map { Date().timeIntervalSince($0) } ?? .infinity
        guard age > Self.refreshAfter, Date().timeIntervalSince(lastRefresh) > Self.refreshAfter else { return }
        isRefreshing = true
        lastRefresh = Date()
        surfaces(["home", "--write"]) { [weak self] status, _ in
            if status != 0 { Self.log.notice("home.refresh status=\(status, privacy: .public)") }
            self?.isRefreshing = false
        }
    }

    /// Runs `kyber-surfaces` with these arguments, then re-reads the feed it
    /// wrote and hands back the exit status and what it said on stderr.
    private func surfaces(_ arguments: [String], then: @escaping @MainActor (Int32, String) -> Void) {
        guard let refresher else { return then(127, "no kyber-surfaces") }
        let process = Process()
        let errors = Pipe()
        process.executableURL = refresher
        process.arguments = arguments
        process.standardOutput = FileHandle.nullDevice
        process.standardError = errors
        process.terminationHandler = { [weak self] done in
            let status = done.terminationStatus
            let said = String(decoding: errors.fileHandleForReading.readDataToEndOfFile(), as: UTF8.self)
            Task { @MainActor in
                then(status, said)
                self?.reload(force: true)
            }
        }
        do {
            try process.run()
        } catch {
            then(126, error.localizedDescription)
        }
    }

    func reload(force: Bool) {
        let stamp = (try? FileManager.default.attributesOfItem(atPath: path.path))?[.modificationDate] as? Date
        guard force || stamp != modified else { return }
        modified = stamp
        guard stamp != nil else {
            state = .waiting
            return
        }
        guard let data = try? Data(contentsOf: path), let feed = try? HomeFeed.decode(data) else {
            state = .unreadable
            return
        }
        now = Date()
        if case .ready(let shown) = state, shown == feed { return }
        state = .ready(feed)
    }

    // MARK: Crossing off

    public func isDone(_ row: HomeRow) -> Bool { pending[row.id] ?? row.done }

    /// Whether a press on the box does anything: not while its last press is
    /// being written, and a to-do Reminders or the people store has finished
    /// cannot be put back from here.
    public func canToggle(_ row: HomeRow) -> Bool {
        !writing.contains(row.id) && !(row.done && !row.reopen && pending[row.id] == nil)
    }

    /// Cross a to-do off, or put it back. It is struck through at once; the
    /// write waits out `graceAfter`, and a second press inside it cancels
    /// the write instead of undoing one.
    public func toggle(_ row: HomeRow) {
        guard canToggle(row) else { return }
        if !isDone(row) {
            pending[row.id] = true
            waiting[row.id]?.cancel()
            waiting[row.id] = Task { [weak self, grace] in
                try? await Task.sleep(for: grace)
                guard !Task.isCancelled else { return }
                self?.write(["home", "--done", row.id], for: row.id)
            }
        } else if let held = waiting[row.id] {
            held.cancel()
            waiting[row.id] = nil
            pending[row.id] = nil
        } else if row.done {
            pending[row.id] = false
            write(["home", "--undo", row.id], for: row.id)
        }
    }

    // MARK: The agent

    /// A press on the agent that is still running, by row: "starting",
    /// "sending" or "dropping". The row says so until the feed it rewrites
    /// is read back.
    @Published public private(set) var agentPress: [String: String] = [:]

    /// Hand a to-do for someone to the agent (`home --handle`), which drafts
    /// the text in the background; a failed run's retry is the same press.
    public func handle(_ row: HomeRow) { agent(["home", "--handle", row.id], for: row.id, saying: "starting") }

    /// Send the text the agent drafted. Only ever on this press: the agent
    /// itself can queue a draft and nothing more.
    public func send(_ row: HomeRow) { agent(["home", "--send", row.id], for: row.id, saying: "sending") }

    /// Throw the draft away, or clear an answer that said it is his to do.
    public func drop(_ row: HomeRow) { agent(["home", "--drop", row.id], for: row.id, saying: "dropping") }

    private func agent(_ arguments: [String], for id: String, saying word: String) {
        guard agentPress[id] == nil else { return }
        agentPress[id] = word
        let finish: @MainActor (Int32, String) -> Void = { [weak self] status, said in
            guard let self else { return }
            if status != 0 {
                Self.log.notice("home.agent status=\(status, privacy: .public) \(said, privacy: .private)")
                let line = said.split(whereSeparator: \.isNewline).first.map(String.init) ?? ""
                notice = line.isEmpty ? "The agent could not do that." : line
            } else {
                notice = nil
            }
            agentPress[id] = nil
        }
        if let writer {
            writer(arguments, finish)
        } else if refresher != nil {
            surfaces(arguments, then: finish)
        } else {
            finish(127, "Kyber could not find kyber-surfaces, so the agent was not asked.")
        }
    }

    // MARK: Adding

    /// The field for a new to-do is open.
    @Published public private(set) var isComposing = false
    /// What is typed in it. Kept when Reminders refuses, so nothing typed is
    /// lost to a failed write.
    @Published public var draft = ""
    /// A to-do on its way to Reminders, drawn faint where the field was until
    /// the feed it rewrites is read back.
    @Published public private(set) var adding: String?

    public func compose() {
        guard adding == nil else { return }
        isComposing = true
    }

    /// Escape, or a press away from an empty field.
    public func cancelCompose() {
        isComposing = false
        draft = ""
    }

    /// `home --add`: into Reminders, then back as a row. An empty field
    /// closes instead.
    public func add() {
        let words = draft.split(whereSeparator: \.isWhitespace).joined(separator: " ")
        guard adding == nil else { return }
        guard !words.isEmpty else { return cancelCompose() }
        isComposing = false
        adding = words
        let finish: @MainActor (Int32, String) -> Void = { [weak self] status, said in
            guard let self else { return }
            if status != 0 {
                Self.log.notice("home.add status=\(status, privacy: .public) \(said, privacy: .private)")
                let line = said.split(whereSeparator: \.isNewline).first.map(String.init) ?? ""
                notice = line.isEmpty ? "That to-do could not be added." : line
                isComposing = true
            } else {
                notice = nil
                draft = ""
            }
            adding = nil
        }
        if let writer {
            writer(["home", "--add", words], finish)
        } else if refresher != nil {
            surfaces(["home", "--add", words], then: finish)
        } else {
            finish(127, "Kyber could not find kyber-surfaces, so nothing was added.")
        }
    }

    private func write(_ arguments: [String], for id: String) {
        waiting[id] = nil
        let finish: @MainActor (Int32, String) -> Void = { [weak self] status, said in
            guard let self else { return }
            writing.remove(id)
            if status != 0 {
                Self.log.notice("home.cross status=\(status, privacy: .public) \(said, privacy: .private)")
                let line = said.split(whereSeparator: \.isNewline).first.map(String.init) ?? ""
                notice = line.isEmpty ? "That could not be crossed off." : line
            } else {
                notice = nil
            }
            // Written or refused, the feed now says which; drawn from it.
            pending[id] = nil
        }
        writing.insert(id)
        if let writer {
            writer(arguments, finish)
        } else if refresher != nil {
            surfaces(arguments, then: finish)
        } else {
            finish(127, "Kyber could not find kyber-surfaces, so nothing was crossed off.")
        }
    }
}

// MARK: - The view

/// Which list a row came from, which decides how its time is worded and what
/// a press does.
public enum HomeSection: String, CaseIterable, Sendable {
    case calendar, todos, projects

    var title: String {
        switch self {
        case .calendar: return "Calendar"
        case .todos: return "To-do"
        case .projects: return "Projects"
        }
    }

    /// What an empty list says. Never blank: an empty list and a list that
    /// failed to load must not look alike.
    var empty: String {
        switch self {
        case .calendar: return "Nothing else on today or tomorrow."
        case .todos: return "Nothing due."
        case .projects: return "No projects pinned and no commits of yours this week."
        }
    }

    /// The ingest sources the list is read from (`osgraph_ingest.INGESTERS`):
    /// events from Calendar and meetings; assignments, Reminders and
    /// people-store tasks, meeting promises and backlog rows for the to-dos.
    /// Projects are read from git, never from an ingest.
    var sources: Set<String> {
        switch self {
        case .calendar: return ["calendar", "meetings"]
        case .todos: return ["coursework", "reminders", "people", "meetings", "backlog"]
        case .projects: return []
        }
    }
}

/// A drag on the corner grip, in screen points from where it was pressed,
/// right and down positive.
public enum HomeResize: Equatable, Sendable {
    case began
    case changed(CGSize)
    case ended
    /// A double press: back to the default width and the content's height.
    case reset
}

public struct HomeView: View {
    @ObservedObject var model: HomeModel
    let width: CGFloat
    /// Off for a snapshot, which cannot draw inside a scroll view.
    let scrolls: Bool
    let onOpen: (HomeSection, HomeRow) -> Void
    /// The height the whole panel wants, title strip and all, measured from
    /// the content itself, so the window can shrink as well as grow.
    let onHeight: (CGFloat) -> Void
    let onClose: () -> Void
    let onResize: (HomeResize) -> Void
    /// The lists to show, in order, and nothing of Kyber's: no mark, no
    /// name, no date. Asked for 2026-10-17, first "i want just the to do
    /// panel on the creen, no extra kyber fluff", then "i want to-do, and
    /// current projects listed". Nil is the whole panel. Set per Mac by the
    /// `hud.home.lists` default, so a panel on any other Mac keeps all three.
    let lists: [HomeSection]?

    public init(model: HomeModel, width: CGFloat = HomeLayout.width, scrolls: Bool = true,
                lists: [HomeSection]? = nil,
                onOpen: @escaping (HomeSection, HomeRow) -> Void = { _, _ in },
                onHeight: @escaping (CGFloat) -> Void = { _ in },
                onClose: @escaping () -> Void = {},
                onResize: @escaping (HomeResize) -> Void = { _ in }) {
        self.model = model
        self.width = width
        self.scrolls = scrolls
        // Each list once: SwiftUI keys the lists by section.
        let picked = lists?.reduce(into: [HomeSection]()) { if !$0.contains($1) { $0.append($1) } }
        self.lists = picked?.isEmpty == true ? nil : picked
        self.onOpen = onOpen
        self.onHeight = onHeight
        self.onClose = onClose
        self.onResize = onResize
    }

    /// The same panel at another width.
    func with(width: CGFloat) -> HomeView {
        HomeView(model: model, width: width, scrolls: scrolls, lists: lists, onOpen: onOpen,
                 onHeight: onHeight, onClose: onClose, onResize: onResize)
    }

    /// The top strip, which the panel is dragged from. Taller when it holds
    /// the first list's own title.
    var stripHeight: CGFloat { lists == nil ? 36 : 48 }

    /// The failed sources the footer names. With some lists left off, a
    /// failed mailbox or calendar that none of the shown lists is read from
    /// says nothing about them.
    static func shownFailures(_ failed: [String], lists: [HomeSection]?) -> [String] {
        guard let lists else { return failed }
        let read = lists.reduce(into: Set<String>()) { $0.formUnion($1.sources) }
        return failed.filter(read.contains)
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if let first = lists?.first { listStrip(first) } else { titleStrip }
            // Past the display's limit the lists scroll, so the footer naming
            // a failed source is never the part cut off (hud/CLAUDE.md, motion
            // rule 7: as tall as its content, scrolling only past the cap).
            if scrolls {
                ScrollView(.vertical) { measured }
                    .scrollIndicators(.never)
                    .scrollBounceBehavior(.basedOnSize)
            } else {
                measured
            }
        }
        .frame(width: width, alignment: .topLeading)
        .frame(maxHeight: .infinity, alignment: .top)
        .background(HomeGlass())
        .overlay(alignment: .bottomTrailing) { HomeGrip(onResize: onResize) }
        .clipShape(RoundedRectangle(cornerRadius: HomeGlass.radius, style: .continuous))
        .overlay(HomeGlass.Rim())
        .onPreferenceChange(HomeHeight.self) { onHeight($0 + stripHeight) }
        .environment(\.colorScheme, .dark)
    }

    private var measured: some View {
        VStack(alignment: .leading, spacing: 18) {
            if lists == nil { headline }
            content
        }
        .padding(.horizontal, HomeGlass.inset)
        .padding(.top, lists == nil ? 2 : 0)
        .padding(.bottom, HomeGlass.inset)
        .frame(width: width, alignment: .topLeading)
        .background(GeometryReader { proxy in
            Color.clear.preference(key: HomeHeight.self, value: proxy.size.height)
        })
    }

    /// The mark and the name on the left, the close on the right, on the
    /// glass itself: no bar and no rule under it. The strip is where the
    /// panel is dragged from.
    private var titleStrip: some View {
        HStack(spacing: 7) {
            HomeMark(size: 16)
            Text("Kyber")
                .font(HomeType.section)
                .foregroundStyle(HomeInk.secondary)
            Spacer(minLength: 8)
            HomeClose(action: onClose)
        }
        .padding(.leading, HomeGlass.inset)
        .padding(.trailing, 4)
        .frame(height: stripHeight)
    }

    /// The feed, once one is read.
    var feed: HomeFeed? { if case .ready(let feed) = model.state { feed } else { nil } }

    /// With chosen lists: the first one's title, count and plus beside the
    /// close, and nothing of Kyber's. The to-dos' plus waits for the list,
    /// which holds the field it opens.
    private func listStrip(_ section: HomeSection) -> some View {
        HStack(spacing: 4) {
            HomeListHeader(section: section, rows: feed.map { rows(section, in: $0) } ?? [],
                           total: feed.flatMap { total(section, in: $0) }, model: model,
                           prominent: true, besideClose: true, addable: feed != nil)
            HomeClose(action: onClose)
        }
        .padding(.leading, HomeGlass.inset)
        .padding(.trailing, 4)
        .frame(height: stripHeight)
    }

    /// "Sunday  October 11": the day as a large title, the date beside it
    /// in the secondary label colour. When the pair is wider than the
    /// content, as a long weekday is at the smallest panel, the date goes
    /// under the day.
    private var headline: some View {
        let line = HomeWords.dateLine(model.now)
        let day = Text(line.day).font(HomeType.headline).foregroundStyle(HomeInk.primary)
        let date = Text(line.date).font(HomeType.date).foregroundStyle(HomeInk.secondary)
        return ViewThatFits(in: .horizontal) {
            HStack(alignment: .firstTextBaseline, spacing: 8) { day; date }
            VStack(alignment: .leading, spacing: 0) { day; date }
        }
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)
    }

    @ViewBuilder private var content: some View {
        switch model.state {
        case .waiting:
            note("Reading your day. The lists fill in after the next pass, about a minute.")
        case .unreadable:
            note("The home feed could not be read. It is rewritten on the next pass.")
        case .ready(let feed):
            // With chosen lists the first one's title is in the strip, and
            // every title is the large one, so no list reads as under another.
            VStack(alignment: .leading, spacing: 20) {
                ForEach(Array((lists ?? HomeSection.allCases).enumerated()), id: \.element) { index, section in
                    HomeList(section: section, rows: rows(section, in: feed), total: total(section, in: feed),
                             now: model.now, model: model, onOpen: onOpen,
                             titled: lists == nil || index > 0, prominent: lists != nil)
                }
                footer(feed)
            }
        }
    }

    /// A list's rows as drawn.
    private func rows(_ section: HomeSection, in feed: HomeFeed) -> [HomeRow] {
        switch section {
        case .calendar: return visibleEvents(feed.calendar)
        case .todos: return feed.todos
        case .projects: return feed.projects
        }
    }

    /// How many are open in all, for the one list capped below its total.
    private func total(_ section: HomeSection, in feed: HomeFeed) -> Int? {
        section == .todos ? feed.todoCount : nil
    }

    /// Events that ended since the feed was written are dropped here rather
    /// than waiting for the next pass.
    private func visibleEvents(_ rows: [HomeRow]) -> [HomeRow] {
        rows.filter { row in
            guard !row.allDay, let end = HomeWords.date(row.end) else { return true }
            return end > model.now
        }
    }

    @ViewBuilder private func footer(_ feed: HomeFeed) -> some View {
        let written = HomeWords.date(feed.at)
        let stale = written.map { model.now.timeIntervalSince($0) > HomeModel.staleAfter } ?? false
        let failed = Self.shownFailures(feed.failed, lists: lists)
        if !failed.isEmpty || stale || model.notice != nil {
            VStack(alignment: .leading, spacing: 3) {
                if let notice = model.notice {
                    Text(notice).foregroundStyle(HUD.warn)
                }
                if !failed.isEmpty {
                    Text("Not read: \(failed.map(\.capitalized).joined(separator: ", "))")
                }
                if stale, let written {
                    Text("Updated \(HomeWords.age(written, now: model.now)) ago")
                }
            }
            .font(HomeType.detail)
            .foregroundStyle(HomeInk.secondary)
        }
    }

    private func note(_ text: String) -> some View {
        Text(text)
            .font(HomeType.title)
            .foregroundStyle(HomeInk.secondary)
            .fixedSize(horizontal: false, vertical: true)
            .padding(.vertical, 4)
    }
}

private struct HomeHeight: PreferenceKey {
    static let defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) { value = max(value, nextValue()) }
}

/// The strip's X: hides the panel, which the menu's "Home on the desktop"
/// brings back. A close in a filled disc, as Apple draws a sheet's, always
/// there and brighter under the pointer (hud/CLAUDE.md: a close button stays
/// faintly visible).
struct HomeClose: View {
    let action: () -> Void
    @State private var hovered = false

    var body: some View {
        Button(action: action) {
            Image(systemName: "xmark")
                .font(.system(size: 9, weight: .bold))
                .foregroundStyle(hovered ? HomeInk.primary : HomeInk.secondary)
                .frame(width: 22, height: 22)
                .background(Circle().fill(hovered ? HomeInk.fillLit : HomeInk.fill))
                .frame(width: 36, height: 36)
                .contentShape(Rectangle())
        }
        .buttonStyle(HomePress())
        .onHover { hovered = $0 }
        .help("Hide the home panel. The Kyber menu's Home on the desktop brings it back.")
        .accessibilityLabel("Hide the home panel")
    }
}

/// A list's name, how many of its rows are open when not all are shown,
/// and for the to-dos the plus that adds one.
struct HomeListHeader: View {
    let section: HomeSection
    let rows: [HomeRow]
    /// How many are still open in all, when that is more than are shown.
    let total: Int?
    @ObservedObject var model: HomeModel
    /// A title as large as the panel's, when the panel shows chosen lists
    /// without Kyber's own, rather than one list's name among three.
    var prominent = false
    /// In the top strip, with the close beside it rather than the content's
    /// edge.
    var besideClose = false
    /// False until the list is drawn: the plus opens a field in the list, and
    /// pressed with no list it took the keys with nowhere to type.
    var addable = true

    var body: some View {
        // As a widget names a list: sentence case and no rule under it.
        // Semibold and secondary among three, large on chosen lists.
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            Text(section.title)
                .font(prominent ? HomeType.panelTitle : HomeType.section)
                .foregroundStyle(prominent ? HomeInk.primary : HomeInk.secondary)
                .accessibilityAddTraits(.isHeader)
            Spacer(minLength: 4)
            let shown = rows.filter { !$0.done }.count
            if let total, total > shown {
                Text("\(shown) of \(total)")
                    .font(HomeType.detail)
                    .monospacedDigit()
                    .foregroundStyle(HomeInk.secondary)
            }
            if section == .todos, addable, !model.isComposing, model.adding == nil {
                HomeVerb(word: "Add", symbol: "plus", tone: HUD.accent, help: "Add a to-do to Reminders") {
                    model.compose()
                }
                // The press area hangs past the header without making it
                // taller. In a list the plus sits on the content's edge; in
                // the strip, the close is beside it.
                .padding(.vertical, -8)
                .padding(.trailing, besideClose ? 0 : -10)
            }
        }
    }
}

/// One list, titled unless its name is already in the strip.
struct HomeList: View {
    let section: HomeSection
    let rows: [HomeRow]
    /// How many are still open in all, when that is more than are shown.
    let total: Int?
    let now: Date
    @ObservedObject var model: HomeModel
    let onOpen: (HomeSection, HomeRow) -> Void
    var titled = true
    var prominent = false

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            if titled {
                HomeListHeader(section: section, rows: rows, total: total, model: model, prominent: prominent)
                    .padding(.bottom, 4)
            }
            if section == .todos, model.isComposing || model.adding != nil {
                HomeAddRow(model: model)
            }
            if rows.isEmpty, !(section == .todos && (model.isComposing || model.adding != nil)) {
                Text(section.empty)
                    .font(HomeType.detail)
                    .foregroundStyle(HomeInk.secondary)
                    .padding(.vertical, 3)
            } else {
                // By position, not id: nothing here animates, and two rows
                // sharing an id would otherwise confuse the list.
                ForEach(Array(rows.enumerated()), id: \.offset) { index, row in
                    if section == .calendar, let header = dayHeader(index) {
                        Text(header)
                            .font(HomeType.label)
                            .foregroundStyle(HomeInk.secondary)
                            .padding(.top, 10)
                            .padding(.bottom, 2)
                    }
                    HomeRowView(section: section, row: row, now: now, model: model) { onOpen(section, row) }
                }
            }
        }
    }

    /// "Tomorrow" over the first event that is not today, so the times under
    /// it are not read as today's.
    private func dayHeader(_ index: Int) -> String? {
        guard let start = day(of: rows[index]) else { return nil }
        let name = HomeWords.dayName(start, now: now)
        if index == 0 { return name == "Today" ? nil : name }
        guard let previous = day(of: rows[index - 1]) else { return nil }
        return Calendar.current.isDate(previous, inSameDayAs: start) ? nil : name
    }

    /// The day a row is on: today for anything that began earlier and runs on.
    private func day(of row: HomeRow) -> Date? {
        HomeWords.date(row.at).map { max($0, now) }
    }
}

/// One row: a to-do's ring, an event's bar or a project's folder, the words,
/// and a time on the right. The words are the press; the ring crosses a
/// to-do off.
struct HomeRowView: View {
    let section: HomeSection
    let row: HomeRow
    let now: Date
    @ObservedObject var model: HomeModel
    let press: () -> Void
    @State private var hovered = false

    private var isDone: Bool { section == .todos && model.isDone(row) }

    /// The agent's verb sits at the end of a to-do for someone until it is
    /// pressed; after that the line under the row carries the state.
    private var offersHandle: Bool {
        section == .todos && !isDone && !row.person.isEmpty && row.agent == nil && model.agentPress[row.id] == nil
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            line
            if section == .todos, !isDone, model.agentPress[row.id] != nil || row.agent != nil {
                HomeAgentLine(row: row, model: model)
                    // Under the title: past the ring and the press's padding.
                    .padding(.leading, HomeCheck.width + 6)
                    .padding(.trailing, 6)
                    .padding(.bottom, 6)
            }
        }
        .padding(.horizontal, -6)
    }

    private var line: some View {
        HStack(alignment: .firstTextBaseline, spacing: 0) {
            if section == .todos {
                HomeCheck(done: isDone, enabled: model.canToggle(row), title: row.title) { model.toggle(row) }
                    // The ring's middle level with the middle of the first
                    // line's lowercase letters.
                    .alignmentGuide(.firstTextBaseline) { $0[VerticalAlignment.center] + 4.5 }
            }
            Button(action: press) {
                HStack(alignment: .firstTextBaseline, spacing: 10) {
                    if section == .projects {
                        Image(systemName: "folder")
                            .font(.system(size: 13))
                            .foregroundStyle(HomeInk.secondary)
                            .frame(width: 18)
                    }
                    words
                    Spacer(minLength: 6)
                    if let trailing, !isDone {
                        Text(HomeWords.sentence(trailing))
                            .font(tone == nil ? HomeType.detail : HomeType.label)
                            .monospacedDigit()
                            .foregroundStyle(tone ?? HomeInk.secondary)
                    }
                }
                .padding(.vertical, 6)
                .padding(.horizontal, 6)
                .contentShape(Rectangle())
                .background {
                    RoundedRectangle(cornerRadius: HomeGlass.rowRadius, style: .continuous)
                        .fill(hovered ? HomeInk.hover : .clear)
                }
            }
            .buttonStyle(HomePress())
            .onHover { hovered = $0 }
            .help(help)
            .accessibilityLabel([row.title, subtitle ?? "", trailing ?? ""].filter { !$0.isEmpty }.joined(separator: ", "))
            if offersHandle {
                HomeVerb(word: "Handle", tone: HUD.accent,
                         help: "Have the agent draft what to send. Nothing goes out until you press send.") {
                    model.handle(row)
                }
                // The word ends on the content's edge, as the due words do.
                .padding(.trailing, -4)
            }
        }
    }

    /// The title, and under it the time and detail. An event carries a bar
    /// down its leading edge, as Apple's Up Next widget does, in its tone
    /// when it is on or close and quiet otherwise.
    private var words: some View {
        VStack(alignment: .leading, spacing: 2) {
            // Two lines: an assignment's name runs past one at this width.
            Text(row.title)
                .font(HomeType.title)
                .strikethrough(isDone, color: HomeInk.secondary)
                .foregroundStyle(isDone ? HomeInk.secondary : HomeInk.primary)
                .lineLimit(section == .projects ? 1 : 2)
                .fixedSize(horizontal: false, vertical: true)
            if let subtitle {
                Text(subtitle)
                    .font(HomeType.detail)
                    .monospacedDigit()
                    .foregroundStyle(HomeInk.secondary)
                    .lineLimit(1)
            }
        }
        .padding(.leading, section == .calendar ? 11 : 0)
        .overlay(alignment: .leading) {
            if section == .calendar {
                Capsule()
                    .fill(tone ?? HomeInk.tertiary)
                    .frame(width: 3)
                    .padding(.vertical, 1)
            }
        }
    }

    private var start: Date? { HomeWords.date(row.at) }

    /// An event's time, or "All day", then the row's detail.
    private var subtitle: String? {
        var parts: [String] = []
        if section == .calendar {
            if row.allDay {
                parts.append("All day")
            } else if let start {
                parts.append(HomeWords.clock(start))
            }
        }
        if !row.detail.isEmpty { parts.append(row.detail) }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }

    private var trailing: String? {
        switch section {
        case .calendar:
            guard !row.allDay, let start else { return nil }
            return HomeWords.until(start: start, end: HomeWords.date(row.end), now: now)
        case .todos:
            let word = HomeWords.due(row, now: now)
            return word.isEmpty ? nil : word
        case .projects:
            return start.map { HomeWords.age($0, now: now) }
        }
    }

    /// An event this close turns amber: time to get up and go. Guessed,
    /// never measured.
    static let soon: TimeInterval = 15 * 60

    /// Colour only where something is wrong or about to happen, and never
    /// alone: the word beside it says the same thing.
    private var tone: Color? {
        switch section {
        case .calendar:
            guard let start, !row.allDay else { return nil }
            if start <= now { return HUD.good }
            return start.timeIntervalSince(now) <= Self.soon ? HUD.warn : nil
        case .todos:
            let word = HomeWords.due(row, now: now)
            if word == "late" { return HomeInk.bad }
            return word == "today" ? HUD.warn : nil
        case .projects:
            return nil
        }
    }

    private var help: String {
        switch section {
        case .calendar: return "Open today on the glass"
        case .todos: return "Open your tasks on the glass"
        case .projects: return row.path.isEmpty ? "No folder for \(row.title)" : "Open \(row.title) in Terminal"
        }
    }
}

/// A new to-do: a dashed ring where its ring will be and the words being
/// typed. Return adds it, Escape leaves it. While Reminders is written the
/// words stay, dimmed, where the row will appear.
struct HomeAddRow: View {
    @ObservedObject var model: HomeModel
    @FocusState private var focused: Bool

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 0) {
            Circle()
                .strokeBorder(HomeInk.control, style: StrokeStyle(lineWidth: 1.5, dash: [2, 2.5]))
                .frame(width: HomeCheck.ring, height: HomeCheck.ring)
                .padding(.leading, 6)
                .frame(width: HomeCheck.width, height: 36, alignment: .leading)
                .alignmentGuide(.firstTextBaseline) { $0[VerticalAlignment.center] + 4.5 }
                .accessibilityHidden(true)
            if let adding = model.adding {
                Text(adding)
                    .font(HomeType.title)
                    .foregroundStyle(HomeInk.secondary)
                    .lineLimit(2)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.horizontal, 6)
                Spacer(minLength: 6)
                Text("Adding")
                    .font(HomeType.label)
                    .foregroundStyle(HUD.running)
                    .padding(.trailing, 6)
            } else {
                TextField("New to-do", text: $model.draft, prompt: Text("New to-do").foregroundStyle(HomeInk.secondary))
                    .textFieldStyle(.plain)
                    .font(HomeType.title)
                    .foregroundStyle(HomeInk.primary)
                    .focused($focused)
                    .onSubmit { model.add() }
                    .onExitCommand { model.cancelCompose() }
                    .padding(.horizontal, 6)
                if !model.draft.trimmingCharacters(in: .whitespaces).isEmpty {
                    HomeVerb(word: "Add", tone: HUD.accent, prominent: true, help: "Add it to Reminders") { model.add() }
                }
            }
        }
        .frame(minHeight: 36)
        .padding(.horizontal, -6)
        // The window takes the keys when the field opens; focus waits a turn
        // for that, or the field draws focused and gets nothing.
        .onAppear { DispatchQueue.main.async { focused = true } }
    }
}

/// Under a to-do handed to the agent: what it is doing, the text it drafted
/// with send and drop, or why it is his to do. The state is the colour of
/// its words (hud/CLAUDE.md, past the window, rule 5): working cyan, a draft
/// waiting on him amber, failed red.
struct HomeAgentLine: View {
    let row: HomeRow
    @ObservedObject var model: HomeModel

    var body: some View {
        if let press = model.agentPress[row.id] {
            status(press == "starting" ? "Drafting a text" : press.capitalized, tone: HUD.running)
        } else if let agent = row.agent {
            switch agent.state {
            case .working:
                status("Drafting a text", tone: HUD.running)
            case .drafted:
                VStack(alignment: .leading, spacing: 4) {
                    // The row already says "for Reagan Popoff" when the run
                    // is for the same person, and a second line saying it
                    // again is noise; it shows only when the two differ.
                    if row.detail != "for \(who(agent))" {
                        Text("To \(who(agent))")
                            .font(HomeType.detail)
                            .foregroundStyle(HomeInk.secondary)
                    }
                    // Whole, never truncated: send approves every word of
                    // it, so every word is on the panel (600 characters at
                    // most, home_agent.MOST_TEXT_CHARS).
                    Text(agent.text)
                        .font(HomeType.title)
                        .foregroundStyle(HomeInk.primary)
                        .fixedSize(horizontal: false, vertical: true)
                        .textSelection(.enabled)
                        .padding(.leading, 10)
                        // A bar on its leading edge, in the colour of a thing
                        // waiting on him.
                        .overlay(alignment: .leading) { Capsule().fill(HUD.needsYou).frame(width: 2) }
                        .padding(.top, 2)
                    HStack(spacing: 2) {
                        HomeVerb(word: agent.finishes ? "Send and cross off" : "Send", tone: HUD.needsYou,
                                 prominent: true,
                                 help: agent.finishes ? "Send this text to \(who(agent)) and cross the to-do off"
                                                      : "Send this text to \(who(agent))") {
                            model.send(row)
                        }
                        HomeVerb(word: "Drop", tone: HomeInk.secondary, help: "Throw this draft away") { model.drop(row) }
                    }
                }
                .accessibilityElement(children: .contain)
                .accessibilityLabel("Draft to \(who(agent)): \(agent.text)")
            case .yours:
                HStack(alignment: .firstTextBaseline, spacing: 4) {
                    note(agent.why.isEmpty ? "This one is yours." : agent.why, tone: HomeInk.secondary)
                    HomeVerb(word: "Clear", tone: HomeInk.secondary, help: "Clear the agent's answer") { model.drop(row) }
                }
            case .failed:
                HStack(alignment: .firstTextBaseline, spacing: 4) {
                    note(agent.why.isEmpty ? "The agent stopped." : agent.why, tone: HomeInk.bad)
                    HomeVerb(word: "Retry", tone: HUD.accent, help: "Ask the agent again") { model.handle(row) }
                    HomeVerb(word: "Clear", tone: HomeInk.secondary, help: "Clear the failure") { model.drop(row) }
                }
            }
        }
    }

    /// Who the draft goes to, from the run's record, never from the row.
    private func who(_ agent: HomeAgent) -> String {
        agent.to.isEmpty ? "them" : agent.to
    }

    /// A state in its colour with a still dot before it: nothing on the
    /// panel moves while a run is out (motion rule 6).
    private func status(_ text: String, tone: Color) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            Circle().fill(tone).frame(width: 6, height: 6)
                .alignmentGuide(.firstTextBaseline) { $0[.bottom] + 1 }
            Text(text).font(HomeType.detail).foregroundStyle(tone)
        }
        .frame(minHeight: 20, alignment: .leading)
        .accessibilityElement(children: .combine)
    }

    private func note(_ text: String, tone: Color) -> some View {
        Text(text)
            .font(HomeType.detail)
            .foregroundStyle(tone)
            .lineLimit(3)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// A button as Apple draws one on glass: a capsule. Plain, the word or
/// symbol in its tone with a capsule only under the pointer; prominent, the
/// capsule always there in its tone, faint enough that the word on it still
/// holds 4.5:1 (`HomeTests.inkHoldsOnTheGlass`), and outlined under the
/// pointer rather than filled deeper, which would cost the word its
/// contrast. The press area is at least
/// 44 by 28 points. 28 is under the 44 the HIG asks for, kept so a draft's
/// send and drop sit under it without a gap the height of a row; the ring
/// beside every to-do already took 36 for the same reason.
struct HomeVerb: View {
    let word: String
    /// An SF Symbol drawn in place of the word, which stays as its name.
    var symbol: String?
    let tone: Color
    var prominent = false
    let help: String
    let action: () -> Void
    @State private var hovered = false

    /// The prominent capsule's tint. On the worst ground, under the kit's
    /// 0.7 glass, a cyan word on its own capsule measured 4.57:1 at 0.12 and
    /// fell to 4.39 at 0.14.
    static let tint: Double = 0.12

    var body: some View {
        Button(action: action) {
            label
                .foregroundStyle(tone)
                .padding(.horizontal, symbol == nil ? 10 : 6)
                .frame(minHeight: 24)
                .background(Capsule().fill(fill))
                .overlay {
                    if prominent && hovered {
                        Capsule().strokeBorder(tone.opacity(0.5), lineWidth: 1)
                    }
                }
                .frame(minWidth: 44, minHeight: 28)
                .contentShape(Rectangle())
        }
        .buttonStyle(HomePress())
        .onHover { hovered = $0 }
        .help(help)
        .accessibilityLabel(help)
    }

    @ViewBuilder private var label: some View {
        if let symbol {
            Image(systemName: symbol).font(.system(size: 13, weight: .semibold))
        } else {
            Text(word).font(HomeType.label)
        }
    }

    private var fill: Color {
        if prominent { return tone.opacity(Self.tint) }
        return hovered ? HomeInk.hover : .clear
    }
}

/// A to-do's ring: open, or a filled green disc with a tick once crossed
/// off. The press area runs from the panel's padding to the words, 36
/// points tall, around the ring: a near miss to the left still crosses it
/// off rather than opening the tasks walk.
struct HomeCheck: View {
    /// Apple's Reminders ring beside a 14-point line.
    static let ring: CGFloat = 18
    /// The ring and the gap after it. A to-do's words start here, and the
    /// line under a row handed to the agent lines up with them.
    static let width: CGFloat = 28

    let done: Bool
    let enabled: Bool
    let title: String
    let toggle: () -> Void
    @State private var hovered = false

    var body: some View {
        Button(action: toggle) {
            ZStack {
                Circle()
                    .strokeBorder(hovered && !done ? HomeInk.primary : HomeInk.control, lineWidth: 1.5)
                    .opacity(done ? 0 : 1)
                Circle()
                    .fill(HUD.done)
                    .opacity(done ? 1 : 0)
                // Dark on the green rather than Apple's white: white on a
                // green light enough to read as text on the glass is under
                // 2:1.
                Image(systemName: "checkmark")
                    .font(.system(size: 9, weight: .bold))
                    .foregroundStyle(Color.black.opacity(0.8))
                    .opacity(done ? 1 : 0)
            }
            .frame(width: Self.ring, height: Self.ring)
            .padding(.leading, 6)
            .frame(width: Self.width, height: 36, alignment: .leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(HomePress())
        .disabled(!enabled)
        .onHover { hovered = $0 }
        .help(done ? (enabled ? "Put it back on the list" : "Done in its own app; reopen it there")
                   : "Cross it off")
        .accessibilityLabel(done ? "Done: \(title)" : "Cross off: \(title)")
        .accessibilityAddTraits(done ? .isSelected : [])
    }
}

/// A press answers on the way down (hud/CLAUDE.md, motion rule 8), and
/// faster than it comes back, on a spring with no bounce: the deny list's
/// `snappy` for anything pressed often.
private struct HomePress: ButtonStyle {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed && !reduceMotion ? 0.96 : 1)
            .animation(.snappy(duration: configuration.isPressed ? 0.1 : 0.16), value: configuration.isPressed)
    }
}

// MARK: - Resizing

/// The bottom-right corner: two short diagonal strokes, and a drag there
/// resizes the panel. Double-pressed, it goes back to fitting its content.
struct HomeGrip: View {
    let onResize: (HomeResize) -> Void
    @Environment(\.hudOffscreen) private var offscreen

    var body: some View {
        ZStack {
            Path { path in
                path.move(to: CGPoint(x: 11, y: 5))
                path.addLine(to: CGPoint(x: 5, y: 11))
                path.move(to: CGPoint(x: 11, y: 8.5))
                path.addLine(to: CGPoint(x: 8.5, y: 11))
            }
            .stroke(HomeInk.control, style: StrokeStyle(lineWidth: 1, lineCap: .round))
            .frame(width: 14, height: 14)
            if !offscreen {
                HomeGripArea(onResize: onResize)
            }
        }
        .frame(width: 22, height: 22)
        .padding(2)
        .accessibilityLabel("Resize the home panel")
    }
}

private struct HomeGripArea: NSViewRepresentable {
    let onResize: (HomeResize) -> Void

    func makeNSView(context: Context) -> HomeGripView {
        let view = HomeGripView()
        view.onResize = onResize
        return view
    }

    func updateNSView(_ view: HomeGripView, context: Context) { view.onResize = onResize }
}

/// Reads the drag in screen points, from `NSEvent.mouseLocation`, so the
/// window moving under the pointer as it grows never feeds back into the
/// size.
final class HomeGripView: NSView {
    var onResize: (HomeResize) -> Void = { _ in }
    private var pressedAt: NSPoint?

    // The window is dragged by its background; this corner must not be.
    override var mouseDownCanMoveWindow: Bool { false }
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

    override func resetCursorRects() {
        let cursor: NSCursor
        if #available(macOS 15.0, *) {
            cursor = .frameResize(position: .bottomRight, directions: .all)
        } else {
            cursor = .crosshair
        }
        addCursorRect(bounds, cursor: cursor)
    }

    override func mouseDown(with event: NSEvent) {
        if event.clickCount == 2 {
            pressedAt = nil
            onResize(.reset)
            return
        }
        pressedAt = NSEvent.mouseLocation
        onResize(.began)
    }

    override func mouseDragged(with event: NSEvent) {
        guard let pressedAt else { return }
        let at = NSEvent.mouseLocation
        onResize(.changed(CGSize(width: at.x - pressedAt.x, height: pressedAt.y - at.y)))
    }

    override func mouseUp(with event: NSEvent) {
        guard pressedAt != nil else { return }
        pressedAt = nil
        onResize(.ended)
    }
}

// MARK: - The glass

/// The panel's material: Apple's dark regular glass as the iOS 27 kit
/// measures it (the ios27-design tokens, materials.json), the desktop behind
/// it blurred by the window server under #1a1a1a at 0.73, inside a 0.5-point
/// #a6a6a6 rim. macOS 15 has no `glassEffect`, so this is the kit's recipe
/// laid over AppKit's blur rather than the system material.
///
/// No sheen, no halftone, no corner brackets and no drop shadow: glass is a
/// material, not a gradient, and a panel on the wallpaper is under every
/// window, so it has nothing to float over.
struct HomeGlass: View {
    /// A large widget's corner (the kit's components.md: 26 for medium and
    /// large widgets).
    static let radius: CGFloat = 26
    /// How far the content sits from the edge: a widget's margin.
    static let inset: CGFloat = 16
    /// A row's hover fill reaches 6 points past the content, so its corner
    /// is the panel's less the 10 points between them, and the two curves
    /// stay concentric.
    static let rowRadius: CGFloat = radius - (inset - 6)
    /// materials.json, regular glass, dark: #1a1a1a at 0.7, held at 0.73,
    /// the veil the design system's probe solved a native SwiftUI
    /// `.glassEffect(.regular)` to (0.729). At the kit's 0.7 a secondary
    /// word on a hovered row measured 4.42:1 on the worst ground; at 0.73 it
    /// is 4.62 (`HomeTests.inkHoldsOnTheGlass`).
    static let tint = Color(red: 26 / 255, green: 26 / 255, blue: 26 / 255)
    static let tintOpacity: Double = 0.73

    var body: some View {
        ZStack {
            VisualEffect(material: .hudWindow, blending: .behindWindow)
            Self.tint.opacity(Self.tintOpacity)
        }
    }

    /// materials.json's rim, dark: a 0.5-point ring of #a6a6a6, one device
    /// pixel on a 2x screen.
    struct Rim: View {
        var body: some View {
            RoundedRectangle(cornerRadius: HomeGlass.radius, style: .continuous)
                .strokeBorder(Color(white: 166 / 255), lineWidth: 0.5)
                .allowsHitTesting(false)
        }
    }
}

/// The panel's ink: Apple's dark label and fill colours (colors.json in the
/// design system's tokens), and for state the HUD's meaning hues, which are
/// Apple's system hues lifted until they read as text on glass. Every colour
/// a word is drawn in holds 4.5:1 over the panel's worst ground, at rest
/// and under the pointer (`HomeTests.inkHoldsOnTheGlass`).
enum HomeInk {
    static let primary = Color.white
    /// labels.secondary, dark: #ebebf5 at 0.7.
    static let secondary = Color(red: 235 / 255, green: 235 / 255, blue: 245 / 255).opacity(0.7)
    /// labels.tertiary, dark: #ebebf5 at 0.3. Never for words, which it
    /// would draw at about 2:1; only for an idle event's bar.
    static let tertiary = Color(red: 235 / 255, green: 235 / 255, blue: 245 / 255).opacity(0.3)
    /// A control's outline: the to-do's ring and the resize grip. White at
    /// 0.5 holds the 3:1 WCAG asks of a control, where Apple's own grey ring
    /// would not on a light wallpaper.
    static let control = Color.white.opacity(0.5)
    /// fills.tertiary, dark: #767680 at 0.24. The close button's disc.
    static let fill = Color(red: 118 / 255, green: 118 / 255, blue: 128 / 255).opacity(0.24)
    /// fills.primary, dark: #787880 at 0.36. The disc under the pointer.
    static let fillLit = Color(red: 120 / 255, green: 120 / 255, blue: 128 / 255).opacity(0.36)
    /// fills.quaternary, dark: #767680 at 0.18. A row or a word under the
    /// pointer.
    static let hover = Color(red: 118 / 255, green: 118 / 255, blue: 128 / 255).opacity(0.18)
    /// Something wrong: a to-do past its day, an agent that stopped. On the
    /// worst ground, under a hovered row, Apple's dark red (#ff4245)
    /// measures 2.57:1, its increased-contrast red 3.01 and `HUD.bad` 3.33.
    /// This is the same red lifted until it holds 4.5 there (4.62);
    /// (1.0, 0.6, 0.57) held at rest and fell to 4.3 under the pointer.
    static let bad = Color(red: 1.0, green: 0.64, blue: 0.61)
}

// MARK: - The window

/// A borderless panel on the desktop: above the wallpaper and the icons,
/// below every window, on every Space, and still while Mission Control moves
/// the rest.
@MainActor
public final class HomeWindow: NSPanel {
    public let model: HomeModel
    private var host: HomeHostingView<HomeView>?
    private var typing: AnyCancellable?
    /// The app in front when the field opened, given the keys back when it
    /// closes.
    private var keysFrom: NSRunningApplication?
    private static let placeKey = "hud.home.topLeft"
    /// The size he dragged it to, kept apart for each choice of lists: a
    /// panel dragged tall for three lists would otherwise open on one list
    /// over empty glass.
    private let sizeKey: String
    static func sizeKey(lists: [HomeSection]?) -> String {
        guard let lists else { return "hud.home.size" }
        return (["hud.home.size"] + lists.map(\.rawValue)).joined(separator: ".")
    }
    /// The lists to show without Kyber's own title (`HomeView.lists`), by
    /// `HomeSection` name in order, like ["todos", "projects"]. Read once,
    /// when the panel opens.
    public static let listsKey = "hud.home.lists"
    /// Unknown names and repeats are left out; nothing left is the whole panel.
    static func lists(from names: [String]?) -> [HomeSection]? {
        var picked: [HomeSection] = []
        for name in names ?? [] {
            if let section = HomeSection(rawValue: name), !picked.contains(section) { picked.append(section) }
        }
        return picked.isEmpty ? nil : picked
    }
    /// Just above the desktop icons, below every app window.
    public static let desktopLevel = NSWindow.Level(rawValue: Int(CGWindowLevelForKey(.desktopIconWindow)) + 1)

    public init(model: HomeModel, onClose: @escaping () -> Void = {},
                onOpen: @escaping (HomeSection, HomeRow) -> Void) {
        self.model = model
        let lists = Self.lists(from: UserDefaults.standard.stringArray(forKey: Self.listsKey))
        sizeKey = Self.sizeKey(lists: lists)
        super.init(
            contentRect: NSRect(x: 0, y: 0, width: HomeLayout.width, height: 200),
            styleMask: [.nonactivatingPanel, .borderless, .fullSizeContentView],
            backing: .buffered, defer: false)
        collectionBehavior = [.canJoinAllSpaces, .stationary, .ignoresCycle]
        hidesOnDeactivate = false
        becomesKeyOnlyIfNeeded = true
        backgroundColor = .clear
        isOpaque = false
        hasShadow = false
        isMovableByWindowBackground = true
        animationBehavior = .none
        title = "Kyber home"
        // Last, after every NSPanel setting: `isFloatingPanel` writes the level
        // too, and setting it after this put the panel among ordinary windows
        // (layer 0 in the window list on 2026-10-11) instead of on the desktop.
        level = Self.desktopLevel

        let view = HomeView(
            model: model, width: HomeLayout.width,
            lists: lists, onOpen: onOpen,
            onHeight: { [weak self] height in
                MainActor.assumeIsolated { self?.fit(content: height) }
            },
            onClose: onClose,
            onResize: { [weak self] change in
                MainActor.assumeIsolated { self?.resize(change) }
            })
        let host = HomeHostingView(rootView: view)
        // The window's size is set here from the measured content or his
        // resize; the hosting view must not push its own min and max onto it.
        host.sizingOptions = []
        self.host = host
        contentView = host
        layOut()

        typing = model.$isComposing.removeDuplicates().dropFirst().sink { [weak self] on in
            MainActor.assumeIsolated { self?.takeKeys(on) }
        }
        // A press anywhere else with nothing typed closes the field.
        NotificationCenter.default.addObserver(
            forName: NSWindow.didResignKeyNotification, object: self, queue: .main
        ) { [weak self] _ in
            MainActor.assumeIsolated {
                guard let model = self?.model, model.isComposing,
                      model.draft.trimmingCharacters(in: .whitespaces).isEmpty else { return }
                model.cancelCompose()
            }
        }
        NotificationCenter.default.addObserver(
            forName: NSWindow.didMoveNotification, object: self, queue: .main
        ) { [weak self] _ in
            MainActor.assumeIsolated { self?.remember() }
        }
        // Dragged onto another display: that display's limit, at once.
        NotificationCenter.default.addObserver(
            forName: NSWindow.didChangeScreenNotification, object: self, queue: .main
        ) { [weak self] _ in
            MainActor.assumeIsolated { self?.layOut() }
        }
    }

    /// Only while the new to-do field is open: the rest of the time a press
    /// on the panel leaves the keys with the app he was in.
    public override var canBecomeKey: Bool { acceptsTyping }
    public private(set) var acceptsTyping = false

    func takeKeys(_ on: Bool) {
        guard on != acceptsTyping else { return }
        acceptsTyping = on
        if on {
            keysFrom = NSWorkspace.shared.frontmostApplication
            makeKey()
        } else {
            // A nonactivating panel never made Kyber the active app, so the
            // app in front is still his; this hands it its keys back.
            if isKeyWindow, let app = keysFrom, app != NSRunningApplication.current { app.activate() }
            keysFrom = nil
        }
    }
    public override var canBecomeMain: Bool { false }

    /// What the content last asked for, before the cap.
    private var contentHeight: CGFloat = 200
    private var placing = false
    /// The frame a resize started from, and the size it has reached: nil
    /// until the pointer moves, so a click on the corner saves nothing.
    private var resizeFrom: CGRect?
    private var resizing: CGSize?

    private var displays: [HomeDisplay] {
        NSScreen.screens.map { HomeDisplay(frame: $0.frame, visible: $0.visibleFrame) }
    }

    /// Where it was dragged to, if anywhere.
    private var savedTopLeft: CGPoint? {
        guard let saved = UserDefaults.standard.array(forKey: Self.placeKey) as? [Double], saved.count == 2
        else { return nil }
        return CGPoint(x: saved[0], y: saved[1])
    }

    /// The size he resized it to, if he has.
    private var savedSize: CGSize? {
        guard let saved = UserDefaults.standard.array(forKey: sizeKey) as? [Double], saved.count == 2
        else { return nil }
        return CGSize(width: saved[0], height: saved[1])
    }

    /// Size and place it from the saved corner, his size or the content's
    /// height.
    func layOut() {
        let corner = resizeFrom.map { CGPoint(x: $0.minX, y: $0.maxY) } ?? savedTopLeft
        let target = HomeLayout.frame(
            content: contentHeight, topLeft: corner, size: resizing ?? savedSize, displays: displays)
        guard target.width > 0 else { return }
        if let host, host.rootView.width != target.width {
            host.rootView = host.rootView.with(width: target.width)
        }
        guard target != frame else { return }
        placing = true
        defer { placing = false }
        setFrame(target, display: true)
    }

    func fit(content height: CGFloat) {
        guard height > 0, abs(height - contentHeight) > 0.5 else { return }
        contentHeight = height
        layOut()
    }

    /// A drag on the corner grip. The top-left corner stays put; the size is
    /// held inside the display's third as it goes, and saved when it ends.
    func resize(_ change: HomeResize) {
        switch change {
        case .began:
            resizeFrom = frame
            resizing = nil
        case .changed(let by):
            guard let from = resizeFrom else { return }
            resizing = CGSize(width: from.width + by.width, height: from.height + by.height)
            layOut()
        case .ended:
            guard resizeFrom != nil else { return }
            // A click with no drag, or the first half of the double press
            // that resets, leaves the size to the content (review,
            // 2026-10-11: a stray click had locked the height).
            if resizing != nil {
                UserDefaults.standard.set([Double(frame.width), Double(frame.height)], forKey: sizeKey)
            }
            resizeFrom = nil
            resizing = nil
            remember()
        case .reset:
            resizeFrom = nil
            resizing = nil
            UserDefaults.standard.removeObject(forKey: sizeKey)
            layOut()
        }
    }

    private func remember() {
        guard !placing, resizeFrom == nil else { return }
        UserDefaults.standard.set([Double(frame.minX), Double(frame.maxY)], forKey: Self.placeKey)
    }

    /// The display arrangement changed: new limits, and back on a display.
    public func refit() {
        layOut()
    }

    /// Turned on from the menu, and whether something is hiding it now: a
    /// screen share or a denied app (main.swift `checkSuppression`). It holds
    /// names and to-dos, so it goes with the glass.
    public private(set) var isWanted = false
    private var isSuppressed = false

    public func show() {
        isWanted = true
        applyVisibility()
    }

    public func hide() {
        isWanted = false
        applyVisibility()
    }

    public func suppress(_ on: Bool) {
        guard on != isSuppressed else { return }
        isSuppressed = on
        applyVisibility()
    }

    private func applyVisibility() {
        if isWanted && !isSuppressed {
            guard !isVisible else { return }
            model.start()
            orderFront(nil)
        } else {
            model.stop()
            orderOut(nil)
        }
    }
}

/// Every click on a panel that never becomes key is a first click, and
/// AppKit swallows those by default (Overlay.swift, PassThroughHostingView).
final class HomeHostingView<Content: View>: NSHostingView<Content> {
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
}
