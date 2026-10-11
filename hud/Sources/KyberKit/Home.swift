import AppKit
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
/// them and sends a cross-off back as `kyber-surfaces home --done <id>`.
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

    enum CodingKeys: String, CodingKey {
        case id, title, detail, at, end, day, allDay, overdue, count, path, done, reopen
    }

    public init(id: String, title: String, detail: String = "", at: String = "", end: String = "",
                day: String = "", allDay: Bool = false, overdue: Bool = false, count: Int = 0,
                path: String = "", done: Bool = false, reopen: Bool = true) {
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
    /// The column until he resizes it, wide enough for a thirty-character
    /// title and its due word on one line. Guessed, never measured against
    /// use.
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
    static let stripHeight: CGFloat = 36

    public init(model: HomeModel, width: CGFloat = HomeLayout.width, scrolls: Bool = true,
                onOpen: @escaping (HomeSection, HomeRow) -> Void = { _, _ in },
                onHeight: @escaping (CGFloat) -> Void = { _ in },
                onClose: @escaping () -> Void = {},
                onResize: @escaping (HomeResize) -> Void = { _ in }) {
        self.model = model
        self.width = width
        self.scrolls = scrolls
        self.onOpen = onOpen
        self.onHeight = onHeight
        self.onClose = onClose
        self.onResize = onResize
    }

    /// The same panel at another width.
    func with(width: CGFloat) -> HomeView {
        HomeView(model: model, width: width, scrolls: scrolls, onOpen: onOpen, onHeight: onHeight,
                 onClose: onClose, onResize: onResize)
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            titleStrip
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
        .overlay(HomeGlass.Brackets())
        .onPreferenceChange(HomeHeight.self) { onHeight($0 + Self.stripHeight) }
        .environment(\.colorScheme, .dark)
    }

    private var measured: some View {
        VStack(alignment: .leading, spacing: 16) {
            headline
            content
        }
        .padding(.horizontal, 16)
        .padding(.top, 12)
        .padding(.bottom, 18)
        .frame(width: width, alignment: .topLeading)
        .background(GeometryReader { proxy in
            Color.clear.preference(key: HomeHeight.self, value: proxy.size.height)
        })
    }

    /// The mark and the name on the left, the close on the right. The strip
    /// is where the panel is dragged from.
    private var titleStrip: some View {
        HStack(spacing: 8) {
            HomeMark(size: 16)
            Text("Kyber")
                .font(HomeType.text(13, .semibold))
                .foregroundStyle(HUD.ink)
            Spacer(minLength: 8)
            HomeClose(action: onClose)
        }
        .padding(.leading, 14)
        .padding(.trailing, 2)
        .frame(height: Self.stripHeight)
        .background(Color.black.opacity(0.18))
        .overlay(alignment: .bottom) {
            Color.white.opacity(0.14).frame(height: 1)
        }
    }

    /// "Sunday  October 11".
    private var headline: some View {
        let line = HomeWords.dateLine(model.now)
        return HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text(line.day)
                .font(HomeType.display(30))
                .foregroundStyle(HUD.ink)
            Text(line.date)
                .font(HomeType.text(13, .medium))
                .foregroundStyle(HUD.faint)
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
            VStack(alignment: .leading, spacing: 18) {
                HomeList(section: .calendar, rows: visibleEvents(feed.calendar), total: nil,
                         now: model.now, model: model, onOpen: onOpen)
                HomeList(section: .todos, rows: feed.todos, total: feed.todoCount,
                         now: model.now, model: model, onOpen: onOpen)
                HomeList(section: .projects, rows: feed.projects, total: nil,
                         now: model.now, model: model, onOpen: onOpen)
                footer(feed)
            }
        }
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
        if !feed.failed.isEmpty || stale || model.notice != nil {
            VStack(alignment: .leading, spacing: 3) {
                if let notice = model.notice {
                    Text(notice).foregroundStyle(HUD.warn)
                }
                if !feed.failed.isEmpty {
                    Text("Not read: \(feed.failed.map(\.capitalized).joined(separator: ", "))")
                }
                if stale, let written {
                    Text("Updated \(HomeWords.age(written, now: model.now)) ago")
                }
            }
            .font(HomeType.text(11))
            .foregroundStyle(HUD.faint)
        }
    }

    private func note(_ text: String) -> some View {
        Text(text)
            .font(HomeType.text(12.5))
            .foregroundStyle(HUD.dim)
            .fixedSize(horizontal: false, vertical: true)
            .padding(.vertical, 4)
    }
}

