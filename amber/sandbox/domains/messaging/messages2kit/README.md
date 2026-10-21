# Messages2Kit

Swift Package providing read + send access to macOS iMessage for
[ClearOut](../../clearout/) (`domains/clearout`) and other consumers.


This is the data + send layer underneath ClearOut: it reads `~/Library/Messages/chat.db` in real time via GRDB, resolves contacts through `Contacts.framework`, and sends outbound replies via the only public API Apple exposes (AppleScript via `osascript`).

Reference: [`clearout-messages2-roadmap.md`](../clearout-messages2-roadmap.md) Section 3.

## What it gives you

A single protocol — `MessagesProvider` — with the surface ClearOut binds to. Two implementations:

- `Messages2Provider`: real chat.db reader + AppleScript sender. Production.
- `MockMessagesProvider`: seeded fake conversations + simulated incoming stream. Lets ClearOut develop its UI before the real provider is wired in.

## Architecture

```
┌─────────────────────────────────────────────────┐
│  MessagesProvider (public protocol)             │
│    incomingStream() -> AsyncStream<Message>     │
│    conversations(limit:)                        │
│    messages(in:limit:)                          │
│    messagesWithHandle(_:limit:)                 │
│    send(text:to:)                               │
│    markRead(_:)                                 │
└──────────────────────┬──────────────────────────┘
                       │
         ┌─────────────┴─────────────┐
         │                           │
┌────────▼─────────┐       ┌─────────▼─────────┐
│ Messages2Provider│       │ MockMessages      │
│   composes:      │       │ Provider          │
│                  │       │   seeded data     │
│ ┌──────────────┐ │       └───────────────────┘
│ │ ChatDatabase │ │  GRDB read of chat.db
│ │ (read-only)  │ │
│ └──────────────┘ │
│ ┌──────────────┐ │
│ │ Contact      │ │  Contacts.framework
│ │ Resolver     │ │
│ └──────────────┘ │
│ ┌──────────────┐ │
│ │ AppleScript  │ │  osascript send templates
│ │ Sender       │ │  (DM via buddy, group via chat id,
│ └──────────────┘ │   attachments staged in ~/Pictures)
│ ┌──────────────┐ │
│ │ FileSystem   │ │  DispatchSource on chat.db-wal
│ │ Watcher      │ │  (sub-second incoming latency)
│ └──────────────┘ │
└──────────────────┘
```

## Install

Swift Package Manager (in another project's `Package.swift`):

```swift
.package(url: "https://github.com/amber-organization/Messages2Kit.git", from: "0.1.0")
```

Then in a target:

```swift
.product(name: "Messages2Kit", package: "Messages2Kit")
```

Requires macOS 15+ and Swift 6.

## Use

```swift
import Messages2Kit

let provider: any MessagesProvider = Messages2Provider()

// List conversations
let convs = try await provider.conversations(limit: 50)

// Read a thread
let msgs = try await provider.messages(in: convs[0].id, limit: 100)

// Watch incoming in real time
Task {
    for await m in provider.incomingStream() {
        print("\(m.contactName ?? m.handle): \(m.text)")
    }
}

// Send
let sent = try await provider.send(text: "on my way", to: convs[0].id)
```

For ClearOut UI development against fake data:

```swift
let provider: any MessagesProvider = MockMessagesProvider()
```

The mock conforms to the exact same protocol, ships with 5 seeded conversations (1 group, 4 DMs, 50 messages each), and emits a new mock incoming message every 20-60 seconds when you subscribe to the stream.

## Permissions

Two macOS TCC gates apply:

1. **Full Disk Access** — required to read `~/Library/Messages/chat.db`. The consuming app must instruct the user to add itself in `System Settings → Privacy & Security → Full Disk Access`. `Messages2Provider.permissionInstructions()` returns a deep link.

2. **Automation → Messages** — required to send. macOS prompts the user the first time `send()` is called. `Messages2Provider.send` surfaces a useful error if it's been denied (`MessagesProviderError.sendFailed(reason:)` with text directing the user to System Settings).

The consuming app's `Info.plist` must declare:

```xml
<key>NSContactsUsageDescription</key>
<string>Resolve phone numbers and emails to your saved contact names.</string>
<key>NSAppleEventsUsageDescription</key>
<string>Send iMessages on your behalf via the Messages app.</string>
```

## CLI

The package ships a `messages2` CLI for dev testing. After `swift build`:

```bash
.build/debug/messages2 list                          # newest-first conversation list
.build/debug/messages2 show <chatGUID> --limit 50    # print messages
.build/debug/messages2 stream                        # tail incoming in real time
.build/debug/messages2 send "hey" --to <chatGUID>    # send
.build/debug/messages2 probe                         # check Full Disk Access
.build/debug/messages2 list --mock                   # use seeded mock data
```

## Implementation notes

- **SQL pattern**: one window-function query gets every conversation + its most recent message + unread count in a single roundtrip. No N+1.
- **attributedBody decode**: native `NSKeyedUnarchiver` against `NSAttributedString`. No third-party typedstream parser needed.
- **Group detection**: derived from `COUNT(*)` on `chat_handle_join`, not the unreliable `chat.style` column.
- **Reaction folding**: `mapReactionType` covers Apple's `associated_message_type` ranges 2000-2005 (add) and 3000-3005 (remove). Reactions are filtered out of `incomingStream` by default.
- **Sub-second incoming**: `DispatchSource.FileSystemObject` watches `chat.db-wal` and debounces 250ms to handle message bursts. The roadmap calls for <1s latency; we typically achieve <300ms.
- **Send routing**: `looksLikeGroupChatId` heuristic decides between `tell app "Messages" to send "..." to buddy "+1..."` (DMs) and `... to chat id "..."` (groups). Attachments are staged into `~/Pictures` via `mktemp` because Messages.app's sandbox rejects arbitrary paths.

## Roadmap status

- [x] 4.2.1 Swift Package + CLI structure
- [x] 4.2.2 chat.db reader (joins, attributedBody decode, mac epoch, group detection, reply threading)
- [x] 4.2.3 Contact resolution via Contacts.framework with caching + photo blobs
- [x] 4.2.4 Real-time streaming via DispatchSource on chat.db-wal with 250ms debounce
- [x] 4.2.5 Sending outbound (AppleScript: DM, group, attachments staged in ~/Pictures)
- [x] 4.2.6 Mock provider (5 seeded conversations, mix of read/unread, incoming emitter)
- [x] 4.2.7 CLI (`list`, `show`, `stream`, `send`, `probe`)
- [x] 4.2.8 Library imports cleanly; CLI runs end-to-end on author's chat.db

## License

MIT

All glory to God! ✝️❤️
