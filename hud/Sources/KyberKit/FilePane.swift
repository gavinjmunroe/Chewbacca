import AppKit
import Foundation

// The file manager's model: what a row is, what a pane is, how the two panes
// move, and the four operations that touch the disk. No views here, so all of
// it is testable against temp directories without a window. The panel that
// draws it is FilesPanel.swift.

/// One row: a file or a folder in a pane's directory.
public struct FileItem: Identifiable, Hashable, Sendable {
    public var id: URL { url }
    public let url: URL
    public let name: String
    public let isDirectory: Bool
    /// Bytes, for a file. A folder's size would mean walking it, which is the
    /// kind of work that stalls a listing, so a folder has none.
    public let size: Int64?
    public let modified: Date?
    /// The icon Finder would draw, read off the main thread with the listing.
    /// Not part of equality: two listings of the same folder are the same rows.
    public let icon: IconBox?

    public init(
        url: URL, name: String, isDirectory: Bool, size: Int64? = nil,
        modified: Date? = nil, icon: IconBox? = nil
    ) {
        self.url = url
        self.name = name
        self.isDirectory = isDirectory
        self.size = size
        self.modified = modified
        self.icon = icon
    }

    public static func == (a: FileItem, b: FileItem) -> Bool {
        a.url == b.url && a.isDirectory == b.isDirectory && a.size == b.size
            && a.modified == b.modified
    }

    public func hash(into hasher: inout Hasher) { hasher.combine(url) }
}

/// An NSImage carried across the thread boundary once, then only read.
///
/// `NSImage` is not Sendable. The listing builds each icon on a background
/// task and never mutates it after, and the view only draws it, so handing the
/// finished object to the main actor is safe in practice; this box says so in
/// one place instead of at every use.
public final class IconBox: @unchecked Sendable {
    public let image: NSImage
    public init(_ image: NSImage) { self.image = image }
}

/// Reads a directory. Called through `Task.detached` by the panel, so the
/// disk is never touched on the main thread.
public enum DirectoryLoader {
    static let keys: [URLResourceKey] = [
        .isDirectoryKey, .fileSizeKey, .contentModificationDateKey,
        .effectiveIconKey, .localizedNameKey, .isPackageKey,
    ]

    /// Folders first, then names in Finder's order ("file 2" before "file 10").
    public static func list(
        _ directory: URL, showHidden: Bool = false, icons: Bool = true,
        fileManager: FileManager = .default
    ) throws -> [FileItem] {
        let options: FileManager.DirectoryEnumerationOptions =
            showHidden ? [] : [.skipsHiddenFiles]
        let urls = try fileManager.contentsOfDirectory(
            at: directory, includingPropertiesForKeys: keys, options: options)
        let items = urls.map { url -> FileItem in
            let values = try? url.resourceValues(forKeys: Set(keys))
            // A package (an .app, a .bundle) is a directory on disk and a
            // document to a person. It opens; it does not navigate.
            let isDirectory = (values?.isDirectory ?? false) && !(values?.isPackage ?? false)
            let icon = icons ? (values?.effectiveIcon as? NSImage).map(IconBox.init) : nil
            return FileItem(
                url: url,
                name: url.lastPathComponent,
                isDirectory: isDirectory,
                size: isDirectory ? nil : values?.fileSize.map(Int64.init),
                modified: values?.contentModificationDate,
                icon: icon)
        }
        return sorted(items)
    }

    public static func sorted(_ items: [FileItem]) -> [FileItem] {
        items.sorted { a, b in
            if a.isDirectory != b.isDirectory { return a.isDirectory }
            return a.name.localizedStandardCompare(b.name) == .orderedAscending
        }
    }
}

public enum PaneSide: String, Sendable, CaseIterable {
    case left, right
    public var other: PaneSide { self == .left ? .right : .left }
}

/// One column: a directory, what is in it, and which row is picked.
public struct PaneState: Equatable, Sendable {
    public var directory: URL
    public var items: [FileItem] = []
    /// Always a valid index into `items`, or 0 when there are none.
    public private(set) var selected: Int = 0
    public var error: String?
    public var loading = false

    public init(directory: URL, items: [FileItem] = [], selected: Int = 0) {
        self.directory = directory.standardizedFileURL
        self.items = items
        self.selected = 0
        select(selected)
    }

    public var selection: FileItem? {
        items.indices.contains(selected) ? items[selected] : nil
    }

    /// Clamp, never wrap: holding Down at the bottom stays at the bottom,
    /// which is what every list on the platform does.
    public mutating func select(_ index: Int) {
        selected = items.isEmpty ? 0 : min(max(index, 0), items.count - 1)
    }

