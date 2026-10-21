"""Shared scene setup for the living-room layers. Imported by the render_*.py
scripts, which run in Nalana's background mode on kitchen-items.blend:

    /Applications/Nalana.app/Contents/MacOS/Nalana -b kitchen-items.blend -P render_x.py -- args

Nothing here saves the .blend. Every script rebuilds what it needs from the
saved scene, so the base frames, hotspots.json and every layer share one camera.
"""
import math
import sys
from pathlib import Path

import bpy
import bmesh
from mathutils import Matrix, Vector

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
LAYERS = REPO / "public" / "kitchen" / "layers"
RAW = HERE / "layer-raw"  # lossless PNG renders, kept out of public/
LAYERS.mkdir(parents=True, exist_ok=True)
RAW.mkdir(parents=True, exist_ok=True)

O = bpy.data.objects
sc = bpy.context.scene


def args():
    return sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


# ------------------------------------------------------------------ render + light
def setup_render(samples=160):
    """The settings render_variants.py used for the base frames."""
    prefs = bpy.context.preferences.addons["cycles"].preferences
    prefs.compute_device_type = "METAL"
    prefs.get_devices()
    for d in prefs.devices:
        d.use = True
    sc.cycles.device = "GPU"
    sc.render.resolution_x = 3840
    sc.render.resolution_y = 2160
    sc.render.resolution_percentage = 100
    sc.cycles.samples = samples
    sc.cycles.use_denoising = True
    sc.render.image_settings.file_format = "PNG"
    sc.render.image_settings.color_mode = "RGBA"


def set_light(v, pendant=True):
    """golden is the saved state; morning and night copy render_variants.py."""
    sky = bpy.data.materials["SkyMat"].node_tree
    ramp = sky.nodes["SkyRamp"].color_ramp
    emit = sky.nodes["SkyEmit"]
    bg = next(n for n in sc.world.node_tree.nodes if n.type == "BACKGROUND")
    sun, fill, bulb = O["Sun"], O["Fill"], O["PendantBulb"]
    if v == "morning":
        d = Vector((1.0, 0.75, -0.75)).normalized()
        sun.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
        sun.data.energy = 7.5
        sun.data.color = (1.0, 0.9, 0.76)
        fill.data.energy = 28
        fill.data.color = (0.92, 0.95, 1.0)
        ramp.elements[0].color = (0.95, 0.88, 0.75, 1)
        ramp.elements[1].color = (0.65, 0.8, 0.95, 1)
        emit.inputs[1].default_value = 1.0
        bg.inputs[1].default_value = 0.35
    elif v == "night":
        sun.data.energy = 0.0
        fill.data.energy = 2.5
        fill.data.color = (0.55, 0.62, 1.0)
        ramp.elements[0].color = (0.06, 0.08, 0.18, 1)
        ramp.elements[1].color = (0.02, 0.03, 0.09, 1)
        emit.inputs[1].default_value = 0.6
        bg.inputs[1].default_value = 0.05
        bulb.data.energy = 55 if pendant else 0.0
    elif v != "golden":
        raise ValueError(v)


def render_to(path):
    sc.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)
    print("DONE", path, flush=True)


# ------------------------------------------------------------------ helpers
def mat(name, col, rough=0.5, metal=0.0, trans=0.0, ior=1.45, coat=0.0, alpha=1.0):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    b = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    b.inputs["Base Color"].default_value = (*col, 1)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    b.inputs["Transmission Weight"].default_value = trans
    b.inputs["IOR"].default_value = ior
    b.inputs["Coat Weight"].default_value = coat
    b.inputs["Alpha"].default_value = alpha
    return m


def coll(name):
    c = bpy.data.collections.get(name)
    if not c:
        c = bpy.data.collections.new(name)
        sc.collection.children.link(c)
    return c


def obj_from_bm(name, bm, material, collection, smooth=True):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    if isinstance(material, (list, tuple)):
        for m in material:
            me.materials.append(m)
    else:
        me.materials.append(material)
    for p in me.polygons:
        p.use_smooth = smooth
    o = bpy.data.objects.new(name, me)
    collection.objects.link(o)
    return o


def box(name, mn, mx, material, collection, bevel=0.0):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co = Vector([mn[i] + (v.co[i] + 0.5) * (mx[i] - mn[i]) for i in range(3)])
    o = obj_from_bm(name, bm, material, collection, smooth=False)
    if bevel:
        m = o.modifiers.new("bev", "BEVEL")
        m.width = bevel
        m.segments = 3
    return o


def cyl(name, r, depth, material, collection, verts=32, loc=(0, 0, 0), rot=(0, 0, 0), r2=None):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=verts, radius1=r, radius2=r if r2 is None else r2, depth=depth)
    o = obj_from_bm(name, bm, material, collection)
    o.location = loc
    o.rotation_euler = rot
    return o


def apply_modifiers(o):
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(o.evaluated_get(dg))
    o.modifiers.clear()
    o.data = me


def boolean(target, cutter, op):
    m = target.modifiers.new("b", "BOOLEAN")
    m.operation = op
    m.object = cutter
    m.solver = "EXACT"
    apply_modifiers(target)


# ------------------------------------------------------------------ journal
# Counter top is z=0.91. The fruit bowl sits at (1.0, 0.42) with a 15.5 cm rim, so
# the journal goes in front of it, angled 8 degrees, its front corner just short
# of the counter's front edge (y=0.07).
JOURNAL_AT = (0.95, 0.178, 0.91)
JOURNAL_ROT = math.radians(-8.0)
PAGE_W, PAGE_H = 0.135, 0.19      # one page, measured flat
SQUARE = 0.005                    # how far the boards stand out past the pages
BOARD_T = 0.0032                  # board plus the leather over it
ENDPAPER_T = 0.0002
JOINT = 0.006                     # from the spine centre to each board's inner edge
LEATHER = HERE / "textures" / "brown_leather"  # Poly Haven "Brown Leather", Rob Tuytel, CC0, 400 mm tile
LEATHER_TILE = 0.40

# The page surface across each block, as (distance from the spine, height above
# the endpaper), metres. The signatures are on the journal's first spread, so the
# left block is a few leaves and the right holds the rest of the book: the left
# barely rises, the right climbs out of the gutter, crests and rolls down to a
# 12 mm fore-edge of stacked leaves.
PROFILE = {
    -1: [(0.0, 0.0010), (0.004, 0.0024), (0.012, 0.0046), (0.03, 0.0052), (0.08, 0.0043), (PAGE_W, 0.0035)],
    1: [(0.0, 0.0012), (0.005, 0.0055), (0.016, 0.0138), (0.032, 0.0165), (0.07, 0.0150), (PAGE_W, 0.0120)],
}


