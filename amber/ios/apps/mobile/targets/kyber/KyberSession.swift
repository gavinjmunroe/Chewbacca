import Foundation
import Security

// THE SESSION AND EVERY CALL KYBER MAKES TO AMBER.
//
// Kyber signs in as whoever is signed in to the Amber app, through the keychain
// group both are entitled to (lib/secureStorage.ts writes it). It reads the item
// exactly as expo-secure-store wrote it: service "app:no-auth", account and
// generic both the key's UTF-8 bytes. Change one side and the other goes
// silently signed-out, so the layout is spelled out here rather than abstracted.

enum KyberSessionError: Error {
    case noFullAccess
    case signedOut
    case http(Int, String?)
    case network
}

final class KyberKeychain {
    static let sessionKey = "medha_session_token_v1"
    static let phoneKey = "medha_session_phone_v1"
    static let refreshKey = "medha_refresh_token_v1"
    private static let service = "app:no-auth"

    /// "<TEAMID>.com.joinrytual.amber.shared". The prefix comes from the
    /// Info.plist, which Xcode fills from $(AppIdentifierPrefix) at build time.
    static var group: String {
        // The team prefix is the app's appleTeamId, which lib/secureStorage.ts
        // builds its group name from. The plist value is preferred so a team
        // move only needs app.json, but an empty or unexpanded value must not
        // silently sign everyone out, so it falls back to the known team.
        let fromPlist = Bundle.main.object(forInfoDictionaryKey: "AppIdentifierPrefix") as? String
        let prefix = (fromPlist?.isEmpty == false && fromPlist?.hasPrefix("$(") == false) ? fromPlist! : "XJ94HGCQHA."
        return prefix + "com.joinrytual.amber.shared"
    }

    private static func query(_ key: String) -> [String: Any] {
        let account = Data(key.utf8)
        return [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecAttrGeneric as String: account,
            kSecAttrAccessGroup as String: group,
        ]
    }

    static func get(_ key: String) -> String? {
        var q = query(key)
        q[kSecReturnData as String] = kCFBooleanTrue
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: CFTypeRef?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let data = out as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    /// UPDATE ONLY, NEVER ADD. Only the app creates the session. An item that
    /// is missing here means the user signed out while this keyboard was
    /// mid-refresh, and adding it back would sign them in again behind their
    /// back (lib/secureStorage.ts reads the shared item first).
    @discardableResult
    static func update(_ key: String, _ value: String) -> Bool {
        let status = SecItemUpdate(query(key) as CFDictionary, [kSecValueData as String: Data(value.utf8)] as CFDictionary)
        return status == errSecSuccess
    }

    /// The app compares this with its private copy's stamp to tell which store
    /// is newer (lib/sessionStore.ts). Written after every rotation here.
    static let savedAtKey = "medha_session_saved_at_v1"
    static func stampNow() {
        update(savedAtKey, String(Int(Date().timeIntervalSince1970 * 1000)))
    }
}

/// An actor so that "is a refresh already running" and "start one" happen with
/// no suspension between them. As a plain class, the five requests a keyboard
/// open fires at once each saw no refresh in flight and each presented the same
/// single-use refresh token; the server rotated twice, 401'd the rest, and the
/// keychain kept whichever rotation landed last, which could be the one already
/// superseded. The next refresh was then a replay and revoked every session,
/// the app's included.
actor KyberAPI {
    static let shared = KyberAPI()

    /// Keep in sync with expo.extra.amberIdBaseUrl in app.json.
    nonisolated let base = URL(string: "https://amber-id-production.up.railway.app")!
    private var hasFullAccess = true
    private var refreshing: Task<String, Error>?

    func setFullAccess(_ on: Bool) { hasFullAccess = on }

    /// A usable access token, refreshing first when the stored one is about to
    /// expire. Refresh tokens are single-use, so concurrent callers share one
    /// exchange and the rotated pair is written back where the app reads it.
    func token() async throws -> String {
        guard hasFullAccess else { throw KyberSessionError.noFullAccess }
        guard let current = KyberKeychain.get(KyberKeychain.sessionKey) else { throw KyberSessionError.signedOut }
        if !KyberJWT.needsRefresh(current) { return current }
        if let refreshing { return try await refreshing.value }
        let task = Task<String, Error> { try await self.refresh() }
        refreshing = task
        defer { refreshing = nil }
        return try await task.value
    }

    private func refresh() async throws -> String {
        guard let refreshToken = KyberKeychain.get(KyberKeychain.refreshKey) else { throw KyberSessionError.signedOut }
        do {
            return try await exchange(refreshToken)
        } catch KyberSessionError.signedOut {
            // The app may have rotated the token between our read and our
            // request (both processes refresh). If the stored refresh token
            // changed, the app won, and its fresh access token is already here.
            if let now = KyberKeychain.get(KyberKeychain.refreshKey), now != refreshToken,
               let access = KyberKeychain.get(KyberKeychain.sessionKey), !KyberJWT.needsRefresh(access) {
                return access
            }
            throw KyberSessionError.signedOut
        }
    }

    private func exchange(_ refreshToken: String) async throws -> String {
        var req = URLRequest(url: base.appendingPathComponent("v1/auth/refresh"))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "content-type")
        req.httpBody = try JSONSerialization.data(withJSONObject: ["refreshToken": refreshToken])
        req.timeoutInterval = 10
        let data: Data, res: URLResponse
        do { (data, res) = try await URLSession.shared.data(for: req) } catch { throw KyberSessionError.network }
        let status = (res as? HTTPURLResponse)?.statusCode ?? 0
        // Only a 401 means the session is over. A 429 or a 5xx is a bad minute
        // on the server, and calling it "signed out" sends people to re-auth
        // for nothing.
        if status == 401 { throw KyberSessionError.signedOut }
        guard status == 200,
              let body = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let token = body["token"] as? String else { throw KyberSessionError.http(status, nil) }
        // Access token first: if the refresh token write then fails, the next
        // refresh presents the old one inside the server's 60 s grace window.
        guard KyberKeychain.update(KyberKeychain.sessionKey, token) else { throw KyberSessionError.signedOut }
        if let rotated = body["refreshToken"] as? String { KyberKeychain.update(KyberKeychain.refreshKey, rotated) }
        if let phone = body["phone"] as? String { KyberKeychain.update(KyberKeychain.phoneKey, phone) }
        KyberKeychain.stampNow()
        return token
    }

