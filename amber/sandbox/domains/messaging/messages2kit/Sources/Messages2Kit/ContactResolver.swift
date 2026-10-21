// Resolve iMessage handles (phone/email) to Contacts.framework records.
//
// Two read paths exist:
//   1. CNContactStore (official, async, gated by NSContactsUsageDescription)
//   2. ~/Library/Application Support/AddressBook/Sources/<UUID>/AddressBook-v22.abcddb
//      (TCC-gated by Full Disk Access)
//
// Path 1 is what ClearOut callers expect. We use it here. If the host app
// hasn't requested permission, lookups return nil — the consumer can
// degrade to raw handles without error.
//
// Phone normalization: chat.db stores fully-qualified numbers (+15550100003)
// while CNContact phone values are arbitrary user-entered formats. We
// reduce both sides to digits-only and match on the last 10 (US default).
// This is identical to what we used in Electron Messages2's contacts.ts.

import Contacts
import Foundation

public actor ContactResolver {
    private let store = CNContactStore()
    private var byPhone: [String: CNContact] = [:]
    private var byEmail: [String: CNContact] = [:]
    private var lastLoaded: Date?
    private let ttl: TimeInterval = 600 // 10 min

    public init() {}

    public var hasPermission: Bool {
        CNContactStore.authorizationStatus(for: .contacts) == .authorized
    }

    /// Request contacts access if we don't have it yet. Returns true on
    /// success. Idempotent: returns immediately if already authorized.
    public func requestAccess() async -> Bool {
        switch CNContactStore.authorizationStatus(for: .contacts) {
        case .authorized:
            return true
        case .notDetermined:
            return await withCheckedContinuation { cont in
                store.requestAccess(for: .contacts) { granted, _ in
                    cont.resume(returning: granted)
                }
            }
        default:
            return false
        }
    }

    /// Look up a handle. Returns nil if no match, permission denied, or
    /// the lookup table hasn't been warmed yet.
    public func resolve(_ handle: String?) async -> ResolvedContact? {
        guard let handle else { return nil }
        try? await warmIfNeeded()
        if handle.contains("@") {
            let key = Self.normalizeEmail(handle)
            if let c = byEmail[key] { return ResolvedContact(from: c) }
        } else {
            let key = Self.normalizePhone(handle)
            if let c = byPhone[key] { return ResolvedContact(from: c) }
        }
        return nil
    }

    /// Force a refresh from CNContactStore. Skips the TTL.
    public func reload() throws {
        try loadAll()
    }

    private func warmIfNeeded() async throws {
        if let lastLoaded, Date().timeIntervalSince(lastLoaded) < ttl { return }
        try loadAll()
    }

    private func loadAll() throws {
        guard hasPermission else {
            self.byPhone.removeAll()
            self.byEmail.removeAll()
            self.lastLoaded = Date()
            return
        }
        let keys: [CNKeyDescriptor] = [
            CNContactGivenNameKey as CNKeyDescriptor,
            CNContactFamilyNameKey as CNKeyDescriptor,
            CNContactOrganizationNameKey as CNKeyDescriptor,
            CNContactPhoneNumbersKey as CNKeyDescriptor,
            CNContactEmailAddressesKey as CNKeyDescriptor,
            CNContactImageDataKey as CNKeyDescriptor,
            CNContactImageDataAvailableKey as CNKeyDescriptor,
        ]
        let request = CNContactFetchRequest(keysToFetch: keys)
        var nextPhone: [String: CNContact] = [:]
        var nextEmail: [String: CNContact] = [:]
        try store.enumerateContacts(with: request) { contact, _ in
            for phone in contact.phoneNumbers {
                let key = Self.normalizePhone(phone.value.stringValue)
                if !key.isEmpty { nextPhone[key] = contact }
            }
            for email in contact.emailAddresses {
                let key = Self.normalizeEmail(email.value as String)
                if !key.isEmpty { nextEmail[key] = contact }
            }
        }
        self.byPhone = nextPhone
        self.byEmail = nextEmail
        self.lastLoaded = Date()
    }

    // MARK: - Normalization

    static func normalizePhone(_ raw: String) -> String {
        let digits = raw.unicodeScalars.filter { CharacterSet.decimalDigits.contains($0) }
        let str = String(String.UnicodeScalarView(digits))
        return str.count >= 10 ? String(str.suffix(10)) : str
    }

    static func normalizeEmail(_ raw: String) -> String {
        raw.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    }
}

public struct ResolvedContact: Sendable {
    public let displayName: String
    public let imageData: Data?

    init(from contact: CNContact) {
        var parts: [String] = []
        if !contact.givenName.isEmpty { parts.append(contact.givenName) }
        if !contact.familyName.isEmpty { parts.append(contact.familyName) }
        let composed = parts.joined(separator: " ")
        self.displayName = composed.isEmpty ? contact.organizationName : composed
        self.imageData = contact.imageDataAvailable ? contact.imageData : nil
    }
}
