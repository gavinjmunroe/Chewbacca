"""Build the v2 scene (docs/FRIDGE-SPEC.md) on top of kitchen-items.blend and
save it as kitchen-v2.blend. Every render job in render_v2.py loads that file.

    Nalana -b kitchen-items.blend -P build_v2.py

What changes from the saved scene:
- the door: the eight v1 items and their magnets go; the five story objects
  (note on the freezer, polaroid, business card, resume, prayer card) come in
  as physical paper under amber resin magnets (build_physical.py), each with
  its drawn back on the reverse face
- a wall clock left of the fridge, hands as separate objects (hidden in stills)
- pencil height marks on the wall under the clock
- the encyclopedias become seven cloth guest journals, 2019 to 2025, and a gap
- this year's journal open on the counter, two-column guest pages
- a mug by the journal, and its steam (morning only)
- a portrait camera, CamTall, and a ceiling only cameras see
"""
import math
import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import bpy  # noqa: E402
import bmesh  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

import room_scene as R  # noqa: E402
import build_physical as BP  # noqa: E402

HERE = R.HERE
TEX = HERE / "v2tex"
PUB = R.REPO / "public" / "kitchen"
O = bpy.data.objects
sc = bpy.context.scene
MM = 0.001


def img(path, noncolor=False):
    im = bpy.data.images.load(str(path), check_existing=True)
    if noncolor:
        im.colorspace_settings.name = "Non-Color"
    return im


def nodes(m):
    m.use_nodes = True
    return m.node_tree.nodes, m.node_tree.links


def bsdf_of(m):
    return next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")


# ------------------------------------------------------------------ clear v1 door
for o in list(bpy.data.collections["FridgeItems"].objects) + list(bpy.data.collections["Magnets"].objects):
    bpy.data.objects.remove(o, do_unlink=True)
for o in list(bpy.data.collections["book_encyclopedia_set_01"].objects):
    bpy.data.objects.remove(o, do_unlink=True)

# ------------------------------------------------------------------ story objects
# (id, front png, w, h, centre x, centre z, in-plane tilt deg, physical kind, magnet x fraction,
#  magnet D, stock thickness, roughness, seed, inclusion)
# Sizes are the real things: US letter for the note and resume, Polaroid 600
# film, a US business card, a 5 x 3 index card. Magnets sit clear of writing:
# the resume's on the right of its header, the card's and the prayer card's at
# their top right corner, over no ink (checked on the fronts).
STORY = [
    ("note", 0.210, 0.2753, -0.455, 1.565, -2.0, "letter", 0.50, 0.0265, 0.00010, 0.85, 31, "seed"),
    ("polaroid", 0.088, 0.1045, -0.200, 1.610, 3.5, "polaroid", 0.50, 0.0245, 0.00090, 0.45, 32, "bubbles"),
    ("resume", 0.2159, 0.2784, -0.515, 0.985, 1.5, "card", 0.80, 0.0260, 0.00010, 0.80, 33, "sliver"),
    ("bizcard", 0.0889, 0.0508, -0.235, 1.085, -4.0, "appt", 0.87, 0.0215, 0.00035, 0.70, 34, "seeds"),
    ("prayer", 0.127, 0.0743, -0.255, 0.880, 2.5, "appt", 0.90, 0.0220, 0.00025, 0.80, 35, "speck"),
]
ICOLL = bpy.data.collections["FridgeItems"]


