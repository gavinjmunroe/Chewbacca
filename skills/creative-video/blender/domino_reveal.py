"""A field of dominoes whose falling wave reveals a hidden picture. Headless.

  blender -b --factory-startup -P domino_reveal.py -- --out DIR [options]

    --mask PNG        picture to hide; downsampled to the grid, dark = accent
    --cols 25 --rows 40
    --size 1080x1920  --fps 30  --seconds 12
    --frames 0,90,300 render only these frames (keyframe sheet), else all
    --scale 1.0       resolution scale for quick looks (0.5 = half size)
    --samples 32      Eevee TAA samples

Writes DIR/frame_####.png and DIR/timings.json (every domino's impact time,
for the click track). The camera is the story: it opens high over the near
end, looking down the field while the wave comes toward it, then rises to
straight down so the picture reads. Measured 2026-09-27 on an M4 Pro: 315
frames at 1080x1920, 48 samples, in 304 s.

Why the wave runs toward the camera: a domino exposes the face on the side it
fell away from. Colouring the far face and looking from the near side keeps
the picture hidden on standing dominoes and shows it only where they fell.
"""

import argparse
import json
import math
import os
import random
import sys

import bpy
import mathutils

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument("--out", required=True)
ap.add_argument("--mask")
ap.add_argument("--cols", type=int, default=25)
ap.add_argument("--rows", type=int, default=40)
ap.add_argument("--size", default="1080x1920")
ap.add_argument("--fps", type=int, default=30)
ap.add_argument("--seconds", type=float, default=12.0)
ap.add_argument("--frames")
ap.add_argument("--scale", type=float, default=1.0)
ap.add_argument("--samples", type=int, default=32)
ap.add_argument("--seed", type=int, default=7)
args = ap.parse_args(argv)
os.makedirs(args.out, exist_ok=True)
rng = random.Random(args.seed)

# Domino proportions are a real domino's, 48 x 24 x 7.5 mm, at 1 unit tall.
H, W, T = 1.0, 0.5, 0.16
PITCH_Y = 0.55   # must stay under H or a falling domino misses the next one
PITCH_X = 0.6
# Lean where a falling domino's top meets the next one's face, and where a
# collapsed row settles (parallel dominoes stacked face to face).
CONTACT = math.asin((PITCH_Y - T) / H)
REST = math.acos(T / PITCH_Y)
ROW_DT = 0.19    # seconds for the wave to cross one row
COL_DT = 0.035   # lateral spread per column: the V of the wavefront
FALL = ROW_DT / math.sqrt(CONTACT / REST)  # fall time so contact lands on ROW_DT
LEAD_IN = 3      # dominoes in the line that starts the field; 6 left the first second still
START = 0.05     # the first domino is already moving on frame one

C = bpy.context
scene = C.scene
for ob in list(bpy.data.objects):
    bpy.data.objects.remove(ob, do_unlink=True)

w, h = (int(v) for v in args.size.split("x"))
scene.render.resolution_x, scene.render.resolution_y = w, h
scene.render.resolution_percentage = int(args.scale * 100)
scene.render.fps = args.fps
scene.frame_start, scene.frame_end = 0, int(args.seconds * args.fps) - 1
scene.render.engine = "BLENDER_EEVEE"
scene.eevee.taa_render_samples = args.samples
if hasattr(scene.eevee, "use_raytracing"):
    scene.eevee.use_raytracing = True
scene.render.use_motion_blur = True
scene.render.motion_blur_shutter = 0.5
scene.view_settings.view_transform = "AgX"
scene.view_settings.look = "AgX - Medium High Contrast"
scene.render.image_settings.file_format = "PNG"

# The picture. Default is a heart, drawn on the grid, so the script runs with
# nothing supplied.
cols, rows = args.cols, args.rows
if args.mask:
    img = bpy.data.images.load(args.mask)
    img.scale(cols, rows)
    px = list(img.pixels)
    ch = img.channels
    def lit(c, r):
        # Blender stores image rows bottom up; row 0 here is the top.
        i = ((rows - 1 - r) * cols + c) * ch
        return (px[i] + px[i + 1] + px[i + 2]) / 3 < 0.5
