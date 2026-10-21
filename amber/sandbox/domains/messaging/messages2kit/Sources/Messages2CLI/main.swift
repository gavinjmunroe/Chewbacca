// messages2 CLI. Dev tool for sanity-checking the library against your
// real chat.db (or a seeded mock) before ClearOut integration.
//
// Roadmap (4.2.7) spec:
//   messages2 list                            list conversations
//   messages2 show <conversationId> [--limit] print messages
//   messages2 stream                          tail incoming messages
//   messages2 send "<text>" --to <conv>       send a text

import ArgumentParser
import Foundation
import Messages2Kit

@main
struct Messages2: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "messages2",
        abstract: "Read and send macOS iMessage via Messages2Kit.",
        subcommands: [List.self, Show.self, Stream.self, Send.self, Probe.self],
        defaultSubcommand: List.self
    )
}

// Shared provider builder so every subcommand uses the same source.
enum ProviderFactory {
    static func make(useMock: Bool) -> MessagesProvider {
        useMock ? MockMessagesProvider() : Messages2Provider(debug: true)
    }
}

struct CommonOptions: ParsableArguments {
    @Flag(name: .long, help: "Use the seeded mock provider instead of real chat.db.")
    var mock: Bool = false

    @Flag(name: .long, help: "Emit results as JSON instead of human-readable output. Use this when piping into scripts or other tools.")
    var json: Bool = false
}

enum JSONOutput {
    static func emit<T: Encodable>(_ value: T) throws {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
        encoder.dateEncodingStrategy = .iso8601
        let data = try encoder.encode(value)
        FileHandle.standardOutput.write(data)
        FileHandle.standardOutput.write(Data("\n".utf8))
    }
}

// MARK: - list

struct List: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "list",
        abstract: "List conversations newest-first."
    )

    @OptionGroup var common: CommonOptions

    @Option(name: .long, help: "Maximum conversations to return.")
    var limit: Int = 50

    func run() async throws {
        let provider = ProviderFactory.make(useMock: common.mock)
        let convs = try await provider.conversations(limit: limit)
        if common.json {
            try JSONOutput.emit(convs)
            return
        }
        let dateFormatter = DateFormatter()
        dateFormatter.dateStyle = .short
        dateFormatter.timeStyle = .short
        for c in convs {
            let unread = c.unreadCount > 0 ? " (\(c.unreadCount) unread)" : ""
            let kind = c.isGroupChat ? "[group]" : "[dm]   "
            let preview = c.lastMessagePreview.prefix(60)
            print("\(kind) \(dateFormatter.string(from: c.lastMessageDate))  \(c.displayName)\(unread)")
            if !preview.isEmpty {
                print("         \(preview)")
            }
            print("         id: \(c.id)")
            print()
        }
        print("\(convs.count) conversations")
    }
}

// MARK: - show

struct Show: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "show",
        abstract: "Print messages in a conversation."
    )

    @OptionGroup var common: CommonOptions

    @Argument(help: "Conversation ID (chat GUID).")
    var conversationId: String

    @Option(name: .long, help: "Maximum messages to return (oldest → newest).")
    var limit: Int = 50

    func run() async throws {
        let provider = ProviderFactory.make(useMock: common.mock)
        let msgs = try await provider.messages(in: conversationId, limit: limit)
        if common.json {
            try JSONOutput.emit(msgs)
            return
        }
        let dateFormatter = DateFormatter()
        dateFormatter.dateStyle = .short
        dateFormatter.timeStyle = .short
        for m in msgs {
            let who = m.isFromMe ? "me" : (m.contactName ?? m.handle)
            let read = m.isFromMe ? (m.isRead ? "·R" : "··") : ""
            let attach = m.attachments.isEmpty ? "" : "  📎×\(m.attachments.count)"
            print("[\(dateFormatter.string(from: m.timestamp))] \(who)\(read): \(m.text)\(attach)")
        }
        print("\n\(msgs.count) messages")
    }
}

// MARK: - stream

struct Stream: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "stream",
        abstract: "Watch for new incoming messages in real time. Ctrl-C to stop."
    )

    @OptionGroup var common: CommonOptions

    func run() async throws {
        let provider = ProviderFactory.make(useMock: common.mock)
        if !common.json {
            print("Watching for new messages… (Ctrl-C to stop)")
        }
        for await m in provider.incomingStream() {
            if common.json {
                try? JSONOutput.emit(m)
            } else {
                let who = m.contactName ?? m.handle
                let group = m.groupChatTitle.map { " in \($0)" } ?? ""
                print("→ \(who)\(group): \(m.text)")
            }
        }
    }
}

// MARK: - send

struct Send: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "send",
        abstract: "Send a text message to a conversation."
    )

    @OptionGroup var common: CommonOptions

    @Argument(help: "Message text.")
    var text: String

    @Option(name: .long, help: "Conversation ID (chat GUID).")
    var to: String

    func run() async throws {
        let provider = ProviderFactory.make(useMock: common.mock)
        let m = try await provider.send(text: text, to: to)
        print("Sent: \(m.text)")
        print("  id: \(m.id)")
    }
}

// MARK: - probe (extra: dev helper for permissions)

struct Probe: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "probe",
        abstract: "Check Full Disk Access + Messages.app Automation permission."
    )

    func run() async throws {
        let provider = Messages2Provider(debug: true)
        let perms = provider.hasPermission
        let pi = provider.permissionInstructions()
        print("Full Disk Access readable? \(perms ? "yes" : "no")")
        print("\(pi.title)")
        print(pi.body)
        if let url = pi.settingsURL {
            print("Settings deep link: \(url)")
        }
    }
}