    private func request(_ path: String, method: String = "GET", body: [String: Any]? = nil) async throws -> URLRequest {
        let token = try await token()
        guard let url = URL(string: path, relativeTo: base) else { throw KyberSessionError.network }
        var req = URLRequest(url: url)
        req.httpMethod = method
        req.setValue("Bearer \(token)", forHTTPHeaderField: "authorization")
        req.setValue("application/json", forHTTPHeaderField: "accept")
        if let body {
            req.setValue("application/json", forHTTPHeaderField: "content-type")
            req.httpBody = try JSONSerialization.data(withJSONObject: body)
        }
        req.timeoutInterval = 15
        return req
    }

    func json(_ path: String, method: String = "GET", body: [String: Any]? = nil) async throws -> [String: Any] {
        let req = try await request(path, method: method, body: body)
        let data: Data, res: URLResponse
        do { (data, res) = try await URLSession.shared.data(for: req) } catch { throw KyberSessionError.network }
        let status = (res as? HTTPURLResponse)?.statusCode ?? 0
        let obj = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
        if status == 401 { throw KyberSessionError.signedOut }
        guard (200..<300).contains(status) else { throw KyberSessionError.http(status, obj["error"] as? String) }
        return obj
    }

    /// POST /v1/chat, the same stream the app's Ask runs on: people, places,
    /// web, notes captured, reminders, drafts. Frames are handed over as they
    /// arrive.
    func chat(_ message: String, conversationId: String?, clarifyContactId: String? = nil, pendingId: String? = nil,
              onFrame: @escaping @MainActor (SSEFrame) -> Void) async throws {
        var body: [String: Any] = ["message": message, "timezone": TimeZone.current.identifier]
        if let conversationId { body["conversationId"] = conversationId }
        if let clarifyContactId { body["clarifyContactId"] = clarifyContactId }
        if let pendingId { body["pendingId"] = pendingId }
        var req = try await request("/v1/chat", method: "POST", body: body)
        req.setValue("text/event-stream", forHTTPHeaderField: "accept")
        req.timeoutInterval = 90
        let bytes: URLSession.AsyncBytes, res: URLResponse
        do { (bytes, res) = try await URLSession.shared.bytes(for: req) } catch { throw Self.mapCancel(error) }
        let status = (res as? HTTPURLResponse)?.statusCode ?? 0
        if status == 401 { throw KyberSessionError.signedOut }
        guard status == 200 else { throw KyberSessionError.http(status, nil) }
        var parser = SSEParser()
        var pending = Data()
        do {
            for try await byte in bytes {
                pending.append(byte)
                // Flush on newline so multi-byte characters are never split.
                guard byte == 0x0A, let chunk = String(data: pending, encoding: .utf8) else { continue }
                pending.removeAll(keepingCapacity: true)
                for frame in parser.feed(chunk) {
                    // A newer question replaced this one: frames already parsed
                    // from this chunk belong to the old answer.
                    try Task.checkCancellation()
                    await onFrame(frame)
                    if frame.event == "complete" || frame.event == "error" { return }
                }
            }
        } catch {
            throw Self.mapCancel(error)
        }
    }

    /// A cancelled URLSession stream throws URLError(.cancelled), not
    /// CancellationError, and was being shown as "Could not reach Amber".
    private static func mapCancel(_ error: Error) -> Error {
        if (error as? URLError)?.code == .cancelled { return CancellationError() }
        return error
    }
}
