import Foundation

/// Keeps `meeting-autopilot run` alive for as long as Kyber is: it notices a
/// meeting starting and ending and records it with no press (Caleb,
/// 2026-10-10: "Ofc star and stop on itself!!!!!!!!").
///
/// Kyber spawns it, rather than a launch agent of its own, because macOS
/// charges Microphone and Screen & System Audio Recording to the app at the
/// top of the launch chain. Kyber already holds both, so the recording it
/// starts needs no new grant and no trip to System Settings.
///
/// `run` takes a lock and exits 0 when another copy holds it, so a second
/// Kyber, or one started by hand, never doubles the watcher.
@MainActor
final class MeetingAutopilot {
    static let shared = MeetingAutopilot()

    private var process: Process?
    private var stopping = false
    // A watcher that dies on launch would otherwise be respawned in a tight
    // loop; 30 s between tries is the same order as the listener's cooldown
    // and costs at most the first 30 s of a call. Guessed, never measured.
    private let respawnDelay: TimeInterval = 30

    private func executable() -> String? {
        let home = FileManager.default.homeDirectoryForCurrentUser
        let candidates = [
            home.appendingPathComponent(".local/bin/meeting-autopilot").path,
            "/opt/homebrew/bin/meeting-autopilot",
            "/usr/local/bin/meeting-autopilot",
        ]
        return candidates.first { FileManager.default.isExecutableFile(atPath: $0) }
    }

    func start() {
        guard process == nil, !stopping, let exe = executable() else { return }
        let p = Process()
        p.executableURL = URL(fileURLWithPath: exe)
        p.arguments = ["run"]
        let logDir = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".chewbacca/logs")
        try? FileManager.default.createDirectory(at: logDir, withIntermediateDirectories: true)
        let logURL = logDir.appendingPathComponent("meeting-autopilot.log")
        if !FileManager.default.fileExists(atPath: logURL.path) {
            FileManager.default.createFile(atPath: logURL.path, contents: nil)
        }
        if let handle = try? FileHandle(forWritingTo: logURL) {
            _ = try? handle.seekToEnd()
            p.standardOutput = handle
            p.standardError = handle
        }
        p.terminationHandler = { _ in
            Task { @MainActor in
                let shared = MeetingAutopilot.shared
                shared.process = nil
                guard !shared.stopping else { return }
                DispatchQueue.main.asyncAfter(deadline: .now() + shared.respawnDelay) {
                    MainActor.assumeIsolated { shared.start() }
                }
            }
        }
        do {
            try p.run()
            process = p
        } catch {
            process = nil
        }
    }

    /// On quit: the watcher stops a recording it started, so a call is never
    /// left recording with nobody showing it.
    func stop() {
        stopping = true
        process?.terminate()
        process = nil
    }
}
