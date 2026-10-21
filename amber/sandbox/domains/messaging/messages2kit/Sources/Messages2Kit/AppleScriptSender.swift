// Send iMessages by driving Messages.app via osascript.
//
// Ports the photon-hq/imessage-kit send templates verbatim. Apple's only
// public send path on macOS is AppleScript; there's no SPI we can call.
//
// Three send modes:
//   1. DM text:        `tell app "Messages" to send "..." to buddy "+1..."`
//   2. Group text:     `tell app "Messages" to send "..." to chat id "..."`
//   3. Attachment:     stage into ~/Pictures via mktemp + chmod 600, then
//                      send `(POSIX file ... ) as alias`. Required because
//                      Messages.app's sandbox refuses arbitrary paths.
//
// Status check: probe Messages.app's running state before sending so we
// can return a useful error ("Messages.app isn't running") instead of an
// AppleScript timeout.

import Foundation

public actor AppleScriptSender {
    private let scriptTimeout: TimeInterval
    private let debug: Bool

    public init(scriptTimeout: TimeInterval = 30, debug: Bool = false) {
        self.scriptTimeout = scriptTimeout
        self.debug = debug
    }

    // MARK: - Public send

    /// Send text. The caller decides the routing: if `chatId` is a chat
    /// GUID (starts with "chat" or contains semicolons) we use the group
    /// path; otherwise we treat it as a buddy address.
    public func sendText(_ text: String, to chatIdOrBuddy: String) async throws {
        try await ensureMessagesRunning()
        let escapedText = Self.escapeAppleScript(text)
        let escapedTarget = Self.escapeAppleScript(chatIdOrBuddy)
        let isGroup = Self.looksLikeGroupChatId(chatIdOrBuddy)
        let script: String
        if isGroup {
            script = """
                tell application "Messages"
                    set targetChat to chat id "\(escapedTarget)"
                    send "\(escapedText)" to targetChat
                end tell
            """
        } else {
            script = """
                tell application "Messages"
                    set targetBuddy to buddy "\(escapedTarget)"
                    send "\(escapedText)" to targetBuddy
                end tell
            """
        }
        try await runOsascript(script)
    }

    /// Send a file attachment. Stages into ~/Pictures via mktemp because
    /// Messages.app's sandbox rejects paths outside whitelisted dirs.
    /// Cleanup of the staged file is intentionally deferred — Messages
    /// reads asynchronously, so deleting too soon can fail the send.
    public func sendAttachment(at fileURL: URL, to chatIdOrBuddy: String) async throws {
        try await ensureMessagesRunning()
        let isGroup = Self.looksLikeGroupChatId(chatIdOrBuddy)
        let escapedTarget = Self.escapeAppleScript(chatIdOrBuddy)
        let escapedFilePath = Self.escapeAppleScript(fileURL.path)
        let template = "messages2_send_XXXXXX"
        let body: String
        if isGroup {
            body = "set targetChat to chat id \"\(escapedTarget)\"\n            send theFile to targetChat"
        } else {
            body = "set targetBuddy to buddy \"\(escapedTarget)\"\n            send theFile to targetBuddy"
        }
        let script = """
            tell application "Messages"
                set picturesFolder to POSIX path of (path to pictures folder)
                set targetPath to do shell script "mktemp " & quoted form of (picturesFolder & "\(template)")
                do shell script "cat " & quoted form of "\(escapedFilePath)" & " > " & quoted form of targetPath & " && chmod 600 " & quoted form of targetPath
                set theFile to (POSIX file targetPath) as alias
                \(body)
            end tell
        """
        try await runOsascript(script)
    }

    // MARK: - Status

    /// Probe whether Messages.app is running. Returns false if the System
    /// Events query fails (rare) — caller should treat as unknown.
    public func isMessagesRunning() async -> Bool {
        let script = "tell application \"System Events\" to (name of processes) contains \"Messages\""
        do {
            let out = try await runOsascript(script, timeout: 5)
            return out.trimmingCharacters(in: .whitespacesAndNewlines) == "true"
        } catch {
            return false
        }
    }

    /// Probe whether we have Automation permission to control Messages.app.
    /// Returns one of: granted, denied, messagesNotRunning, unknown.
    public func probeAutomationStatus() async -> AutomationStatus {
        if await !isMessagesRunning() { return .messagesNotRunning }
        do {
            _ = try await runOsascript("tell application \"Messages\" to get version", timeout: 5)
            return .granted
        } catch let e as SenderError {
            if case .scriptFailed(let msg) = e,
               msg.contains("-1743") || msg.lowercased().contains("not authorized") {
                return .denied
            }
            return .unknown
        } catch {
            return .unknown
        }
    }

    public enum AutomationStatus: Sendable {
        case granted, denied, messagesNotRunning, unknown
    }

    // MARK: - Internals

    private func ensureMessagesRunning() async throws {
        if await isMessagesRunning() { return }
        throw MessagesProviderError.sendFailed(reason: "Messages.app isn't running. Open it from /Applications and try again.")
    }

    @discardableResult
    private func runOsascript(_ script: String, timeout: TimeInterval? = nil) async throws -> String {
        let timeoutSec = timeout ?? scriptTimeout
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/osascript")
        process.arguments = ["-e", script]
        let stdout = Pipe()
        let stderr = Pipe()
        process.standardOutput = stdout
        process.standardError = stderr

        try process.run()

        // Race a Task.sleep timeout against process termination. First to
        // resolve wins; the loser is cancelled.
        let pidBox = ProcessBox(process)
        let timeoutTask = Task<Void, Never> {
            try? await Task.sleep(nanoseconds: UInt64(timeoutSec * 1_000_000_000))
            if !Task.isCancelled { pidBox.terminateIfRunning() }
        }
        defer { timeoutTask.cancel() }

        process.waitUntilExit()
        let outData = (try? stdout.fileHandleForReading.readToEnd()) ?? Data()
        let errData = (try? stderr.fileHandleForReading.readToEnd()) ?? Data()
        let outStr = String(data: outData, encoding: .utf8) ?? ""
        let errStr = String(data: errData, encoding: .utf8) ?? ""
        if debug && !errStr.isEmpty {
            FileHandle.standardError.write(Data("[AppleScript] \(errStr)\n".utf8))
        }
        if process.terminationStatus != 0 {
            throw SenderError.scriptFailed(
                errStr.isEmpty ? "osascript exit \(process.terminationStatus)" : errStr
            )
        }
        return outStr
    }

    // MARK: - Helpers

    /// Group chat ids in chat.db look like `chat<guid>` or `iMessage;+;chat<guid>`.
    /// Bare phone/email never starts with "chat" and never contains ";".
    static func looksLikeGroupChatId(_ s: String) -> Bool {
        if s.contains(";") { return true }
        if s.hasPrefix("chat") { return true }
        return false
    }

    /// AppleScript strings use double quotes and escape with backslash.
    /// We must also escape backslashes themselves.
    static func escapeAppleScript(_ s: String) -> String {
        s.replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "\"", with: "\\\"")
    }
}

enum SenderError: Error {
    case scriptFailed(String)
}

/// Tiny Sendable wrapper so the timeout Task can call `terminate()` on
/// a Process from a separate task. Process itself isn't Sendable; this
/// box pins our usage to "read isRunning + terminate", which is safe.
final class ProcessBox: @unchecked Sendable {
    private let process: Process
    init(_ process: Process) { self.process = process }
    func terminateIfRunning() {
        if process.isRunning { process.terminate() }
    }
}
