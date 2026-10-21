"""Quick low-sample previews while building: journal close-up and door angles."""
import sys, math
sys.path.insert(0, __file__.rsplit("/", 1)[0])
import bpy
from mathutils import Vector
import room_scene as R

a = R.args()
out = a[0]
R.setup_render(samples=int(a[1]) if len(a) > 1 else 32)
R.sc.render.resolution_percentage = int(a[4]) if len(a) > 4 else 25
R.add_journal()
if len(a) > 3 and a[3] in ("golden", "morning", "night"):
    R.set_light(a[3])
what = a[2] if len(a) > 2 else "journal"
if what == "journal":
    cam = bpy.data.objects.new("PrevCam", bpy.data.cameras.new("PrevCam"))
    R.sc.collection.objects.link(cam)
    cam.data.lens = 50
    cam.location = (0.75, -0.25, 1.25)
    d = Vector(R.JOURNAL_AT) - cam.location
    cam.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    R.sc.camera = cam
elif what in ("corner", "tail"):
    cam = bpy.data.objects.new("PrevCam", bpy.data.cameras.new("PrevCam"))
    R.sc.collection.objects.link(cam)
    cam.data.lens = 100
    root = bpy.data.objects["Journal"]
    tgt = root.matrix_world @ (Vector((-0.14, -0.095, 0.004)) if what == "corner" else Vector((0.02, -0.1, 0.006)))
    cam.location = tgt + Vector((0.05, -0.16, 0.10))
    cam.rotation_euler = (tgt - cam.location).to_track_quat("-Z", "Y").to_euler()
    R.sc.camera = cam
elif what.startswith("door"):
    piv = R.split_fridge(); R.fill_fridge(); R.open_door(piv, float(what[4:]))
    if len(a) > 3: R.set_light(a[3])
R.render_to(out)
