import SwiftUI

// MARK: - Network Contact

struct NetworkContact: Identifiable, Hashable, Codable {
    let id: UUID
    let name: String
    let initials: String
    let role: String
    let avatarColorHex: String
    let mutualCount: Int
    let warmPath: String?
    let tags: [NetworkTag]
    let amberId: String
    let note: String?
    let circle: NetworkCircle
    let email: String?
    let phone: String?
    let lastContactedAt: Date?

    init(
        id: UUID = UUID(),
        name: String,
        initials: String,
        role: String,
        avatarColorHex: String,
        mutualCount: Int = 0,
        warmPath: String? = nil,
        tags: [NetworkTag] = [],
        amberId: String,
        note: String? = nil,
        circle: NetworkCircle = .all,
        email: String? = nil,
        phone: String? = nil,
        lastContactedAt: Date? = nil
    ) {
        self.id = id
        self.name = name
        self.initials = initials
        self.role = role
        self.avatarColorHex = avatarColorHex
        self.mutualCount = mutualCount
        self.warmPath = warmPath
        self.tags = tags
        self.amberId = amberId
        self.note = note
        self.circle = circle
        self.email = email
        self.phone = phone
        self.lastContactedAt = lastContactedAt
    }

    var avatarColor: Color { Color(hex: avatarColorHex) }
    var sectionLetter: String { String(name.prefix(1)).uppercased() }
}

struct NetworkTag: Hashable, Codable {
    let text: String
    let tintHex: String

    var tint: Color { Color(hex: tintHex) }
}

enum NetworkCircle: String, CaseIterable, Identifiable, Codable {
    case inner = "Inner Circle"
    case reconnect = "Reconnect"
    case all = "All Circles"

    var id: String { rawValue }
}

// MARK: - Suggestions / Answers

struct NetworkSuggestion: Identifiable, Hashable, Codable {
    let id: UUID
    let label: String

    init(id: UUID = UUID(), label: String) {
        self.id = id
        self.label = label
    }
}

struct AmberAnswer: Identifiable, Hashable, Codable {
    let id: UUID
    let question: String
    let askedAt: Date
    var headline: String
    var lede: String
    var body: String
    var sourceContactIds: [UUID]
    var topPickContactIds: [UUID]
    var reasons: [AmberReason]
    var isStreaming: Bool

    init(
        id: UUID = UUID(),
        question: String,
        askedAt: Date = Date(),
        headline: String = "",
        lede: String = "",
        body: String = "",
        sourceContactIds: [UUID] = [],
        topPickContactIds: [UUID] = [],
        reasons: [AmberReason] = [],
        isStreaming: Bool = false
    ) {
        self.id = id
        self.question = question
        self.askedAt = askedAt
        self.headline = headline
        self.lede = lede
        self.body = body
        self.sourceContactIds = sourceContactIds
        self.topPickContactIds = topPickContactIds
        self.reasons = reasons
        self.isStreaming = isStreaming
    }
}

struct AmberReason: Identifiable, Hashable, Codable {
    let id: UUID
    let icon: String
    let text: String
    let contactId: UUID?

    init(id: UUID = UUID(), icon: String, text: String, contactId: UUID? = nil) {
        self.id = id
        self.icon = icon
        self.text = text
        self.contactId = contactId
    }
}

// MARK: - Memories + Connected Apps

struct NetworkMemory: Identifiable, Hashable, Codable {
    let id: UUID
    let date: String
    let title: String
    let subtitle: String
    let tag: String

    init(id: UUID = UUID(), date: String, title: String, subtitle: String, tag: String) {
        self.id = id
        self.date = date
        self.title = title
        self.subtitle = subtitle
        self.tag = tag
    }
}

struct ConnectedApp: Identifiable, Hashable, Codable {
    enum Provider: String, Codable, CaseIterable {
        case googleCalendar
        case gmail
        case photos
        case appleHealth
        case linkedIn
        case spotify
        case solana
        case privy
    }

    let id: UUID
    let provider: Provider
    let name: String
    let systemIcon: String
    let tintHex: String
    var detail: String
    var detailLine: String
    var isConnected: Bool

    init(
        id: UUID = UUID(),
        provider: Provider,
        name: String,
        systemIcon: String,
        tintHex: String,
        detail: String,
        detailLine: String,
        isConnected: Bool
    ) {
        self.id = id
        self.provider = provider
        self.name = name
        self.systemIcon = systemIcon
        self.tintHex = tintHex
        self.detail = detail
        self.detailLine = detailLine
        self.isConnected = isConnected
    }

    var tint: Color { Color(hex: tintHex) }
}

// MARK: - User Profile

struct AmberProfile: Identifiable, Hashable, Codable {
    let id: UUID
    var name: String
    var initials: String
    var role: String
    var avatarColorHex: String
    var amberId: String
    var tags: [NetworkTag]
    var streakDays: Int
    var mutualsCount: Int
    var eventsCount: Int
    var freeSlotLabel: String

    init(
        id: UUID = UUID(),
        name: String,
        initials: String,
        role: String,
        avatarColorHex: String,
        amberId: String,
        tags: [NetworkTag] = [],
        streakDays: Int = 0,
        mutualsCount: Int = 0,
        eventsCount: Int = 0,
        freeSlotLabel: String = ""
    ) {
        self.id = id
        self.name = name
        self.initials = initials
        self.role = role
        self.avatarColorHex = avatarColorHex
        self.amberId = amberId
        self.tags = tags
        self.streakDays = streakDays
        self.mutualsCount = mutualsCount
        self.eventsCount = eventsCount
        self.freeSlotLabel = freeSlotLabel
    }

    var avatarColor: Color { Color(hex: avatarColorHex) }
}

// MARK: - Graph

struct NetworkGraph: Codable {
    let selfContactId: UUID
    let nodes: [NetworkContact]
    let edges: [NetworkEdge]
}

struct NetworkEdge: Codable, Hashable {
    let from: UUID
    let to: UUID
    let weight: Double
    let reason: String?
}

// MARK: - Notifications

struct AmberNotification: Identifiable, Hashable, Codable {
    enum Kind: String, Codable { case intro, reminder, memory, event, system }

    let id: UUID
    let kind: Kind
    let title: String
    let body: String
    let createdAt: Date
    var isRead: Bool
    let deeplink: String?
}

// MARK: - Tints

enum NetworkTint {
    static let blue    = "3A9CF5"
    static let pink    = "E94F8A"
    static let green   = "3CB67B"
    static let purple  = "9B6FE8"
    static let mint    = "4CC9B3"
    static let amber   = "F4C430"
}
