# Animation and art repos

Caleb, 2026-10-09: "There's prob a ton of github things that are gas for
animation. And art." This is the catalog for two jobs: the T Combinator site
(`~/code/work/tcombinator-site`, Blender and Nalana renders scrubbed by scroll,
shots that morph into each other, a painterly NPR look) and the Spider-Verse
study in Blender. The craft rules live in
[skills/spiderverse-style/SKILL.md](../../skills/spiderverse-style/SKILL.md); this
file is the tooling.

## How this was built

- 100 GitHub searches (65 keyword queries and 35 topic queries) plus 28
  targeted follow-ups. The first pass failed silently: `gh search repos`
  with `--sort stars` returned zero results for most multi-word queries, so
  every query was rerun through `gh api search/repositories`. Web searches
  filled the gaps that search can't reach (SMEAR, Krita plugins, Blender MCP,
  Gatekeeper status).
- 319 repos had their metadata and README pulled through the GitHub API on
  2026-10-09 (stars, license, archived flag, last commit on the default
  branch). Every row below was opened that way. Nine guessed names 404'd and
  are not listed.
- The 25 ranked at the top, plus GSAP, scrolly-video, vfx-js and ReEzSynth,
  were shallow-cloned into a scratch directory and their code skimmed: file
  layout, the shader or entry file, license file, and runtime requirements.
  Nothing was installed and nothing was cloned into a project repo.
- "Where it plugs in" names real files in the site: `components/tc/Film.tsx`
  (the scroll-scrubbed film, one `video.currentTime` seek in flight),
  `components/field/engine.ts` (raw WebGL points and prisms, morph mixed on the
  CPU), `scripts/shots/encode_film.sh` (all-intra `-g 1` film encode),
  `scripts/encode-films.sh` (manim films, `-g 4`) and `docs/SHOTS-tc.md`.
- Rank is judgment, not stars: fit to those two jobs first, then maintenance,
  license and whether it runs on this Mac. Ranks 1 to 25 are hand-ordered;
  the rest sort by fit score, then stars.

## Read before using any of them

- **lygia is not free for commercial use.** Prosperity License 3.0: noncommercial,
  with a 30-day commercial trial. Commercial use needs its Patron license, which
  sponsors and contributors get automatically.
- **GSAP** ships under GreenSock's standard "no charge" license, not an OSI
  license. **Remotion** needs a paid company license above a small team.
- **ebsynth** has no license file, which means all rights reserved by default.
  **DepthFlow** and **TheAnimeScripter** are AGPL. Most Blender add-ons are
  GPL-3.0, which is fine for tools and renders but matters if code is copied
  into the site.
- **No CUDA here.** ReEzSynth, ToonCrafter, informative-drawings (as shipped)
  and most style-transfer repos expect an NVIDIA GPU. Run them on RunPod, or
  use the CPU path where one exists (ebsynth has a macOS CPU build script).
- **Gatekeeper.** Krita.app and Inkscape.app on this Mac pass `spctl` as
  notarized Developer ID builds. Tahoma2D's own install docs say it is not
  notarized (first launch needs Open Anyway in Privacy and Security). A
  third-party tracker reports Pencil2D as notarized; OpenToonz, Synfig and
  Friction were not confirmed. Blender.app here currently fails `spctl` with
  "a sealed resource is missing or invalid", which usually means something
  wrote inside the bundle.
- The local Blender is 5.2. Malt's manifest targets 5.1, SMEAR 4.2+ (patched
  for 5.0), nijiGPen supports GP3 up to 5.2, camera_shakify needs 4.4+, blosm
  4.5+.

## Top 25

