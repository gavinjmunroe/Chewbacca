import Foundation
import Security

/// Typed wrapper around the system Keychain. Used for Privy tokens, cNFT
/// asset IDs, app-lock flags. Nothing sensitive should ever live in
/// UserDefaults; values written here are `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`.
final class AmberKeychain {
    enum Key: String {
        case privyAccessToken = "amber.privy.access"
        case privyRefreshToken = "amber.privy.refresh"
        case privyUserId = "amber.privy.userId"
        case cnftAssetId = "amber.cnft.assetId"
        case appLockEnabled = "amber.lock.enabled"
    }

    private let service: String

    init(service: String = Bundle.main.bundleIdentifier ?? "com.amber.AmberApp") {
        self.service = service
    }

    func writeString(_ key: Key, value: String) {
        guard let data = value.data(using: .utf8) else { return }
        write(key, data: data)
    }

    func readString(_ key: Key) -> String? {
        guard let data = read(key) else { return nil }
        return String(data: data, encoding: .utf8)
    }

    func writeBool(_ key: Key, value: Bool) {
        writeString(key, value: value ? "1" : "0")
    }

    func readBool(_ key: Key) -> Bool? {
        readString(key).map { $0 == "1" }
    }

    func delete(_ key: Key) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key.rawValue
        ]
        SecItemDelete(query as CFDictionary)
    }

    private func write(_ key: Key, data: Data) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key.rawValue
        ]
        SecItemDelete(query as CFDictionary)

        var add = query
        add[kSecValueData as String] = data
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        SecItemAdd(add as CFDictionary, nil)
    }

    private func read(_ key: Key) -> Data? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key.rawValue,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        guard status == errSecSuccess else { return nil }
        return item as? Data
    }
}