def page_height(u, side=1):
    """Height of the top page above the endpaper at distance u from the spine.
    Monotone cubic (Fritsch-Carlson) through PROFILE, so the curve never
    overshoots into a bump that paper wouldn't make."""
    pts = PROFILE[side]
    u = min(max(u, 0.0), PAGE_W)
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    n = len(pts)
    d = [(ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]) for i in range(n - 1)]
    m = [d[0]] + [0.0 if d[i - 1] * d[i] <= 0 else 2 / (1 / d[i - 1] + 1 / d[i]) for i in range(1, n - 1)] + [d[-1]]
    for i in range(n - 1):
        if xs[i] <= u <= xs[i + 1]:
            h = xs[i + 1] - xs[i]
            t = (u - xs[i]) / h
            h00, h10, h01, h11 = 2 * t**3 - 3 * t**2 + 1, t**3 - 2 * t**2 + t, -2 * t**3 + 3 * t**2, t**3 - t**2
            return h00 * ys[i] + h10 * h * m[i] + h01 * ys[i + 1] + h11 * h * m[i + 1]
    return ys[-1]


BLOCK_Z = BOARD_T + ENDPAPER_T    # the page blocks stand on the endpapers


def surface_z(x):
    """Top of the paper at local x (spine at x=0)."""
    return BLOCK_Z + page_height(abs(x), 1 if x >= 0 else -1)


def journal_page_block(name, side, img_path, collection, mats):
    """side = -1 for the left page, +1 for the right. The top face follows the
    profile and is UV-mapped by arc length, so writing isn't stretched on the
    slope. Every other face is stacked page edge, its leaf lines following the
    curve through a 'leaf' attribute (0 at the endpaper, 1 at the top page)."""
    nu, nv = 90, 60
    us = [PAGE_W * (i / nu) ** 1.5 for i in range(nu + 1)]  # dense near the gutter
    hs = [page_height(u, side) for u in us]
    arc = [0.0]
    for i in range(1, nu + 1):
        arc.append(arc[-1] + math.hypot(us[i] - us[i - 1], hs[i] - hs[i - 1]))
    S = arc[-1]
    # the paper is PAGE_W along its surface, so its x extent is a little less
    xs = [side * (0.0008 + us[i] * PAGE_W / S) for i in range(nu + 1)]
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new("UVMap")
    leaf = bm.verts.layers.float.new("leaf")
    top, bot = [], []
    for j in range(nv + 1):
        y = (j / nv - 0.5) * PAGE_H
        rt, rb = [], []
        for i in range(nu + 1):
            u = us[i] / PAGE_W
            # the top leaf's free corners lift a hair off the block
            lift = 0.0007 * u ** 3 * (abs(j / nv - 0.5) * 2) ** 3
            vt = bm.verts.new((xs[i], y, BLOCK_Z + hs[i] + lift))
            vb = bm.verts.new((xs[i], y, BLOCK_Z))
            vt[leaf], vb[leaf] = 1.0, 0.0
            rt.append(vt)
            rb.append(vb)
        top.append(rt)
        bot.append(rb)

    def face(vs, mi, uvs=None):
        f = bm.faces.new(vs if side > 0 else list(reversed(vs)))
        f.material_index = mi
        if uvs:
            for lp, t in zip(f.loops, uvs if side > 0 else list(reversed(uvs))):
                lp[uv].uv = t
        return f

    def iu(i):
        t = arc[i] / S
        return t if side > 0 else 1 - t

    for j in range(nv):
        for i in range(nu):
            face([top[j][i], top[j][i + 1], top[j + 1][i + 1], top[j + 1][i]], 0,
                 [(iu(i), j / nv), (iu(i + 1), j / nv), (iu(i + 1), (j + 1) / nv), (iu(i), (j + 1) / nv)])
            face([bot[j][i], bot[j + 1][i], bot[j + 1][i + 1], bot[j][i + 1]], 1)
    for j in range(nv):
        face([bot[j][nu], bot[j + 1][nu], top[j + 1][nu], top[j][nu]], 1)
        face([bot[j][0], top[j][0], top[j + 1][0], bot[j + 1][0]], 1)
    for i in range(nu):
        face([bot[0][i], bot[0][i + 1], top[0][i + 1], top[0][i]], 1)
        face([bot[nv][i], top[nv][i], top[nv][i + 1], bot[nv][i + 1]], 1)
    return obj_from_bm(name, bm, [paper_mat(name + "_page", img_path), mats["edge"]], collection)


def paper_mat(name, img_path):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = bpy.data.images.load(str(img_path), check_existing=True)
    tex.interpolation = "Cubic"
    nt.links.new(tex.outputs["Color"], b.inputs["Base Color"])
    b.inputs["Roughness"].default_value = 0.82
    # thin uncoated paper lets a little light through
    b.inputs["Subsurface Weight"].default_value = 0.08
    b.inputs["Subsurface Radius"].default_value = (1.0, 0.9, 0.7)
    b.inputs["Subsurface Scale"].default_value = 0.0015
    nz = nt.nodes.new("ShaderNodeTexNoise")
    nz.inputs["Scale"].default_value = 2200.0
    nz.inputs["Detail"].default_value = 8.0
    bump = nt.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.06
    bump.inputs["Distance"].default_value = 0.0002
    nt.links.new(nz.outputs["Fac"], bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], b.inputs["Normal"])
    return m


def edge_mat():
    """Stacked page edges: one leaf every ~0.1 mm, lines following the page
    curve (the 'leaf' attribute), uneven in spacing and in shade, with a soft
    darkening toward the endpaper where light doesn't get in."""
    m = bpy.data.materials.new("journal_edge")
    m.use_nodes = True
    nt = m.node_tree
    b = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    at = nt.nodes.new("ShaderNodeAttribute")
    at.attribute_name = "leaf"
    tc = nt.nodes.new("ShaderNodeTexCoord")
    nz = nt.nodes.new("ShaderNodeTexNoise")
    nz.inputs["Scale"].default_value = 60.0
    jit = nt.nodes.new("ShaderNodeMath")
    jit.operation = "MULTIPLY_ADD"
    jit.inputs[1].default_value = 0.08
    nt.links.new(nz.outputs["Fac"], jit.inputs[0])
    nt.links.new(at.outputs["Fac"], jit.inputs[2])
    nt.links.new(tc.outputs["Object"], nz.inputs["Vector"])
    leaves = nt.nodes.new("ShaderNodeMath")
    leaves.operation = "MULTIPLY"
    leaves.inputs[1].default_value = 70.0  # leaves in the visible stack
    nt.links.new(jit.outputs[0], leaves.inputs[0])
    frac = nt.nodes.new("ShaderNodeMath")
    frac.operation = "FRACT"
    nt.links.new(leaves.outputs[0], frac.inputs[0])
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    e = ramp.color_ramp.elements
    e[0].position, e[0].color = 0.0, (0.55, 0.50, 0.42, 1)
    e[1].position, e[1].color = 0.22, (0.91, 0.87, 0.78, 1)
    nt.links.new(frac.outputs[0], ramp.inputs["Fac"])
    shade = nt.nodes.new("ShaderNodeMix")
    shade.data_type = "RGBA"
    shade.blend_type = "MULTIPLY"
    nt.links.new(ramp.outputs["Color"], shade.inputs["A"])
    dk = nt.nodes.new("ShaderNodeMapRange")
    dk.inputs["To Min"].default_value = 0.35
    dk.inputs["To Max"].default_value = 0.0
    nt.links.new(at.outputs["Fac"], dk.inputs["Value"])
    nt.links.new(dk.outputs[0], shade.inputs["Factor"])
    shade.inputs["B"].default_value = (0.6, 0.55, 0.47, 1)
    nt.links.new(shade.outputs["Result"], b.inputs["Base Color"])
    b.inputs["Roughness"].default_value = 0.9
    return m


