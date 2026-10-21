import Foundation
import Combine

// MARK: - Auth (Privy SDK + amber-agent identity)

@MainActor
final class LiveAuthService: AmberAuthService {
    private let idClient: AmberIDClient
    private let keychain: AmberKeychain
    private let privy: PrivySDKAdapter

    init(idClient: AmberIDClient, keychain: AmberKeychain, privy: PrivySDKAdapter) {
        self.idClient = idClient
        self.keychain = keychain
        self.privy = privy
    }

    var isAuthenticated: Bool { privy.isAuthenticated }
    var hasMintedIdentity: Bool { keychain.readString(.cnftAssetId) != nil }
    var currentPrivyDid: String? { privy.userId }

    func signInWithApple() async throws {
        try await privy.signInWithApple()
    }

    func signInWithEmail(_ email: String) async throws {
        try await privy.signInWithEmail(email)
    }

    func signOut() async throws {
        try await privy.signOut()
        keychain.delete(.privyAccessToken)
        keychain.delete(.cnftAssetId)
    }

    func deleteAccount() async throws {
        // Account deletion is owned by amber-id (the identity vault), not by
        // amber-agent. Required for App Store data-deletion compliance.
        struct Req: Encodable {}
        _ = try await idClient.postVoid("/api/account/delete", body: Req())
        try await signOut()
    }

    func currentAuthToken() async throws -> String {
        try await privy.accessToken()
    }

    func refreshToken() async throws { try await privy.refreshAccessToken() }

    struct IdentityResponse: Decodable {
        let cnftMint: String?
        let assetId: String?
        let signature: String?
        let merkleTree: String?
        let mintedAt: String?
        let idempotent: Bool?
    }

    struct MintBody: Encodable {
        let ownerPubkey: String
        let displayName: String
        let birthday: String
        let birthdayTime: String?
        let birthLocation: String?
        let almaMater: String?
        let hometown: String?
        let personalityType: String?
        let personalityResult: [String: String]?
    }

    func mintIdentity(ownerPubkey: String, profile: MintProfile) async throws -> MintedIdentity {
        let body = MintBody(
            ownerPubkey: ownerPubkey,
            displayName: profile.displayName,
            birthday: profile.birthday,
            birthdayTime: profile.birthdayTime,
            birthLocation: profile.birthLocation,
            almaMater: profile.almaMater,
            hometown: profile.hometown,
            personalityType: profile.personalityType,
            personalityResult: profile.personalityResult
        )
        let resp: IdentityResponse = try await idClient.post("/api/identity/mint", body: body)
        if let assetId = resp.assetId { keychain.writeString(.cnftAssetId, value: assetId) }
        return MintedIdentity(
            cnftMint: resp.cnftMint, assetId: resp.assetId,
            signature: resp.signature, merkleTree: resp.merkleTree,
            mintedAt: resp.mintedAt, idempotent: resp.idempotent
        )
    }

    func fetchIdentity() async throws -> MintedIdentity? {
        do {
            let resp: IdentityResponse = try await idClient.get("/api/identity/me")
            return MintedIdentity(
                cnftMint: resp.cnftMint, assetId: resp.assetId,
                signature: resp.signature, merkleTree: resp.merkleTree,
                mintedAt: resp.mintedAt, idempotent: resp.idempotent
            )
        } catch AmberServiceError.server(_, 404) {
            return nil
        }
    }

    // App lock (biometric) — managed via LocalAuthentication; token lives in keychain.
    var appLockEnabled: Bool { keychain.readBool(.appLockEnabled) ?? false }

    func setAppLockEnabled(_ enabled: Bool) async throws {
        keychain.writeBool(.appLockEnabled, value: enabled)
    }

    func authenticateWithBiometrics(reason: String) async throws {
        try await BiometricsAuthenticator.authenticate(reason: reason)
    }
}

// MARK: - Contacts / Graph / Profile / Ingest / Discovery / Integrations

