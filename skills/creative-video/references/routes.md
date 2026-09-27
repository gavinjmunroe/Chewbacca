# Where the pixels come from

Four routes. The model writes code or directs a tool in every one of them; it
never draws a pixel itself. Checked 2026-09-27.

| Route                                                               | Use it for                                                                  | Cost                    | Deterministic       | Status here           |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------- | ----------------------- | ------------------- | --------------------- |
| **Code-drawn**: `page-render`, Canvas, SVG, Remotion                | UI, type, motion graphics, explainers, charts                               | free                    | yes                 | installed             |
| **Blender, headless**: `blender -b -P scene.py`                     | 3D objects, arrays, satisfying mechanisms, product turntables, camera moves | free, about 1 s a frame | yes                 | installed (5.2.2 LTS) |
| **Higgsfield**: Seedance, Kling, Veo and more, driven by the `higgsfield` CLI | photoreal people, places, footage-like shots, UGC styles | credits | no | signed in, Plus plan |
| **Blender blocking, then Seedance** | exact layout and camera, with a photoreal look on top | credits | camera yes, look no | blockout renderer tested; no Seedance job yet |

## Code-drawn

`page-render URL out.mp4 --size 1080x1920` renders any animated page on a fake
clock, so a WebGL scene comes out at 60 fps on a laptop that draws it at 20.
Remotion is the other common route in the Opus 5.5 corpus; its agent skills
install with `npx skills add remotion-dev/skills`. Motion graphics are the
most common Opus-made style (350 of 1,119 videos), so this route needs the
strongest idea.

## Blender, headless

No MCP. `blender -b --factory-startup -P scene.py -- args` builds the scene from
Python, keys it and renders PNG frames without a window, so it never takes the
screen he is working on. Eevee on the M4 Pro: 0.38 s for one 540x960 still,
0.96 s a frame at 1080x1920 with 1,003 objects. The worked template is
`blender/domino_reveal.py`.

**blender-mcp** (ahujasid/blender-mcp, MIT, read at 41a1843 on 2026-09-27) is
the right tool only for live modelling in the GUI with viewport screenshots.
It is not installed, and installing it later means all three of these:

- It sends an anonymous usage record by default. Run it with
  `DISABLE_TELEMETRY=true`.
- Never tick its consent box. Opting in sends prompts, generated code,
  viewport screenshots and scene data, which its terms let it use "to train AI
  models".
- Set `BLENDER_MCP_SAFE_MODE=1`. Without it, `execute_blender_code` is
  arbitrary Python in Blender, and asset names from Poly Haven and Sketchfab
  flow into the model's context. Its own docstring says the guard covers the
  MCP path only, because the add-on's socket takes code from any local process.

## Higgsfield

Gavin's account is on the Plus plan (1,200 credits a month, no rollover). The
live log of what works, what it costs and what went wrong is
`~/dev/gavin-context/research/higgsfield/LEARNING.md` in his brain. **Read it
before any Higgsfield job and write every new fact or mistake into it the same
turn.** What follows is only what a session needs to start.

- **Drive it with the CLI.** `higgsfield` (`npm i -g @higgsfield/cli`), never
  `hf`, which is Hugging Face's CLI on this Mac. `higgsfield account status`
  shows the plan and credits; `higgsfield model list --video` is the live
  catalog, so never guess a model id.
- **Price every job first.** `higgsfield generate cost <model> ...`, and say the
  number before `generate create ... --wait`. Measured 2026-09-27: 5 s of
  Seedance 2.5 is 15 credits at 480p, 35 at 720p, 60 at 1080p; Kling 3.0 is
  10 and Kling 3.0 Turbo 7.5; a Soul Cinema still is 0.12. The full table is
  in [blender-to-seedance.md](blender-to-seedance.md).
- **"Unlimited" does not reach the CLI or the MCP.** Membership credits do.
  The MCP (`https://mcp.higgsfield.ai/mcp`, OAuth, launched 2026-04-30) draws
  on the same credits and costs about 12k tokens of tool definitions a session
  without tool search, which is why the CLI comes first.
- **Chain jobs by id.** A media flag takes a local path or an earlier job id,
  so a Blender still or a Soul Cinema frame goes straight in as
  `--start-image`, and `--end-image` pins the last frame on Kling 3.0 and
  Seedance.
- **Where it goes wrong for other people:** Trustpilot 4.0 over 4,193 reviews,
  with a heavy one-star tail about billing: renewals charged days early,
  refunds refused after any use, "Unlimited" plans that expired early or
  queued a 15-second clip for 2 to 4 hours (Trustpilot, WION, September
  2026). Stay on monthly credits and agree a spend cap before a batch.

## Blender blocking into Seedance

Low-poly Blender blocking fixes composition and camera; Seedance 2.5 in
`omni_reference` mode supplies the look. @OriSilver's split-screen post and
Higgsfield's own building-collapse workflow both combine the two
(awesome-opus-5-5-videos, 2026-09-26). Use it when the brief needs a camera
move, screen geography or timing that prompting cannot hold across takes.

The whole method, its rules and where each came from is
[blender-to-seedance.md](blender-to-seedance.md). The renderer is
`blender/blockout_ref.py`: a JSON spec in, a grey reference video, first and
last frames and the role block for the prompt out, about 14 s for 5 s of
1920x822. `tests/blockout_ref.sh` holds it to its spec's length.