else:
    R = cols * PITCH_X * 0.37
    def lit(c, r):
        x = (c - (cols - 1) / 2) * PITCH_X / R
        y = ((rows - 1) * 0.47 - r) * PITCH_Y / R
        return (x * x + y * y - 1) ** 3 - x * x * y ** 3 <= 0

# Materials. One mesh for all 1,000; each object's colour rides on
# object.color and the face shader reads it through Object Info.
def principled(name, color, rough, spec=0.5):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*color, 1)
    b.inputs["Roughness"].default_value = rough
    return m, b

def srgb(hexstr):
    v = [int(hexstr[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in v)

body, _ = principled("body", srgb("121212"), 0.28)
face, fb = principled("face", (1, 1, 1), 0.35)
info = face.node_tree.nodes.new("ShaderNodeObjectInfo")
face.node_tree.links.new(info.outputs["Color"], fb.inputs["Base Color"])
floor_m, _ = principled("floor", srgb("cfc7b9"), 0.9)
ACCENT, PAPER = srgb("ff4f1f"), srgb("fbf9f4")

# One domino: origin on its near bottom edge, the pivot it falls around.
import bmesh
bm = bmesh.new()
bmesh.ops.create_cube(bm, size=1)
bmesh.ops.scale(bm, vec=(W, T, H), verts=bm.verts)
bmesh.ops.translate(bm, vec=(0, T / 2, H / 2), verts=bm.verts)
mesh = bpy.data.meshes.new("domino")
bmesh.ops.bevel(bm, geom=list(bm.edges), offset=0.02, segments=2, affect="EDGES")
bm.to_mesh(mesh)
bm.free()
mesh.materials.append(body)
mesh.materials.append(face)
for p in mesh.polygons:
    if p.normal.y > 0.9:
        p.material_index = 1   # the far face: the one the fall turns upward

coll = bpy.data.collections.new("field")
scene.collection.children.link(coll)
# Rows run along -y toward the camera. Row 0 is the far end, where it starts.
y0 = (rows - 1) * PITCH_Y
center = (cols - 1) / 2
timings = []

def place(name, x, y, t0, color):
    ob = bpy.data.objects.new(name, mesh)
    ob.location = (x, y, 0)
    ob.color = (*color, 1)
    coll.objects.link(ob)
    # Quadratic fall to the contact lean, then on to rest, then a small
    # settle. Keyed every frame of the fall so the curve is the curve.
    fps = args.fps
    fc_frames = []
    n = max(2, int(math.ceil(FALL * fps)))
    for k in range(n + 1):
        tau = FALL * k / n
        fc_frames.append((t0 + tau, REST * (tau / FALL) ** 2))
    fc_frames.append((t0 + FALL + 0.07, REST - 0.05))
    fc_frames.append((t0 + FALL + 0.15, REST))
    ob.rotation_euler = (0, 0, 0)
    ob.keyframe_insert("rotation_euler", index=0, frame=max(0, (t0 - 0.02) * fps))
    for t, a in fc_frames:
        ob.rotation_euler = (a, 0, 0)
        ob.keyframe_insert("rotation_euler", index=0, frame=t * fps)
    return t0 + FALL * math.sqrt(CONTACT / REST)

# The lead-in line, beyond the far end, knocks over row 0's middle domino.
for i in range(LEAD_IN):
    t0 = START + i * ROW_DT
    y = y0 + (LEAD_IN - i) * PITCH_Y
    timings.append(place(f"lead{i}", 0, y, t0, PAPER))
FIELD_T0 = START + LEAD_IN * ROW_DT
lit_count = 0
for r in range(rows):
    for c in range(cols):
        on = lit(c, r)
        lit_count += on
        t0 = FIELD_T0 + r * ROW_DT + abs(c - center) * COL_DT + rng.uniform(-0.012, 0.012)
        x = (c - center) * PITCH_X + rng.uniform(-0.01, 0.01)
        y = y0 - r * PITCH_Y
        timings.append(place(f"d{r:02d}_{c:02d}", x, y, t0, ACCENT if on else PAPER))
WAVE_END = FIELD_T0 + (rows - 1) * ROW_DT + center * COL_DT + FALL + 0.15

# Floor and light.
bpy.ops.mesh.primitive_plane_add(size=1000, location=(0, y0 / 2, 0))
floor = C.active_object
floor.data.materials.append(floor_m)
sun_data = bpy.data.lights.new("sun", "SUN")
sun_data.energy = 3.2
sun_data.angle = math.radians(4)
sun = bpy.data.objects.new("sun", sun_data)
sun.rotation_euler = (math.radians(38), math.radians(-18), math.radians(-30))
scene.collection.objects.link(sun)
world = bpy.data.worlds.new("world")
scene.world = world
world.use_nodes = True
world.node_tree.nodes["Background"].inputs["Color"].default_value = (*srgb("c9c1b3"), 1)
world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.9

# Camera: a target that rides the wavefront, and a camera that climbs from a
# low telephoto look down the field to straight overhead for the reveal.
target = bpy.data.objects.new("target", None)
scene.collection.objects.link(target)
cam_data = bpy.data.cameras.new("cam")
cam = bpy.data.objects.new("cam", cam_data)
scene.collection.objects.link(cam)
scene.camera = cam
track = cam.constraints.new("TRACK_TO")
track.target = target
track.track_axis, track.up_axis = "TRACK_NEGATIVE_Z", "UP_Y"
cam_data.sensor_fit = "VERTICAL"

mid_y = y0 / 2
fps = args.fps
REVEAL = WAVE_END - 0.3   # overhead by the time the last row lands
keys = [
    # (seconds, camera xyz, target xyz, lens mm). Below about 61 degrees of
    # elevation every row hides the gap behind it (tan e > H / PITCH_Y), and
    # the first two keyframe sheets opened on a black wall. Frame one is at 64.
    # The last frames are straight down with the field inside the safe zone.
    (0.0,          (0.5, 5.0, 24.0),           (0, y0 - 5, 0),       36),
    (FIELD_T0 + 1, (0.4, 2.0, 24.0),           (0, y0 - 8, 0),       36),
    (REVEAL - 2.2, (0.2, mid_y - 8, 30.0),     (0, mid_y - 1, 0),    32),
    (REVEAL,       (0.0, mid_y - 1.05, 40.0),  (0, mid_y - 1.0, 0),  30),
    (args.seconds, (0.0, mid_y - 1.05, 40.0),  (0, mid_y - 1.0, 0),  33),
]
for t, cxyz, txyz, lens in keys:
    f = t * fps
    cam.location = cxyz
    cam.keyframe_insert("location", frame=f)
    target.location = txyz
    target.keyframe_insert("location", frame=f)
    cam_data.lens = lens
    cam_data.keyframe_insert("lens", frame=f)
with open(os.path.join(args.out, "timings.json"), "w") as fh:
    json.dump({
        "fps": fps, "seconds": args.seconds, "dominoes": len(timings),
        "lit": lit_count, "field_start": FIELD_T0, "wave_end": WAVE_END,
        "reveal": REVEAL, "impacts": sorted(timings),
    }, fh)
print(f"domino_reveal: {len(timings)} dominoes ({lit_count} accent), wave ends {WAVE_END:.2f}s")

frames = ([int(f) for f in args.frames.split(",") if f.strip()] if args.frames
          else range(scene.frame_start, scene.frame_end + 1))
for f in frames:
    scene.frame_set(f)
    scene.render.filepath = os.path.join(os.path.abspath(args.out), f"frame_{f:04d}.png")
    bpy.ops.render.render(write_still=True)
print("domino_reveal: rendered", len(list(frames)), "frames")
