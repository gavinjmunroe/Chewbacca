import Foundation
import Combine
import Contacts

/// Pulls contacts off the device via CNContactStore, normalizes them into
/// `NetworkContact` rows plus `/ingest/relationship` items, and hands both
/// to the rest of the service layer. Nothing leaves the device unless the
/// caller explicitly uploads via `services.ingest`.
@MainActor
final class DeviceContactsImporter: ObservableObject {
    enum Permission { case undetermined, denied, authorized }

    @Published private(set) var permission: Permission = .undetermined
    @Published private(set) var importedCount: Int = 0
    @Published private(set) var isRunning: Bool = false
    @Published var error: String?

    private let store = CNContactStore()
    private let services: AmberServices

    init(services: AmberServices) {
        self.services = services
        checkPermission()
    }

    func checkPermission() {
        switch CNContactStore.authorizationStatus(for: .contacts) {
        case .authorized: permission = .authorized
        case .denied, .restricted: permission = .denied
        case .notDetermined: permission = .undetermined
        @unknown default: permission = .undetermined
        }
    }

    func requestPermission() async -> Bool {
        do {
            let granted = try await store.requestAccess(for: .contacts)
            permission = granted ? .authorized : .denied
            return granted
        } catch {
            permission = .denied
            self.error = error.localizedDescription
            return false
        }
    }

    /// Read every device contact, upsert into the repository, and ingest the
    /// relationship signals to amber-agent. Safe to call repeatedly; server
    /// dedupes on externalId.
    func runFullSync() async {
        if permission != .authorized {
            _ = await requestPermission()
            guard permission == .authorized else { return }
        }
        guard !isRunning else { return }
        isRunning = true
        defer { isRunning = false }

        let keys = [
            CNContactGivenNameKey, CNContactFamilyNameKey, CNContactOrganizationNameKey,
            CNContactEmailAddressesKey, CNContactPhoneNumbersKey, CNContactIdentifierKey
        ] as [CNKeyDescriptor]

        let req = CNContactFetchRequest(keysToFetch: keys)
        req.sortOrder = .givenName
        var imported: [NetworkContact] = []

        do {
            try store.enumerateContacts(with: req) { contact, _ in
                let name = [contact.givenName, contact.familyName].filter { !$0.isEmpty }.joined(separator: " ")
                guard !name.isEmpty else { return }
                let initials = [contact.givenName, contact.familyName]
                    .filter { !$0.isEmpty }
                    .prefix(2)
                    .map { String($0.prefix(1)) }
                    .joined()
                    .uppercased()
                let role = contact.organizationName
                let email = contact.emailAddresses.first.map { $0.value as String }
                let phone = contact.phoneNumbers.first?.value.stringValue

                let normalized = NetworkContact(
                    name: name,
                    initials: initials,
                    role: role,
                    avatarColorHex: DeviceContactsImporter.colorFor(name: name),
                    amberId: "amber:device-\(contact.identifier.prefix(6))",
                    circle: .all,
                    email: email,
                    phone: phone
                )
                imported.append(normalized)
            }

            for contact in imported {
                try? await services.contacts.upsert(contact)
            }

            let items = imported.map { c in
                IngestItem(
                    id: c.amberId,
                    text: "\(c.name) is in \(c.role.isEmpty ? "the caller's device contacts" : c.role).",
                    healthDimension: "social",
                    secondaryDimensions: nil,
                    personId: c.amberId,
                    personName: c.name,
                    kind: "contact",
                    visibility: "private",
                    createdAt: ISO8601DateFormatter().string(from: Date()),
                    extra: nil
                )
            }
            try? await services.ingest.ingest(.relationship, items: items)

            importedCount = imported.count
            AmberHaptics.success()
        } catch {
            self.error = error.localizedDescription
            AmberHaptics.failure()
        }
    }

    /// Deterministic pastel color for a name so the same person always
    /// renders with the same avatar tint across the app.
    private static func colorFor(name: String) -> String {
        let palette = [NetworkTint.blue, NetworkTint.pink, NetworkTint.green, NetworkTint.purple, NetworkTint.mint, NetworkTint.amber]
        let hash = abs(name.hashValue)
        return palette[hash % palette.count]
    }
}
