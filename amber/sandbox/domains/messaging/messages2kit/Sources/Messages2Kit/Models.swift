// Public surface for Messages2Kit. Every type below is binding on both
// Messages2Kit (this repo) and ClearOut (the consumer). Changes here are
// breaking changes for ClearOut.
//
// Reference: clearout-messages2-roadmap.md Section 3.

import Foundation

// MARK: - Service

public enum Service: String, Sendable, Codable {
    case iMessage
    case sms
}

// MARK: - Attachment

public struct Attachment: Sendable, Hashable, Codable {
    public enum Kind: String, Sendable, Codable {
        case image
        case video
        case audio
        case file
        case link
    }

    public let id: String
    public let filename: String?
    public let mimeType: String?
    /// Path on disk if the attachment file is accessible.
    public let localURL: URL?
    public let kind: Kind

    public init(
        id: String,
        filename: String?,
        mimeType: String?,
        localURL: URL?,
        kind: Kind
    ) {
        self.id = id
        self.filename = filename
        self.mimeType = mimeType
        self.localURL = localURL
        self.kind = kind
    }
}

// MARK: - Participant

public struct Participant: Sendable, Hashable, Codable {
    public let handle: String
    public let contactName: String?
    /// JPEG image data, optional — sourced from Contacts.framework.
    public let avatarData: Data?

    public init(handle: String, contactName: String?, avatarData: Data?) {
        self.handle = handle
        self.contactName = contactName
        self.avatarData = avatarData
    }
}

// MARK: - Message

public struct Message: Sendable, Identifiable, Hashable, Codable {
    /// Stable ID across launches. Format: `"<chatGUID>:<ROWID>"`.
    public let id: String
    /// Chat GUID.
    public let conversationId: String
    /// Phone/email of the sender.
    public let handle: String
    /// Resolved name from Contacts.app, when available.
    public let contactName: String?
    /// Best-effort decoded message text. Empty string for attachment-only.
    public let text: String
    public let timestamp: Date
    public let isFromMe: Bool
    public let isRead: Bool
    public let service: Service
    public let attachments: [Attachment]
    /// For threaded replies: the GUID of the message being replied to.
    public let replyToMessageId: String?
    /// nil unless this is a group chat.
    public let groupChatTitle: String?

    public init(
        id: String,
        conversationId: String,
        handle: String,
        contactName: String?,
        text: String,
        timestamp: Date,
        isFromMe: Bool,
        isRead: Bool,
        service: Service,
        attachments: [Attachment],
        replyToMessageId: String?,
        groupChatTitle: String?
    ) {
        self.id = id
        self.conversationId = conversationId
        self.handle = handle
        self.contactName = contactName
        self.text = text
        self.timestamp = timestamp
        self.isFromMe = isFromMe
        self.isRead = isRead
        self.service = service
        self.attachments = attachments
        self.replyToMessageId = replyToMessageId
        self.groupChatTitle = groupChatTitle
    }
}

// MARK: - Conversation

public struct Conversation: Sendable, Identifiable, Hashable, Codable {
    /// Chat GUID.
    public let id: String
    /// Person name (DM) or group name (group).
    public let displayName: String
    /// All participant handles (raw).
    public let handles: [String]
    /// Resolved participants with names + avatars where possible.
    public let participants: [Participant]
    public let isGroupChat: Bool
    public let lastMessageDate: Date
    public let unreadCount: Int
    public let lastMessagePreview: String

    public init(
        id: String,
        displayName: String,
        handles: [String],
        participants: [Participant],
        isGroupChat: Bool,
        lastMessageDate: Date,
        unreadCount: Int,
        lastMessagePreview: String
    ) {
        self.id = id
        self.displayName = displayName
        self.handles = handles
        self.participants = participants
        self.isGroupChat = isGroupChat
        self.lastMessageDate = lastMessageDate
        self.unreadCount = unreadCount
        self.lastMessagePreview = lastMessagePreview
    }
}

// MARK: - Permissions

public struct PermissionInstructions: Sendable {
    public let title: String
    public let body: String
    /// Deep link into System Settings when available.
    public let settingsURL: URL?

    public init(title: String, body: String, settingsURL: URL?) {
        self.title = title
        self.body = body
        self.settingsURL = settingsURL
    }
}

// MARK: - Errors

public enum MessagesProviderError: Error, Sendable {
    case noPermission
    case databaseUnavailable
    case conversationNotFound(String)
    case sendFailed(reason: String)
    case unsupportedService
}

// MARK: - Provider protocol

public protocol MessagesProvider: Sendable {
    /// Real-time stream of new incoming messages (not from-me, not reactions).
    /// Begins from the moment of subscription.
    func incomingStream() -> AsyncStream<Message>

    /// All conversations sorted by last activity desc.
    func conversations(limit: Int) async throws -> [Conversation]

    /// Recent messages in one conversation, newest last.
    func messages(in conversationId: String, limit: Int) async throws -> [Message]

    /// All messages with a specific handle across conversations.
    /// Used by ClearOut to build per-person style profiles.
    func messagesWithHandle(_ handle: String, limit: Int) async throws -> [Message]

    /// Send a text message in an existing conversation. Returns the
    /// `Message` representing the just-sent text once it appears in
    /// chat.db (typically < 500ms).
    func send(text: String, to conversationId: String) async throws -> Message

    /// Mark messages as read locally. (chat.db writeback is best-effort
    /// and may be a no-op on macOS versions that lock the DB.)
    func markRead(_ messageIds: [String]) async throws

    /// True if we have Full Disk Access to read chat.db.
    var hasPermission: Bool { get }

    /// Human-readable instructions for granting permission, with a
    /// deep link to System Settings when available.
    func permissionInstructions() -> PermissionInstructions
}
