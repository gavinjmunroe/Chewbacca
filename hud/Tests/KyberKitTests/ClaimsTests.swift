import Foundation
import Testing

@testable import KyberKit

/// Surface ownership (bd_2026-Code-9rl): a connection that claimed a
/// namespace keeps it, and nobody else can silently draw over it.
@Suite("Surface claims")
struct ClaimsTests {
    @Test("an unclaimed glass passes every line through, as before")
    func optIn() {
        var claims = SurfaceClaims()
        for line in ["@ notes", "c s Screen title=\"X\"", "r s", "- notes", "-", "to notes"] {
            #expect(claims.route(line, from: 3).lines.map(\.line) == [line])
            #expect(claims.route(line, from: 3).problem == nil)
        }
    }

    @Test("another connection cannot address a claimed surface")
    func refusesOthers() {
        var claims = SurfaceClaims()
        #expect(claims.claim("amber", by: 3) == nil)
        let refused = claims.route("@ amber.inbox", from: 4)
        #expect(refused.lines.isEmpty)
        #expect(refused.problem?.contains("belongs to amber") == true)
        // Its drawing lines go nowhere until it names a surface it may use.
        #expect(claims.route("c s Screen title=\"FORGED\"", from: 4).lines.isEmpty)
        #expect(claims.route("r s", from: 4).lines.isEmpty)
        // And the namespace's own name is covered, not just names under it.
        #expect(claims.route("@ amber", from: 4).problem != nil)
        // A name that only starts with the same letters is not.
        #expect(claims.route("@ amberly", from: 4).problem == nil)
        #expect(claims.route("c s Screen", from: 4).lines.map(\.line) == ["c s Screen"])
    }

    @Test("the claimant draws, and its lines carry its namespace")
    func ownerAttributed() {
        var claims = SurfaceClaims()
        _ = claims.claim("amber", by: 3)
        let opened = claims.route("@ amber.inbox at=right", from: 3)
        #expect(opened.lines.map(\.line) == ["@ amber.inbox at=right"])
        #expect(opened.lines.map(\.owner) == ["amber"])
        #expect(claims.route("c s Screen", from: 3).lines.map(\.owner) == ["amber"])
        // Outside its namespace it draws like anyone, unattributed.
        #expect(claims.route("@ scratch", from: 3).lines.map(\.owner) == [nil])
    }

    @Test("closing, clearing, glancing and retargeting a claimed surface are refused")
    func refusesTakedowns() {
        var claims = SurfaceClaims()
        _ = claims.claim("amber", by: 3)
        #expect(claims.route("- amber.inbox", from: 4).problem != nil)
        #expect(claims.route("-", from: 4).problem != nil)
        #expect(claims.route("glance amber.inbox", from: 4).problem != nil)
        #expect(claims.route("to amber.inbox label=\"x\"", from: 4).problem != nil)
        #expect(claims.route("to off", from: 4).problem == nil)
        // The owner may do all of it.
        #expect(claims.route("- amber.inbox", from: 3).problem == nil)
        #expect(claims.route("-", from: 3).problem == nil)
    }

    @Test("a connection that never named a surface cannot draw while others hold claims")
    func noBlindDrawing() {
        var claims = SurfaceClaims()
        _ = claims.claim("amber", by: 3)
        _ = claims.route("@ amber.inbox", from: 3)
        // The overlay's current surface is amber.inbox now; a bare `c` from
        // someone else would have landed in it.
        let blind = claims.route("c s Text value=\"FORGED\"", from: 4)
        #expect(blind.lines.isEmpty)
        #expect(blind.problem != nil)
    }

    @Test("interleaved connections each draw on their own surface")
    func interleaving() {
        var claims = SurfaceClaims()
        _ = claims.route("@ one", from: 3)
        _ = claims.route("@ two", from: 4)
        // 3's `c` would have landed on `two`; its `@` is sent again first.
        let next = claims.route("c s Screen", from: 3)
        #expect(next.lines.map(\.line) == ["@ one", "c s Screen"])
        // Back-to-back lines from one connection are not re-addressed.
        #expect(claims.route("r s", from: 3).lines.map(\.line) == ["r s"])
    }