private struct HomeHeight: PreferenceKey {
    static let defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) { value = max(value, nextValue()) }
}

/// The strip's X: hides the panel, which the menu's "Home on the desktop"
/// brings back. Faint until hovered and never invisible, and it names what
/// it closes (hud/CLAUDE.md: a close button stays faintly visible).
struct HomeClose: View {
    let action: () -> Void
    @State private var hovered = false

    var body: some View {
        Button(action: action) {
            Image(systemName: "xmark")
                .font(.system(size: 10, weight: .semibold))
                .foregroundStyle(hovered ? HUD.ink : HUD.faint)
                .frame(width: 22, height: 22)
                .background(Circle().fill(Color.white.opacity(hovered ? 0.14 : 0)))
                .frame(width: 36, height: 36)
                .contentShape(Rectangle())
        }
        .buttonStyle(HomePress())
        .onHover { hovered = $0 }
        .help("Hide the home panel. The Kyber menu's Home on the desktop brings it back.")
        .accessibilityLabel("Hide the home panel")
    }
}

/// One titled list.
struct HomeList: View {
    let section: HomeSection
    let rows: [HomeRow]
    /// How many are still open in all, when that is more than are shown.
    let total: Int?
    let now: Date
    @ObservedObject var model: HomeModel
    let onOpen: (HomeSection, HomeRow) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 1) {
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text(section.title)
                    .font(HomeType.display(20, italic: true))
                    .foregroundStyle(HUD.ink)
                    .accessibilityAddTraits(.isHeader)
                Spacer(minLength: 4)
                let shown = rows.filter { !$0.done }.count
                if let total, total > shown {
                    Text("\(shown) of \(total)")
                        .font(HomeType.text(11, .medium))
                        .monospacedDigit()
                        .foregroundStyle(HUD.faint)
                }
            }
            .padding(.bottom, 4)
            if rows.isEmpty {
                Text(section.empty)
                    .font(HomeType.text(12.5))
                    .foregroundStyle(HUD.faint)
                    .padding(.vertical, 3)
            } else {
                // By position, not id: nothing here animates, and two rows
                // sharing an id would otherwise confuse the list.
                ForEach(Array(rows.enumerated()), id: \.offset) { index, row in
                    if section == .calendar, let header = dayHeader(index) {
                        Text(header)
                            .font(HomeType.display(15, italic: true))
                            .foregroundStyle(HUD.dim)
                            .padding(.top, 6)
                            .padding(.bottom, 1)
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

/// One row: a to-do's box or a dot, the words, and a time on the right. The
/// words are the press; the box crosses a to-do off.
struct HomeRowView: View {
    let section: HomeSection
    let row: HomeRow
    let now: Date
    @ObservedObject var model: HomeModel
    let press: () -> Void
    @State private var hovered = false

    private var isDone: Bool { section == .todos && model.isDone(row) }

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 0) {
            if section == .todos {
                HomeCheck(done: isDone, enabled: model.canToggle(row), title: row.title) { model.toggle(row) }
                    .alignmentGuide(.firstTextBaseline) { $0[VerticalAlignment.center] + 4.5 }
            }
            Button(action: press) {
                HStack(alignment: .firstTextBaseline, spacing: 9) {
                    if section != .todos {
                        dot.alignmentGuide(.firstTextBaseline) { $0[.bottom] }
                    }
                    if section == .calendar {
                        Text(leading)
                            .font(HomeType.text(12, .medium))
                            .monospacedDigit()
                            .foregroundStyle(HUD.dim)
                            .frame(width: 58, alignment: .leading)
                    }
                    VStack(alignment: .leading, spacing: 2) {
                        Text(row.title)
                            .font(HomeType.text(13.5, .medium))
                            .strikethrough(isDone, color: HUD.faint)
                            .foregroundStyle(isDone ? HUD.faint : HUD.ink)
                            .lineLimit(1)
                        if !row.detail.isEmpty {
                            Text(row.detail)
                                .font(HomeType.text(11.5))
                                .foregroundStyle(HUD.faint)
                                .lineLimit(1)
                        }
                    }
                    Spacer(minLength: 6)
                    if let trailing, !isDone {
                        Text(trailing)
                            .font(HomeType.text(11.5, .medium))
                            .monospacedDigit()
                            .foregroundStyle(tone ?? HUD.dim)
                    }
                }
                .padding(.vertical, 5)
                .padding(.horizontal, 6)
                .contentShape(Rectangle())
                .background {
                    RoundedRectangle(cornerRadius: 6, style: .continuous)
                        .fill(Color.white.opacity(hovered ? 0.08 : 0))
                }
            }
            .buttonStyle(HomePress())
            .onHover { hovered = $0 }
            .help(help)
            .accessibilityLabel([row.title, row.detail, trailing ?? ""].filter { !$0.isEmpty }.joined(separator: ", "))
        }
        .padding(.horizontal, -6)
    }

    private var start: Date? { HomeWords.date(row.at) }

    /// The calendar's left column: its time, or "All day".
    private var leading: String {
        if row.allDay { return "All day" }
        return start.map { HomeWords.clock($0) } ?? ""
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
            if word == "late" { return HUD.bad }
            return word == "today" ? HUD.warn : nil
        case .projects:
            return nil
        }
    }

    /// A small dot in the row's tone, or quiet white when nothing is wrong.
    private var dot: some View {
        Circle()
            .fill(tone ?? Color.white.opacity(0.45))
            .frame(width: 5, height: 5)
            .padding(.bottom, 4)
    }

    private var help: String {
        switch section {
        case .calendar: return "Open today on the glass"
        case .todos: return "Open your tasks on the glass"
        case .projects: return row.path.isEmpty ? "No folder for \(row.title)" : "Open \(row.title) in Terminal"
        }
    }
}