def paper_mat(iid, rough):
    """Front and back on one sheet. The base grid is the sheet's back (on the
    door); the solidify shell grows toward the camera. Object-space normal Y
    says which face a ray hit: -Y is the front. The back was drawn as seen
    after a turn about the vertical axis, so it is sampled at (1-u, v)."""
    m = bpy.data.materials.new(f"paper_{iid}")
    N, L = nodes(m)
    b = bsdf_of(m)
    uv = N.new("ShaderNodeUVMap")
    uv.uv_map = "UVMap"
    ft = N.new("ShaderNodeTexImage")
    ft.image = img(PUB / "items" / f"{iid}.png")
    ft.interpolation = "Cubic"
    L.new(uv.outputs["UV"], ft.inputs["Vector"])
    sep = N.new("ShaderNodeSeparateXYZ")
    L.new(uv.outputs["UV"], sep.inputs[0])
    inv = N.new("ShaderNodeMath")
    inv.operation = "SUBTRACT"
    inv.inputs[0].default_value = 1.0
    L.new(sep.outputs["X"], inv.inputs[1])
    comb = N.new("ShaderNodeCombineXYZ")
    L.new(inv.outputs[0], comb.inputs["X"])
    L.new(sep.outputs["Y"], comb.inputs["Y"])
    bt = N.new("ShaderNodeTexImage")
    bt.image = img(BACKS / f"{iid}.png")
    bt.interpolation = "Cubic"
    L.new(comb.outputs[0], bt.inputs["Vector"])
    geo = N.new("ShaderNodeNewGeometry")
    vt = N.new("ShaderNodeVectorTransform")
    vt.vector_type = "NORMAL"
    vt.convert_from = "WORLD"
    vt.convert_to = "OBJECT"
    L.new(geo.outputs["Normal"], vt.inputs[0])
    ns = N.new("ShaderNodeSeparateXYZ")
    L.new(vt.outputs[0], ns.inputs[0])
    isback = N.new("ShaderNodeMath")
    isback.operation = "GREATER_THAN"
    isback.inputs[1].default_value = 0.0
    L.new(ns.outputs["Y"], isback.inputs[0])
    col = N.new("ShaderNodeMix")
    col.data_type = "RGBA"
    L.new(isback.outputs[0], col.inputs["Factor"])
    L.new(ft.outputs["Color"], col.inputs["A"])
    L.new(bt.outputs["Color"], col.inputs["B"])
    alp = N.new("ShaderNodeMix")
    alp.data_type = "FLOAT"
    L.new(isback.outputs[0], alp.inputs["Factor"])
    L.new(ft.outputs["Alpha"], alp.inputs["A"])
    L.new(bt.outputs["Alpha"], alp.inputs["B"])
    # handled corners: a little grubbier and glossier (build_physical's wear mask)
    at = N.new("ShaderNodeAttribute")
    at.attribute_name = "wear"
    wm = N.new("ShaderNodeMix")
    wm.data_type = "RGBA"
    wm.blend_type = "MULTIPLY"
    amt = N.new("ShaderNodeMath")
    amt.operation = "MULTIPLY"
    amt.inputs[1].default_value = 0.45
    L.new(at.outputs["Fac"], amt.inputs[0])
    L.new(amt.outputs[0], wm.inputs["Factor"])
    L.new(col.outputs["Result"], wm.inputs["A"])
    wm.inputs["B"].default_value = (0.80, 0.76, 0.70, 1)
    L.new(wm.outputs["Result"], b.inputs["Base Color"])
    L.new(alp.outputs["Result"], b.inputs["Alpha"])
    b.inputs["Roughness"].default_value = rough
    if iid == "polaroid":
        b.inputs["Coat Weight"].default_value = 0.0
    # paper tooth, for raking light
    nz = N.new("ShaderNodeTexNoise")
    nz.inputs["Scale"].default_value = 2600.0
    nz.inputs["Detail"].default_value = 6.0
    bp = N.new("ShaderNodeBump")
    bp.inputs["Strength"].default_value = 0.05 if iid != "polaroid" else 0.01
    bp.inputs["Distance"].default_value = 0.0002
    L.new(nz.outputs["Fac"], bp.inputs["Height"])
    L.new(bp.outputs["Normal"], b.inputs["Normal"])
    return m


BACKS = PUB / "v2" / "backs"
if not (BACKS / "note.png").exists():
    BACKS = PUB / "backs"

mcoll = bpy.data.collections["Magnets"]
bmats = dict(
    disc=BP.simple_mat("m_magnet_disc", (0.55, 0.36, 0.12, 1), 0.4),
    seed=BP.simple_mat("m_incl_seed", (0.09, 0.035, 0.012, 1), 0.5),
    sliver=BP.simple_mat("m_incl_sliver", (0.05, 0.03, 0.015, 1), 0.4),
    twig=BP.simple_mat("m_incl_twig", (0.12, 0.07, 0.03, 1), 0.7),
    bubble=BP.simple_mat("m_incl_bubble", (1, 1, 1, 1), 0.0, ior=1 / 1.54, trans=1.0),
)
BP.UNDER.clear()
for iid, w, h, cx, cz, tilt, kind, mu, D, t, rough, seed, incl in STORY:
    me = bpy.data.meshes.new(f"paper_{iid}_seed")
    me.from_pydata([(-w / 2, 0, -h / 2), (w / 2, 0, -h / 2), (w / 2, 0, h / 2), (-w / 2, 0, h / 2)], [], [(0, 1, 2, 3)])
    o = bpy.data.objects.new(f"paper_{iid}", me)
    ICOLL.objects.link(o)
    o.location = (cx, 0, cz)
    o.rotation_euler = (0, math.radians(tilt), 0)
    me.materials.append(paper_mat(iid, rough))
    sol = o.modifiers.new("thickness", "SOLIDIFY")
    sol.thickness = t
    cfg = dict(kind=kind, mu=mu, D=D, incl=incl, hue=random.Random(seed).uniform(-0.04, 0.05), rough=rough, seed=seed)
    geo = BP.build_paper(o, cfg)
    # soft corners: real stock is never knife sharp at this scale
    bev = o.modifiers.new("corners", "BEVEL")
    bev.width = 0.0006
    bev.segments = 2
    bev.limit_method = "ANGLE"
    mag = BP.build_magnet(o, cfg, geo, mcoll, bmats)
    o["mX"], o["mZ"], o["D"] = geo["mX"], geo["mZ"], D
    bpy.context.view_layer.update()
    from mathutils.bvhtree import BVHTree
    BP.UNDER.append((BVHTree.FromObject(o, bpy.context.evaluated_depsgraph_get()), o.matrix_world.copy()))