/// These services speak to amber-agent which proxies amber-id where
/// appropriate. Endpoint paths match the routes surfaced in amber-id
/// (contacts/profile/ingest) via the agent's Tiwari proxy.
actor LiveContactRepository: ContactRepository {
    private let client: AmberAgentClient

    init(client: AmberAgentClient) { self.client = client }

    struct WireContact: Codable {
        let id: String
        let name: String
        let role: String?
        let mutualCount: Int?
        let warmPath: String?
        let amberId: String?
        let circle: String?
        let avatarColorHex: String?
        let email: String?
        let phone: String?
        let tags: [WireTag]?

        struct WireTag: Codable { let text: String; let tintHex: String }
    }

    private func decode(_ w: WireContact) -> NetworkContact {
        let circle = NetworkCircle(rawValue: w.circle ?? "") ?? .all
        let uuid = UUID(uuidString: w.id) ?? UUID()
        return NetworkContact(
            id: uuid,
            name: w.name,
            initials: NetworkContact.initialsFor(name: w.name),
            role: w.role ?? "",
            avatarColorHex: w.avatarColorHex ?? NetworkTint.blue,
            mutualCount: w.mutualCount ?? 0,
            warmPath: w.warmPath,
            tags: w.tags?.map { NetworkTag(text: $0.text, tintHex: $0.tintHex) } ?? [],
            amberId: w.amberId ?? "",
            note: nil,
            circle: circle,
            email: w.email,
            phone: w.phone,
            lastContactedAt: nil
        )
    }

    func fetch(circle: NetworkCircle, query: String) async throws -> [NetworkContact] {
        struct Resp: Decodable { let contacts: [WireContact] }
        let q: [URLQueryItem] = [
            URLQueryItem(name: "circle", value: circle.rawValue),
            URLQueryItem(name: "q", value: query)
        ]
        let resp: Resp = try await client.get("/api/contacts", query: q)
        return resp.contacts.map(decode)
    }

    func contact(id: UUID) async throws -> NetworkContact? {
        struct Resp: Decodable { let contact: WireContact? }
        let resp: Resp = try await client.get("/api/contacts/\(id.uuidString)")
        return resp.contact.map(decode)
    }

    func upsert(_ contact: NetworkContact) async throws {
        struct Req: Encodable {
            let id: String; let name: String; let role: String; let circle: String
            let amberId: String; let mutualCount: Int
        }
        _ = try await client.postVoid("/api/contacts", body: Req(
            id: contact.id.uuidString, name: contact.name, role: contact.role,
            circle: contact.circle.rawValue, amberId: contact.amberId,
            mutualCount: contact.mutualCount
        ))
    }

    func delete(id: UUID) async throws {
        struct Req: Encodable { let id: String }
        _ = try await client.postVoid("/api/contacts/delete", body: Req(id: id.uuidString))
    }

    func sectionLetters() async throws -> [String] {
        struct Resp: Decodable { let letters: [String] }
        let resp: Resp = try await client.get("/api/contacts/letters")
        return resp.letters
    }
}

actor LiveGraphService: NetworkGraphService {
    private let client: AmberAgentClient
    init(client: AmberAgentClient) { self.client = client }

    struct WireGraph: Decodable {
        let selfContactId: String
        let nodes: [LiveContactRepository.WireContact]
        let edges: [WireEdge]

        struct WireEdge: Decodable {
            let from: String; let to: String; let weight: Double; let reason: String?
        }
    }

    func load() async throws -> NetworkGraph {
        let resp: WireGraph = try await client.get("/api/graph")
        let nodes = resp.nodes.map { w -> NetworkContact in
            NetworkContact(
                id: UUID(uuidString: w.id) ?? UUID(),
                name: w.name, initials: NetworkContact.initialsFor(name: w.name),
                role: w.role ?? "", avatarColorHex: w.avatarColorHex ?? NetworkTint.blue,
                mutualCount: w.mutualCount ?? 0, amberId: w.amberId ?? ""
            )
        }
        let edges = resp.edges.map {
            NetworkEdge(
                from: UUID(uuidString: $0.from) ?? UUID(),
                to: UUID(uuidString: $0.to) ?? UUID(),
                weight: $0.weight, reason: $0.reason
            )
        }
        return NetworkGraph(selfContactId: UUID(uuidString: resp.selfContactId) ?? UUID(), nodes: nodes, edges: edges)
    }

    func warmPath(to contactId: UUID) async throws -> [NetworkContact] {
        struct Resp: Decodable { let path: [LiveContactRepository.WireContact] }
        let resp: Resp = try await client.get("/api/graph/warm-path/\(contactId.uuidString)")
        return resp.path.map { w in
            NetworkContact(
                id: UUID(uuidString: w.id) ?? UUID(),
                name: w.name, initials: NetworkContact.initialsFor(name: w.name),
                role: w.role ?? "", avatarColorHex: w.avatarColorHex ?? NetworkTint.blue,
                mutualCount: w.mutualCount ?? 0, amberId: w.amberId ?? ""
            )
        }
    }

    func mutualCount(with contactId: UUID) async throws -> Int {
        struct Resp: Decodable { let mutualCount: Int }
        let resp: Resp = try await client.get("/api/contacts/\(contactId.uuidString)/mutuals")
        return resp.mutualCount
    }
}

