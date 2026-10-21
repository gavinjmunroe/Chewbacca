// Circle data model — the core communication primitive in Amber

import Foundation
import SwiftUI
import SwiftData

// MARK: - Circle Type (mandatory selection on creation)

enum CircleType: String, Codable, CaseIterable {
    case oneToOne = "1:1"
    case oneToMany = "1:many"
    case manyToMany = "many:many"

    var color: Color {
        switch self {
        case .oneToOne: return .circleOneToOne
        case .oneToMany: return .circleOneToMany
        case .manyToMany: return .circleManyToMany
        }
    }

    var label: String {
        switch self {
        case .oneToOne: return "1:1"
        case .oneToMany: return "Broadcast"
        case .manyToMany: return "Group"
        }
    }

    var description: String {
        switch self {
        case .oneToOne: return "Direct conversation between two people"
        case .oneToMany: return "One voice, many listeners"
        case .manyToMany: return "Everyone can talk"
        }
    }

    var icon: String {
        switch self {
        case .oneToOne: return "person.2.fill"
        case .oneToMany: return "megaphone.fill"
        case .manyToMany: return "bubble.left.and.bubble.right.fill"
        }
    }
}

// MARK: - Circle Tag (optional categorization for many:many)

enum CircleTag: String, Codable, CaseIterable {
    case club = "Club"
    case sorority = "Sorority"
    case fraternity = "Fraternity"
    case classGroup = "Class"
    case friendGroup = "Friend Group"
    case family = "Family"
    case project = "Project"
    case other = "Other"
}

// MARK: - Circle (SwiftData model)

@Model
final class SocialCircle {
    var remoteId: Int?
    var name: String
    var circleType: String          // CircleType raw value
    var circleTag: String?          // CircleTag raw value (optional)
    var visibility: String          // "private" | "members" | "public"
    var inviteToken: String?
    var memberCount: Int
    var isOwner: Bool
    var isPinned: Bool
    var hasAmberAgent: Bool
    var lastMessage: String?
    var lastMessageTime: Date?
    var unreadCount: Int
    var createdAt: Date

    init(
        name: String,
        circleType: CircleType = .manyToMany,
        circleTag: CircleTag? = nil,
        visibility: String = "private",
        isOwner: Bool = true
    ) {
        self.name = name
        self.circleType = circleType.rawValue
        self.circleTag = circleTag?.rawValue
        self.visibility = visibility
        self.memberCount = 1
        self.isOwner = isOwner
        self.isPinned = false
        self.hasAmberAgent = true
        self.unreadCount = 0
        self.createdAt = Date()
    }

    var type: CircleType {
        CircleType(rawValue: circleType) ?? .manyToMany
    }

    var tag: CircleTag? {
        guard let circleTag else { return nil }
        return CircleTag(rawValue: circleTag)
    }

    var shareLink: URL? {
        guard let token = inviteToken else { return nil }
        return URL(string: "https://amber.app/join/\(token)")
    }
}
