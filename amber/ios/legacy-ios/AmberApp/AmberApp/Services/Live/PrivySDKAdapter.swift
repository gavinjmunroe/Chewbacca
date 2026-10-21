import Foundation

/// Placeholder Privy adapter. The real implementation imports the Privy iOS
/// SDK and delegates every method to it. Until the SDK is added as a Swift
/// Package dependency, this adapter reads/writes the Keychain directly so
/// the rest of the app compiles and runs in development.
///
/// Integration TODO (out of scope for this PR):
///   1. Add https://github.com/privy-io/privy-swift-sdk via SwiftPM
///   2. Wire `signInWithApple`, `signInWithEmail` to Privy's flows
///   3. Have `accessToken()` call `Privy.shared.getAccessToken()`
///   4. Persist `userId` and `accessToken` after every refresh
@MainActor
final class PrivySDKAdapter {
    let appId: String
    private let keychain: AmberKeychain

    init(appId: String, keychain: AmberKeychain) {
        self.appId = appId
        self.keychain = keychain
    }

    var isAuthenticated: Bool { keychain.readString(.privyAccessToken) != nil }
    var userId: String? { keychain.readString(.privyUserId) }

    func signInWithApple() async throws {
        // Real impl: await Privy.shared.loginWithApple()
        throw AmberServiceError.server(message: "Privy SDK not yet wired. Connect via Apple will work once the package is added.", status: 501)
    }

    func signInWithEmail(_ email: String) async throws {
        throw AmberServiceError.server(message: "Privy SDK not yet wired.", status: 501)
    }

    func signOut() async throws {
        keychain.delete(.privyAccessToken)
        keychain.delete(.privyRefreshToken)
        keychain.delete(.privyUserId)
    }

    func accessToken() async throws -> String {
        guard let token = keychain.readString(.privyAccessToken), !token.isEmpty else {
            throw AmberServiceError.unauthenticated
        }
        return token
    }

    func refreshAccessToken() async throws {
        // Real impl: await Privy.shared.refreshSession()
    }
}
