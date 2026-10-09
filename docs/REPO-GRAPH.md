# The repo graph

Every GitHub repo named in any of the kit's link lists, deduped into one graph:
[`data/repo-graph.jsonl`](../data/repo-graph.jsonl), built by
[`bin/repo-graph`](../bin/repo-graph). Built 2026-10-09 for CHW-187.

Eleven lists name repos, and they had never been joined. The same repo showed
up under an old name in one list and a new one in another, and nobody could
say which of the 2,496 were already in the kit. The graph answers that per
repo, with the file and line behind every claim.

## What's in it

One node per canonical `owner/name`, lowercased. GitHub renames are followed
(the GraphQL lookup returns the current `nameWithOwner`), so a renamed repo
listed under both names is one node with the old name kept in `aliases`. Each
node carries stars, license, last push, archived, language and description from
the GitHub API on the build date, plus `status` and the lists it appears in.

| Edge             | Meaning                                               | Evidence on the edge                                   |
| ---------------- | ----------------------------------------------------- | ------------------------------------------------------ |
| `LISTED_IN`      | the repo is linked in a list                          | list id, file, line, the line's text                   |
| `USED_BY`        | the kit installs, credits, cites or runs it           | file, line, `use` = installed, credited, skill or code |
| `REJECTED_IN`    | a list marks it rejected, skipped or ignored          | file, line                                             |
| `DEFERRED_IN`    | a list marks it "later"                               | file, line                                             |
| `MARKED_USED_IN` | a list marks it used or installed                     | file, line                                             |
| `MENTIONED_IN`   | a doc outside the lists names it; not evidence of use | file, line                                             |

Status is `used` when any `USED_BY` or `MARKED_USED_IN` edge exists, else
`rejected` when any `REJECTED_IN` exists, else `untriaged`. A "later" verdict
stays untriaged: someone looked, nothing was decided.

## The counts

**2,883 links in the lists, 2,501 distinct ids as written, 2,496 canonical
repos.** Ten ids collapsed into five renames (`ahujasid/blender-mcp` is now
`ahujasid/mcp-for-blender`, `noisy/noisy-coding` is `noisy/noisy-studio`,
`piekstra/slack-cli` is `open-cli-collective/slack-chat-api`, and so on). 24
ids 404 on GitHub and stay in the graph with `missing: true`. 94 are archived.

| Status    | Repos |
| --------- | ----: |
| used      |   101 |
| rejected  |   161 |
| untriaged | 2,234 |

Behind the 101 used (one repo can carry several kinds): 71 are credited in `CREDITS.md`, 13 are installed by
`setup.sh`, `install.sh`, `config/settings/toolkit.json` or code that runs an
install, 9 are cited in a `SKILL.md`, and 16 are named in kit code. 38 more edges come from a list marking the repo
installed or used.

| List             | File                                                                                           | Links | Repos | Used | Rejected | Untriaged | Only in this list |
| ---------------- | ---------------------------------------------------------------------------------------------- | ----: | ----: | ---: | -------: | --------: | ----------------: |
| REPO-ATLAS       | `skills/gtm-engineering/references/REPO-ATLAS.md`                                              |   724 |   705 |    1 |        1 |       703 |               695 |
| oss-apps         | `config/data/oss-apps/apps.json`                                                               | 1,443 | 1,441 |   29 |       16 |     1,396 |             1,384 |
| amber-repos      | `~/second-brain/projects/amber-operating-workspace-2026-10/research/repos.md`                  |   201 |   196 |   38 |      105 |        53 |                39 |
| STARRED-AUDIT    | `docs/STARRED-AUDIT.md`                                                                        |   115 |   115 |   20 |       95 |         0 |                 0 |
| LINKS-FROM-CALEB | `docs/LINKS-FROM-CALEB.md`                                                                     |   120 |   113 |   21 |       58 |        34 |                74 |
| non-majority     | `~/second-brain/claude/skills/maintainer-orchestrator/references/non-majority-repositories.md` |    49 |    46 |    1 |        0 |        45 |                44 |
| mac-LANDSCAPE    | `docs/mac/LANDSCAPE.md`                                                                        |    40 |    40 |   38 |        0 |         2 |                 0 |
| mac-tools.json   | `mac/data/tools.json`                                                                          |    80 |    40 |   38 |        0 |         2 |                 0 |
| asks.jsonl       | `~/second-brain/chewbacca/asks.jsonl`                                                          |    45 |    33 |    7 |        0 |        26 |                12 |
| REFERENCE        | `docs/REFERENCE.md`                                                                            |    47 |    34 |   26 |        0 |         8 |                16 |
| amber-resources  | `~/second-brain/projects/amber-operating-workspace-2026-10/06-RESOURCE-LIBRARY.md`             |    19 |    19 |    9 |        8 |         2 |                 0 |

