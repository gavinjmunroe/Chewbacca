import AppKit
import SwiftUI
import os

/// Kyber's home: a glass panel on the desktop with the day in four short
/// lists. What is on next, what to do, who is waiting on a reply, and what is
/// moving.
///
/// Asked for on 2026-10-11 to replace the battery and clock widgets: "calendar,
/// my to-dos, people to reach out to, the projects im currently working on,
/// all in a minimal way", in the Clay HUD's style but "more glassmorphic so it
/// blends in with my wallpaper", and never more than a third of the screen.
///
/// It sits on the desktop rather than on the glass: below every window, like
/// the widgets it replaces, so it is there when the windows are not and never
/// over work. The rows come from `~/.bob/home-panel.json`, which the surfaces daemon
/// writes after every ingest (`bin/lib/home_feed.py`); this file only draws.
/// Nothing here moves while idle: it is looked at a hundred times a day, and
/// motion on something seen that often is a tax (claude-design-kit's budget).

// MARK: - The feed

/// One row, as `home_feed.py` writes it. Every field but the id and title
/// is optional, so a feed from an older daemon still draws.
public struct HomeRow: Decodable, Equatable, Identifiable, Sendable {
    public let id: String
    public let title: String
    public var detail = ""
    /// When it starts (calendar), was last committed (projects), or has been
    /// waiting since (people). ISO 8601.
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
    /// Whether a person is someone saved, as opposed to a bare number.
    public var known = true

    enum CodingKeys: String, CodingKey {
        case id, title, detail, at, end, day, allDay, overdue, count, path, known
    }

    public init(id: String, title: String, detail: String = "", at: String = "", end: String = "",
                day: String = "", allDay: Bool = false, overdue: Bool = false, count: Int = 0,
                path: String = "", known: Bool = true) {
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
        self.known = known
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
        known = try c.decodeIfPresent(Bool.self, forKey: .known) ?? true
    }
}

public struct HomeFeed: Decodable, Equatable, Sendable {
    public var at = ""
    public var calendar: [HomeRow] = []
    public var todos: [HomeRow] = []
    public var todoCount = 0
    public var people: [HomeRow] = []
    public var peopleCount = 0
    public var projects: [HomeRow] = []
    /// Sources the last ingest could not read, so an empty list is never
    /// mistaken for a clear day.
    public var failed: [String] = []

    enum CodingKeys: String, CodingKey {
        case at, calendar, todos, todoCount, people, peopleCount, projects, failed
    }

    public init() {}

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        at = try c.decodeIfPresent(String.self, forKey: .at) ?? ""
        calendar = try c.decodeIfPresent([HomeRow].self, forKey: .calendar) ?? []
        todos = try c.decodeIfPresent([HomeRow].self, forKey: .todos) ?? []
        todoCount = try c.decodeIfPresent(Int.self, forKey: .todoCount) ?? todos.count
        people = try c.decodeIfPresent([HomeRow].self, forKey: .people) ?? []
        peopleCount = try c.decodeIfPresent(Int.self, forKey: .peopleCount) ?? people.count
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

    /// "SUN OCT 11" for the title strip.
    public static func stamp(_ now: Date, calendar: Calendar = .current) -> String {
        let format = DateFormatter()
        format.calendar = calendar
        format.timeZone = calendar.timeZone
        format.setLocalizedDateFormatFromTemplate("EEEMMMd")
        return format.string(from: now).replacingOccurrences(of: ",", with: "").uppercased()
    }
}

// MARK: - Size

/// How big the panel may be on a screen: "this whole thing shouldnt take up
/// more than 33% of my screen" (2026-10-11), held as both a third of the
/// width and a third of the area, whichever is tighter.
public enum HomeLayout {
    /// Column width, wide enough for a thirty-character title and its due
    /// word at 13 pt on one line. Guessed, never measured against use.
    public static let width: CGFloat = 340
    /// From the screen's usable edge, the menu bar and Dock already out.
    public static let margin: CGFloat = 24
    public static let shareOfScreen: CGFloat = 1.0 / 3.0

    /// The widest and tallest the panel may be on a screen of this frame and
    /// usable (`visibleFrame`) area.
    public static func limit(screen: CGRect, visible: CGRect) -> CGSize {
        let width = min(Self.width, floor(screen.width * shareOfScreen))
        let byArea = floor(screen.width * screen.height * shareOfScreen / max(width, 1))
        let height = min(byArea, visible.height - margin * 2)
        return CGSize(width: width, height: max(0, height))
    }

    /// Where it goes with nothing remembered: the top left, where the widgets
    /// it replaces sat. Returned as the window's top-left corner.
    public static func defaultTopLeft(visible: CGRect) -> CGPoint {
        CGPoint(x: visible.minX + margin, y: visible.maxY - margin)
    }

