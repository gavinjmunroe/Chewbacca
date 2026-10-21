import Foundation
import Combine

// MARK: - Service Container

@MainActor
final class AmberServices: ObservableObject {
    let chat: any AmberChatService
    let contacts: any ContactRepository
    let graph: any NetworkGraphService
    let profile: any ProfileService
    let integrations: any IntegrationsService
    let peopleDiscovery: any PeopleDiscoveryService
    let ingest: any IngestService
    let notifications: any NotificationsService
    let analytics: any AnalyticsService
    let crash: any CrashService
    let auth: any AmberAuthService

    init(
        chat: any AmberChatService,
        contacts: any ContactRepository,
        graph: any NetworkGraphService,
        profile: any ProfileService,
        integrations: any IntegrationsService,
        peopleDiscovery: any PeopleDiscoveryService,
        ingest: any IngestService,
        notifications: any NotificationsService,
        analytics: any AnalyticsService,
        crash: any CrashService,
        auth: any AmberAuthService
    ) {
        self.chat = chat
        self.contacts = contacts
        self.graph = graph
        self.profile = profile
        self.integrations = integrations
        self.peopleDiscovery = peopleDiscovery
        self.ingest = ingest
        self.notifications = notifications
        self.analytics = analytics
        self.crash = crash
        self.auth = auth
    }
}

// MARK: - LoadState

enum LoadState<Value> {
    case idle
    case loading
    case loaded(Value)
    case failed(Error)

    var value: Value? { if case .loaded(let v) = self { return v }; return nil }
    var isLoading: Bool { if case .loading = self { return true }; return false }
}

// MARK: - Amber Errors

enum AmberServiceError: Error, LocalizedError, Equatable {
    case rateLimited
    case offline
    case unauthenticated
    case cnftRequired
    case server(message: String, status: Int)
    case moderation
    case decoding
    case unknown

    var errorDescription: String? {
        switch self {
        case .rateLimited:       return "Amber hit your rate limit. Try again in a moment."
        case .offline:           return "You're offline. Amber needs a connection to think."
        case .unauthenticated:   return "Please sign in to continue."
        case .cnftRequired:      return "Mint your Amber Identity before Amber can reason about your network."
        case .server(let m, _):  return m
        case .moderation:        return "Amber can't help with that request."
        case .decoding:          return "Amber got an unexpected response shape. Try again."
        case .unknown:           return "Something went wrong. Please try again."
        }
    }
}

// MARK: - Amber Chat (wraps POST /ask)

protocol AmberChatService: AnyObject {
    /// Request/response against amber-id `/ask`. Streaming effects are a client-side reveal.
    func ask(question: String, topK: Int?, filter: [String: String]?) async throws -> AmberAnswerPayload

    func suggestions() async throws -> [NetworkSuggestion]
}

struct AmberAnswerPayload: Codable, Equatable {
    let answer: String
    let people: [AmberAskPerson]
    let citations: [AmberAskCitation]
    let dimensionWeights: [String: Double]?
    let model: String
    let usedPeopleRank: Bool
    let tookMs: Int?
}

struct AmberAskPerson: Codable, Equatable, Identifiable, Hashable {
    let id: String
    let name: String?
    let personId: String?
    let score: Double
    let pineconeScore: Double?
    let reasoning: String?
}

struct AmberAskCitation: Codable, Equatable, Identifiable, Hashable {
    var id: String { ref }
    let ref: String
    let personId: String?
    let name: String?
    let kind: String?
    let source: String?
    let snippet: String
    let score: Double
    let createdAt: String?
}

// MARK: - Contacts

protocol ContactRepository: AnyObject {
    func fetch(circle: NetworkCircle, query: String) async throws -> [NetworkContact]
    func contact(id: UUID) async throws -> NetworkContact?
    func upsert(_ contact: NetworkContact) async throws
    func delete(id: UUID) async throws
    func sectionLetters() async throws -> [String]
}

// MARK: - Graph

protocol NetworkGraphService: AnyObject {
    func load() async throws -> NetworkGraph
    func warmPath(to contactId: UUID) async throws -> [NetworkContact]
    func mutualCount(with contactId: UUID) async throws -> Int
}

