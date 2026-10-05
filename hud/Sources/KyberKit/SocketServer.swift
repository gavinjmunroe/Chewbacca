import Foundation
import Security

/// A Unix domain socket carrying Kyber Lines in, and events back out.
///
/// A socket rather than a port because there is nothing to configure, nothing to
/// collide with, and the filesystem already has the permission model: a socket in
/// the user's own directory is reachable by that user and nobody else. A panel
/// that renders whatever is sent to it should not be listening on the network.
///
/// The channel is bidirectional on purpose. A display that cannot answer is a
/// poster: you can look at it and that is all. Sending events back on the same
/// connection is what lets an agent ask a question, draw the options, and find
/// out which one was picked, without a second transport or a polling loop.
///
/// Several connections at once, because the design needs it.
///
/// This used to accept one client and then block reading it until it hung up,
/// which quietly broke the whole system the moment anything stayed connected. A
/// listening loop holds its connection open for the life of the session, so with
/// one running, every `hud draw` sat in the accept queue and drew nothing: no
/// error, no timeout, just a command that appeared to succeed and did nothing.
///
/// Each connection now gets its own reader, and events go to all of them. The
/// race that the single-client rule was guarding against is settled by surfaces
/// being addressable by name: two writers to different names cannot collide, and
/// two writers to the same name were always going to fight whatever this did.
public final class SocketServer: @unchecked Sendable {
    public struct Event: Sendable {
        public enum Kind: Sendable {
            case began
            case line(String)
            /// A client sent `listen` and has been told the version. The app
            /// follows with whatever else a fresh subscriber has to be told.
            case subscribed
            case ended
            case failed(String)
        }
        public let kind: Kind
    }

    private let path: String
    private let onEvent: @Sendable (Event) -> Void
    private var listenFD: Int32 = -1
    private var ownershipFD: Int32 = -1
    private struct EndpointIdentity {
        let device: dev_t
        let inode: ino_t
    }
    private var endpointIdentity: EndpointIdentity?
    private let lifecycle = NSLock()
    private let queue = DispatchQueue(label: "kyber.socket")

    /// Guards `clients` and `subscribers`, which reader threads mutate and the
    /// main actor reads.
    private let lock = NSLock()
    private var clients: Set<Int32> = []

    /// The clients that asked to receive events.
    ///
    /// Events used to go to everyone connected, which meant a full speech
    /// transcript reached every process that happened to have the socket open.
    /// Anything running as this user can open it, so a second tool holding a
    /// connection to draw a panel was also being handed everything the person
    /// said out loud. Nobody asked for that and nothing disclosed it.
    ///
    /// Receiving is opt-in now: a client sends `listen` and only then hears
    /// anything back. Drawing needs no subscription, so the common case sees
    /// nothing it did not ask for.
    private var subscribers: Set<Int32> = []
    /// Which connection last drew each surface with `@`.
    ///
    /// An event that names a surface (`surface=`) goes only to that
    /// connection when it is still subscribed. Until 2026-10-04 every press
    /// went to every listener, so a message typed to a coding session's card
    /// would also have reached hud-listen, which hands any unknown `e` line to
    /// its model as "the user pressed send": the person's words run twice,
    /// by an agent they were not talking to. A surface whose drawer is gone,
    /// or never listened, still broadcasts, which is how a panel drawn by a
    /// one-shot `hud draw` keeps reaching the voice.
    private var owners: [String: Int32] = [:]
    private var running = false

    /// One queue per connection, so a slow reader cannot stall the others or
    /// the accept loop.
    private let readers = DispatchQueue(
        label: "kyber.socket.readers", attributes: .concurrent)

    public init(path: String, onEvent: @escaping @Sendable (Event) -> Void) {
        self.path = path
        self.onEvent = onEvent
    }

    /// The token a listener presents to receive events: `listen token=<hex>`.
    ///
    /// Written fresh on every start to `hud.token` beside the socket, 0600 in
    /// a 0700 folder. Until 2026-10-04 a plain `listen` from any process was
    /// handed every event: what was said (`h`), what was typed to a session,
    /// every row pressed. The socket was 0600 already, so this narrows the
    /// listeners to processes that can read the user's own `~/.bob` (a
    /// sandboxed app running as the user cannot), and the per-start token
    /// means a client that read an old file is refused after a restart.
    public private(set) var token = ""

    /// Where the token is written: `hud.token` in the socket's folder.
    public var tokenPath: String {
        ((path as NSString).deletingLastPathComponent as NSString)
            .appendingPathComponent("hud.token")
    }

