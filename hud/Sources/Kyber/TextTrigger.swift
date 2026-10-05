import Foundation
import os

/// Wakes `text-command` when Messages writes to its database, so a text to
/// yourself that starts with "Kyber" is answered as a text.
///
/// An event from the kernel, not a timer: "i dont want a watcher i just want
/// something that works like an if statement... not burning credits scanning"
/// (2026-10-03). Nothing runs between texts. On a write the script reads the
/// rows after the last one it saw and exits, and only a command reaches a
/// model.
///
/// Opening the file needs Full Disk Access for Kyber, and the script it starts
/// inherits it. Without it the open fails, one line says so, and nothing else
/// happens until Kyber is started again.
@MainActor
final class TextTrigger {
    static let shared = TextTrigger()
    private static let log = Logger(subsystem: "kyber", category: "texts")

    /// Messages appends every new message to the write-ahead log first, so
    /// this is the file that changes when a text arrives. The database itself
    /// only changes when the log is folded back in.
    private let path = FileManager.default.homeDirectoryForCurrentUser
        .appendingPathComponent("Library/Messages/chat.db-wal").path
    private var source: DispatchSourceFileSystemObject?
    private var pending: DispatchWorkItem?
    private var running: Process?
    private var again = false

    /// One text writes the log several times within a few hundred ms, and the
    /// script should run once for it. Guessed, never measured.
    private static let settle: TimeInterval = 0.5

    func start() {
        guard source == nil else { return }
        let fd = open(path, O_EVTONLY)
        guard fd >= 0 else {
            Self.log.notice("texts.unavailable errno=\(errno) (Full Disk Access for Kyber?)")
            return
        }
        let source = DispatchSource.makeFileSystemObjectSource(
            fileDescriptor: fd, eventMask: [.write, .extend, .delete, .rename], queue: .main)
        source.setEventHandler { [weak self] in
            MainActor.assumeIsolated {
                guard let self, let source = self.source else { return }
                if !source.data.isDisjoint(with: [.delete, .rename]) {
                    // Messages replaced the log (a checkpoint, a restart).
                    // The open descriptor now points at nothing; open the new one.
                    self.stop()
                    DispatchQueue.main.asyncAfter(deadline: .now() + 1) { self.start() }
                }
                self.changed()
            }
        }
        source.setCancelHandler { close(fd) }
        source.resume()
        self.source = source
        Self.log.notice("texts.listening")
    }

    private func stop() {
        source?.cancel()
        source = nil
    }

    private func changed() {
        pending?.cancel()
        let work = DispatchWorkItem { [weak self] in
            MainActor.assumeIsolated { self?.run() }
        }
        pending = work
        DispatchQueue.main.asyncAfter(deadline: .now() + Self.settle, execute: work)
    }

    private func run() {
        if let running, running.isRunning {
            // The script reads to the end of the thread before it exits, but a
            // text after its last read would wait for the next write. One more
            // run once this one ends covers it.
            again = true
            return
        }
        let exe = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".local/bin/text-command").path
        guard FileManager.default.isExecutableFile(atPath: exe) else { return }
        let process = Process()
        process.executableURL = URL(fileURLWithPath: exe)
        process.standardOutput = FileHandle.nullDevice
        process.standardError = FileHandle.nullDevice
        process.terminationHandler = { [weak self] _ in
            Task { @MainActor in
                guard let self else { return }
                self.running = nil
                if self.again {
                    self.again = false
                    self.run()
                }
            }
        }
        do {
            try process.run()
            running = process
        } catch {
            Self.log.notice("texts.start_failed \(error.localizedDescription, privacy: .public)")
        }
    }
}