    /// The window's frame for content this tall, with its top-left corner
    /// where it was dragged to (nil for the default). Sized for the display
    /// that corner is on, as tall as the content up to that display's limit,
    /// and moved only as far as it takes to sit wholly on it. `displays`
    /// starts with the main one, which takes a corner on no display.
    public static func frame(content: CGFloat, topLeft: CGPoint?, displays: [HomeDisplay]) -> CGRect {
        guard let main = displays.first else { return .zero }
        let display = topLeft.flatMap { corner in
            displays.first { $0.visible.insetBy(dx: -1, dy: -1).contains(corner) }
        }
        let on = display ?? main
        let corner = display == nil ? defaultTopLeft(visible: on.visible) : topLeft ?? .zero
        let size = limit(screen: on.frame, visible: on.visible)
        let height = min(max(ceil(content), 1), size.height)
        let left = min(max(corner.x, on.visible.minX), on.visible.maxX - size.width)
        let top = max(min(corner.y, on.visible.maxY), on.visible.minY + height)
        return CGRect(x: left, y: top - height, width: size.width, height: height)
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

    private let path: URL
    private let refresher: URL?
    private var modified: Date?
    private var timer: Timer?
    private var lastTick = Date.distantPast
    private var isRefreshing = false
    private var lastRefresh = Date.distantPast
    private static let log = Logger(subsystem: "kyber", category: "home")

    public init(path: URL = HomeModel.defaultPath, refresher: URL? = HomeModel.surfacesCommand) {
        self.path = path
        self.refresher = refresher
    }

    /// For tests and snapshots: a feed in hand, no file.
    public init(feed: HomeFeed, now: Date) {
        path = URL(fileURLWithPath: "/dev/null")
        refresher = nil
        state = .ready(feed)
        self.now = now
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
        guard let refresher, !isRefreshing else { return }
        let age = modified.map { Date().timeIntervalSince($0) } ?? .infinity
        guard age > Self.refreshAfter, Date().timeIntervalSince(lastRefresh) > Self.refreshAfter else { return }
        isRefreshing = true
        lastRefresh = Date()
        let process = Process()
        process.executableURL = refresher
        process.arguments = ["home", "--write"]
        process.standardOutput = FileHandle.nullDevice
        process.standardError = FileHandle.nullDevice
        process.terminationHandler = { [weak self] done in
            let status = done.terminationStatus
            Task { @MainActor in
                if status != 0 { Self.log.notice("home.refresh status=\(status, privacy: .public)") }
                self?.isRefreshing = false
                self?.reload(force: true)
            }
        }
        do {
            try process.run()
        } catch {
            isRefreshing = false
            Self.log.notice("home.refresh failed=\(error.localizedDescription, privacy: .public)")
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
}

// MARK: - The view

/// Which list a row came from, which decides how its time is worded and what
/// a press does.
public enum HomeSection: String, CaseIterable, Sendable {
    case calendar, todos, people, projects

    var title: String {
        switch self {
        case .calendar: return "CALENDAR"
        case .todos: return "TO-DO"
        case .people: return "REACH OUT"
        case .projects: return "PROJECTS"
        }
    }

    /// What an empty list says. Never blank: an empty list and a list that
    /// failed to load must not look alike.
    var empty: String {
        switch self {
        case .calendar: return "Nothing else on today or tomorrow."
        case .todos: return "Nothing due."
        case .people: return "No one is waiting on a reply."
        case .projects: return "No commits of yours this week."
        }
    }
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
    static let stripHeight: CGFloat = 30

    public init(model: HomeModel, width: CGFloat = HomeLayout.width, scrolls: Bool = true,
                onOpen: @escaping (HomeSection, HomeRow) -> Void = { _, _ in },
                onHeight: @escaping (CGFloat) -> Void = { _ in }) {
        self.model = model
        self.width = width
        self.scrolls = scrolls
        self.onOpen = onOpen
        self.onHeight = onHeight
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
        .clipShape(RoundedRectangle(cornerRadius: HomeGlass.radius, style: .continuous))
        .overlay(HomeGlass.Rim())
        .overlay(HomeGlass.Brackets())
        .onPreferenceChange(HomeHeight.self) { onHeight($0 + Self.stripHeight) }
        .environment(\.colorScheme, .dark)
    }

    private var measured: some View {
        content
            .padding(.horizontal, 14)
            .padding(.top, 12)
            .padding(.bottom, 14)
            .frame(width: width, alignment: .topLeading)
            .background(GeometryReader { proxy in
                Color.clear.preference(key: HomeHeight.self, value: proxy.size.height)
            })
    }

    private var titleStrip: some View {
        HStack(spacing: 8) {
            AgentMarkView(kind: .ico, spin: false, size: 13)
            Text("KYBER")
                .pixelFont(11)
                .foregroundStyle(HUD.ink)
            Spacer(minLength: 8)
            Text(HomeWords.stamp(model.now))
                .pixelFont(11)
                .foregroundStyle(HUD.dim)
        }
        .padding(.horizontal, 14)
        .frame(height: Self.stripHeight)
        .background(Color.black.opacity(0.30))
        .overlay(alignment: .bottom) {
            Color.white.opacity(0.22).frame(height: 1)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Kyber home, \(HomeWords.stamp(model.now).capitalized)")
    }

    @ViewBuilder private var content: some View {
        switch model.state {
        case .waiting:
            note("Reading your day. The lists fill in after the next pass, about a minute.")
        case .unreadable:
            note("The home feed could not be read. It is rewritten on the next pass.")
        case .ready(let feed):
            VStack(alignment: .leading, spacing: 14) {
                HomeList(section: .calendar, rows: visibleEvents(feed.calendar), total: nil,
                         now: model.now, onOpen: onOpen)
                HomeList(section: .todos, rows: feed.todos, total: feed.todoCount,
                         now: model.now, onOpen: onOpen)
                HomeList(section: .people, rows: feed.people, total: feed.peopleCount,
                         now: model.now, onOpen: onOpen)
                HomeList(section: .projects, rows: feed.projects, total: nil,
                         now: model.now, onOpen: onOpen)
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
        if !feed.failed.isEmpty || stale {
            VStack(alignment: .leading, spacing: 3) {
                if !feed.failed.isEmpty {
                    Text("Not read: \(feed.failed.map(\.capitalized).joined(separator: ", "))")
                }
                if stale, let written {
                    Text("Updated \(HomeWords.age(written, now: model.now)) ago")
                }
            }
            .font(.system(size: 11))
            .foregroundStyle(HUD.faint)
        }
    }

    private func note(_ text: String) -> some View {
        Text(text)
            .font(.system(size: 12))
            .foregroundStyle(HUD.dim)
            .fixedSize(horizontal: false, vertical: true)
            .padding(.vertical, 4)
    }
}

private struct HomeHeight: PreferenceKey {
    static let defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) { value = max(value, nextValue()) }
}

/// One titled list.
struct HomeList: View {
    let section: HomeSection
    let rows: [HomeRow]
    /// How many there are in all, when that is more than are shown.
    let total: Int?
    let now: Date
    let onOpen: (HomeSection, HomeRow) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 6) {
                Text(section.title)
                    .pixelFont(11)
                    .foregroundStyle(Color.black.opacity(0.85))
                    .padding(.horizontal, 4)
                    .frame(height: 15)
                    .background(Color.white.opacity(0.86))
                    .accessibilityAddTraits(.isHeader)
                Spacer(minLength: 4)
                if let total, total > rows.count {
                    Text("\(rows.count) OF \(total)")
                        .pixelFont(11)
                        .foregroundStyle(HUD.faint)
                }
            }
            .padding(.bottom, 4)
            if rows.isEmpty {
                Text(section.empty)
                    .font(.system(size: 12))
                    .foregroundStyle(HUD.faint)
                    .padding(.vertical, 3)
            } else {
                // By position, not id: nothing here animates, and two rows
                // sharing an id would otherwise confuse the list.
                ForEach(Array(rows.enumerated()), id: \.offset) { index, row in
                    if section == .calendar, let header = dayHeader(index) {
                        Text(header.uppercased())
                            .pixelFont(11)
                            .foregroundStyle(HUD.faint)
                            .padding(.top, 5)
                            .padding(.bottom, 1)
                    }
                    HomeRowView(section: section, row: row, now: now) { onOpen(section, row) }
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

/// One pressable row: a pip, the words, and a time on the right.
struct HomeRowView: View {
    let section: HomeSection
    let row: HomeRow
    let now: Date
    let press: () -> Void
    @State private var hovered = false

    var body: some View {
        Button(action: press) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                pip
                    .alignmentGuide(.firstTextBaseline) { $0[.bottom] - 1 }
                if section == .calendar {
                    Text(leading)
                        .pixelFont(11)
                        .foregroundStyle(HUD.dim)
                        .frame(width: 62, alignment: .leading)
                }
                VStack(alignment: .leading, spacing: 2) {
                    Text(row.title)
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(row.known ? HUD.ink : HUD.dim)
                        .lineLimit(1)
                    if !row.detail.isEmpty {
                        Text(row.detail)
                            .font(.system(size: 11))
                            .foregroundStyle(HUD.faint)
                            .lineLimit(1)
                    }
                }
                Spacer(minLength: 6)
                if let trailing {
                    Text(trailing)
                        .pixelFont(11)
                        .foregroundStyle(tone ?? HUD.dim)
                }
            }
            .padding(.vertical, 4)
            .padding(.horizontal, 6)
            .contentShape(Rectangle())
            .background {
                RoundedRectangle(cornerRadius: 5, style: .continuous)
                    .fill(Color.white.opacity(hovered ? 0.09 : 0))
            }
        }
        .buttonStyle(HomePress())
        .padding(.horizontal, -6)
        .onHover { hovered = $0 }
        .help(help)
        .accessibilityLabel([row.title, row.detail, trailing ?? ""].filter { !$0.isEmpty }.joined(separator: ", "))
    }

    private var start: Date? { HomeWords.date(row.at) }

    /// The calendar's left column: its time, or ALL DAY.
    private var leading: String {
        if row.allDay { return "ALL DAY" }
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
        case .people, .projects:
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
        case .people, .projects:
            return nil
        }
    }

    /// Clay's square pip, in the row's tone, or ink when nothing is wrong.
    private var pip: some View {
        Rectangle()
            .fill(tone ?? Color.white.opacity(row.known ? 0.55 : 0.3))
            .frame(width: 6, height: 6)
    }

    private var help: String {
        switch section {
        case .calendar: return "Open today on the glass"
        case .todos: return "Open your tasks on the glass"
        case .people: return row.known ? "Open \(row.title) on the glass" : "Open your conversations on the glass"
        case .projects: return "Open \(row.title) in Terminal"
        }
    }
}

/// A press answers on the way down (hud/CLAUDE.md, motion rule 8), and
/// faster than it comes back.
private struct HomePress: ButtonStyle {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed && !reduceMotion ? 0.98 : 1)
            .animation(.easeOut(duration: configuration.isPressed ? 0.1 : 0.16), value: configuration.isPressed)
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
    static let radius: CGFloat = 12
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
                    for (x, y, dx, dy) in [(i, i, 1.0, 1.0), (w - i, i, -1.0, 1.0),
                                           (i, h - i, 1.0, -1.0), (w - i, h - i, -1.0, -1.0)] {
                        path.move(to: CGPoint(x: x + dx * a, y: y))
                        path.addLine(to: CGPoint(x: x, y: y))
                        path.addLine(to: CGPoint(x: x, y: y + dy * a))
                    }
                }
                .stroke(Color.white.opacity(0.55), lineWidth: 1)
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

    public init(model: HomeModel, onOpen: @escaping (HomeSection, HomeRow) -> Void) {
        self.model = model
        super.init(
            contentRect: NSRect(x: 0, y: 0, width: HomeLayout.width, height: 200),
            styleMask: [.nonactivatingPanel, .borderless, .fullSizeContentView],
            backing: .buffered, defer: false)
        level = NSWindow.Level(rawValue: Int(CGWindowLevelForKey(.desktopIconWindow)) + 1)
        collectionBehavior = [.canJoinAllSpaces, .stationary, .ignoresCycle]
        isFloatingPanel = false
        hidesOnDeactivate = false
        becomesKeyOnlyIfNeeded = true
        backgroundColor = .clear
        isOpaque = false
        hasShadow = false
        isMovableByWindowBackground = true
        animationBehavior = .none
        title = "Kyber home"

        let view = HomeView(
            model: model, width: HomeLayout.width, onOpen: onOpen,
            onHeight: { [weak self] height in
                MainActor.assumeIsolated { self?.fit(content: height) }
            })
        let host = HomeHostingView(rootView: view)
        // The window's size is set here from the measured content; the
        // hosting view must not push its own min and max onto the window.
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

    private var displays: [HomeDisplay] {
        NSScreen.screens.map { HomeDisplay(frame: $0.frame, visible: $0.visibleFrame) }
    }

    /// Where it was dragged to, if anywhere.
    private var savedTopLeft: CGPoint? {
        guard let saved = UserDefaults.standard.array(forKey: Self.placeKey) as? [Double], saved.count == 2
        else { return nil }
        return CGPoint(x: saved[0], y: saved[1])
    }

    /// Size and place it from the saved corner and the content's height.
    func layOut() {
        let target = HomeLayout.frame(content: contentHeight, topLeft: savedTopLeft, displays: displays)
        guard target.width > 0 else { return }
        if let host, host.rootView.width != target.width {
            host.rootView = HomeView(
                model: model, width: target.width, onOpen: host.rootView.onOpen,
                onHeight: host.rootView.onHeight)
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

    private func remember() {
        guard !placing else { return }
        UserDefaults.standard.set([Double(frame.minX), Double(frame.maxY)], forKey: Self.placeKey)
    }

    /// The display arrangement changed: new limits, and back on a display.
    public func refit() {
        layOut()
    }

    /// Turned on from the menu, and whether something is hiding it now: a
    /// screen share or a denied app (main.swift `checkSuppression`). It holds
    /// names and the last line of texts, so it goes with the glass.
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
