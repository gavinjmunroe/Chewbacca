// MockMessagesProvider: seeded fake data that conforms to MessagesProvider.
//
// ClearOut develops against this until the real provider is wired in.
// The roadmap (4.2.6) calls for:
//   - 5 conversations (1 group, 4 DMs), 50 messages each, mix read/unread
//   - incomingStream() emits a new mock message every 20-60s when running
//   - send() echoes back a confirmation
//
// The mock intentionally returns plausible-looking messages so triage
// UI development doesn't feel like staring at lorem ipsum.

import Foundation

public final class MockMessagesProvider: MessagesProvider, @unchecked Sendable {
    private let storage: MockStorage
    private let emissionInterval: ClosedRange<TimeInterval>

    public init(emissionInterval: ClosedRange<TimeInterval> = 20...60) {
        self.storage = MockStorage.seeded()
        self.emissionInterval = emissionInterval
    }

    public var hasPermission: Bool { true }

    public func permissionInstructions() -> PermissionInstructions {
        PermissionInstructions(
            title: "Mock provider",
            body: "This is a mock; no permission needed.",
            settingsURL: nil
        )
    }

    public func conversations(limit: Int) async throws -> [Conversation] {
        await storage.conversations(limit: limit)
    }

    public func messages(in conversationId: String, limit: Int) async throws -> [Message] {
        await storage.messages(in: conversationId, limit: limit)
    }

    public func messagesWithHandle(_ handle: String, limit: Int) async throws -> [Message] {
        await storage.messagesWithHandle(handle, limit: limit)
    }

    public func send(text: String, to conversationId: String) async throws -> Message {
        let m = await storage.appendOutgoing(text: text, conversationId: conversationId)
        return m
    }

    public func markRead(_ messageIds: [String]) async throws {
        await storage.markRead(messageIds)
    }