    /// Whether `listen ...` presented this server's token. Compared in
    /// constant time, so the reply's timing says nothing about how many
    /// characters were right.
    func authorizes(_ line: String) -> Bool {
        guard !token.isEmpty else { return false }
        let given = line.split(separator: " ").first { $0.hasPrefix("token=") }
            .map { String($0.dropFirst("token=".count)) } ?? ""
        let a = Array(given.utf8), b = Array(token.utf8)
        guard a.count == b.count else { return false }
        var diff: UInt8 = 0
        for i in 0..<a.count { diff |= a[i] ^ b[i] }
        return diff == 0
    }

    /// 32 random bytes as hex, written owner-only. A symlink planted at the
    /// path is refused (`O_NOFOLLOW`), not followed.
    private func writeToken() throws {
        var bytes = [UInt8](repeating: 0, count: 32)
        guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else {
            throw NSError(domain: NSPOSIXErrorDomain, code: Int(EIO),
                          userInfo: [NSLocalizedDescriptionKey: "No randomness for the socket token"])
        }
        let fresh = bytes.map { String(format: "%02x", $0) }.joined()
        let fd = open(tokenPath, O_CREAT | O_WRONLY | O_TRUNC | O_NOFOLLOW | O_CLOEXEC, 0o600)
        guard fd >= 0 else {
            throw NSError(domain: NSPOSIXErrorDomain, code: Int(errno),
                          userInfo: [NSLocalizedDescriptionKey: "Could not write \(tokenPath)"])
        }
        defer { close(fd) }
        fchmod(fd, 0o600)
        let written = fresh.withCString { Foundation.write(fd, $0, strlen($0)) }
        guard written == fresh.utf8.count else {
            throw NSError(domain: NSPOSIXErrorDomain, code: Int(EIO))
        }
        token = fresh
    }

    /// What this build speaks.
    ///
    /// There was no version anywhere in the protocol, so a newer client talking
    /// to an older display failed one silent line at a time with no way to tell
    /// that was what was happening.
    public static let version = "kyber/1 verbs=c,>,d,r,@,-,p,s,q,w,m,u,press,listen"

    public static var defaultPath: String {
        if let override = ProcessInfo.processInfo.environment["BOB_HUD_SOCKET"] {
            return override
        }
        let home = FileManager.default.homeDirectoryForCurrentUser
        return home.appendingPathComponent(".bob/hud.sock").path
    }

    /// Send a line back to whoever is connected. No-op when nobody is.
    ///
    /// Failure here is deliberately quiet: an agent that streamed a surface and
    /// walked away is the normal case, not an error, and a panel that popped an
    /// alert every time a click had nowhere to go would be unusable.
    @discardableResult
    public func send(_ line: String) -> Bool {
        lock.lock()
        let targets = Self.recipients(
            for: line, subscribers: subscribers, owners: owners)
        lock.unlock()
        guard !targets.isEmpty else { return false }

        let payload = line.hasSuffix("\n") ? line : line + "\n"
        var delivered = false
        for fd in targets {
            if write(payload, to: fd) { delivered = true }
        }
        return delivered
    }

    /// Who receives `line`: the surface's owner alone when it is listening;
    /// nobody for a private line whose owner is not; everyone otherwise.
    static func recipients(
        for line: String, subscribers: Set<Int32>, owners: [String: Int32]
    ) -> Set<Int32> {
        guard let surface = OutboundEvent.surface(in: line) else { return subscribers }
        if let owner = owners[surface], subscribers.contains(owner) { return [owner] }
        return OutboundEvent.isPrivate(line) ? [] : subscribers
    }

    /// Note which connection drew a surface. Called for every `@` line.
    static func owner(of line: String) -> String? {
        guard line.hasPrefix("@ ") else { return nil }
        return LineParser.tokenize(line).dropFirst().first
    }

    /// Write one payload to one client, reporting whether it landed.
    private func write(_ payload: String, to fd: Int32) -> Bool {
        payload.withCString { pointer in
            let length = strlen(pointer)
            var written = 0
            while written < length {
                // MSG_NOSIGNAL is not available on Darwin, so SIGPIPE is
                // disabled per socket at accept time instead.
                let sent = Foundation.send(fd, pointer + written, length - written, 0)
                if sent <= 0 { return false }
                written += sent
            }
            return true
        }
    }