    public mutating func move(by delta: Int) { select(selected + delta) }

    /// New rows for the same pane. Keeps the picked row by URL when it is
    /// still there, else picks `prefer` (the folder just left, on going up),
    /// else holds the index as near as the new list allows.
    public mutating func replace(items new: [FileItem], prefer: URL? = nil) {
        let keep = selection?.url
        items = new
        error = nil
        loading = false
        if let prefer, let i = new.firstIndex(where: { $0.url.standardizedFileURL == prefer.standardizedFileURL }) {
            select(i)
        } else if let keep, let i = new.firstIndex(where: { $0.url == keep }) {
            select(i)
        } else {
            select(selected)
        }
    }

    /// The folder above, or nil at the root of the disk.
    public var parent: URL? {
        let path = directory.standardizedFileURL.path
        guard path != "/" else { return nil }
        return directory.standardizedFileURL.deletingLastPathComponent()
    }
}

/// What pressing Enter on a row means.
public enum Activation: Equatable, Sendable {
    case navigate(URL)
    case open(URL)
}

/// Both panes and which one has the keyboard. Pure: every key the panel
/// handles is one call here, then a load if the directory changed.
public struct FileManagerState: Equatable, Sendable {
    public var left: PaneState
    public var right: PaneState
    public var active: PaneSide = .left

    public init(left: URL, right: URL) {
        self.left = PaneState(directory: left)
        self.right = PaneState(directory: right)
    }

    public subscript(side: PaneSide) -> PaneState {
        get { side == .left ? left : right }
        set { if side == .left { left = newValue } else { right = newValue } }
    }

    public var activePane: PaneState {
        get { self[active] }
        set { self[active] = newValue }
    }

    public var inactivePane: PaneState { self[active.other] }

    public mutating func toggle() { active = active.other }

    public mutating func moveSelection(by delta: Int) { activePane.move(by: delta) }

    /// Enter: a folder navigates, anything else opens.
    public func activation() -> Activation? {
        guard let item = activePane.selection else { return nil }
        return item.isDirectory ? .navigate(item.url) : .open(item.url)
    }

    /// Point the active pane at `url`. The rows arrive later, from a load;
    /// until then the old ones stay up, marked loading, never an empty flash.
    public mutating func navigate(to url: URL) {
        activePane.directory = url.standardizedFileURL
        activePane.loading = true
        activePane.error = nil
    }

    /// Backspace. Returns the folder it left, so the load can re-select it,
    /// or nil at `/` where there is nowhere to go.
    @discardableResult
    public mutating func goToParent() -> URL? {
        guard let parent = activePane.parent else { return nil }
        let left = activePane.directory
        navigate(to: parent)
        return left
    }
}

/// The operations that write. Every one refuses rather than overwrite, and
/// nothing here deletes: F8 is the Trash, which a person can open and undo.
public enum FileOps {
    public enum Failure: Error, Equatable, CustomStringConvertible {
        case sameFolder(String)
        case intoItself(String)
        case missing(String)
        case notAFolder(String)
        case invalidName(String)

        public var description: String {
            switch self {
            case .sameFolder(let name): return "\(name) is already in that folder."
            case .intoItself(let name): return "Can't put \(name) inside itself."
            case .missing(let name): return "\(name) isn't there anymore."
            case .notAFolder(let path): return "\(path) isn't a folder."
            case .invalidName(let name): return "\"\(name)\" can't be a folder name."
            }
        }
    }

    /// `name` if nothing in `directory` has it, else "name 2", "name 3" and
    /// so on, the way Finder's Keep Both names a copy. The extension stays
    /// on the end: "report 2.pdf", not "report.pdf 2".
    public static func freeName(
        for name: String, in directory: URL, fileManager: FileManager = .default
    ) -> String {
        func taken(_ candidate: String) -> Bool {
            fileManager.fileExists(atPath: directory.appendingPathComponent(candidate).path)
        }
        guard taken(name) else { return name }
        let ext = (name as NSString).pathExtension
        let stem = ext.isEmpty ? name : (name as NSString).deletingPathExtension
        var n = 2
        while true {
            let candidate = ext.isEmpty ? "\(stem) \(n)" : "\(stem) \(n).\(ext)"
            if !taken(candidate) { return candidate }
            n += 1
        }
    }

    /// Copy `source` into `directory`. A name clash keeps both; it never
    /// replaces what was there. Returns where the copy landed.
    @discardableResult
    public static func copy(
        _ source: URL, into directory: URL, fileManager: FileManager = .default
    ) throws -> URL {
        let target = try destination(for: source, in: directory, fileManager: fileManager, moving: false)
        try fileManager.copyItem(at: source, to: target)
        return target
    }