def leather_mat(name, hw, hh, fore_x, hinge_x=10.0):
    """Poly Haven Brown Leather at its real 400 mm scale, worn the way a book
    wears. In the board's own object space (origin at the board's centre, half
    sizes hw, hh, fore-edge at x = fore_x):
      rub   the dye rubbed lighter along the edges and most at the corners
      hand  a darker, glossier patch at the fore-edge middle, where it's held
    """
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    N = nt.nodes
    Lk = nt.links.new
    b = next(n for n in N if n.type == "BSDF_PRINCIPLED")
    uvn = N.new("ShaderNodeUVMap")
    uvn.uv_map = "UVMap"

    def img(file, color=True):
        t = N.new("ShaderNodeTexImage")
        t.image = bpy.data.images.load(str(LEATHER / file), check_existing=True)
        if not color:
            t.image.colorspace_settings.name = "Non-Color"
        Lk(uvn.outputs["UV"], t.inputs["Vector"])
        return t

    alb = img("brown_leather_albedo_2k.jpg")
    rough = img("brown_leather_rough_2k.jpg", False)
    nor = img("brown_leather_nor_gl_2k.jpg", False)
    nmap = N.new("ShaderNodeNormalMap")
    nmap.inputs["Strength"].default_value = 1.0
    Lk(nor.outputs["Color"], nmap.inputs["Color"])

    tc = N.new("ShaderNodeTexCoord")
    sep = N.new("ShaderNodeSeparateXYZ")
    Lk(tc.outputs["Object"], sep.inputs[0])

    def math_(op, a, bb=None, c=None):
        n = N.new("ShaderNodeMath")
        n.operation = op
        for k, v in enumerate((a, bb, c)):
            if v is None:
                continue
            if isinstance(v, (int, float)):
                n.inputs[k].default_value = v
            else:
                Lk(v, n.inputs[k])
        return n.outputs[0]

    ax = math_("ABSOLUTE", sep.outputs["X"])
    ay = math_("ABSOLUTE", sep.outputs["Y"])
    # distance in from the nearest edge
    ex = math_("SUBTRACT", hw, ax)
    ey = math_("SUBTRACT", hh, ay)
    e = math_("MINIMUM", ex, ey)
    edge = math_("SUBTRACT", 1.0, math_("MINIMUM", 1.0, math_("DIVIDE", e, 0.0035)))
    # corners: near both edges at once
    cx = math_("SUBTRACT", 1.0, math_("MINIMUM", 1.0, math_("DIVIDE", ex, 0.014)))
    cy = math_("SUBTRACT", 1.0, math_("MINIMUM", 1.0, math_("DIVIDE", ey, 0.014)))
    corner = math_("MULTIPLY", cx, cy)
    nz = N.new("ShaderNodeTexNoise")
    nz.inputs["Scale"].default_value = 160.0
    nz.inputs["Detail"].default_value = 6.0
    Lk(tc.outputs["Object"], nz.inputs["Vector"])
    rub = math_("MULTIPLY", math_("MAXIMUM", math_("MULTIPLY", edge, 0.45), math_("POWER", corner, 0.7)),
                math_("MULTIPLY_ADD", nz.outputs["Fac"], 1.2, -0.1))
    rub = math_("MINIMUM", 1.0, math_("MAXIMUM", 0.0, rub))
    # hand patch at the fore-edge middle
    dx = math_("SUBTRACT", ax, fore_x)
    d2 = math_("ADD", math_("POWER", math_("DIVIDE", dx, 0.03), 2.0), math_("POWER", math_("DIVIDE", sep.outputs["Y"], 0.045), 2.0))
    hand = math_("EXPONENT", math_("MULTIPLY", d2, -1.0))

    lighter = N.new("ShaderNodeMix")
    lighter.data_type = "RGBA"
    lighter.blend_type = "SCREEN"
    Lk(rub, lighter.inputs["Factor"])
    Lk(alb.outputs["Color"], lighter.inputs["A"])
    lighter.inputs["B"].default_value = (0.42, 0.30, 0.20, 1)
    darker = N.new("ShaderNodeMix")
    darker.data_type = "RGBA"
    darker.blend_type = "MULTIPLY"
    Lk(math_("MULTIPLY", hand, 0.55), darker.inputs["Factor"])
    Lk(lighter.outputs["Result"], darker.inputs["A"])
    darker.inputs["B"].default_value = (0.55, 0.45, 0.38, 1)
    Lk(darker.outputs["Result"], b.inputs["Base Color"])
    # roughness: the scan's, a touch rougher where rubbed (dye and finish worn
    # off), glossier where hands have oiled it
    r1 = math_("MULTIPLY_ADD", rough.outputs["Color"], 0.85, 0.0)
    r2 = math_("ADD", r1, math_("MULTIPLY", rub, 0.12))
    r3 = math_("SUBTRACT", r2, math_("MULTIPLY", hand, 0.22))
    Lk(math_("MAXIMUM", 0.18, r3), b.inputs["Roughness"])
    # fine creases along the hinges at |x| = joint, where it folds every opening
    cz = N.new("ShaderNodeTexNoise")
    cz.inputs["Scale"].default_value = 1.0
    cz.inputs["Detail"].default_value = 4.0
    stretch = N.new("ShaderNodeVectorMath")
    stretch.operation = "MULTIPLY"
    stretch.inputs[1].default_value = (40.0, 2600.0, 40.0)
    Lk(tc.outputs["Object"], stretch.inputs[0])
    Lk(stretch.outputs[0], cz.inputs["Vector"])
    hj = math_("EXPONENT", math_("MULTIPLY", math_("POWER", math_("DIVIDE", math_("SUBTRACT", ax, hinge_x), 0.0018), 2.0), -1.0))
    crease = math_("MULTIPLY", hj, cz.outputs["Fac"])
    bump = N.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.6
    bump.inputs["Distance"].default_value = 0.0004
    Lk(crease, bump.inputs["Height"])
    Lk(nmap.outputs["Normal"], bump.inputs["Normal"])
    Lk(bump.outputs["Normal"], b.inputs["Normal"])
    # creased leather in the hinge is a little lighter, the dye cracked
    b.inputs["Coat Weight"].default_value = 0.12
    b.inputs["Coat Roughness"].default_value = 0.35
    return m


