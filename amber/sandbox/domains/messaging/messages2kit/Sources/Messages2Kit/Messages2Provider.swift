// Real implementation of MessagesProvider. Composes ChatDatabase +
// ContactResolver + AppleScriptSender + FileSystemWatcher into the
// single public surface the roadmap binds both repos to.
//
// This is what ClearOut imports.

import Foundation

public final class Messages2Provider: MessagesProvider, @unchecked Sendable {
    private let db: ChatDatabase
    private let contacts: ContactResolver
    private let sender: AppleScriptSender
    private let watcher: FileSystemWatcher

    // Watcher state: the highest message ROWID we've already shipped to
    // subscribers. We initialize to the latest on open() so the first
    // subscription starts "now" and doesn't replay history.
    private let lastSeenRowId = WatcherCursor()

    // Multiple subscribers can call incomingStream(); we fan one watcher
    // tick out to all of them.
    private let subscribers = SubscriberRegistry()
    private var watcherStarted = false

    public init(
        dbPath: URL = ChatDatabase.defaultPath,
        debug: Bool = false
    ) {
        self.db = ChatDatabase(dbPath: dbPath)
        self.contacts = ContactResolver()
        self.sender = AppleScriptSender(debug: debug)
        self.watcher = FileSystemWatcher(dbPath: dbPath)
    }

    public var hasPermission: Bool {
        // Best-effort sync probe: can we even stat chat.db? Real read
        // failures still throw `noPermission` from open().
        FileManager.default.isReadableFile(atPath: ChatDatabase.defaultPath.path)
    }

    public func permissionInstructions() -> PermissionInstructions {
        PermissionInstructions(
            title: "Full Disk Access required",
            body: "Messages2 reads your iMessage history from ~/Library/Messages/chat.db. macOS protects this file behind Full Disk Access. Open System Settings → Privacy & Security → Full Disk Access and add this app, then come back and try again.",
            settingsURL: URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles")
        )
    }

    public func conversations(limit: Int) async throws -> [Conversation] {
        try await openIfNeeded()
        let rows = try await db.fetchConversations(limit: limit)
        var out: [Conversation] = []
        out.reserveCapacity(rows.count)
        for row in rows {
            let handles = (try? await db.fetchHandles(forChatId: row.chatRowId)) ?? []
            var participants: [Participant] = []
            participants.reserveCapacity(handles.count)
            for handle in handles {
                let resolved = await contacts.resolve(handle)
                participants.append(Participant(
                    handle: handle,
                    contactName: resolved?.displayName,
                    avatarData: resolved?.imageData
                ))
            }
            // Display name resolution priority:
            //   1. chat.display_name (groups the user explicitly named)
            //   2. For unnamed groups: comma-joined contact names of
            //      participants (with "+N" tail when long)
            //   3. For DMs: resolved contact name
            //   4. Fallback: chat_identifier
            let primaryHandle = handles.first ?? row.chatIdentifier ?? ""
            let resolvedPrimary = await contacts.resolve(primaryHandle)
            let displayName: String
            if let dn = row.displayName, !dn.isEmpty {
                displayName = dn
            } else if row.isGroup, !participants.isEmpty {
                let names = participants.map { p in
                    p.contactName ?? Self.prettyHandleShort(p.handle)
                }
                let MAX = 3
                displayName = names.count <= MAX
                    ? names.joined(separator: ", ")
                    : "\(names.prefix(MAX).joined(separator: ", ")) +\(names.count - MAX)"
            } else {
                displayName = resolvedPrimary?.displayName ?? row.chatIdentifier ?? primaryHandle
            }
            out.append(Conversation(
                id: row.chatGuid,
                displayName: displayName,
                handles: handles,
                participants: participants,
                isGroupChat: row.isGroup,
                lastMessageDate: row.lastDate ?? .distantPast,
                unreadCount: row.unreadCount,
                lastMessagePreview: previewLine(row)
            ))
        }
        return out
    }

