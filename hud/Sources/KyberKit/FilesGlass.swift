import AppKit
import Foundation

/// A folder, on the glass: the few newest things in it, pressable.
///
/// This replaced a two-pane file manager (CHW-198). That one was an NSPanel
/// that took the keyboard, hid its close button and could not be resized, and
/// on 2026-10-09 Caleb could not get it off the screen: Escape went to the
/// glass, which never takes key, so it never reached the panel. It was also a
/// copy of Finder, which is the thing the HUD exists not to be (docs/NO-APPS.md,
/// kyber-surfaces rule 10, "don't mirror the app").
///
/// So this is an ordinary surface, drawn with the same protocol lines any
/// sender uses, and it goes the way every surface goes: Escape clears the
/// glass, a click anywhere outside it takes it down (`clickedAway`), "close
/// files" and `files off` close it, and so does the X on its card.
///
/// A row's one button, Look, does what the row needs without opening an app:
/// a folder is stepped into on the glass, a document the HUD can draw itself
/// (PDF, image, plain text) is previewed in place, and anything else is shown
/// in Finder, never launched. The primary button opens the previewed document
/// in its viewer, the same allowlist as `bin/lib/surfaces/files.py`.
public struct FilesGlass: Equatable, Sendable {
    /// Not `files`: kyber-surfaces already draws a surface called `files`
    /// (recent downloads) and writes under `/files/`. Two senders on one name
    /// would overwrite each other's rows.
    public static let id = "disk"
    /// Seven, the same as the downloads surface: under the nine-row ceiling of
    /// kyber-surfaces rule 3, and room for the Up row.
    public static let most = 7
    /// Documents Kyber's File component draws and macOS opens in a viewer,
    /// never as a program. Copied from `PASSIVE` in bin/lib/surfaces/files.py,
    /// whose security review on 2026-10-04 is why it is an allowlist.
    public static let passive: Set<String> = [
        "pdf", "png", "jpg", "jpeg", "gif", "heic", "webp", "tiff", "bmp",
        "txt", "md", "markdown", "csv",
    ]
    /// Still being written by a browser.
    static let partial: Set<String> = ["crdownload", "download", "part", "partial"]
    /// The row id that goes up a folder.
    public static let up = ".."

    public struct Row: Equatable, Sendable {
        public let url: URL
        public let isFolder: Bool
        public let isPassive: Bool
        public let modified: Date?
        public let size: Int64?
        public var name: String { url.lastPathComponent }
    }

    /// What a press asks the machine to do. Kept apart from doing it, so a
    /// test can press every row without anything opening.
    public enum Effect: Equatable, Sendable {
        case none
        case openDocument(URL)
        case reveal(URL)
    }

    /// The folder the surface was asked for. Up stops here, so stepping into
    /// folders never turns into browsing the whole disk.
    public private(set) var root: URL
    public private(set) var folder: URL
    public private(set) var rows: [Row] = []
    public private(set) var previewed: URL?
    public private(set) var note = ""
    public private(set) var status = ""