def board_uvs(bm):
    """Box-projected UVs in metres / tile size, so the grain is real hide size."""
    uv = bm.loops.layers.uv.get("UVMap") or bm.loops.layers.uv.new("UVMap")
    for f in bm.faces:
        n = f.normal
        ax = max(range(3), key=lambda i: abs(n[i]))
        a, b = [(1, 2), (0, 2), (0, 1)][ax]
        for lp in f.loops:
            co = lp.vert.co
            lp[uv].uv = (co[a] / LEATHER_TILE + 0.37, co[b] / LEATHER_TILE + 0.61)


def rounded_board(name, w, h, t, r, collection):
    """A board with rounded corners, centred at the origin, then softened at
    every edge by a bevel: the leather turned over the board's edge."""
    bm = bmesh.new()
    pts = []
    for cx, cy, a0 in ((w / 2 - r, h / 2 - r, 0), (-w / 2 + r, h / 2 - r, 90), (-w / 2 + r, -h / 2 + r, 180), (w / 2 - r, -h / 2 + r, 270)):
        for k in range(9):
            a = math.radians(a0 + 90 * k / 8)
            pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    bot = [bm.verts.new((x, y, 0)) for x, y in pts]
    f = bm.faces.new(bot)
    ext = bmesh.ops.extrude_face_region(bm, geom=[f])
    for v in [e for e in ext["geom"] if isinstance(e, bmesh.types.BMVert)]:
        v.co.z = t
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    # grid the big faces so the bevel and the shading have vertices to work with
    bmesh.ops.triangulate(bm, faces=[f for f in bm.faces if len(f.verts) > 4])
    bm.normal_update()
    board_uvs(bm)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    collection.objects.link(o)
    bv = o.modifiers.new("soft", "BEVEL")
    bv.width = 0.0011
    bv.segments = 4
    bv.limit_method = "ANGLE"
    bv.angle_limit = math.radians(50)
    return o


def ribbon_path():
    """Points along the bookmark, local journal space: out of the head of the
    spine, lying in the gutter for most of the page, easing onto the right page
    near the tail, over the tail edge, down the stacked leaves to the board,
    off the board and a few centimetres out along the counter."""
    yt = -PAGE_H / 2
    ctrl = []
    for k in range(40):
        s = k / 39
        y = PAGE_H / 2 + 0.003 - s * (PAGE_H + 0.003)
        x = 0.0022 + 0.009 * s ** 3            # stays in the gutter, then eases out
        z = surface_z(x) + 0.0003
        if y > PAGE_H / 2:
            z -= (y - PAGE_H / 2) * 0.6           # tucks into the head of the spine
        ctrl.append(Vector((x, y, z)))
    x1 = ctrl[-1].x
    ztop = ctrl[-1].z
    ctrl += [
        Vector((x1 + 0.0004, yt - 0.0012, ztop - 0.0006)),          # rolls over the edge
        Vector((x1 + 0.0008, yt - 0.0018, (ztop + BLOCK_Z) / 2)),   # hangs down the leaves
        Vector((x1 + 0.0012, yt - 0.0016, BLOCK_Z + 0.0004)),
        Vector((x1 + 0.0016, yt - 0.0030, BOARD_T + 0.0003)),       # across the square
        Vector((x1 + 0.0020, yt - SQUARE + 0.0002, BOARD_T + 0.0003)),
        Vector((x1 + 0.0023, yt - SQUARE - 0.0009, BOARD_T + 0.0001)),  # rolls off the board's edge
        Vector((x1 + 0.0026, yt - SQUARE - 0.0018, BOARD_T * 0.55)),
        Vector((x1 + 0.0030, yt - SQUARE - 0.0040, 0.0003)),        # onto the counter
        Vector((x1 + 0.0050, yt - SQUARE - 0.0150, 0.0003)),
        Vector((x1 + 0.0085, yt - SQUARE - 0.0280, 0.0003)),
    ]
    pts = ctrl
    for _ in range(3):  # Chaikin: round every corner the ribbon bends over
        out = [pts[0]]
        for a, b in zip(pts, pts[1:]):
            out += [a.lerp(b, 0.25), a.lerp(b, 0.75)]
        out.append(pts[-1])
        pts = out
    return pts


def ribbon_obj(collection, material):
    pts = ribbon_path()
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new("UVMap")
    wdt = 0.0035
    rows = []
    k_off = next(k for k, p in enumerate(pts) if p.y < -PAGE_H / 2)
    k_land = next(k for k, p in enumerate(pts) if k > k_off and p.z <= 0.00035)
    for k, p in enumerate(pts):
        tng = (pts[min(k + 1, len(pts) - 1)] - pts[max(k - 1, 0)]).normalized()
        # width stays across the journal (local x) wherever the ribbon goes, so
        # it never spins where it hangs vertical; the twist below is deliberate
        X = Vector((1, 0, 0))
        side = (X - tng * X.dot(tng)).normalized()
        # a slight twist where it hangs free
        # a slight twist, rising and settling smoothly over the stretch where it
        # hangs free: from leaving the page to landing on the counter
        f = (k - k_off) / max(1, k_land - k_off)
        tw = math.radians(14) * math.sin(math.pi * f) if 0.0 < f < 1.0 else 0.0
        side = (Matrix.Rotation(tw, 3, tng) @ side).normalized()
        # the cut end: cut on a slant, as ribbon is
        off = 0.0
        if k == len(pts) - 1:
            off = -0.0035
        rows.append((bm.verts.new(p - side * wdt / 2), bm.verts.new(p + side * wdt / 2 + tng * off)))
    for k in range(len(rows) - 1):
        f = bm.faces.new((rows[k][0], rows[k + 1][0], rows[k + 1][1], rows[k][1]))
        for lp, uvv in zip(f.loops, ((0, k), (0, k + 1), (1, k + 1), (1, k))):
            lp[uvl].uv = (uvv[0], uvv[1] / 10)
    # flat-shaded: smooth shading across the solidify rim made it read as a tube
    o = obj_from_bm("journal_ribbon", bm, material, collection, smooth=False)
    s = o.modifiers.new("t", "SOLIDIFY")
    s.thickness = 0.00025
    s.offset = 1.0
    return o