    public func start() throws {
        lifecycle.lock()
        defer { lifecycle.unlock() }
        guard ownershipFD < 0 else {
            throw NSError(domain: NSPOSIXErrorDomain, code: Int(EALREADY))
        }
        var address = sockaddr_un()
        address.sun_family = sa_family_t(AF_UNIX)
        let maxLength = MemoryLayout.size(ofValue: address.sun_path)
        guard !path.utf8.contains(0), path.utf8.count < maxLength else {
            throw NSError(
                domain: "Kyber", code: 1,
                userInfo: [NSLocalizedDescriptionKey: "Invalid socket path: \(path)"])
        }
        let directory = (path as NSString).deletingLastPathComponent
        try FileManager.default.createDirectory(
            atPath: directory, withIntermediateDirectories: true,
            attributes: [.posixPermissions: 0o700])
        // The folder holding the socket and its token is the user's alone.
        // Only one this user owns is tightened: an override that points the
        // socket into a shared folder must not chmod someone else's.
        var folder = stat()
        if lstat(directory, &folder) == 0, folder.st_uid == geteuid(),
           (folder.st_mode & S_IFMT) == S_IFDIR {
            chmod(directory, 0o700)
        }
        try writeToken()

        // Keep the lock file in place: unlinking it would let a contender lock
        // a different inode. The kernel releases ownership after a crash.
        let owner = open(path + ".lock", O_CREAT | O_RDWR | O_CLOEXEC | O_NOFOLLOW, 0o600)
        guard owner >= 0 else {
            throw NSError(domain: NSPOSIXErrorDomain, code: Int(errno))
        }
        guard flock(owner, LOCK_EX | LOCK_NB) == 0 else {
            let error = errno
            close(owner)
            throw NSError(domain: NSPOSIXErrorDomain, code: Int(error),
                          userInfo: [NSLocalizedDescriptionKey: "Socket already owned: \(path)"])
        }
        var started = false
        var boundIdentity: EndpointIdentity?
        var fd: Int32 = -1
        defer {
            if !started {
                if fd >= 0 { close(fd) }
                removeEndpoint(matching: boundIdentity)
                flock(owner, LOCK_UN)
                close(owner)
            }
        }
        fd = socket(AF_UNIX, SOCK_STREAM, 0)
        guard fd >= 0 else {
            throw NSError(domain: NSPOSIXErrorDomain, code: Int(errno))
        }

        _ = withUnsafeMutablePointer(to: &address.sun_path) { pointer in
            path.withCString { source in
                strncpy(
                    UnsafeMutableRawPointer(pointer).assumingMemoryBound(to: CChar.self),
                    source, maxLength - 1)
            }
        }

        // Older builds do not hold the ownership lock. Probe without waiting;
        // only connection refusal establishes a stale socket. Other errors
        // (including a full backlog) must leave the existing endpoint alone.
        if let existing = try endpoint() {
            let probe = socket(AF_UNIX, SOCK_STREAM, 0)
            guard probe >= 0 else {
                throw NSError(domain: NSPOSIXErrorDomain, code: Int(errno))
            }
            defer { close(probe) }
            guard fcntl(probe, F_SETFL, O_NONBLOCK) == 0 else {
                throw NSError(domain: NSPOSIXErrorDomain, code: Int(errno))
            }
            let connected = withUnsafePointer(to: &address) { pointer in
                pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                    Darwin.connect(probe, $0, socklen_t(MemoryLayout<sockaddr_un>.size))
                }
            }
            let error = errno
            guard connected < 0 && error == ECONNREFUSED else {
                throw NSError(domain: NSPOSIXErrorDomain, code: Int(EADDRINUSE))
            }
            removeEndpoint(matching: existing)
        }