    @Test("a claim is first come, overlap is refused, and it lapses on disconnect")
    func claimLifecycle() {
        var claims = SurfaceClaims()
        #expect(claims.claim("amber", by: 3) == nil)
        #expect(claims.claim("amber", by: 4) != nil)
        #expect(claims.claim("amber.inbox", by: 4) != nil)
        #expect(claims.claim("bad name", by: 4) != nil)
        #expect(claims.claim("", by: 4) != nil)
        claims.disconnect(3)
        #expect(claims.claim("amber", by: 4) == nil)
        #expect(claims.route("@ amber.inbox", from: 4).problem == nil)
    }

    @Test("a surface claimed after a connection's `@` is no longer its to draw on")
    func claimedUnderneath() {
        var claims = SurfaceClaims()
        _ = claims.route("@ amber.inbox", from: 4)
        _ = claims.claim("amber", by: 3)
        #expect(claims.route("c s Screen", from: 4).problem != nil)
    }

    // MARK: the socket, end to end

    @Test("over the socket: a refused `@` answers its sender and draws nothing")
    func endToEnd() async throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let path = directory.appendingPathComponent("hud.sock").path

        let seen = Lines()
        let server = SocketServer(path: path) { event in
            if case .line(let line) = event.kind { seen.add(line, owner: event.owner) }
        }
        try server.start()
        defer { server.stop() }

        let owner = try #require(Self.connect(path))
        defer { close(owner) }
        let forger = try #require(Self.connect(path))
        defer { close(forger) }

        Self.send(owner, "claim amber token=\(server.token)\n")
        #expect(Self.readLine(owner).hasPrefix("e claimed amber"))
        Self.send(owner, "@ amber.inbox\nc s Screen title=\"REAL\"\nr s\n")
        try await Task.sleep(for: .milliseconds(200))

        Self.send(forger, "@ amber.inbox\nc s Screen title=\"FORGED\"\n")
        let problem = Self.readLine(forger)
        #expect(problem.hasPrefix("! "))
        #expect(problem.contains("belongs to amber"))
        try await Task.sleep(for: .milliseconds(200))

        #expect(seen.lines.contains("c s Screen title=\"REAL\""))
        #expect(!seen.lines.contains { $0.contains("FORGED") })
        #expect(seen.owner(of: "@ amber.inbox") == "amber")

        // A claim without the token is refused.
        Self.send(forger, "claim other token=nope\n")
        #expect(Self.readLine(forger).hasPrefix("! "))
    }

    private final class Lines: @unchecked Sendable {
        private let lock = NSLock()
        private var all: [(String, String?)] = []
        func add(_ line: String, owner: String?) {
            lock.lock(); all.append((line, owner)); lock.unlock()
        }
        var lines: [String] { lock.lock(); defer { lock.unlock() }; return all.map(\.0) }
        func owner(of line: String) -> String? {
            lock.lock(); defer { lock.unlock() }
            return all.first { $0.0 == line }?.1
        }
    }

    static func connect(_ path: String) -> Int32? {
        let fd = socket(AF_UNIX, SOCK_STREAM, 0)
        var address = sockaddr_un()
        address.sun_family = sa_family_t(AF_UNIX)
        let capacity = MemoryLayout.size(ofValue: address.sun_path)
        _ = withUnsafeMutablePointer(to: &address.sun_path) { pointer in
            path.withCString {
                strncpy(UnsafeMutableRawPointer(pointer).assumingMemoryBound(to: CChar.self), $0, capacity - 1)
            }
        }
        let ok = withUnsafePointer(to: &address) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                Darwin.connect(fd, $0, socklen_t(MemoryLayout<sockaddr_un>.size))
            }
        }
        if ok != 0 { close(fd); return nil }
        return fd
    }

    static func send(_ fd: Int32, _ text: String) {
        _ = text.withCString { Darwin.send(fd, $0, strlen($0), 0) }
    }

    /// One line from `fd`, or "" after two seconds.
    static func readLine(_ fd: Int32) -> String {
        var out = [UInt8]()
        var byte: UInt8 = 0
        while true {
            var descriptor = pollfd(fd: fd, events: Int16(POLLIN), revents: 0)
            guard poll(&descriptor, 1, 2000) == 1, recv(fd, &byte, 1, 0) == 1 else { break }
            if byte == 10 { break }
            out.append(byte)
        }
        return String(decoding: out, as: UTF8.self)
    }
}