def satin_mat():
    m = bpy.data.materials.new("journal_ribbon")
    m.use_nodes = True
    nt = m.node_tree
    b = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    b.inputs["Base Color"].default_value = (0.30, 0.045, 0.05, 1)
    b.inputs["Roughness"].default_value = 0.32
    b.inputs["Anisotropic"].default_value = 0.75   # satin's sheen runs along the weave
    b.inputs["Sheen Weight"].default_value = 0.4
    b.inputs["Sheen Tint"].default_value = (1.0, 0.75, 0.75, 1)
    tg = nt.nodes.new("ShaderNodeTangent")
    tg.direction_type = "UV_MAP"
    nt.links.new(tg.outputs["Tangent"], b.inputs["Tangent"])
    return m


def pen_rest():
    """Where a pen of radius r settles in the gutter: the lowest centre height
    at which the circle clears both page surfaces."""
    r = 0.0047
    best = None
    for i in range(-80, 81):
        x0 = i * 0.0004
        zc = 0.0
        for k in range(-40, 41):
            x = x0 + r * k / 40
            zc = max(zc, surface_z(x) + math.sqrt(max(0.0, r * r - (x - x0) ** 2)))
        if best is None or zc < best[1]:
            best = (x0, zc)
    return r, best


def pen_obj(collection):
    """An ordinary capped ballpoint: black matte barrel, chrome cap with a
    sprung clip and a ball end, a chrome end plug and band. 141 mm."""
    plastic = mat("pen_plastic", (0.025, 0.025, 0.03), rough=0.38, coat=0.25)
    chrome = mat("pen_chrome", (0.92, 0.92, 0.93), rough=0.12, metal=1.0)
    brushed = mat("pen_brushed", (0.85, 0.85, 0.86), rough=0.28, metal=1.0)
    r, (x0, zc) = pen_rest()
    root = bpy.data.objects.new("journal_pen", None)
    collection.objects.link(root)
    root.location = (x0, -0.004, zc + 0.0006)  # clears the ribbon lying under it
    parts = []

    def lathe(name, prof, material, segs=40):
        """prof: [(y, radius)] along the pen's axis (local +Y = toward the cap)."""
        bm = bmesh.new()
        rings = []
        for y, rad in prof:
            rings.append([bm.verts.new((rad * math.cos(2 * math.pi * k / segs), y, rad * math.sin(2 * math.pi * k / segs))) for k in range(segs)])
        for a, b2 in zip(rings, rings[1:]):
            for k in range(segs):
                bm.faces.new((a[k], a[(k + 1) % segs], b2[(k + 1) % segs], b2[k]))
        bm.faces.new(list(reversed(rings[0])))
        bm.faces.new(rings[-1])
        o = obj_from_bm(name, bm, material, collection)
        parts.append(o)
        return o

    L0 = -0.072
    lathe("pen_plug", [(L0, 0.0), (L0, 0.0034), (L0 + 0.0015, 0.0040), (L0 + 0.006, 0.0042)], chrome)
    lathe("pen_barrel", [(L0 + 0.006, 0.0043), (L0 + 0.02, 0.0046), (0.0, r), (0.012, 0.0045)], plastic)
    lathe("pen_band", [(0.012, 0.0046), (0.0135, 0.0048), (0.0145, 0.0048), (0.016, 0.0046)], brushed)
    # cap over the front: chrome, its lip just proud of the barrel
    lathe("pen_cap", [(0.015, 0.0049), (0.016, 0.0051), (0.060, 0.0050), (0.066, 0.0046), (0.069, 0.0030), (0.0695, 0.0)], chrome)
    # clip: a bent strip from the cap's top, standing 1.2 mm off it, ball at the end
    bm = bmesh.new()
    prof = [(0.064, 0.0050), (0.061, 0.0062), (0.056, 0.0064), (0.032, 0.0062), (0.027, 0.0058)]
    rows = []
    for y, z in prof:
        rows.append((bm.verts.new((-0.0012, y, z)), bm.verts.new((0.0012, y, z))))
    for a, b2 in zip(rows, rows[1:]):
        bm.faces.new((a[0], a[1], b2[1], b2[0]))
    clip = obj_from_bm("pen_clip", bm, chrome, collection)
    s = clip.modifiers.new("t", "SOLIDIFY")
    s.thickness = 0.0005
    parts.append(clip)
    ball = cyl("pen_clipball", 0.0011, 0.0024, chrome, collection, verts=20, loc=(0, 0.027, 0.0055), rot=(0, math.radians(90), 0))
    parts.append(ball)
    # the clip side faces up, rolled a few degrees the way it settled
    for p in parts:
        p.parent = root
    root.rotation_euler = (0, math.radians(-8), 0)
    return root


def add_journal(pen=True):
    c = coll("Journal")
    root = bpy.data.objects.new("Journal", None)
    c.objects.link(root)
    mats = {"edge": edge_mat()}
    endpaper = mat("journal_endpaper", (0.80, 0.72, 0.58), rough=0.85)
    parts = []
    bw = PAGE_W + SQUARE - (JOINT - 0.0008)   # board width from its inner edge
    bh = PAGE_H + 2 * SQUARE
    # The case is one piece of leather over both boards and the spine, opened
    # flat: rounded outer corners only, the hinges creased in the shader.
    half = JOINT + bw
    cover = rounded_board("journal_cover", 2 * half, bh, BOARD_T, 0.0045, c)
    cover.data.materials.append(leather_mat("leather_cover", half, bh / 2, half, hinge_x=JOINT))
    parts.append(cover)
    for s, nm in ((-1, "left"), (1, "right")):
        # pastedown endpaper, inset from the board's outer edges by the turn-in
        ex0, ex1 = sorted((s * (JOINT - 0.001), s * (JOINT + bw - 0.013)))
        parts.append(box(f"journal_pastedown_{nm}", (ex0, -bh / 2 + 0.013, BOARD_T - 0.0001), (ex1, bh / 2 - 0.013, BOARD_T + ENDPAPER_T), [endpaper], c))
    parts.append(journal_page_block("journal_left", -1, HERE / "journal" / "left.png", c, mats))
    parts.append(journal_page_block("journal_right", 1, HERE / "journal" / "right.png", c, mats))
    parts.append(ribbon_obj(c, satin_mat()))
    if pen:
        parts.append(pen_obj(c))
    for p in parts:
        p.parent = root
    root.location = JOURNAL_AT
    root.rotation_euler = (0, 0, JOURNAL_ROT)
    bpy.context.view_layer.update()
    return root


