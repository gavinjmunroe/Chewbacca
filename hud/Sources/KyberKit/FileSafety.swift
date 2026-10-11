import CryptoKit
import Foundation

/// Writing an edited file back without losing anybody's work (bd_2026-Code-vz4).
///
/// The File editor's save was one `String.write(atomically:)`. If the file
/// changed on disk after the panel read it (an agent's edit, a `git pull`,
/// the person's own editor) the panel's copy won silently and the other
/// change was gone with no backup to go back to.
///
/// Now every save is checked against what was on disk when the editor
/// loaded, the version it is about to replace is copied aside first, and a
/// draft nobody saved is written somewhere before its panel goes away.
public enum FileSafety {
    /// What the editor saw on disk: a digest of the bytes, not the
    /// modification date, because a date has a one-second grain on some
    /// volumes and a save and an outside edit inside one second compare equal.
    public struct Stamp: Equatable, Sendable {
        public let digest: String

        public init(data: Data) {
            digest = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
        }

        /// The stamp of what is at `url` now, or nil when nothing is there.
        public static func current(_ url: URL) -> Stamp? {
            (try? Data(contentsOf: url)).map(Stamp.init(data:))
        }
    }

    public enum Outcome: Equatable, Sendable {
        /// Written. `stamp` is the new version, to check the next save
        /// against; `backup` is where the replaced version went.
        case saved(stamp: Stamp, backup: URL?)
        /// Not written: the file is no longer what the editor loaded.
        /// `current` is nil when it was deleted.
        case conflict(current: Stamp?)
        case failed(String)
    }

    /// Where replaced versions and rescued drafts go: `~/.bob/backups` and
    /// `~/.bob/drafts`, never beside the file, where a copy would turn up in
    /// `git status` or a Finder window as a mystery file.
    public static var backups: URL { bob.appendingPathComponent("backups", isDirectory: true) }
    public static var drafts: URL { bob.appendingPathComponent("drafts", isDirectory: true) }

    private static var bob: URL {
        if let override = ProcessInfo.processInfo.environment["KYBER_FILE_SAFETY_DIR"] {
            return URL(fileURLWithPath: override, isDirectory: true)
        }
        return FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".bob", isDirectory: true)
    }

    /// Backups kept per file name, newest first. Enough to step back through
    /// one sitting of saves; guessed, never measured.
    static let keptBackups = 10

    /// Write `contents` to `url` if the file is still what the editor
    /// loaded (`expecting`), or regardless when `force` is set because the
    /// person chose to overwrite. Nil `expecting` means the file did not
    /// exist when the editor opened, so one appearing since is a conflict.
    public static func save(
        _ contents: String, to url: URL, expecting: Stamp?, force: Bool = false,
        backups: URL = FileSafety.backups, now: Date = Date()
    ) -> Outcome {
        let current = Stamp.current(url)
        if !force, current != expecting {
            return .conflict(current: current)
        }
        var backup: URL?
        if current != nil {
            do {
                backup = try keep(url, in: backups, now: now)
            } catch {
                // Refuse rather than overwrite with nothing to go back to.
                return .failed("Could not keep a backup of \(url.lastPathComponent), so it was not saved")
            }
        }
        let data = Data(contents.utf8)
        do {
            try data.write(to: url, options: .atomic)
        } catch {
            return .failed("Could not save \(url.lastPathComponent)")
        }
        return .saved(stamp: Stamp(data: data), backup: backup)
    }

    /// Copy `url` into `folder` as `<name>.<yyyyMMdd-HHmmss>.<6 hex>`, and
    /// drop the oldest copies of that name past `keptBackups`.
    static func keep(_ url: URL, in folder: URL, now: Date) throws -> URL {
        let manager = FileManager.default
        try manager.createDirectory(
            at: folder, withIntermediateDirectories: true,
            attributes: [.posixPermissions: 0o700])
        let name = url.lastPathComponent
        let target = folder.appendingPathComponent(
            "\(name).\(timestamp(now)).\(String(UUID().uuidString.prefix(6)).lowercased())")
        try manager.copyItem(at: url, to: target)
        let siblings = (try? manager.contentsOfDirectory(atPath: folder.path)) ?? []
        let mine = siblings.filter { $0.hasPrefix(name + ".") && $0.dropFirst(name.count + 1).first?.isNumber == true }
            .sorted(by: >)
        for stale in mine.dropFirst(keptBackups) {
            try? manager.removeItem(at: folder.appendingPathComponent(stale))
        }
        return target
    }

    /// Keep an unsaved draft of `path` where it can be found again, because
    /// its panel is going away. Returns where it went.
    @discardableResult
    public static func rescue(
        draft: String, of path: String, in folder: URL = FileSafety.drafts, now: Date = Date()
    ) -> URL? {
        let manager = FileManager.default
        guard (try? manager.createDirectory(
            at: folder, withIntermediateDirectories: true,
            attributes: [.posixPermissions: 0o700])) != nil else { return nil }
        let target = draftURL(for: path, in: folder)
        guard (try? Data(draft.utf8).write(to: target, options: .atomic)) != nil else { return nil }
        try? manager.setAttributes([.posixPermissions: 0o600], ofItemAtPath: target.path)
        return target
    }

    /// The rescued draft of `path`, if one is waiting.
    public static func rescued(_ path: String, in folder: URL = FileSafety.drafts) -> String? {
        try? String(contentsOf: draftURL(for: path, in: folder), encoding: .utf8)
    }

    /// Forget a rescued draft once it is restored or saved.
    public static func forget(_ path: String, in folder: URL = FileSafety.drafts) {
        try? FileManager.default.removeItem(at: draftURL(for: path, in: folder))
    }

    /// One draft per path: the file's name, for a person looking in the
    /// folder, and a digest of the whole path, so two `notes.md` in
    /// different folders do not share one.
    static func draftURL(for path: String, in folder: URL) -> URL {
        let full = (path as NSString).expandingTildeInPath
        let digest = SHA256.hash(data: Data(full.utf8)).prefix(6)
            .map { String(format: "%02x", $0) }.joined()
        return folder.appendingPathComponent(
            "\((full as NSString).lastPathComponent).\(digest).draft")
    }

    private static func timestamp(_ date: Date) -> String {
        let format = DateFormatter()
        format.locale = Locale(identifier: "en_US_POSIX")
        format.timeZone = TimeZone(identifier: "UTC")
        format.dateFormat = "yyyyMMdd-HHmmss"
        return format.string(from: date)
    }
}