The last four lists beyond the seven named in CHW-187 came from scanning the
kit and the second brain for any file with 15 or more distinct repos. Two more
files passed that bar and were left out because they repeat
`06-RESOURCE-LIBRARY.md` exactly: the Amber folder's `resources.csv` and
`research/batch-repos.txt`. `CREDITS.md` (86 repos) and
`config/settings/toolkit.json` (28) are read as evidence of use, not as lists.

## Overlap

**232 repos appear in two or more lists, 200 if `mac/data/tools.json` and
`docs/mac/LANDSCAPE.md` count as one list** (they are the same 40 tools in two
formats). 2,264 appear in exactly one. The most-listed are `openclaw/peekaboo`
and `petergyang/no-ai-slop` (five lists each, both used), then
`mem0ai/mem0` and `open-pencil/open-pencil` (four each, both untriaged).

Repos in both lists:

|                  | ATLAS |  oss | amber | STAR | LINKS | n-maj | LAND | tools | asks | REF | res |
| ---------------- | ----: | ---: | ----: | ---: | ----: | ----: | ---: | ----: | ---: | --: | --: |
| REPO-ATLAS       |   705 |    7 |     2 |    0 |     1 |     0 |    0 |     0 |    0 |   0 |   0 |
| oss-apps         |     7 | 1441 |    19 |    6 |    34 |     1 |    5 |     5 |    1 |   4 |   9 |
| amber-repos      |     2 |   19 |   196 |  115 |     8 |     0 |    1 |     1 |   20 |  16 |  19 |
| STARRED-AUDIT    |     0 |    6 |   115 |  115 |     0 |     0 |    1 |     1 |    1 |  12 |   1 |
| LINKS-FROM-CALEB |     1 |   34 |     8 |    0 |   113 |     1 |    3 |     3 |    2 |   0 |   5 |
| non-majority     |     0 |    1 |     0 |    0 |     1 |    46 |    0 |     0 |    0 |   1 |   0 |
| mac-LANDSCAPE    |     0 |    5 |     1 |    1 |     3 |     0 |   40 |    40 |    0 |   2 |   0 |
| mac-tools.json   |     0 |    5 |     1 |    1 |     3 |     0 |   40 |    40 |    0 |   2 |   0 |
| asks.jsonl       |     0 |    1 |    20 |    1 |     2 |     0 |    0 |     0 |   33 |   3 |   2 |
| REFERENCE        |     0 |    4 |    16 |   12 |     0 |     1 |    2 |     2 |    3 |  34 |   2 |
| amber-resources  |     0 |    9 |    19 |    1 |     5 |     0 |    0 |     0 |    2 |   2 |  19 |

`amber-repos` holds all 115 of the starred audit because the 2026-10-03
research re-read the star list. REPO-ATLAS barely touches the rest: 10 of its
705 repos are in another list (7 open-source email and CRM apps shared with
oss-apps, plus `vercel/ai`, `clay-run/agent-plugins` and `dottxt-ai/outlines`).

## Top 25 untriaged, for where Chewbacca is going

Pool: untriaged repos, minus everything in REPO-ATLAS (the GTM tab owns it),
anything under `goodnight000` and anything Clay, GTM or outbound (other tabs
own those), and the 404s. That left 1,448. They were scored on fit with the
direction (HUD surfaces, file manager, IDE in the HUD, people and messaging,
Mac control), whether `config/data/surfaces/apps.json` already names the repo
as an alternative to an app Chewbacca replaces, license, stars and recency,
then hand-ranked after reading each README through `gh api`. "Later" items
that already carry a written next step (`sqlite-vec`, `mail-0/zero`) were left
out because they are already triaged in `docs/LINKS-FROM-CALEB.md`.

License in that pool: 727 permissive, 380 GPL-family (flagged, never
vendored), 256 NOASSERTION, 124 with no license, 19 MPL-2.0. Everything below
is MIT, Apache-2.0 or BSD.