// MARK: - Profile

protocol ProfileService: AnyObject {
    func current() async throws -> AmberProfile
    func update(_ profile: AmberProfile) async throws
    func memories(limit: Int) async throws -> [NetworkMemory]
}

// MARK: - Integrations (Composio-backed)

protocol IntegrationsService: AnyObject {
    func list() async throws -> [ConnectedApp]
    /// Kicks off a Composio OAuth flow for the given provider. iOS opens the URL and waits for the deep-link callback.
    func connect(_ provider: ConnectedApp.Provider) async throws -> ComposioAuthSession
    func disconnect(_ provider: ConnectedApp.Provider) async throws
    func completeAuth(sessionId: String, callbackURL: URL) async throws
}

struct ComposioAuthSession: Codable, Equatable {
    let sessionId: String
    let authorizeURL: URL
    let redirectURL: URL
    let provider: ConnectedApp.Provider
}

// MARK: - People Discovery (Exa-backed)

protocol PeopleDiscoveryService: AnyObject {
    /// Search Exa for people matching a natural-language query. Returns people not already in the graph.
    func search(query: String, limit: Int) async throws -> [DiscoveredPerson]
}

struct DiscoveredPerson: Identifiable, Hashable, Codable {
    let id: String
    let name: String
    let title: String?
    let company: String?
    let avatarURL: URL?
    let linkedInURL: URL?
    let snippet: String?
    let score: Double
}

// MARK: - Ingest (four-pipe API on amber-id)

protocol IngestService: AnyObject {
    func ingest(_ pipe: IngestPipe, items: [IngestItem]) async throws
}

enum IngestPipe: String { case agent, health, checkin, relationship }

struct IngestItem: Codable, Equatable {
    let id: String?
    let text: String
    let healthDimension: String
    let secondaryDimensions: [String]?
    let personId: String?
    let personName: String?
    let kind: String?
    let visibility: String?
    let createdAt: String?
    let extra: [String: String]?
}

// MARK: - Notifications

protocol NotificationsService: AnyObject {
    func registerForPushIfAllowed() async
    func syncDeviceToken(_ token: Data) async throws
    func inbox() async throws -> [AmberNotification]
    func markRead(id: UUID) async throws
    func unreadCount() async throws -> Int
    var preferences: NotificationPreferences { get set }
}

struct NotificationPreferences: Codable, Equatable {
    var intros: Bool = true
    var reminders: Bool = true
    var memories: Bool = true
    var events: Bool = true
}

// MARK: - Analytics / Crash

protocol AnalyticsService: AnyObject {
    func track(_ event: String, properties: [String: String])
    func identify(userId: String?)
}

protocol CrashService: AnyObject {
    func record(_ error: Error, context: [String: String])
    func setUser(id: String?)
    func addBreadcrumb(_ message: String)
}

// MARK: - Auth (Privy iOS SDK → amber-id)

protocol AmberAuthService: AnyObject {
    var isAuthenticated: Bool { get }
    var hasMintedIdentity: Bool { get }
    var currentPrivyDid: String? { get }

    func signInWithApple() async throws
    func signInWithEmail(_ email: String) async throws
    func signOut() async throws
    func deleteAccount() async throws
    func currentAuthToken() async throws -> String
    func refreshToken() async throws

    func mintIdentity(ownerPubkey: String, profile: MintProfile) async throws -> MintedIdentity
    func fetchIdentity() async throws -> MintedIdentity?

    func setAppLockEnabled(_ enabled: Bool) async throws
    var appLockEnabled: Bool { get }
    func authenticateWithBiometrics(reason: String) async throws
}

struct MintProfile: Codable, Equatable {
    var displayName: String
    var birthday: String
    var birthdayTime: String?
    var birthLocation: String?
    var almaMater: String?
    var hometown: String?
    var personalityType: String?
    var personalityResult: [String: String]?
}

struct MintedIdentity: Codable, Equatable {
    let cnftMint: String?
    let assetId: String?
    let signature: String?
    let merkleTree: String?
    let mintedAt: String?
    let idempotent: Bool?
}