        let size = socklen_t(MemoryLayout<sockaddr_un>.size)
        let bound = withUnsafePointer(to: &address) { pointer in
            pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                bind(fd, $0, size)
            }
        }
        guard bound == 0 else {
            throw NSError(
                domain: NSPOSIXErrorDomain, code: Int(errno),
                userInfo: [NSLocalizedDescriptionKey: "Could not bind \(path)."])
        }

        boundIdentity = try endpoint()
        guard boundIdentity != nil else {
            throw NSError(domain: NSPOSIXErrorDomain, code: Int(ENOENT))
        }

        // Only the user who owns it may draw on their own screen.
        chmod(path, 0o600)

        guard listen(fd, 16) == 0 else {
            throw NSError(
                domain: NSPOSIXErrorDomain, code: Int(errno),
                userInfo: [NSLocalizedDescriptionKey: "Could not listen on \(path)."])
        }

        listenFD = fd
        ownershipFD = owner
        endpointIdentity = boundIdentity
        started = true
        running = true
        queue.async { [weak self] in self?.acceptLoop() }
    }

    public func stop() {
        lifecycle.lock()
        defer { lifecycle.unlock() }
        guard ownershipFD >= 0 else { return }
        running = false
        lock.lock()
        // Wake readers, which own the final close. Closing here as well would
        // let a late reader close a descriptor reused by a successor server.
        for fd in clients { shutdown(fd, SHUT_RDWR) }
        subscribers.removeAll()
        lock.unlock()
        if listenFD >= 0 {
            shutdown(listenFD, SHUT_RDWR)
            close(listenFD)
        }
        listenFD = -1
        removeEndpoint(matching: endpointIdentity)
        endpointIdentity = nil
        flock(ownershipFD, LOCK_UN)
        close(ownershipFD)
        ownershipFD = -1
    }

    private func endpoint() throws -> EndpointIdentity? {
        var info = stat()
        guard lstat(path, &info) == 0 else {
            if errno == ENOENT { return nil }
            throw NSError(domain: NSPOSIXErrorDomain, code: Int(errno))
        }
        guard info.st_mode & S_IFMT == S_IFSOCK else {
            throw NSError(domain: NSPOSIXErrorDomain, code: Int(EEXIST),
                          userInfo: [NSLocalizedDescriptionKey: "Not a socket: \(path)"])
        }
        return EndpointIdentity(device: info.st_dev, inode: info.st_ino)
    }

    private func removeEndpoint(matching expected: EndpointIdentity?) {
        guard let expected, let current = try? endpoint(),
              current.device == expected.device, current.inode == expected.inode else { return }
        unlink(path)
    }

    private func acceptLoop() {
        while running {
            let fd = accept(listenFD, nil, nil)
            if fd < 0 {
                if running && errno != EINTR {
                    onEvent(Event(kind: .failed("accept failed: \(errno)")))
                }
                continue
            }

            // Only this user's own processes. The socket's 0600 mode already
            // says so; the kernel's word on the peer is checked as well, so a
            // mode loosened by anything later is not the only line.
            var peerUID: uid_t = 0
            var peerGID: gid_t = 0
            guard getpeereid(fd, &peerUID, &peerGID) == 0, peerUID == geteuid() else {
                close(fd)
                continue
            }

            // A client that hangs up mid-write would otherwise kill the whole
            // process with SIGPIPE, taking the panel with it.
            var on: Int32 = 1
            setsockopt(fd, SOL_SOCKET, SO_NOSIGPIPE, &on, socklen_t(MemoryLayout<Int32>.size))

            lock.lock()
            clients.insert(fd)
            lock.unlock()

            onEvent(Event(kind: .began))
            // Read on its own queue. Doing it here is what made the accept loop
            // serial: a client that stays connected blocked every later one.
            readers.async { [weak self] in
                guard let self else { return }
                self.read(fd)
                self.lock.lock()
                self.clients.remove(fd)
                self.subscribers.remove(fd)
                // A closed descriptor number is reused by the next accept;
                // a stale entry would route the next client's presses wrong.
                self.owners = self.owners.filter { $0.value != fd }
                self.lock.unlock()
                close(fd)
                self.onEvent(Event(kind: .ended))
            }
        }
    }

    /// Whether anything is listening for events at all.
    public var hasSubscribers: Bool {
        lock.lock()
        defer { lock.unlock() }
        return !subscribers.isEmpty
    }

    private func read(_ fd: Int32) {
        var buffer = LineBuffer()
        var bytes = [UInt8](repeating: 0, count: 8192)

        while running {
            let count = recv(fd, &bytes, bytes.count, 0)
            if count <= 0 { break }

            // A chunk can split a multi-byte character, so decode leniently and
            // let the line buffer hold anything incomplete.
            let chunk = String(decoding: bytes[0..<count], as: UTF8.self)
            for line in buffer.push(chunk) {
                // `listen` is handled here rather than in the parser: it is
                // about this connection, not about anything on the glass, and
                // the parser has no idea which socket a line arrived on.
                let trimmed = line.trimmingCharacters(in: .whitespaces)
                if trimmed == "listen" || trimmed.hasPrefix("listen ") {
                    // Anything that subscribes is told what it is talking to,
                    // unprompted. A client should never have to guess whether
                    // the verb it is about to use exists in this build.
                    _ = write(
                        OutboundEvent.version(Self.version).line + "\n", to: fd)
                    guard authorizes(trimmed) else {
                        // The compatibility window (from 2026-10-04): a
                        // listen without the token still gets the version,
                        // and this line saying why nothing else follows. It
                        // may draw; it receives no events.
                        _ = write(
                            OutboundEvent.problem(
                                "events need `listen token=<hex>`, the token in \(tokenPath); "
                                + "this connection may draw but receives no events").line + "\n",
                            to: fd)
                        continue
                    }
                    lock.lock()
                    subscribers.insert(fd)
                    lock.unlock()
                    onEvent(Event(kind: .subscribed))
                    continue
                }
                if let surface = Self.owner(of: trimmed) {
                    // Only a listener that showed the token can own a
                    // surface; an unauthenticated drawer re-addressing
                    // `s-abc` must not take its owner's private lines away.
                    lock.lock()
                    if subscribers.contains(fd) { owners[surface] = fd }
                    lock.unlock()
                }
                if trimmed == "version" {
                    _ = write(
                        OutboundEvent.version(Self.version).line + "\n", to: fd)
                    continue
                }
                onEvent(Event(kind: .line(line)))
            }
        }

        if let tail = buffer.flush() {
            onEvent(Event(kind: .line(tail)))
        }
    }
}
