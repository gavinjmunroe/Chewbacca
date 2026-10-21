// chat.db reader. Ports the load-bearing patterns from photon-hq/imessage-kit
// to Swift, layered on GRDB instead of better-sqlite3.
//
// Reference patterns (audited from node_modules/@photon-ai/imessage-kit):
//   - Canonical message join: message JOIN chat_message_join JOIN chat JOIN handle
//   - Group detection: COUNT participants in chat_handle_join > 1
//   - Unread count: live subquery against message.is_read + is_from_me
//   - Reaction map: associated_message_type 2000-2005 (add), 3000-3005 (remove)
//   - attributedBody decode: NSKeyedUnarchiver against NSAttributedString
//   - Mac epoch: 2001-01-01 UTC, nanoseconds since on macOS 10.13+
//
// Schema version compat: chat.db has accumulated columns since macOS 10.x.
// We detect optional columns at startup (date_edited, date_retracted,
// thread_originator_guid) and gracefully degrade on older OS versions.

import Foundation
import GRDB

public actor ChatDatabase {
    private let dbPath: URL
    private var dbQueue: DatabaseQueue?
    private var hasEditedAt: Bool = false
    private var hasRetractedAt: Bool = false
    private var hasThreadOriginator: Bool = false

    /// Default chat.db location: ~/Library/Messages/chat.db
    public static var defaultPath: URL {
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Messages/chat.db")
    }

    public init(dbPath: URL = ChatDatabase.defaultPath) {
        self.dbPath = dbPath
    }

    public var path: URL { dbPath }

    /// Open the database read-only. Throws `noPermission` on TCC denial.
    public func open() throws {
        if dbQueue != nil { return }
        guard FileManager.default.fileExists(atPath: dbPath.path) else {
            throw MessagesProviderError.databaseUnavailable
        }
        do {
            var config = Configuration()
            config.readonly = true
            let queue = try DatabaseQueue(path: dbPath.path, configuration: config)
            self.dbQueue = queue
            try detectOptionalColumns()
        } catch let error as DatabaseError where error.resultCode.rawValue == 14 {
            // SQLITE_CANTOPEN — almost always Full Disk Access denial.
            throw MessagesProviderError.noPermission
        }
    }

    /// Mark messages as read by ROWID. Same caveats as `markAsRead(guids:)`.
    public func markAsReadByRowIds(_ rowIds: [Int64]) async throws {
        guard !rowIds.isEmpty else { return }
        guard FileManager.default.fileExists(atPath: dbPath.path) else {
            throw MessagesProviderError.databaseUnavailable
        }
        do {
            var config = Configuration()
            config.readonly = false
            config.busyMode = .timeout(2)
            let writeQueue = try DatabaseQueue(path: dbPath.path, configuration: config)
            try await writeQueue.write { db in
                let now = (Date().timeIntervalSince1970 - 978307200) * 1_000_000_000
                let CHUNK = 500
                for start in stride(from: 0, to: rowIds.count, by: CHUNK) {
                    let slice = Array(rowIds[start..<min(start + CHUNK, rowIds.count)])
                    let placeholders = Array(repeating: "?", count: slice.count).joined(separator: ",")
                    let args: [DatabaseValueConvertible] = [Int64(now)] + slice.map { $0 as DatabaseValueConvertible }
                    try db.execute(sql: """
                        UPDATE message
                           SET is_read = 1, date_read = ?
                         WHERE ROWID IN (\(placeholders))
                           AND is_from_me = 0
                           AND is_read = 0
                    """, arguments: StatementArguments(args)!)
                }
            }
            try writeQueue.close()
        } catch let error as DatabaseError where error.resultCode.rawValue == 14 {
            throw MessagesProviderError.noPermission
        }
    }

    /// Mark messages as read by GUID. Writes to chat.db via a separate
    /// read/write connection (the primary one is read-only).
    ///
    /// IMPORTANT caveats:
    ///   - Messages.app holds locks on chat.db while it's running. Writes
    ///     may block briefly or fail. We use SQLite's BUSY retry.
    ///   - Apple's iCloud Messages syncs read-state across devices but
    ///     ignores DB rows we modify directly. Your read flag will hold
    ///     locally but not propagate to your iPhone. That's an Apple
    ///     constraint, not a bug here.
    public func markAsRead(messageGuids: [String]) async throws {
        guard !messageGuids.isEmpty else { return }
        guard FileManager.default.fileExists(atPath: dbPath.path) else {
            throw MessagesProviderError.databaseUnavailable
        }
        do {
            var config = Configuration()
            config.readonly = false
            config.busyMode = .timeout(2)
            let writeQueue = try DatabaseQueue(path: dbPath.path, configuration: config)
            try await writeQueue.write { db in
                // mac-absolute-time nanoseconds = (ms since 1970 − 978307200000ms) × 1e6
                let now = (Date().timeIntervalSince1970 - 978307200) * 1_000_000_000
                let CHUNK = 500
                for start in stride(from: 0, to: messageGuids.count, by: CHUNK) {
                    let slice = Array(messageGuids[start..<min(start + CHUNK, messageGuids.count)])
                    let placeholders = Array(repeating: "?", count: slice.count).joined(separator: ",")
                    let args: [DatabaseValueConvertible] = [Int64(now)] + slice
                    try db.execute(sql: """
                        UPDATE message
                           SET is_read = 1, date_read = ?
                         WHERE guid IN (\(placeholders))
                           AND is_from_me = 0
                           AND is_read = 0
                    """, arguments: StatementArguments(args)!)
                }
            }
            try writeQueue.close()
        } catch let error as DatabaseError where error.resultCode.rawValue == 14 {
            throw MessagesProviderError.noPermission
        }
    }

    private func detectOptionalColumns() throws {
        guard let queue = dbQueue else { return }
        try queue.read { db in
            let cols = try Row.fetchAll(db, sql: "PRAGMA table_info(message)")
            let names = Set(cols.compactMap { $0["name"] as String? })
            hasEditedAt = names.contains("date_edited")
            hasRetractedAt = names.contains("date_retracted")
            hasThreadOriginator = names.contains("thread_originator_guid")
        }
    }

    // MARK: - Conversations

    /// One row per chat with last-message preview + unread count, in one
    /// SQL query. Ports the photon SDK's listChats() pattern but with a
    /// window function so we avoid N+1 round-trips.
    public func fetchConversations(limit: Int) throws -> [ConversationRow] {
        guard let queue = dbQueue else { throw MessagesProviderError.databaseUnavailable }
        let sql = """
            WITH ranked AS (
              SELECT
                cmj.chat_id,
                m.text,
                m.attributedBody,
                m.is_from_me,
                m.cache_has_attachments,
                m.date AS message_date,
                ROW_NUMBER() OVER (
                  PARTITION BY cmj.chat_id
                  ORDER BY m.date DESC, m.ROWID DESC
                ) AS rn
              FROM chat_message_join cmj
              JOIN message m ON m.ROWID = cmj.message_id
            ),
            unread AS (
              SELECT cmj.chat_id, COUNT(*) AS cnt
              FROM chat_message_join cmj
              JOIN message m ON m.ROWID = cmj.message_id
              WHERE m.is_from_me = 0 AND m.is_read = 0
              GROUP BY cmj.chat_id
            ),
            participants AS (
              SELECT chj.chat_id, COUNT(*) AS cnt
              FROM chat_handle_join chj
              GROUP BY chj.chat_id
            )
            SELECT
              c.ROWID            AS chat_rowid,
              c.guid             AS chat_guid,
              c.chat_identifier  AS chat_identifier,
              c.display_name     AS display_name,
              c.service_name     AS service_name,
              r.text             AS last_text,
              r.attributedBody   AS last_attributed_body,
              r.is_from_me       AS last_is_from_me,
              r.cache_has_attachments AS last_has_attachments,
              r.message_date     AS last_date,
              COALESCE(u.cnt, 0) AS unread_count,
              COALESCE(p.cnt, 1) AS participant_count
            FROM chat c
            LEFT JOIN ranked r       ON r.chat_id = c.ROWID AND r.rn = 1
            LEFT JOIN unread u       ON u.chat_id = c.ROWID
            LEFT JOIN participants p ON p.chat_id = c.ROWID
            WHERE (c.is_archived IS NULL OR c.is_archived = 0)
            ORDER BY r.message_date DESC NULLS LAST
            LIMIT ?
        """
        return try queue.read { db in
            let rows = try Row.fetchAll(db, sql: sql, arguments: [limit])
            return rows.map { row in
                ConversationRow(
                    chatRowId: row["chat_rowid"] ?? 0,
                    chatGuid: row["chat_guid"] ?? "",
                    chatIdentifier: row["chat_identifier"],
                    displayName: row["display_name"],
                    serviceName: row["service_name"],
                    lastText: row["last_text"],
                    lastAttributedBody: row["last_attributed_body"],
                    lastIsFromMe: (row["last_is_from_me"] as Int?) == 1,
                    lastHasAttachments: (row["last_has_attachments"] as Int?) == 1,
                    lastDate: Self.macTimestampToDate(row["last_date"]),
                    unreadCount: row["unread_count"] ?? 0,
                    participantCount: row["participant_count"] ?? 1
                )
            }
        }
    }

    public func fetchHandles(forChatId chatRowId: Int64) throws -> [String] {
        guard let queue = dbQueue else { throw MessagesProviderError.databaseUnavailable }
        return try queue.read { db in
            let rows = try Row.fetchAll(db, sql: """
                SELECT h.id AS handle
                FROM chat_handle_join chj
                JOIN handle h ON h.ROWID = chj.handle_id
                WHERE chj.chat_id = ?
            """, arguments: [chatRowId])
            return rows.compactMap { $0["handle"] as String? }
        }
    }

    // MARK: - Messages

    /// Fetch messages in a single conversation. Returns oldest → newest.
    public func fetchMessages(conversationGuid: String, limit: Int) throws -> [MessageRow] {
        guard let queue = dbQueue else { throw MessagesProviderError.databaseUnavailable }
        let extraCols = buildExtraColumnList()
        let sql = """
            SELECT
              m.ROWID                       AS rowid,
              m.guid                        AS guid,
              m.text                        AS text,
              m.attributedBody              AS attributed_body,
              m.is_from_me                  AS is_from_me,
              m.is_read                     AS is_read,
              m.is_delivered                AS is_delivered,
              m.date                        AS date,
              m.date_read                   AS date_read,
              m.date_delivered              AS date_delivered,
              m.associated_message_type     AS associated_type,
              m.associated_message_guid     AS associated_guid,
              m.cache_has_attachments       AS has_attachments,
              m.service                     AS service,
              h.id                          AS handle,
              c.guid                        AS chat_guid,
              c.display_name                AS chat_display_name,
              (SELECT COUNT(*) FROM chat_handle_join
                WHERE chat_handle_join.chat_id = c.ROWID) AS participant_count
              \(extraCols)
            FROM message m
            JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
            JOIN chat c ON c.ROWID = cmj.chat_id
            LEFT JOIN handle h ON h.ROWID = m.handle_id
            WHERE c.guid = ?
            ORDER BY m.date DESC
            LIMIT ?
        """
        return try queue.read { db in
            let rows = try Row.fetchAll(db, sql: sql, arguments: [conversationGuid, limit])
            // Reverse to oldest → newest for the renderer.
            return rows.reversed().map(Self.parseMessageRow)
        }
    }

    /// All messages with a given handle across every conversation. Used by
    /// ClearOut to build per-person style profiles.
    public func fetchMessagesWithHandle(_ handle: String, limit: Int) throws -> [MessageRow] {
        guard let queue = dbQueue else { throw MessagesProviderError.databaseUnavailable }
        let extraCols = buildExtraColumnList()
        let sql = """
            SELECT
              m.ROWID                       AS rowid,
              m.guid                        AS guid,
              m.text                        AS text,
              m.attributedBody              AS attributed_body,
              m.is_from_me                  AS is_from_me,
              m.is_read                     AS is_read,
              m.is_delivered                AS is_delivered,
              m.date                        AS date,
              m.date_read                   AS date_read,
              m.date_delivered              AS date_delivered,
              m.associated_message_type     AS associated_type,
              m.associated_message_guid     AS associated_guid,
              m.cache_has_attachments       AS has_attachments,
              m.service                     AS service,
              h.id                          AS handle,
              c.guid                        AS chat_guid,
              c.display_name                AS chat_display_name,
              (SELECT COUNT(*) FROM chat_handle_join
                WHERE chat_handle_join.chat_id = c.ROWID) AS participant_count
              \(extraCols)
            FROM message m
            JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
            JOIN chat c ON c.ROWID = cmj.chat_id
            LEFT JOIN handle h ON h.ROWID = m.handle_id
            WHERE h.id = ?
            ORDER BY m.date DESC
            LIMIT ?
        """
        return try queue.read { db in
            let rows = try Row.fetchAll(db, sql: sql, arguments: [handle, limit])
            return rows.reversed().map(Self.parseMessageRow)
        }
    }

    /// Fetch messages whose ROWID is greater than the given marker.
    /// Used by the watcher to pick up new rows since last poll.
    public func fetchMessagesSince(rowId: Int64, limit: Int = 100) throws -> [MessageRow] {
        guard let queue = dbQueue else { throw MessagesProviderError.databaseUnavailable }
        let extraCols = buildExtraColumnList()
        let sql = """
            SELECT
              m.ROWID                       AS rowid,
              m.guid                        AS guid,
              m.text                        AS text,
              m.attributedBody              AS attributed_body,
              m.is_from_me                  AS is_from_me,
              m.is_read                     AS is_read,
              m.is_delivered                AS is_delivered,
              m.date                        AS date,
              m.date_read                   AS date_read,
              m.date_delivered              AS date_delivered,
              m.associated_message_type     AS associated_type,
              m.associated_message_guid     AS associated_guid,
              m.cache_has_attachments       AS has_attachments,
              m.service                     AS service,
              h.id                          AS handle,
              c.guid                        AS chat_guid,
              c.display_name                AS chat_display_name,
              (SELECT COUNT(*) FROM chat_handle_join
                WHERE chat_handle_join.chat_id = c.ROWID) AS participant_count
              \(extraCols)
            FROM message m
            JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
            JOIN chat c ON c.ROWID = cmj.chat_id
            LEFT JOIN handle h ON h.ROWID = m.handle_id
            WHERE m.ROWID > ?
            ORDER BY m.ROWID ASC
            LIMIT ?
        """
        return try queue.read { db in
            let rows = try Row.fetchAll(db, sql: sql, arguments: [rowId, limit])
            return rows.map(Self.parseMessageRow)
        }
    }

    /// Latest ROWID in the message table. Used to set the watcher's
    /// starting cursor so we don't replay history on every launch.
    public func latestMessageRowId() throws -> Int64 {
        guard let queue = dbQueue else { throw MessagesProviderError.databaseUnavailable }
        return try queue.read { db in
            (try Int64.fetchOne(db, sql: "SELECT MAX(ROWID) FROM message")) ?? 0
        }
    }

    // MARK: - Attachments

    public func fetchAttachments(forMessageRowId rowId: Int64) throws -> [AttachmentRow] {
        guard let queue = dbQueue else { throw MessagesProviderError.databaseUnavailable }
        let sql = """
            SELECT
              a.guid       AS guid,
              a.filename   AS filename,
              a.mime_type  AS mime_type,
              a.uti        AS uti,
              a.total_bytes AS total_bytes,
              a.transfer_state AS transfer_state
            FROM attachment a
            JOIN message_attachment_join maj ON maj.attachment_id = a.ROWID
            WHERE maj.message_id = ?
        """
        return try queue.read { db in
            let rows = try Row.fetchAll(db, sql: sql, arguments: [rowId])
            return rows.map { row in
                AttachmentRow(
                    guid: row["guid"] ?? "",
                    filename: row["filename"],
                    mimeType: row["mime_type"],
                    uti: row["uti"],
                    totalBytes: row["total_bytes"] ?? 0,
                    transferState: row["transfer_state"] ?? 0
                )
            }
        }
    }

    // MARK: - Helpers

    private func buildExtraColumnList() -> String {
        var cols: [String] = []
        if hasEditedAt { cols.append(", m.date_edited AS date_edited") }
        if hasRetractedAt { cols.append(", m.date_retracted AS date_retracted") }
        if hasThreadOriginator { cols.append(", m.thread_originator_guid AS thread_originator") }
        return cols.joined()
    }

    /// Apple's "Mac Absolute Time". macOS 10.13+ stores nanoseconds since
    /// 2001-01-01 UTC. Pre-10.13 stored seconds. We detect by magnitude.
    private static let macEpoch = Date(timeIntervalSince1970: 978307200) // 2001-01-01 UTC

    public static func macTimestampToDate(_ ts: Int64?) -> Date? {
        guard let ts, ts != 0 else { return nil }
        let interval: TimeInterval = ts > 1_000_000_000_000
            ? Double(ts) / 1_000_000_000  // nanoseconds
            : Double(ts)                  // seconds
        return macEpoch.addingTimeInterval(interval)
    }

    private static func parseMessageRow(_ row: Row) -> MessageRow {
        let assocType: Int? = row["associated_type"]
        let reaction = ReactionInfo.from(associatedMessageType: assocType)
        let serviceStr: String? = row["service"]
        let service: Service = serviceStr?.lowercased().contains("sms") == true ? .sms : .iMessage
        let participantCount: Int = row["participant_count"] ?? 1
        let attributedBody: Data? = row["attributed_body"]
        let decodedText = (row["text"] as String?) ?? AttributedBodyDecoder.decodeText(attributedBody) ?? ""
        return MessageRow(
            rowId: row["rowid"] ?? 0,
            guid: row["guid"] ?? "",
            text: decodedText,
            isFromMe: (row["is_from_me"] as Int?) == 1,
            isRead: (row["is_read"] as Int?) == 1,
            isDelivered: (row["is_delivered"] as Int?) == 1,
            date: macTimestampToDate(row["date"]) ?? Date(),
            dateRead: macTimestampToDate(row["date_read"]),
            dateDelivered: macTimestampToDate(row["date_delivered"]),
            dateEdited: macTimestampToDate(row["date_edited"]),
            dateRetracted: macTimestampToDate(row["date_retracted"]),
            associatedMessageGuid: row["associated_guid"],
            threadOriginatorGuid: row["thread_originator"],
            reaction: reaction,
            hasAttachments: (row["has_attachments"] as Int?) == 1,
            service: service,
            handle: row["handle"] ?? "",
            chatGuid: row["chat_guid"] ?? "",
            chatDisplayName: row["chat_display_name"],
            participantCount: participantCount
        )
    }
}

