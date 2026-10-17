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
- **Another tab may be in the live Nalana.** Check first
  (`lsof -nP -iTCP:9876 -sTCP:LISTEN`, `tabs list`). If it's up, never run
  `nalana-mcp`: its `pkill` wipes that tab's scene. Render from a script in a
  second, headless Nalana instead:
  `Nalana -b --factory-startup --python <script.py> -- <out_dir>`. On
  2026-10-11 the /way caption clouds were made this way (TTS-Dev
  `blender/clouds.py`) while the logo tab held the live one.

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
- **A wearable shell is an open surface solidified, not a solid minus a
  cavity.** "How would someone wear this helmet lmao" (2026-10-11): the lofted
  ring pinched to a knife edge at the bottom. What worked: keep the back neck
  wide, delete faces with normal z below -0.6, Solidify inward, hollow any
  unioned band with a plug, then turn inward-facing faces dark so slots still
  read as dark openings at 128px.
- **Logos render with no shadow.** "The logo shouldn't hv shadows"
  (2026-10-11). The reference he named is a single soft-lit rainbow arch with
  a sculpted texture and no cast shadow, set beside a flat wordmark.

## Nalana's own modeler comes first

"WE HV NALANA" (Caleb, 2026-10-11), after 29 hand-coded bpy versions of the TTS
helmet still read as "a trash can that was cut out of". Nalana has its own AI
modeler: one prompt plus his reference photo gave a real Corinthian in about
two minutes. Hand-written bpy is for edits on top of that, never the first
draft of an organic shape.

How to drive it from a session: the bridge listens on 127.0.0.1:8765 and wants
the bearer token in `nalana.bridge_server._token` (read it inside Blender via
the MCP and write it to a 0600 scratch file, never print it). POST
`/chat/send` with `{"text": ..., "images": [{"dataUrl": "data:image/png;base64,..."}]}`,
then poll `/state` until `is_processing` and `is_thinking` are both false; the
last `conversation` entry carries its own review score. It binds to the
active object, so save the scene first.

## Logo iteration: never-dos from the TTS helmet nights (2026-10-11 and 10-12)

Thirty-six corrections across two nights, most of them the same few mistakes.

- **Never leave the version he approved.** He said "bro this is TUFFFFFF" exactly
  once, at v39. Fifty versions later he wrote "wtf is this shit" and "Scan this
  whole chat and then lock in". Before any rebuild, grep the transcript for his
  approvals and build on the approved file. A new pipeline (flat sweeps, puffy
  extrusions, an analytic shell) is a reset he has to ask for.
- **Never patch a cylinder into a head.** A revolved ring plus a dome reads as "a
  trash can" every time ("THE TRASH CAN IS BACK!", "2 trash cans/target red balls
  got fused together poorly", "Should it rlly just be a cylinder with a lid?").
  The head reads from silhouette: brow shelf, cheek blades pointing past the
  chin, egg bowl, neck guard. Change the outline, not the surface.
- **Never draw a letter onto armor.** "The S CANT LOOK FORCED". The S is the
  negative space between real parts (cheek edge on the left, the neck guard's
  curled inside on the right), seen from the logo angle, "not the side".
- **His spatial descriptions are the spec, read twice.** "the top of the back
  part should be much higher up, above where the top of the front mask is... then
  the back curls back inward so the INSIDE fills the gap, in the background not
  the foreground". Restate it in one line before modeling, and build that, not a
  near cousin (a scroll lip, a wave fin and a skirt flap all missed).
- **One material per color.** "the decoration brought in 2 new textures which
  sucks for a logo". Noise textures read Object coords of the main mesh so scale
  matches on every part.
- **No dark fills and no Vader.** "the fake black part looks gimmicky", "a trojan
  not darth vader". Insides are see-through or red.
- **Never claim a win before he sees it.** A render rated 8/10 at 11pm drew "wtf is
  this shit" at 5:46am. Report what reads and what doesn't, plainly.
- **Every render, three sizes.** Full, 128px and 48px before it goes in
  ~/Downloads/TTS logos.

## Joining the S piece to the helmet: never-dos from 2026-10-13

- **Never close the top of the S toward the cheek.** I capped the gap by curling
  the flap's edge back left and got "Bruhhhh the top of the S is chopped now it
  doesn't reach out far enough to the right". The S's top arm runs RIGHT, under
  the flap, and ends in a rounded tip. Carve it with an EXACT boolean cutter
  placed first in the flap's stack, and give the flap's inner shell the holdout
  material so the arm reads white instead of showing the red inside.
