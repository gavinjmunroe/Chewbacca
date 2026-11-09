---
name: project_hud_stale_installed_tools
description: On 2026-09-21 half the HUD's CLIs on this Mac were stale copies or missing entirely, because setup.sh had not run since early September
metadata:
  type: project
---

Caleb could not talk to Chewbacca through the HUD. The cause was not the HUD.
`~/.local/bin` had drifted badly from the repo:

| Tool | State found |
| --- | --- |
| `hud-listen` | copy from **Sept 5**, 379 lines against the repo's 3,223 |
| `hud`, `hud-context` | copies from **Sept 4** |
| `hud-speak`, `hud-guide`, `hud-music`, `hud-bubble` | **not installed at all**, ~2,600 lines |

`hud-listen` was the expensive one. It predated the profile work, so it passed
**zero** flags to `claude`, which is the `full` profile: all 15 MCP servers and
~156k tokens a turn against `lean`'s 54k. That is why one spoken word took over
a minute. `hud-speak` is what reads answers aloud and simply was not there.

**The installer was never at fault.** `link_tool` in `setup.sh` symlinks
correctly and its comment even mentions replacing "an existing copy from an
older setup". setup.sh just had not been run since before those tools existed.

**How to apply:** all twelve are symlinks to the repo now, so they cannot drift
again. To check any machine:

```bash
cd ~/code/chewbacca
for t in hud hud-listen hud-context hud-watch hud-speak hud-guide hud-music \
         hud-bubble superassistant chewbacca-mcp portal hud-autostart; do
  d=~/.local/bin/$t
  [ -L "$d" ] && continue
  [ -e "$d" ] && echo "$t: COPY, may be stale" || echo "$t: MISSING"
done
```

A copy where a symlink belongs is the tell. Related:
[[feedback_launchd_minimal_path_breaks_children]],
[[project_hud_adhoc_signing_and_warm]].