/// A to-do's box: an open ring, or a filled green disc with a tick once
/// crossed off. The press area runs from the panel's padding to the words,
/// 36 points tall, around a 15-point drawing whose ring starts where the
/// other lists' dots do: a near miss to the left still crosses it off rather
/// than opening the tasks walk.
struct HomeCheck: View {
    let done: Bool
    let enabled: Bool
    let title: String
    let toggle: () -> Void
    @State private var hovered = false

    var body: some View {
        Button(action: toggle) {
            ZStack {
                Circle()
                    .strokeBorder(Color.white.opacity(hovered && !done ? 0.9 : 0.5), lineWidth: 1.25)
                    .opacity(done ? 0 : 1)
                Circle()
                    .fill(HUD.good)
                    .opacity(done ? 1 : 0)
                Image(systemName: "checkmark")
                    .font(.system(size: 8, weight: .bold))
                    .foregroundStyle(Color.black.opacity(0.78))
                    .opacity(done ? 1 : 0)
            }
            .frame(width: 15, height: 15)
            .padding(.leading, 6)
            .frame(width: 24, height: 36, alignment: .leading)
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
/// faster than it comes back.
private struct HomePress: ButtonStyle {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed && !reduceMotion ? 0.96 : 1)
            .animation(.easeOut(duration: configuration.isPressed ? 0.1 : 0.16), value: configuration.isPressed)
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
            .stroke(Color.white.opacity(0.4), style: StrokeStyle(lineWidth: 1, lineCap: .round))
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

/// The panel's material: the desktop behind it, blurred by the window server,
/// under a light smoke so white type holds against a bright patch of
/// wallpaper. The Clay HUD's window chrome (OverlayView `window(_:)`) is the
/// same recipe at a heavier wash and a hard drop; this one is lighter and
/// drops the drop, because it lives on the wallpaper and is meant to look
/// like part of it, not a window over it.
struct HomeGlass: View {
    static let radius: CGFloat = 14
    /// Black over the blur, lighter than the window chrome's so the wallpaper
    /// shows through. Guessed; checked only by eye, on his forest wallpaper
    /// on 2026-10-11, never measured against others.
    static let smoke: Double = 0.2

    var body: some View {
        ZStack {
            VisualEffect(material: .hudWindow, blending: .behindWindow)
            Color.black.opacity(Self.smoke)
            // The sheen across the upper left, where the light is.
            LinearGradient(
                colors: [.white.opacity(0.10), .white.opacity(0)],
                startPoint: .topLeading, endPoint: UnitPoint(x: 0.6, y: 0.5))
            Halftone().opacity(0.5)
        }
    }

    /// Bright along the top, dim down the sides, back along the bottom: an
    /// edge with thickness, not a printed line (the card's recipe).
    struct Rim: View {
        var body: some View {
            let shape = RoundedRectangle(cornerRadius: HomeGlass.radius, style: .continuous)
            shape
                .strokeBorder(
                    LinearGradient(
                        colors: [.white.opacity(0.45), .white.opacity(0.12), .white.opacity(0.24)],
                        startPoint: .top, endPoint: .bottom),
                    lineWidth: 1)
                .overlay { shape.stroke(Color.black.opacity(0.25), lineWidth: 1).padding(-1) }
                .allowsHitTesting(false)
        }
    }

    /// The Clay HUD's corner brackets, drawn just inside the rim.
    struct Brackets: View {
        static let arm: CGFloat = 9
        static let inset: CGFloat = 5

        var body: some View {
            GeometryReader { proxy in
                Path { path in
                    let w = proxy.size.width, h = proxy.size.height
                    let i = Self.inset, a = Self.arm
                    for (x, y, dx, dy) in [(i, i, 1.0, 1.0), (w - i, i, -1.0, 1.0), (i, h - i, 1.0, -1.0)] {
                        path.move(to: CGPoint(x: x + dx * a, y: y))
                        path.addLine(to: CGPoint(x: x, y: y))
                        path.addLine(to: CGPoint(x: x, y: y + dy * a))
                    }
                }
                .stroke(Color.white.opacity(0.4), lineWidth: 1)
            }
            .allowsHitTesting(false)
        }
    }
}

// MARK: - The window

/// A borderless panel on the desktop: above the wallpaper and the icons,
/// below every window, on every Space, and still while Mission Control moves
/// the rest.
@MainActor
public final class HomeWindow: NSPanel {
    public let model: HomeModel
    private var host: HomeHostingView<HomeView>?
    private static let placeKey = "hud.home.topLeft"
    private static let sizeKey = "hud.home.size"
    /// Just above the desktop icons, below every app window.
    public static let desktopLevel = NSWindow.Level(rawValue: Int(CGWindowLevelForKey(.desktopIconWindow)) + 1)

    public init(model: HomeModel, onClose: @escaping () -> Void = {},
                onOpen: @escaping (HomeSection, HomeRow) -> Void) {
        self.model = model
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
            model: model, width: HomeLayout.width, onOpen: onOpen,
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

    public override var canBecomeKey: Bool { false }
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
        guard let saved = UserDefaults.standard.array(forKey: Self.sizeKey) as? [Double], saved.count == 2
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
                UserDefaults.standard.set([Double(frame.width), Double(frame.height)], forKey: Self.sizeKey)
            }
            resizeFrom = nil
            resizing = nil
            remember()
        case .reset:
            resizeFrom = nil
            resizing = nil
            UserDefaults.standard.removeObject(forKey: Self.sizeKey)
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