| Rank | Repo | What it does | License | Last commit | Stars | Where it plugs in |
|---:|---|---|---|---|---:|---|
| 1 | [paper-design/shaders](https://github.com/paper-design/shaders) | Zero-dependency WebGL2 shaders as plain GLSL strings, including halftone-cmyk, halftone-dots, dithering, paper-texture and grain | Apache-2.0 | 2026-09-17 | 3,576 | Lift the halftone-cmyk fragment shader straight into components/field (raw WebGL2, no three.js) and sample the Film.tsx video frame as u_image: per-ink C/M/Y/K colors, dot size, grain and grid noise are already uniforms. Apache-2.0, so it ships commercially. |
| 2 | [Vanilagy/mediabunny](https://github.com/Vanilagy/mediabunny) | Pure TypeScript media toolkit: demux, decode, encode and convert MP4/WebM in the browser over WebCodecs, zero deps | MPL-2.0 | 2026-10-05 | 7,272 | Swap the one-seek-in-flight video.currentTime loop in components/tc/Film.tsx for CanvasSink.getCanvas(timestamp): frames come back exact and decoded to a canvas the halftone shader can sample, and the encode can leave all-intra -g 1 for a smaller file. |
| 3 | [plutotcool/fsv](https://github.com/plutotcool/fsv) | Fast Scrubbing Video: an h264/h265 container tuned for frame-accurate web scrubbing, with optional alpha track and a WebCodecs Renderer class | MIT | 2026-06-30 | 46 | scripts/shots/encode_film.sh encodes film.mp4 all-intra (-g 1) because Film.tsx seeks with video.currentTime. FSV's Renderer decodes over WebCodecs, so its encoder table (gop 5, tune fastdecode, 0 B-frames, 1 ref) can replace -g 1 and cut the file size, and its alpha track lets a rendered character sit over the live WebGL field. |
| 4 | [bnpr/Malt](https://github.com/bnpr/Malt) | Fully customizable real-time NPR render engine for Blender, GLSL-first, with a line pass and NPR pipeline | custom | 2026-03-29 | 1,138 | Render engine for the Spider-Verse study and the TC shots: hand-authored line widths (Filters/Line.glsl, Passes/LineComposite.glsl), halftone in light and hatching in shadow written as GLSL instead of node spaghetti. Manifest targets Blender 5.1; local Blender is 5.2. |
| 5 | [MoStyle/SMEAR](https://github.com/MoStyle/SMEAR) | SIGGRAPH 2024 Blender add-on (Basset, Benard, Barla) that bakes smear frames: elongated in-betweens, multiple in-betweens and motion lines via Geometry Nodes | custom | 2025-11-20 | 70 | The Spider-Verse study's fast actions (the skill's Motion without blur section): bake smears on the twos instead of motion blur. Also on TC shots where an object whips across frame. Blender 4.2+, updated for 5.0. |
| 6 | [GarrettGunnell/Post-Processing](https://github.com/GarrettGunnell/Post-Processing) | Acerola's Unity post stack: basic, generalized and anisotropic Kuwahara, extended difference-of-Gaussians, halftone, and more, as HLSL | MIT | 2024-06-30 | 827 | The painterly pass: AnisotropicKuwahara.shader is four passes (structure tensor, two blurs, filter) that port to GLSL for the web, and ExtendedDoG.shader gives the ink line. Also a reference for the Blender compositor's built-in Kuwahara node settings. |
| 7 | [OmarShehata/webgl-outlines](https://github.com/OmarShehata/webgl-outlines) | Post-process ink outlines from depth, normal and per-surface ID buffers, in three.js and PlayCanvas, with the two articles that explain it | MIT | 2022-12-09 | 417 | The ink-line pass for any live 3D on the site; the surface-ID trick draws lines at material borders and creases only, which is the skill's "lines only where an illustrator would draw them" rule, not edge-detect everywhere. |
| 8 | [chsh2/nijiGPen](https://github.com/chsh2/nijiGPen) | Grease Pencil add-on: 2D boolean and offset, stroke cleanup, mesh and shading from 2D shapes, data exchange with other paint tools | GPL-3.0 | 2026-08-17 | 380 | Ink-line cleanup and fill generation on the Grease Pencil line layers of every shot; its mesh-from-strokes turns hand-drawn shapes (onomatopoeia, panels) into 3D props. Supports GP3 on Blender 4.3 to 5.2. |
| 9 | [vvoovv/blosm](https://github.com/vvoovv/blosm) | Blender add-on (formerly blender-osm) that imports OpenStreetMap, Google 3D cities and terrain | none | 2025-10-30 | 2,129 | Real LA streets, Mulholland, the canyon and the basin as geometry for the film's mulholland, map and canyon shots in FILM.stages, then restyled NPR. Base version GPL-3.0, source on branch release. |
| 10 | [jamriska/ebsynth](https://github.com/jamriska/ebsynth) | Example-based synthesis: paint one keyframe, propagate the style across a frame sequence with guide channels | none | 2019-05-10 | 1,682 | Paint over one rendered frame per shot in Krita, then propagate that paint across the Blender sequence before encoding; the painterly look stays hand-made instead of filter-made. macOS has a CPU-only build script. No license file, so treat as all rights reserved. |
| 11 | [oframe/ogl](https://github.com/oframe/ogl) | Minimal zero-dependency WebGL library with GPGPU, Post, Polyline, InstancedMesh and Flowmap extras | none | 2025-04-13 | 4,668 | Closest match to the hand-rolled engine.ts: its GPGPU.js moves the point morph between formations off the CPU, and Post.js chains the halftone and Kuwahara passes without adopting three.js. Unlicense. |
| 12 | [darkroomengineering/lenis](https://github.com/darkroomengineering/lenis) | Lightweight smooth scroll that exposes a single scroll value for WebGL sync | MIT | 2026-10-01 | 16,319 | Feed lenis.scroll to both Film.tsx time and engine.ts progress N so the film and the field read one eased value; the Glide component's anchor glides can call lenis.scrollTo. The skill says camera and scroll stay smooth while characters step, and this is that smooth half. |
| 13 | [spite/sketch](https://github.com/spite/sketch) | Inktober 2020 WebGL2 experiments: cross-hatching, engraving, CMYK halftone, scribble, cartoon and technical post passes | MIT | 2026-08-02 | 327 | Reference implementations for hatching-in-shadow and the post-cmyk-halftone-i pass (per-channel rotated dot grids from libretro's cmyk-halftone-dot) to port into the field shader. MIT. |
| 14 | [Yuntokon/BlenderLayer](https://github.com/Yuntokon/BlenderLayer) | Streams Blender's 3D View into Krita as a live layer you can trace and paint over | GPL-3.0 | 2024-10-22 | 391 | Paint-over workflow for the study: frame a shot in Blender, paint the illustrator's lines and shapes in Krita on top, match Spider-Verse key art before rendering. |
| 15 | [vpalos/Krbn](https://github.com/vpalos/Krbn) | Zero-dependency TypeScript engine that renders 3D scenes to SVG pencil drawings: exact silhouettes, hidden-line ghosting, hatching, wobble and width | MIT | 2026-07-25 | 236 | Vector line art for UI-scale moments (section dividers, the map, LA buildings) with hatch and wobble stages already in src/pipeline; output is SVG, so it stays sharp and styleable in CSS. |
| 16 | [p2or/blender-loom](https://github.com/p2or/blender-loom) | Blender add-on for rendering image sequences and specific frames, batch rendering, ffmpeg encoding to ProRes and more | none | 2026-04-29 | 228 | The render-to-encode step: render the frame ranges in FILM.stages, re-render only broken frames, encode a ProRes master before scripts/encode-films.sh makes the web cut. |
| 17 | [Pullusb/storytools](https://github.com/Pullusb/storytools) | Storyboarding toolset for Blender: camera, object and Grease Pencil gizmos for drawing boards inside the 3D scene | GPL-3.0 | 2026-08-07 | 125 | Block every shot in docs/SHOTS-tc.md and each study shot as a drawn board in the scene before modeling, so the camera is locked first. Blender 5 extension. |
| 18 | [visioncortex/vtracer](https://github.com/visioncortex/vtracer) | Rust raster-to-SVG tracer for color and BW images with presets, palette locking and spline fitting; CLI, Node and web | MIT | 2026-10-09 | 7,250 | Trace Grease Pencil or Krita line frames to SVG for crisp ink overlays that scale on any screen, and lock --palette to the TC LA pool palette. MIT, binary for macOS. |
| 19 | [patriciogonzalezvivo/lygia](https://github.com/patriciogonzalezvivo/lygia) | The largest granular shader library (GLSL, HLSL, Metal, WGSL): filter/kuwahara, color/dither, morphological/jumpFlood, sdf, noise, draw/stroke | custom | 2026-09-14 | 3,457 | Include individual functions into the field shader (kuwahara, bayer and blue-noise dither, jump-flood outlines, SDF shapes for morph targets). License warning: Prosperity 3.0 is noncommercial with a 30-day commercial trial; commercial use needs the Patron license (sponsor or contributor). |
| 20 | [EatTheFuture/camera_shakify](https://github.com/EatTheFuture/camera_shakify) | Realistic captured camera-shake data applied to Blender cameras | custom | 2026-02-07 | 1,271 | Handheld life on the TC camera moves and study shots without hand-keying noise; needs Blender 4.4+. Code GPL-3.0, shake data CC0. |
| 21 | [ranjian0/building_tools](https://github.com/ranjian0/building_tools) | Fast procedural building modeling add-on: floors, windows, doors, balconies, stairs, roofs | MIT | 2025-05-16 | 1,509 | Hero buildings for close shots where OSM blocks are too crude; California-modernism facades for the opening-night and climb shots. |
| 22 | [pmndrs/postprocessing](https://github.com/pmndrs/postprocessing) | The standard three.js effect composer: merges effects into few passes; ships Outline, DotScreen, ChromaticAberration, LUT3D, Noise, ASCII, Pixelation | Zlib | 2026-09-09 | 2,874 | If the site ever moves the field or shots into three.js, this is the pass chain for halftone, outline and LUT grading. Custom Kuwahara and misregistration passes slot in as Effect subclasses. |
| 23 | [gkjohnson/three-edge-projection](https://github.com/gkjohnson/three-edge-projection) | Visible-edge projection and silhouette extraction from three.js meshes via three-mesh-bvh, with WebGPU and worker paths | MIT | 2026-09-30 | 350 | Generate clean, visibility-correct line drawings of LA geometry (buildings, the skyline prisms) as flat line segments to ink over renders or the field. |
| 24 | [carolineec/informative-drawings](https://github.com/carolineec/informative-drawings) | Learned line drawings from photos that convey geometry and semantics (CVPR 2022) | MIT | 2024-09-01 | 452 | Pull illustrator-style contour lines out of rendered frames or LA reference photos as a line layer to composite; test.py defaults to CUDA, CPU needs a flag change. |
| 25 | [Doubiiu/ToonCrafter](https://github.com/Doubiiu/ToonCrafter) | SIGGRAPH Asia 2024 generative cartoon interpolation between two keyframes, with sketch guidance | Apache-2.0 | 2025-03-19 | 6,032 | Prototype the morph between two shot end frames (the "shots morph, they don't cut" rule) before committing to a hand-built transition. Needs about 10 to 24 GB VRAM, so it runs on RunPod, not this Mac. |### What the code read turned up

- **paper-design/shaders** `packages/shaders/src/shaders/halftone-cmyk.ts` is a
  `#version 300 es` fragment shader in a string, with C, M, Y and K ink colors,
  dot size, softness, grain and grid noise as uniforms. It has no per-plate
  offset, so misregistration still needs a few lines (shift each plate's UV).
- **spite/sketch** `post-cmyk-halftone-i/post.js` rotates a dot grid per
  channel, adapted from libretro's `cmyk-halftone-dot.glsl`, and samples a
  paper texture: a second, MIT-licensed take on the same pass.
- **GarrettGunnell/Post-Processing** `AnisotropicKuwahara.shader` is four
  passes (structure tensor, two separable blurs, the filter) with `_KernelSize`,
  `_Hardness`, `_Q`, `_Alpha`, `_ZeroCrossing` as the controls. `ExtendedDoG`
  sits next to it for the ink line.
- **lygia** has `filter/kuwahara`, `color/dither/{bayer,blueNoise}`,
  `morphological/jumpFlood` and a full `sdf/` set in GLSL and WGSL, all
  include-by-file. The license is the catch (above).
- **Malt** keeps its line pass in `Malt/Shaders/Filters/Line.glsl` and
  `Passes/LineComposite.glsl`, inside an NPR pipeline, MIT.
- **mediabunny** `src/media-sink.ts` exposes `CanvasSink.getCanvas(timestamp)`
  and `VideoSampleSink.getSample(timestamp)`; **scrolly-video** decodes the
  whole MP4 to frames up front with the w3c WebCodecs sample demuxer, so its
  memory grows with frame count.
- **fsv** documents its encoder table (crf 20, preset slower, tune fastdecode,
  gop 5, 0 B-frames, 1 ref, yuv420p) next to the Renderer, which is the
  comparison point for `encode_film.sh`.
- **ogl** ships `GPGPU.js`, `Post.js`, `Polyline.js` and `InstancedMesh.js` in
  `src/extras`, Unlicense: the nearest fit to the hand-written engine.
- **Krbn** has zero runtime dependencies and a staged pipeline in `src/pipeline`
  (feature-curve, visibility, hatch, wobble, width) ending in an SVG backend.
- **BlenderLayer** talks between Blender and Krita over a local TCP socket plus
  `multiprocessing.shared_memory`, with PyQt5 on the Krita side.
- **blosm** keeps source on the `release` branch, GPL-3.0, with building
  grammars (`pml/`, `grammar/`) for restyling OSM buildings.
- **ebsynth** builds on macOS with `build-macos-cpu_only.sh` (one clang line);
  **ReEzSynth** requires an NVIDIA GPU and CUDA toolkit.
- **ToonCrafter** needs about 24 GB VRAM as shipped (community forks report
  about 10 GB). **informative-drawings** `test.py` defaults `--cuda` to true.

## Full catalog by category

### Blender: NPR, toon shading, line art, materials (15)

| Rank | Repo | What it does | License | Last commit | Stars | Where it plugs in |
|---:|---|---|---|---|---:|---|
| 4 | [bnpr/Malt](https://github.com/bnpr/Malt) | Fully customizable real-time NPR render engine for Blender, GLSL-first, with a line pass and NPR pipeline | custom | 2026-03-29 | 1,138 | Render engine for the Spider-Verse study and the TC shots: hand-authored line widths (Filters/Line.glsl, Passes/LineComposite.glsl), halftone in light and hatching in shadow written as GLSL instead of node spaghetti. Manifest targets Blender 5.1; local Blender is 5.2. |
| 5 | [MoStyle/SMEAR](https://github.com/MoStyle/SMEAR) | SIGGRAPH 2024 Blender add-on (Basset, Benard, Barla) that bakes smear frames: elongated in-betweens, multiple in-betweens and motion lines via Geometry Nodes | custom | 2025-11-20 | 70 | The Spider-Verse study's fast actions (the skill's Motion without blur section): bake smears on the twos instead of motion blur. Also on TC shots where an object whips across frame. Blender 4.2+, updated for 5.0. |
| 35 | [JacquesLucke/animation_nodes](https://github.com/JacquesLucke/animation_nodes) | Node-based visual scripting for motion graphics in Blender | custom | 2026-07-07 | 2,384 | Procedural stepping (hold every 2 frames) and offset animation for many objects at once. |
| 81 | [ucupumar/ucupaint](https://github.com/ucupumar/ucupaint) | Texture layer manager for Eevee and Cycles | GPL-3.0 | 2026-10-07 | 2,251 | Layered painted textures on study models. |
| 90 | [dillongoostudios/goo-engine](https://github.com/dillongoostudios/goo-engine) | Blender fork with extra Eevee NPR shader nodes and light groups | custom | 2024-10-15 | 1,444 | Option for shader-to-RGB style control Eevee lacks; last pushed 2024, behind current Blender. |
| 97 | [festivities/Blender-miHoYo-Shaders](https://github.com/festivities/Blender-miHoYo-Shaders) (archived) | Genshin-style toon shaders for Blender and Goo Engine | GPL-3.0 | 2024-05-24 | 1,138 | Reference node setups for ramp shading, rim and face shadows. Archived. |
| 141 | [lvoxx/LSCherry](https://github.com/lvoxx/LSCherry) | Toon shader framework for Blender, evolved from aVersionOfReality's shader | GPL-3.0 | 2026-09-17 | 89 | Alternative toon material set for characters in the study. |
| 146 | [EmuMan/npr-face-shader](https://github.com/EmuMan/npr-face-shader) | Grease Pencil driven custom face shadow shapes for NPR characters | GPL-3.0 | 2026-07-20 | 62 | Art-directed face shadows on study characters. |
| 151 | [zippy731/vamp](https://github.com/zippy731/vamp) | Mesh-space hidden-line removal and silhouettes, Freestyle-like but live in the viewport | GPL-3.0 | 2026-09-09 | 43 | Line art that updates per frame in the viewport for quick line checks. |
| 238 | [festivities/Blender-StellarToon](https://github.com/festivities/Blender-StellarToon) | Honkai Star Rail toon shader for Goo Engine | GPL-3.0 | 2024-03-03 | 300 | Reference only; Goo Engine-specific. |
| 265 | [kanzwataru/EEVEEToon](https://github.com/kanzwataru/EEVEEToon) | NPR nodes and sample shaders for Eevee 2.8 | MIT | 2021-06-10 | 69 | Old reference node groups. |
| 267 | [bnpr/BEER](https://github.com/bnpr/BEER) | Planned layer-stack NPR UI on top of Malt | MIT | 2021-11-23 | 64 | Watch only, last commit 2021. |
| 269 | [folkertdev/freestyle-svg-exporter](https://github.com/folkertdev/freestyle-svg-exporter) | Export Freestyle lines to SVG | none | 2016-04-11 | 61 | Vector ink lines per frame from Blender; older. |
| 281 | [FelineEntity/Outline-Helper](https://github.com/FelineEntity/Outline-Helper) | Blender outline helper add-on | MIT | 2025-05-10 | 43 | Inverted-hull outlines; the README is one line, so read the code first. |
| 283 | [yuki-koyama/btoon](https://github.com/yuki-koyama/btoon) | Simple Eevee toon skin material add-on | GPL-3.0 | 2020-06-21 | 29 | Small reference. |

### Blender: Grease Pencil (7)

| Rank | Repo | What it does | License | Last commit | Stars | Where it plugs in |
|---:|---|---|---|---|---:|---|
| 8 | [chsh2/nijiGPen](https://github.com/chsh2/nijiGPen) | Grease Pencil add-on: 2D boolean and offset, stroke cleanup, mesh and shading from 2D shapes, data exchange with other paint tools | GPL-3.0 | 2026-08-17 | 380 | Ink-line cleanup and fill generation on the Grease Pencil line layers of every shot; its mesh-from-strokes turns hand-drawn shapes (onomatopoeia, panels) into 3D props. Supports GP3 on Blender 4.3 to 5.2. |
| 44 | [Pullusb/greasepencil_tools](https://github.com/Pullusb/greasepencil_tools) | Extra Grease Pencil tools: box deform, line extension, rotate canvas, timeline scrub | GPL-3.0 | 2026-08-01 | 54 | Daily driver for drawing line layers on shots; was bundled with Blender 2.91 to 4.1, now an extension. |
| 45 | [Pullusb/GP_refine_strokes](https://github.com/Pullusb/GP_refine_strokes) | Grease Pencil post-drawing stroke adjustments: thickness, trim, resample, pressure | GPL-3.0 | 2026-02-01 | 20 | Taper and clean ink strokes so line weight varies like a brush pen. |
| 272 | [doakey3/GreaseWriter](https://github.com/doakey3/GreaseWriter) | Auto-animate Grease Pencil strokes as handwriting | GPL-3.0 | 2019-07-23 | 56 | Animated hand-lettered captions or SFX writing on. |
| 274 | [Pullusb/viewport_timeline_scrub](https://github.com/Pullusb/viewport_timeline_scrub) | Scrub timeline from the viewport (folded into GP tools) | GPL-3.0 | 2024-01-25 | 51 | Use greasepencil_tools instead. |
| 275 | [folkertdev/freestyle-gpencil-exporter](https://github.com/folkertdev/freestyle-gpencil-exporter) | Convert Freestyle strokes to Grease Pencil | none | 2018-03-23 | 50 | Turn computed lines into editable GP strokes; old. |
| 315 | [Pullusb/GP_brush_fill](https://github.com/Pullusb/GP_brush_fill) | Experimental 2D pixel-style fill brush for GP | none | 2021-01-27 | 34 | Experimental; skip. |

### Blender: procedural cities, buildings, crowds, volumes, simulation (17)

| Rank | Repo | What it does | License | Last commit | Stars | Where it plugs in |
|---:|---|---|---|---|---:|---|
| 9 | [vvoovv/blosm](https://github.com/vvoovv/blosm) | Blender add-on (formerly blender-osm) that imports OpenStreetMap, Google 3D cities and terrain | none | 2025-10-30 | 2,129 | Real LA streets, Mulholland, the canyon and the basin as geometry for the film's mulholland, map and canyon shots in FILM.stages, then restyled NPR. Base version GPL-3.0, source on branch release. |
| 21 | [ranjian0/building_tools](https://github.com/ranjian0/building_tools) | Fast procedural building modeling add-on: floors, windows, doors, balconies, stairs, roofs | MIT | 2025-05-16 | 1,509 | Hero buildings for close shots where OSM blocks are too crude; California-modernism facades for the opening-night and climb shots. |
| 32 | [princeton-vl/infinigen](https://github.com/princeton-vl/infinigen) | Procedural photoreal worlds and indoor scenes generated in Blender | BSD-3-Clause | 2026-10-08 | 7,312 | Background terrain, vegetation and interiors when blosm geometry needs filler; heavy, Linux-first. |
| 57 | [domlysz/BlenderGIS](https://github.com/domlysz/BlenderGIS) | GIS bridge: shapefiles, DEMs, OSM into Blender | GPL-3.0 | 2025-12-20 | 9,458 | Terrain for the canyon and basin shots. |
| 75 | [nortikin/sverchok](https://github.com/nortikin/sverchok) | Parametric node system for Blender | GPL-3.0 | 2026-10-07 | 2,528 | Generative props and pattern geometry. |
| 83 | [rlguy/Blender-FLIP-Fluids](https://github.com/rlguy/Blender-FLIP-Fluids) | FLIP liquid simulation add-on | GPL-3.0 | 2026-08-24 | 1,960 | The pool water for the pool-light close. |
| 194 | [Kiri-Innovation/3dgs-render-blender-addon](https://github.com/Kiri-Innovation/3dgs-render-blender-addon) | Import, edit and render Gaussian splats in Blender | GPL-2.0 | 2026-09-20 | 1,225 | Capture a real LA location as splats and stylize it. |
| 196 | [aachman98/Sorcar](https://github.com/aachman98/Sorcar) | Houdini-style procedural modeling nodes for Blender (2021) | GPL-3.0 | 2021-01-17 | 1,184 | Stale. |
| 202 | [friggog/tree-gen](https://github.com/friggog/tree-gen) | Procedural trees | GPL-3.0 | 2025-07-11 | 954 | Palms and street trees for LA shots. |
| 214 | [josauder/procedural_city_generation](https://github.com/josauder/procedural_city_generation) | Procedural city road and building generator visualized in Blender | MPL-2.0 | 2016-10-30 | 596 | Fictional city blocks; stale. |
| 226 | [OmooLab/BioxelNodes](https://github.com/OmooLab/BioxelNodes) | Volumetric data visualization with Geometry Nodes | GPL-3.0 | 2026-08-15 | 380 | Volume shading patterns for haze; Blender 5+. |
| 254 | [johnroper100/CrowdMaster](https://github.com/johnroper100/CrowdMaster) | Node-based crowd simulation for Blender (2017) | GPL-3.0 | 2017-09-06 | 136 | Crowd for opening night; stale. |
| 259 | [Tams3d/T3D-GN-Presets](https://github.com/Tams3d/T3D-GN-Presets) | Geometry Nodes utility groups | GPL-3.0 | 2025-07-16 | 115 | Deformers and fields for stylized motion. |
| 261 | [InteractiveComputerGraphics/blender-sequence-loader](https://github.com/InteractiveComputerGraphics/blender-sequence-loader) | Just-in-time loading of mesh and point-cloud sequences | MIT | 2026-01-07 | 94 | Load baked point-cloud morphs as sequences. |
| 286 | [a1studmuffin/SpaceshipGenerator](https://github.com/a1studmuffin/SpaceshipGenerator) | Procedural spaceship meshes | custom | 2020-12-23 | 7,834 | Off-target. |
| 314 | [lsimic/ProceduralBuildingGenerator](https://github.com/lsimic/ProceduralBuildingGenerator) | Thesis procedural building add-on | GPL-3.0 | 2019-06-07 | 41 | Stale. |
| 316 | [jaelpark/droplet-render](https://github.com/jaelpark/droplet-render) | Volumetric cloud modeling and rendering (2017) | BSD-3-Clause | 2017-09-09 | 31 | Old; skip. |

### Blender: cameras, shots, rigs, render pipeline (11)

| Rank | Repo | What it does | License | Last commit | Stars | Where it plugs in |
|---:|---|---|---|---|---:|---|
| 16 | [p2or/blender-loom](https://github.com/p2or/blender-loom) | Blender add-on for rendering image sequences and specific frames, batch rendering, ffmpeg encoding to ProRes and more | none | 2026-04-29 | 228 | The render-to-encode step: render the frame ranges in FILM.stages, re-render only broken frames, encode a ProRes master before scripts/encode-films.sh makes the web cut. |
| 17 | [Pullusb/storytools](https://github.com/Pullusb/storytools) | Storyboarding toolset for Blender: camera, object and Grease Pencil gizmos for drawing boards inside the 3D scene | GPL-3.0 | 2026-08-07 | 125 | Block every shot in docs/SHOTS-tc.md and each study shot as a drawn board in the scene before modeling, so the camera is locked first. Blender 5 extension. |
| 20 | [EatTheFuture/camera_shakify](https://github.com/EatTheFuture/camera_shakify) | Realistic captured camera-shake data applied to Blender cameras | custom | 2026-02-07 | 1,271 | Handheld life on the TC camera moves and study shots without hand-keying noise; needs Blender 4.4+. Code GPL-3.0, shake data CC0. |
| 101 | [shteeve3d/blender-wiggle-2](https://github.com/shteeve3d/blender-wiggle-2) | Jiggle-bone physics rewrite for Blender | GPL-3.0 | 2024-04-18 | 1,023 | Secondary motion on hair or cloth before stepping to twos. |
| 131 | [ubisoft/shotmanager](https://github.com/ubisoft/shotmanager) | Ubisoft Animation Studio's shot entity and sequence editing in Blender | GPL-3.0 | 2023-02-27 | 217 | Manage the six film shots as real shots in one scene; maintenance-only on LTS. |
| 152 | [waylow/add_camera_rigs](https://github.com/waylow/add_camera_rigs) | Dolly, crane and 2D camera rigs with widgets and lens breathing | none | 2026-10-02 | 40 | Rigged camera moves for each shot. |
| 207 | [aresdevo/animaide](https://github.com/aresdevo/animaide) | Animation curve tools add-on (no longer developed) | none | 2025-04-01 | 793 | Curve cleanup; abandoned. |
| 282 | [Pullusb/curveRig](https://github.com/Pullusb/curveRig) | Rig a curve to an armature in one click | GPL-3.0 | 2023-11-16 | 33 | Rig camera paths or ribbon props. |
| 284 | [Pullusb/breakdowner](https://github.com/Pullusb/breakdowner) | Breakdown shortcut in object mode | GPL-3.0 | 2025-12-04 | 6 | Faster pose breakdowns when animating on twos. |
| 309 | [abrasic/abratools](https://github.com/abrasic/abratools) (archived) | Animation QoL toolset (archived) | GPL-3.0 | 2025-11-19 | 165 | Archived; skip. |
| 311 | [JacquesLucke/Blender-Camera-Addon](https://github.com/JacquesLucke/Blender-Camera-Addon) | Camera animations for motion graphics (no README) | none | 2020-12-31 | 86 | Old; skip. |

### Blender: MCP and automation (7)

| Rank | Repo | What it does | License | Last commit | Stars | Where it plugs in |
|---:|---|---|---|---|---:|---|
| 27 | [ahujasid/mcp-for-blender](https://github.com/ahujasid/mcp-for-blender) | Community MCP server for driving Blender from any LLM (formerly blender-mcp) | MIT | 2026-10-06 | 30,324 | Automating scene setup from Claude; Nalana and the Blender Lab MCP already cover this here, so this is the fallback. MIT. |
| 34 | [DLR-RM/BlenderProc](https://github.com/DLR-RM/BlenderProc) | Procedural Blender pipeline in Python for scripted scene loading, cameras and rendering | GPL-3.0 | 2026-01-07 | 3,735 | Pattern for scripting the shot render pipeline end to end (camera paths from file, per-frame passes like depth and normal for ink lines). |
| 43 | [bpy-dev/blender-mcp](https://github.com/bpy-dev/blender-mcp) | Enhanced distribution of the official Blender Lab MCP: headless and saved-file execution, API lookup, benchmark tooling | GPL-3.0 | 2026-09-12 | 98 | Headless batch jobs over .blend files (bake, render ranges) from an agent without a live Blender window. |
| 113 | [JacquesLucke/blender_vscode](https://github.com/JacquesLucke/blender_vscode) | VS Code extension for Blender add-on development and debugging | MIT | 2026-07-10 | 742 | Write and debug any custom shot-pipeline add-on. |
| 241 | [arjun988/blender-skills](https://github.com/arjun988/blender-skills) | 94 Blender agent skills over MCP | MIT | 2026-07-10 | 279 | Mine for prompts; marketplace listing unverified. |
| 252 | [HoldMyBeer-gg/blenderwright](https://github.com/HoldMyBeer-gg/blenderwright) | MCP server for Blender with 191 tools | MIT | 2026-10-08 | 168 | Alternative agent bridge. |
| 277 | [dcc-mcp/dcc-mcp-blender](https://github.com/dcc-mcp/dcc-mcp-blender) | Typed Blender MCP adapter in the DCC-MCP ecosystem | MIT | 2026-10-09 | 45 | Alternative agent bridge. |

### Web: NPR shaders and shader libraries (30)

| Rank | Repo | What it does | License | Last commit | Stars | Where it plugs in |
|---:|---|---|---|---|---:|---|
| 1 | [paper-design/shaders](https://github.com/paper-design/shaders) | Zero-dependency WebGL2 shaders as plain GLSL strings, including halftone-cmyk, halftone-dots, dithering, paper-texture and grain | Apache-2.0 | 2026-09-17 | 3,576 | Lift the halftone-cmyk fragment shader straight into components/field (raw WebGL2, no three.js) and sample the Film.tsx video frame as u_image: per-ink C/M/Y/K colors, dot size, grain and grid noise are already uniforms. Apache-2.0, so it ships commercially. |
| 7 | [OmarShehata/webgl-outlines](https://github.com/OmarShehata/webgl-outlines) | Post-process ink outlines from depth, normal and per-surface ID buffers, in three.js and PlayCanvas, with the two articles that explain it | MIT | 2022-12-09 | 417 | The ink-line pass for any live 3D on the site; the surface-ID trick draws lines at material borders and creases only, which is the skill's "lines only where an illustrator would draw them" rule, not edge-detect everywhere. |
| 13 | [spite/sketch](https://github.com/spite/sketch) | Inktober 2020 WebGL2 experiments: cross-hatching, engraving, CMYK halftone, scribble, cartoon and technical post passes | MIT | 2026-08-02 | 327 | Reference implementations for hatching-in-shadow and the post-cmyk-halftone-i pass (per-channel rotated dot grids from libretro's cmyk-halftone-dot) to port into the field shader. MIT. |
| 15 | [vpalos/Krbn](https://github.com/vpalos/Krbn) | Zero-dependency TypeScript engine that renders 3D scenes to SVG pencil drawings: exact silhouettes, hidden-line ghosting, hatching, wobble and width | MIT | 2026-07-25 | 236 | Vector line art for UI-scale moments (section dividers, the map, LA buildings) with hatch and wobble stages already in src/pipeline; output is SVG, so it stays sharp and styleable in CSS. |
| 19 | [patriciogonzalezvivo/lygia](https://github.com/patriciogonzalezvivo/lygia) | The largest granular shader library (GLSL, HLSL, Metal, WGSL): filter/kuwahara, color/dither, morphological/jumpFlood, sdf, noise, draw/stroke | custom | 2026-09-14 | 3,457 | Include individual functions into the field shader (kuwahara, bayer and blue-noise dither, jump-flood outlines, SDF shapes for morph targets). License warning: Prosperity 3.0 is noncommercial with a 30-day commercial trial; commercial use needs the Patron license (sponsor or contributor). |
| 23 | [gkjohnson/three-edge-projection](https://github.com/gkjohnson/three-edge-projection) | Visible-edge projection and silhouette extraction from three.js meshes via three-mesh-bvh, with WebGPU and worker paths | MIT | 2026-09-30 | 350 | Generate clean, visibility-correct line drawings of LA geometry (buildings, the skyline prisms) as flat line segments to ink over renders or the field. |
| 38 | [fand/vfx-js](https://github.com/fand/vfx-js) | Attach WebGL effects to ordinary DOM elements (img, video, text) with custom shaders and post effects | MIT | 2026-08-11 | 1,150 | Apply the halftone or misregistration shader to a single DOM image or the caption type without a full canvas; has html-in-canvas support. |
| 62 | [patriciogonzalezvivo/thebookofshaders](https://github.com/patriciogonzalezvivo/thebookofshaders) | Fragment shader book | custom | 2026-02-28 | 7,043 | Learning reference. |
| 68 | [Auburn/FastNoiseLite](https://github.com/Auburn/FastNoiseLite) | Portable noise library in many languages including GLSL | MIT | 2026-06-21 | 3,529 | Same noise on CPU (engine.ts) and GPU. |
| 91 | [FarazzShaikh/THREE-CustomShaderMaterial](https://github.com/FarazzShaikh/THREE-CustomShaderMaterial) | Extend three.js standard materials with custom shaders | MIT | 2025-10-12 | 1,341 | Toon ramps on PBR materials if three.js comes in. |
| 93 | [dgreenheck/webgpu-claude-skill](https://github.com/dgreenheck/webgpu-claude-skill) | Agent skill for three.js WebGPU and TSL | none | 2026-04-10 | 1,234 | Install-free reference for TSL post passes. |
| 117 | [stegu/webgl-noise](https://github.com/stegu/webgl-noise) | Classic GLSL simplex, Perlin and Worley noise | MIT | 2025-04-27 | 594 | Boil and wobble noise for lines. |
| 132 | [mattdesl/glsl-film-grain](https://github.com/mattdesl/glsl-film-grain) | Natural film grain from 3D noise | MIT | 2016-03-11 | 210 | Paper grain under the halftone. |
| 138 | [verekia/tslfx](https://github.com/verekia/tslfx) | VFX shaders, utils and SDFs for three.js TSL | MIT | 2026-05-13 | 113 | WebGPU-era effects library. |
| 142 | [sahilsaini5/ditherwave](https://github.com/sahilsaini5/ditherwave) | WebGL2 React dither primitive: Bayer, halftone, ASCII, error diffusion | MIT | 2026-04-26 | 85 | Drop-in halftone wrapper on any image or video. |
| 148 | [glslify/glsl-halftone](https://github.com/glslify/glsl-halftone) | Gustavson halftone in GLSL | MIT | 2015-04-06 | 51 | Minimal anti-aliased dot function. |
| 158 | [lettier/3d-game-shaders-for-beginners](https://github.com/lettier/3d-game-shaders-for-beginners) | Shading technique guide incl. cel and outlines | none | 2021-08-29 | 19,939 | Learning reference. |
| 163 | [DavidHDev/canvas-ui](https://github.com/DavidHDev/canvas-ui) | Canvas WebGL effects over live DOM | custom | 2026-10-03 | 4,781 | Effect patterns over DOM. |
| 175 | [bradley/Blotter](https://github.com/bradley/Blotter) | GLSL text effects | custom | 2019-07-08 | 3,081 | Misregistered display type. |
| 180 | [glslify/glslify](https://github.com/glslify/glslify) | Node-style module system for GLSL | custom | 2020-09-02 | 2,288 | Import shader modules; stale. |
| 199 | [electricsquare/raymarching-workshop](https://github.com/electricsquare/raymarching-workshop) | Raymarching course | MIT | 2021-08-20 | 1,010 | SDF morph background. |
| 205 | [shader-park/shader-park-core](https://github.com/shader-park/shader-park-core) | JS to SDF shaders | MIT | 2024-05-28 | 825 | SDF morph sketches. |
| 215 | [mmmerl/shader-doodle](https://github.com/mmmerl/shader-doodle) | Web component for shaders | MIT | 2026-09-15 | 588 | Quick shader prototypes. |
| 223 | [UstymUkhman/vite-plugin-glsl](https://github.com/UstymUkhman/vite-plugin-glsl) | Import GLSL and WGSL files in Vite | MIT | 2026-10-04 | 426 | Only if the site moves off Next's bundler. |
| 242 | [openshaders/openshaders](https://github.com/openshaders/openshaders) | Open shader gallery project | MIT | 2026-09-09 | 264 | Browse for effects. |
| 245 | [hughsk/glsl-dither](https://github.com/hughsk/glsl-dither) | Bayer dithering in GLSL | custom | 2014-06-08 | 225 | Print-like tonal steps. |
| 262 | [mayacoda/toon-shader](https://github.com/mayacoda/toon-shader) | Three.js toon shader after Roystan | MIT | 2023-04-20 | 84 | Small reference. |
| 278 | [SkyeShark/threejs-silhouette-pom](https://github.com/SkyeShark/threejs-silhouette-pom) | Silhouette parallax occlusion mapping in TSL | MIT | 2026-07-25 | 45 | Relief on cheap geometry. |
| 287 | [ruucm/shadergradient](https://github.com/ruucm/shadergradient) | Moving mesh gradients | none | 2026-09-23 | 2,778 | Off-style. |
| 290 | [codrops/RainEffect](https://github.com/codrops/RainEffect) | WebGL rain and drops (2017) | none | 2017-02-11 | 1,783 | Off-target. |

### Web: post-processing stacks and painterly filters (12)

| Rank | Repo | What it does | License | Last commit | Stars | Where it plugs in |
|---:|---|---|---|---|---:|---|
| 6 | [GarrettGunnell/Post-Processing](https://github.com/GarrettGunnell/Post-Processing) | Acerola's Unity post stack: basic, generalized and anisotropic Kuwahara, extended difference-of-Gaussians, halftone, and more, as HLSL | MIT | 2024-06-30 | 827 | The painterly pass: AnisotropicKuwahara.shader is four passes (structure tensor, two blurs, filter) that port to GLSL for the web, and ExtendedDoG.shader gives the ink line. Also a reference for the Blender compositor's built-in Kuwahara node settings. |
| 22 | [pmndrs/postprocessing](https://github.com/pmndrs/postprocessing) | The standard three.js effect composer: merges effects into few passes; ships Outline, DotScreen, ChromaticAberration, LUT3D, Noise, ASCII, Pixelation | Zlib | 2026-09-09 | 2,874 | If the site ever moves the field or shots into three.js, this is the pass chain for halftone, outline and LUT grading. Custom Kuwahara and misregistration passes slot in as Effect subclasses. |
| 37 | [GarrettGunnell/AcerolaFX](https://github.com/GarrettGunnell/AcerolaFX) | Acerola's modular HDR post stack for ReShade: Kuwahara, DoG, halftone, palette and more, in HLSL | MIT | 2024-06-29 | 1,276 | Second reference for the painterly and print passes, more complete than the Unity repo. |
| 136 | [yeataro/TD-Anisotropic-Kuwahara](https://github.com/yeataro/TD-Anisotropic-Kuwahara) | Kyprianidis anisotropic Kuwahara in TouchDesigner | GPL-3.0 | 2023-04-16 | 132 | Second port reference for the painterly pass. |
| 139 | [gkjohnson/three-jumpflood-demo](https://github.com/gkjohnson/three-jumpflood-demo) | Jump-flood outlines and glow in three.js | MIT | 2025-12-03 | 111 | Even-width outlines of selected objects at any width. |
| 191 | [pmndrs/react-postprocessing](https://github.com/pmndrs/react-postprocessing) | React wrapper for postprocessing | MIT | 2026-10-09 | 1,396 | If R3F is adopted. |
| 197 | [pixijs/filters](https://github.com/pixijs/filters) | Community filters for PixiJS | MIT | 2025-11-29 | 1,138 | 2D-only alternative. |
| 218 | [N8python/n8ao](https://github.com/N8python/n8ao) | Stable SSAO for three.js | CC0-1.0 | 2026-08-10 | 499 | Contact shadows if live 3D arrives. |
| 243 | [Ameobea/three-good-godrays](https://github.com/Ameobea/three-good-godrays) | Screen-space godrays for pmndrs postprocessing | custom | 2026-08-06 | 235 | Haze beams for dusk shots. |
| 246 | [ektogamat/r3f-webgpu-starter](https://github.com/ektogamat/r3f-webgpu-starter) | Minimal R3F plus three.js WebGPU post-processing starter | none | 2025-06-24 | 221 | WebGPU post chain reference if R3F is adopted. |
| 268 | [cl0nazepamm/powershot-threejs](https://github.com/cl0nazepamm/powershot-threejs) | Digicam, tape, film emulation for three.js WebGPU | MIT | 2026-09-24 | 63 | Analog grade reference. |
| 299 | [spite/Wagner](https://github.com/spite/Wagner) | Old three.js effects composer | custom | 2016-02-29 | 1,086 | Superseded. |

### Web: GPU particles and point-cloud morphing (7)

| Rank | Repo | What it does | License | Last commit | Stars | Where it plugs in |
|---:|---|---|---|---|---:|---|
| 40 | [MisterPrada/morph-particles](https://github.com/MisterPrada/morph-particles) | Template: models to particles to morph with smooth scroll | none | 2025-05-16 | 284 | The exact pattern of the field: morph between model point clouds on scroll. |
| 89 | [amandaghassaei/gpu-io](https://github.com/amandaghassaei/gpu-io) | WebGL GPGPU library for simulations | MIT | 2024-01-31 | 1,487 | Run the point morph and flow fields on GPU. |
| 99 | [Alchemist0823/three.quarks](https://github.com/Alchemist0823/three.quarks) | three.js particle and VFX engine with editor | MIT | 2026-05-21 | 1,046 | Dust, sparks, Kirby crackle. |
| 126 | [vaneenige/THREE.Phenomenon](https://github.com/vaneenige/THREE.Phenomenon) | Instanced-geometry wrapper for shader-driven transitions | MIT | 2019-05-21 | 361 | Shader-side morphs of thousands of instances. |
| 135 | [mustache-dev/Three-VFX](https://github.com/mustache-dev/Three-VFX) | GPU compute particles for three.js WebGPU | MIT | 2026-02-24 | 146 | WebGPU particles. |
| 193 | [creativelifeform/three-nebula](https://github.com/creativelifeform/three-nebula) | JSON-defined three.js particle systems | MIT | 2026-09-30 | 1,232 | Alternative particles. |
| 258 | [cullenwebber/three-ml-sharp](https://github.com/cullenwebber/three-ml-sharp) | Image to Apple ML SHARP point cloud to GPGPU particles (no README) | none | 2026-02-18 | 123 | Photo to points for a field formation. |

### Web: WebGL and WebGPU engines and tooling (22)

| Rank | Repo | What it does | License | Last commit | Stars | Where it plugs in |
|---:|---|---|---|---|---:|---|
| 11 | [oframe/ogl](https://github.com/oframe/ogl) | Minimal zero-dependency WebGL library with GPGPU, Post, Polyline, InstancedMesh and Flowmap extras | none | 2025-04-13 | 4,668 | Closest match to the hand-rolled engine.ts: its GPGPU.js moves the point morph between formations off the CPU, and Post.js chains the halftone and Kuwahara passes without adopting three.js. Unlicense. |
| 26 | [mrdoob/three.js](https://github.com/mrdoob/three.js) | The 3D library | MIT | 2026-10-09 | 116,179 | Engine if the site leaves raw WebGL. |
| 49 | [pmndrs/react-three-fiber](https://github.com/pmndrs/react-three-fiber) | React renderer for three.js | MIT | 2026-10-02 | 32,819 | React path. |
| 56 | [pmndrs/drei](https://github.com/pmndrs/drei) | R3F helpers including ScrollControls | MIT | 2026-09-30 | 9,915 | React scroll scenes. |
| 63 | [regl-project/regl](https://github.com/regl-project/regl) | Functional WebGL | MIT | 2026-06-22 | 5,587 | Cleaner state handling for engine.ts. |
| 66 | [cocopon/tweakpane](https://github.com/cocopon/tweakpane) | Dependency-free parameter GUI | MIT | 2026-03-15 | 4,602 | Tune field and halftone uniforms without React. |
| 69 | [gkjohnson/three-mesh-bvh](https://github.com/gkjohnson/three-mesh-bvh) | BVH for fast raycast and spatial queries | MIT | 2026-10-08 | 3,506 | Powers three-edge-projection. |
| 72 | [software-mansion/TypeGPU](https://github.com/software-mansion/TypeGPU) | Write WebGPU shaders in TypeScript | MIT | 2026-10-09 | 3,260 | Type-safe compute for morphs. |
| 84 | [martinlaxenaire/curtainsjs](https://github.com/martinlaxenaire/curtainsjs) | DOM elements to WebGL planes | MIT | 2025-04-03 | 1,828 | Shader images aligned to layout. |
| 124 | [pmndrs/meshline](https://github.com/pmndrs/meshline) | Billboarded thick lines for three.js | MIT | 2024-06-03 | 381 | Variable-width ink lines in 3D. |
| 162 | [pmndrs/leva](https://github.com/pmndrs/leva) | React GUI for tweaking values | MIT | 2025-11-08 | 6,251 | Tune shader uniforms live. |
| 171 | [thi-ng/umbrella](https://github.com/thi-ng/umbrella) | 215 TS packages; moved to Codeberg | Apache-2.0 | 2026-09-05 | 3,829 | Geometry and color tools. |
| 177 | [gre/gl-react](https://github.com/gre/gl-react) | Compose WebGL shaders as React components | MIT | 2026-09-30 | 3,009 | React shader composition. |
| 178 | [pmndrs/react-three-next](https://github.com/pmndrs/react-three-next) | Next plus R3F starter | MIT | 2024-04-21 | 2,877 | Starter only. |
| 181 | [webgpu/webgpu-samples](https://github.com/webgpu/webgpu-samples) | Official WebGPU samples | BSD-3-Clause | 2026-09-22 | 2,181 | Reference. |
| 184 | [gkjohnson/three-gpu-pathtracer](https://github.com/gkjohnson/three-gpu-pathtracer) | Path tracer for three.js | MIT | 2026-10-08 | 1,900 | Offline stills, off-style. |
| 192 | [pmndrs/math](https://github.com/pmndrs/math) | Allocation-free math engine (formerly maath) | MIT | 2026-09-30 | 1,319 | Easing and damping. |
| 203 | [pmndrs/three-stdlib](https://github.com/pmndrs/three-stdlib) | three examples as ESM package | MIT | 2026-06-26 | 861 | Dependency hygiene. |
| 236 | [MisterPrada/singularity](https://github.com/MisterPrada/singularity) | Black hole in three.js TSL | none | 2026-02-11 | 312 | TSL reference. |
| 249 | [martinlaxenaire/gpu-curtains](https://github.com/martinlaxenaire/gpu-curtains) | WebGPU version of curtains | MIT | 2026-03-24 | 188 | WebGPU path. |
| 295 | [pmndrs/triplex](https://github.com/pmndrs/triplex) | Visual editor for R3F | none | 2026-01-25 | 1,323 | Off-target. |
| 308 | [Fyrestar/THREE.InfiniteGridHelper](https://github.com/Fyrestar/THREE.InfiniteGridHelper) | Infinite grid | MIT | 2022-03-11 | 179 | Off-target. |

### Web: scroll and timeline animation (12)

| Rank | Repo | What it does | License | Last commit | Stars | Where it plugs in |
|---:|---|---|---|---|---:|---|
| 12 | [darkroomengineering/lenis](https://github.com/darkroomengineering/lenis) | Lightweight smooth scroll that exposes a single scroll value for WebGL sync | MIT | 2026-10-01 | 16,319 | Feed lenis.scroll to both Film.tsx time and engine.ts progress N so the film and the field read one eased value; the Glide component's anchor glides can call lenis.scrollTo. The skill says camera and scroll stay smooth while characters step, and this is that smooth half. |
| 28 | [greensock/GSAP](https://github.com/greensock/GSAP) | Animation platform with ScrollTrigger, Flip, MorphSVG, SplitText | none | 2026-04-13 | 28,976 | Pin and scrub sections, morph SVG ink shapes; standard no-charge license, which is not an OSI license, so check it before shipping. |
| 29 | [theatre-js/theatre](https://github.com/theatre-js/theatre) | Motion design editor and sequencer for the web, keyframes on any JS value | Apache-2.0 | 2024-04-11 | 12,735 | Keyframe camera, uniforms and caption timing against one sequence position driven by scroll; the public repo has been quiet since 2024 while 1.0 is developed privately. |
| 46 | [juliangarnier/anime](https://github.com/juliangarnier/anime) | JS animation engine with steps easing | MIT | 2026-08-09 | 73,442 | Stepped easing for on-twos UI. |
| 48 | [motiondivision/motion](https://github.com/motiondivision/motion) | React and JS animation library | MIT | 2026-10-09 | 33,919 | UI motion; keep off characters. |
| 58 | [locomotivemtl/locomotive-scroll](https://github.com/locomotivemtl/locomotive-scroll) | Viewport detection and smooth scroll built on Lenis | MIT | 2026-04-01 | 8,869 | Section reveal hooks. |
| 73 | [nateherkai/scroll-craft](https://github.com/nateherkai/scroll-craft) | Agent skill for scroll-driven sites | MIT | 2026-09-30 | 3,013 | Compare against spiderverse-style before adopting rules. |
| 86 | [basementstudio/scrollytelling](https://github.com/basementstudio/scrollytelling) | React plus GSAP scrollytelling primitives | custom | 2024-02-22 | 1,666 | Timeline per section in React. |
| 103 | [14islands/r3f-scroll-rig](https://github.com/14islands/r3f-scroll-rig) | Sync three.js meshes to DOM with smooth scroll | MIT | 2025-12-17 | 980 | DOM-aligned WebGL images. |
| 201 | [darkroomengineering/satus](https://github.com/darkroomengineering/satus) | Next 16 starter with optional WebGL | MIT | 2026-10-09 | 1,000 | Reference structure. |
| 233 | [codrops/ScrollBasedLayoutAnimations](https://github.com/codrops/ScrollBasedLayoutAnimations) | GSAP ScrollTrigger and Flip layout switches | MIT | 2023-07-20 | 335 | Layout morph ideas. |
| 307 | [codrops/codrops-sketches](https://github.com/codrops/codrops-sketches) | Codrops demo variations | MIT | 2024-02-17 | 204 | Idea mine. |

### Web: video scrub and image-sequence players (13)

| Rank | Repo | What it does | License | Last commit | Stars | Where it plugs in |
|---:|---|---|---|---|---:|---|
| 2 | [Vanilagy/mediabunny](https://github.com/Vanilagy/mediabunny) | Pure TypeScript media toolkit: demux, decode, encode and convert MP4/WebM in the browser over WebCodecs, zero deps | MPL-2.0 | 2026-10-05 | 7,272 | Swap the one-seek-in-flight video.currentTime loop in components/tc/Film.tsx for CanvasSink.getCanvas(timestamp): frames come back exact and decoded to a canvas the halftone shader can sample, and the encode can leave all-intra -g 1 for a smaller file. |
| 3 | [plutotcool/fsv](https://github.com/plutotcool/fsv) | Fast Scrubbing Video: an h264/h265 container tuned for frame-accurate web scrubbing, with optional alpha track and a WebCodecs Renderer class | MIT | 2026-06-30 | 46 | scripts/shots/encode_film.sh encodes film.mp4 all-intra (-g 1) because Film.tsx seeks with video.currentTime. FSV's Renderer decodes over WebCodecs, so its encoder table (gop 5, tune fastdecode, 0 B-frames, 1 ref) can replace -g 1 and cut the file size, and its alpha track lets a rendered character sit over the live WebGL field. |
| 39 | [dkaoster/scrolly-video](https://github.com/dkaoster/scrolly-video) | Scroll-driven video component (vanilla, React, Svelte, Vue) that decodes the MP4 to frames with WebCodecs | MIT | 2025-03-07 | 1,095 | A ready alternative to Film.tsx; note it decodes the whole file up front, so memory grows with frame count. |
| 67 | [spite/ccapture.js](https://github.com/spite/ccapture.js) | Capture canvas animations at fixed framerate with WebCodecs | MIT | 2026-07-27 | 3,773 | Record the live field as a deterministic video for posters or fallback. |
| 76 | [gpac/mp4box.js](https://github.com/gpac/mp4box.js) | MP4 parsing and sample extraction in JS | BSD-3-Clause | 2026-09-23 | 2,472 | Demux for custom WebCodecs scrub. |
| 120 | [KubeezMedia/kubeez-scroll-world-video](https://github.com/KubeezMedia/kubeez-scroll-world-video) | Scroll-scrubbed fly-through demo, one continuous shot | none | 2026-07-14 | 511 | Reference for a no-cut fly-through. |
| 137 | [m5kr1pka/canvas-scroll-clip](https://github.com/m5kr1pka/canvas-scroll-clip) | Scroll image-sequence canvas micro-library | MIT | 2024-12-01 | 117 | Image-sequence fallback for Film.tsx. |
| 239 | [ertdfgcvb/Sequencer](https://github.com/ertdfgcvb/Sequencer) | Fullscreen image-sequence player | MIT | 2023-04-24 | 299 | Fallback player. |
| 253 | [ybouane/VideoFlow](https://github.com/ybouane/VideoFlow) | Programmatic video with scrubbing | Apache-2.0 | 2026-09-16 | 165 | Code-built inserts. |
| 271 | [its2easy/animate-images](https://github.com/its2easy/animate-images) | Image sequence animation plugin | MIT | 2023-07-21 | 60 | Fallback player. |
| 285 | [kerimcharfi/frame-scroll-animation](https://github.com/kerimcharfi/frame-scroll-animation) | Scroll canvas renderer for image sequences and MP4 via VideoDecoder | MIT | 2025-11-21 | 0 | Small VideoDecoder reference; 0 stars. |
| 310 | [ghepting/javascript-video-scrubber](https://github.com/ghepting/javascript-video-scrubber) (archived) | JPEG sequence scrub demo (archived) | none | 2015-09-12 | 98 | Old. |
| 313 | [finnursig/VideoScroller](https://github.com/finnursig/VideoScroller) | Scroll video scrub with easing (2017) | none | 2017-06-26 | 43 | Old. |

### Art: Krita, brushes and painting apps (21)

| Rank | Repo | What it does | License | Last commit | Stars | Where it plugs in |
|---:|---|---|---|---|---:|---|
| 14 | [Yuntokon/BlenderLayer](https://github.com/Yuntokon/BlenderLayer) | Streams Blender's 3D View into Krita as a live layer you can trace and paint over | GPL-3.0 | 2024-10-22 | 391 | Paint-over workflow for the study: frame a shot in Blender, paint the illustrator's lines and shapes in Krita on top, match Spider-Verse key art before rendering. |
| 30 | [Acly/krita-ai-diffusion](https://github.com/Acly/krita-ai-diffusion) | Generative inpaint and outpaint inside Krita with selection and region control | GPL-3.0 | 2026-10-03 | 10,683 | Fast paint-over variations of keyframes in Krita before ebsynth propagation; runs local ComfyUI. |
| 31 | [KDE/krita](https://github.com/KDE/krita) | Open-source digital painting app with animation timeline | GPL-3.0 | 2026-10-09 | 10,509 | The paint-over tool for keyframes and textures; local Krita.app passes Gatekeeper as a notarized Developer ID build. |
| 54 | [lllyasviel/style2paints](https://github.com/lllyasviel/style2paints) | Sketch plus style to colored illustration (SIGGRAPH Asia 2018) | Apache-2.0 | 2023-01-14 | 18,163 | Color study passes over line art; V5 never released. |
| 74 | [mypaint/mypaint](https://github.com/mypaint/mypaint) | Infinite-canvas painting app with a pigment model | GPL-2.0 | 2026-09-13 | 2,986 | Alternative paint-over app; its brushes work in Krita via libmypaint. |
| 104 | [Acly/krita-vision-tools](https://github.com/Acly/krita-vision-tools) | Krita ML selection tools: click or box to mask, background removal | GPL-3.0 | 2026-06-04 | 980 | Mask characters and props on rendered frames for separate halftone treatment. |
| 122 | [Deevad/deevad-krita-brushpresets](https://github.com/Deevad/deevad-krita-brushpresets) | David Revoy's Pepper and Carrot Krita brush kit | none | 2017-04-25 | 419 | Comic-production brush set, the closest free match to a comic inker's kit; last updated 2017. |
| 123 | [mypaint/libmypaint](https://github.com/mypaint/libmypaint) | MyPaint brush engine library used by several painting programs | custom | 2026-04-14 | 385 | Reference for natural-media brush dynamics if a web paint tool is ever built. ISC. |
| 127 | [GDQuest/krita-free-brushes](https://github.com/GDQuest/krita-free-brushes) | Free Krita brush set for concept and illustration work | none | 2017-10-24 | 336 | Starting brush kit for painted textures on shots. |
| 128 | [Rakurri/rakurri-brush-set-for-krita](https://github.com/Rakurri/rakurri-brush-set-for-krita) | Free Krita brush set v2 | none | 2024-07-19 | 283 | Extra textured brushes for painterly fills. |
| 133 | [heisenshark/blender-krita-link-plugin](https://github.com/heisenshark/blender-krita-link-plugin) | Edit Blender textures in Krita without reloading files | GPL-3.0 | 2026-09-08 | 195 | Paint NPR textures on study models live from Krita. |
| 154 | [rogudator/rogudators_speech_bubble_generator](https://github.com/rogudator/rogudators_speech_bubble_generator) | Krita plugin that generates vector speech bubbles | GPL-3.0 | 2023-05-06 | 17 | Bubbles and SFX callouts for the comic devices section of the skill. |
| 155 | [rogudator/rogudators_comic_panel_generator](https://github.com/rogudator/rogudators_comic_panel_generator) | Krita plugin for making comic panels fast | GPL-3.0 | 2026-04-18 | 7 | Lay out comic-panel compositions for study boards and the skill's panels device. |
| 225 | [GDQuest/krita-batch-exporter](https://github.com/GDQuest/krita-batch-exporter) | Batch export Krita layers and groups (bundled since Krita 4.4) | GPL-3.0 | 2022-03-07 | 383 | Export painted layers per shot in one go. |
| 230 | [Falano/kritaSpritesheetManager](https://github.com/Falano/kritaSpritesheetManager) | Export Krita animations as spritesheets | MPL-2.0 | 2023-11-22 | 349 | Ship a hand-drawn loop (an SFX burst) as a single spritesheet texture. |
| 240 | [EyeOdin/Pigment.O](https://github.com/EyeOdin/Pigment.O) | Krita color picker, mixer and sampler with CMYK and RYB channels | GPL-3.0 | 2026-07-02 | 299 | Mix per-universe palettes from the skill's palette table. |
| 263 | [KnowZero/Krita-PythonPluginDeveloperTools](https://github.com/KnowZero/Krita-PythonPluginDeveloperTools) | Tools for writing Krita Python plugins | none | 2026-02-18 | 83 | Needed if a Chewbacca Krita plugin is written. |
| 276 | [thomaslynge/krita-plugins](https://github.com/thomaslynge/krita-plugins) | AnimLayers: animate specific Krita layers by toggling visibility | none | 2018-07-26 | 48 | Quick hand-drawn loop tests in Krita. |
| 279 | [mypaint/mypaint-brushes](https://github.com/mypaint/mypaint-brushes) | Brush presets for libmypaint 2.x | CC0-1.0 | 2021-04-02 | 44 | Brush pack for Krita's MyPaint engine. CC0. |
| 306 | [veryprofessionaldodo/Krita-UI-Redesign](https://github.com/veryprofessionaldodo/Krita-UI-Redesign) | Krita UI overhaul plugin | GPL-3.0 | 2026-08-14 | 244 | Comfort only. |
| 317 | [Grum999/BuliCommander](https://github.com/Grum999/BuliCommander) (archived) | Orthodox file manager plugin for Krita (moved to Codeberg) | GPL-3.0 | 2025-03-12 | 18 | Comfort only; archived on GitHub. |

### Art: style transfer and painterly filters that run locally (20)

| Rank | Repo | What it does | License | Last commit | Stars | Where it plugs in |
|---:|---|---|---|---|---:|---|
| 10 | [jamriska/ebsynth](https://github.com/jamriska/ebsynth) | Example-based synthesis: paint one keyframe, propagate the style across a frame sequence with guide channels | none | 2019-05-10 | 1,682 | Paint over one rendered frame per shot in Krita, then propagate that paint across the Blender sequence before encoding; the painterly look stays hand-made instead of filter-made. macOS has a CPU-only build script. No license file, so treat as all rights reserved. |
| 79 | [hzwer/ICCV2019-LearningToPaint](https://github.com/hzwer/ICCV2019-LearningToPaint) | Learning to paint with RL | MIT | 2025-05-07 | 2,316 | Stroke animation reveals. |
| 87 | [jiupinjia/stylized-neural-painting](https://github.com/jiupinjia/stylized-neural-painting) | Image to stroke parameters (CVPR21) | CC0-1.0 | 2021-08-26 | 1,607 | Stroke-based paint layer. |
| 94 | [naoto0804/pytorch-AdaIN](https://github.com/naoto0804/pytorch-AdaIN) (archived) | Arbitrary style transfer AdaIN (archived) | MIT | 2024-01-23 | 1,180 | Local style test on Apple MPS. |
| 119 | [Huage001/PaintTransformer](https://github.com/Huage001/PaintTransformer) | Feed-forward stroke prediction | Apache-2.0 | 2021-10-20 | 527 | Stroke-based painterly frames. |
| 121 | [crowsonkb/style-transfer-pytorch](https://github.com/crowsonkb/style-transfer-pytorch) | Multi-scale Gatys to print resolution | MIT | 2023-05-21 | 491 | Hi-res key art stylization. |
| 130 | [nkolkin13/NeuralNeighborStyleTransfer](https://github.com/nkolkin13/NeuralNeighborStyleTransfer) | NNST optimization style transfer | MIT | 2022-04-23 | 259 | Higher fidelity painterly test. |
| 143 | [hertzmann/painterJava](https://github.com/hertzmann/painterJava) | Hertzmann 1998 painterly rendering | MIT | 2023-10-06 | 79 | The classic algorithm to port. |
| 150 | [FuouM/ReEzSynth](https://github.com/FuouM/ReEzSynth) | PyTorch CUDA rewrite of ebsynth with temporal stability | MIT | 2025-12-13 | 43 | Better propagation; NVIDIA only, so RunPod. |
| 153 | [yoch/pykuwahara](https://github.com/yoch/pykuwahara) | Kuwahara filter in NumPy and OpenCV | GPL-3.0 | 2026-05-11 | 21 | Offline painterly pass over exported frames before encoding. |
| 159 | [fogleman/primitive](https://github.com/fogleman/primitive) | Image to geometric primitives | MIT | 2020-05-04 | 13,485 | Abstract poster frames. |
| 160 | [lengstrom/fast-style-transfer](https://github.com/lengstrom/fast-style-transfer) | TensorFlow fast style transfer | none | 2021-09-18 | 10,957 | Old baseline. |
| 168 | [bryandlee/animegan2-pytorch](https://github.com/bryandlee/animegan2-pytorch) | AnimeGANv2 | MIT | 2021-11-29 | 4,457 | Off-style. |
| 173 | [williamyang1991/VToonify](https://github.com/williamyang1991/VToonify) | Portrait video toonify | custom | 2023-02-24 | 3,579 | Off-style. |
| 189 | [BrokenSource/DepthFlow](https://github.com/BrokenSource/DepthFlow) | Image to parallax video | AGPL-3.0 | 2026-09-30 | 1,556 | 2.5D moves from stills; AGPL. |
| 200 | [zhanghang1989/PyTorch-Multi-Style-Transfer](https://github.com/zhanghang1989/PyTorch-Multi-Style-Transfer) | MSG-Net | MIT | 2022-05-12 | 1,009 | Baseline. |
| 204 | [ProGamerGov/neural-style-pt](https://github.com/ProGamerGov/neural-style-pt) | Gatys style in PyTorch | MIT | 2022-08-05 | 856 | Baseline. |
| 228 | [rrmina/fast-neural-style-pytorch](https://github.com/rrmina/fast-neural-style-pytorch) | Fast neural style in PyTorch | none | 2020-03-06 | 360 | Baseline. |
| 255 | [Trentonom0r3/Ezsynth](https://github.com/Trentonom0r3/Ezsynth) | Ebsynth as a Python library | AGPL-3.0 | 2024-07-31 | 136 | Scripted propagation. |
| 296 | [s9roll7/ebsynth_utility](https://github.com/s9roll7/ebsynth_utility) | A1111 extension for ebsynth video | none | 2023-10-23 | 1,274 | Off-workflow. |

### Art: line extraction and sketch generation (11)

| Rank | Repo | What it does | License | Last commit | Stars | Where it plugs in |
|---:|---|---|---|---|---:|---|
| 24 | [carolineec/informative-drawings](https://github.com/carolineec/informative-drawings) | Learned line drawings from photos that convey geometry and semantics (CVPR 2022) | MIT | 2024-09-01 | 452 | Pull illustrator-style contour lines out of rendered frames or LA reference photos as a line layer to composite; test.py defaults to CUDA, CPU needs a flag change. |
| 36 | [Mukosame/Anime2Sketch](https://github.com/Mukosame/Anime2Sketch) | Sketch extractor for anime, illustration and manga images | MIT | 2026-09-08 | 2,131 | Turn painted keyframes back into clean line art for the ink layer. |
| 42 | [ljsabc/MangaLineExtraction_PyTorch](https://github.com/ljsabc/MangaLineExtraction_PyTorch) | Deep extraction of structural lines from manga and illustrations | MIT | 2025-01-10 | 199 | Separate structural lines from tone and screentone in comic references for the study. |
| 106 | [yael-vinker/CLIPasso](https://github.com/yael-vinker/CLIPasso) | Abstract object sketches as Bezier curves | custom | 2022-10-03 | 962 | Minimal-stroke icons. |
| 116 | [LingDong-/skeleton-tracing](https://github.com/LingDong-/skeleton-tracing) | Skeleton polylines from binary images | MIT | 2021-03-05 | 604 | Centerline ink strokes from masks. |
| 118 | [SSARCandy/Coherent-Line-Drawing](https://github.com/SSARCandy/Coherent-Line-Drawing) | Kang coherent line drawing from photos | MIT | 2026-07-09 | 571 | Line layer from LA photos. |
| 129 | [MarkMoHR/virtual_sketching](https://github.com/MarkMoHR/virtual_sketching) | Vector line art from rough sketch or photo | Apache-2.0 | 2026-06-02 | 275 | Clean vector lines from roughs. |
| 172 | [vijishmadhavan/ArtLine](https://github.com/vijishmadhavan/ArtLine) | Line art portraits | MIT | 2023-03-03 | 3,633 | Portrait lines. |
| 220 | [lllyasviel/sketchKeras](https://github.com/lllyasviel/sketchKeras) | Sketch from paintings (2017) | Apache-2.0 | 2017-05-04 | 472 | Old. |
| 237 | [ximinng/DiffSketcher](https://github.com/ximinng/DiffSketcher) | Text to vector sketch | MIT | 2025-02-24 | 310 | Research. |
| 248 | [hepesu/LineDistiller](https://github.com/hepesu/LineDistiller) | Line extraction for anime | MIT | 2020-07-31 | 201 | Alternative extractor. |

### Art: vectorization, Inkscape, plotter and procedural drawing (33)

| Rank | Repo | What it does | License | Last commit | Stars | Where it plugs in |
|---:|---|---|---|---|---:|---|
| 18 | [visioncortex/vtracer](https://github.com/visioncortex/vtracer) | Rust raster-to-SVG tracer for color and BW images with presets, palette locking and spline fitting; CLI, Node and web | MIT | 2026-10-09 | 7,250 | Trace Grease Pencil or Krita line frames to SVG for crisp ink overlays that scale on any screen, and lock --palette to the TC LA pool palette. MIT, binary for macOS. |
| 65 | [mattdesl/canvas-sketch](https://github.com/mattdesl/canvas-sketch) | Generative art framework with export | MIT | 2026-05-26 | 5,304 | Export high-res plates and frames. |
| 70 | [fogleman/ln](https://github.com/fogleman/ln) | 3D to vector line art renderer in Go | MIT | 2017-02-23 | 3,456 | Plot LA forms as vectors. |
| 88 | [jankovicsandras/imagetracerjs](https://github.com/jankovicsandras/imagetracerjs) | JS raster tracer | Unlicense | 2023-11-09 | 1,546 | In-browser trace. |
| 92 | [BachiLi/diffvg](https://github.com/BachiLi/diffvg) | Differentiable vector rasterizer | Apache-2.0 | 2024-09-17 | 1,283 | Backbone of LIVE and CLIPasso. |
| 98 | [tomayac/SVGcode](https://github.com/tomayac/SVGcode) | PWA raster to SVG (potrace) | GPL-2.0 | 2026-09-15 | 1,090 | Quick trace app. |
| 102 | [acamposuribe/p5.brush](https://github.com/acamposuribe/p5.brush) | Natural brushes, watercolor fills, hatching for p5.js | MIT | 2026-09-24 | 1,009 | Painted texture plates. |
| 107 | [abey79/vpype](https://github.com/abey79/vpype) | CLI for plotter vector graphics | MIT | 2026-10-07 | 957 | Clean SVG ink layers. |
| 109 | [LingDong-/linedraw](https://github.com/LingDong-/linedraw) | Image to plotter line drawing with hatch | MIT | 2020-02-18 | 865 | Hatched shadow layer. |
| 112 | [autotrace/autotrace](https://github.com/autotrace/autotrace) | Outline and centerline tracing | GPL-2.0 | 2026-09-28 | 742 | Centerline ink. |
| 115 | [Picsart-AI-Research/LIVE-Layerwise-Image-Vectorization](https://github.com/Picsart-AI-Research/LIVE-Layerwise-Image-Vectorization) | Layer-wise image vectorization (CVPR22) | Apache-2.0 | 2024-02-26 | 629 | Layered SVG from key art. |
| 125 | [skyrpex/potrace](https://github.com/skyrpex/potrace) | Potrace mirror | GPL-2.0 | 2021-09-28 | 364 | The reference tracer. |
| 134 | [plottertools/hatched](https://github.com/plottertools/hatched) | Image to hatched patterns | MIT | 2025-03-07 | 148 | Shadow hatching from renders. |
| 145 | [msurguy/watercolor-playground](https://github.com/msurguy/watercolor-playground) | Wet watercolor painting simulation in browser | MIT | 2026-10-07 | 64 | Gwen-style washes. |
| 157 | [processing/p5.js](https://github.com/processing/p5.js) | Creative coding library | LGPL-2.1 | 2026-10-09 | 24,107 | Plate generation. |
| 161 | [LingDong-/shan-shui-inf](https://github.com/LingDong-/shan-shui-inf) | Procedural infinite-scroll landscape painting | MIT | 2018-12-11 | 6,252 | Proof that scroll plus procedural painting works. |
| 166 | [joanrod/star-vector](https://github.com/joanrod/star-vector) | Image to SVG code model | Apache-2.0 | 2025-11-07 | 4,619 | Icon vectorizing. |
| 183 | [fogleman/sdf](https://github.com/fogleman/sdf) | SDF mesh generation in Python | MIT | 2024-08-10 | 2,011 | Morph target meshes. |
| 213 | [abey79/vsketch](https://github.com/abey79/vsketch) | Generative plotter art in Python | custom | 2026-10-06 | 606 | Generative lines. |
| 224 | [btk/vectorizer](https://github.com/btk/vectorizer) | Multi-color potrace tracer | MIT | 2022-11-30 | 421 | Poster tracing. |
| 232 | [kilobtye/potrace](https://github.com/kilobtye/potrace) | Potrace JS port | GPL-2.0 | 2016-07-16 | 345 | Browser trace. |
| 244 | [jdhoek/inkscape-isometric-projection](https://github.com/jdhoek/inkscape-isometric-projection) | Inkscape isometric projection | GPL-3.0 | 2023-07-14 | 234 | Isometric diagram art. |
| 251 | [flupke/pypotrace](https://github.com/flupke/pypotrace) | Python potrace bindings | custom | 2021-02-04 | 178 | Scripted trace. |
| 257 | [rolyatmax/watercolor-canvas](https://github.com/rolyatmax/watercolor-canvas) | Watercolor canvas effect | MIT | 2017-05-03 | 124 | Watercolor plates. |
| 260 | [philgyford/python-halftone](https://github.com/philgyford/python-halftone) | Pillow halftone | none | 2021-12-21 | 103 | Offline halftone on posters. |
| 266 | [NHasan143/delaunay-stippler](https://github.com/NHasan143/delaunay-stippler) | Stipple art via Lloyd relaxation | none | 2026-09-22 | 65 | Stippled shading plates. |
| 288 | [LingDong-/fishdraw](https://github.com/LingDong-/fishdraw) | Procedural fish drawings | MIT | 2021-09-08 | 2,445 | Off-target. |
| 292 | [inkstitch/inkstitch](https://github.com/inkstitch/inkstitch) | Embroidery design in Inkscape | GPL-3.0 | 2026-09-17 | 1,361 | Off-target. |
| 298 | [textext/textext](https://github.com/textext/textext) | LaTeX in Inkscape | BSD-3-Clause | 2026-01-06 | 1,102 | Off-target. |
| 301 | [fablabnbg/inkscape-silhouette](https://github.com/fablabnbg/inkscape-silhouette) | Drive vinyl cutters | GPL-2.0 | 2026-10-08 | 678 | Off-target. |
| 302 | [evil-mad/axidraw](https://github.com/evil-mad/axidraw) | AxiDraw Inkscape extension | GPL-2.0 | 2024-01-24 | 468 | Plotter only. |
| 305 | [inconvergent/svgsort](https://github.com/inconvergent/svgsort) (archived) | SVG path sorter (archived) | custom | 2019-02-27 | 262 | Plotter only. |
| 312 | [ma-xu/LIVE](https://github.com/ma-xu/LIVE) | Backup of LIVE | Apache-2.0 | 2022-06-10 | 80 | Use Picsart repo. |

### Art: procedural textures (4)

| Rank | Repo | What it does | License | Last commit | Stars | Where it plugs in |
|---:|---|---|---|---|---:|---|
| 33 | [RodZill4/material-maker](https://github.com/RodZill4/material-maker) | Procedural texture and brush node editor on Godot | MIT | 2026-10-07 | 5,973 | Halftone, hatch and paper textures baked for Blender NPR materials. MIT. |
| 64 | [armory3d/armorpaint](https://github.com/armory3d/armorpaint) | 3D PBR texture painting | custom | 2026-10-08 | 5,348 | Paint textures on study models; binaries paid. |
| 110 | [njbrown/texturelab](https://github.com/njbrown/texturelab) | GPU procedural texture generator | custom | 2026-09-21 | 810 | Paper and grain textures. |
| 185 | [bootchk/resynthesizer](https://github.com/bootchk/resynthesizer) | Texture synthesis for GIMP | GPL-3.0 | 2026-03-31 | 1,876 | Extend painted textures. |

### 2D animation tools and runtimes (19)

| Rank | Repo | What it does | License | Last commit | Stars | Where it plugs in |
|---:|---|---|---|---|---:|---|
| 47 | [remotion-dev/remotion](https://github.com/remotion-dev/remotion) | React to video | custom | 2026-10-09 | 62,799 | Render captions or panels to video; license needs a company license above small teams. |
| 50 | [airbnb/lottie-web](https://github.com/airbnb/lottie-web) | Lottie player | MIT | 2024-11-19 | 32,169 | SFX bursts as vector animation. |
| 51 | [GraphiteEditor/Graphite](https://github.com/GraphiteEditor/Graphite) | Node-based vector and raster editor | Apache-2.0 | 2026-10-09 | 27,518 | Procedural vector art. |
| 53 | [motion-canvas/motion-canvas](https://github.com/motion-canvas/motion-canvas) | Code-driven vector animation with editor | MIT | 2026-07-02 | 19,263 | Explainer inserts. |
| 59 | [opentoonz/opentoonz](https://github.com/opentoonz/opentoonz) | Full 2D animation suite | custom | 2026-10-09 | 7,806 | Hand-drawn effects; macOS builds not notarized (unverified here). |
| 85 | [pencil2d/pencil](https://github.com/pencil2d/pencil) | Simple hand-drawn 2D animation | GPL-2.0 | 2026-10-02 | 1,812 | Rough timing tests on twos; a third-party tracker reports it notarized (unverified). |
| 95 | [rive-app/rive-react](https://github.com/rive-app/rive-react) | Rive React runtime | MIT | 2026-09-30 | 1,168 | Rive in Next. |
| 105 | [rive-app/rive-wasm](https://github.com/rive-app/rive-wasm) | Rive JS and WASM runtime | MIT | 2026-10-09 | 973 | Interactive stepped 2D characters. |
| 108 | [LottieFiles/dotlottie-web](https://github.com/LottieFiles/dotlottie-web) | Rust WASM Lottie player with WebGL and WebGPU | MIT | 2026-10-06 | 892 | Lighter Lottie runtime. |
| 114 | [tahoma2d/tahoma2d](https://github.com/tahoma2d/tahoma2d) | OpenToonz-based 2D and stop motion | custom | 2026-09-24 | 666 | Docs say not notarized: first launch needs Open Anyway in Privacy and Security. |
| 169 | [midrender/revideo](https://github.com/midrender/revideo) | Code to video fork of Motion Canvas | MIT | 2026-07-15 | 4,093 | Headless render alternative. |
| 179 | [synfig/synfig](https://github.com/synfig/synfig) | Vector 2D animation | GPL-3.0 | 2026-10-03 | 2,312 | Gatekeeper status unconfirmed. |
| 187 | [thorvg/thorvg](https://github.com/thorvg/thorvg) | Vector engine for SVG and Lottie | MIT | 2026-10-09 | 1,866 | Powers dotLottie. |
| 188 | [friction2d/friction](https://github.com/friction2d/friction) | Motion graphics app (enve fork) | GPL-3.0 | 2026-10-09 | 1,835 | Gatekeeper status unknown. |
| 195 | [rive-app/rive-runtime](https://github.com/rive-app/rive-runtime) | Low-level C++ Rive runtime | MIT | 2026-10-09 | 1,201 | Reference. |
| 270 | [Celstomp/celstomp](https://github.com/Celstomp/celstomp) | Browser cel animation app | GPL-3.0 | 2026-03-29 | 60 | No-install timing tests. |
| 273 | [thorvg/thorvg.web](https://github.com/thorvg/thorvg.web) | ThorVG for web | MIT | 2026-10-08 | 53 | Lottie render backend. |
| 291 | [LottieFiles/lottie-player](https://github.com/LottieFiles/lottie-player) (archived) | Deprecated Lottie web component | MIT | 2026-04-08 | 1,657 | Deprecated. |
| 297 | [MaurycyLiebner/enve](https://github.com/MaurycyLiebner/enve) (archived) | 2D animation (archived) | GPL-3.0 | 2022-09-25 | 1,196 | Use friction. |

### Inbetweening and interpolation research (10)

| Rank | Repo | What it does | License | Last commit | Stars | Where it plugs in |
|---:|---|---|---|---|---:|---|
| 25 | [Doubiiu/ToonCrafter](https://github.com/Doubiiu/ToonCrafter) | SIGGRAPH Asia 2024 generative cartoon interpolation between two keyframes, with sketch guidance | Apache-2.0 | 2025-03-19 | 6,032 | Prototype the morph between two shot end frames (the "shots morph, they don't cut" rule) before committing to a hand-built transition. Needs about 10 to 24 GB VRAM, so it runs on RunPod, not this Mac. |
| 100 | [hzwer/Practical-RIFE](https://github.com/hzwer/Practical-RIFE) | Practical frame interpolation | MIT | 2026-08-27 | 1,027 | Smooth camera-only passes; never on characters. |
| 144 | [MarkMoHR/JoSTC](https://github.com/MarkMoHR/JoSTC) | Stroke tracing and correspondence for 2D animation (SIGGRAPH 2024) | Apache-2.0 | 2026-09-15 | 73 | Vector inbetween research. |
| 147 | [alvdansen/animating-on-twos](https://github.com/alvdansen/animating-on-twos) | Paper and weights for keyframe-animation adapters on a video model | custom | 2026-08-30 | 59 | Evidence on why video models drift off twos; read before AI inbetweening. |
| 170 | [lllyasviel/Paints-UNDO](https://github.com/lllyasviel/Paints-UNDO) | Model of drawing process | Apache-2.0 | 2025-08-13 | 4,065 | Drawing-process reveals. |
| 174 | [google-research/frame-interpolation](https://github.com/google-research/frame-interpolation) (archived) | FILM large-motion interpolation (archived) | Apache-2.0 | 2023-01-14 | 3,154 | Archived. |
| 211 | [LordLiang/DrawingSpinUp](https://github.com/LordLiang/DrawingSpinUp) | 3D animation from a single character drawing | none | 2026-09-25 | 658 | Research. |
| 221 | [lisiyao21/AnimeInterp](https://github.com/lisiyao21/AnimeInterp) | Animation video interpolation (CVPR21) | none | 2023-10-10 | 458 | Research only. |
| 234 | [NevermindNilas/TheAnimeScripter](https://github.com/NevermindNilas/TheAnimeScripter) | Anime upscale, RIFE and restore toolkit | AGPL-3.0 | 2026-10-07 | 332 | Upscale renders. |
| 256 | [ShuhongChen/eisai-anime-interpolator](https://github.com/ShuhongChen/eisai-anime-interpolator) | Perceptual 2D animation interpolation (ECCV22) | AGPL-3.0 | 2024-06-30 | 128 | Research only. |

### Studio and ASWF open source (26)

| Rank | Repo | What it does | License | Last commit | Stars | Where it plugs in |
|---:|---|---|---|---|---:|---|
| 52 | [blender/blender](https://github.com/blender/blender) | Official Blender mirror | custom | 2026-10-09 | 20,791 | Source for Kuwahara compositor, Line Art and GP3 behavior. |
| 60 | [PixarAnimationStudios/OpenUSD](https://github.com/PixarAnimationStudios/OpenUSD) | Universal Scene Description | custom | 2026-10-08 | 7,522 | Shot assembly between Nalana and Blender. |
| 71 | [AcademySoftwareFoundation/openvdb](https://github.com/AcademySoftwareFoundation/openvdb) | Sparse volumes (DreamWorks) | Apache-2.0 | 2026-10-08 | 3,424 | Haze volumes. |
| 77 | [AcademySoftwareFoundation/OpenImageIO](https://github.com/AcademySoftwareFoundation/OpenImageIO) | Image IO and processing (oiiotool) | Apache-2.0 | 2026-10-09 | 2,378 | Batch convert EXR passes. |
| 78 | [AcademySoftwareFoundation/OpenShadingLanguage](https://github.com/AcademySoftwareFoundation/OpenShadingLanguage) | OSL from Sony Imageworks | BSD-3-Clause | 2026-10-07 | 2,341 | Cycles OSL halftone shaders. |
| 80 | [AcademySoftwareFoundation/MaterialX](https://github.com/AcademySoftwareFoundation/MaterialX) | ILM's look-dev interchange standard | Apache-2.0 | 2026-10-08 | 2,275 | Portable NPR materials across Blender and USD. |
| 82 | [AcademySoftwareFoundation/OpenColorIO](https://github.com/AcademySoftwareFoundation/OpenColorIO) | Color management | BSD-3-Clause | 2026-10-01 | 2,129 | Per-universe grade with LUTs. |
| 96 | [grizzlypeak3d/DJV](https://github.com/grizzlypeak3d/DJV) | EXR image sequence player for review | BSD-3-Clause | 2026-10-09 | 1,146 | Review rendered sequences frame by frame. |
| 111 | [AcademySoftwareFoundation/OpenRV](https://github.com/AcademySoftwareFoundation/OpenRV) | RV media review player | custom | 2026-10-08 | 775 | Review dailies. |
| 165 | [OpenMoonRay/openmoonray](https://github.com/OpenMoonRay/openmoonray) | DreamWorks MoonRay renderer | Apache-2.0 | 2026-08-25 | 4,737 | Reference. |
| 176 | [PixarAnimationStudios/OpenSubdiv](https://github.com/PixarAnimationStudios/OpenSubdiv) | Subdivision surfaces | custom | 2026-10-09 | 3,075 | Reference. |
| 182 | [AcademySoftwareFoundation/OpenTimelineIO](https://github.com/AcademySoftwareFoundation/OpenTimelineIO) | Editorial timeline interchange | Apache-2.0 | 2026-10-09 | 2,013 | Shot list as data. |
| 186 | [AcademySoftwareFoundation/openexr](https://github.com/AcademySoftwareFoundation/openexr) | EXR format | BSD-3-Clause | 2026-10-07 | 1,866 | Multilayer render passes. |
| 198 | [GafferHQ/gaffer](https://github.com/GafferHQ/gaffer) | Node lookdev and lighting app | BSD-3-Clause | 2026-10-09 | 1,099 | Reference. |
| 206 | [AcademySoftwareFoundation/OpenPBR](https://github.com/AcademySoftwareFoundation/OpenPBR) | OpenPBR surface spec | Apache-2.0 | 2026-04-17 | 806 | Reference. |
| 212 | [blender/cycles](https://github.com/blender/cycles) | Standalone Cycles renderer | Apache-2.0 | 2026-09-08 | 654 | Reference only. |
| 219 | [wdas/partio](https://github.com/wdas/partio) | Particle IO | custom | 2026-04-22 | 498 | Reference. |
| 222 | [wdas/SeExpr](https://github.com/wdas/SeExpr) | Disney expression language | custom | 2026-01-27 | 429 | Reference. |
| 227 | [cpichard/usdtweak](https://github.com/cpichard/usdtweak) | USD editor | Apache-2.0 | 2026-10-04 | 361 | Inspect USD. |
| 235 | [PrismPipeline/QuiltiX](https://github.com/PrismPipeline/QuiltiX) | MaterialX node editor with Hydra viewport | Apache-2.0 | 2025-06-25 | 325 | Author MaterialX. |
| 250 | [LucaScheller/VFX-UsdSurvivalGuide](https://github.com/LucaScheller/VFX-UsdSurvivalGuide) | USD onboarding guide | Apache-2.0 | 2025-10-19 | 183 | Learn USD. |
| 289 | [wdas/brdf](https://github.com/wdas/brdf) | BRDF explorer | custom | 2023-04-21 | 2,268 | Off-target. |
| 293 | [ubisoft/mixer](https://github.com/ubisoft/mixer) (archived) | Blender collaboration (archived) | GPL-3.0 | 2022-08-01 | 1,344 | Archived. |
| 300 | [wdas/ptex](https://github.com/wdas/ptex) | Per-face texturing | custom | 2026-09-04 | 737 | Off-target. |
| 303 | [blender/blender-addons](https://github.com/blender/blender-addons) (archived) | Archived read-only add-ons mirror | none | 2024-05-13 | 394 | Archived. |
| 304 | [dreamworksanimation/usdmanager](https://github.com/dreamworksanimation/usdmanager) | USD text browser (2022) | Apache-2.0 | 2022-09-28 | 347 | Stale. |

### NPR research and reference builds (13)

| Rank | Repo | What it does | License | Last commit | Stars | Where it plugs in |
|---:|---|---|---|---|---:|---|
| 41 | [semontesdeoca/MNPR](https://github.com/semontesdeoca/MNPR) | Expressive real-time NPR framework (watercolor, oil, charcoal) for Maya, from Montesdeoca's PhD | custom | 2019-07-15 | 255 | The research blueprint for art-directed watercolor and pigment effects; port ideas, not code (Maya-only). |
| 140 | [Kenton-GMI/sakuragaoka-station](https://github.com/Kenton-GMI/sakuragaoka-station) | Procedural cel-shaded three.js town | MIT | 2026-09-25 | 98 | Colour-aware outlines and toon ramps. |
| 149 | [StarKnightt/summer-cycle](https://github.com/StarKnightt/summer-cycle) | Procedural Ghibli-style toon three.js world | MIT | 2026-09-23 | 44 | Painted-background toon look in code. |
| 156 | [fcole/dpix](https://github.com/fcole/dpix) | Benard and Cole NPR line stylization viewer (NPAR 2010) | custom | 2010-11-22 | 0 | Self-similar line textures, the coherent stylized line problem. |
| 164 | [brunosimon/folio-2019](https://github.com/brunosimon/folio-2019) | Bruno Simon's three.js portfolio | MIT | 2024-05-06 | 4,748 | Reference. |
| 167 | [brunosimon/my-room-in-3d](https://github.com/brunosimon/my-room-in-3d) | Baked-lighting three.js room | none | 2021-09-13 | 4,512 | Bake workflow reference. |
| 208 | [JasonMa0012/MooaToon](https://github.com/JasonMa0012/MooaToon) | Cinematic toon rendering plugin for UE5 | custom | 2026-09-18 | 749 | Reference for toon lighting controls. |
| 217 | [Kai-46/ARF-svox2](https://github.com/Kai-46/ARF-svox2) | Artistic radiance fields | BSD-2-Clause | 2022-07-22 | 578 | Research. |
| 229 | [kayac/kamakura-shaders](https://github.com/kayac/kamakura-shaders) | Unity NPR shader set: anime, paint, watercolor, sketch | custom | 2018-07-13 | 353 | Reference parameters. |
| 231 | [LuggLD/SmearFrame](https://github.com/LuggLD/SmearFrame) | UE4 smear frame material | CC0-1.0 | 2019-07-17 | 347 | Vertex-stretch smear reference. |
| 264 | [Ameobea/sketches-3d](https://github.com/Ameobea/sketches-3d) | Blender plus three.js shader experiments | none | 2026-09-28 | 76 | Pipeline examples. |
| 280 | [adamb70/Spiderverse-Shader-Unity](https://github.com/adamb70/Spiderverse-Shader-Unity) | Small Unity Spider-Verse image effect (halftone node) | none | 2019-03-09 | 43 | A filter-style attempt; the skill lists why this reads as a filter. |
| 294 | [jbilcke-hf/ai-comic-factory](https://github.com/jbilcke-hf/ai-comic-factory) (archived) | LLM plus SDXL comics (archived) | Apache-2.0 | 2025-10-30 | 1,341 | Off-workflow. |

### Curated lists to mine (7)

| Rank | Repo | What it does | License | Last commit | Stars | Where it plugs in |
|---:|---|---|---|---|---:|---|
| 55 | [terkelg/awesome-creative-coding](https://github.com/terkelg/awesome-creative-coding) | Creative coding list | none | 2026-07-21 | 15,419 | Index. |
| 61 | [agmmnn/awesome-blender](https://github.com/agmmnn/awesome-blender) | Blender add-ons list | CC0-1.0 | 2026-01-22 | 7,413 | Index. |
| 190 | [beardicus/awesome-plotters](https://github.com/beardicus/awesome-plotters) | Plotter resources | CC0-1.0 | 2025-12-03 | 1,467 | Index. |
| 209 | [rive-app/awesome-rive](https://github.com/rive-app/awesome-rive) | Rive resources list | none | 2026-09-28 | 701 | Index. |
| 210 | [matiascodesal/awesome-openusd](https://github.com/matiascodesal/awesome-openusd) | OpenUSD list | none | 2026-10-02 | 674 | Index. |
| 216 | [MarkMoHR/Awesome-Sketch-Synthesis](https://github.com/MarkMoHR/Awesome-Sketch-Synthesis) | Sketch synthesis paper list | none | 2026-10-06 | 581 | Index. |
| 247 | [armstrongl/awesome-krita](https://github.com/armstrongl/awesome-krita) | Awesome list of Krita brushes, plugins and tutorials | custom | 2024-01-05 | 217 | Index to mine for more Krita plugins. |
## Relevant, but not on GitHub

- **Blender Lab MCP**, the official Blender MCP server, lives at
  projects.blender.org/lab/blender_mcp, not GitHub. `bpy-dev/blender-mcp`
  above is a modified redistribution of it. Not opened directly here.
- **Grease Pencil toolbox** (gp_toolbox, Pullusb and Autour de Minuit) moved
  off GitHub; the GitHub names 404'd.
- **SMEAR's extension page** (extensions.blender.org/add-ons/smear) lists
  v1.1.8 from 2025-11-20 as GPL-3.0-or-later, while the repo carries a CeCILL
  license file. Both are GPL-compatible.
- **Blender's built-in Kuwahara compositor node** (classic and anisotropic,
  since 4.0) and **Line Art modifier** cover a lot of the painterly and ink
  pass before any add-on.

## Opened and rejected

- [oneilltomhq/lib3](https://github.com/oneilltomhq/lib3), reached through the
  pipefold/lib3 link a web result gave: composable TSL nodes, but 0 stars and
  no users yet.
- [Zylann/godot_sdf_blender](https://github.com/Zylann/godot_sdf_blender): an
  SDF modeling plugin for Godot, not Blender, despite the name.