// MARK: - Row DTOs (internal to Messages2Kit)

public struct ConversationRow: Sendable {
    public let chatRowId: Int64
    public let chatGuid: String
    public let chatIdentifier: String?
    public let displayName: String?
    public let serviceName: String?
    public let lastText: String?
    public let lastAttributedBody: Data?
    public let lastIsFromMe: Bool
    public let lastHasAttachments: Bool
    public let lastDate: Date?
    public let unreadCount: Int
    public let participantCount: Int

    public var isGroup: Bool { participantCount > 1 }

    /// Decoded preview text: text column if present, else attributedBody blob.
    public var lastPreviewText: String? {
        if let t = lastText, !t.isEmpty { return t }
        return AttributedBodyDecoder.decodeText(lastAttributedBody)
    }
}

public struct MessageRow: Sendable {
    public let rowId: Int64
    public let guid: String
    public let text: String
    public let isFromMe: Bool
    public let isRead: Bool
    public let isDelivered: Bool
    public let date: Date
    public let dateRead: Date?
    public let dateDelivered: Date?
    public let dateEdited: Date?
    public let dateRetracted: Date?
    public let associatedMessageGuid: String?
    public let threadOriginatorGuid: String?
    public let reaction: ReactionInfo
    public let hasAttachments: Bool
    public let service: Service
    public let handle: String
    public let chatGuid: String
    public let chatDisplayName: String?
    public let participantCount: Int

