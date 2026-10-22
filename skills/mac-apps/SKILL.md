---
name: mac-apps
description: "Drive named Mac apps through AppleScript, JXA, Shortcuts or their data files: Mail, Messages, Notes, Safari, Calendar, Reminders, Finder, Music, Terminal. Use when asked to do something in one."
triggers: >-
  Drive specific Mac apps through AppleScript, JXA, Shortcuts, or their own data files - Mail, Messages, Notes, Safari, Calendar, Reminders, Finder, Music, Terminal. Use when the user asks to do something in a named Mac app, especially an Apple one.
requires: [chewie]
---

# Driving named apps

Apple's own apps are well scripted. Reaching for the UI on one of these is doing it the
hard way.

## Is it scriptable?

```bash
sdef /System/Applications/Mail.app | head -60
sdef /Applications/Foo.app | grep -i "<command"
```

Nothing useful back means the app has no dictionary and you go to layer 3.

## The ones that work well

```bash
# Safari
chewie run 'tell application "Safari" to get URL of front document'
chewie run 'tell application "Safari" to open location "https://example.com"'
chewie run 'tell application "Safari" to do JavaScript "document.title" in front document'
# ^ needs Develop > Allow JavaScript from Apple Events, off by default

# Mail
chewie run 'tell application "Mail" to get subject of messages 1 thru 5 of inbox'

# Notes
chewie run 'tell application "Notes" to get body of note 1'

# Messages
chewie run 'tell application "Messages" to send "hi" to buddy "+13104296285"'
# ^ outbound. Confirm with the user first.

# Calendar / Reminders / Music / Finder all have dictionaries too
chewie run 'tell application "Music" to play'
chewie run 'tell application "Finder" to get name of every item of desktop'
```

JXA when you want real data structures back:

```bash
chewie run --js 'JSON.stringify(Application("Notes").notes().slice(0,5).map(n => n.name()))'
```

## A whole collection is one event per field, never a loop

Every property read is a round trip to the app. `repeat with p in people` that reads six
fields costs cards x 6 events; on 2026-10-21 that was still running at 5 minutes. Ask for
the column instead: `people.lastName()` in JXA or `get last name of every person` in
AppleScript returns every card's value in one event (the same six fields: 3.7 s). Filter
in memory, then write back only the matches by id. `bulk-loop-guard` refuses the loop
shape. For Contacts, `contacts-bulk find <text>` and `contacts-bulk replace <old> <new>`
already do this, with a snapshot and `contacts-bulk undo`.

The same rule holds off the Mac: one query with `IN (...)` over N single-row queries, one
batch API call over a loop of single calls, `git cat-file --batch` over a process per file.
When unsure, time it on 20 items and multiply before starting the full run.

## Reading is usually faster from the file

For history and search, skip the app entirely.

```bash
sqlite3 "file:$HOME/Library/Messages/chat.db?mode=ro" \
  "SELECT datetime(date/1000000000 + 978307200,'unixepoch','localtime'), text
   FROM message ORDER BY date DESC LIMIT 20"
```

Two things bite: the Apple epoch is 2001, not 1970, and on Ventura and later `text` is
often NULL because bodies moved to `attributedBody` as a hex-encoded blob. See
`docs/mac/05-DATA-LAYER.md`.

Other stores: Safari `~/Library/Safari/History.db`, Photos
`~/Pictures/Photos Library.photoslibrary/database/Photos.sqlite`, Calendar
`~/Library/Calendars/Calendar.sqlitedb`. All need Full Disk Access. All read-only.

## Shortcuts

```bash
shortcuts list
shortcuts run "Daily Digest"
echo "text" | shortcuts run "Process Text"
```

Reaches things AppleScript no longer does. **Pre-warm required:** a shortcut touching
a protected resource prompts on first run, and nothing can answer that prompt headless.
Have the user run it once by hand, answer Always Allow, confirm it runs clean from the
terminal, then call it.

## MCP servers for Apple apps

Installed by `install.sh`: `macos-automator-mcp` gives you AppleScript and JXA as MCP
tools with a callable script knowledge base. Worth adding when the task needs them:

- `supermemoryai/apple-mcp`: Notes, Contacts, Mail, Messages, Reminders, Calendar, Maps
- `carterlasalle/mac_messages_mcp`: iMessage with the `attributedBody` decode handled
- `achiya-automation/safari-mcp`: 97 Safari tools, keeps the user's logins

## Electron apps have none of this

Slack, Discord, Notion, Spotify, VS Code, Figma. No dictionary, no useful data file.
Go to layer 3, and remember they need `chewie see --force-ax` first.

## Failure signatures

| Error                            | Fix                                                                    |
| -------------------------------- | ---------------------------------------------------------------------- |
| -600 "Application isn't running" | `open -a "App"` first, then poll                                       |
| -1743 "Not authorized"           | TCC denied. `tccutil reset AppleEvents`, retry in the foreground       |
| -1712 timeout                    | `with timeout of 300 seconds`. Also check for a modal blocking the app |
| -1728 "Can't get..."             | The object does not exist. Check the dictionary, not the permissions   |