actor LiveProfileService: ProfileService {
    private let client: AmberAgentClient
    init(client: AmberAgentClient) { self.client = client }

    struct WireProfile: Codable {
        let id: String; let name: String; let initials: String; let role: String
        let avatarColorHex: String; let amberId: String
        let streakDays: Int; let mutualsCount: Int; let eventsCount: Int; let freeSlotLabel: String
    }

    func current() async throws -> AmberProfile {
        let resp: WireProfile = try await client.get("/api/profile/me")
        return AmberProfile(
            id: UUID(uuidString: resp.id) ?? UUID(),
            name: resp.name, initials: resp.initials, role: resp.role,
            avatarColorHex: resp.avatarColorHex, amberId: resp.amberId,
            streakDays: resp.streakDays, mutualsCount: resp.mutualsCount,
            eventsCount: resp.eventsCount, freeSlotLabel: resp.freeSlotLabel
        )
    }

    func update(_ profile: AmberProfile) async throws {
        struct Req: Encodable { let name: String; let role: String }
        _ = try await client.postVoid("/api/profile/me", body: Req(name: profile.name, role: profile.role))
    }

    func memories(limit: Int) async throws -> [NetworkMemory] {
        struct WireMemory: Decodable { let id: String; let date: String; let title: String; let subtitle: String; let tag: String }
        struct Resp: Decodable { let memories: [WireMemory] }
        let resp: Resp = try await client.get("/api/memories", query: [URLQueryItem(name: "limit", value: "\(limit)")])
        return resp.memories.map {
            NetworkMemory(id: UUID(uuidString: $0.id) ?? UUID(), date: $0.date, title: $0.title, subtitle: $0.subtitle, tag: $0.tag)
        }
    }
}

actor LiveIngestService: IngestService {
    private let client: AmberAgentClient
    init(client: AmberAgentClient) { self.client = client }

    func ingest(_ pipe: IngestPipe, items: [IngestItem]) async throws {
        struct Req: Encodable { let items: [IngestItem] }
        _ = try await client.postVoid("/api/ingest/\(pipe.rawValue)", body: Req(items: items))
    }
}

// MARK: - Composio Integrations

actor LiveIntegrationsService: IntegrationsService {
    private let client: AmberAgentClient
    init(client: AmberAgentClient) { self.client = client }

    struct WireApp: Codable {
        let provider: String; let name: String; let systemIcon: String; let tintHex: String
        let detail: String; let detailLine: String; let isConnected: Bool
    }

    func list() async throws -> [ConnectedApp] {
        struct Resp: Decodable { let apps: [WireApp] }
        let resp: Resp = try await client.get("/api/integrations")
        return resp.apps.compactMap { w in
            guard let provider = ConnectedApp.Provider(rawValue: w.provider) else { return nil }
            return ConnectedApp(
                provider: provider, name: w.name, systemIcon: w.systemIcon, tintHex: w.tintHex,
                detail: w.detail, detailLine: w.detailLine, isConnected: w.isConnected
            )
        }
    }

    struct ConnectResp: Decodable { let sessionId: String; let authorizeUrl: String; let redirectUrl: String }

    func connect(_ provider: ConnectedApp.Provider) async throws -> ComposioAuthSession {
        struct Req: Encodable { let provider: String }
        let resp: ConnectResp = try await client.post("/api/integrations/connect", body: Req(provider: provider.rawValue))
        guard let auth = URL(string: resp.authorizeUrl), let redirect = URL(string: resp.redirectUrl) else {
            throw AmberServiceError.decoding
        }
        return ComposioAuthSession(sessionId: resp.sessionId, authorizeURL: auth, redirectURL: redirect, provider: provider)
    }

    func disconnect(_ provider: ConnectedApp.Provider) async throws {
        struct Req: Encodable { let provider: String }
        _ = try await client.postVoid("/api/integrations/disconnect", body: Req(provider: provider.rawValue))
    }

    func completeAuth(sessionId: String, callbackURL: URL) async throws {
        struct Req: Encodable { let sessionId: String; let callback: String }
        _ = try await client.postVoid("/api/integrations/callback",
                                      body: Req(sessionId: sessionId, callback: callbackURL.absoluteString))
    }
}

// MARK: - Exa People Discovery

actor LivePeopleDiscoveryService: PeopleDiscoveryService {
    private let client: AmberAgentClient
    init(client: AmberAgentClient) { self.client = client }

    struct WirePerson: Decodable {
        let id: String; let name: String; let title: String?; let company: String?
        let avatarUrl: String?; let linkedInUrl: String?; let snippet: String?; let score: Double
    }

    func search(query: String, limit: Int) async throws -> [DiscoveredPerson] {
        struct Req: Encodable { let query: String; let limit: Int }
        struct Resp: Decodable { let people: [WirePerson] }
        let resp: Resp = try await client.post("/api/discovery/people", body: Req(query: query, limit: limit))
        return resp.people.map {
            DiscoveredPerson(
                id: $0.id, name: $0.name, title: $0.title, company: $0.company,
                avatarURL: $0.avatarUrl.flatMap(URL.init(string:)),
                linkedInURL: $0.linkedInUrl.flatMap(URL.init(string:)),
                snippet: $0.snippet, score: $0.score
            )
        }
    }
}