    public var isGroup: Bool { participantCount > 1 }
}

public struct AttachmentRow: Sendable {
    public let guid: String
    public let filename: String?
    public let mimeType: String?
    public let uti: String?
    public let totalBytes: Int64
    public let transferState: Int

    /// Resolve `~/` and `localhost:` prefixes Apple sometimes attaches.
    public var resolvedLocalURL: URL? {
        guard var path = filename else { return nil }
        if path.hasPrefix("~/") {
            path = NSString(string: path).expandingTildeInPath
        }
        let url = URL(fileURLWithPath: path)
        return FileManager.default.fileExists(atPath: url.path) ? url : nil
    }

    public var attachmentKind: Attachment.Kind {
        let mime = mimeType ?? ""
        if mime.hasPrefix("image/") { return .image }
        if mime.hasPrefix("video/") { return .video }
        if mime.hasPrefix("audio/") { return .audio }
        if uti == "public.url" { return .link }
        return .file
    }
}

// MARK: - Reaction map (port of SDK's mapReactionType)

public struct ReactionInfo: Sendable {
    public enum Kind: String, Sendable {
        case love, like, dislike, laugh, emphasize, question
    }

    public let isReaction: Bool
    public let kind: Kind?
    public let isRemoval: Bool

    public static let none = ReactionInfo(isReaction: false, kind: nil, isRemoval: false)

    /// Port of the SDK's mapReactionType. Apple's `associated_message_type`:
    ///   2000-2005: add reaction (love, like, dislike, laugh, emphasize, question)
    ///   3000-3005: remove reaction (same base, +1000)
    ///   0 / null:  not a reaction
    public static func from(associatedMessageType: Int?) -> ReactionInfo {
        guard let t = associatedMessageType, t != 0 else { return .none }
        let isAdd = (2000...2005).contains(t)
        let isRemove = (3000...3005).contains(t)
        guard isAdd || isRemove else { return .none }
        let base = isAdd ? t - 2000 : t - 3000
        let kinds: [Kind] = [.love, .like, .dislike, .laugh, .emphasize, .question]
        let kind = (0..<kinds.count).contains(base) ? kinds[base] : nil
        return ReactionInfo(isReaction: true, kind: kind, isRemoval: isRemove)
    }
}