def journal_corners():
    """Right page's four corners (top surface), world space, in reading order:
    top-left (at the gutter), top-right, bottom-right, bottom-left."""
    mw = O["Journal"].matrix_world
    me = O["journal_right"].data
    xs = [v.co.x for v in me.vertices]
    x0, x1 = min(xs), max(xs)
    pts = [(x0, PAGE_H / 2, surface_z(x0 + 1e-5)), (x1, PAGE_H / 2, surface_z(x1)),
           (x1, -PAGE_H / 2, surface_z(x1)), (x0, -PAGE_H / 2, surface_z(x0 + 1e-5))]
    return [mw @ Vector(p) for p in pts]


# ------------------------------------------------------------------ fridge door
DOOR_T = 0.07          # door slab thickness, front of cabinet at y=0
DOOR_TOP = 1.297       # bottom of the freezer seam
HINGE = (-0.735, 0.0)  # front-left vertical edge, as seen
DOOR_DEG = 62.0  # at 70 the door is edge-on to this camera and the paper vanishes
LOWER_ITEMS = ["save-the-date", "drawing", "race-bib", "appointment", "postcard", "list"]


def split_fridge():
    """Cut the lower door off the one-box fridge and hollow out the compartment.
    Returns the door object, pivoted at the hinge, with the handle, paper and
    magnets parented so they swing with it."""
    c = coll("FridgeOpen")
    fr = O["Fridge"]
    apply_modifiers(fr)  # the bevel, so the cut keeps the rounded front edges
    door = fr.copy()
    door.data = fr.data.copy()
    door.name = "FridgeDoor"
    c.objects.link(door)
    liner = mat("fridge_liner", (0.86, 0.87, 0.86), rough=0.32)
    slab = box("cut_slab", (-1.0, -0.3, -0.5), (1.0, DOOR_T, DOOR_TOP), [liner], c)
    keep = box("cut_keep", (-1.0, -0.3, -0.5), (1.0, DOOR_T, DOOR_TOP), [liner], c)
    # inner compartment: 4 cm walls, 5 cm floor above the kick plate, 6 cm back wall
    cav = box("cut_cavity", (-0.695, 0.0, 0.115), (-0.005, 0.60, DOOR_TOP - 0.04), [liner], c)
    boolean(fr, slab, "DIFFERENCE")
    boolean(fr, cav, "DIFFERENCE")
    boolean(door, keep, "INTERSECT")
    for o in (slab, keep, cav):
        bpy.data.objects.remove(o, do_unlink=True)
    # door back: a liner panel inset inside a grey rubber gasket
    gasket = mat("fridge_gasket", (0.18, 0.18, 0.18), rough=0.6)
    g = box("FridgeGasket", (-0.715, DOOR_T, 0.085), (0.015, DOOR_T + 0.012, DOOR_TOP - 0.02), [gasket], c, bevel=0.004)
    pnl = box("FridgeDoorLiner", (-0.69, DOOR_T + 0.012, 0.11), (-0.01, DOOR_T + 0.02, DOOR_TOP - 0.045), [liner], c, bevel=0.006)
    bins = []  # no door bins: the door's inside is never seen from this camera
    pivot = bpy.data.objects.new("FridgeHinge", None)
    c.objects.link(pivot)
    pivot.location = (HINGE[0], HINGE[1], 0.0)
    bpy.context.view_layer.update()
    kids = [door, g, pnl, *bins, O["HandleBot"]]
    for iid in LOWER_ITEMS:
        kids += [O[f"paper_{iid}"], O[f"magnet_{iid}"]]
    for k in kids:
        mw = k.matrix_world.copy()
        k.parent = pivot
        k.matrix_world = mw
    return pivot


def open_door(pivot, deg):
    # negative about Z: the free (handle) edge comes toward the camera, the door
    # swings out to the camera's left, away from the counter
    pivot.rotation_euler = (0, 0, -math.radians(deg))
    bpy.context.view_layer.update()


LABELS = HERE / "fridge-labels"


