# Which app the OS replaces next

The goal Caleb set on 2026-10-04: "We should never have to open an app." The
order is set by measured use, not by which app is easiest, so the hours below
are what decides the next surface.

Measured 2026-10-04 on Caleb's Mac over the previous 14 days: foreground app
time from `knowledgeC.db` (`/app/usage`), and Chrome visit time per site from
the History database of both profiles. Chrome's `visit_duration` counts a tab
that stayed open in the background, so its hours overstate time looked at and
only the ranking is trusted. Re-measure before reordering.

## Native apps, foreground hours in 14 days

| App      | Hours | Replaced by                                          | Status      |
| -------- | ----- | ---------------------------------------------------- | ----------- |
| Chrome   | 15.8  | the sites below, one by one                          | see below   |
| VS Code  | 11.7  | session surfaces (Claude Code on the glass)          | building    |
| Messages | 7.1   | `messages`, `person`, `needs-you` surfaces           | building    |
| FaceTime | 3.4   | a call surface: start, accept, who is on             | not started |
| Codex    | 3.3   | session surfaces, Codex transcripts                  | building    |
| Notes    | 1.5   | a notes surface over Apple Notes via `mac notes`     | not started |
| Granola  | 0.8   | call transcripts into the graph (anarlog or Granola) | not started |
| Slack    | 0.7   | a Slack surface over the Slack MCP, read first       | not started |
| Finder   | 0.7   | `files` surface                                      | building    |
| WhatsApp | 0.4   | threads into the graph via `wacli`                   | not started |
| Spotify  | 0.2   | `music` surface via `hud-music`                      | building    |

## Chrome sites, ranked (Work profile, the one with the volume)

1. github.com: PRs, issues, CI as graph nodes; review and merge from the glass
2. google.com: search answered on the glass (generative UI)
3. docs.google.com: open and edit through the Drive connector, File surface
4. calendar.google.com: `today` surface; needs the Calendar permission granted
5. brightspace.usc.edu: `coursework` and `brightspace due` already read it
6. app.clay.com: Zeutara campaign numbers via the Clay CLI, read only
7. chatgpt.com: the hyper bar already answers; ChatGPT history via the import
8. mail.google.com: `mail` surface
9. meet.google.com: same call surface as FaceTime
10. figma.com: the Figma connector, read and screenshot

## Open-source engines to build on

Caleb, 2026-10-04: "There's open source better versions of literally every
app." The OS uses them as engines under the glass, never as windows to open.
From `oss-apps replaces <app> --remixable` on 2026-10-04, permissive licences
only, so the result can ship:

- Notes: Memos (MIT)
- Slack: Zulip (Apache-2.0), Buzz (Apache-2.0)
- Granola: Meetily (MIT), Anarlog (MIT), both local transcription
- Figma: Graphite (Apache-2.0), OpenPencil (MIT)
- Google Docs: Docs (MIT)
- Zoom and Meet: Jitsi (Apache-2.0)
- ChatGPT: LibreChat (MIT), AnythingLLM (MIT)
- Chrome: Ladybird (BSD-2-Clause), a long way from daily use

The registry returned nothing for Google Calendar, Gmail, VS Code, Spotify,
FaceTime or WhatsApp. That is a gap in its `replaces` mapping, not proof none
exist: add the mappings to `data/oss-apps/curated.json` and rerun before
deciding those rows.

## The rule for every new platform

Each one is the same three parts, so adding one is a recipe, not a project:

1. An ingester that writes typed facts into the OS graph with source and time.
2. A surface that is a walk over those facts, glass like every other one.
3. Actions from an allowlist, outbound only on Caleb's press, verified after.

A platform is done when Caleb stops opening its app for the everyday task.
Check that with the same 14-day measurement, not with a test passing.
