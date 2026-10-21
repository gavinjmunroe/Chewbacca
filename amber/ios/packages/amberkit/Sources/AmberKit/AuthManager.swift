import Foundation

/// Manages Privy authentication state and token management.
///
/// SECURITY: tokens are stored in the Keychain, never in UserDefaults.
/// The Privy App ID is injected at init time from the xcconfig-backed
/// AmberAppConfig rather than hardcoded here.
@MainActor
public class AuthManager: ObservableObject {
    public static let shared = AuthManager()

    @Published public var isAuthenticated = false
    @Published public var accessToken: String?
    @Published public var userId: String?

    private let privyAppId: String
    private let backendURL: URL
    private let keychainService: String
    private let keychainTokenKey = "amber.amberkit.access"
    private let keychainUserKey = "amber.amberkit.userId"

    // Convenience singleton with sensible defaults.
    // Production callers should use init(privyAppId:backendURL:) directly.
    private init() {
        // App ID must be supplied via xcconfig/environment — no hardcoded fallback.
        // TODO: inject from AmberAppConfig.default.privyAppId once AmberKit is
        // linked into the main app target.
        self.privyAppId = ProcessInfo.processInfo.environment["PRIVY_APP_ID"] ?? ""
        // Localhost is only valid for simulator development; production builds
        // must supply a real URL via environment variable or xcconfig.
        let rawURL = ProcessInfo.processInfo.environment["AMBER_ID_BASE_URL"]
            ?? "https://amber-id-production.up.railway.app"
        self.backendURL = URL(string: rawURL) ?? URL(string: "https://amber-id-production.up.railway.app")!
        self.keychainService = Bundle.main.bundleIdentifier ?? "com.amber.AmberKit"
        checkStoredAuth()
    }

    public init(privyAppId: String, backendURL: URL, keychainService: String = Bundle.main.bundleIdentifier ?? "com.amber.AmberKit") {
        self.privyAppId = privyAppId
        self.backendURL = backendURL
        self.keychainService = keychainService
        checkStoredAuth()
    }

    // MARK: - Keychain helpers

    private func keychainRead(_ key: String) -> String? {
        let query: [CFString: Any] = [
            kSecClass: kSecClassGenericPassword,
            kSecAttrService: keychainService,
            kSecAttrAccount: key,
            kSecReturnData: true,
            kSecMatchLimit: kSecMatchLimitOne
        ]
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        guard status == errSecSuccess, let data = item as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    private func keychainWrite(_ key: String, value: String) {
        guard let data = value.data(using: .utf8) else { return }
        let query: [CFString: Any] = [
            kSecClass: kSecClassGenericPassword,
            kSecAttrService: keychainService,
            kSecAttrAccount: key
        ]
        SecItemDelete(query as CFDictionary)
        var add = query
        add[kSecValueData] = data
        add[kSecAttrAccessible] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        SecItemAdd(add as CFDictionary, nil)
    }

    private func keychainDelete(_ key: String) {
        let query: [CFString: Any] = [
            kSecClass: kSecClassGenericPassword,
            kSecAttrService: keychainService,
            kSecAttrAccount: key
        ]
        SecItemDelete(query as CFDictionary)
    }

    // MARK: - Auth lifecycle

    private func checkStoredAuth() {
        guard let token = keychainRead(keychainTokenKey),
              let uid = keychainRead(keychainUserKey) else { return }
        accessToken = token
        userId = uid
        isAuthenticated = true
        Task { await verifyToken() }
    }

    private func storeAuth(token: String, userId: String) {
        keychainWrite(keychainTokenKey, value: token)
        keychainWrite(keychainUserKey, value: userId)
        accessToken = token
        self.userId = userId
        isAuthenticated = true
    }

    private func clearAuth() {
        keychainDelete(keychainTokenKey)
        keychainDelete(keychainUserKey)
        accessToken = nil
        userId = nil
        isAuthenticated = false
    }

    private func verifyToken() async {
        guard let token = accessToken else { clearAuth(); return }

        do {
            var request = URLRequest(url: backendURL.appendingPathComponent("auth/verify"))
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONEncoder().encode(["accessToken": token])

            let (data, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
                clearAuth(); return
            }
            let result = try JSONDecoder().decode(AuthVerifyResponse.self, from: data)
            storeAuth(token: token, userId: result.privyUserId)
        } catch {
            clearAuth()
        }
    }

    public func loginWithToken(_ token: String) async throws {
        var request = URLRequest(url: backendURL.appendingPathComponent("auth/verify"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(["accessToken": token])

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            throw AuthError.invalidToken
        }
        let result = try JSONDecoder().decode(AuthVerifyResponse.self, from: data)
        storeAuth(token: token, userId: result.privyUserId)
    }

    public func login() async throws {
        throw AuthError.notImplemented
    }

    public func logout() async {
        clearAuth()
    }

    public func refreshToken() async {
        await verifyToken()
    }
}

private struct AuthVerifyResponse: Codable {
    let userId: Int
    let privyUserId: String
    let linkedAccounts: [LinkedAccount]
}

private struct LinkedAccount: Codable {
    let type: String
    let address: String?
    let walletClientType: String?
}

public enum AuthError: Error {
    case notConfigured
    case notAuthenticated
    case tokenExpired
    case invalidToken
    case notImplemented
}