def label_mat(name, img, rough=0.75):
    """One material for tape and ink together: base colour is the inked texture,
    and the bump comes from the blank substrate (<img>-surface.png), so the
    creases and their sheen run under and across the letters alike. No separate
    ink layer, nothing that could sit above the tape. Alpha only cuts the torn
    tape ends."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    t = nt.nodes.new("ShaderNodeTexImage")
    t.image = bpy.data.images.load(str(LABELS / img), check_existing=True)
    t.interpolation = "Cubic"
    nt.links.new(t.outputs["Color"], b.inputs["Base Color"])
    nt.links.new(t.outputs["Alpha"], b.inputs["Alpha"])
    b.inputs["Roughness"].default_value = rough
    srf = nt.nodes.new("ShaderNodeTexImage")
    srf.image = bpy.data.images.load(str(LABELS / img.replace(".png", "-surface.png")), check_existing=True)
    srf.image.colorspace_settings.name = "Non-Color"
    bump = nt.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.35
    bump.inputs["Distance"].default_value = 0.0003
    nt.links.new(srf.outputs["Color"], bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], b.inputs["Normal"])
    return m


def band(name, r, h, arc_deg, material, collection, loc, face_deg=-90.0):
    """A strip of tape wrapped round a cylinder, centred on the side facing
    face_deg (-90 = toward the camera, -Y). UV u runs along the strip."""
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new("UVMap")
    n = 24
    a0 = math.radians(face_deg - arc_deg / 2)
    da = math.radians(arc_deg) / n
    lo, hi = [], []
    for i in range(n + 1):
        a = a0 + i * da
        x, y = r * math.cos(a), r * math.sin(a)
        lo.append(bm.verts.new((x, y, -h / 2)))
        hi.append(bm.verts.new((x, y, h / 2)))
    for i in range(n):
        # wound so the outside faces out and the image reads left to right
        f = bm.faces.new((lo[i], lo[i + 1], hi[i + 1], hi[i]))
        for lp, t in zip(f.loops, ((i / n, 0), ((i + 1) / n, 0), ((i + 1) / n, 1), (i / n, 1))):
            lp[uv].uv = t
    o = obj_from_bm(name, bm, material, collection)
    o.location = loc
    return o


def card(name, w, h, material, collection, loc, rot):
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new("UVMap")
    vs = [bm.verts.new(v) for v in ((-w / 2, 0, 0), (w / 2, 0, 0), (w / 2, 0, h), (-w / 2, 0, h))]
    f = bm.faces.new(vs)
    for lp, t in zip(f.loops, ((0, 0), (1, 0), (1, 1), (0, 1))):
        lp[uv].uv = t
    o = obj_from_bm(name, bm, material, collection, smooth=False)
    s = o.modifiers.new("t", "SOLIDIFY")
    s.thickness = 0.0004
    o.location = loc
    o.rotation_euler = rot
    return o


def shell(o, t):
    s = o.modifiers.new("shell", "SOLIDIFY")
    s.thickness = t
    s.offset = -1.0
    return o


def ellipsoid(name, a, b, c, material, collection, loc, rot=(0, 0, 0), segs=24):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=segs, v_segments=segs // 2, radius=1.0)
    for v in bm.verts:
        v.co = Vector((v.co.x * a, v.co.y * b, v.co.z * c))
    o = obj_from_bm(name, bm, material, collection)
    o.location = loc
    o.rotation_euler = rot
    return o


def bumpy(m, scale, strength):
    nt = m.node_tree
    b = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    nz = nt.nodes.new("ShaderNodeTexNoise")
    nz.inputs["Scale"].default_value = scale
    bp = nt.nodes.new("ShaderNodeBump")
    bp.inputs["Strength"].default_value = strength
    nt.links.new(nz.outputs["Fac"], bp.inputs["Height"])
    nt.links.new(bp.outputs["Normal"], b.inputs["Normal"])
    return m


def fill_fridge():
    """A vitrine, not a stocked fridge (Caleb, 2026-10-07): a few things a family
    keeps, one or two per shelf, placed with space round them and lit from the
    front of each shelf like an exhibit. Calm palette: cream, amber, sage.

    Cavity: x -0.695..-0.005, y 0..0.60, z 0.115..1.257. At DOOR_DEG the door
    hides x < about -0.58 from the camera, so nothing is placed there.
    """
    c = coll("FridgeInside")
    X0, X1, Y0, Y1 = -0.69, -0.01, 0.03, 0.585
    glass = mat("shelf_glass", (0.93, 0.97, 0.95), rough=0.03, trans=1.0, ior=1.5)
    trim = mat("shelf_trim", (0.90, 0.89, 0.85), rough=0.35)
    S1, S2 = 0.47, 0.80  # shelf tops
    for k, zs in enumerate((S1, S2)):
        box(f"shelf_glass{k}", (X0, Y0, zs - 0.006), (X1, Y1, zs), [glass], c)
        box(f"shelf_trim{k}", (X0, Y0 - 0.004, zs - 0.016), (X1, Y0 + 0.012, zs + 0.002), [trim], c, bevel=0.002)
        # a strip light under the front of each shelf, aimed at the shelf below
        L = bpy.data.lights.new(f"ShelfLED{k}", "AREA")
        L.shape = "RECTANGLE"
        L.size, L.size_y = 0.5, 0.015
        L.energy = 3.5
        L.color = (1.0, 0.95, 0.86)
        lo = bpy.data.objects.new(f"ShelfLED{k}", L)
        c.objects.link(lo)
        lo.location = (-0.33, Y0 + 0.03, zs - 0.02)
        lo.rotation_euler = (math.radians(-10), 0, 0)

    cream = mat("cream_ceramic", (0.92, 0.89, 0.82), rough=0.18, coat=0.4)
    sage = mat("sage_ceramic", (0.50, 0.58, 0.46), rough=0.22, coat=0.4)
    clear = mat("clear_plastic", (0.97, 0.98, 0.98), rough=0.05, trans=1.0, ior=1.46)

    # --- top shelf: a slice of birthday cake, and its tent card
    z = S2
    cyl("cake_plate", 0.088, 0.01, cream, c, verts=64, loc=(-0.40, 0.24, z + 0.005), r2=0.078)
    sponge = bumpy(mat("cake_sponge", (0.90, 0.62, 0.28), rough=0.9), 900, 0.4)
    frost = mat("cake_frosting", (0.96, 0.93, 0.86), rough=0.45)

    def wedge(name, r, a0, a1, h, material, zc):
        bm = bmesh.new()
        n = 12
        bot = [bm.verts.new((0, 0, 0))] + [bm.verts.new((r * math.cos(a0 + (a1 - a0) * i / n), r * math.sin(a0 + (a1 - a0) * i / n), 0)) for i in range(n + 1)]
        top = [bm.verts.new((v.co.x, v.co.y, h)) for v in bot]
        bm.faces.new(list(reversed(bot)))
        bm.faces.new(top)
        m = len(bot)
        for i in range(m):
            j = (i + 1) % m
            bm.faces.new((bot[i], bot[j], top[j], top[i]))
        o = obj_from_bm(name, bm, material, c, smooth=False)
        o.location = (-0.46, 0.20, zc)
        return o

    A0, A1 = 0.0, math.radians(38)  # one cut face square to the camera, showing the layers
    zc = z + 0.0105
    for k, (h, m_) in enumerate(((0.024, sponge), (0.005, frost), (0.024, sponge))):
        wedge(f"cake_layer{k}", 0.105, A0, A1, h, m_, zc)
        zc += h
    d = math.radians(0.6)
    wedge("cake_skin", 0.109, A0 + d, A1 - d, zc - (z + 0.0105) + 0.007, frost, z + 0.0105)
    cnd = mat("candle", (0.55, 0.64, 0.50), rough=0.4)
    cyl("cake_candle", 0.0028, 0.055, cnd, c, verts=12, loc=(-0.46 + 0.06, 0.20 + 0.02, zc + 0.007 + 0.027))
    cyl("cake_wick", 0.0006, 0.006, mat("wick", (0.08, 0.06, 0.05), rough=0.8), c, verts=6, loc=(-0.40, 0.22, zc + 0.007 + 0.057))
    # tent card: an index card folded in half, standing beside the plate,
    # its front face (the marker) toward the camera
    tent = label_mat("tent_card", "tent.png", rough=0.8)
    plain = mat("card_back", (0.95, 0.94, 0.90), rough=0.8)
    tilt = math.radians(17)
    card("tent_front", 0.09, 0.05, tent, c, (-0.22, 0.21, z), (tilt, 0, math.radians(-6)))
    card("tent_back", 0.09, 0.05, plain, c, (-0.22, 0.21 + 2 * 0.05 * math.sin(tilt), z), (-tilt, 0, math.radians(-6)))
    # a strip of masking tape holding the card's foot to the shelf
    box("tent_tape", (-0.235, 0.197, z), (-0.205, 0.214, z + 0.0004), [mat("masking", (0.86, 0.80, 0.62), rough=0.8)], c)

    # corsage in a clear box, toward the back right of the top shelf
    bx = box("corsage_box", (-0.16, 0.36, z), (-0.03, 0.46, z + 0.085), [clear], c)
    s = bx.modifiers.new("shell", "SOLIDIFY")
    s.thickness = 0.0008
    petal_cr = mat("petal_cream", (0.95, 0.90, 0.80), rough=0.5)
    petal_bl = mat("petal_blush", (0.93, 0.76, 0.68), rough=0.5)
    leaf = mat("corsage_leaf", (0.36, 0.46, 0.30), rough=0.45)
    for k, (x, y, m_) in enumerate(((-0.11, 0.41, petal_cr), (-0.08, 0.40, petal_bl), (-0.095, 0.425, petal_cr))):
        zz = z + 0.035
        ellipsoid(f"bloom{k}_c", 0.008, 0.008, 0.007, m_, c, (x, y, zz))
        for p in range(7):
            a = p * 2 * math.pi / 7 + k
            ellipsoid(f"bloom{k}_p{p}", 0.011, 0.007, 0.0025, m_, c,
                      (x + 0.009 * math.cos(a), y + 0.009 * math.sin(a), zz - 0.002), (0.0, -0.6, a))
    for k, (x, y, a) in enumerate(((-0.135, 0.405, 2.6), (-0.125, 0.43, 3.4), (-0.06, 0.415, 0.2))):
        ellipsoid(f"corsage_leaf{k}", 0.022, 0.009, 0.002, leaf, c, (x, y, z + 0.022), (0.2, 0.1, a))
    ribbon = mat("corsage_ribbon", (0.80, 0.52, 0.18), rough=0.3)
    for k, a in enumerate((0.5, -0.5)):
        ellipsoid(f"corsage_bow{k}", 0.014, 0.006, 0.004, ribbon, c, (-0.095 + 0.012 * math.sin(a * 2), 0.392, z + 0.015), (0.4, 0, a))

    # --- middle shelf: a jar of beach sand, and a film canister on its own
    z = S1
    jar = cyl("sand_jar", 0.04, 0.12, clear, c, verts=48, loc=(-0.40, 0.24, z + 0.06))
    shell(jar, 0.002)
    sand = bumpy(mat("sand", (0.84, 0.74, 0.57), rough=0.95), 2500, 0.6)
    cyl("sand_fill", 0.0375, 0.075, sand, c, verts=48, loc=(-0.40, 0.24, z + 0.002 + 0.0375))
    ellipsoid("sand_shell", 0.009, 0.007, 0.004, mat("shell", (0.93, 0.86, 0.80), rough=0.4), c,
              (-0.39, 0.235, z + 0.079), (0.3, 0.1, 0.6))
    cyl("sand_cork", 0.036, 0.022, bumpy(mat("cork", (0.62, 0.46, 0.30), rough=0.9), 1800, 0.5), c,
        verts=48, loc=(-0.40, 0.24, z + 0.125), r2=0.033)
    band("sand_tape", 0.0405, 0.021, 92, label_mat("sand_tape", "sand-tape.png"), c, (-0.40, 0.24, z + 0.062), face_deg=-100)
    can = mat("film_canister", (0.03, 0.03, 0.035), rough=0.25)
    cyl("film_can", 0.0165, 0.05, can, c, verts=40, loc=(-0.12, 0.20, z + 0.025))
    cyl("film_lid", 0.0178, 0.008, mat("film_lid", (0.55, 0.56, 0.57), rough=0.5), c, verts=40, loc=(-0.12, 0.20, z + 0.054))

    # --- floor: lemons in a sage bowl with a note on the rim; Abuela's mole
    z = 0.115
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=48, v_segments=24, radius=1.0)
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.z > 0.25], context="VERTS")
    for v in bm.verts:
        v.co = Vector((v.co.x * 0.085, v.co.y * 0.085, (v.co.z + 1.0) * 0.042))
    bowl = obj_from_bm("lemon_bowl", bm, sage, c)
    shell(bowl, 0.005)
    bowl.location = (-0.40, 0.27, z)
    lemon = bumpy(mat("lemon", (0.93, 0.76, 0.16), rough=0.45), 700, 0.5)
    for k, (x, y, zz, a) in enumerate(((-0.42, 0.26, 0.04, 0.3), (-0.375, 0.285, 0.042, 1.9), (-0.40, 0.30, 0.05, 1.0), (-0.395, 0.245, 0.062, 2.6))):
        ellipsoid(f"lemon{k}", 0.036, 0.028, 0.028, lemon, c, (x, y, z + zz), (0.2, 0.15, a))
    card("lemon_note", 0.07, 0.035, label_mat("lemon_note", "lemon-note.png"), c,
         (-0.40, 0.193, z + 0.048), (math.radians(-62), 0, math.radians(4)))
    deli = cyl("deli", 0.06, 0.07, clear, c, verts=48, loc=(-0.15, 0.22, z + 0.035), r2=0.064)
    shell(deli, 0.0012)
    cyl("mole", 0.057, 0.052, mat("mole", (0.20, 0.08, 0.04), rough=0.35), c, verts=48, loc=(-0.15, 0.22, z + 0.028), r2=0.06)
    cyl("deli_lid", 0.066, 0.008, mat("deli_lid", (0.94, 0.95, 0.95), rough=0.2, trans=0.6), c, verts=48, loc=(-0.15, 0.22, z + 0.074))
    band("mole_tape", 0.0625, 0.032, 92, label_mat("mole_tape", "mole-tape.png"), c, (-0.15, 0.22, z + 0.04), face_deg=-98)

    # The compartment's own light, under the ceiling near the front. At night it
    # carries out past the door onto the floor.
    L = bpy.data.lights.new("FridgeLED", "AREA")
    L.shape = "RECTANGLE"
    L.size = 0.5
    L.size_y = 0.03
    L.energy = 12.0
    L.color = (1.0, 0.96, 0.9)
    lo = bpy.data.objects.new("FridgeLED", L)
    c.objects.link(lo)
    lo.location = (-0.35, 0.08, DOOR_TOP - 0.045)
    lo.rotation_euler = (math.radians(-28), 0, 0)
    dif = bpy.data.materials.new("led_diffuser")
    dif.use_nodes = True
    nt = dif.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    em = nt.nodes.new("ShaderNodeEmission")
    em.inputs["Color"].default_value = (1.0, 0.97, 0.92, 1)
    em.inputs["Strength"].default_value = 3.0
    nt.links.new(em.outputs[0], out.inputs[0])
    box("led_diffuser", (-0.6, 0.06, DOOR_TOP - 0.042), (-0.1, 0.10, DOOR_TOP - 0.039), [dif], c)
    return lo


def project(p):
    from bpy_extras.object_utils import world_to_camera_view
    v = world_to_camera_view(sc, sc.camera, Vector(p))
    return [round(v.x * 100, 3), round((1 - v.y) * 100, 3)]