    /// Move `source` into `directory`, keeping both on a clash.
    @discardableResult
    public static func move(
        _ source: URL, into directory: URL, fileManager: FileManager = .default
    ) throws -> URL {
        let target = try destination(for: source, in: directory, fileManager: fileManager, moving: true)
        try fileManager.moveItem(at: source, to: target)
        return target
    }

    /// The Trash, never `removeItem`. Returns where it went in the Trash.
    @discardableResult
    public static func trash(_ url: URL, fileManager: FileManager = .default) throws -> URL? {
        guard fileManager.fileExists(atPath: url.path) else {
            throw Failure.missing(url.lastPathComponent)
        }
        var landed: NSURL?
        try fileManager.trashItem(at: url, resultingItemURL: &landed)
        return landed as URL?
    }

    /// A new, empty folder in `directory`, named `name` or the next free
    /// "name 2". Refuses a name with a slash or a leading dot-dot.
    @discardableResult
    public static func newFolder(
        named name: String, in directory: URL, fileManager: FileManager = .default
    ) throws -> URL {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, !trimmed.contains("/"), !trimmed.contains(":"),
              trimmed != ".", trimmed != ".."
        else { throw Failure.invalidName(name) }
        let target = directory.appendingPathComponent(
            freeName(for: trimmed, in: directory, fileManager: fileManager))
        try fileManager.createDirectory(at: target, withIntermediateDirectories: false)
        return target
    }

    private static func destination(
        for source: URL, in directory: URL, fileManager: FileManager, moving: Bool
    ) throws -> URL {
        let src = source.standardizedFileURL.resolvingSymlinksInPath()
        let dir = directory.standardizedFileURL.resolvingSymlinksInPath()
        let name = src.lastPathComponent
        guard fileManager.fileExists(atPath: src.path) else { throw Failure.missing(name) }
        var isDir: ObjCBool = false
        guard fileManager.fileExists(atPath: dir.path, isDirectory: &isDir), isDir.boolValue else {
            throw Failure.notAFolder(dir.path)
        }
        // A folder copied into itself or anything under it would recurse
        // until the disk filled.
        let srcPath = src.path.hasSuffix("/") ? src.path : src.path + "/"
        if dir.path == src.path || (dir.path + "/").hasPrefix(srcPath) {
            throw Failure.intoItself(name)
        }
        // Moving a thing to where it already is would only rename it to
        // "name 2", which nobody pressing F6 meant.
        if moving, src.deletingLastPathComponent().path == dir.path {
            throw Failure.sameFolder(name)
        }
        return dir.appendingPathComponent(freeName(for: name, in: dir, fileManager: fileManager))
    }
}

/// Sizes and dates the way the rows print them.
public enum FileFormat {
    public static func size(_ bytes: Int64?) -> String {
        guard let bytes else { return "" }
        return ByteCountFormatter.string(fromByteCount: bytes, countStyle: .file)
    }

    /// Today shows the time, this year the day, older the year: the question
    /// a modified date answers is "how stale is this", and the precision
    /// should fall off with the answer.
    public static func date(_ date: Date?, now: Date = Date(), calendar: Calendar = .current) -> String {
        guard let date else { return "" }
        if calendar.isDate(date, inSameDayAs: now) {
            return date.formatted(date: .omitted, time: .shortened)
        }
        if calendar.component(.year, from: date) == calendar.component(.year, from: now) {
            return date.formatted(.dateTime.month(.abbreviated).day())
        }
        return date.formatted(.dateTime.month(.abbreviated).day().year())
    }

    /// `~` for the home folder in the path field, the way a person types it.
    public static func display(_ url: URL, home: String = NSHomeDirectory()) -> String {
        let path = url.standardizedFileURL.path
        if path == home { return "~" }
        if path.hasPrefix(home + "/") { return "~" + path.dropFirst(home.count) }
        return path
    }

    /// What was typed into the path field, as a URL: `~` expanded, relative
    /// paths taken from the active pane's folder.
    public static func resolve(_ typed: String, relativeTo base: URL) -> URL {
        let trimmed = typed.trimmingCharacters(in: .whitespacesAndNewlines)
        let expanded = (trimmed as NSString).expandingTildeInPath
        if expanded.hasPrefix("/") { return URL(fileURLWithPath: expanded).standardizedFileURL }
        return base.appendingPathComponent(expanded).standardizedFileURL
    }
}
