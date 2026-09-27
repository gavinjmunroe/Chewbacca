"""A grey blockout of one shot, rendered as a reference video for Seedance. Headless.

  blender -b --factory-startup -P blockout_ref.py -- --spec shot.json --out DIR
          [--frames 0,60,119] [--scale 0.5]

The spec places proxies and keys a camera; see blockout/standoff.json.
Writes DIR/ref.mp4 (the @Video reference), DIR/first.png and DIR/last.png
(to restyle into start and end frames), and DIR/roles.txt, the reference-role
block to paste above the prompt.

What the output is shaped by, so nobody undoes it by accident:

- Workbench, flat grey, one tint per subject. A coarse blockout carries
  paths, blocking, camera and cuts; textures add nothing and leak (ByteDance's
  blockout guidance via OSideMedia MODE-PLAYBOOKS.md). The tint only exists so
  roles.txt can say "the blue capsule is <subject>".
- A render, not a viewport playblast, so no axes, paths, rigs or camera
  frustums reach the file. The vendor says those render as scene content.
- People are a capsule, a head and a nose block that shows facing. No arms:
  a partial limb sequence renders stiff, and the vendor's own practice is to
  leave limbs out of a coarse blockout.
- 4 to 30 seconds. 4 s is Seedance 2.5's duration floor, and an omni_reference
  job's duration must equal its video reference or the model invents footage
  past the end (Higgsfield AI-vs-VFX build, 2026-08-08). 30 s is the most
  one video reference can carry.
"""

import argparse
import json
import math
import os
import shutil
import subprocess
import sys

import bpy
import mathutils

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument("--spec", required=True)
ap.add_argument("--out", required=True)
ap.add_argument("--frames")
ap.add_argument("--scale", type=float, default=1.0)
args = ap.parse_args(argv)
spec = json.load(open(args.spec))
out = os.path.abspath(args.out)
os.makedirs(out, exist_ok=True)

seconds = float(spec["seconds"])
if not 4.0 <= seconds <= 30.0:
    sys.exit(f"seconds is {seconds}: Seedance 2.5 takes a 4 to 30 s reference")
fps = int(spec.get("fps", 24))
w, h = (int(v) for v in spec.get("size", "1920x1080").split("x"))
last_frame = round(seconds * fps) - 1

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.engine = "BLENDER_WORKBENCH"
scene.render.resolution_x, scene.render.resolution_y = w, h
scene.render.resolution_percentage = int(args.scale * 100)
scene.render.fps = fps
scene.frame_start, scene.frame_end = 0, last_frame
scene.render.image_settings.file_format = "PNG"
shading = scene.display.shading
shading.light = "STUDIO"
shading.color_type = "OBJECT"
shading.show_shadows = True
shading.show_cavity = True
scene.world = bpy.data.worlds.new("World")
scene.world.color = (0.55, 0.56, 0.58)


