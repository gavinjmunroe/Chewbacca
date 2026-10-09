---
name: project_cap_in_chewbacca
description: Cap is baked into Chewbacca as of 2026-09-16: what it does, the three-part install the cask alone does not finish, and the one thing still waiting on Caleb's browser.
metadata:
  node_type: memory
  type: project
---

Caleb saw Carlton demo a product with zooms that tracked the cursor and asked
whether anything open source does it. **Cap** does: `CapSoftware/Cap`, 22.3k
stars, Rust, AGPLv3 with the `cap-camera*` and `scap-*` crates under MIT.

**How the effect works**, from `crates/rendering/src/zoom_spring.rs`: zoom
amount, framing centre and an activity step are each integrated by a
spring-mass-damper simulation chasing step targets, retargeted every 8ms with
velocity carried across retargets. No fixed durations and no boundary cases,
which is why it reads as smooth rather than keyframed. The automatic half is
**"click-cluster construction"**: it reads the cursor event stream, groups
clicks into clusters, and aims the spring at them.

**Why it fits this kit rather than being just an app.** `cap-cli` takes `--json`
on every command, ships `cap mcp serve`, and has
`cap agents install --target claude` which installs its own skill plus a
**`cap-demo`** skill that records a cinematic product demo from a URL with
virtual input, a 3D camera, a brand-matched background and music.

## The install is three parts and the cask is only the first

This is the part to remember. `brew install --cask cap` drops `Cap.app` in
/Applications and leaves the CLI buried at `Contents/MacOS/cap-cli`, so nothing
is on PATH. The registry entry in `tools/inventory.py` runs all three:

1. the cask
2. `cap-cli desktop install-cli`, the `cap` shim into `~/.local/bin`
3. `cap-cli agents install --target claude --component all --yes`

No `mcp_serve` key on the entry, on purpose: step 3 already merges the server
into `~/.claude.json`, and the generator's `mcp_serve` path would register it a
second time in the same file.

## No account, ever. The MCP server was the wrong install.

Caleb pushed back with "why do I need to login, ain't this open source" and he
was right. The first pass installed `--component all`, which registered
`cap mcp serve` and left a `Failed to connect` in every session.

**All 76 MCP tools are cloud operations**, counted off the definitions in
`apps/cli/src/mcp.rs`: 24 organization, 19 caps library, 11 developer, 5 space,
3 folder, 3 account, plus billing, analytics and notifications. **Zero** record,
export, screenshot or targets. It is the remote control for cap.so, the hosted
half of an open-core product, and it is not an interface to the recorder at all.
So it cannot serve the only reason this kit installs Cap, and it refuses to boot
without a cap.so login.

Now installs `--component skill`. Both skills stay, because both drive the local
CLI. **There is no account step anywhere in the kit's Cap path.**

Verified signed out, with no credential on the machine: `cap targets` enumerated
1 screen, 2 windows, 4 cameras and 3 mics, `cap recordings list` returned `[]`,
and `cap record`, `cap export` and `cap doctor` are all local. Screen Recording
and microphone are granted.

**The general lesson**: open source and no-account are different claims, and an
open-core project's agent surface is usually wired to the hosted half. Count the
tools before registering an MCP server.

## Three bugs fixed on the way in

- `read_frontmatter` in `tools/inventory.py` handled a bare `|` and `>` and
  nothing else. Cap writes `description: >-`, so the marker became the value and
  the folded text was appended behind it, and it published into
  `docs/REFERENCE.md`, which is public.
- Vendored descriptions ship verbatim into the generated tables and Cap's
  carried an **em dash**, which the kit bans outright. New `house_style()`
  normalises third-party text into generated copy and leaves the vendored
  `SKILL.md` alone, since upstream overwrites it anyway.
- In `doctor.sh`, piping `run_limited` into `grep -q` under `set -o pipefail`
  reports a **false negative**: grep exits on first match, the printf takes the
  EPIPE, pipefail promotes it. It reported Screen Recording as not granted when
  it was. Capture to a variable and grep that, which is what the `mac` check
  three blocks up already did.

Related: a private note, [[project_chewbacca]],
a private note.
