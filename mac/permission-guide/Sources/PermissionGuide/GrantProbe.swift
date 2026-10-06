import ApplicationServices
import AVFoundation
import Contacts
import CoreGraphics
import EventKit
import Foundation
import SQLite3

enum GrantStatus: String {
    case granted
    case denied
    case unknown
}

/// Answers "has this app been granted this permission yet" while the card is up.
///
/// Anarlog asks in process (ext.rs, assisted_status), because there the app
/// asking is the app being granted. Here it usually is not: this helper is a
/// bare executable, so macOS attributes every TCC question it asks to the app
/// that launched it (the terminal or editor), never to the target. That gives
/// three sources, tried in this order:
///
/// 1. `--check-command`: a shell command that exits 0 once the grant is live.
///    This is the only honest answer for a grant only the target can observe,
///    such as Accessibility, whose trust is process scoped (Anarlog's own
///    comment in ext.rs says the same about its sidecar).
/// 2. `--self`: the target IS the app that launched this helper, so Anarlog's
///    in-process APIs answer for it directly.
/// 3. The TCC databases. They name any app, but both are readable only by a
///    process whose responsible app holds Full Disk Access, so on a fresh Mac
///    this source answers `unknown` until that grant exists.
struct GrantProbe {
    let permission: Permission
    let bundleID: String?
    let appPath: String
    let checkCommand: String?
    let isSelf: Bool
    let automationTarget: String?

    var source: String {
        if checkCommand != nil { return "check-command" }
        if isSelf { return "in-process" }
        return "tcc-database"
    }

    func status() -> GrantStatus {
        if let command = checkCommand { return runCheck(command) }
        if isSelf, let answer = inProcessStatus() { return answer }
        return tccStatus()
    }

    private func runCheck(_ command: String) -> GrantStatus {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/sh")
        process.arguments = ["-c", command]
        process.standardOutput = FileHandle.nullDevice
        process.standardError = FileHandle.nullDevice
        do { try process.run() } catch { return .unknown }
        process.waitUntilExit()
        switch process.terminationStatus {
        case 0: return .granted
        // 2 is the CLI's "cannot tell" (bin/chewbacca-permissions check), kept
        // distinct so a blind probe never reads as a refusal.
        case 2: return .unknown
        default: return .denied
        }
    }

    /// Anarlog's probes (ext.rs and swift/check-permissions.swift), asked of
    /// the process that launched this helper.
    private func inProcessStatus() -> GrantStatus? {
        switch permission.id {
        case "accessibility":
            return AXIsProcessTrusted() ? .granted : .denied
        case "screen-recording-and-system-audio":
            return CGPreflightScreenCaptureAccess() ? .granted : .denied
        case "microphone":
            return AVCaptureDevice.authorizationStatus(for: .audio) == .authorized ? .granted : .denied
        case "calendars":
            if #available(macOS 14.0, *) {
                return EKEventStore.authorizationStatus(for: .event) == .fullAccess ? .granted : .denied
            }
            return EKEventStore.authorizationStatus(for: .event) == .authorized ? .granted : .denied
        case "contacts":
            return CNContactStore.authorizationStatus(for: .contacts) == .authorized ? .granted : .denied
        case "full-disk-access":
            // No API answers this one. Reading a file only Full Disk Access
            // opens is the test doctor.sh already uses (its chat.db check).
            // TCC.db is the fallback for a Mac where Messages was never opened
            // and chat.db does not exist yet.
            let home = FileManager.default.homeDirectoryForCurrentUser.path
            for path in ["\(home)/Library/Messages/chat.db", TCCDatabase.systemPath] {
                guard FileManager.default.fileExists(atPath: path) else { continue }
                if let handle = FileHandle(forReadingAtPath: path) {
                    handle.closeFile()
                    return .granted
                }
                return .denied
            }
            return nil
        default:
            return nil
        }
    }

    private func tccStatus() -> GrantStatus {
        var clients = [appPath]
        if let bundleID { clients.insert(bundleID, at: 0) }
        var sawReadable = false
        for path in TCCDatabase.paths() {
            guard let rows = TCCDatabase.authValues(at: path, service: permission.tccService,
                                                    clients: clients, target: automationTarget)
            else { continue }
            sawReadable = true
            // auth_value 2 is "allowed" in every TCC schema since Big Sur;
            // 0 is denied and 3 is "limited" (Photos only).
            if rows.contains(2) { return .granted }
        }
        // A readable database with no allowed row means the app is absent from
        // the list or switched off. Neither readable means nobody can tell.
        return sawReadable ? .denied : .unknown
    }
}

enum TCCDatabase {
    static let systemPath = "/Library/Application Support/com.apple.TCC/TCC.db"

    static var userPath: String {
        FileManager.default.homeDirectoryForCurrentUser.path
            + "/Library/Application Support/com.apple.TCC/TCC.db"
    }

    /// Overridable so tests point at fixture databases instead of the real ones.
    static func paths() -> [String] {
        let env = ProcessInfo.processInfo.environment
        return [env["CHEWBACCA_TCC_SYSTEM_DB"] ?? systemPath,
                env["CHEWBACCA_TCC_USER_DB"] ?? userPath]
    }

    /// The auth_value of every row for this service and client, or nil when the
    /// database cannot be opened at all. Read only, always: TCC.db is SIP
    /// protected and this file never tries to change a grant.
    static func authValues(at path: String, service: String, clients: [String],
                           target: String?) -> [Int]? {
        var db: OpaquePointer?
        guard sqlite3_open_v2(path, &db, SQLITE_OPEN_READONLY, nil) == SQLITE_OK else {
            sqlite3_close(db)
            return nil
        }
        defer { sqlite3_close(db) }
        let marks = Array(repeating: "?", count: clients.count).joined(separator: ",")
        var sql = "select auth_value from access where service = ? and client in (\(marks))"
        if target != nil { sql += " and indirect_object_identifier = ?" }
        var statement: OpaquePointer?
        // A database that opens but will not prepare is the unreadable case:
        // sqlite opens lazily, so a file without Full Disk Access fails here.
        guard sqlite3_prepare_v2(db, sql, -1, &statement, nil) == SQLITE_OK else { return nil }
        defer { sqlite3_finalize(statement) }
        let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)
        sqlite3_bind_text(statement, 1, service, -1, transient)
        for (index, client) in clients.enumerated() {
            sqlite3_bind_text(statement, Int32(index + 2), client, -1, transient)
        }
        if let target {
            sqlite3_bind_text(statement, Int32(clients.count + 2), target, -1, transient)
        }
        var values: [Int] = []
        while true {
            let step = sqlite3_step(statement)
            if step == SQLITE_ROW {
                values.append(Int(sqlite3_column_int(statement, 0)))
            } else if step == SQLITE_DONE {
                return values
            } else {
                return nil
            }
        }
    }
}