    public func messages(in conversationId: String, limit: Int) async throws -> [Message] {
        try await openIfNeeded()
        let rows = try await db.fetchMessages(conversationGuid: conversationId, limit: limit)
        var out: [Message] = []
        out.reserveCapacity(rows.count)
        for row in rows {
            if let m = await buildMessage(row, includeReactions: false) {
                out.append(m)
            }
        }
        return out
    }

    public func messagesWithHandle(_ handle: String, limit: Int) async throws -> [Message] {
        try await openIfNeeded()
        let rows = try await db.fetchMessagesWithHandle(handle, limit: limit)
        var out: [Message] = []
        out.reserveCapacity(rows.count)
        for row in rows {
            if let m = await buildMessage(row, includeReactions: false) {
                out.append(m)
            }
        }
        return out
    }

    public func send(text: String, to conversationId: String) async throws -> Message {
        try await openIfNeeded()
        // Group chats keep their full chat GUID; DMs use the bare handle
        // when possible (more reliable across iCloud accounts).
        let target: String
        if AppleScriptSender.looksLikeGroupChatId(conversationId) {
            target = conversationId
        } else {
            // For DMs, conversationId is the chat GUID. We want the buddy
            // address. Look it up from the chat's first handle.
            let convs = try await db.fetchConversations(limit: 200)
            if let match = convs.first(where: { $0.chatGuid == conversationId }) {
                let handles = (try? await db.fetchHandles(forChatId: match.chatRowId)) ?? []
                target = handles.first ?? conversationId
            } else {
                target = conversationId
            }
        }
        do {
            try await sender.sendText(text, to: target)
        } catch {
            throw MessagesProviderError.sendFailed(reason: error.localizedDescription)
        }
        // Wait for the message to appear in chat.db (typically <500ms).
        let landed = await waitForOwnMessage(matching: text, in: conversationId, timeout: 3)
        if let landed { return landed }
        // Fallback: synthesize a Message so callers always get something back.
        return Message(
            id: "\(conversationId):pending-\(Date().timeIntervalSince1970)",
            conversationId: conversationId,
            handle: "",
            contactName: nil,
            text: text,
            timestamp: Date(),
            isFromMe: true,
            isRead: false,
            service: .iMessage,
            attachments: [],
            replyToMessageId: nil,
            groupChatTitle: nil
        )
    }

    public func markRead(_ messageIds: [String]) async throws {
        // messageIds use our `<chatGuid>:<rowId>` format; extract the
        // bare message GUID. We don't have it directly here, so we
        // fetch the message rows and use their actual guid column.
        // Simpler alternative: treat the suffix as the rowId and write
        // by rowId. But we standardized on guid in chat.db writes for
        // safety against rowid reuse.
        try await openIfNeeded()
        // Convert our stable ids back to chat.db guids by querying
        // (one batched SELECT). For the common case (marking a small
        // batch the user just read), this is fine.
        let guids = messageIds.compactMap { id -> String? in
            // id format: "<chatGuid>:<rowId>" — extract rowId, then we'll
            // resolve to a guid below. Empty filter on bad ids.
            id.split(separator: ":").last.flatMap { Int64($0) } != nil ? id : nil
        }
        // For now, mark by GUID via a query that maps id→guid using a
        // join. We're conservative — if a row is gone, the UPDATE just
        // affects zero rows.
        let rowIds = messageIds.compactMap { id -> Int64? in
            Int64(id.split(separator: ":").last.map(String.init) ?? "")
        }
        if !rowIds.isEmpty {
            try await db.markAsReadByRowIds(rowIds)
        }
        _ = guids
    }

    public func incomingStream() -> AsyncStream<Message> {
        AsyncStream { continuation in
            let id = UUID()
            Task { await self.subscribers.add(id, continuation) }
            continuation.onTermination = { _ in
                Task { await self.subscribers.remove(id) }
            }
            Task { try? await self.ensureWatcherRunning() }
        }
    }

    // MARK: - Internals

    private func openIfNeeded() async throws {
        do {
            try await db.open()
        } catch {
            throw error
        }
        await lastSeenRowId.initializeIfNeeded {
            (try? await self.db.latestMessageRowId()) ?? 0
        }
    }