// MARK: - Notifications

@MainActor
final class LiveNotificationsService: NotificationsService {
    private let client: AmberAgentClient
    var preferences: NotificationPreferences

    init(client: AmberAgentClient, preferences: NotificationPreferences = NotificationPreferences()) {
        self.client = client
        self.preferences = preferences
    }

    func registerForPushIfAllowed() async {
        let center = UNUserNotificationCenter.current()
        let settings = await center.notificationSettings()
        guard settings.authorizationStatus == .authorized || settings.authorizationStatus == .provisional else { return }
        await UIApplication.shared.registerForRemoteNotifications()
    }

    func syncDeviceToken(_ token: Data) async throws {
        struct Req: Encodable { let apnsToken: String }
        let hex = token.map { String(format: "%02x", $0) }.joined()
        _ = try await client.postVoid("/api/push/register", body: Req(apnsToken: hex))
    }

    func inbox() async throws -> [AmberNotification] {
        struct WireNote: Decodable {
            let id: String; let kind: String; let title: String; let body: String
            let createdAt: String; let isRead: Bool; let deeplink: String?
        }
        struct Resp: Decodable { let notifications: [WireNote] }
        let resp: Resp = try await client.get("/api/notifications")
        let formatter = ISO8601DateFormatter()
        return resp.notifications.compactMap { w in
            guard let kind = AmberNotification.Kind(rawValue: w.kind),
                  let createdAt = formatter.date(from: w.createdAt) else { return nil }
            return AmberNotification(
                id: UUID(uuidString: w.id) ?? UUID(), kind: kind,
                title: w.title, body: w.body, createdAt: createdAt,
                isRead: w.isRead, deeplink: w.deeplink
            )
        }
    }

    func markRead(id: UUID) async throws {
        struct Req: Encodable { let id: String }
        _ = try await client.postVoid("/api/notifications/read", body: Req(id: id.uuidString))
    }

    func unreadCount() async throws -> Int {
        struct Resp: Decodable { let count: Int }
        let resp: Resp = try await client.get("/api/notifications/unread-count")
        return resp.count
    }
}

// MARK: - Analytics / Crash (stubs for real providers)

final class LiveAnalyticsService: AnalyticsService {
    func track(_ event: String, properties: [String: String]) {
        #if DEBUG
        print("[analytics]", event, properties)
        #endif
    }
    func identify(userId: String?) {}
}

final class LiveCrashService: CrashService {
    func record(_ error: Error, context: [String: String]) {
        #if DEBUG
        print("[crash]", error.localizedDescription, context)
        #endif
    }
    func setUser(id: String?) {}
    func addBreadcrumb(_ message: String) {}
}

// MARK: - Helpers

extension NetworkContact {
    static func initialsFor(name: String) -> String {
        name.split(separator: " ").prefix(2).map { String($0.prefix(1)) }.joined().uppercased()
    }
}

// MARK: - Services Factory (live)

@MainActor
extension AmberServices {
    static func live(config: AmberAppConfig = .default) -> AmberServices {
        let crash = LiveCrashService()
        let keychain = AmberKeychain()
        let privy = PrivySDKAdapter(appId: config.privyAppId, keychain: keychain)
        let tokenProvider: @Sendable () async throws -> String = {
            try await privy.accessToken()
        }
        let agent = AmberAgentClient(baseURL: config.amberAgentBaseURL, crash: crash, tokenProvider: tokenProvider)
        let idClient = AmberIDClient(baseURL: config.amberIDBaseURL, crash: crash, tokenProvider: tokenProvider)
        let auth = LiveAuthService(idClient: idClient, keychain: keychain, privy: privy)

        return AmberServices(
            chat: LiveChatService(client: agent),
            contacts: LiveContactRepository(client: agent),
            graph: LiveGraphService(client: agent),
            profile: LiveProfileService(client: agent),
            integrations: LiveIntegrationsService(client: agent),
            peopleDiscovery: LivePeopleDiscoveryService(client: agent),
            ingest: LiveIngestService(client: agent),
            notifications: LiveNotificationsService(client: agent),
            analytics: LiveAnalyticsService(),
            crash: crash,
            auth: auth
        )
    }
}

import UIKit
import UserNotifications
