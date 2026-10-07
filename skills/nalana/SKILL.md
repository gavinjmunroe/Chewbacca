---
name: nalana
description: Drive Nalana, the "Cursor for Blender" app at /Applications/Nalana.app, through the blender MCP tools to model, light and render 3D scenes, props, rooms, product shots and website hero art. Use whenever Caleb says Nalana, nalana, "use Nalana", Blender, a 3D render, a 3D scene, a rendered room or diorama, isometric or skeuomorphic art for a site, or art "like teameigen.com". Nalana is NOT nano banana (Gemini image gen); never route one to the other.
---

# Nalana

Nalana is a Blender fork with an AI layer, "Cursor for Blender". Caleb was its
GTM engineer from Feb to Jun 2026, and it's installed at
`/Applications/Nalana.app`. Under the hood it's **Blender 5.1.1**, so every
`bpy` script and the `blender` MCP tools work on it unchanged.

## Connect first, every time

```bash
~/code/chewbacca/skills/nalana/scripts/nalana-mcp
```

It installs the MCP for Blender add-on into Nalana's own add-on folder,
launches Nalana with the server started, and waits for port 9876. Then call
`mcp__blender__get_addon_status`. A "Connection closed before receiving any
data" right after a relaunch is the MCP client holding a dead socket from the
previous Nalana: make one more call and it reconnects.

Why the script exists, so nobody "simplifies" it back:

- Nalana reads add-ons from `~/Library/Application Support/Blender/5.1`, while
  plain Blender and `uvx mcp-for-blender install-addon` default to `5.2`. With
  the add-on only in 5.2, Nalana listens on its own `:8766` (its web panel)
  and nothing on `:9876`.
- A running Nalana ignores `--python`, and its quit dialog cancels an
  AppleScript quit, so the script stops it with `pkill` first. Save open work
  before running it.

## Name collision

On 2026-10-06 "we hv nalana" was read as nano banana, twice, and the session
went hunting for a Gemini key that doesn't exist on this Mac. Nalana is the 3D
app. Nano banana is Gemini image generation and has no key here.

## Working in it

Follow the blender MCP server's own instructions (look nodes up by type, read
enum identifiers before assigning them). Render stills headless-style through
`bpy.ops.render.render(write_still=True)` to a path under the project, then
`look` with `image=` the file to check it. Poly Haven and Sketchfab are off by
default in the add-on; enable them in the scene properties
(`blendermcp_use_polyhaven = True`) before `search_assets`.