c = sc.cycles
c.transmission_bounces = max(c.transmission_bounces, 16)
c.volume_bounces = max(c.volume_bounces, 2)

# ------------------------------------------------------------------ clock
CLOCK = Vector((-1.175, 0.70, 1.885))   # centre, on the wall face (wall front is y=0.7)
CR = 0.135                             # outer radius of the rim
DIAL_R = 0.120
DIAL_Y = CLOCK.y - 0.018               # dial sits 18 mm off the wall inside the rim
CC = R.coll("Clock")


def lathe_y(name, prof, material, segs=96, loc=(0, 0, 0), collection=None):
    """Revolve [(r, y)] about the world Y axis (the clock faces -Y)."""
    bm = bmesh.new()
    rings = []
    for r, y in prof:
        rings.append([bm.verts.new((r * math.cos(2 * math.pi * k / segs), y, r * math.sin(2 * math.pi * k / segs))) for k in range(segs)])
    for a, b2 in zip(rings, rings[1:]):
        for k in range(segs):
            bm.faces.new((a[k], b2[k], b2[(k + 1) % segs], a[(k + 1) % segs]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    o = R.obj_from_bm(name, bm, material, collection or CC)
    o.location = loc
    return o


enamel = R.mat("clock_enamel", (0.055, 0.12, 0.085), rough=0.32, coat=0.5)
# rim: a rolled steel case, wall side to front lip, then the bezel curling in
rim = lathe_y("clock_rim", [(CR - 0.012, 0.0), (CR, -0.002), (CR + 0.002, -0.020), (CR, -0.040), (CR - 0.004, -0.045),
                            (CR - 0.011, -0.044), (CR - 0.013, -0.040), (DIAL_R + 0.002, -0.036)], enamel, loc=CLOCK)
back = lathe_y("clock_back", [(0.0, -0.0005), (CR - 0.011, -0.0005), (CR - 0.012, 0.0)], enamel, loc=CLOCK)
dial_m = bpy.data.materials.new("clock_dial")
N, L = nodes(dial_m)
b = bsdf_of(dial_m)
t = N.new("ShaderNodeTexImage")
t.image = img(TEX / "clock-dial.png")
L.new(t.outputs["Color"], b.inputs["Base Color"])
b.inputs["Roughness"].default_value = 0.55
bm = bmesh.new()
uvl = bm.loops.layers.uv.new("UVMap")
ring = [bm.verts.new((DIAL_R * math.cos(2 * math.pi * k / 128), 0, DIAL_R * math.sin(2 * math.pi * k / 128))) for k in range(128)]
f = bm.faces.new(list(reversed(ring)))
for lp in f.loops:
    lp[uvl].uv = (lp.vert.co.x / (2 * DIAL_R) + 0.5, lp.vert.co.z / (2 * DIAL_R) + 0.5)
dial = R.obj_from_bm("clock_dial", bm, dial_m, CC, smooth=False)
dial.location = (CLOCK.x, DIAL_Y - CLOCK.y + CLOCK.y, CLOCK.z)
# domed glass: a thin spherical cap over the dial, its edge seated in the bezel
glass_m = R.mat("clock_glass", (1, 1, 1), rough=0.02, trans=1.0, ior=1.5)
cap_h = 0.010
rs = (DIAL_R ** 2 + cap_h ** 2) / (2 * cap_h)
prof = []
for k in range(25):
    r = (DIAL_R + 0.003) * (1 - k / 24)
    prof.append((r, -0.037 - (math.sqrt(max(0.0, rs * rs - r * r)) - (rs - cap_h)) + 0.0))
glass = lathe_y("clock_glass", prof, glass_m, loc=CLOCK)
R.shell(glass, 0.0012)
glass.visible_shadow = False

hand_m = R.mat("clock_hand", (0.02, 0.02, 0.022), rough=0.35, metal=0.4)


def hand(name, length, width, tail, y):
    """A flat steel hand pointing up (+Z) from the pivot, tapered, with a short
    counterweight tail and a ring round the arbor."""
    bm = bmesh.new()
    pts = [(-width * 0.5, -tail), (width * 0.5, -tail), (width * 0.35, 0.0), (width * 0.5, length * 0.25),
           (width * 0.12, length), (-width * 0.12, length), (-width * 0.5, length * 0.25), (-width * 0.35, 0.0)]
    vs = [bm.verts.new((x, 0, z)) for x, z in pts]
    bm.faces.new(list(reversed(vs)))
    o = R.obj_from_bm(name, bm, hand_m, CC, smooth=False)
    s = o.modifiers.new("t", "SOLIDIFY")
    s.thickness = 0.0008
    o.location = (CLOCK.x, y, CLOCK.z)
    return o


hour = hand("clock_hour", 0.066, 0.0085, 0.014, DIAL_Y - 0.004)
minute = hand("clock_minute", 0.104, 0.0060, 0.020, DIAL_Y - 0.0065)
capm = R.mat("clock_capm", (0.02, 0.02, 0.022), rough=0.3, metal=0.5)
cap = R.ellipsoid("clock_cap", 0.0045, 0.0025, 0.0045, capm, CC, (CLOCK.x, DIAL_Y - 0.0085, CLOCK.z))
for o in (hour, minute, cap):
    o.hide_render = True
sc["clock_pivot"] = (CLOCK.x, DIAL_Y - 0.006, CLOCK.z)

# ------------------------------------------------------------------ pencil marks
MK = R.coll("Marks")
mk_m = bpy.data.materials.new("pencil_marks")
N, L = nodes(mk_m)
b = bsdf_of(mk_m)
t = N.new("ShaderNodeTexImage")
t.image = img(TEX / "marks.png")
L.new(t.outputs["Color"], b.inputs["Base Color"])
L.new(t.outputs["Alpha"], b.inputs["Alpha"])
b.inputs["Roughness"].default_value = 0.42   # graphite has a dull shine
b.inputs["Metallic"].default_value = 0.25
MW, MZ0, MZ1 = 0.36, 0.88, 1.40
mx0 = CLOCK.x - 0.195
bm = bmesh.new()
uvl = bm.loops.layers.uv.new("UVMap")
vs = [bm.verts.new(v) for v in ((mx0, 0, MZ0), (mx0 + MW, 0, MZ0), (mx0 + MW, 0, MZ1), (mx0, 0, MZ1))]
f = bm.faces.new(vs)
for lp, uvv in zip(f.loops, ((0, 0), (1, 0), (1, 1), (0, 1))):
    lp[uvl].uv = uvv
marks = R.obj_from_bm("pencil_marks", bm, mk_m, MK, smooth=False)
marks.location.y = 0.7 - 0.0002
marks.visible_shadow = False

# ------------------------------------------------------------------ guest journals on the shelf
YEARS = list(range(2019, 2026))
VOL_PROFILE = [(0.0, 0.0010), (0.004, 0.0042), (0.012, 0.0084), (0.03, 0.0097), (0.08, 0.0092), (R.PAGE_W, 0.0088)]
VOL_T = R.BLOCK_Z + 0.0100          # half thickness: board, endpaper, half the leaves
VOL_BW = R.PAGE_W + R.SQUARE        # board width from the spine
VOL_BH = R.PAGE_H + 2 * R.SQUARE
SHELF_TOP = 1.765
CLOTH = {2019: (0.36, 0.08, 0.07), 2020: (0.10, 0.15, 0.30), 2021: (0.13, 0.25, 0.16), 2022: (0.62, 0.43, 0.14),
         2023: (0.25, 0.32, 0.40), 2024: (0.48, 0.17, 0.10), 2025: (0.17, 0.21, 0.18)}
SC = R.coll("Shelf")


def cloth_mat(yr, tape=False):
    age = (2025 - yr) / 6
    col = Vector(CLOTH[yr])
    col = col.lerp(Vector((0.42, 0.38, 0.32)), 0.25 * age)  # sun-faded with age
    m = bpy.data.materials.new(f"cloth_{yr}{'_spine' if tape else ''}")
    N, L = nodes(m)
    b = bsdf_of(m)
    b.inputs["Roughness"].default_value = 0.88
    b.inputs["Sheen Weight"].default_value = 0.35
    tc = N.new("ShaderNodeTexCoord")
    # book-cloth weave: two fine wave patterns crossed, plus slow mottling
    w1 = N.new("ShaderNodeTexWave")
    w1.inputs["Scale"].default_value = 900.0
    w1.bands_direction = "X"
    w2 = N.new("ShaderNodeTexWave")
    w2.inputs["Scale"].default_value = 900.0
    w2.bands_direction = "Y"
    for w in (w1, w2):
        L.new(tc.outputs["Object"], w.inputs["Vector"])
    add = N.new("ShaderNodeMath")
    L.new(w1.outputs["Fac"], add.inputs[0])
    L.new(w2.outputs["Fac"], add.inputs[1])
    bp = N.new("ShaderNodeBump")
    bp.inputs["Strength"].default_value = 0.25
    bp.inputs["Distance"].default_value = 0.0002
    L.new(add.outputs[0], bp.inputs["Height"])
    L.new(bp.outputs["Normal"], b.inputs["Normal"])
    nz = N.new("ShaderNodeTexNoise")
    nz.inputs["Scale"].default_value = 40.0
    L.new(tc.outputs["Object"], nz.inputs["Vector"])
    ramp = N.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].color = (*(col * 0.82), 1)
    ramp.color_ramp.elements[1].color = (*(col * 1.12), 1)
    L.new(nz.outputs["Fac"], ramp.inputs["Fac"])
    base = ramp.outputs["Color"]
    if tape:
        uv = N.new("ShaderNodeUVMap")
        uv.uv_map = "UVMap"
        mp = N.new("ShaderNodeMapping")
        # tape spans u 0.06..0.94 around the spine, v 0.66..0.80 up it
        mp.inputs["Location"].default_value = (-0.06 / 0.88, -0.66 / 0.14, 0)
        mp.inputs["Scale"].default_value = (1 / 0.88, 1 / 0.14, 1)
        L.new(uv.outputs["UV"], mp.inputs["Vector"])
        tt = N.new("ShaderNodeTexImage")
        tt.image = img(TEX / f"tape-{yr}.png")
        tt.extension = "CLIP"
        L.new(mp.outputs[0], tt.inputs["Vector"])
        mix = N.new("ShaderNodeMix")
        mix.data_type = "RGBA"
        L.new(tt.outputs["Alpha"], mix.inputs["Factor"])
        L.new(base, mix.inputs["A"])
        L.new(tt.outputs["Color"], mix.inputs["B"])
        base = mix.outputs["Result"]
        rr = N.new("ShaderNodeMapRange")
        rr.inputs["To Min"].default_value = 0.88
        rr.inputs["To Max"].default_value = 0.7
        L.new(tt.outputs["Alpha"], rr.inputs["Value"])
        L.new(rr.outputs[0], b.inputs["Roughness"])
    L.new(base, b.inputs["Base Color"])
    return m


def spine(name, material, t, bh, collection):
    """The cloth spine. Basis: closed, a half round bulging out past the fore
    edge side (-X) between the two boards. Shape key 'open': the same cloth
    flattened under the gutter, where an open book's spine goes."""
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new("UVMap")
    nu, nv = 18, 6
    rows = []
    for j in range(nv + 1):
        y = (j / nv - 0.5) * bh
        row = []
        for i in range(nu + 1):
            a = math.pi * i / nu           # 0 at the bottom board, pi at the top
            row.append(bm.verts.new((-t * math.sin(a) - 0.0006, y, t - t * math.cos(a))))
        rows.append(row)
    for j in range(nv):
        for i in range(nu):
            f = bm.faces.new((rows[j][i], rows[j][i + 1], rows[j + 1][i + 1], rows[j + 1][i]))
            for lp, (ii, jj) in zip(f.loops, ((i, j), (i + 1, j), (i + 1, j + 1), (i, j + 1))):
                lp[uvl].uv = (1 - ii / nu, jj / nv)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(material)
    for p in me.polygons:
        p.use_smooth = True
    o = bpy.data.objects.new(name, me)
    collection.objects.link(o)
    o.shape_key_add(name="Basis")
    k = o.shape_key_add(name="open")
    for j in range(nv + 1):
        for i in range(nu + 1):
            idx = j * (nu + 1) + i
            x = -t + 2 * t * i / nu
            k.data[idx].co = (x, (j / nv - 0.5) * bh, -0.0006)
    s = o.modifiers.new("t", "SOLIDIFY")
    s.thickness = 0.0012
    return o


def volume(yr, collection):
    """One guest journal, built open (spread flat in local XY, pages up +Z,
    spine along local Y at x=0). The front half hangs off a hinge at (0,0,T):
    hinge rotation about Y is pi when closed, 0 when open."""
    saved = dict(R.PROFILE)
    R.PROFILE[-1] = VOL_PROFILE
    R.PROFILE[1] = VOL_PROFILE
    root = bpy.data.objects.new(f"vol_{yr}", None)
    collection.objects.link(root)
    hinge = bpy.data.objects.new(f"vol_{yr}_hinge", None)
    collection.objects.link(hinge)
    hinge.parent = root
    hinge.location = (0, 0, VOL_T)
    mats = {"edge": R.edge_mat()}
    cl = cloth_mat(yr)
    endp = R.mat(f"endpaper_{yr}", (0.78, 0.70, 0.56), rough=0.85)
    right_parts, left_parts = [], []
    for side, parts in ((1, right_parts), (-1, left_parts)):
        x0, x1 = sorted((side * 0.0012, side * VOL_BW))
        bd = R.box(f"vol_{yr}_board{side}", (x0, -VOL_BH / 2, 0.0), (x1, VOL_BH / 2, R.BOARD_T), [cl], collection, bevel=0.0008)
        parts.append(bd)
        e0, e1 = sorted((side * 0.002, side * (VOL_BW - 0.006)))
        parts.append(R.box(f"vol_{yr}_endp{side}", (e0, -VOL_BH / 2 + 0.006, R.BOARD_T - 0.0001),
                           (e1, VOL_BH / 2 - 0.006, R.BOARD_T + R.ENDPAPER_T), [endp], collection))
        pg = TEX / f"year-{yr}-{'right' if side > 0 else 'left'}.png"
        if not pg.exists():
            print("MISSING", pg)
            pg = TEX / "journal-right.png"
        parts.append(R.journal_page_block(f"vol_{yr}_pages{side}", side, pg, collection, mats))
    R.PROFILE.clear()
    R.PROFILE.update(saved)
    for p in right_parts:
        p.parent = root
    for p in left_parts:
        # built in book coordinates; hang it on the hinge at (0, 0, T)
        p.parent = hinge
        p.location = Vector(p.location) - Vector((0, 0, VOL_T))
    sp = spine(f"vol_{yr}_spine", cloth_mat(yr, tape=True), VOL_T, VOL_BH, collection)
    sp.parent = root
    root["hinge"] = hinge.name
    root["spine"] = sp.name
    return root


def tucked(root, yr, collection):
    """Small things kept between the pages of some volumes, lying on the right
    page (they are pressed shut inside the closed book)."""
    which = {2019: "ticket", 2020: "flower", 2021: "recipe", 2022: "ticket", 2023: "flower", 2024: "recipe"}.get(yr)
    if not which:
        return
    if which == "ticket":
        w, h, u, v, rot, z = 0.050, 0.028, 0.075, 0.040, 11, 0.0
    elif which == "flower":
        w, h, u, v, rot, z = 0.045, 0.045, 0.085, -0.030, -18, 0.0
    else:  # recipe card, most of it inside the book, a corner out past the fore-edge
        w, h, u, v, rot, z = 0.127, 0.076, R.PAGE_W - 0.030, 0.035, 14, -0.004
    m = bpy.data.materials.new(f"tucked_{yr}")
    N, L = nodes(m)
    b = bsdf_of(m)
    t = N.new("ShaderNodeTexImage")
    t.image = img(TEX / f"{which}.png")
    L.new(t.outputs["Color"], b.inputs["Base Color"])
    L.new(t.outputs["Alpha"], b.inputs["Alpha"])
    b.inputs["Roughness"].default_value = 0.8 if which != "flower" else 0.6
    if which == "flower":
        b.inputs["Transmission Weight"].default_value = 0.25
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new("UVMap")
    vs = [bm.verts.new(p) for p in ((-w / 2, -h / 2, 0), (w / 2, -h / 2, 0), (w / 2, h / 2, 0), (-w / 2, h / 2, 0))]
    f = bm.faces.new(vs)
    for lp, uvv in zip(f.loops, ((0, 0), (1, 0), (1, 1), (0, 1))):
        lp[uvl].uv = uvv
    o = R.obj_from_bm(f"vol_{yr}_{which}", bm, m, collection, smooth=False)
    if which != "flower":
        s = o.modifiers.new("t", "SOLIDIFY")
        s.thickness = 0.0003
    o.parent = root
    surf = R.BLOCK_Z + 0.0092 if z == 0 else R.BLOCK_Z + 0.0092 + z
    o.location = (u, v, surf + 0.0002)
    o.rotation_euler = (0, 0, math.radians(rot))


x = 0.392
rnd = random.Random(7)
vols = []
for yr in YEARS:
    root = volume(yr, SC)
    tucked(root, yr, SC)
    th = 2 * VOL_T + 0.0012
    # standing on the shelf, spine to the room: local X (into the book) -> +Y,
    # local Y (spine) -> +Z, local Z (thickness) -> +X
    rot = Matrix(((0, 0, 1), (1, 0, 0), (0, 1, 0))).to_4x4()
    lean = Matrix.Rotation(math.radians(rnd.uniform(-0.6, 0.6)), 4, "Y")
    root.matrix_world = Matrix.Translation((x, 0.522 + rnd.uniform(-0.004, 0.006), SHELF_TOP + VOL_BH / 2)) @ lean @ rot
    O[root["hinge"]].rotation_euler = (0, math.pi, 0)
    O[root["spine"]].data.shape_keys.key_blocks["open"].value = 0.0
    root["year"] = yr
    root["rest"] = [list(r) for r in root.matrix_world]
    vols.append(root)
    x += th + rnd.uniform(0.0005, 0.0018)
# the gap where this year's volume would stand, then a cast-iron bookend
gap_x = x + 0.032
iron = R.mat("bookend_iron", (0.05, 0.05, 0.055), rough=0.5, metal=0.6)
R.box("bookend_base", (gap_x, 0.53, SHELF_TOP), (gap_x + 0.09, 0.66, SHELF_TOP + 0.003), [iron], SC, bevel=0.001)
R.box("bookend_upright", (gap_x, 0.53, SHELF_TOP), (gap_x + 0.004, 0.66, SHELF_TOP + 0.15), [iron], SC, bevel=0.001)
sc["vol_names"] = [v.name for v in vols]

# ------------------------------------------------------------------ this year's journal
R.JOURNAL_AT = (0.405, 0.185, 0.91)
jroot = R.add_journal(pen=True)
for side in ("left", "right"):
    m = O[f"journal_{side}"].data.materials[0]
    tn = next(n for n in m.node_tree.nodes if n.type == "TEX_IMAGE")
    tn.image = img(TEX / f"journal-{side}.png")

# ------------------------------------------------------------------ mug and steam
MC = R.coll("Mug")
glaze = R.bumpy(R.mat("mug_glaze", (0.80, 0.55, 0.30), rough=0.22, coat=0.6), 3000, 0.08)
MUG = Vector((0.70, 0.30, 0.91))
mug = lathe_y("mug", [(0.0, 0.0), (0.038, 0.0), (0.041, 0.004), (0.042, 0.06), (0.043, 0.094), (0.0405, 0.096),
                      (0.0385, 0.094), (0.0375, 0.012), (0.0, 0.010)], glaze, segs=64, collection=MC)
mug.rotation_euler = (math.radians(90), 0, 0)   # lathe axis Y -> Z
mug.location = MUG
bm = bmesh.new()
segs, tubes = 32, 12
rings = []
for i in range(segs + 1):  # a C of tube on the mug's +X side
    a = -math.pi / 2 + math.pi * i / segs
    c0 = Vector((0.042 + 0.024 * math.cos(a) * 0.9, 0, 0.050 + 0.026 * math.sin(a)))
    tng = Vector((-math.sin(a) * 0.9, 0, math.cos(a))).normalized()
    nrm = Vector((math.cos(a), 0, math.sin(a)))
    bnm = tng.cross(nrm)
    rings.append([bm.verts.new(c0 + 0.006 * (nrm * math.cos(2 * math.pi * k / tubes)) + 0.0045 * (bnm * math.sin(2 * math.pi * k / tubes))) for k in range(tubes)])
for a_, b_ in zip(rings, rings[1:]):
    for k in range(tubes):
        bm.faces.new((a_[k], a_[(k + 1) % tubes], b_[(k + 1) % tubes], b_[k]))
handle = R.obj_from_bm("mug_handle", bm, glaze, MC)
handle.location = MUG
handle.rotation_euler = (0, 0, math.radians(-55))
coffee = R.cyl("coffee", 0.0378, 0.002, R.mat("coffee", (0.05, 0.025, 0.012), rough=0.08), MC, verts=64,
               loc=(MUG.x, MUG.y, MUG.z + 0.080))

# steam: a thin scattering volume above the cup, wisps from noise, fading up
steam_m = bpy.data.materials.new("steam")
N, L = nodes(steam_m)
for n in list(N):
    if n.type == "BSDF_PRINCIPLED":
        N.remove(n)
out = next(n for n in N if n.type == "OUTPUT_MATERIAL")
pv = N.new("ShaderNodeVolumePrincipled")
pv.inputs["Color"].default_value = (0.95, 0.95, 0.95, 1)
pv.inputs["Anisotropy"].default_value = 0.3
tc = N.new("ShaderNodeTexCoord")
sep = N.new("ShaderNodeSeparateXYZ")
L.new(tc.outputs["Object"], sep.inputs[0])
# rising: noise sampled at (x, y, z - rise*t), with the column swaying
mp = N.new("ShaderNodeMapping")
L.new(tc.outputs["Object"], mp.inputs["Vector"])
mp.name = "SteamRise"
nz = N.new("ShaderNodeTexNoise")
nz.noise_dimensions = "4D"
nz.name = "SteamNoise"
nz.inputs["Scale"].default_value = 28.0
nz.inputs["Detail"].default_value = 4.0
nz.inputs["Distortion"].default_value = 1.6
L.new(mp.outputs[0], nz.inputs["Vector"])
ramp = N.new("ShaderNodeValToRGB")
ramp.color_ramp.elements[0].position = 0.55
ramp.color_ramp.elements[1].position = 0.80
L.new(nz.outputs["Fac"], ramp.inputs["Fac"])
# radial mask, narrow at the cup and widening, and a fade with height
rad = N.new("ShaderNodeVectorMath")
rad.operation = "LENGTH"
cxy = N.new("ShaderNodeCombineXYZ")
L.new(sep.outputs["X"], cxy.inputs["X"])
L.new(sep.outputs["Y"], cxy.inputs["Y"])
L.new(cxy.outputs[0], rad.inputs[0])
wid = N.new("ShaderNodeMath")
wid.operation = "MULTIPLY_ADD"
L.new(sep.outputs["Z"], wid.inputs[0])
wid.inputs[1].default_value = 0.25
wid.inputs[2].default_value = 0.028
q = N.new("ShaderNodeMath")
q.operation = "DIVIDE"
L.new(rad.outputs["Value"], q.inputs[0])
L.new(wid.outputs[0], q.inputs[1])
rm = N.new("ShaderNodeMapRange")
rm.inputs["From Min"].default_value = 1.0
rm.inputs["From Max"].default_value = 0.3
L.new(q.outputs[0], rm.inputs["Value"])
hz = N.new("ShaderNodeMapRange")
hz.inputs["From Min"].default_value = 0.20
hz.inputs["From Max"].default_value = 0.0
L.new(sep.outputs["Z"], hz.inputs["Value"])
hz0 = N.new("ShaderNodeMapRange")  # and in from the coffee's surface
hz0.inputs["From Min"].default_value = 0.0
hz0.inputs["From Max"].default_value = 0.02
L.new(sep.outputs["Z"], hz0.inputs["Value"])
m1 = N.new("ShaderNodeMath")
m1.operation = "MULTIPLY"
L.new(ramp.outputs["Color"], m1.inputs[0])
L.new(rm.outputs[0], m1.inputs[1])
m2 = N.new("ShaderNodeMath")
m2.operation = "MULTIPLY"
L.new(m1.outputs[0], m2.inputs[0])
L.new(hz.outputs[0], m2.inputs[1])
m3 = N.new("ShaderNodeMath")
m3.operation = "MULTIPLY"
L.new(m2.outputs[0], m3.inputs[0])
L.new(hz0.outputs[0], m3.inputs[1])
dens = N.new("ShaderNodeMath")
dens.operation = "MULTIPLY"
dens.inputs[1].default_value = 22.0
L.new(m3.outputs[0], dens.inputs[0])
L.new(dens.outputs[0], pv.inputs["Density"])
L.new(pv.outputs[0], out.inputs["Volume"])
steam = R.box("steam", (-0.07, -0.07, 0.0), (0.07, 0.07, 0.22), [steam_m], MC)
steam.location = (MUG.x, MUG.y, MUG.z + 0.081)
steam.hide_render = True
steam.visible_shadow = False

# ------------------------------------------------------------------ ceiling, for the tall camera
ceil = R.box("Ceiling", (-4.0, -3.0, 2.98), (4.0, 0.8, 3.02), [R.mat("ceiling", (0.82, 0.80, 0.76), rough=0.9)], R.coll("Room2"))
for attr in ("visible_shadow", "visible_diffuse", "visible_glossy", "visible_transmission", "visible_volume_scatter"):
    setattr(ceil, attr, False)

# ------------------------------------------------------------------ tall camera
cd = bpy.data.cameras.new("CamTall")
ct = bpy.data.objects.new("CamTall", cd)
sc.collection.objects.link(ct)
TALL = dict(x=-0.17, d=2.25, z=1.27, width=1.72)
ct.location = (TALL["x"], -TALL["d"], TALL["z"])
ct.rotation_euler = (math.radians(90), 0, 0)
cd.sensor_fit = "HORIZONTAL"
cd.sensor_width = 36.0
cd.lens = 36.0 * TALL["d"] / TALL["width"]
cd.clip_start = 0.05
sc.camera.data.clip_start = 0.05
sc["tall_res"] = (1440, 3120)

sc.render.use_persistent_data = True
bpy.context.view_layer.update()
out = HERE / "kitchen-v2.blend"
bpy.ops.wm.save_as_mainfile(filepath=str(out), copy=False)
print("SAVED", out)