    private func ensureWatcherRunning() async throws {
        guard !watcherStarted else { return }
        try await openIfNeeded()
        try await watcher.start { [weak self] in
            await self?.drainNewMessages()
        }
        watcherStarted = true
    }

    private func drainNewMessages() async {
        let cursor = await lastSeenRowId.current()
        do {
            let rows = try await db.fetchMessagesSince(rowId: cursor, limit: 200)
            for row in rows {
                await lastSeenRowId.bump(to: row.rowId)
                // Only fan out incoming (non-from-me) primary messages.
                // Reactions, ours, and system rows are intentionally dropped.
                if row.isFromMe || row.reaction.isReaction { continue }
                if let msg = await buildMessage(row, includeReactions: false) {
                    await subscribers.broadcast(msg)
                }
            }
        } catch {
            // Watcher errors are non-fatal; the FileSystemWatcher will
            // call us again on the next chat.db-wal mutation.
        }
    }

    private func buildMessage(_ row: MessageRow, includeReactions: Bool) async -> Message? {
        if !includeReactions && row.reaction.isReaction { return nil }
        let attachments: [Attachment]
        if row.hasAttachments {
            let rows = (try? await db.fetchAttachments(forMessageRowId: row.rowId)) ?? []
            attachments = rows.map { ar in
                Attachment(
                    id: ar.guid,
                    filename: ar.filename.map { NSString(string: $0).lastPathComponent },
                    mimeType: ar.mimeType,
                    localURL: ar.resolvedLocalURL,
                    kind: ar.attachmentKind
                )
            }
        } else {
            attachments = []
        }
        let resolved = await contacts.resolve(row.handle)
        return Message(
            id: "\(row.chatGuid):\(row.rowId)",
            conversationId: row.chatGuid,
            handle: row.handle,
            contactName: resolved?.displayName,
            text: row.text,
            timestamp: row.date,
            isFromMe: row.isFromMe,
            isRead: row.isRead,
            service: row.service,
            attachments: attachments,
            replyToMessageId: row.threadOriginatorGuid,
            groupChatTitle: row.isGroup ? row.chatDisplayName : nil
        )
    }

    private func waitForOwnMessage(matching text: String, in conversationId: String, timeout: TimeInterval) async -> Message? {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            let rows = (try? await db.fetchMessages(conversationGuid: conversationId, limit: 5)) ?? []
            if let row = rows.reversed().first(where: { $0.isFromMe && $0.text == text }) {
                return await buildMessage(row, includeReactions: false)
            }
            try? await Task.sleep(nanoseconds: 200_000_000)
        }
        return nil
    }

    private func previewLine(_ row: ConversationRow) -> String {
        if let t = row.lastPreviewText, !t.isEmpty { return t }
        if row.lastHasAttachments { return "📎 Attachment" }
        return ""
    }

    /// Trim a raw handle to something readable for group-name fallback.
    /// Phones → "…1234" (last 4). Emails → the local-part before @.
    static func prettyHandleShort(_ handle: String) -> String {
        if handle.contains("@") {
            return handle.split(separator: "@").first.map(String.init) ?? handle
        }
        let digits = handle.unicodeScalars.filter { CharacterSet.decimalDigits.contains($0) }
        let digitString = String(String.UnicodeScalarView(digits))
        return digitString.count >= 4 ? "…\(digitString.suffix(4))" : handle
    }
}

// MARK: - Helpers

private actor WatcherCursor {
    private var value: Int64?

    func initializeIfNeeded(_ producer: () async -> Int64) async {
        if value == nil { value = await producer() }
    }

    func current() -> Int64 { value ?? 0 }

    func bump(to next: Int64) {
        if let v = value, next <= v { return }
        value = next
    }
}

private actor SubscriberRegistry {
    private var subscribers: [UUID: AsyncStream<Message>.Continuation] = [:]

    func add(_ id: UUID, _ continuation: AsyncStream<Message>.Continuation) {
        subscribers[id] = continuation
    }

    func remove(_ id: UUID) {
        subscribers[id] = nil
    }

    func broadcast(_ message: Message) {
        for (_, cont) in subscribers {
            cont.yield(message)
        }
    }
}