- **A transparent inner shell makes white spots.** "I hv a feeling the
  transparent part is cooking some spots and creases". A Solidify with
  material_offset pointing at holdout punches a hole wherever an inside face
  shows. Holdout goes only where the page is meant to show through (the S arm),
  and every other inner shell stays red.
- **Never fix wobbly edges with wide-window smoothing.** Pinning corners by
  looking 5 vertices either way rounded the T's square corners. Pin any vertex
  whose two boundary edges meet under 140 degrees, smooth the rest, and back up
  the mesh first.
- **Turning the view trades the left T against the S.** "rotate the whole thing
  slightly right the left T has gotten a bit skinny". At 7 degrees the S went
  edge-on to a slit, and 3.5 is the limit. Check both at 64px after any turn.
- **No holdout on the helmet, anywhere.** "The transparency part is cooking it
  bro" (2026-10-13). Every see-through trick put white specks and creases where
  an inner shell showed. All inner shells are cardinal.
- **Two bands that meet must share one profile.** "Why is this so deformed???"
  came from the flap's top band and the cheek's top band climbing onto the dome
  on different curves. Sample the existing band's radius just inside its edge,
  smooth it, and reuse it. Never sample the Nalana dome directly, because it's
  lumpy and leaves stair lines.
- **Check the parent before measuring anything.** FacePlate sits under the
  Replica empty, rotated -58 degrees. Edits that read theta from `v.co` instead
  of `matrix_world @ v.co` hit the wrong part of the mask and made new folds
  ("Wtf is going on???? How hard is it to make a smooth surface???",
  2026-10-13). Print `matrix_world` first.
- **A patched mesh gets rebuilt, not patched again.** After two rounds of fixes
  that each made a new bump, the fix was to sample the radius on a world
  (theta, z) grid, blur it a little, trim a flat grid to the old boundary loop
  with a planar EXACT boolean, and map it back. A boolean against a thickened
  copy of the old mesh made garbage.
- **Judge every change at full frame, at his size.** "Always look at the big
  picture when making things!" (2026-10-13), after a far-cheek redraw looked
  smooth in its 1:1 crop but bloated the whole side into a wing at his ~600px
  preview. After each change, shrink the full render to 600px (`sips -Z 600`)
  and compare it to the last approved version before reporting. Crops only
  confirm the spot.
- **Negative space gets cut along the camera's line of sight.** A radial cutter
  left the flap's inside wall showing through the S arm, and three rounds of
  material and bevel tweaks never fixed it: "why is the dark red still there
  after so many attempt to remove it? literally just delete that part"
  (2026-10-13). For a logo seen from one camera, extrude the cutter's outline
  along `(point - camera).normalized()` so nothing behind the opening survives.
  When the same artifact survives two fixes, ask what geometry the camera
  actually sees there before touching shading.
- **Open the final PNG at full size before saying anything about it.** "How
  dare you send me smth without lookign at it first on the final png"
  (2026-10-13). A 600px check hid a tear, ragged edges and a nub that were
  obvious at 2048. Every hand-off: read the exact file being linked at full
  size, then at 600px, and list what's still wrong from that look, never from
  memory of the fix.

## Crest decals and finishing passes: from A15 (2026-10-16)

- **Decals on an angled plane get placed in screen space.** The crest is seen
  near edge-on, so dots laid out radially on the plane read as ovals and a
  bend that points outward on the plane read as a tall M on screen. Pick the
  points in render pixels, cast camera rays onto the crest plane, and build
  there. Caleb's spec for the circuit trace: dots "centered radially, even
  distance from the center", bends "pointed outward, not inward", triangles
  "isoceles wide".
- **A wall showing through a cut-out is the back of the same surface.** The
  dark red in the S arm sat at theta 110 to 115, just past the backface-delete
  range. Raycast the bad pixels back to the mesh (BVHTree from the camera
  through the pixel) before guessing; that gave the exact angle in one call.
  After widening a delete, drop loose islands, or a speck survives.
- **A bump on a field-built surface gets fixed in the field.** Blur the radius
  .npy locally with a feathered mask and rebuild; moving vertices just moves
  the bump.
- **On a hot Mac the job queue pauses heavy renders indefinitely.** At load 50
  to 100 a queued render sat paused for 30+ minutes while Caleb waited. When he
  is waiting on a render, say the load and ask to force it on the first stall,
  not the third. Killing a paused render needs `kill -CONT` first, and killing
  it marks its job failed.
- **A handoff is a folder another person's agent can run.** For Tyler: scripts
  resolve paths from `__file__`, one `render.sh` with every knob as a commented
  env var, the history log, CLAUDE.md plus AGENTS.md, and the skills. Never put
  a login in it, and test a render from a fresh unzip before calling it done.
