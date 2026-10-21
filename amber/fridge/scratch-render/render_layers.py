"""Render the living-room layers, one job per Nalana process:

    Nalana -b kitchen-items.blend -P render_layers.py -- <job>

Jobs:
  base-<light>            full frame with the journal on the counter
  open-<light>[-lampoff]  fridge door open DOOR_DEG, interior lit
  lampoff-night           night with the pendant off
  tree-<light>            RGBA: the tree alone, everything else camera-invisible
  panes                   RGBA: alpha is where the window shows sky or tree
  sky-<hour>              sky plate, 25%, for the per-hour gradient spec
  page                    top-down, flat-lit right page of the journal, 1705x2400
  journal-open[-nopen]    top-down whole open journal in golden light, 2400 wide
  anchors                 write scratch-render/layer-raw/anchors.json, no render

Lossless PNGs go to scratch-render/layer-raw/; compose_layers.py turns them
into the registered webps in public/kitchen/layers/.
"""
import json
import math
import sys

sys.path.insert(0, __file__.rsplit("/", 1)[0])
import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402

import room_scene as R  # noqa: E402

job = R.args()[0]
O, sc = R.O, R.sc
R.setup_render()
R.add_journal(pen=(job != "journal-open-nopen"))

# window region with room for the tree to sway, as a render border (0..1, y up)
WIN_BORDER = (0.60, 0.94, 0.50, 0.99)

SKY = {
    # hour, bottom (ramp 0) colour, top (ramp 1) colour, emission strength.
    # golden, morning and night are the scene's own values (render_variants.py).
    "dawn": (6.0, (0.98, 0.66, 0.50), (0.48, 0.52, 0.74), 0.75),
    "morning": (9.0, (0.95, 0.88, 0.75), (0.65, 0.8, 0.95), 1.0),
    "noon": (13.0, (0.86, 0.91, 0.96), (0.50, 0.68, 0.93), 1.1),
    "golden": (17.5, (1.0, 0.5, 0.25), (0.95, 0.62, 0.55), 0.75),
    "dusk": (19.5, (0.80, 0.42, 0.38), (0.20, 0.19, 0.40), 0.6),
    "night": (21.0, (0.06, 0.08, 0.18), (0.02, 0.03, 0.09), 0.6),
}


def only_camera(keep):
    for o in O:
        if o.type in ("MESH", "CURVE", "EMPTY") and o.name not in keep:
            o.visible_camera = False


def border(b):
    sc.render.use_border = True
    sc.render.use_crop_to_border = False
    sc.render.border_min_x, sc.render.border_max_x, sc.render.border_min_y, sc.render.border_max_y = b


if job.startswith("base-"):
    R.set_light(job[5:])
    R.render_to(R.RAW / f"{job}.png")

elif job.startswith("open-"):
    parts = job.split("-")
    light = parts[1]
    R.set_light(light, pendant="lampoff" not in parts)
    piv = R.split_fridge()
    R.fill_fridge()
    R.open_door(piv, R.DOOR_DEG)
    R.render_to(R.RAW / f"{job}.png")

elif job == "lampoff-night":
    R.set_light("night", pendant=False)
    R.render_to(R.RAW / f"{job}.png")

elif job.startswith("tree-"):
    R.set_light(job[5:])
    sc.render.film_transparent = True
    only_camera({"tree_small_02_LOD0"})
    border(WIN_BORDER)
    R.render_to(R.RAW / f"{job}.png")

elif job == "panes":
    sc.render.film_transparent = True
    sc.cycles.samples = 32
    sc.cycles.use_denoising = False
    for o in O:
        if o.type == "MESH" and o.name not in ("tree_small_02_LOD0", "Sky"):
            o.is_holdout = True
    border(WIN_BORDER)
    R.render_to(R.RAW / "panes.png")

elif job.startswith("sky-"):
    name = job[4:]
    hour, lo, hi, strength = SKY[name]
    nt = bpy.data.materials["SkyMat"].node_tree
    ramp = nt.nodes["SkyRamp"].color_ramp
    ramp.elements[0].color = (*lo, 1)
    ramp.elements[1].color = (*hi, 1)
    nt.nodes["SkyEmit"].inputs[1].default_value = strength
    # the sky plane alone, as the camera sees it through the window
    only_camera({"Sky"})
    sc.cycles.samples = 16
    sc.render.resolution_percentage = 25
    R.render_to(R.RAW / f"sky-{name}.png")

