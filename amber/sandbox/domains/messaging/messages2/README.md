# Messages2

A faithful recreation of macOS Messages, powered by [photon-hq/imessage-kit](https://github.com/photon-hq/imessage-kit). Reads your real iMessage threads from `~/Library/Messages/chat.db` and sends through the Messages app via AppleScript.

Electron + Vite + React + TypeScript + Tailwind. Dark-only by design (matches Messages.app).

## Requirements

- macOS 12+
- Node.js 20+ (Node 22 recommended)
- Apple Silicon (current build targets arm64)

## First-time setup

### 1. Install and run in dev

```bash
cd /Users/joelnewton/2026-code/messages2
npm install
npm run dev
```

The first launch will prompt for Full Disk Access (see step 2).

### 2. Grant Full Disk Access

`chat.db` is protected by macOS's TCC subsystem. You must allow the app (or in dev, your terminal) to read it.

1. Open `System Settings` → `Privacy & Security` → `Full Disk Access`
2. Click `+` and add `Messages2.app` (production build) or your terminal (`Terminal.app`, `iTerm.app`, `Warp.app`, etc. for dev)
3. Toggle the switch on
4. Hit Retry in the onboarding screen

### 3. Grant Automation access (first send only)

The first time you send a message, macOS will prompt to allow Messages2 to control `Messages.app`. Click `Allow`. To re-grant later: `System Settings` → `Privacy & Security` → `Automation`.

## Build the .app and pin to Dock

```bash
cd /Users/joelnewton/2026-code/messages2
npm run build:mac
```

Output lands in `dist/`:

- `dist/mac-arm64/Messages2.app` (the unpacked bundle, easiest to use locally)
- `dist/Messages2-0.1.0-arm64.dmg` (drag-to-Applications installer)
- `dist/Messages2-0.1.0-arm64-mac.zip`

### Install and pin to Dock

1. Drag `Messages2.app` from `dist/mac-arm64/` (or open the `.dmg` and drag) into `/Applications`
2. Open the app once: right-click `Messages2.app` → `Open` → `Open` (Gatekeeper warning the first time only, since the build is unsigned)
3. Right-click the Dock icon → `Options` → `Keep in Dock`

The icon now lives in your Dock the same way Messages.app does. Cmd+click to launch.

### Re-grant Full Disk Access for the .app

After installing, repeat step 2 above but add `Messages2.app` from `/Applications` (the running app, not your terminal).

## Architecture

```
src/
├── main/                 # Electron main process (Node)
│   ├── index.ts          # Window, IPC handlers, lifecycle
│   ├── imessage-bridge.ts # Wraps imessage-kit, translates SDK ↔ DTOs
│   └── pinned-store.ts   # Local JSON for pinned chat IDs
├── preload/              # contextBridge security boundary
│   └── index.ts          # Typed IPC API exposed as window.messages
├── shared/               # Types shared by main + renderer
│   └── types.ts
└── renderer/             # React app
    └── src/
        ├── App.tsx
        ├── lib/
        │   ├── use-messages.ts  # Central state hook
        │   └── utils.ts         # Formatting, avatars, time helpers
        └── components/
            ├── Avatar.tsx
            ├── Onboarding.tsx
            ├── Sidebar.tsx
            ├── ThreadView.tsx
            ├── MessageBubble.tsx
            ├── AttachmentView.tsx
            └── ComposeBar.tsx
```

## Features

- All your iMessage and SMS threads from `chat.db`
- 1:1 and group chat support
- Real-time updates: incoming + outgoing messages stream in via `imessage-kit`'s watcher
- Dock unread badge (total across all chats)
- Send text + attachments (multi-file, with preview chips)
- Apple-style timestamps in the sidebar (Today, Yesterday, weekday, date)
- Date separators in the thread view
- Bubble grouping (consecutive messages from the same sender within 5 min)
- Read / Delivered / Sent status indicators
- Tapback reactions rendered as floating chips on the bubble corner
- Edited and unsent (retracted) message states
- Image, video, audio, and file attachments
- Pinned chats (stored locally; Apple keeps theirs in iCloud KVStore)
- Search across chat name, identifier, and last message preview
- Full Disk Access onboarding with a deep link to System Settings

## What is intentionally not implemented (yet)

- Composing reactions back: the SDK doesn't support sending Tapbacks via AppleScript
- Editing or unsending messages (Apple has no public AppleScript for this)
- Audio message recording in-app
- Contacts.app integration for prettier names (would need a native bridge to `Contacts.framework`)
- Message effects (slam, balloons, etc.)

## Scripts

```bash
npm run dev          # Run in development with hot reload
npm run build        # Type-check + bundle main/preload/renderer
npm run build:mac    # Build + produce signed .app + .dmg
npm run typecheck    # Type-check only
npm run lint         # ESLint
```

## License

MIT

All glory to God! ✝️❤️
