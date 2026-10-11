---
name: nalana
description: "Drive Nalana, the Cursor for Blender app, through the blender MCP to model, light and render 3D scenes, props, rooms and hero art. Use for Nalana, Blender, any 3D render. Not nano banana."
triggers: >-
  Drive Nalana, the "Cursor for Blender" app at /Applications/Nalana.app, through the blender MCP tools to model, light and render 3D scenes, props, rooms, product shots and website hero art. Use whenever Caleb says Nalana, nalana, "use Nalana", Blender, a 3D render, a 3D scene, a rendered room or diorama, isometric or skeuomorphic art for a site, or art "like teameigen.com". Nalana is NOT nano banana (Gemini image gen); never route one to the other.
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

## Modeling a real object: make it read as the real thing

Lessons from the TTS helmet logo, 2026-10-11, all in Caleb's words or his
friends'. They apply to any prop or mark modeled after a physical object.

- **Armor and shells are thin sheets, never solid lumps.** Next to a bronze
  Corinthian photo: "the wing comes across as very thick instead of a
  relatively thin protective layer like other helmets portray" and "The back
  looks tweak too it doesn't feel like a helmet". Hollowing a solid after the
  fact (a 0.07 wall cavity, open underneath) barely changed the read from the
  logo camera, and a lip boolean along the lower edge broke the S. Build the
  form as plates from the start: a round skull, guards that flare out, rolled
  rims on every edge, big dark openings, a neck guard that flares off the back.
- **Openings that define the object go all the way through.** "IT doesn't
  clearly enough resemble a helmet, make the T holes go all the way through
  the bottom so there are 3 defined things in the front". Shallow pockets read
  as paint.
- **Letterforms never cut into a neighboring feature at an angle.** "When the
  logo is small you can't clearly tell it is a TT and an S the Top of the T
  being carved into the brow give it a weird choppy geometry". Keep a strip of
  base material between a letter and any ridge, and check every render at
  128px as well as full size.
- **Separate parts need a real edge.** "It looke like 1 big block, the front
  flap transition to the back of the helmet shouldn't be continuous". A color
  change on a continuous surface reads as one block; a step or gap reads as
  two parts. A step grown all the way round turned into a hat-brim ledge, so
  fade it out where the parts should meet flush.
- **Exact booleans fail silently on lofted shells.** The exact solver left a
  40-face body with no error. Print the face count after every boolean, and
  use MANIFOLD on lofted meshes.
- **A link to a render is relative to the session root.** The shell's cwd
  drifts with every cd; see link-guard.
