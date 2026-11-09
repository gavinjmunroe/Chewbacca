---
name: feedback_3d_means_nalana
description: Any 3D modeling or render work starts in Nalana (live Blender plus the blender MCP), and every subagent brief for 3D says so
metadata:
  type: feedback
---

On 2026-10-11 a TTS helmet logo went through about a dozen renders from hand-written headless bpy scripts (eggs, toasters, a crewmate, a molecule crest) before Caleb said "Bro we hv NALANA never forget". Nalana was installed and its MCP gives look, search_assets, import_asset and generate_3d in a live scene. The 3D briefs this tab wrote to subagents never mentioned it, so no agent reached for it.

**Why:** Iterating blind in headless scripts means every render costs a queue round trip and nobody sees the scene. In Nalana the agent can look from any angle after every change and start from a real model.

**How to apply:** Before any 3D work, run `skills/nalana/scripts/nalana-mcp` and call `get_addon_status`. Every brief that hands 3D work to a subagent names Nalana and the blender MCP tools explicitly. For a recognizable object (a helmet, a car, a building), start from a real or generated base mesh, never from primitives. Asset libraries and generators there need keys: on 2026-10-11 none were set (Sketchfab, Hyper3D, Poly Pizza all off), so a base mesh had to come from elsewhere. Related: [[feedback_find_the_existing_thing_first]].
