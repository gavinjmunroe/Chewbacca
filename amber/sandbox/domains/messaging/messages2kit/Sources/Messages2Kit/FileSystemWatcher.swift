// Watch chat.db for new messages.
//
// The photon SDK polls every 2 seconds. We do better: macOS Messages.app
// writes to chat.db via SQLite WAL, so chat.db-wal mutates on every new
// message. DispatchSource.FileSystemObject fires on that mutation within
// ~50ms, and we follow up with a chat.db query for ROWIDs > last seen.
//
// The roadmap (4.2.4) calls for ~250ms debounce to avoid spamming during
// message bursts. We honor that here.

import Foundation

public actor FileSystemWatcher {
    private let walPath: URL
    private let debounce: TimeInterval
    private var source: DispatchSourceFileSystemObject?
    private var fd: Int32 = -1
    private var debounceTask: Task<Void, Never>?
    private var onChange: (@Sendable () async -> Void)?

    public init(
        dbPath: URL = ChatDatabase.defaultPath,
        debounce: TimeInterval = 0.25
    ) {
        // chat.db-wal sits alongside chat.db; that's where SQLite buffers
        // new writes before they get checkpointed back into chat.db.
        self.walPath = dbPath.deletingLastPathComponent()
            .appendingPathComponent(dbPath.lastPathComponent + "-wal")
        self.debounce = debounce
    }

    public func start(onChange: @escaping @Sendable () async -> Void) throws {
        self.onChange = onChange

        // The WAL file may not exist yet if no writes have happened since
        // the last checkpoint. Watch chat.db itself in that case.
        let path: String
        if FileManager.default.fileExists(atPath: walPath.path) {
            path = walPath.path
        } else {
            path = walPath.deletingLastPathComponent()
                .appendingPathComponent(walPath.lastPathComponent.replacingOccurrences(of: "-wal", with: ""))
                .path
        }

        fd = Darwin.open(path, O_EVTONLY)
        guard fd >= 0 else {
            throw MessagesProviderError.databaseUnavailable
        }

        let queue = DispatchQueue(label: "com.amber.messages2kit.watcher")
        let src = DispatchSource.makeFileSystemObjectSource(
            fileDescriptor: fd,
            eventMask: [.write, .extend, .rename, .delete],
            queue: queue
        )
        // Capture an unowned reference to the actor; the event handler
        // never outlives `self` because cancel() runs on stop().
        let weakSelf = WeakSelf(self)
        src.setEventHandler {
            Task { await weakSelf.value?.handleChange() }
        }
        let capturedFd = fd
        src.setCancelHandler {
            if capturedFd >= 0 { Darwin.close(capturedFd) }
        }
        src.resume()
        self.source = src
    }

    /// Thin Sendable wrapper so we can capture a weak actor reference in
    /// the DispatchSource event handler without tripping Swift 6's
    /// strict-concurrency check on `Task { await self?.… }`.
    private struct WeakSelf: @unchecked Sendable {
        weak var value: FileSystemWatcher?
        init(_ value: FileSystemWatcher) { self.value = value }
    }

    public func stop() {
        source?.cancel()
        source = nil
        debounceTask?.cancel()
        debounceTask = nil
        onChange = nil
        if fd >= 0 {
            Darwin.close(fd)
            fd = -1
        }
    }

    private func handleChange() {
        debounceTask?.cancel()
        let debounce = self.debounce
        let cb = self.onChange
        debounceTask = Task {
            try? await Task.sleep(nanoseconds: UInt64(debounce * 1_000_000_000))
            if Task.isCancelled { return }
            await cb?()
        }
    }
}