elif job == "page":
    # Top-down, flat-lit: a uniform white world and nothing else, so the page shows
    # its own colour with only the gutter's occlusion and curl shading.
    keep = {"journal_right"}
    for o in O:
        if o.type == "LIGHT":
            o.hide_render = True
        elif o.type == "MESH" and o.name not in keep:
            o.hide_render = True
    w = sc.world.node_tree
    bg = next(n for n in w.nodes if n.type == "BACKGROUND")
    for l in list(bg.inputs[0].links):
        w.links.remove(l)
    bg.inputs[0].default_value = (1, 1, 1, 1)
    bg.inputs[1].default_value = 1.0
    sc.view_settings.view_transform = "Standard"
    sc.view_settings.look = "None"
    sc.view_settings.exposure = 0.0
    sc.view_settings.gamma = 1.0
    xs = [v.co.x for v in O["journal_right"].data.vertices]
    x0, x1 = min(xs), max(xs)  # the page's footprint: a little under PAGE_W, it arcs
    sc.render.resolution_x = round(2400 * (x1 - x0) / R.PAGE_H)
    sc.render.resolution_y = 2400
    sc.cycles.samples = 128
    cam = bpy.data.objects.new("PageCam", bpy.data.cameras.new("PageCam"))
    sc.collection.objects.link(cam)
    cam.data.type = "ORTHO"
    cam.data.ortho_scale = R.PAGE_H
    cam.data.sensor_fit = "VERTICAL"
    root = O["Journal"]
    centre = root.matrix_world @ Vector(((x0 + x1) / 2, 0, 0))
    cam.location = (centre.x, centre.y, centre.z + 0.4)
    cam.rotation_euler = (0, 0, R.JOURNAL_ROT)
    sc.camera = cam
    R.render_to(R.RAW / "journal-page.png")

elif job.startswith("journal-open"):
    # The whole open journal from straight above, in the golden light, for the
    # lifted view. Only the journal is visible to the camera; the counter is a
    # shadow catcher so the book keeps its own contact shadow on transparency.
    R.set_light("golden")
    sc.render.film_transparent = True
    keep = {o.name for o in O["Journal"].children_recursive} | {"Journal"}
    for o in O:
        if o.type == "MESH" and o.name not in keep:
            o.visible_camera = False
    O["Countertop"].visible_camera = True
    O["Countertop"].is_shadow_catcher = True
    # Lifted out of the room: the bowl, shelf, window frame and leaf gobos stop
    # shadowing it (the first render sat in a big diagonal shadow and the
    # catcher printed it), so golden sun falls on the whole book and the
    # catcher keeps only the journal's own shadow.
    for o in O:
        if o.type == "MESH" and o.name not in keep:
            o.visible_shadow = False
    bw = 2 * (R.JOINT + R.PAGE_W + R.SQUARE) + 0.03
    bh = R.PAGE_H + 2 * R.SQUARE + 0.07  # room for the ribbon's tail on the counter
    sc.render.resolution_x = 2400
    sc.render.resolution_y = round(2400 * bh / bw)
    cam = bpy.data.objects.new("TopCam", bpy.data.cameras.new("TopCam"))
    sc.collection.objects.link(cam)
    cam.data.type = "ORTHO"
    cam.data.ortho_scale = bw
    cam.data.sensor_fit = "HORIZONTAL"
    root = O["Journal"]
    ctr = root.matrix_world @ Vector((0, -0.02, 0))
    cam.location = (ctr.x, ctr.y, ctr.z + 0.6)
    cam.rotation_euler = (0, 0, R.JOURNAL_ROT)
    sc.camera = cam
    R.render_to(R.RAW / f"{job}.png")