    public func incomingStream() -> AsyncStream<Message> {
        AsyncStream { continuation in
            let task = Task {
                while !Task.isCancelled {
                    let delay = TimeInterval.random(in: emissionInterval)
                    try? await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
                    if Task.isCancelled { break }
                    let m = await storage.emitRandomIncoming()
                    continuation.yield(m)
                }
                continuation.finish()
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }
}

// MARK: - Mock storage actor

private actor MockStorage {
    private var conversations: [Conversation]
    private var messagesByChat: [String: [Message]]

    init(conversations: [Conversation], messagesByChat: [String: [Message]]) {
        self.conversations = conversations
        self.messagesByChat = messagesByChat
    }

    static func seeded() -> MockStorage {
        let baseDate = Date().addingTimeInterval(-86400 * 3)
        let sagar = ("+15551234567", "Sagar Tiwari")
        let mom = ("+15557654321", "Mom")
        let coach = ("coach@usc.edu", "Coach Hernandez")
        let charlie = ("+15559998888", "Charlie")
        let groupGuid = "chat:mock-amber-team"
        let groupHandles = [sagar.0, "+15553334444", "+15554445555"]

        let dms: [(String, String)] = [sagar, mom, coach, charlie]
        var conversations: [Conversation] = []
        var byChat: [String: [Message]] = [:]

        for (handle, name) in dms {
            let chatGuid = "dm:\(handle)"
            let msgs = generateMessages(
                count: 50,
                chatGuid: chatGuid,
                handle: handle,
                contactName: name,
                baseDate: baseDate,
                isGroup: false,
                groupTitle: nil
            )
            byChat[chatGuid] = msgs
            conversations.append(Conversation(
                id: chatGuid,
                displayName: name,
                handles: [handle],
                participants: [Participant(handle: handle, contactName: name, avatarData: nil)],
                isGroupChat: false,
                lastMessageDate: msgs.last?.timestamp ?? Date(),
                unreadCount: msgs.filter { !$0.isRead && !$0.isFromMe }.count,
                lastMessagePreview: msgs.last?.text ?? ""
            ))
        }

        // Group chat
        let groupMsgs = generateMessages(
            count: 50,
            chatGuid: groupGuid,
            handle: sagar.0,
            contactName: sagar.1,
            baseDate: baseDate,
            isGroup: true,
            groupTitle: "Amber team"
        )
        byChat[groupGuid] = groupMsgs
        conversations.append(Conversation(
            id: groupGuid,
            displayName: "Amber team",
            handles: groupHandles,
            participants: groupHandles.map { Participant(handle: $0, contactName: nil, avatarData: nil) },
            isGroupChat: true,
            lastMessageDate: groupMsgs.last?.timestamp ?? Date(),
            unreadCount: groupMsgs.filter { !$0.isRead && !$0.isFromMe }.count,
            lastMessagePreview: groupMsgs.last?.text ?? ""
        ))

        conversations.sort { $0.lastMessageDate > $1.lastMessageDate }
        return MockStorage(conversations: conversations, messagesByChat: byChat)
    }

    private static func generateMessages(
        count: Int,
        chatGuid: String,
        handle: String,
        contactName: String,
        baseDate: Date,
        isGroup: Bool,
        groupTitle: String?
    ) -> [Message] {
        let templates = [
            "hey are you around",
            "did you see the demo",
            "send me that doc when you get a chance",
            "im on my way",
            "lol",
            "lets do that",
            "wait what",
            "still on for tonight?",
            "got it",
            "appreciate it",
            "running late, like 10 min",
            "you free saturday?",
            "ok sounds good",
            "what time works for you",
            "lmk",
        ]
        var msgs: [Message] = []
        for i in 0..<count {
            let isFromMe = i % 3 != 0
            let text = templates[i % templates.count]
            let ts = baseDate.addingTimeInterval(Double(i) * 600)
            let isRead = i < count - 5 || isFromMe
            msgs.append(Message(
                id: "\(chatGuid):\(i)",
                conversationId: chatGuid,
                handle: isFromMe ? "" : handle,
                contactName: isFromMe ? nil : contactName,
                text: text,
                timestamp: ts,
                isFromMe: isFromMe,
                isRead: isRead,
                service: .iMessage,
                attachments: [],
                replyToMessageId: nil,
                groupChatTitle: isGroup ? groupTitle : nil
            ))
        }
        return msgs
    }

    func conversations(limit: Int) -> [Conversation] {
        Array(conversations.prefix(limit))
    }

    func messages(in conversationId: String, limit: Int) -> [Message] {
        let all = messagesByChat[conversationId] ?? []
        return Array(all.suffix(limit))
    }

    func messagesWithHandle(_ handle: String, limit: Int) -> [Message] {
        var hits: [Message] = []
        for (_, msgs) in messagesByChat {
            for m in msgs where m.handle == handle {
                hits.append(m)
            }
        }
        hits.sort { $0.timestamp > $1.timestamp }
        return Array(hits.prefix(limit))
    }

    func appendOutgoing(text: String, conversationId: String) -> Message {
        let m = Message(
            id: "\(conversationId):sent-\(Int(Date().timeIntervalSince1970))",
            conversationId: conversationId,
            handle: "",
            contactName: nil,
            text: text,
            timestamp: Date(),
            isFromMe: true,
            isRead: true,
            service: .iMessage,
            attachments: [],
            replyToMessageId: nil,
            groupChatTitle: nil
        )
        messagesByChat[conversationId, default: []].append(m)
        return m
    }

    func markRead(_ ids: [String]) {
        let set = Set(ids)
        for (chat, msgs) in messagesByChat {
            messagesByChat[chat] = msgs.map { m in
                guard set.contains(m.id), !m.isRead else { return m }
                return Message(
                    id: m.id, conversationId: m.conversationId, handle: m.handle,
                    contactName: m.contactName, text: m.text, timestamp: m.timestamp,
                    isFromMe: m.isFromMe, isRead: true, service: m.service,
                    attachments: m.attachments, replyToMessageId: m.replyToMessageId,
                    groupChatTitle: m.groupChatTitle
                )
            }
        }
    }

    func emitRandomIncoming() -> Message {
        let chat = conversations.randomElement()!
        let handle = chat.handles.first ?? "+15550000000"
        let name = chat.participants.first?.contactName
        let texts = [
            "you up?",
            "quick question",
            "saw your message just now",
            "haha for real",
            "btw did you check this out",
            "what do you think",
        ]
        let m = Message(
            id: "\(chat.id):incoming-\(Int(Date().timeIntervalSince1970))",
            conversationId: chat.id,
            handle: handle,
            contactName: name,
            text: texts.randomElement()!,
            timestamp: Date(),
            isFromMe: false,
            isRead: false,
            service: .iMessage,
            attachments: [],
            replyToMessageId: nil,
            groupChatTitle: chat.isGroupChat ? chat.displayName : nil
        )
        messagesByChat[chat.id, default: []].append(m)
        return m
    }
}
