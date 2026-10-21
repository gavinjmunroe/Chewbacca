import Foundation
import Combine

// Every mock below returns empty data. Amber never ships invented people.
// When a build isn't pointed at a live amber-agent, views render honest
// empty states instead of fake graphs.

@MainActor
final class MockChatService: AmberChatService {
    var injectedError: Error?

    func ask(question: String, topK: Int?, filter: [String: String]?) async throws -> AmberAnswerPayload {
        try? await Task.sleep(nanoseconds: 150_000_000)
        if let err = injectedError { throw err }
        throw AmberServiceError.server(message: "Amber is not connected in this build. Configure AmberAgentBaseURL and sign in with Privy.", status: 503)
    }

    func suggestions() async throws -> [NetworkSuggestion] { [] }
}

@MainActor
final class MockContactRepository: ContactRepository {
    private var store: [NetworkContact] = []

    init(seed: [NetworkContact] = []) { self.store = seed }

    func fetch(circle: NetworkCircle, query: String) async throws -> [NetworkContact] {
        store
            .filter { circle == .all || $0.circle == circle }
            .filter { c in
                query.isEmpty ||
                c.name.localizedCaseInsensitiveContains(query) ||
                c.role.localizedCaseInsensitiveContains(query)
            }
            .sorted { $0.name < $1.name }
    }

    func contact(id: UUID) async throws -> NetworkContact? { store.first { $0.id == id } }

    func upsert(_ contact: NetworkContact) async throws {
        if let idx = store.firstIndex(where: { $0.id == contact.id }) { store[idx] = contact }
        else { store.append(contact) }
    }

    func delete(id: UUID) async throws { store.removeAll { $0.id == id } }

    func sectionLetters() async throws -> [String] {
        Array(Set(store.map { $0.sectionLetter })).sorted()
    }
}

@MainActor
final class MockGraphService: NetworkGraphService {
    func load() async throws -> NetworkGraph {
        NetworkGraph(selfContactId: UUID(), nodes: [], edges: [])
    }
    func warmPath(to contactId: UUID) async throws -> [NetworkContact] { [] }
    func mutualCount(with contactId: UUID) async throws -> Int { 0 }
}

@MainActor
final class MockProfileService: ProfileService {
    private var profile = AmberProfile(
        name: "Welcome",
        initials: "A",
        role: "Finish onboarding to populate this card.",
        avatarColorHex: NetworkTint.amber,
        amberId: "amber:not-minted",
        tags: [],
        streakDays: 0,
        mutualsCount: 0,
        eventsCount: 0,
        freeSlotLabel: ""
    )

    func current() async throws -> AmberProfile { profile }
    func update(_ newValue: AmberProfile) async throws { self.profile = newValue }
    func memories(limit: Int) async throws -> [NetworkMemory] { [] }
}

@MainActor
final class MockIntegrationsService: IntegrationsService {
    func list() async throws -> [ConnectedApp] { [] }

    func connect(_ provider: ConnectedApp.Provider) async throws -> ComposioAuthSession {
        throw AmberServiceError.server(message: "Composio isn't configured in this build.", status: 503)
    }
    func disconnect(_ provider: ConnectedApp.Provider) async throws {}
    func completeAuth(sessionId: String, callbackURL: URL) async throws {}
}

@MainActor
final class MockPeopleDiscoveryService: PeopleDiscoveryService {
    func search(query: String, limit: Int) async throws -> [DiscoveredPerson] { [] }
}

@MainActor
final class MockIngestService: IngestService {
    private(set) var log: [(IngestPipe, [IngestItem])] = []
    func ingest(_ pipe: IngestPipe, items: [IngestItem]) async throws {
        log.append((pipe, items))
    }
}

@MainActor
final class MockNotificationsService: NotificationsService {
    var preferences = NotificationPreferences()
    private var store: [AmberNotification] = []

    func registerForPushIfAllowed() async {}
    func syncDeviceToken(_ token: Data) async throws {}
    func inbox() async throws -> [AmberNotification] { store }
    func markRead(id: UUID) async throws {
        if let idx = store.firstIndex(where: { $0.id == id }) { store[idx].isRead = true }
    }
    func unreadCount() async throws -> Int { store.filter { !$0.isRead }.count }
}

final class MockAnalyticsService: AnalyticsService {
    func track(_ event: String, properties: [String: String]) {
        #if DEBUG
        print("[analytics]", event, properties)
        #endif
    }
    func identify(userId: String?) {}
}

final class MockCrashService: CrashService {
    func record(_ error: Error, context: [String: String]) {
        #if DEBUG
        print("[crash]", error.localizedDescription, context)
        #endif
    }
    func setUser(id: String?) {}
    func addBreadcrumb(_ message: String) {}
}

@MainActor
final class MockAuthService: AmberAuthService {
    var isAuthenticated: Bool = false
    var hasMintedIdentity: Bool = false
    var currentPrivyDid: String? { nil }
    private(set) var appLockEnabled: Bool = false

    func signInWithApple() async throws {
        throw AmberServiceError.server(message: "Privy SDK not wired.", status: 501)
    }
    func signInWithEmail(_ email: String) async throws {
        throw AmberServiceError.server(message: "Privy SDK not wired.", status: 501)
    }
    func signOut() async throws { isAuthenticated = false; hasMintedIdentity = false }
    func deleteAccount() async throws { isAuthenticated = false; hasMintedIdentity = false }
    func currentAuthToken() async throws -> String {
        throw AmberServiceError.unauthenticated
    }
    func refreshToken() async throws {}

    func mintIdentity(ownerPubkey: String, profile: MintProfile) async throws -> MintedIdentity {
        throw AmberServiceError.server(message: "Mint requires a live amber-agent connection.", status: 503)
    }
    func fetchIdentity() async throws -> MintedIdentity? { nil }

    func setAppLockEnabled(_ enabled: Bool) async throws { appLockEnabled = enabled }
    func authenticateWithBiometrics(reason: String) async throws {
        try? await Task.sleep(nanoseconds: 300_000_000)
    }
}

// MARK: - Factory

@MainActor
extension AmberServices {
    /// Mock services return empty collections and clear error messages.
    /// Use this for SwiftUI Previews or in environments without a live
    /// amber-agent. No invented people, no invented graphs, ever.
    static func mock() -> AmberServices {
        AmberServices(
            chat: MockChatService(),
            contacts: MockContactRepository(),
            graph: MockGraphService(),
            profile: MockProfileService(),
            integrations: MockIntegrationsService(),
            peopleDiscovery: MockPeopleDiscoveryService(),
            ingest: MockIngestService(),
            notifications: MockNotificationsService(),
            analytics: MockAnalyticsService(),
            crash: MockCrashService(),
            auth: MockAuthService()
        )
    }
}