elif job == "anchors":
    dg = bpy.context.evaluated_depsgraph_get()

    def bbox(o):
        ps = [o.matrix_world @ Vector(c) for c in o.bound_box]
        return Vector([min(p[i] for p in ps) for i in range(3)]), Vector([max(p[i] for p in ps) for i in range(3)])

    def hull(pts):
        pts = sorted(set((round(p[0], 3), round(p[1], 3)) for p in pts))
        cross = lambda o, a, b: (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
        lo, up = [], []
        for p in pts:
            while len(lo) >= 2 and cross(lo[-2], lo[-1], p) <= 0:
                lo.pop()
            lo.append(p)
        for p in reversed(pts):
            while len(up) >= 2 and cross(up[-2], up[-1], p) <= 0:
                up.pop()
            up.append(p)
        return [list(p) for p in lo[:-1] + up[:-1]]

    def proj_obj(o):
        ev = o.evaluated_get(dg)
        me = ev.to_mesh()
        pts = [R.project(ev.matrix_world @ v.co) for v in me.vertices]
        ev.to_mesh_clear()
        return pts

    out = {}
    lo_, hi_ = bbox(O["pot_enamel_01_lid"])
    out["potLid"] = R.project(((lo_.x + hi_.x) / 2, (lo_.y + hi_.y) / 2, hi_.z))
    lo_, hi_ = bbox(O["plastic_thermos"])
    out["thermosTop"] = R.project(((lo_.x + hi_.x) / 2, (lo_.y + hi_.y) / 2, hi_.z))
    # pendant: the lamp hangs above frame; give where its cord crosses the top edge
    lamp = O["modern_ceiling_lamp_01"]
    lo_, hi_ = bbox(lamp)
    out["pendant"] = {"lampBottom": R.project(((lo_.x + hi_.x) / 2, (lo_.y + hi_.y) / 2, lo_.z)),
                      "bulb": R.project(O["PendantBulb"].location)}
    # plant leaves: each loose part of the leaf mesh is one leaf; keep the biggest
    import bmesh
    for oname, key, n in (("potted_plant_02_leaves", "plantLeaves", 10), ("potted_plant_04_plant", "sillPlantLeaves", 4)):
        o = O[oname]
        bm = bmesh.new()
        bm.from_mesh(o.data)
        bm.verts.ensure_lookup_table()
        seen, parts = set(), []
        for v in bm.verts:
            if v.index in seen:
                continue
            stack, comp = [v], []
            seen.add(v.index)
            while stack:
                a = stack.pop()
                comp.append(a)
                for e in a.link_edges:
                    b = e.other_vert(a)
                    if b.index not in seen:
                        seen.add(b.index)
                        stack.append(b)
            area = sum(f.calc_area() for f in {f for vv in comp for f in vv.link_faces})
            parts.append((area, comp))
        parts.sort(key=lambda t: -t[0])
        mw = o.matrix_world
        base = mw @ Vector((sum(c[0] for c in o.bound_box) / 8, sum(c[1] for c in o.bound_box) / 8, min(c[2] for c in o.bound_box)))
        leaves = []
        for area, comp in parts[:n]:
            ws = [mw @ v.co for v in comp]
            ctr = sum(ws, Vector()) / len(ws)
            tip = max(ws, key=lambda p: (p - base).length)
            stem = min(ws, key=lambda p: (p - base).length)
            leaves.append({"centre": R.project(ctr), "tip": R.project(tip), "stem": R.project(stem),
                           "areaCm2": round(area * mw.to_scale().x ** 2 * 1e4, 1)})
        bm.free()
        out[key] = leaves
    # journal
    jp = []
    for o in O:
        if o.name.startswith(("journal_", "pen_")) and o.type == "MESH":
            jp += proj_obj(o)
    out["journal"] = hull(jp)
    out["journalPage"] = [R.project(p) for p in R.journal_corners()]
    # fridge handle and door outline, closed and open
    lo_, hi_ = bbox(O["HandleBot"])
    out["fridgeHandle"] = hull([R.project((x, lo_.y, z)) for x in (lo_.x, hi_.x) for z in (lo_.z, hi_.z)])
    piv = R.split_fridge()
    out["fridgeDoorClosed"] = hull(proj_obj(O["FridgeDoor"]))
    R.open_door(piv, R.DOOR_DEG)
    dg = bpy.context.evaluated_depsgraph_get()
    out["fridgeDoorOpen"] = hull(proj_obj(O["FridgeDoor"]) + proj_obj(O["FridgeGasket"]))
    out["fridgeCavity"] = hull([R.project((x, 0.0, z)) for x in (-0.695, -0.005) for z in (0.115, R.DOOR_TOP - 0.04)])
    # tree sway pivot: the trunk where it enters the frame's bottom, and the crown
    t = O["tree_small_02_LOD0"]
    lo_, hi_ = bbox(t)
    out["treePivot"] = R.project((t.location.x, t.location.y, 1.12))
    out["treeCrown"] = R.project(((lo_.x + hi_.x) / 2, (lo_.y + hi_.y) / 2, hi_.z))
    out["doorDeg"] = R.DOOR_DEG
    out["sky"] = {k: {"hour": v[0], "bottom": v[1], "top": v[2], "strength": v[3]} for k, v in SKY.items()}
    (R.RAW / "anchors.json").write_text(json.dumps(out, indent=1))
    print("ANCHORS", json.dumps(out)[:2000])
else:
    raise SystemExit(f"unknown job {job}")