    /// `files` with no path is Downloads; `~` and relative paths read from
    /// home; a file opens its folder with that file previewed.
    public init(path: String?, home: URL = FileManager.default.homeDirectoryForCurrentUser) {
        let typed = (path ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        var target = home.appendingPathComponent("Downloads", isDirectory: true)
        if !typed.isEmpty {
            let expanded = (typed as NSString).expandingTildeInPath
            target = expanded.hasPrefix("/")
                ? URL(fileURLWithPath: expanded)
                : home.appendingPathComponent(expanded)
        }
        target = target.standardizedFileURL
        var isDirectory: ObjCBool = false
        let exists = FileManager.default.fileExists(atPath: target.path, isDirectory: &isDirectory)
        if exists, !isDirectory.boolValue {
            root = target.deletingLastPathComponent()
            folder = root
            reload()
            if Self.isPassive(target) { previewed = target }
        } else {
            root = target
            folder = target
            reload()
        }
    }

    /// Read the folder again: newest first, hidden and half-downloaded files
    /// left out, at most `most`. A folder that cannot be read says why.
    public mutating func reload() {
        let keys: [URLResourceKey] = [
            .isDirectoryKey, .isPackageKey, .contentModificationDateKey, .fileSizeKey,
        ]
        do {
            let found = try FileManager.default.contentsOfDirectory(
                at: folder, includingPropertiesForKeys: keys, options: [.skipsHiddenFiles])
            rows = found
                .filter { !Self.partial.contains($0.pathExtension.lowercased()) }
                .map { url in
                    let values = try? url.resourceValues(forKeys: Set(keys))
                    // An app bundle is a directory, but stepping into one is
                    // not what anyone pressing it meant.
                    let folder = (values?.isDirectory ?? false) && !(values?.isPackage ?? false)
                    return Row(
                        url: url, isFolder: folder, isPassive: Self.isPassive(url),
                        modified: values?.contentModificationDate,
                        size: values?.fileSize.map(Int64.init))
                }
                .sorted { ($0.modified ?? .distantPast) > ($1.modified ?? .distantPast) }
            rows = Array(rows.prefix(Self.most))
            note = rows.isEmpty ? "\(Self.title(folder)) is empty." : FileFormat.display(folder)
        } catch {
            rows = []
            note = "Can't read \(Self.title(folder)): \(error.localizedDescription)"
        }
    }

    /// Only a regular file, not a link, with a passive extension.
    static func isPassive(_ url: URL) -> Bool {
        guard passive.contains(url.pathExtension.lowercased()),
              let values = try? url.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey])
        else { return false }
        return values.isRegularFile == true && values.isSymbolicLink != true
    }

    static func title(_ url: URL) -> String {
        url.path == "/" ? "/" : url.lastPathComponent
    }

    /// The row with this id. The id is the file's name inside `folder`, never
    /// a path, so a press can only reach what is on the list.
    func row(_ id: String) -> Row? {
        rows.first { $0.name == id }
    }

    /// Look on a row.
    public mutating func look(_ id: String) -> Effect {
        status = ""
        if id == Self.up {
            guard folder.path != root.path else { return .none }
            folder = folder.deletingLastPathComponent().standardizedFileURL
            previewed = nil
            reload()
            return .none
        }
        guard let row = row(id) else {
            status = "That isn't on the list any more."
            return .none
        }
        if row.isFolder {
            folder = row.url.standardizedFileURL
            previewed = nil
            reload()
            return .none
        }
        // Re-checked at press time: the file may have been swapped for a link
        // or an app since the list was drawn.
        if Self.isPassive(row.url) {
            previewed = row.url
            return .none
        }
        status = "\(row.name) is shown in Finder; only documents open from here."
        return .reveal(row.url)
    }

    /// The primary button: open what is previewed, else show the folder.
    public mutating func go() -> Effect {
        if let previewed, Self.isPassive(previewed) {
            status = "Opened \(previewed.lastPathComponent)."
            return .openDocument(previewed)
        }
        status = ""
        return .reveal(folder)
    }

    var goLabel: String { previewed == nil ? "Show in Finder" : "Open" }

    // MARK: Lines

    private static func cid(_ name: String) -> String { "\(id)-\(name)" }
    private static func pointer(_ name: String) -> String { "/\(id)/\(name)" }
    public static let lookAction = "disk-look"
    public static let goAction = "disk-go"

    /// The surface as protocol lines, the same ones any sender writes. Sent
    /// whole on every change: a `c` for an id already there updates it and a
    /// `>` sets the children, so nothing flickers.
    public func lines(now: Date = Date()) -> [String] {
        var table: [[String: String]] = []
        if folder.path != root.path {
            table.append(["id": Self.up, "name": "Up to \(Self.title(folder.deletingLastPathComponent()))",
                          "added": "", "size": ""])
        }
        for row in rows {
            table.append([
                "id": row.name,
                "name": row.isFolder ? row.name + "/" : row.name,
                "added": FileFormat.date(row.modified, now: now),
                "size": row.isFolder ? "folder" : FileFormat.size(row.size),
            ])
        }
        let columns = [
            ["field": "name", "label": "Name"], ["field": "added", "label": "Added"],
            ["field": "size", "label": "Size"],
        ]
        var children = [Self.cid("note"), Self.cid("table")]
        if previewed != nil { children.append(Self.cid("file")) }
        children += [Self.cid("go"), Self.cid("status")]
        return [
            "@ \(Self.id) at=left w=420",
            "c \(Self.cid("s")) Screen title=\(Self.json(Self.title(folder).uppercased()))",
            "c \(Self.cid("note")) Text value=@\(Self.pointer("note")) tone=\"muted\"",
            "c \(Self.cid("table")) Table columns=\(Self.json(columns)) rows=@\(Self.pointer("rows"))"
                + " action=\"\(Self.lookAction)\" actionLabel=\"Look\"",
            "c \(Self.cid("file")) File path=@\(Self.pointer("path"))",
            "c \(Self.cid("go")) Button label=@\(Self.pointer("go")) action=\"\(Self.goAction)\" variant=\"primary\"",
            "c \(Self.cid("status")) Text value=@\(Self.pointer("status")) tone=\"muted\"",
            "> \(Self.cid("s")) " + children.joined(separator: " "),
            "d \(Self.pointer("note")) \(Self.json(note))",
            "d \(Self.pointer("rows")) \(Self.json(table))",
            "d \(Self.pointer("path")) \(Self.json(previewed?.path ?? ""))",
            "d \(Self.pointer("go")) \(Self.json(goLabel))",
            "d \(Self.pointer("status")) \(Self.json(status))",
            "r \(Self.cid("s"))",
        ]
    }

    private static func json(_ value: Any) -> String {
        guard let data = try? JSONSerialization.data(
            withJSONObject: value, options: [.fragmentsAllowed, .sortedKeys, .withoutEscapingSlashes]),
              let text = String(data: data, encoding: .utf8)
        else { return "\"\"" }
        return text
    }

    /// Do what a press asked. Opening is only ever a passive document, in
    /// whatever viewer macOS has for it; everything else is revealed.
    @MainActor
    public static func perform(_ effect: Effect) {
        switch effect {
        case .none:
            break
        case .openDocument(let url):
            guard isPassive(url) else { return }
            NSWorkspace.shared.open(url)
        case .reveal(let url):
            NSWorkspace.shared.activateFileViewerSelecting([url])
        }
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