def srgb(hexstr):
    """Linear RGBA from '#rrggbb'."""
    c = [int(hexstr.lstrip("#")[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4 for v in c) + (1.0,)


def tinted(obj, color):
    obj.color = srgb(color)
    return obj


GREY = "#8a8a8a"
bpy.ops.mesh.primitive_plane_add(size=spec.get("ground_size", 400))
tinted(bpy.context.object, spec.get("ground_color", "#6f6a62")).name = "ground"


def person(name, x, y, facing_deg, color, height=1.8):
    """Capsule body, head, and a nose block pointing where the person faces."""
    shoulder = height * 0.81
    bpy.ops.mesh.primitive_cylinder_add(radius=height * 0.11, depth=shoulder,
                                        location=(0, 0, shoulder / 2))
    body = tinted(bpy.context.object, color)
    bpy.ops.mesh.primitive_uv_sphere_add(radius=height * 0.065,
                                         location=(0, 0, shoulder + height * 0.09))
    head = tinted(bpy.context.object, color)
    # The nose is near-black so facing reads even when it points at the lens.
    bpy.ops.mesh.primitive_cube_add(size=height * 0.045,
                                    location=(height * 0.065, 0, shoulder + height * 0.09))
    nose = tinted(bpy.context.object, "#1a1a1a")
    parts = [body, head, nose]
    bpy.ops.object.empty_add(location=(x, y, 0))
    root = bpy.context.object
    root.name = name
    root.rotation_euler.z = math.radians(facing_deg)
    for p in parts:
        p.parent = root
    return root


def box(name, x, y, size, color):
    sx, sy, sz = size
    bpy.ops.mesh.primitive_cube_add(size=1, location=(x, y, sz / 2))
    obj = bpy.context.object
    obj.scale = (sx, sy, sz)
    obj.name = name
    return tinted(obj, color)


for a in spec.get("actors", []):
    x, y = a["at"]
    if a.get("kind", "person") == "person":
        root = person(a["name"], x, y, a.get("facing", 0), a.get("color", GREY),
                      a.get("height", 1.8))
    else:
        root = box(a["name"], x, y, a["size"], a.get("color", GREY))
    for k in a.get("path", []):
        root.location = (k["at"][0], k["at"][1], 0)
        root.keyframe_insert("location", frame=round(k["t"] * fps))

# The camera tracks an empty, so each key is a position and a point to look at.
cam_data = bpy.data.cameras.new("cam")
cam = bpy.data.objects.new("cam", cam_data)
scene.collection.objects.link(cam)
scene.camera = cam
target = bpy.data.objects.new("look", None)
scene.collection.objects.link(target)
track = cam.constraints.new("TRACK_TO")
track.target = target
track.track_axis, track.up_axis = "TRACK_NEGATIVE_Z", "UP_Y"
cam_data.clip_end = 2000
keys = spec["camera"]
for k in keys:
    f = round(k["t"] * fps)
    cam.location = k["at"]
    target.location = k["look"]
    cam_data.lens = k.get("lens", 35)
    cam.keyframe_insert("location", frame=f)
    target.keyframe_insert("location", frame=f)
    cam_data.keyframe_insert("lens", frame=f)

def fcurves(owner):
    """Blender 5 keeps F-curves in a slotted action's channelbag."""
    from bpy_extras import anim_utils
    ad = owner.animation_data
    bag = anim_utils.action_get_channelbag_for_slot(ad.action, ad.action_slot)
    return bag.fcurves if bag else []


# A key marked "cut" jumps: the key before it holds until the cut frame, so
# end one shot a frame or two before the next shot's cut key.
cuts = {round(k["t"] * fps) for k in keys if k.get("cut")}
for owner in (cam, target, cam_data):
    for fc in fcurves(owner):
        pts = fc.keyframe_points
        for i in range(len(pts) - 1):
            if round(pts[i + 1].co.x) in cuts:
                pts[i].interpolation = "CONSTANT"

frames = ([int(f) for f in args.frames.split(",")] if args.frames
          else range(0, last_frame + 1))
for f in frames:
    scene.frame_set(f)
    scene.render.filepath = os.path.join(out, f"frame_{f:04d}.png")
    bpy.ops.render.render(write_still=True)

if not args.frames:
    # -frames:v caps the encode at this spec's length. Without it, frames left
    # in DIR by an earlier, longer spec extend the %04d sequence, and the
    # reference outruns the duration the job is priced and prompted for.
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-framerate", str(fps),
                    "-i", os.path.join(out, "frame_%04d.png"),
                    "-frames:v", str(last_frame + 1),
                    # H.264 in yuv420p needs even sides; 1920x822 at --scale 0.5
                    # is 960x411 and the encoder refused it. Crop, never resample.
                    "-vf", "crop=trunc(iw/2)*2:trunc(ih/2)*2", "-c:v", "libx264",
                    "-pix_fmt", "yuv420p", "-crf", "18", os.path.join(out, "ref.mp4")],
                   check=True)
    shutil.copy(os.path.join(out, "frame_0000.png"), os.path.join(out, "first.png"))
    shutil.copy(os.path.join(out, f"frame_{last_frame:04d}.png"),
                os.path.join(out, "last.png"))

# The coarse-blockout role block, filled in, so the video is never read as
# the look. Template: OSideMedia MODE-PLAYBOOKS.md, from ByteDance's guide.
lines = [
    "@Video 1 is a coarse blockout reference. It provides only subject blocking, "
    "motion paths, camera position, camera movement, lens changes and cuts. Do not "
    "use its gray figures, flat colors, empty ground or studio lighting.",
]
for a in spec.get("actors", []):
    if a.get("role"):
        shape = "figure" if a.get("kind", "person") == "person" else "block"
        lines.append(f"The {a.get('tint_name', 'gray')} {shape} in @Video 1 "
                     f"corresponds to {a['role']}.")
lines.append(f"Duration {seconds:g} s, the same as @Video 1.")
open(os.path.join(out, "roles.txt"), "w").write("\n".join(lines) + "\n")
print(f"blockout: {len(list(frames))} frames, {seconds:g} s at {fps} fps -> {out}")