|   # | Repo                                                                              | License, stars             | What it is                                                                                  | What Chewbacca takes                                                                                                                                                   | Target                                                               |
| --: | --------------------------------------------------------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
|   1 | [openclaw/crawlbar](https://github.com/openclaw/crawlbar)                         | MIT, 25                    | Menu bar app and CLI that shows status and freshness for local crawlers from JSON manifests | Its manifest and control protocol, so every people.db source (slacrawl, wacli, iMessage) reports freshness in one place                                                | new `bin/lib/surfaces/` sources surface, `doctor.sh` checks          |
|   2 | [sfsam/itsycal](https://github.com/sfsam/itsycal)                                 | MIT, 4.0k                  | Tiny menu bar calendar that can create and delete events                                    | Its EventKit create/delete path; surfaces/apps.json lists "creating or moving events" as Calendar's gap                                                                | `bin/lib/surfaces/walks.py` (Today)                                  |
|   3 | [leits/meetingbar](https://github.com/leits/MeetingBar)                           | Apache-2.0, 5.4k           | Next meeting in the menu bar, detects join links for 50+ services                           | Its meeting-link pattern table, so a Today row joins the call in one press                                                                                             | `bin/lib/surfaces/walks.py`, `bin/lib/surfaces/meetings.py`          |
|   4 | [codeeditapp/codeedit](https://github.com/CodeEditApp/CodeEdit)                   | MIT, 23k                   | Native Swift code editor for macOS                                                          | Its editor component (the CodeEditSourceEditor package it is built on) for an editable file pane                                                                       | `hud/Sources/KyberKit/FileView.swift`                                |
|   5 | [ghostty-org/ghostty](https://github.com/ghostty-org/ghostty)                     | MIT, 62k                   | Terminal emulator whose core ships as embeddable `libghostty`                               | libghostty in place of the text-only terminal strip                                                                                                                    | `hud/Sources/KyberKit/TerminalStrip.swift`                           |
|   6 | [exelban/stats](https://github.com/exelban/stats)                                 | MIT, 42k                   | Swift menu bar monitor for CPU, GPU, memory, disk, network, battery, sensors                | Its IOKit/SMC readers for a machine surface (battery, thermals, disk)                                                                                                  | new surface in `bin/lib/surfaces/`                                   |
|   7 | [swiftbar/swiftbar](https://github.com/swiftbar/SwiftBar)                         | MIT, 4.7k                  | Any script becomes a menu bar item via `{name}.{time}.{ext}` plugins                        | The BitBar/SwiftBar plugin output format as a surface input, so existing plugins render on the glass                                                                   | `bin/lib/surfaces/engine.py`                                         |
|   8 | [korotovsky/slack-mcp-server](https://github.com/korotovsky/slack-mcp-server)     | MIT, 1.9k                  | Slack MCP with a no-scope stealth mode and unread-across-channels                           | Its unread ranking (DMs, then partner channels, then internal) for needs-you                                                                                           | `mac/lib/slack.py`                                                   |
|   9 | [gitify-app/gitify](https://github.com/gitify-app/gitify)                         | MIT, 5.4k                  | Git forge notifications in the menu bar, one adapter per forge                              | Its GitHub notifications adapter with mark read, done and unsubscribe                                                                                                  | `bin/lib/surfaces/github.py`                                         |
|  10 | [sveinbjornt/sloth](https://github.com/sveinbjornt/Sloth)                         | BSD-3-Clause, 9.0k         | Native GUI over `lsof`: open files, sockets, pipes per process                              | Its `lsof` parsing, for "what has this file open" and "what is listening" rows                                                                                         | `bin/lib/surfaces/files.py`                                          |
|  11 | [spacedriveapp/spacedrive](https://github.com/spacedriveapp/spacedrive)           | Apache-2.0 per GitHub, 39k | One indexed private filesystem across devices and drives                                    | Its location and content-index model, for a files surface that reaches past Downloads; check the LICENSE file before copying code, it was AGPL-3.0 in earlier releases | `bin/lib/surfaces/files.py`                                          |
|  12 | [wavetermdev/waveterm](https://github.com/wavetermdev/waveterm)                   | Apache-2.0, 22k            | Terminal with drag-and-drop blocks of terminals, editors, previews and AI chat              | The block layout (terminal, editor, preview, full-screen toggle) as the IDE-in-the-HUD layout                                                                          | `bin/lib/surfaces/code.py`, `hud/Sources/KyberKit/SurfaceView.swift` |
|  13 | [mem0ai/mem0](https://github.com/mem0ai/mem0)                                     | Apache-2.0, 67k            | Agent memory layer; in four lists                                                           | Its fused retrieval (semantic, BM25 and entity match scored together) as the design for semantic people search beside FTS5                                             | `bin/lib/people/`                                                    |
|  14 | [hammerspoon/hammerspoon](https://github.com/Hammerspoon/hammerspoon)             | MIT, 16k                   | Lua bridge to macOS: windows, AX, event taps, hotkeys                                       | Its `hs.window` and `hs.axuielement` sources as the reference for window verbs                                                                                         | `skills/mac-control`, `mac/bin/chewie`                               |
|  15 | [ianyh/amethyst](https://github.com/ianyh/Amethyst)                               | MIT, 16k                   | Accessibility-API tiling window manager in Swift                                            | Its AX frame and Spaces handling, to place a launched app beside the glass                                                                                             | `skills/mac-act`, `mac/lib/`                                         |
|  16 | [amicalhq/amical](https://github.com/amicalhq/amical)                             | MIT, 1.6k                  | Local dictation that formats speech by the active app                                       | Its active-app to formatting-rule table                                                                                                                                | `hud/Sources/Kyber/KeyDictation.swift`                               |
|  17 | [zackriya-solutions/meetily](https://github.com/Zackriya-Solutions/meetily)       | MIT, 32k                   | Local meeting capture with Parakeet/Whisper live transcription                              | A speed comparison of its Parakeet path against the kit's transcriber                                                                                                  | `bin/lib/meeting_capture.py`                                         |
|  18 | [open-pencil/open-pencil](https://github.com/open-pencil/open-pencil)             | MIT, 8.8k                  | Design editor that reads and writes `.fig`, with a headless CLI and MCP server              | Its CLI as the reader for a Figma surface, so a `.fig` previews without Figma                                                                                          | Figma row in `config/data/surfaces/apps.json`, `bin/lib/surfaces/`   |
|  19 | [ospfranco/sol](https://github.com/ospfranco/sol)                                 | MIT, 3.2k                  | Native launcher and command palette                                                         | Its feature list (app search, script runner, clipboard, process killer) as the coverage checklist                                                                      | `hud/Sources/KyberKit/Launcher.swift`                                |
|  20 | [monitorcontrol/monitorcontrol](https://github.com/MonitorControl/MonitorControl) | MIT, 34k                   | DDC brightness, contrast and volume for external displays with native OSD                   | Its DDC code for a brightness verb that works on external monitors                                                                                                     | `skills/mac-act`                                                     |
|  21 | [jacklandrin/onlyswitch](https://github.com/jacklandrin/OnlySwitch)               | MIT, 6.0k                  | Menu bar of one-tap toggles (dark mode, hide desktop icons, notch, Shortcuts)               | Its toggle implementations as one-press HUD switches                                                                                                                   | `skills/mac-act`                                                     |
|  22 | [ji4n1ng/openinterminal](https://github.com/Ji4n1ng/OpenInTerminal)               | MIT, 7.0k                  | Finder toolbar app that opens the current folder in a terminal or editor                    | Its front-Finder-window path lookup, so "open this folder" means the folder he is looking at                                                                           | `bin/lib/surfaces/files.py`, `skills/mac-act`                        |
|  23 | [noisy/noisy-studio](https://github.com/noisy/noisy-studio)                       | MIT, 12                    | Voice daemon and Claude Code plugin with spoken replies per conversation (Caleb pasted it)  | Its per-conversation voice setting and the plugin hook that speaks replies; 12 stars, so read, don't install                                                           | `hud/Sources/KyberKit/Voice.swift`                                   |
|  24 | [block/buzz](https://github.com/block/buzz)                                       | Apache-2.0, 36k            | Nostr-relay workspace where people and agents share rooms, each agent with its own keys     | Per-agent identity and one signed event log, as the model for the team board and agent tabs                                                                            | `tools/team.py`                                                      |
|  25 | [bytedance/ui-tars-desktop](https://github.com/bytedance/UI-TARS-desktop)         | Apache-2.0, 39k            | GUI agent stack with local and remote computer operators                                    | Its screenshot-to-action operator schema as the fallback when the AX tree comes back empty                                                                             | `skills/mac-control`                                                 |

GPL-family repos that scored high and were held back for license, not fit:
`jordanbaird/ice` (GPL-3.0, menu bar manager) and `zed-industries/zed`
(GitHub reports NOASSERTION; the editor crates are GPL-3.0). Read them for
ideas only.

## Regenerate

```bash
bin/repo-graph                 # rebuild data/repo-graph.jsonl from every list
bin/repo-graph stats           # counts, list sizes and the overlap matrix
bin/repo-graph --refresh       # refetch GitHub metadata instead of the 7-day cache
bin/repo-graph --offline       # no network: ids stay as written, no renames
python3 tests/test_repo_graph.py
```

Metadata is cached at `~/.chewbacca/state/repo-graph-meta.json` for 7 days. A
full rebuild with a cold cache is about 50 GraphQL queries and took 53 seconds
on 2026-10-09. To add a list, add a line to `DEFAULT_LISTS` in `bin/repo-graph`.

## Where it is wrong

- Verdicts are read only in the shapes the lists write them: `**rejected**`,
  `): rejected`, `| Skipped |`, `Verdict: IGNORE`, and the same for later and
  used. A list that writes verdicts some other way reads as untriaged.
- In `research/repos.md` a section's `Verdict:` line applies to every repo
  linked in that section, which can catch a repo mentioned in passing.
- A repo named anywhere in kit code or data counts as used, including a
  comment or a survey line like the tool list in `mac/data/layers.json`. The
  edge's `evidence` field shows the line, so check it before relying on a
  `use: code` edge alone.
- An install token matches by package name, so two repos with the same name
  both get the edge; the `via` field says `install token <name>`.

Built with Chewbacca
